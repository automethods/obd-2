"""Original, read-only descriptions of this lab's existing diagnostic subset.

This JSON format is independent of MCD/ODX and does not execute formulas or
load third-party databases. Numeric conversions are declarative metadata for
the learner; DiagnosticServer remains the authority for implemented behavior.
"""
from __future__ import annotations

from copy import deepcopy
from functools import lru_cache
import json
import math
from pathlib import Path
import re

SCHEMA_VERSION = "obdii-lab.diagnostic-definitions.v1"
CATALOG_PATH = Path(__file__).resolve().parents[1] / "web" / "models" / "diagnostic_definitions.json"
DECODE_KINDS = {"linear", "ascii", "bitmask", "bitfield", "dtc_list", "acknowledgement", "session"}


def _hex_bytes(value, name):
    if not isinstance(value, str) or not re.fullmatch(r"[0-9A-F]{2}(?: [0-9A-F]{2})*", value):
        raise ValueError(f"{name} must contain space-separated uppercase hexadecimal bytes")
    return bytes.fromhex(value)


def validate_catalog(catalog: dict) -> None:
    """Reject malformed descriptors and unsupported/fabricated module routing."""
    if not isinstance(catalog, dict) or catalog.get("schema_version") != SCHEMA_VERSION:
        raise ValueError("Unsupported diagnostic-definition schema")
    modules, services = catalog.get("modules"), catalog.get("services")
    if not isinstance(modules, list) or not modules or not isinstance(services, list):
        raise ValueError("Definitions require module and service arrays")
    module_map = {}
    for module in modules:
        if not isinstance(module, dict) or not isinstance(module.get("id"), str) or module["id"] in module_map:
            raise ValueError("Module IDs must be unique strings")
        if not isinstance(module.get("name"), str) or not isinstance(module.get("service_ids"), list):
            raise ValueError("Modules require a name and service_ids array")
        if module.get("availability") == "state_only":
            if module.get("addressing") is not None or module["service_ids"]:
                raise ValueError("State-only modules cannot declare diagnostic addresses or services")
        elif module.get("availability") == "implemented":
            if module["id"] != "ecu" or module.get("addressing") != {
                    "physical_request_can_id": "7E0", "functional_request_can_id": "7DF", "response_can_id": "7E8"}:
                raise ValueError("Only the implemented engine ECU diagnostic route is supported")
        else:
            raise ValueError("Module availability must be implemented or state_only")
        if not isinstance(module.get("profiles"), list) or not set(module["profiles"]).issubset({"engine", "phev", "braking"}):
            raise ValueError("Invalid module profile list")
        module_map[module["id"]] = module
    seen = set()
    for service in services:
        if not isinstance(service, dict) or not isinstance(service.get("id"), str) or service["id"] in seen:
            raise ValueError("Service IDs must be unique strings")
        seen.add(service["id"])
        module = module_map.get(service.get("module_id"))
        if not module or module["availability"] != "implemented" or service["id"] not in module["service_ids"]:
            raise ValueError("Service must belong to an implemented module")
        if service.get("availability") != "implemented" or service.get("protocol") not in {"OBD", "UDS"}:
            raise ValueError("Only implemented OBD/UDS services belong in this catalog")
        request = _hex_bytes(service.get("request_hex"), "request_hex")
        prefix = _hex_bytes(service.get("positive_prefix_hex"), "positive_prefix_hex")
        if not 1 <= len(request) <= 7:
            raise ValueError("Requests must contain 1–7 application bytes")
        allowed = ["7DF", "7E0"] if service["protocol"] == "OBD" else ["7E0"]
        if service.get("allowed_can_ids") != allowed or service.get("can_id") not in allowed:
            raise ValueError("Service addressing does not match the implemented transport")
        if not isinstance(service.get("name"), str) or not isinstance(service.get("unit"), str):
            raise ValueError("Services require a name and unit string")
        decode = service.get("decode")
        if not isinstance(decode, dict) or decode.get("kind") not in DECODE_KINDS:
            raise ValueError("Unknown decode descriptor kind")
        offset, length = decode.get("data_offset"), decode.get("data_length")
        if type(offset) is not int or not len(prefix) <= offset <= 4095:
            raise ValueError("Decoder data_offset must follow the positive response prefix")
        if length is None:
            if decode["kind"] != "dtc_list":
                raise ValueError("Only DTC lists have variable data length in this schema")
        elif type(length) is not int or not 0 <= length <= 4095:
            raise ValueError("Decoder data_length must be a nonnegative integer")
        if not isinstance(decode.get("formula"), str):
            raise ValueError("Decoder formula is required as explanatory text")
        if decode["kind"] == "linear":
            if length not in (1, 2) or decode.get("byte_order") != "big":
                raise ValueError("Lab numeric decoders use one or two big-endian data bytes")
            for key in ("factor", "offset"):
                if type(decode.get(key)) not in (int, float) or not math.isfinite(decode[key]):
                    raise ValueError("Decoder factor and offset must be finite numbers")
    if seen != {identifier for module in modules for identifier in module["service_ids"]}:
        raise ValueError("Module service references do not match the catalog")


@lru_cache(maxsize=1)
def _load_catalog() -> dict:
    catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    validate_catalog(catalog)
    return catalog


def diagnostic_definitions(snapshot: dict | None = None) -> dict:
    """Return independent metadata, enriched with current availability if given."""
    catalog = deepcopy(_load_catalog())
    if snapshot is None:
        return catalog
    connected = snapshot.get("effective_connections", snapshot.get("connections", {})).get("dlc", True)
    catalog["runtime"] = {"t": snapshot.get("t", 0), "profile": snapshot.get("profile"),
                          "diagnostic_branch_connected": bool(connected)}
    for module in catalog["modules"]:
        module["installed_now"] = snapshot.get("profile") in module["profiles"]
        module["available_now"] = bool(module["installed_now"] and connected and module["availability"] == "implemented")
        module["availability_note"] = ("Not installed in this profile." if not module["installed_now"] else
                                       "State inspection only; no diagnostic endpoint." if module["availability"] == "state_only" else
                                       "Simulated diagnostic endpoint available." if connected else "Diagnostic CAN branch disconnected; requests time out.")
    for service in catalog["services"]:
        service["available_now"] = bool(connected)
        service["availability_note"] = ("Implemented in the local teaching ECU." if connected else
                                        "Diagnostic CAN branch disconnected; requests time out.")
    return catalog


def decode_scalar(service: dict, response_hex: str):
    """Decode supported numeric/ASCII metadata without evaluating formula text.

    Structured status, DTC and session results keep their explanatory descriptors
    for the UI. None means this small scalar helper does not decode that kind.
    """
    response = _hex_bytes(response_hex, "response_hex")
    if not response.startswith(_hex_bytes(service["positive_prefix_hex"], "positive_prefix_hex")):
        raise ValueError("Response does not match the descriptor's positive prefix")
    decode = service["decode"]
    if decode["kind"] not in {"linear", "ascii"}:
        return None
    start, length = decode["data_offset"], decode["data_length"]
    data = response[start:start + length]
    if len(data) != length:
        raise ValueError("Response is too short for the descriptor")
    if decode["kind"] == "ascii":
        return data.decode("ascii")
    return int.from_bytes(data, decode["byte_order"]) * decode["factor"] + decode["offset"]
