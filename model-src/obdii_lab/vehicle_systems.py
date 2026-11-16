"""Configured teaching units, sampled sensors and inspectable connector graph.

Generic components and chosen calibrations, not an OEM parts/diagnostic database.
Additional analog voltages are linear display transfers, not solved circuits.
Only the existing coolant divider has an electrical circuit model. Scheduling
uses supplied simulation time; logging cadence is a separate consumer concern.
"""
from __future__ import annotations

from copy import deepcopy
import math
from typing import Any

from .instrumentation import value_at

GROUPS = [
    {"id": "air", "label": "Air intake"}, {"id": "fuel", "label": "Fuel and combustion"},
    {"id": "position", "label": "Position and timing"}, {"id": "cooling", "label": "Cooling and lubrication"},
    {"id": "exhaust", "label": "Exhaust"}, {"id": "driver", "label": "Driver demand"},
    {"id": "transmission", "label": "Transmission"}, {"id": "braking", "label": "Brakes and stability"},
    {"id": "battery", "label": "High-voltage battery"}, {"id": "electric", "label": "Electric drive"},
    {"id": "body", "label": "Body electrical"}, {"id": "display", "label": "Instruments"},
    {"id": "climate", "label": "Cabin climate"},
]
GROUP_LABELS = {g["id"]: g["label"] for g in GROUPS}
SIGNAL_TYPES = [
    {"id": "analog", "label": "Analogue voltage", "description": "A continuously valued input represented by a voltage. The coolant divider is solved; the other voltage transfers are teaching illustrations."},
    {"id": "digital", "label": "Digital on/off", "description": "Two logical states, represented by the declared low and high levels."},
    {"id": "pulse", "label": "Pulse / frequency", "description": "Speed represented by pulses per second. Pulse frequency changes with speed and is separate from how often the controller samples the value."},
    {"id": "discrete", "label": "Discrete selector state", "description": "A named position or gear. This model does not claim a physical voltage encoding or communication protocol for it."},
    {"id": "derived", "label": "Derived / calculated", "description": "A calculated, commanded or received value with no independent sensor connector or electrical waveform in this model."},
]
SIGNAL_TYPE_LABELS = {item["id"]: item["label"] for item in SIGNAL_TYPES}
SAMPLE_GROUPS = [
    {"id": "period_" + str(period) + "ms", "label": f"{1000 / period:g} Hz · every {period} ms",
     "sample_period_ms": period, "sample_rate_hz": 1000 / period}
    for period in (10, 20, 50, 100, 500, 1000)
]
SAMPLE_GROUP_BY_PERIOD = {item["sample_period_ms"]: item for item in SAMPLE_GROUPS}
TIMING_CONTEXT = {
    "clock": "Simulation time; pausing the simulation also pauses sampling.",
    "sample_rate": "A sample replaces the held measurement. Sampling rate is 1000 / period in milliseconds, in samples per second (Hz).",
    "pulse_frequency": "Pulses per second encode rotation or speed. A 50 Hz sampled channel can report thousands of pulses per second; individual pulse edges are not stepped by this model.",
    "logging": "Recording interval selects which existing samples are saved. Recording once per minute does not slow the sensor or controller.",
    "bus_bitrate": "CAN bitrate is bits per second on the bus, not sensor samples per second. These characteristics do not imply that each sensor uses CAN.",
    "tasks": [
        {"id": "plant", "label": "Physical plant", "period_ms": 2, "rate_hz": 500},
        {"id": "ecu_abs", "label": "ECU / ABS tasks and sensor scheduler", "period_ms": 10, "rate_hz": 100},
        {"id": "supervisor", "label": "Vehicle supervisor", "period_ms": 20, "rate_hz": 50},
        {"id": "bmu", "label": "BMU task and status publication", "period_ms": 100, "rate_hz": 10},
    ],
    "scope": "Chosen schedules in this simulator. An individual channel can sample more slowly than its owning controller task.",
}
FUNCTIONAL_GROUPS = [
    {"id": "start_critical", "label": "Starting and engine timing", "description": "Inputs required by the selected model to authorize starting or maintain engine rotation."},
    {"id": "running_control", "label": "Propulsion and running control", "description": "Drive demand, torque calculation and permitted fallback operation."},
    {"id": "safety_control", "label": "Braking and stability", "description": "Brake/stability inputs; engine starting is a separate function."},
    {"id": "energy_thermal", "label": "Energy and temperature", "description": "Battery, heat and protective monitoring, with each modeled effect identified."},
    {"id": "comfort_control", "label": "Cabin comfort", "description": "Cabin temperature, air conditioning and their energy demand."},
    {"id": "monitoring", "label": "Information and monitoring", "description": "Displayed or monitored measurements with no modeled start/drive interlock."},
]


def _function(spec):
    """Functional importance describes implemented consequences, not every OEM."""
    id, effect = spec["id"], spec["fault_effect"]
    group, label = "monitoring", "Information / monitoring"
    failure = "Missing input is recorded; the current model continues propulsion without an additional fallback."
    if id == "crank_sensor":
        group, label = "start_critical", "Required for engine start and continued rotation"
        failure = "A missing sampled crank signal inhibits the combustion engine and records the teaching P0335 fault."
    elif id == "clutch_position":
        group, label = "start_critical", "Manual starter authorization"
        failure = "An open clutch-position connector blocks a new manual-engine start. Physical clutch coupling remains set by the pedal."
    elif id.startswith("wheel_") or id in ("steering_sensor", "yaw_sensor", "brake_switch"):
        group, label = "safety_control", "Brake / stability control"
        failure = "Loss disables ABS and stability assistance; wheels and friction brakes remain physical." if id.startswith("wheel_") else "Loss disables the simplified stability assistance." if id != "brake_switch" else "A body-module event records the missing switch. Physical brake demand and selector interlock still use the pedal in this model."
    elif spec["group"] == "climate":
        group, label = "comfort_control", "Cabin comfort and energy use"
        failure = "Missing cabin temperature disables automatic heating/cooling; ventilation remains available." if id == "cabin_temperature" else "This derived HVAC channel has no independent connector; opening the HVAC module removes cabin control and its active load."
    elif id in ("ect", "pack_voltage", "pack_current", "pack_temperature", "battery_soc", "inverter_temperature", "oil_pressure", "transmission_temp"):
        group, label = "energy_thermal", "Energy / thermal monitoring"
        failure = ("Open coolant input uses the declared temperature fallback and limits engine torque; the engine can continue." if id == "ect" else
                   "Missing measurement removes propulsion torque; the physical battery remains present." if id in ("pack_voltage", "pack_current") else
                   "Missing sampled temperature limits available torque to 70%." if effect == "derate" else
                   "This is a derived estimate with no independent connector." if spec["connection_id"] is None else
                   "Missing input is recorded; no oil starvation, transmission damage or protective shutdown is simulated.")
    elif effect in ("derate", "zero_torque"):
        group, label = "running_control", "Running control with fallback" if effect == "derate" else "Propulsion permission"
        failure = "Missing sampled input limits available torque to 70%; it does not inherently prevent engine starting." if effect == "derate" else "Missing sampled input removes drive torque; a running combustion engine may continue idling."
    elif id == "fuel_level":
        failure = "Fuel quantity is derived from tank capacity and integrated consumption; there is no independent level-sender fault or fuel-starvation model. It is not a start prerequisite."
    elif spec["connection_id"] is None:
        failure = "This displayed/derived channel has no independent connector and no start or propulsion interlock."
    return {"functional_group": group, "importance_label": label, "failure_effect": failure,
            "start_required": id in ("crank_sensor", "clutch_position"), "disconnectable": spec["connection_id"] is not None,
            "importance_scope": "Importance and consequences refer to this generic training model; production strategies differ."}
