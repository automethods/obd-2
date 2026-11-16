"""Educational emissions diagnostics and Classical-CAN ISO-TP framing.

This is a deliberate subset, not an approved SAE/ISO conformance implementation.
No socket, USB device, serial adapter, or physical vehicle is opened.  Request
payloads are application bytes; ``frames`` are a generated wire-format lesson.
See docs/PROTOCOL.md for the supported contract and primary references.
"""

from __future__ import annotations

import math
import re
from typing import Callable, Optional


FUNCTIONAL_ID = 0x7DF
ENGINE_REQUEST_ID = 0x7E0
ENGINE_RESPONSE_ID = 0x7E8
BITRATE = 500_000  # Describes this lab's chosen bus; timing is not emulated.
SYNTHETIC_VIN = "LAB00000000000001"
SYNTHETIC_PART_NUMBER = "LAB-ECU-0001"
MODE_01_PIDS = (0x01, 0x04, 0x05, 0x0C, 0x0D, 0x0F, 0x10, 0x11)
MODE_09_PIDS = (0x02,)


def hex_bytes(data: bytes) -> str:
    return " ".join(f"{byte:02X}" for byte in data)


def _bytes(value: bytes | bytearray | list | str) -> bytes:
    if isinstance(value, str):
        # bytes.fromhex accepts normal whitespace and compact hex, not 0x syntax.
        return bytes.fromhex(value)
    return bytes(value)


def encode_dtc(code: str) -> bytes:
    """Encode a five-character P/C/B/U DTC into its two-byte representation.

    Only the format is checked; this does not validate that the DTC is assigned.
    P0000 represents no DTC and is excluded from diagnostic memory responses.
    """
    code = code.upper()
    if not re.fullmatch(r"[PCBU][0-3][0-9A-F]{3}", code):
        raise ValueError("DTC must look like P0118, C1234, B2ABC, or U0100")
    family = "PCBU".index(code[0])
    value = (family << 14) | (int(code[1]) << 12) | int(code[2:], 16)
    return value.to_bytes(2, "big")


def decode_dtc(data: bytes | str | list) -> str:
    raw = _bytes(data)
    if len(raw) != 2:
        raise ValueError("A DTC must contain exactly two bytes")
    value = int.from_bytes(raw, "big")
    return f"{'PCBU'[value >> 14]}{(value >> 12) & 3}{value & 0xFFF:03X}"


def supported_mask(pids: tuple | list, base: int = 0) -> bytes:
    """Four-byte supported-PID mask: MSB is base+1, LSB is base+32."""
    mask = 0
    for pid in pids:
        if base < pid <= base + 32:
            mask |= 1 << (32 - (pid - base))
    return mask.to_bytes(4, "big")


def segment_payload(payload: bytes | str | list, padding: int = 0) -> list[bytes]:
    """Encode SF or FF/CF frames, each padded to eight Classical CAN bytes.

    This low-level encoder does NOT schedule or wait for flow control.  Use
    ``isotp_trace`` for an explanatory transcript containing a synthetic FC.
    Supports normal addressing and the 12-bit length format (1..4095 bytes).
    """
    payload = _bytes(payload)
    size = len(payload)
    if not 1 <= size <= 4095:
        raise ValueError("Payload length must be 1..4095 for this ISO-TP subset")
    if not 0 <= padding <= 255:
        raise ValueError("Padding must be one byte")

    def pad(data: bytes) -> bytes:
        return data + bytes([padding]) * (8 - len(data))

    if size <= 7:
        return [pad(bytes([size]) + payload)]
    result = [bytes([0x10 | (size >> 8), size & 0xFF]) + payload[:6]]
    sequence = 1
    for position in range(6, size, 7):
        result.append(pad(bytes([0x20 | sequence]) + payload[position:position + 7]))
        sequence = (sequence + 1) & 0x0F
    return result


