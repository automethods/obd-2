"""Local dashboard API. Only binds to loopback; no third-party services required."""
from __future__ import annotations

import json
import mimetypes
import threading
from copy import deepcopy
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from . import __version__
from .core import Sim, SCENARIOS
from .runner import diagnostic_server, csv_text, bundle, trace_text
from .instrumentation import signal_catalog, read_signals, value_at
from .book import read_book
from .explanations import explain, fault_catalog, explain_diagnostic
from .network import network_catalog, observe_network
from .diagnostic_definitions import diagnostic_definitions
from .vehicle import VehicleSim, VEHICLE_CONFIGURATIONS
from .vehicle_systems import (SensorBank, vehicle_system_catalog, build_network_catalog,
                              observe_vehicle_network, signal_catalog_for_vehicle, read_vehicle_signals)
from .scanner import ScannerSession
from .drive_cycles import DriveCycleRunner, drive_cycle_catalog, cycle_trace
from .article_experiment import run_matrix

ROOT = Path(__file__).resolve().parents[1]
ALLOWED_INPUTS = {"ignition", "throttle", "brake", "clutch", "steer_deg", "road_mu", "grade_pct", "fault", "abs_enabled", "esp_enabled"}
ALLOWED_CONFIG = {"initial_soc_pct", "initial_speed_kph", "initial_coolant_c", "ambient_c", "initial_battery_temp_c", "mass_kg", "capacity_ah", "battery_r_ohm", "reference_voltage_v", "ect_pullup_ohm", "ect_r25_ohm", "ect_beta_k", "ect_adc_bits"}
CYCLE_SIGNALS = [
    {"id": "drive_target_kph", "label": "WLTC target speed", "unit": "km/h", "limits": [0, 140], "kind": "analog"},
    {"id": "drive_cycle.tracking_error_kph", "label": "WLTC target minus actual speed", "unit": "km/h", "limits": [-15, 15], "kind": "analog"},
    {"id": "drive_cycle.elapsed_s", "label": "WLTC elapsed time", "unit": "s", "limits": [0, 1800], "kind": "analog"},
]
for item in CYCLE_SIGNALS:
    item["range"] = item.pop("limits")
    item.update(group="Drive cycle", source="Official target / virtual driver", period_ms=50, unit_id="supervisor", component_id="supervisor",
                provenance="Official WLTC Class 3b target trace with a generic virtual vehicle; not a certified WLTP test.", installed=True)