PROFILES = ["engine", "phev", "braking"]
SOURCES = [
    {"label": "Bosch powertrain sensor overview", "url": "https://www.bosch-mobility.com/en/solutions/sensors/overview-powertrain-sensors/"},
    {"label": "Bosch intake-manifold and boost-pressure sensor", "url": "https://www.bosch-mobility.com/en/solutions/sensors/intake-manifold-and-boost-pressure-sensor/"},
    {"label": "Bosch common-rail system", "url": "https://www.bosch-mobility.com/en/solutions/powertrain/diesel/common-rail-system-solenoid/"},
]


def _characteristics(spec):
    """Describe the implemented signal representation, not an OEM sensor type.

    ``kind`` remains the existing sampling implementation field. In particular,
    a derived display channel may historically have kind="analog" without being
    a physical analogue sensor. UI grouping uses signal_type instead.
    """
    id = spec["id"]
    signal_type = ("derived" if spec["connection_id"] is None else
                   "discrete" if spec["kind"] == "state" else spec["kind"])
    sample_group = SAMPLE_GROUP_BY_PERIOD[spec["period_ms"]]
    electrical = pulse = None
    description = spec["description"]
    if signal_type == "derived":
        description += " This channel has no independent sensor connector or wire-voltage representation."
    elif signal_type == "analog":
        if id == "ect":
            electrical = {
                "model": "solved_ntc_divider", "label": "NTC divider · nominal 0–5 V", "range_v": [0, 5],
                "formula": "V = Vref × R_NTC / (R_pullup + R_NTC)",
                "description": "Solved pull-up / thermistor circuit with ADC quantization. The default reference is 5 V; editable circuit settings may change it. Warmer coolant lowers the connected voltage; an open branch pulls it toward Vref.",
                "levels": [],
            }
        else:
            low, high = spec["range"]
            electrical = {
                "model": "illustrative_linear_transfer", "label": "Illustrative 0.5–4.5 V", "range_v": [0.5, 4.5],
                "formula": f"V = 0.5 + 4 × clamp((value − ({low:g})) / ({high:g} − ({low:g})), 0, 1)",
                "description": "The declared measurement range maps linearly to 0.5–4.5 V, clipped at those limits. This display transfer does not solve a sensor circuit or specify a production sensor's interface.",
                "levels": [],
            }
    elif signal_type == "digital":
        electrical = {
            "model": "illustrative_binary_levels", "label": "Two states · 0 or 5 V", "range_v": [0, 5],
            "formula": "Brake ≤ 2% → 0 V; brake > 2% → 5 V",
            "description": "The pedal threshold generates an on/off teaching signal. Low and high are states, not a variable pulse frequency or a simulated switch circuit.",
            "levels": [{"value": 0, "label": "Released", "voltage_v": 0}, {"value": 1, "label": "Applied", "voltage_v": 5}],
        }
    elif signal_type == "pulse":
        if id == "crank_sensor":
            pulses, reference, formula = 60, "crankshaft revolution", "frequency_hz = crankshaft_rpm × 60 / 60"
            note = "The chosen 60 pulses per crankshaft revolution make pulse Hz numerically equal to RPM. This is not a missing-tooth decoder."
        elif id == "cam_sensor":
            pulses, reference, formula = 1, "camshaft revolution", "frequency_hz = camshaft_rpm / 60; camshaft_rpm = crankshaft_rpm / 2"
            note = "One selected pulse per camshaft revolution; the four-stroke camshaft turns at half crankshaft speed."
        elif id == "rotor_sensor":
            pulses, reference, formula = 1, "motor rotor revolution", "frequency_hz = motor_rotor_rpm / 60"
            note = "One selected pulse per motor revolution. Rotor speed uses this model's 9:1 reduction; this does not model a resolver or a production encoder."
        else:
            pulses, reference, formula = 48, "wheel revolution", "frequency_hz = (wheel_speed_kph / 3.6) / (2 × pi × wheel_radius_m) × 48"
            note = "The chosen 48 pulses per wheel revolution use the simulated wheel radius. The wheel and its measured signal remain separate."
        pulse = {"pulses_per_revolution": pulses, "reference": reference, "formula": formula,
                 "description": note + " Frequency is calculated from the held speed sample; voltage levels, duty cycle and individual pulse edges are not simulated."}
    elif signal_type == "discrete":
        description += " The selected transmission supplies a range or gear name; physical encoding and wire voltage are unspecified."
    return {
        "signal_type": signal_type, "label": SIGNAL_TYPE_LABELS[signal_type],
        "unit": spec["unit"], "range": deepcopy(spec["range"]), "description": description,
        "electrical": electrical, "pulse": pulse,
        "timing": {"sample_period_ms": sample_group["sample_period_ms"], "sample_rate_hz": sample_group["sample_rate_hz"],
                   "group_id": sample_group["id"], "group_label": sample_group["label"]},
        "scope": "Characteristics describe this generic training model. Ranges and pulse counts are selected calibrations, not specifications for an actual vehicle.",
    }


def _s(id, label, owner, group, unit, period, kind="analog", level="all", limits=None,
       code=None, effect="none", component=None, connection=True, note=""):
    spec = {"id": id, "label": label, "unit_id": owner, "group": group, "unit": unit,
            "period_ms": period, "kind": kind, "level": level, "range": limits,
            "code": code, "fault_effect": effect, "component_id": component or id,
            "connection_id": id if connection else None, "description": note}
    spec["characteristics"] = _characteristics(spec)
    return spec