class IsoTpReceiver:
    """Stateful reassembly for one prefiltered CAN ID and normal addressing.

    ``feed(frame, timestamp)`` returns complete application bytes or None.
    Timestamps are monotonic simulation seconds supplied by the caller.
    Timeout, sequence mismatch, and malformed lengths abort the assembly.
    This is a receive-side parser, not a complete ISO-TP sender or CAN driver.
    A new valid SF/FF replaces an unfinished older transfer.
    """

    def __init__(self, timeout_s: float = 1.0, padding_byte: Optional[int] = None):
        if not math.isfinite(timeout_s) or timeout_s <= 0:
            raise ValueError("timeout_s must be positive and finite")
        if padding_byte is not None and not 0 <= padding_byte <= 255:
            raise ValueError("padding_byte must be None or 0..255")
        self.timeout_s = timeout_s
        self.padding_byte = padding_byte
        self.reset()

    def reset(self) -> None:
        self.buffer = bytearray()
        self.expected_size = None
        self.expected_sequence = 1
        self.last_timestamp = None

    @property
    def active(self) -> bool:
        return self.expected_size is not None

    def check_timeout(self, timestamp: float) -> None:
        if not math.isfinite(timestamp):
            raise ValueError("timestamp must be finite")
        if self.active and timestamp < self.last_timestamp:
            self.reset()
            raise ValueError("ISO-TP timestamps must not move backwards")
        if self.active and timestamp - self.last_timestamp > self.timeout_s:
            self.reset()
            raise TimeoutError("ISO-TP consecutive-frame reception timed out")

    def _padding(self, data: bytes) -> None:
        if self.padding_byte is not None and any(x != self.padding_byte for x in data):
            self.reset()
            raise ValueError("ISO-TP padding does not match the configured byte")

    def feed(self, frame: bytes | str | list, timestamp: float = 0.0) -> Optional[bytes]:
        self.check_timeout(timestamp)
        frame = _bytes(frame)
        if not 1 <= len(frame) <= 8:
            self.reset()
            raise ValueError("Classical CAN frame data length must be 1..8")
        kind = frame[0] >> 4
        if kind == 0:
            count = frame[0] & 0x0F
            self.reset()
            if count == 0 or count > 7 or count + 1 > len(frame):
                raise ValueError("Invalid single-frame payload length")
            self._padding(frame[count + 1:])
            return frame[1:count + 1]
        if kind == 1:
            self.reset()
            if len(frame) != 8:
                raise ValueError("A Classical CAN first frame must contain eight bytes")
            count = ((frame[0] & 0x0F) << 8) | frame[1]
            if count <= 7:
                raise ValueError("First frame length must be 8..4095 in this subset")
            self.expected_size = count
            self.buffer.extend(frame[2:])
            self.last_timestamp = timestamp
            return None
        if kind == 2:
            if not self.active:
                raise ValueError("Consecutive frame received without a first frame")
            if (frame[0] & 0x0F) != self.expected_sequence:
                self.reset()
                raise ValueError("ISO-TP consecutive-frame sequence mismatch")
            remaining = self.expected_size - len(self.buffer)
            needed = min(7, remaining)
            if len(frame) < needed + 1:
                self.reset()
                raise ValueError("Truncated consecutive-frame payload")
            self._padding(frame[needed + 1:])
            self.buffer.extend(frame[1:needed + 1])
            self.last_timestamp = timestamp
            self.expected_sequence = (self.expected_sequence + 1) & 0x0F
            if len(self.buffer) == self.expected_size:
                result = bytes(self.buffer)
                self.reset()
                return result
            return None
        self.reset()
        if kind == 3:
            raise ValueError("Flow-control frames belong to the sender, not this receiver")
        raise ValueError("Unsupported ISO-TP frame type")


def isotp_trace(payload: bytes, source_id: int, peer_id: int,
                direction: str, request: bool = False) -> list[dict]:
    """Produce a pedagogical transcript with an automatic FC for long payloads.

    The synthetic peer says Continue To Send, blocksize=0, STmin=0.
    No claim of wall-clock timing, bus arbitration, or sender timeout handling.
    """
    frames = segment_payload(payload)
    result = []
    for index, frame in enumerate(frames):
        kind = {0: "SF", 1: "FF", 2: "CF"}[frame[0] >> 4]
        label = {"SF": "Single frame", "FF": "First frame", "CF": "Consecutive frame"}[kind]
        result.append({
            "id": f"{source_id:03X}", "data": hex_bytes(frame),
            "direction": direction, "kind": kind,
            "label": f"{label} {'request' if request else 'response'}",
        })
        if index == 0 and len(frames) > 1:
            result.append({
                "id": f"{peer_id:03X}", "data": "30 00 00 00 00 00 00 00",
                "direction": "tester→ECU" if direction == "ECU→tester" else "ECU→tester",
                "kind": "FC", "label": "Automatic lesson flow control: CTS, BS=0, STmin=0",
            })
    return result


