"""Typed teaching harness joining physical components, connectors and probes.

The catalog is an editable graph, independent of its SVG/Three.js presentation.
It is not an OEM wiring diagram. CAN is represented by delivered application
messages, not a solved electrical bus, arbitration schedule or bit waveform.
"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from copy import deepcopy
from typing import Any
import math

from .instrumentation import value_at

ALL_PROFILES = ("engine", "phev", "braking")
VEHICLE_PROFILES = ("phev", "braking")


@dataclass(frozen=True)
class Pin:
    number: int
    label: str
    role: str
    unit: str = ""
    description: str = "Teaching connector assignment, not a vehicle service pinout."


@dataclass(frozen=True)
class Component:
    id: str
    label: str
    kind: str
    description: str
    position: tuple[float, float, float]
    socket_ids: tuple[str, ...] = ()
    profiles: tuple[str, ...] = ALL_PROFILES
    properties: dict[str, Any] = field(default_factory=dict)
    bindings: dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class Socket:
    id: str
    component_id: str
    label: str
    pins: tuple[Pin, ...]
    connection_id: str | None = None
    description: str = "Illustrative lab socket. Pin numbers apply only to this model."
    properties: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class Wire:
    id: str
    label: str
    kind: str
    from_socket: str
    from_pin: int
    to_socket: str
    to_pin: int
    signal_id: str
    unit: str
    color: str
    connection_id: str | None = None
    description: str = ""
    properties: dict[str, Any] = field(default_factory=dict)

    def serializable(self) -> dict:
        data = asdict(self)
        data["from"] = {"socket_id": data.pop("from_socket"), "pin": data.pop("from_pin")}
        data["to"] = {"socket_id": data.pop("to_socket"), "pin": data.pop("to_pin")}
        data["state_path"] = self.signal_id
        return data


COMPONENTS = (
    Component("engine", "Engine plant", "plant", "Mechanical speed and heat are physical model states; sensors report them separately.", (0, .86, -1.24),
              properties={"model": "Generic four-stroke teaching engine", "plant_period_ms": 2}, bindings={"rotation": "rpm", "temperature": "coolant_c"}),
    Component("ecu", "Engine ECU", "controller", "Samples the coolant circuit, applies a fallback and serves the lab diagnostic requests.", (.63, 1.08, -1.25), ("ecu_socket",),
              properties={"period_ms": 10, "request_can_id": "7E0", "response_can_id": "7E8", "reference_voltage_v": 5.0}, bindings={"state": "module_status.ECU", "warning": "mil"}),
    Component("coolant_sensor", "Coolant temperature sensor", "sensor", "A two-wire NTC thermistor with a pull-up resistor inside the ECU.", (-.46, 1.04, -1.25), ("coolant_socket",),
              properties={"type": "NTC thermistor", "r25_ohm": 2500, "beta_k": 3500, "pullup_ohm": 2200, "adc_bits": 12, "values": "Editable teaching assumptions"},
              bindings={"temperature": "coolant_c", "voltage": "sensors.ect_voltage_v", "valid": "sensors.ect_sensor_valid"}),
    Component("dlc", "DLC · diagnostic socket", "connector", "The 16-pin SAE J1962 connector is the physical access point; it is not itself CAN or OBD software.", (-.67, 1.05, -.13), ("dlc_socket",),
              properties={"pin_count": 16, "connector": "SAE J1962-style", "view": "Looking into the vehicle socket; verify orientation on real hardware", "supply": "Nominal 12 V low-voltage system, separate from the traction battery"}),
    Component("scan_tool", "Scan tool", "tester", "Builds OBD or UDS requests; the CAN and ISO-TP layers carry their bytes.", (-2.1, .85, -.3), ("scan_socket",),
              properties={"obd_functional_id": "7DF", "physical_request_id": "7E0", "transport": "Classical CAN / normal-addressing ISO-TP lesson trace"}),
    Component("battery", "Traction battery plant", "plant", "A synthetic high-voltage battery plant. This is not the 12 V supply on DLC pin 16.", (0, .58, .65), (), VEHICLE_PROFILES,
              {"capacity_ah": 50.0, "nominal_model_voltage_v": 375.0, "model": "Open-circuit voltage plus series resistance"}, {"charge": "soc_pct", "power": "battery_power_kw"}),
    Component("bmu", "Battery monitor · BMU", "controller", "Publishes synthetic battery status every 100 ms; disconnection leaves the last report stale.", (.72, .88, .65), ("bmu_socket",), VEHICLE_PROFILES,
              {"period_ms": 100, "timeout_ms": 300, "messages": "Scheduled in memory, not physical CAN arbitration"}, {"state": "module_status.BMU", "freshness": "sensors.bmu_message_age_ms"}),
    Component("supervisor", "Hybrid supervisor", "controller", "Checks message freshness and grants traction only when the battery system is ready.", (.36, 1.05, -.55), ("supervisor_socket",), VEHICLE_PROFILES,
              {"period_ms": 20, "timeout_recovery": "Reconnect, then cycle ignition or Reset; shutdown is latched"}, {"state": "mode"}),
    Component("abs", "Brake controller · ABS", "controller", "Uses measured wheel speeds to modulate pressure. A lost front-left signal disables ABS and yaw assist in this lab.", (-.7, .9, -.68), ("abs_socket",), VEHICLE_PROFILES,
              {"period_ms": 10, "model": "Longitudinal braking and simplified yaw assist"}, {"state": "module_status.ABS_ESP", "active": "abs_active"}),
) + tuple(
    Component(f"wheel_{corner}", f"{label} wheel & sensor", "plant_sensor", "The wheel rotates physically even when its measured speed is unavailable.", position, (f"wheel_{corner}_socket",), VEHICLE_PROFILES,
              {"radius_m": .31, "encoder_teeth": 48, "encoder_model": "Derived frequency illustration; electrical sensor waveform is not solved"},
              {"rotation": f"wheel_speeds_kph.{i}", "measurement": f"sensors.wheel_speeds_kph.{i}"})
    for i, (corner, label, position) in enumerate((
        ("fl", "Front-left", (-1.04, .45, -1.4)), ("fr", "Front-right", (1.04, .45, -1.4)),
        ("rl", "Rear-left", (-1.04, .45, 1.4)), ("rr", "Rear-right", (1.04, .45, 1.4))))
)

DLC_ROLES = {
    2: ("J1850 bus +", "legacy", "Used by the legacy J1850 family where equipped; explanation only."),
    4: ("Chassis ground", "ground", "Vehicle chassis ground reference."),
    5: ("Signal ground", "ground", "Signal ground reference; distinct assigned pin from chassis ground."),
    6: ("CAN-H", "can", "CAN high line for ISO 15765 diagnostics on CAN."),
    7: ("K-line", "legacy", "ISO 9141-2 / ISO 14230 communication where equipped; explanation only."),
    10: ("J1850 bus −", "legacy", "Complementary line used for J1850 PWM where equipped; explanation only."),
    14: ("CAN-L", "can", "CAN low line for ISO 15765 diagnostics on CAN."),
    15: ("L-line (optional)", "legacy", "Optional legacy initialization line where equipped; explanation only."),
    16: ("Battery supply", "power", "Low-voltage battery supply; this model illustrates a nominal 12 V system."),
}
DLC_PINS = tuple(Pin(i, *DLC_ROLES[i][:2], "V" if i in (4, 5, 6, 14, 16) else "", DLC_ROLES[i][2])
                 if i in DLC_ROLES else Pin(i, "Vehicle-specific", "unassigned", "", "No assignment in this lesson; real vehicle wiring must be checked against its service information.")
                 for i in range(1, 17))
SOCKETS = (
    Socket("ecu_socket", "ecu", "Engine ECU socket · X1", (Pin(1, "Internal reference", "reference", "V"), Pin(2, "ECT input", "analog", "V"), Pin(3, "Sensor return", "ground", "V"), Pin(4, "CAN-H", "can"), Pin(5, "CAN-L", "can")), description="X1.1 is an internal reference test point, not an assertion that a real ECU exposes a 5 V supply at cavity 1. Teaching assignments align with the existing instrument view."),
    Socket("coolant_socket", "coolant_sensor", "Coolant sensor · J-ECT", (Pin(1, "Signal / NTC", "analog", "V"), Pin(2, "NTC return", "ground", "V")), "ect"),
    Socket("dlc_socket", "dlc", "DLC · 16 pins", DLC_PINS, "dlc",
           "SAE J1962-style teaching layout. The disconnection switch isolates only the diagnostic CAN branch; supply and ground reference pins stay present.",
           {"front_view": True, "top_row": list(range(1, 9)), "bottom_row": list(range(9, 17))}),
    Socket("scan_socket", "scan_tool", "Tester plug", (Pin(4, "Ground", "ground", "V"), Pin(6, "CAN-H", "can"), Pin(14, "CAN-L", "can"), Pin(16, "Supply", "power", "V")), "dlc"),
    Socket("bmu_socket", "bmu", "BMU communication socket", (Pin(1, "CAN-H", "can"), Pin(2, "CAN-L", "can")), "bmu"),
    Socket("supervisor_socket", "supervisor", "Supervisor communication socket", (Pin(1, "CAN-H", "can"), Pin(2, "CAN-L", "can"))),
    Socket("abs_socket", "abs", "Brake ECU sensor socket", tuple(Pin(i + 1, label + " speed input", "pulse", "km/h") for i, label in enumerate(("FL", "FR", "RL", "RR")))),
) + tuple(Socket(f"wheel_{corner}_socket", f"wheel_{corner}", label + " wheel sensor", (Pin(1, "Speed signal", "pulse", "km/h"), Pin(2, "Return", "ground", "V")), "wheel_fl" if corner == "fl" else None)
          for corner, label in (("fl", "Front-left"), ("fr", "Front-right"), ("rl", "Rear-left"), ("rr", "Rear-right")))

CAN_PROPERTIES = {"bitrate_reference_bps": 500000, "differential_pair": True,
                  "recessive_reference_v": 2.5, "can_h_dominant_reference_v": 3.5, "can_l_dominant_reference_v": 1.5,
                  "provenance": "Illustrative high-speed CAN voltage levels; physical voltages and bit timing are not simulated.",
                  "gauge_mm2": .35, "resistance_model": "Ideal connected / open; gauge and length are descriptive only"}
WIRES = (
    Wire("ect_signal", "Coolant signal", "analog", "coolant_socket", 1, "ecu_socket", 2,
         "sensors.ect_voltage_v", "V", "#f3bb55", "ect", "Sampled voltage at the ECU input. An open NTC branch pulls it toward the reference supply.",
         {"nominal_reference_v": 5.0, "gauge_mm2": .35, "length_m": .6, "resistance_model": "Ideal connected / open; no harness voltage drop solved"}),
    Wire("ect_return", "Coolant return", "ground", "coolant_socket", 2, "ecu_socket", 3,
         "sensors.sensor_return_v", "V", "#a6adbb", "ect", "ECU sensor-ground reference. A zero reference reading alone does not prove connector continuity.",
         {"nominal_voltage_v": 0.0, "gauge_mm2": .35, "length_m": .6, "resistance_model": "Ideal return; descriptive harness properties"}),
    Wire("dlc_can_h", "Diagnostic CAN-H", "can", "dlc_socket", 6, "ecu_socket", 4, "rpm", "rpm", "#44cbb6", "dlc",
         "Application-data probe: engine rpm available through diagnostics. The scope is not a physical CAN-H voltage waveform.", {**CAN_PROPERTIES, "pair_id": "diagnostic_can", "length_m": 1.5}),
    Wire("dlc_can_l", "Diagnostic CAN-L", "can", "dlc_socket", 14, "ecu_socket", 5, "rpm", "rpm", "#6ca9ff", "dlc",
         "Companion to CAN-H. The displayed rpm probe belongs to the application payload, not the voltage on CAN-L.", {**CAN_PROPERTIES, "pair_id": "diagnostic_can", "length_m": 1.5}),
    Wire("dlc_power", "Tester low-voltage supply", "power", "dlc_socket", 16, "scan_socket", 16, "", "V", "#ee7c73", None,
         "Nominal 12.6 V reference for the separate low-voltage supply; no low-voltage battery plant is simulated.", {"nominal_voltage_v": 12.6, "value_kind": "reference", "gauge_mm2": .75}),
    Wire("dlc_ground", "Tester ground", "ground", "dlc_socket", 4, "scan_socket", 4, "", "V", "#a6adbb", None,
         "Ideal 0 V ground reference. This experiment switches the diagnostic CAN branch only.", {"nominal_voltage_v": 0.0, "value_kind": "reference", "gauge_mm2": .75}),
    Wire("bmu_can_h", "BMU CAN-H", "can", "bmu_socket", 1, "supervisor_socket", 1, "sensors.bmu_message_age_ms", "ms", "#a99af4", "bmu",
         "Application-message freshness probe. Age increases when BMU messages stop; this is not a physical voltage waveform.", {**CAN_PROPERTIES, "pair_id": "bmu_can", "length_m": 2.5, "publication_period_ms": 100}),
    Wire("bmu_can_l", "BMU CAN-L", "can", "bmu_socket", 2, "supervisor_socket", 2, "sensors.bmu_message_age_ms", "ms", "#c0b5ff", "bmu",
         "Companion CAN conductor with the same logical message-age probe.", {**CAN_PROPERTIES, "pair_id": "bmu_can", "length_m": 2.5, "publication_period_ms": 100}),
) + tuple(Wire(f"wheel_{corner}_signal", label + " wheel signal", "pulse", f"wheel_{corner}_socket", 1, "abs_socket", i + 1,
               f"sensors.wheel_speeds_kph.{i}", "km/h", "#83d8a1", "wheel_fl" if i == 0 else None,
               "Measured wheel peripheral speed. The optional frequency uses a chosen 48-tooth encoder; it is a derived illustration, not a solved sensor voltage.",
               {"encoder_teeth": 48, "gauge_mm2": .35, "length_m": 1.0 if i < 2 else 3.0, "resistance_model": "Ideal sensor connection"})
          for i, (corner, label) in enumerate((("fl", "Front-left"), ("fr", "Front-right"), ("rl", "Rear-left"), ("rr", "Rear-right"))))

CONNECTION_INFO = (
    {"id": "ect", "label": "Coolant sensor socket", "profiles": list(ALL_PROFILES), "component_id": "coolant_sensor",
     "effect": "Open NTC branch → high ECU input → pending fault after 0.20 s → stored P0118 after 0.50 s (accelerated teaching timers).",
     "repair": "Reconnect and step. Current sensing recovers; stored P0118 remains until the emissions memory is cleared."},
    {"id": "dlc", "label": "Diagnostic CAN branch", "profiles": list(ALL_PROFILES), "component_id": "dlc",
     "effect": "The tester cannot reach the ECU. Vehicle simulation and controller communication continue.",
     "repair": "Reconnect, then repeat the diagnostic request."},
    {"id": "bmu", "label": "Battery monitor CAN socket", "profiles": list(VEHICLE_PROFILES), "component_id": "bmu",
     "effect": "Status publication stops. Message age exceeds 300 ms and traction shutdown latches.",
     "repair": "Reconnect to resume messages, then cycle ignition off and on or Reset to release the teaching shutdown latch."},
    {"id": "wheel_fl", "label": "Front-left wheel sensor", "profiles": list(VEHICLE_PROFILES), "component_id": "wheel_fl",
     "effect": "Measured speed becomes unavailable while the physical wheel keeps turning. ABS and yaw brake assist are disabled.",
     "repair": "Reconnect and step. Control can use the input again; the module's remembered warning remains until Reset."},
)


def network_catalog() -> dict:
    """Return a fresh JSON-compatible typed catalog for views and model adapters."""
    return {"schema": "obdii-lab.network.v1", "coordinate_system": "meters; x across vehicle, y up, front at negative z",
            "components": [asdict(component) for component in COMPONENTS],
            "sockets": [asdict(socket) for socket in SOCKETS],
            "wires": [wire.serializable() for wire in WIRES], "connections": deepcopy(list(CONNECTION_INFO)),
            "layers": [
                {"id": "plant", "label": "Physical plant", "description": "True temperature, rotating wheels, motion and stored energy."},
                {"id": "electrical", "label": "Sockets, pins and wires", "description": "Typed connection graph, continuity switches and the solved coolant divider."},
                {"id": "measurement", "label": "Measurements", "description": "Sampled values, validity, missing inputs and held messages."},
                {"id": "control", "label": "Controller decisions", "description": "Scheduled ECU tasks, fallback, debounce, shutdown and diagnostic memory."},
                {"id": "protocol", "label": "Diagnostics and transport", "description": "OBD or UDS requests over an educational ISO-TP / CAN trace."},
                {"id": "view", "label": "Visual model bindings", "description": "Stable IDs and state paths drive SVG, Three.js and imported mesh animations."}],
            "sources": [
                {"label": "Elm Electronics ELM327 datasheet · vehicle connector", "url": "https://elmelectronics.com/wp-content/uploads/2020/05/ELM327DSL.pdf"},
                {"label": "AUTOSAR Diagnostic Communication Manager", "url": "https://www.autosar.org/fileadmin/standards/R23-11/CP/AUTOSAR_CP_SWS_DiagnosticCommunicationManager.pdf"},
                {"label": "UDSonCAN data identifier definitions", "url": "https://udsoncan.readthedocs.io/en/latest/_modules/udsoncan/common/dids.html"}],
            "scope": "Generic teaching topology. Only coolant-divider electrical behavior is solved. Harness lengths, gauges, CAN voltages and encoder tooth counts are illustrative. No OEM wiring, bus arbitration or hardware connection."}


def observe_network(snapshot: dict) -> dict:
    """Bind catalog objects to one deterministic simulation snapshot."""
    profile = snapshot.get("profile", "engine")
    switches = {key: snapshot.get("connections", {}).get(key, True) for key in ("ect", "dlc", "bmu", "wheel_fl")}
    effective = dict(switches)
    legacy = snapshot.get("inputs", {}).get("fault", "none")
    for key, fault in (("ect", "ect_open"), ("bmu", "bmu_timeout"), ("wheel_fl", "wheel_fl_dropout")):
        effective[key] = effective[key] and legacy != fault
    component_by_id = {component.id: component for component in COMPONENTS}
    socket_by_id = {socket.id: socket for socket in SOCKETS}
    module_names = {"ecu": "ECU", "bmu": "BMU", "supervisor": "PHEV_ECU", "abs": "ABS_ESP"}
    components = {}
    for component in COMPONENTS:
        installed = profile in component.profiles
        status = snapshot.get("module_status", {}).get(module_names.get(component.id, ""), "available")
        components[component.id] = {"installed": installed, "available": installed,
                                    "status": status if installed else "not installed",
                                    "values": {key: value_at(snapshot, path) for key, path in component.bindings.items()}}
    wires = {}
    for wire in WIRES:
        component = component_by_id[socket_by_id[wire.from_socket].component_id]
        installed = profile in component.profiles
        connected = effective.get(wire.connection_id, True)
        value = value_at(snapshot, wire.signal_id) if wire.signal_id else wire.properties.get("nominal_voltage_v")
        available = installed
        sample_kind = "sampled sensor" if wire.kind in ("analog", "pulse") else "reference" if not wire.signal_id else "state probe"
        note = wire.description
        if wire.id.startswith("dlc_can"):
            sample_kind = "application-data probe"
            available = installed and connected
            if not available: value = None
        elif wire.id.startswith("bmu_can"):
            # Message-age remains observable by the receiver during disconnection.
            sample_kind = "receiver freshness monitor"
        elif wire.kind == "pulse":
            available = installed and connected and value is not None
            if not available: value = None
        if not installed: value = None
        status = "not installed" if not installed else "open" if not connected else "connected"
        if wire.id.startswith("bmu_can") and connected and value is not None and value > 300.0001:
            status = "stale"
        live = {"value": value, "unit": wire.unit, "connected": connected, "available": available,
                "status": status, "signal_id": wire.signal_id, "state_path": wire.signal_id,
                "sample_kind": sample_kind, "note": note,
                "activity": installed and connected and (wire.kind != "can" or wire.id.startswith("bmu_can")) and bool(snapshot.get("inputs", {}).get("ignition", False))}
        if wire.kind == "pulse":
            radius = snapshot.get("wheel_radius_m", .31)
            live["frequency_hz"] = value / 3.6 / (2 * math.pi * radius) * 48 if available and value is not None else None
            live["activity"] = available and value is not None and value > .01
        wires[wire.id] = live
    return {"schema": "obdii-lab.network-state.v1", "t": snapshot.get("t", 0.0), "connections": switches,
            "effective_connections": effective, "components": components, "wires": wires}