SENSOR_DEFINITIONS = [
    _s("ect", "Coolant temperature", "ecu", "cooling", "°C", 10, level="ice", limits=[-40, 140], component="coolant_sensor", note="Existing solved NTC divider and ECU conversion; physical coolant stays separate."),
    _s("intake_temp", "Intake air temperature", "ecu", "air", "°C", 500, level="ice", limits=[-40, 130], code="P0113", note="Ambient plus a chosen heat-soak proxy. Loss is diagnosed; this torque model has no separate intake-temperature correction."),
    _s("maf", "Mass air flow", "ecu", "air", "g/s", 50, level="ice", limits=[0, 250], code="P0102", effect="derate", note="Sample of the model's air-flow estimate; missing input reduces available torque to 70%."),
    _s("map", "Manifold absolute pressure", "ecu", "air", "kPa", 50, level="ice", limits=[10, 250], code="P0107", effect="derate", note="Chosen load-to-pressure approximation; not a manifold fluid-dynamics solution."),
    _s("throttle_sensor", "Throttle position", "ecu", "driver", "%", 20, level="ice", limits=[0, 100], code="P0122", effect="zero_torque", note="Pedal/actuator position proxy. Opening this teaching input inhibits propulsion torque."),
    _s("accelerator_sensor", "Accelerator pedal position", "supervisor", "driver", "%", 20, limits=[0, 100], code="P2122", effect="zero_torque", note="Single teaching pedal track; production redundant plausibility channels are not modeled."),
    _s("crank_sensor", "Crankshaft speed", "ecu", "position", "rpm", 20, "pulse", "ice", [0, 7000], "P0335", "engine_inhibit", note="Mean speed and a selected 60-pulse/revolution display; missing timing inhibits the engine."),
    _s("cam_sensor", "Camshaft speed", "ecu", "position", "rpm", 20, "pulse", "extended", [0, 3500], "P0340", "derate", note="Half crankshaft speed in a four-stroke engine. Missing phase uses a 70% teaching fallback."),
    _s("lambda_sensor", "Exhaust lambda", "ecu", "exhaust", "ratio", 100, level="ice", limits=[0.7, 2.5], code="P0130", note="Illustrative mixture estimate, not exhaust chemistry or a solved oxygen sensor."),
    _s("rail_pressure", "Fuel rail pressure", "ecu", "fuel", "bar", 50, level="extended", limits=[0, 1600], code="P0190", effect="derate", note="Pressure target proxy, with different petrol/diesel calibration; no fuel hydraulic model."),
    _s("boost_sensor", "Boost pressure", "ecu", "air", "kPa", 50, level="extended", limits=[90, 250], code="P0237", effect="derate", note="Turbo/load proxy on the extended model; lost input limits torque."),
    _s("knock_sensor", "Knock intensity", "ecu", "fuel", "index", 50, level="petrol_extended", limits=[0, 1], code="P0325", effect="derate", note="Load and temperature indicator, not combustion acoustics."),
    _s("oil_pressure", "Oil pressure", "ecu", "cooling", "bar", 100, level="extended", limits=[0, 6], code="P0520", note="A speed-dependent oil-pressure proxy; opening the input does not remove physical oil."),
    _s("nox_sensor", "Exhaust NOx proxy", "ecu", "exhaust", "ppm", 1000, level="diesel", limits=[0, 1000], code="P2200", note="Illustrative healthy exhaust trend; no emissions-compliance or aftertreatment model."),
    _s("dpf_pressure", "DPF differential pressure", "ecu", "exhaust", "kPa", 500, level="diesel", limits=[0, 30], code="P2452", note="Flow-dependent pressure-drop illustration; soot accumulation and regeneration are not modeled."),
    _s("transmission_range", "Selector position", "transmission", "transmission", "", 100, "state", code="P0705", effect="zero_torque", note="Reported automatic range or manual gear. Loss inhibits drive torque until a valid sample returns."),
    _s("transmission_temp", "Transmission temperature", "transmission", "transmission", "°C", 1000, level="ice", limits=[-20, 150], note="A derived thermal indicator, not a separate oil/gearbox thermal plant."),
    _s("vehicle_speed", "Transmission output speed", "transmission", "transmission", "km/h", 50, limits=[0, 220], code="P0500", note="Sampled vehicle-speed magnitude, not a physical tooth-by-tooth waveform."),
    _s("steering_sensor", "Steering angle", "abs", "braking", "°", 20, level="esp", limits=[-10, 10], effect="esp_inhibit", note="Road-wheel steering angle. Loss disables the simplified yaw-assist controller."),
    _s("yaw_sensor", "Yaw rate", "abs", "braking", "°/s", 20, level="esp", limits=[-60, 60], effect="esp_inhibit", note="Sample of the simplified yaw plant; lateral tire states are not modeled."),
    _s("pack_voltage", "Traction pack voltage", "bmu", "battery", "V", 100, level="electric", limits=[0, 450], effect="zero_torque", note="Sample of the actual battery plant; a missing measurement inhibits propulsion."),
    _s("pack_current", "Traction pack current", "bmu", "battery", "A", 100, level="electric", limits=[-250, 400], effect="zero_torque", note="Positive discharge, negative charging; physical current stays observable separately."),
    _s("pack_temperature", "Traction pack temperature", "bmu", "battery", "°C", 500, level="electric", limits=[-20, 80], effect="derate", note="Sample of the lumped battery thermal plant."),
    _s("battery_soc", "Battery state of charge", "bmu", "battery", "%", 1000, level="electric", limits=[0, 100], connection=False, note="Model charge estimate; no independent SOC sensor or connector is claimed."),
    _s("rotor_sensor", "Motor rotor speed", "inverter", "electric", "rpm", 20, "pulse", "electric", [0, 16000], effect="zero_torque", note="Wheel speed multiplied by the chosen 9:1 reduction. Opening the sensor inhibits propulsion."),
    _s("inverter_temperature", "Inverter temperature", "inverter", "electric", "°C", 500, level="electric", limits=[-20, 130], effect="derate", note="Power-dependent thermal proxy; switching-device losses are not resolved."),
    _s("body_supply", "Low-voltage supply", "body", "body", "V", 100, limits=[9, 15], connection=False, note="Sampled cockpit supply reference, including the cranking dip; no low-voltage battery plant."),
    _s("brake_switch", "Brake pedal switch", "body", "body", "", 20, "digital", note="Derived from pedal demand; opening it is recorded as a body-module event."),
    _s("cluster_speed", "Displayed vehicle speed", "cluster", "display", "km/h", 100, limits=[0, 220], connection=False, note="Instrument value received from the shared vehicle state."),
    _s("fuel_level", "Fuel remaining", "cluster", "display", "%", 1000, level="ice", limits=[0, 100], connection=False, note="Configured tank capacity, reduced by integrated model fuel use."),
    _s("clutch_position", "Clutch pedal position", "transmission", "transmission", "%", 20, level="manual", limits=[0, 100], note="Measured clutch-pedal position. A missing channel prevents new manual-engine starts; physical clutch motion remains separate."),
    _s("cabin_temperature", "Cabin temperature", "hvac", "climate", "°C", 500, level="hvac", limits=[-30, 70], note="Sample of the cabin thermal state. Missing measurement leaves ventilation but disables automatic heat/cooling."),
    _s("ambient_temperature", "Ambient temperature", "hvac", "climate", "°C", 1000, level="hvac", limits=[-30, 50], connection=False, note="Configured environment temperature; no external sensor circuit is simulated."),
    _s("blower_command", "Cabin blower demand", "hvac", "climate", "%", 100, level="hvac", limits=[0, 100], connection=False, note="Selected fan demand when the climate unit is powered and enabled."),
    _s("hvac_electrical_power", "HVAC electrical load", "hvac", "climate", "kW", 100, level="hvac", limits=[0, 7], connection=False, note="Delivered electrical demand. ICE A/C compressor shaft demand is reported separately; no ignition-only low-voltage battery plant."),
    _s("hvac_shaft_load", "HVAC engine shaft load", "hvac", "climate", "kW", 100, level="hvac_ice", limits=[0, 3], connection=False, note="Compressor plus alternator-equivalent blower load added to ICE shaft power and fuel demand."),
    _s("cabin_heat_output", "Cabin heating power", "hvac", "climate", "kW", 100, level="hvac", limits=[0, 5], connection=False, note="Heat delivered by warm coolant or the electric heater; the cabin has finite thermal inertia."),
    _s("cabin_cooling_output", "Cabin cooling power", "hvac", "climate", "kW", 100, level="ac", limits=[0, 5], connection=False, note="Cooling delivered by A/C. A chosen COP of 2.5 maps cooling to compressor power; refrigerant dynamics are not modeled."),
]
for _i, _corner in enumerate(("fl", "fr", "rl", "rr")):
    SENSOR_DEFINITIONS.append(_s("wheel_"+_corner, ("Front-left", "Front-right", "Rear-left", "Rear-right")[_i]+" wheel speed", "abs", "braking", "km/h", 20, "pulse", "abs", [0, 220], effect="abs_inhibit", note="Measured wheel speed; the rotating wheel remains a separate physical state."))