def _quantize(value: float, maximum: int = 255) -> int:
    if not math.isfinite(float(value)):
        raise ValueError("Diagnostic sensor value must be finite")
    return min(maximum, max(0, int(round(value))))


def _emissions_codes(snapshot: dict, key: str) -> list[str]:
    """Core supplies this dedicated emissions list, not arbitrary module faults."""
    codes = sorted(set(snapshot.get(key, [])))
    for code in codes:
        encode_dtc(code)
    return [code for code in codes if code != "P0000"][:255]


class DiagnosticServer:
    """One simulated ECU with J1979-style OBD and a small UDS teaching subset.

    ``clear_callback`` must actually clear the simulation's diagnostic memory.
    Without it, Mode 04 has no positive response, avoiding a false success.
    ECU power/ignition gating belongs to the embedding simulation. The local
    teaching ECU stays available with ignition off, but an open diagnostic CAN
    branch produces a simulated timeout. UDS is supported only at the selected
    physical address 0x7E0; 0x7DF remains the OBD functional request address.
    """

    def __init__(self, snapshot_fn: Callable[[], dict], clear_callback: Optional[Callable] = None):
        self.snapshot_fn = snapshot_fn
        self.clear_callback = clear_callback
        self.session = 0x01
        self._last_request_time = 0.0

    def session_state(self, snapshot: Optional[dict] = None) -> dict:
        """Evaluate the 5 s S3 teaching timer against simulation time only."""
        snapshot = self.snapshot_fn() if snapshot is None else snapshot
        now = float(snapshot.get("t", 0.0))
        if self.session != 0x01 and now - self._last_request_time >= 5.0:
            self.session = 0x01
        return {"id": self.session, "hex": f"{self.session:02X}",
                "label": "Extended diagnostic" if self.session == 0x03 else "Default",
                "s3_timeout_s": 5.0,
                "remaining_s": max(0.0, 5.0 - (now - self._last_request_time)) if self.session != 0x01 else None}

    def request(self, payload_hex: str, can_id: int = FUNCTIONAL_ID) -> dict:
        result = {"request_hex": payload_hex, "response_hex": None,
                  "meaning": "", "frames": [], "transport": "Classical CAN / normal ISO-TP (lesson trace)"}
        try:
            if not isinstance(can_id, int) or isinstance(can_id, bool) or not 0 <= can_id <= 0x7FF:
                raise ValueError("can_id must be an integer 11-bit CAN identifier")
            payload = _bytes(payload_hex)
            if not 1 <= len(payload) <= 7:
                raise ValueError("Enter 1..7 application bytes; omit CAN ID, length/PCI, and padding")
            result["request_hex"] = hex_bytes(payload)
            result["frames"] = isotp_trace(payload, can_id, ENGINE_RESPONSE_ID, "tester→ECU", request=True)
            snapshot = self.snapshot_fn()
            result["session"] = self.session_state(snapshot)
            if not snapshot.get("connections", {}).get("dlc", True):
                result.update(frames=[], timeout=True, status="timeout", delivery="not_delivered",
                              meaning="No response: diagnostic CAN branch is disconnected. The request did not reach the ECU. Vehicle control continues; reconnect the branch and try again. This is a simulated timeout, not a timed hardware transaction.")
                return result
            if can_id not in (FUNCTIONAL_ID, ENGINE_REQUEST_ID):
                result["meaning"] = "No response: this lab has no diagnostic ECU at that address."
                return result

            is_uds = payload[0] >= 0x10
            result["protocol"] = "UDS teaching subset" if is_uds else "OBD-II teaching subset"
            if is_uds and can_id != ENGINE_REQUEST_ID:
                result["meaning"] = "No response: UDS in this lab uses physical request ID 7E0. Functional 7DF is reserved for the implemented OBD lessons."
                return result
            if can_id == ENGINE_REQUEST_ID:
                self._last_request_time = float(snapshot.get("t", 0.0))
            response, meaning = self._uds_service(payload) if is_uds else self._service(payload, snapshot)
            result["meaning"] = meaning
            result["session"] = self.session_state(snapshot)
            if is_uds:
                result["positive_response_suppressed"] = response is None and len(payload) > 1 and bool(payload[1] & 0x80)
            if response is not None:
                result["response_hex"] = hex_bytes(response)
                # FC is sent to the responding ECU's PHYSICAL request address,
                # even when the original request was functional (0x7DF).
                result["frames"].extend(isotp_trace(response, ENGINE_RESPONSE_ID,
                                                     ENGINE_REQUEST_ID, "ECU→tester"))
        except (ValueError, TypeError, OverflowError) as exc:
            result["error"] = str(exc)
            result["meaning"] = "Invalid request or simulator data; no fabricated ECU response."
        return result

    def _uds_service(self, payload: bytes) -> tuple[Optional[bytes], str]:
        """Read-only identification, session control and TesterPresent.

        Service IDs and response structure follow ISO 14229 conventions. The
        chosen timing values and ECU identity are synthetic teaching values.
        References: AUTOSAR CP R23-11 DCM (S3 timer and UDS handling),
        https://udsoncan.readthedocs.io/en/latest/_modules/udsoncan/common/dids.html
        (F187 = manufacturer spare-part number; F190 = VIN).
        """
        sid = payload[0]
        def negative(code: int, meaning: str):
            return bytes([0x7F, sid, code]), f"UDS negative response: {meaning} (NRC {code:02X})."
        if sid == 0x10:
            if len(payload) != 2:
                return negative(0x13, "incorrect message length")
            requested = payload[1] & 0x7F
            if requested not in (0x01, 0x03):
                return negative(0x12, "session sub-function not supported by this lesson")
            self.session = requested
            if payload[1] & 0x80:
                return None, "UDS session changed; positive response intentionally suppressed by request bit 7."
            # P2ServerMax=50 ms; P2*ServerMax=5000 ms in 10 ms units.
            return bytes([0x50, requested, 0x00, 0x32, 0x01, 0xF4]), (
                f"UDS {'default' if requested == 1 else 'extended diagnostic'} session selected. "
                "Timing fields advertise lab values P2=50 ms and P2*=5000 ms; this lesson does not schedule transport timing. "
                "Extended session returns to default after 5 s of simulation time without a physical diagnostic request.")
        if sid == 0x22:
            if len(payload) != 3:
                return negative(0x13, "this lesson accepts one two-byte data identifier")
            did = int.from_bytes(payload[1:], "big")
            if did == 0xF190:
                return b"\x62\xF1\x90" + SYNTHETIC_VIN.encode("ascii"), (
                    f"UDS VIN identification: {SYNTHETIC_VIN}. Synthetic lab identity; ISO-TP carries the multi-frame reply.")
            if did == 0xF187:
                return b"\x62\xF1\x87" + SYNTHETIC_PART_NUMBER.encode("ascii"), (
                    f"UDS manufacturer spare-part number: {SYNTHETIC_PART_NUMBER}. A synthetic lab identifier, not an OEM part.")
            return negative(0x31, "data identifier outside this teaching subset")
        if sid == 0x3E:
            if len(payload) != 2:
                return negative(0x13, "incorrect message length")
            if payload[1] & 0x7F:
                return negative(0x12, "TesterPresent sub-function must be 00")
            if payload[1] & 0x80:
                return None, "UDS TesterPresent received; session timer refreshed, positive reply intentionally suppressed."
            return b"\x7E\x00", "UDS TesterPresent received. The 5 s session timer uses simulation time, not wall time."
        return negative(0x11, "service not implemented; this lab does not unlock, reprogram or control vehicle hardware")

    def _service(self, payload: bytes, snapshot: dict) -> tuple[Optional[bytes], str]:
        mode = payload[0]
        if mode == 0x01 and len(payload) == 2:
            pid = payload[1]
            data, label = self._pid(pid, snapshot)
            if data is not None:
                return bytes([0x41, pid]) + data, label
        elif mode in (0x03, 0x07) and len(payload) == 1:
            key = "dtcs" if mode == 3 else "pending_dtcs"
            codes = _emissions_codes(snapshot, key)
            # ISO 15765 CAN includes DTC count before the two-byte codes.
            response = bytes([mode + 0x40, len(codes)]) + b"".join(encode_dtc(c) for c in codes)
            state = "confirmed" if mode == 3 else "pending"
            return response, f"{len(codes)} {state} emissions DTC(s): {', '.join(codes) or 'none'}."
        elif mode == 0x04 and len(payload) == 1:
            if self.clear_callback is None:
                return None, "No response: diagnostic-memory clearing is not connected in this instance."
            self.clear_callback()
            return b"\x44", ("Simulated emissions diagnostic memory cleared. An active physical fault remains "
                              "and can be detected again. Real Mode 04 has broader reset semantics; "
                              "permanent DTCs and full readiness cycles are outside this lab.")
        elif mode == 0x09 and len(payload) == 2:
            if payload[1] == 0:
                return b"\x49\x00" + supported_mask(MODE_09_PIDS), "Supported Mode 09 PID: 02 (synthetic VIN)."
            if payload[1] == 2:
                return b"\x49\x02\x01" + SYNTHETIC_VIN.encode("ascii"), (
                    f"Synthetic 17-character VIN field: {SYNTHETIC_VIN}. "
                    "Not a registered vehicle identity. FF → FC → CF → CF demonstrates reassembly.")
        return None, ("No response: service, PID, or request shape is outside this educational subset. "
                      "Unsupported functional requests are silent; a UDS negative response is not invented.")

    def _pid(self, pid: int, s: dict) -> tuple[Optional[bytes], str]:
        sensors = s.get("sensors", {})
        if pid == 0:
            return supported_mask(MODE_01_PIDS), "Supported Mode 01 PIDs: 01, 04, 05, 0C, 0D, 0F, 10, 11."
        if pid == 1:
            codes = _emissions_codes(s, "dtcs")
            a = (0x80 if s.get("mil", False) else 0) | min(len(codes), 127)
            # B3 selects compression-ignition monitor interpretation. Only the
            # explicit diesel vehicle configuration sets it; legacy Sim keeps
            # its existing spark-ignition format. B2 is the sole supported
            # common monitor; B6 says that simplified monitor is incomplete.
            # PID $01 reference: https://www.dashlogic.com/docs/technical/obdii_pids
            diesel = s.get("vehicle", {}).get("configuration", {}).get("powertrain") == "diesel"
            complete = bool(s.get("components_monitor_complete", False))
            b = 0x04 | (0x08 if diesel else 0) | (0 if complete else 0x40)
            return bytes([a, b, 0, 0]), (
                "MIL and confirmed DTC count; only a simplified comprehensive-component monitor "
                f"is advertised ({'complete' if complete else 'incomplete'}). "
                + ("Compression-ignition format selected. Diesel aftertreatment, boost, exhaust-gas, particulate-filter, misfire and fuel-system readiness monitors are not implemented."
                   if diesel else "Catalyst, O2, EVAP, misfire, and fuel-system monitors are not implemented."))
        if pid == 4:
            value = float(s.get("load_pct", 0))
            return bytes([_quantize(value * 255 / 100)]), f"Toy calculated engine load: {value:.1f}% (A × 100/255)."
        if pid == 5:
            value = float(sensors.get("ect_c", s.get("coolant_c", 20)))
            return bytes([_quantize(value + 40)]), (
                f"Reported coolant sensor: {value:.1f} °C (A − 40). "
                "An open-circuit lesson returns −40 °C, distinct from true coolant and ECU fallback.")
        if pid == 0x0C:
            value = float(s.get("rpm", 0))
            raw = _quantize(value * 4, 65535)
            return raw.to_bytes(2, "big"), f"Engine speed: {raw / 4:.2f} rpm ((256A+B)/4)."
        if pid == 0x0D:
            value = _quantize(float(s.get("speed_kph", 0)))
            return bytes([value]), f"Vehicle speed: {value} km/h (A); 1 km/h resolution."
        if pid == 0x0F:
            value = float(sensors.get("iat_c", s.get("ambient_c", 20)))
            return bytes([_quantize(value + 40)]), f"Intake-air temperature: {value:.1f} °C (A − 40); ambient proxy in this model."
        if pid == 0x10:
            value = _quantize(float(s.get("maf_g_s", 0)) * 100, 65535)
            return value.to_bytes(2, "big"), f"Mass air flow: {value / 100:.2f} g/s ((256A+B)/100)."
        if pid == 0x11:
            value = float(s.get("throttle_pct", 0))
            return bytes([_quantize(value * 255 / 100)]), f"Throttle position: {value:.1f}% (A × 100/255)."
        return None, "Unsupported PID"