class Lab:
    def __init__(self):
        self.lock = threading.RLock()
        self.reset("engine", "engine_warmup", {})

    def reset(self, profile, scenario, config):
        self.sim = Sim(profile=profile, scenario=scenario, config=config)
        self.diag = diagnostic_server(self.sim)
        self.scanner = None
        self.cycle = None
        self.trace = []

    def set_vehicle(self, configuration="petrol_basic", options=None, initial_inputs=None):
        sim = VehicleSim(configuration=configuration, options=options or {})
        if initial_inputs is not None:
            if not isinstance(initial_inputs, dict) or set(initial_inputs) - {"road_mu", "grade_pct"}:
                raise ValueError("Initial test conditions may contain only road_mu and grade_pct.")
            # Validate on the candidate before replacing the current session.
            sim.advance(0, initial_inputs)
        bank = SensorBank(sim.configuration)
        sim.sensor_bank = bank
        bank.sample(sim.raw_snapshot(), 0)
        sim.history[:] = [sim.snapshot()]
        diag = diagnostic_server(sim)
        scanner = ScannerSession(sim, diag)
        self.sim = sim
        self.diag = diag
        self.scanner = scanner
        self.cycle = None
        self.trace = []

    def meta(self):
        return {"version": __version__, "scenarios": SCENARIOS,
                "profiles": ["engine", "phev", "braking"],
                "plant_step_s": 0.002, "history_period_s": 0.1,
                "signals": self.signal_catalog(), "faults": fault_catalog(),
                "vehicle_configurations": VEHICLE_CONFIGURATIONS, "drive_cycles": drive_cycle_catalog()}

    def systems(self):
        return vehicle_system_catalog(self.sim.configuration) if isinstance(self.sim, VehicleSim) else {"units": [], "sensors": [], "groups": []}

    def scanner_resources(self):
        return {"catalog": self.scanner.catalog(), "state": self.scanner.state()} if self.scanner else {"catalog": {"protocols": [], "modules": []}, "state": None}

    def resources(self):
        """Configuration-dependent UI data, also served by the individual GET routes."""
        return {"meta": self.meta(), "catalog": self.catalog(), "definitions": self.definitions(),
                "systems": self.systems(), "scanner": self.scanner_resources()}

    def snapshot(self):
        return self.cycle.snapshot() if self.cycle else self.sim.snapshot()

    def advance(self, seconds, inputs=None):
        if self.cycle and self.cycle.status in ("preparing", "active", "complete", "fault"):
            checked = self.sim._validate_inputs(inputs or {})
            if checked.get("ignition") is False:
                # The legacy input route is also an explicit emergency power
                # off. Relinquish automatic ownership before applying it.
                self.cycle.stop()
        return self.cycle.advance(seconds, inputs) if self.cycle else self.sim.advance(seconds, inputs)

    def catalog(self):
        base = network_catalog()
        return build_network_catalog(self.sim.configuration, base) if isinstance(self.sim, VehicleSim) else base

    def signal_catalog(self):
        base = signal_catalog()
        if isinstance(self.sim, VehicleSim):
            extra = signal_catalog_for_vehicle(self.sim.configuration)
            existing = {s["id"] for s in base}
            base += [s for s in extra if s["id"] not in existing]
            for signal in base:
                signal["installed"] = self.signal_installed(signal)
            base += deepcopy(CYCLE_SIGNALS)
        return base

    def signal_installed(self, signal):
        if not isinstance(self.sim, VehicleSim):
            return True
        config = self.sim.configuration
        identifier, group = signal["id"], signal.get("group")
        installed = signal.get("installed", True)
        if group in ("Battery", "Network", "Hybrid") or identifier == "contactor":
            installed &= self.sim.has_hv
        if group in ("Engine", "ECT", "ECT circuit") or identifier == "mil":
            installed &= self.sim.has_engine
        if identifier == "abs_active" or identifier.startswith(("sensors.wheel_speeds_kph.", "brake_pressure.")):
            installed &= config["abs_installed"]
        if identifier in ("esp_active", "yaw_target_deg_s"):
            installed &= config["esp_installed"]
        return bool(installed)

    def signals(self, snapshot):
        result = read_signals(snapshot)
        if isinstance(self.sim, VehicleSim):
            result.update(read_vehicle_signals(snapshot, self.sim.configuration))
            for record in result.values():
                record["installed"] = self.signal_installed(record)
                if not record["installed"]:
                    record.update(value=None, validity="unavailable", validity_note="Not installed in this vehicle configuration.")
            for metadata in CYCLE_SIGNALS:
                value = value_at(snapshot, metadata["id"])
                result[metadata["id"]] = {**metadata, "value": value, "validity": "valid" if value is not None else "unavailable",
                                           "validity_note": "Recorded target / tracking value from the active cycle." if value is not None else "Start the WLTC cycle in Drive to record this channel."}
        return result

    def definitions(self):
        snapshot = self.sim.snapshot()
        result = diagnostic_definitions(snapshot)
        if not isinstance(self.sim, VehicleSim):
            return result
        installed = {"ecu": self.sim.has_engine, "bmu": self.sim.has_hv,
                     "phev_ecu": self.sim.has_hv, "abs_esp": self.sim.configuration["abs_installed"]}
        state = self.scanner.state()
        for module in result["modules"]:
            module["installed_now"] = installed.get(module["id"], False)
            available = module["id"] == "ecu" and module["installed_now"] and state["module_id"] == "ecu" and state["status"] == "ready"
            module["available_now"] = available
            module["availability_note"] = (
                "Not installed in this vehicle configuration." if not module["installed_now"] else
                "Simulation-state inspection only; no OEM byte-addressed endpoint is implemented." if module["availability"] == "state_only" else
                "Choose the engine ECU in the connected scan tool." if state["module_id"] != "ecu" else state["reason"])
        ecu = next(m for m in result["modules"] if m["id"] == "ecu")
        for service in result["services"]:
            service["available_now"] = ecu["available_now"]
            service["availability_note"] = ecu["availability_note"]
        result["runtime"].update(configuration_id=self.sim.configuration["id"], scanner=state)
        return result

    def control(self, action, value, inputs):
        if self.cycle and self.cycle.status in ("preparing", "active", "complete", "fault"):
            if action == "stop" or (action == "ignition" and value is False):
                self.cycle.stop()
            elif action not in ("hvac", "seatbelt", "driver_door", "reset_trip"):
                raise ValueError("The WLTC virtual driver owns the pedals and gears. Choose Take over before driving manually.")
            else:
                inputs = {key: val for key, val in inputs.items() if key not in ("throttle", "brake", "clutch", "steer_deg")}
        # A rejected cockpit command must not secretly apply its staged pedals
        # or compatibility switches. No time or history changes in advance(0).
        names = ("inputs", "_overrides", "ignition_on", "start_requested", "abs_enabled", "esp_enabled",
                 "driver_seatbelt_fastened", "driver_door_open", "_trip_start_distance_m",
                 "_engine_wanted", "_engine_running", "_bmu_fault", "_network_fault", "contactor", "mode")
        before = {name: deepcopy(getattr(self.sim, name)) for name in names}
        events = list(self.sim.events)
        try:
            self.sim.advance(0, inputs)
            self.sim.control(action, value)
        except (ValueError, TypeError, KeyError):
            for name, saved in before.items():
                setattr(self.sim, name, saved)
            self.sim.events[:] = events
            raise

    def request(self, payload, can_id=None):
        response = self.scanner.request(payload, can_id=can_id) if self.scanner else self.diag.request(payload, can_id=can_id or 0x7DF)
        self.trace.append(response)
        self.trace[:] = self.trace[-500:]
        return response

    def state(self, history=None):
        snapshot = self.snapshot()
        network = observe_network(snapshot)
        if isinstance(self.sim, VehicleSim):
            network = observe_vehicle_network(snapshot, self.catalog(), network)
        return {"state": snapshot, "signals": self.signals(snapshot), "network": network,
                "scanner": self.scanner.state() if self.scanner else None,
                "diagnostic_session": self.diag.session_state(snapshot), "explanation": explain(snapshot), "events": self.sim.events[-15:],
                "history": list(self.sim.history if history is None else history)}