UNIT_DEFINITIONS = [
    ("engine", "Combustion engine", "Powertrain", "ice", "Mean speed, torque, fuel and heat."),
    ("ecu", "Engine ECU", "Powertrain", "ice", "Samples engine sensors, applies fallback and serves OBD/UDS requests."),
    ("transmission", "Transmission", "Powertrain", "all", "Selector, drive ratio and output-speed measurements."),
    ("abs", "ABS / stability controller", "Chassis", "abs", "Measured wheel speeds and optional simplified yaw assistance."),
    ("battery", "Traction battery", "Electric drive", "electric", "Stored charge, terminal current and lumped temperature."),
    ("bmu", "Battery monitor", "Electric drive", "electric", "Sampled battery status and traction permissions."),
    ("inverter", "Motor / inverter", "Electric drive", "electric", "Electric propulsion and regenerative braking."),
    ("supervisor", "Vehicle controller", "Control", "all", "Driver demand and propulsion permission; hybrid coordination where fitted."),
    ("body", "Body controller", "Body", "all", "Low-voltage reference and brake-switch input."),
    ("cluster", "Instrument cluster", "Body", "all", "Dashboard values and warnings from the same vehicle state."),
    ("hvac", "Cabin heater / A/C", "Body", "hvac", "Blower, cabin temperature and heating/cooling load from the same vehicle simulation."),
    ("charging", "Charge interface", "Electric drive", "plug", "Installed on plug-in configurations. External charging behavior is reference-only."),
    ("dlc", "Diagnostic socket", "Diagnostics", "all", "Physical access point, with pin assignments separate from diagnostic services."),
    ("scan_tool", "External scan tool", "Diagnostics", "all", "Connection settings and requests against the logged simulated vehicle."),
]
POSITIONS = {"transmission": [0,.68,-.6], "inverter": [.4,.76,-1], "body":[-.58,.95,.2], "cluster":[-.5,1.25,-.3], "charging":[.92,.73,1.5], "hvac":[.35,1.1,-.2]}


def _powertrain(config):
    return str(config.get("powertrain", "petrol"))


def installed(level, config):
    power = _powertrain(config); ice = power != "bev"; electric = power in ("hev", "phev", "bev")
    extended = str(config.get("engine_detail", "basic")) in ("extended", "advanced", "complex")
    return {"all": True, "ice": ice, "electric": electric, "extended": ice and extended,
            "petrol_extended": ice and power != "diesel" and extended, "diesel": power == "diesel",
            "abs": bool(config.get("abs_installed", True)), "esp": bool(config.get("abs_installed", True)) and bool(config.get("esp_installed", True)),
            "plug": power in ("phev", "bev"), "manual": config.get("transmission_type") == "manual_6",
            "hvac": bool(config.get("hvac_installed", True)), "hvac_ice": bool(config.get("hvac_installed", True)) and power in ("petrol", "diesel"),
            "ac": bool(config.get("hvac_installed", True)) and bool(config.get("ac_installed", True))}.get(level, False)


def vehicle_system_catalog(configuration):
    config = deepcopy(configuration or {}); sensors=[]
    for original in SENSOR_DEFINITIONS:
        sensor=deepcopy(original);sensor["installed"]=installed(sensor.pop("level"),config)
        sensor.update(_function(sensor))
        sensor["signal_id"]="vehicle_sensors."+sensor["id"]+".value"
        sensor["socket_id"] = {"ect":"coolant_socket"}.get(sensor["id"],sensor["id"]+"_socket") if sensor["connection_id"] else None
        sensor["provenance"]="Existing sampled plant" if sensor["id"] in ("ect","wheel_fl") else "Original generic teaching sensor model"
        sensor["fault_note"]="Accelerated teaching persistence: pending after 0.2 s of missing sampled input, stored after 0.5 s; repair and clear are separate."
        sensors.append(sensor)
    units=[]
    for id,label,group,level,note in UNIT_DEFINITIONS:
        owned=[s for s in sensors if s["unit_id"]==id]
        if id == "transmission": label = config.get("transmission", label)
        units.append({"id":id,"label":label,"group":group,"description":note,"installed":installed(level,config),
                      "sensor_ids":[s["id"] for s in owned],"socket_ids":list(dict.fromkeys(s["socket_id"] for s in owned if s["socket_id"])),
                      "diagnostic_capability":"obd_uds" if id=="ecu" else "state_only",
                      "status_path":{"ecu":"module_status.ECU","abs":"module_status.ABS_ESP","bmu":"module_status.BMU","hvac":"module_status.HVAC"}.get(id,"vehicle.start_state")})
    return {"schema":"obdii-lab.vehicle-systems.v1","configuration":config,"groups":deepcopy(GROUPS),"functional_groups":deepcopy(FUNCTIONAL_GROUPS),"units":units,"sensors":sensors,
            "signal_types":deepcopy(SIGNAL_TYPES),"sample_groups":deepcopy(SAMPLE_GROUPS),"timing_context":deepcopy(TIMING_CONTEXT),
            "scope":"Configured generic teaching inventory, not all sensors from any specific production vehicle. Derived proxies are identified individually.","sources":deepcopy(SOURCES)}


def sensor_conversion(spec, reading, snapshot):
    """Explain this held sample; never invent ADC or network bytes."""
    steps = []
    def add(label, value):
        steps.append({"label": label, "value": value})
    def number(value):
        return f"{value:.8g}"
    valid = reading["validity"] == "valid"
    kind = spec["characteristics"]["signal_type"]
    scope = spec["characteristics"]["description"]
    if spec["id"] == "ect" and reading["powered"] and reading["installed"] and all(
            key in snapshot.get("sensors", {}) for key in ("ect_adc_count", "ect_adc_full_scale", "ect_reference_v", "ect_node_v")):
        s = snapshot["sensors"]
        count, scale = s["ect_adc_count"], s["ect_adc_full_scale"]
        bits = s.get("ect_adc_bits", scale.bit_length())
        ref, voltage = s["ect_reference_v"], reading["signal_voltage_v"]
        add("Analogue input", f"Vnode = {number(s['ect_node_v'])} V; Vref = {number(ref)} V")
        add("ADC code", f"round({number(s['ect_node_v'])} / {number(ref)} × {scale}) = {count} = 0x{count:0{(bits + 3) // 4}X} ({bits} bit)")
        add("ADC voltage", f"{count} / {scale} × {number(ref)} = {number(voltage)} V")
        if valid and all(key in s for key in ("ect_pullup_ohm", "ect_r25_ohm", "ect_beta_k")):
            pullup, r25, beta = s["ect_pullup_ohm"], s["ect_r25_ohm"], s["ect_beta_k"]
            resistance = pullup * voltage / (ref - voltage)
            add("NTC resistance", f"R = {number(pullup)} × {number(voltage)} / ({number(ref)} − {number(voltage)}) = {number(resistance)} Ω")
            add("Temperature conversion", f"T = 1 / (1 / 298.15 + ln({number(resistance)} / {number(r25)}) / {number(beta)}) − 273.15 = {number(reading['value'])} °C")
        scope = "Solved NTC divider and quantized ADC input. Hex is the ADC code, separate from diagnostic response bytes."
    elif valid and kind == "analog" and spec["id"] != "ect":
        low, high = spec["range"]
        voltage = reading["signal_voltage_v"]
        decoded = low + (voltage - .5) * (high - low) / 4
        add("Analogue input", f"{number(voltage)} V")
        add("Voltage conversion", f"{number(low)} + ({number(voltage)} − 0.5) × ({number(high)} − ({number(low)})) / 4 = {number(decoded)} {spec['unit']}")
        scope = "Illustrative 0.5–4.5 V transfer, clipped to the declared range. The model samples the quantity directly; no ADC code or transmitted bytes are simulated."
    elif valid and kind == "digital":
        bit = int(bool(reading["value"]))
        add("Digital input", f"{number(reading['signal_voltage_v'])} V → {bit} (0x{bit:02X}) → " + ("On" if bit else "Off"))
        add("Logic conversion", spec["characteristics"]["electrical"]["formula"])
        scope = "Hex represents the sampled logic state. It is not a captured bus byte or an ADC conversion."
    elif valid and kind == "pulse":
        frequency = reading["frequency_hz"]
        pulses = spec["characteristics"]["pulse"]["pulses_per_revolution"]
        add("Pulse input", f"f = {number(frequency)} Hz; N = {pulses} pulses/rev")
        if spec["id"].startswith("wheel_"):
            radius = snapshot.get("wheel_radius_m", .31)
            add("Pulse conversion", f"v = {number(frequency)} / {pulses} × 2 × π × {number(radius)} × 3.6 = {number(reading['value'])} km/h")
        else:
            add("Pulse conversion", f"rpm = {number(frequency)} × 60 / {pulses} = {number(reading['value'])}")
        scope = spec["characteristics"]["pulse"]["description"]
    if valid:
        value = reading["value"]
        add("Reported sample", (number(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else ("On" if value else "Off") if isinstance(value, bool) else str(value)) + (" " + spec["unit"] if spec["unit"] else ""))
    else:
        add("Input validity", reading["validity_note"])
        if spec["id"] == "ect" and reading["value"] is not None:
            add("Invalid display marker", f"{reading['value']:g} °C; not physical coolant temperature")
    return {"sensor_id": spec["id"], "sampled_at": reading["sampled_at"], "steps": steps, "scope": scope}


class SensorBank:
    """Sampled sensor channels and interruption monitors for one configuration."""
    def __init__(self, configuration):
        self.configuration=deepcopy(configuration);self.catalog=vehicle_system_catalog(configuration)
        self.specs={s["id"]:s for s in self.catalog["sensors"]}
        self.connections={s["connection_id"]:True for s in self.specs.values() if s["connection_id"] not in (None,"ect","wheel_fl")}
        for unit in self.catalog["units"]:
            if unit["id"] in ("ecu","transmission","abs","inverter","supervisor","body","cluster","charging","hvac"):
                self.connections["unit_"+unit["id"]]=True
        self.readings={};self.pending_dtcs=set();self.stored_dtcs=set();self.module_faults={};self.effects={"engine_inhibit":False,"torque_factor":1.0,"abs_inhibit":False,"esp_inhibit":False}
        self._started={};self._last_t=None

    def set_connection(self, id, connected):
        if id not in self.connections: raise ValueError("Unknown sensor/unit connection: "+str(id))
        if not isinstance(connected,bool): raise ValueError("connected must be boolean")
        if id.startswith("unit_"):
            unit=next((u for u in self.catalog["units"] if u["id"]==id[5:]),None)
            if not unit or not unit["installed"]:raise ValueError("Unit is not installed in this configuration")
        elif not self.specs[id]["installed"]:raise ValueError("Sensor is not installed in this configuration")
        self.connections[id]=connected

    def clear_codes(self):
        self.pending_dtcs.clear();self.stored_dtcs.clear();self._started.clear()

    def fault_details(self):
        return [{"sensor_id":s["id"],"label":s["label"],"code":s["code"],"stored":s["code"] in self.stored_dtcs,
                 "pending":s["code"] in self.pending_dtcs,"effect":s["fault_effect"],"note":"Chosen generic teaching mapping; use actual vehicle service data for real diagnostics."}
                for s in self.specs.values() if s.get("code") and (s["code"] in self.pending_dtcs or s["code"] in self.stored_dtcs)]

    def _physical(self,id,s):
        rpm=float(s.get("rpm") or 0);speed=abs(float(s.get("speed_kph") or 0));load=float(s.get("load_pct") or 0);inp=s.get("inputs",{});v=s.get("vehicle",{});ambient=float(s.get("ambient_c",20));coolant=float(s.get("coolant_c") if s.get("coolant_c") is not None else ambient);running=bool(s.get("engine_running"));diesel=_powertrain(self.configuration)=="diesel"
        values={
          "ect":s.get("coolant_c"),"intake_temp":ambient+max(0,coolant-ambient)*.10,
          "maf":s.get("maf_g_s",0),"map":(100+load*.9 if diesel else 30+load*.7) if running else 100,
          "throttle_sensor":float(inp.get("throttle",0))*100,"accelerator_sensor":float(inp.get("throttle",0))*100,
          "crank_sensor":rpm,"cam_sensor":rpm/2,"lambda_sensor":(1.8-load*.007 if diesel else 1.02-load*.0005) if running else None,
          "rail_pressure":(300+load*10 if diesel else 40+load) if running else 0,
          "boost_sensor":100+load*(1.25 if diesel else .65) if running else 100,
          "knock_sensor":min(1,max(0,load-55)/100+max(0,coolant-95)/100) if running else 0,
          "oil_pressure":min(5.5,.6+rpm/1200) if rpm>100 else 0,
          "nox_sensor":50+load*5 if running else 0,"dpf_pressure":max(0,float(s.get("maf_g_s",0)))*.08 if running else 0,
          "transmission_range":v.get("selector","P"),"transmission_temp":ambient+max(0,coolant-ambient)*.65,
          "vehicle_speed":speed,"steering_sensor":float(inp.get("steer_deg",0)),"yaw_sensor":s.get("yaw_rate_deg_s",0),
          "pack_voltage":s.get("battery_voltage_v"),"pack_current":s.get("battery_current_a"),"pack_temperature":s.get("battery_temp_c"),"battery_soc":s.get("soc_pct"),
          "rotor_sensor":speed/3.6/max(.01,float(s.get("wheel_radius_m",.31)))*30/math.pi*9,
          "inverter_temperature":ambient+abs(float(s.get("motor_power_kw",0)))*.3,
          "body_supply":v.get("low_voltage_v",14.1 if running or v.get("ready") else 12.6),"brake_switch":float(inp.get("brake",0))>.02,
          "cluster_speed":speed,"fuel_level":v.get("fuel_pct",max(0,100*(55-float(s.get("energy",{}).get("fuel_l",0)))/55)),
          "clutch_position":float(inp.get("clutch", 0))*100,
          "cabin_temperature":v.get("hvac",{}).get("cabin_c"), "ambient_temperature":ambient,
          "blower_command":v.get("hvac",{}).get("fan",0)*100 if v.get("hvac",{}).get("enabled") and v.get("hvac",{}).get("powered") else 0,
          "hvac_electrical_power":v.get("hvac",{}).get("electrical_kw"), "hvac_shaft_load":v.get("hvac",{}).get("shaft_load_kw"),
          "cabin_heat_output":v.get("hvac",{}).get("heat_kw"), "cabin_cooling_output":v.get("hvac",{}).get("cooling_kw"),
        }
        if id.startswith("wheel_"):
            return s.get("wheel_speeds_kph",[None]*4)[("fl","fr","rl","rr").index(id[6:])]
        return values.get(id)

    def sample(self,snapshot,dt=0):
        t=float(snapshot.get("t",0));powered=bool(snapshot.get("inputs",{}).get("ignition",False))
        if not math.isfinite(t):raise ValueError("Sensor time must be finite")
        if t < (self._last_t if self._last_t is not None else t)-1e-9:raise ValueError("Sensor time cannot move backwards")
        self._last_t=t;effective=snapshot.get("effective_connections",snapshot.get("connections",{}));effects={"engine_inhibit":False,"torque_factor":1.0,"abs_inhibit":False,"esp_inhibit":False}
        for id,spec in self.specs.items():
            conn=spec["connection_id"];unit_connected=self.connections.get("unit_"+spec["unit_id"],True)
            channel_powered=powered and unit_connected
            connected=unit_connected and (effective.get(conn,True) if conn in ("ect","wheel_fl") else self.connections.get(conn,True))
            physical=self._physical(id,snapshot) if spec["installed"] else None
            previous=self.readings.get(id);due=previous is None or t-previous["sampled_at"]>=spec["period_ms"]/1000-1e-9 or previous["powered"]!=channel_powered
            if due:
                valid=spec["installed"] and channel_powered and connected and physical is not None
                value=physical if valid else None;note="Fresh sample of the declared teaching channel." if valid else "Unit is not installed." if not spec["installed"] else "Ignition or owning unit is off; input is unpowered." if not channel_powered else "Connector is open; no measurement." if not connected else "Value is not available in the current operating state."
                voltage=None;frequency=None
                if id=="ect":
                    sensed=snapshot.get("sensors",{});value=sensed.get("ect_c") if spec["installed"] and channel_powered else None
                    valid=bool(sensed.get("ect_sensor_valid")) and channel_powered and connected and spec["installed"]
                    voltage=sensed.get("ect_voltage_v") if spec["installed"] and channel_powered else None
                    note="Existing ECU NTC conversion." if valid else "Unpowered or invalid NTC input; display marker is not physical coolant."
                elif valid and spec["connection_id"] and spec["kind"]=="analog" and spec.get("range"):
                    low,high=spec["range"];voltage=.5+4*max(0,min(1,(float(value)-low)/(high-low)))
                elif valid and spec["kind"]=="digital":voltage=5.0 if value else 0.0
                elif valid and spec["kind"]=="pulse":
                    frequency=(float(value) if id=="crank_sensor" else float(value)/60 if id in ("cam_sensor","rotor_sensor") else float(value)/3.6/(2*math.pi*float(snapshot.get("wheel_radius_m",.31)))*48)
                self.readings[id]={"id":id,"value":value,"physical_value":physical,"unit":spec["unit"],"installed":spec["installed"],"connected":connected,"powered":channel_powered,
                    "validity":"valid" if valid else "invalid" if channel_powered and spec["installed"] and (not connected or physical is not None) else "unavailable","validity_note":note,"sampled_at":t,"age_ms":0,
                    "signal_voltage_v":voltage,"frequency_hz":frequency,"period_ms":spec["period_ms"],"source":spec["provenance"]}
                self.readings[id]["conversion"] = sensor_conversion(spec, self.readings[id], snapshot)
            reading=self.readings[id];reading["age_ms"]=round(max(0,t-reading["sampled_at"])*1000,6)
            reading["physical_value"]=physical
            failed=spec["installed"] and channel_powered and not reading["connected"] and reading["validity"]=="invalid"
            if failed:
                self._started.setdefault(id,t);elapsed=t-self._started[id]
                code=spec.get("code")
                if code and spec["unit_id"] in ("ecu","transmission","supervisor") and installed("ice",self.configuration):
                    if elapsed>=.2-1e-9:self.pending_dtcs.add(code)
                    if elapsed>=.5-1e-9:self.stored_dtcs.add(code)
                elif elapsed>=.5-1e-9 and id != "ect":
                    label=id.upper()+"_SIGNAL_MISSING";memory=self.module_faults.setdefault(spec["unit_id"],[])
                    if label not in memory:memory.append(label)
                effect=spec["fault_effect"]
                if effect=="engine_inhibit":effects["engine_inhibit"]=True
                if effect=="zero_torque":effects["torque_factor"]=0.0
                elif effect=="derate":effects["torque_factor"]=min(effects["torque_factor"],.7)
                elif effect=="abs_inhibit":effects["abs_inhibit"]=effects["esp_inhibit"]=True
                elif effect=="esp_inhibit":effects["esp_inhibit"]=True
            else:
                self._started.pop(id,None)
                if spec.get("code"):self.pending_dtcs.discard(spec["code"])
        for key,connected in self.connections.items():
            if not key.startswith("unit_") or connected or not powered:continue
            unit=key[5:]
            if unit=="ecu":effects["engine_inhibit"]=True
            if unit in ("supervisor","inverter","transmission"):effects["torque_factor"]=0.0
            if unit=="abs":effects["abs_inhibit"]=effects["esp_inhibit"]=True
            label=unit.upper()+"_DISCONNECTED";memory=self.module_faults.setdefault(unit,[])
            if label not in memory:memory.append(label)
        self.effects=effects
        return {"readings":deepcopy(self.readings),"pending_dtcs":sorted(self.pending_dtcs),"stored_dtcs":sorted(self.stored_dtcs),"module_faults":deepcopy(self.module_faults),"effects":dict(self.effects)}


def signal_catalog_for_vehicle(configuration):
    result=[]
    for s in vehicle_system_catalog(configuration)["sensors"]:
        base={"label":s["label"],"unit":s["unit"],"source":s["provenance"],"period_ms":s["period_ms"],"group":GROUP_LABELS[s["group"]],"group_id":s["group"],
              "description":s["description"],"kind":s["kind"],"profiles":list(PROFILES),"provenance":s["provenance"],"installed":s["installed"],"unit_id":s["unit_id"],"component_id":s["component_id"],"sensor_id":s["id"], "functional_group":s["functional_group"], "importance_label":s["importance_label"], "failure_effect":s["failure_effect"], "characteristics":deepcopy(s["characteristics"])}
        result.append({**base,"id":s["signal_id"],"range":s.get("range")})
        if s["connection_id"] and s["kind"] in ("analog","digital"):
            result.append({**base,"id":"vehicle_sensors."+s["id"]+".signal_voltage_v","label":s["label"]+" · signal voltage","unit":"V","kind":"analog","range":[0,5],"description":"Solved coolant voltage." if s["id"]=="ect" else "Illustrative 0/5 V on/off signal; no switch circuit is solved." if s["kind"]=="digital" else "Illustrative linear signal transfer; no complete electrical circuit is solved."})
        if s["kind"]=="pulse":result.append({**base,"id":"vehicle_sensors."+s["id"]+".frequency_hz","label":s["label"]+" · pulse frequency","unit":"Hz","kind":"analog","range":[0,8000],"description":"Derived pulse frequency; a waveform preview is an illustration, not a captured wire voltage."})
    # Configured-vehicle state probes are separate from sensors/connectors.
    probes = [
        ("fuel_l_100km", "Instantaneous fuel consumption", "L/100 km", "ecu", "fuel", installed("ice", configuration),
         "100 times fuel flow in L/h divided by speed in km/h; unavailable below 1 km/h. Zero is valid during fuel-free coasting."),
        ("vehicle.low_voltage_v", "12 V system voltage", "V", "ecu", "display", installed("ice", configuration),
         "Existing low-voltage supply state; not a separate battery or alternator circuit model."),
        ("vehicle.gear", "Current gear", "", "transmission", "transmission", True,
         "Actual selected forward gear, P/N/R state, or AUTO for the power-split model; no numbered hybrid gears are invented."),
        ("vehicle.gear_ratio", "Transmission ratio", "ratio", "transmission", "transmission", configuration.get("transmission_type") != "hybrid_power_split",
         "Existing gearbox ratio; excludes the final drive on ICE models. BEV uses its fixed reduction; power-split ratio is not modeled."),
        ("vehicle.clutch_coupling", "Clutch coupling", "ratio", "transmission", "transmission", installed("manual", configuration),
         "Existing manual clutch engagement factor, from 0 to 1."),
        ("vehicle.clutch_torque_nm", "Clutch transmitted torque", "N·m", "transmission", "transmission", installed("manual", configuration),
         "Torque transmitted by the existing lumped manual clutch.")
    ]
    for id, label, unit, owner, group, fitted, description in probes:
        result.append({"id":id,"label":label,"unit":unit,"source":"Vehicle model","period_ms":2,
                       "group":GROUP_LABELS[group],"group_id":group,"description":description,
                       "kind":"state" if id=="vehicle.gear" else "analog","profiles":list(PROFILES),
                       "provenance":"teaching model","installed":fitted,"unit_id":owner,"component_id":owner,"sensor_id":None})
    return result


def read_vehicle_signals(snapshot,configuration):
    records={}
    for meta in signal_catalog_for_vehicle(configuration):
        if meta.get("sensor_id") is None:
            value=value_at(snapshot,meta["id"]) if meta["installed"] else None
            records[meta["id"]]={**meta,"value":value,"validity":"valid" if value is not None else "unavailable",
                                 "validity_note":"Available model signal." if value is not None else meta["description"],
                                 "t":snapshot.get("t",0),"sampled_at":snapshot.get("t",0),"age_ms":0}
            continue
        reading=snapshot.get("vehicle_sensors",{}).get(meta["sensor_id"],{});field=meta["id"].rsplit('.',1)[-1]
        validity=reading.get("validity","unavailable")
        if meta["sensor_id"]=="ect" and field=="signal_voltage_v" and reading.get("powered") and reading.get(field) is not None:validity="valid"
        records[meta["id"]]={**meta,"value":reading.get(field),"validity":validity,"validity_note":reading.get("validity_note","No sample yet."),"t":snapshot.get("t",0),"sampled_at":reading.get("sampled_at"),"age_ms":reading.get("age_ms")}
    return records


def build_network_catalog(configuration,base_catalog):
    catalog=deepcopy(base_catalog);systems=vehicle_system_catalog(configuration);units={u["id"]:u for u in systems["units"]};components={c["id"]:c for c in catalog["components"]};sockets={s["id"]:s for s in catalog["sockets"]}
    for component in components.values():component["socket_ids"]=list(component.get("socket_ids",[]))
    for id,u in units.items():
        if id not in components:
            item={"id":id,"label":u["label"],"kind":"controller","description":u["description"],"position":POSITIONS.get(id,[0,.9,0]),"socket_ids":[],"profiles":list(PROFILES),"properties":{"model":"Generic teaching unit"},"bindings":{}}
            components[id]=item;catalog["components"].append(item)
        # The reused core catalog supplies geometry and bindings. The configured
        # unit inventory supplies the identity shown in every current view.
        # Retaining the core's "Hybrid supervisor" label here made a petrol car
        # look hybrid when selecting its controller or viewing its location.
        components[id]["label"]=u["label"]
        components[id]["description"]=u["description"]
        components[id]["installed"]=u["installed"]
        components[id]["status_path"]=u["status_path"]
    for sensor in systems["sensors"]:
        cid=sensor["component_id"]
        if cid not in components:
            owner=components[sensor["unit_id"]];p=owner.get("position",[0,.9,0]);offset=(len(components)%5-2)*.1
            item={"id":cid,"label":sensor["label"],"kind":"sensor","description":sensor["description"] + " " + sensor["failure_effect"],"position":[p[0]+offset,p[1]+.08,p[2]+.12],"socket_ids":[],"profiles":list(PROFILES),"properties":{"sample_period_ms":sensor["period_ms"],"unit_id":sensor["unit_id"],"group":GROUP_LABELS[sensor["group"]],"provenance":sensor["provenance"],"functional_group":sensor["functional_group"],"importance":sensor["importance_label"]},"bindings":{"measurement":sensor["signal_id"]},"installed":sensor["installed"]}
            components[cid]=item;catalog["components"].append(item)
        components[cid]["installed"]=True if sensor["id"].startswith("wheel_") else sensor["installed"]
        components[cid]["properties"]["sensor_id"]=sensor["id"]
        components[cid]["properties"]["functional_group"]=sensor["functional_group"]
        components[cid]["properties"]["importance"]=sensor["importance_label"]
        components[cid]["properties"]["failure_effect"]=sensor["failure_effect"]
        components[cid]["properties"]["characteristics"]=deepcopy(sensor["characteristics"])
        if sensor["id"].startswith("wheel_"):components[cid]["properties"]["speed_sensor_installed"]=sensor["installed"]
        if not sensor["connection_id"] or sensor["id"] in ("ect","wheel_fl","wheel_fr","wheel_rl","wheel_rr"):continue
        sid=sensor["socket_id"];owner_id=sensor["unit_id"]+'_'+sensor["group"]+'_socket'
        if owner_id not in sockets:
            socket={"id":owner_id,"component_id":sensor["unit_id"],"label":units[sensor["unit_id"]]["label"]+' · '+GROUP_LABELS[sensor["group"]],"pins":[],"connection_id":None,"description":"Illustrative teaching assignment, not an OEM connector pinout.","properties":{"teaching_only":True}}
            sockets[owner_id]=socket;catalog["sockets"].append(socket);components[sensor["unit_id"]]["socket_ids"].append(owner_id)
        owner=sockets[owner_id];pin=len(owner["pins"])+1
        socket={"id":sid,"component_id":cid,"label":sensor["label"]+' connector',"pins":[{"number":1,"label":"Reference","role":"reference","unit":"V"},{"number":2,"label":"Signal","role":sensor["kind"],"unit":sensor["unit"]},{"number":3,"label":"Return","role":"ground","unit":"V"}],"connection_id":sensor["connection_id"],"description":"Generic three-pin teaching connector. Verify real assignments from vehicle service information.","properties":{"teaching_only":True}}
        sockets[sid]=socket;catalog["sockets"].append(socket);components[cid]["socket_ids"].append(sid)
        for i,label in enumerate(("Reference","Signal","Return")):owner["pins"].append({"number":pin+i,"label":sensor["label"]+' '+label,"role":("reference",sensor["kind"],"ground")[i],"unit":"V" if i!=1 else sensor["unit"]})
        path='vehicle_sensors.'+sensor['id']+('.frequency_hz' if sensor['kind']=='pulse' else '.value' if sensor['kind']=='state' else '.signal_voltage_v')
        for i,label in enumerate(('reference','signal','return')):
            wire={"id":sensor['id']+'_'+label,"label":sensor['label']+' '+label,"kind":('reference',sensor['kind'],'ground')[i],"from":{"socket_id":sid,"pin":i+1},"to":{"socket_id":owner_id,"pin":pin+i},"signal_id":path if i==1 else '',"state_path":path if i==1 else '',"unit":'Hz' if i==1 and sensor['kind']=='pulse' else '' if i==1 and sensor['kind']=='state' else 'V',"color":('#d4b066','#58cbb5','#9caabc')[i],"connection_id":sensor['connection_id'],"description":'Illustrative sensor connector; additional analog transfer is not a solved harness circuit.',"properties":{"nominal_voltage_v":5.0 if i==0 else 0.0 if i==2 else None,"teaching_only":True,"sensor_id":sensor['id']}}
            catalog['wires'].append(wire)
        catalog['connections'].append({"id":sensor['connection_id'],"label":sensor['label']+' connector',"component_id":cid,"profiles":list(PROFILES),"effect":sensor['description'],"repair":"Reconnect, advance to obtain a fresh sample, then clear retained memory where applicable."})
    for corner in ('fr','rl','rr'):
        socket=sockets.get('wheel_'+corner+'_socket')
        if socket:socket['connection_id']='wheel_'+corner
        for wire in catalog['wires']:
            if wire['id']=='wheel_'+corner+'_signal':wire['connection_id']='wheel_'+corner;wire['signal_id']=wire['state_path']='vehicle_sensors.wheel_'+corner+'.value'
        catalog['connections'].append({'id':'wheel_'+corner,'label':corner.upper()+' wheel sensor','component_id':'wheel_'+corner,'profiles':list(PROFILES),'effect':'Missing measured speed disables ABS/yaw assistance; physical wheel keeps rotating.','repair':'Reconnect and acquire a fresh sample.'})
    for unit_id in ('ecu','transmission','abs','inverter','supervisor','body','cluster','charging','hvac'):
        sid=unit_id+'_module_socket';cid='unit_'+unit_id
        socket={'id':sid,'component_id':unit_id,'label':units[unit_id]['label']+' · module connection','pins':[{'number':1,'label':'Supply','role':'power','unit':'V'},{'number':2,'label':'Ground','role':'ground','unit':'V'},{'number':3,'label':'Communication H','role':'can','unit':''},{'number':4,'label':'Communication L','role':'can','unit':''}],'connection_id':cid,'description':'Generic four-pin module connection for the teaching model, not a production connector.','properties':{'teaching_only':True}}
        catalog['sockets'].append(socket);components[unit_id]['socket_ids'].append(sid)
        catalog['connections'].append({'id':cid,'label':units[unit_id]['label']+' module','component_id':unit_id,'profiles':list(PROFILES),'effect':'Isolates this teaching unit and removes its measured inputs/permission.','repair':'Reconnect and sample again; stored events remain.'})
    for socket in catalog['sockets']:
        owner=components[socket['component_id']]
        socket['installed']=owner.get('installed',True)
        if socket['component_id'].startswith('wheel_'):socket['installed']=installed('abs',configuration)
    for connection in catalog['connections']:
        connection['installed']=next((s['installed'] for s in systems['sensors'] if s['connection_id']==connection['id']),components.get(connection.get('component_id'),{}).get('installed',True))
    for wire in catalog['wires']:
        if wire['kind']=='can':wire['properties']['bitrate_reference_bps']=configuration.get('can_bitrate',500000)
        if wire['id']=='dlc_power':
            wire['signal_id']=wire['state_path']='vehicle.low_voltage_v'
            wire['description']='Current cockpit low-voltage supply reference, including the cranking dip; no low-voltage battery plant is solved.'
    catalog['configuration']=deepcopy(configuration);catalog['scope']=systems['scope']+' '+catalog.get('scope','')
    return catalog


def observe_vehicle_network(snapshot, catalog, base_observed=None):
    """Resolve installed units and signal availability against one sample."""
    result = deepcopy(base_observed or {})
    effective = dict(result.get("effective_connections", {}))
    effective.update(snapshot.get("effective_connections", snapshot.get("connections", {})))
    result.update(schema="obdii-lab.network-state.v1", t=snapshot.get("t", 0),
                  connections=dict(snapshot.get("connections", {})), effective_connections=effective)
    result.setdefault("components", {})
    result.setdefault("wires", {})
    components = {c["id"]: c for c in catalog["components"]}
    sockets = {s["id"]: s for s in catalog["sockets"]}
    readings = snapshot.get("vehicle_sensors", {})
    ignition = bool(snapshot.get("inputs", {}).get("ignition", False))

    def at(path):
        value = snapshot
        try:
            for key in path.split("."):
                value = value[int(key)] if isinstance(value, list) else value[key]
            return value
        except (KeyError, TypeError, ValueError, IndexError):
            return None

    for component in catalog["components"]:
        id = component["id"]
        present = component.get("installed", True)
        connected = effective.get("unit_" + id, True)
        reading = readings.get(component.get("properties", {}).get("sensor_id"), {})
        previous = result["components"].get(id, {})
        status = at(component.get("status_path", "")) or previous.get("status", "available")
        if not present:
            status = "not installed"
        elif not connected:
            status = "disconnected"
        elif reading and reading.get("installed") and not reading.get("connected", True):
            status = "sensor disconnected"
        elif reading and not reading.get("powered", True):
            status = "unpowered"
        result["components"][id] = {
            "installed": present, "available": present and connected,
            "status": status,
            "values": {key: at(path) if present else None for key, path in component.get("bindings", {}).items()},
        }

    for wire in catalog["wires"]:
        source = sockets[wire["from"]["socket_id"]]
        target = sockets[wire["to"]["socket_id"]]
        endpoints = [components[source["component_id"]], components[target["component_id"]]]
        present = all(c.get("installed", True) for c in endpoints) and source.get("installed", True) and target.get("installed", True)
        units_connected = all(effective.get("unit_" + c["id"], True) for c in endpoints)
        sensor_id = wire.get("properties", {}).get("sensor_id")
        if wire["id"].startswith("wheel_"):
            sensor_id = wire["id"].rsplit("_", 1)[0]
        reading = readings.get(sensor_id, {})
        connected = units_connected and effective.get(wire.get("connection_id"), True)
        if reading and not reading.get("powered", True):
            units_connected = False
        status = "not installed" if not present else "open" if not units_connected else "unpowered" if not ignition else "open" if not connected else "connected"
        common = {"unit": wire["unit"], "connected": connected, "signal_id": wire.get("signal_id", ""),
                  "state_path": wire.get("signal_id", ""), "note": wire.get("description", "")}
        if wire["id"] in ("dlc_power", "dlc_ground"):
            value = at(wire["signal_id"]) if wire.get("signal_id") else wire["properties"].get("nominal_voltage_v")
            result["wires"][wire["id"]] = {**common, "value": value if present else None, "available": present,
                                              "status": "connected" if present else "not installed", "sample_kind": "reference", "activity": False}
            continue
        if not present or not units_connected or not ignition:
            result["wires"][wire["id"]] = {**common, "value": None, "available": False, "status": status,
                                              "sample_kind": "unavailable", "activity": False}
            continue
        # Preserve the solved NTC pull-up and receiver freshness observations.
        # An open NTC can still produce an observable high voltage at its ECU.
        if wire["id"] in result["wires"] and not sensor_id:
            existing = result["wires"][wire["id"]]
            existing.update(connected=connected, status=status)
            if wire["id"].startswith("dlc_can") and not connected:
                existing.update(value=None, available=False, activity=False)
            continue
        value = at(wire.get("signal_id", "")) if wire.get("signal_id") else wire.get("properties", {}).get("nominal_voltage_v")
        available = connected and value is not None and (reading.get("validity") == "valid" if sensor_id and wire.get("signal_id") else True)
        pulse = wire["kind"] == "pulse"
        frequency = reading.get("frequency_hz") if pulse else None
        result["wires"][wire["id"]] = {
            **common, "value": value if available else None, "available": available, "status": status,
            "sample_kind": "derived pulse frequency" if pulse and wire.get("signal_id", "").endswith("frequency_hz") else "sampled speed" if pulse else "illustrative signal voltage" if sensor_id and wire.get("signal_id") else "reference",
            "frequency_hz": frequency if available else None,
            "activity": available and (not pulse or (frequency or 0) > 0),
        }
    return result