def create_server(port=8765):
    lab = Lab()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def send_bytes(self, data, mime="application/json", status=200, filename=None):
            self.send_response(status)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            if filename:
                self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
            self.end_headers()
            self.wfile.write(data)

        def send_json(self, obj, status=200):
            self.send_bytes(json.dumps(obj, allow_nan=False).encode(), "application/json; charset=utf-8", status)

        def do_GET(self):
            path = urlparse(self.path).path
            with lab.lock:
                if path == "/api/meta":
                    self.send_json(lab.meta())
                    return
                if path == "/api/book":
                    self.send_json(read_book(ROOT / "docs"))
                    return
                if path == "/api/network":
                    self.send_json(lab.catalog())
                    return
                if path == "/api/systems":
                    self.send_json(lab.systems())
                    return
                if path == "/api/scanner":
                    self.send_json(lab.scanner_resources())
                    return
                if path == "/api/diagnostic-definitions":
                    self.send_json(lab.definitions())
                    return
                if path == "/api/signals":
                    self.send_json({"catalog": lab.signal_catalog(), "signals": lab.signals(lab.snapshot())})
                    return
                if path == "/api/state":
                    self.send_json(lab.state())
                    return
                if path == "/api/cycles":
                    self.send_json({"catalog": drive_cycle_catalog(), "trace": cycle_trace(), "state": lab.cycle.state() if lab.cycle else None})
                    return
                if path == "/api/export.csv":
                    self.send_bytes(csv_text(lab.sim.history).encode(), "text/csv", filename="obdii_run.csv")
                    return
                if path == "/api/export.json":
                    report = bundle(lab.sim, lab.trace)
                    report["final_state"] = lab.snapshot()
                    if lab.cycle:
                        report["drive_cycle"] = lab.cycle.state()
                        report["drive_cycle_reference"] = drive_cycle_catalog()[0]
                    self.send_bytes(json.dumps(report, indent=2, allow_nan=False).encode(), "application/json", filename="obdii_run.json")
                    return
                if path == "/api/trace.txt":
                    self.send_bytes(trace_text(lab.trace).encode(), "text/plain; charset=utf-8", filename="diagnostic_trace.txt")
                    return
            if path == "/":
                file = ROOT / "web" / "index.html"
            elif path in ("/START_HERE.html", "/OBDII_Learning_Guide.pdf", "/OBDII_Beginner_Handbook.pdf", "/OBDII_Visual_Workbench.pdf"):
                file = ROOT / path.lstrip("/")
            elif path.startswith("/web/") or path.startswith("/docs/"):
                file = (ROOT / path.lstrip("/")).resolve()
                if ROOT not in file.parents:
                    self.send_json({"error": "Not found"}, 404)
                    return
            else:
                self.send_json({"error": "Not found"}, 404)
                return
            if not file.is_file():
                self.send_json({"error": "Not found"}, 404)
                return
            mime = mimetypes.guess_type(file.name)[0] or "application/octet-stream"
            self.send_bytes(file.read_bytes(), mime)

        def do_POST(self):
            try:
                # The server is a local teaching instrument, not a shared multi-user service.
                origin = self.headers.get("Origin")
                if origin and origin not in (f"http://localhost:{self.server.server_port}", f"http://127.0.0.1:{self.server.server_port}"):
                    raise ValueError("Use the dashboard from this local server.")
                size = int(self.headers.get("Content-Length", "0"))
                if not 0 < size <= 16384:
                    raise ValueError("Expected a small JSON request body.")
                obj = json.loads(self.rfile.read(size))
                if not isinstance(obj, dict):
                    raise ValueError("Expected a JSON object.")
                path = urlparse(self.path).path
                if path == "/api/article-experiment":
                    if obj:
                        raise ValueError("The article experiment uses fixed conditions; send an empty object.")
                    # Independent vehicles: this experiment never replaces the user's session.
                    self.send_json(run_matrix())
                    return
                with lab.lock:
                    if path == "/api/vehicle":
                        options = obj.get("options", {})
                        if not isinstance(options, dict):
                            raise ValueError("Vehicle options must be an object.")
                        # Prepare the entire response on a detached Lab. A validation,
                        # resource-building or JSON error must not replace the live run.
                        candidate = Lab.__new__(Lab)
                        candidate.set_vehicle(obj.get("configuration", "petrol_basic"), options, obj.get("initial_inputs"))
                        response = {**candidate.state(), "resources": candidate.resources()}
                        data = json.dumps(response, allow_nan=False).encode()
                        lab.sim, lab.diag, lab.scanner, lab.cycle, lab.trace = (
                            candidate.sim, candidate.diag, candidate.scanner, candidate.cycle, candidate.trace)
                        self.send_bytes(data, "application/json; charset=utf-8")
                    elif path == "/api/control":
                        if not isinstance(lab.sim, VehicleSim):
                            raise ValueError("Choose a configured vehicle before using cockpit controls.")
                        inputs = obj.get("inputs", {})
                        if not isinstance(inputs, dict) or set(inputs) - ALLOWED_INPUTS:
                            raise ValueError("Unsupported driver input.")
                        lab.control(obj.get("action"), obj.get("value"), inputs)
                        self.send_json(lab.state([]))
                    elif path == "/api/inputs":
                        inputs = obj.get("inputs", {})
                        if not isinstance(inputs, dict) or set(inputs) - ALLOWED_INPUTS:
                            raise ValueError("Unsupported driver input.")
                        lab.advance(0, inputs)
                        self.send_json(lab.state([]))
                    elif path == "/api/cycle":
                        if not isinstance(lab.sim, VehicleSim):
                            raise ValueError("Choose a configured vehicle before starting a drive cycle.")
                        action = obj.get("action")
                        if action == "start":
                            if lab.cycle is None or lab.cycle.name != obj.get("name", "wltc_class3b") or lab.cycle.status in ("stopped", "complete", "fault"):
                                lab.cycle = DriveCycleRunner(lab.sim, obj.get("name", "wltc_class3b"))
                            lab.cycle.start()
                        elif action == "stop":
                            if lab.cycle:
                                lab.cycle.stop()
                        else:
                            raise ValueError("Choose start or stop for the drive cycle.")
                        self.send_json(lab.state([]))
                    elif path == "/api/scanner":
                        if lab.scanner is None:
                            raise ValueError("Choose a configured vehicle before connecting the scan tool.")
                        action = obj.get("action")
                        report = None
                        unit_report = None
                        readings = None
                        if action == "connect":
                            lab.scanner.connect(obj.get("protocol", "can11_500"), obj.get("module", "ecu"))
                            unit_report = lab.scanner.scan(lab.scanner.module_id)
                        elif action == "disconnect":
                            lab.scanner.disconnect()
                        elif action == "scan":
                            report = lab.scanner.discover(obj["protocol"]) if "protocol" in obj else lab.scanner.scan()
                            lab.trace.extend(report.get("diagnostics", []))
                            lab.trace[:] = lab.trace[-500:]
                        elif action == "faults":
                            unit_report = lab.scanner.scan(lab.scanner.module_id)
                        elif action == "read":
                            payloads = obj.get("payloads")
                            allowed = {s["request_hex"] for s in lab.definitions()["services"]
                                       if s.get("decode", {}).get("kind") == "linear"}
                            if (not isinstance(payloads, list) or not 1 <= len(payloads) <= len(allowed)
                                    or any(not isinstance(p, str) or p not in allowed for p in payloads)):
                                raise ValueError("Choose supported live-data parameters.")
                            readings = [lab.request(p, can_id=0x7E0) for p in dict.fromkeys(payloads)]
                        else:
                            raise ValueError("Choose connect, disconnect, scan, faults or read.")
                        if unit_report:
                            lab.trace.extend(unit_report.get("diagnostics", []))
                            lab.trace[:] = lab.trace[-500:]
                        self.send_json({**lab.state([]), "scan_report": report, "unit_report": unit_report, "readings": readings})
                    elif path == "/api/reset":
                        config = obj.get("config", {})
                        if not isinstance(config, dict) or set(config) - ALLOWED_CONFIG:
                            raise ValueError("Unsupported config field.")
                        lab.reset(obj.get("profile", "engine"), obj.get("scenario", "manual"), config)
                        self.send_json(lab.state())
                    elif path == "/api/advance":
                        supplied_seconds = obj.get("seconds", 0.2)
                        if isinstance(supplied_seconds, bool):
                            raise ValueError("Advance seconds must be a number.")
                        seconds = float(supplied_seconds)
                        if not 0 < seconds <= 5:
                            raise ValueError("Advance must be greater than 0 and at most 5 seconds.")
                        inputs = obj.get("inputs", {})
                        if not isinstance(inputs, dict) or set(inputs) - ALLOWED_INPUTS:
                            raise ValueError("Unsupported input field.")
                        before = lab.sim.snapshot()["t"]
                        lab.advance(seconds, inputs)
                        recent = [p for p in lab.sim.history if p["t"] > before]
                        self.send_json(lab.state(recent))
                    elif path == "/api/connection":
                        lab.sim.set_connection(obj.get("id"), obj.get("connected"))
                        self.send_json(lab.state([]))
                    elif path == "/api/connection-fault":
                        if not isinstance(lab.sim, VehicleSim):
                            raise ValueError("Choose a configured vehicle before testing an intermittent sensor connection.")
                        allowed = {"id", "mode", "pattern", "connected_s", "dropout_s"}
                        if set(obj) - allowed:
                            raise ValueError("Unsupported intermittent connection setting.")
                        lab.sim.set_connection_fault(
                            obj.get("id"), mode=obj.get("mode", "intermittent"),
                            pattern=obj.get("pattern", "regular"),
                            connected_s=obj.get("connected_s", 3.0),
                            dropout_s=obj.get("dropout_s", 1.0))
                        self.send_json(lab.state([]))
                    elif path == "/api/diagnostic":
                        can_id = int(str(obj["can_id"]), 16) if "can_id" in obj else None
                        response = lab.request(str(obj.get("payload", "01 0C")), can_id=can_id)
                        self.send_json({"diagnostic": response,
                                        "diagnostic_explanation": explain_diagnostic(response, lab.sim.snapshot()),
                                        **lab.state([])})
                    else:
                        self.send_json({"error": "Not found"}, 404)
            except (ValueError, TypeError, KeyError) as exc:
                self.send_json({"error": str(exc)}, 400)

    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    server.lab = lab
    server.daemon_threads = True
    return server


def serve(port=8765):
    server = create_server(port)
    print(f"OBD II Lab v{__version__}", flush=True)
    print(f"Open http://127.0.0.1:{server.server_port} in your browser.", flush=True)
    print("Offline teaching models. Press Ctrl+C to stop.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nLab stopped.")
    finally:
        server.server_close()
