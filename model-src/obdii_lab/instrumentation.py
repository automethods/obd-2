"""Read-only signal probes for the schematic and scope workspace.

IDs are dotted paths into a Sim snapshot. Values are never generated here: this
module adds labels, units, provenance and validity to the plant/controller data.
The specified periods describe the implemented model, not a vehicle requirement.
Virtual connector positions belong to the teaching UI, not an OEM pin database.
"""
from __future__ import annotations

from copy import deepcopy
from typing import Any

ALL = ("engine", "phev", "braking")
VEHICLE = ("phev", "braking")


def _signal(id, label, unit, source, period, group, description,
            kind="analog", profiles=ALL, limits=None):
    record = {"id": id, "label": label, "unit": unit, "source": source,
              "period_ms": period, "group": group, "description": description,
              "kind": kind, "profiles": list(profiles), "provenance": "teaching model"}
    if limits is not None:
        record["range"] = list(limits)  # Suggested scope view, not an enforced physical range.
    return record


_CATALOG = [
    _signal("coolant_c", "Coolant: physical temperature", "°C", "Engine plant", 2, "ECT",
            "True lumped coolant state; distinct from the sensed temperature.", limits=(-40, 140)),
    _signal("sensors.ect_reference_v", "ECT reference supply", "V", "ECU input circuit", 10, "ECT circuit",
            "Nominal 5 V teaching supply while ignition is on; zero when unpowered.", limits=(0, 5.2)),
    _signal("sensors.ect_node_v", "ECT signal: physical node", "V", "Pull-up / NTC divider", 10, "ECT circuit",
            "Voltage at the harness signal node before ADC quantization.", limits=(0, 5.2)),
    _signal("sensors.ect_voltage_v", "ECT signal: ADC voltage", "V", "ECU ADC", 10, "ECT circuit",
            "Voltage reconstructed from the quantized ADC count; high voltage invalidates temperature.", limits=(0, 5.2)),
    _signal("sensors.ect_adc_count", "ECT ADC count", "count", "ECU ADC", 10, "ECT circuit",
            "12-bit ideal ADC by default (0…4095); full scale indicates the modeled open input.", limits=(0, 4095)),
    _signal("sensors.ect_resistance_ohm", "ECT branch resistance", "Ω", "NTC / connector branch", 10, "ECT circuit",
            "Beta-model NTC branch resistance. Null denotes an open branch, never a finite measurement.", limits=(0, 10000)),
    _signal("sensors.ect_current_ma", "ECT branch current", "mA", "Pull-up / NTC divider", 10, "ECT circuit",
            "Current through the reference resistor and thermistor; zero through an open branch.", limits=(0, 2.5)),
    _signal("sensors.sensor_return_v", "Sensor return", "V", "Ideal sensor ground", 10, "ECT circuit",
            "Zero-volt reference in this circuit; ground offset and ground faults are not modeled.", limits=(-0.1, 0.1)),
    _signal("sensors.ect_c", "ECT: reported temperature", "°C", "ECU NTC conversion", 10, "ECT",
            "Inverse NTC conversion. Invalid input uses a -40°C teaching display; consult validity.", limits=(-40, 140)),
    _signal("sensors.ect_used_c", "ECT: control temperature", "°C", "Engine ECU fallback", 10, "ECT",
            "Controller uses a substituted 80°C after the 200 ms high-input persistence timer.", limits=(-40, 140)),
    _signal("sensors.ect_circuit_open", "ECT connector open", "", "Fault injector", 10, "ECT",
            "True when the ECT branch is disconnected in the teaching harness.", kind="digital"),
    _signal("sensors.ect_sensor_valid", "ECT measurement valid", "", "Engine ECU input check", 10, "ECT",
            "True only for an energized, usable ADC conversion.", kind="digital"),
    _signal("sensors.ect_high_input", "ECT high-voltage check", "", "Engine ECU input check", 10, "ECT",
            "ADC voltage at or above 99% of Vref; 4.95 V with the default supply.", kind="digital"),
    _signal("ect_fault_elapsed_s", "ECT high-input persistence", "s", "Engine ECU monitor", 10, "ECT",
            "Elapsed high-input time; pending/fallback at 0.20 s, confirmation at 0.50 s.", limits=(0, 1)),
    _signal("ect_derate_factor", "Engine torque multiplier", "ratio", "Engine ECU fallback", 10, "Engine",
            "Requested engine torque multiplier: 1 normally, 0.65 after ECT fallback.", limits=(0, 1)),
    _signal("rpm", "Engine speed", "rpm", "Engine plant", 2, "Engine",
            "Mean crankshaft speed, not an angle-resolved crank waveform.", limits=(0, 6500)),
    _signal("engine_torque_nm", "Engine torque", "N·m", "Engine plant", 2, "Engine",
            "Mean torque in the active stand or hybrid engine model.", limits=(0, 180)),
    _signal("engine_power_kw", "Engine delivered power", "kW", "Engine plant", 2, "Engine",
            "Dyno load power on the engine stand; wheel-side engine contribution in a vehicle profile.", limits=(0, 80)),
    _signal("engine_shaft_kw", "Engine shaft power", "kW", "Engine plant", 2, "Engine",
            "Mechanical shaft output, including the generator share in hybrid operation.", limits=(0, 80)),
    _signal("maf_g_s", "Mass airflow", "g/s", "Mean-value intake estimate", 2, "Engine",
            "Illustrative airflow derived from modeled fuel flow and air/fuel ratio.", limits=(0, 100)),
    _signal("fuel_l_h", "Fuel flow", "L/h", "Engine plant", 2, "Engine",
            "Modeled fuel use with fixed efficiency and idle overhead.", limits=(0, 30)),
    _signal("engine_running", "Engine running", "", "Engine state machine", 2, "Engine",
            "True while the simplified engine combustion state is running.", kind="digital"),
    _signal("engine_requested", "Engine run request", "", "Engine control", 20, "Engine",
            "Controller request to start or keep the engine operating.", kind="digital"),
    _signal("inputs.throttle", "Accelerator command", "ratio", "Driver / scenario", 2, "Driver",
            "Normalized driver demand; not an electrical pedal-sensor voltage.", limits=(0, 1)),
    _signal("inputs.brake", "Brake command", "ratio", "Driver / scenario", 2, "Driver",
            "Normalized braking demand; not a measured hydraulic pressure.", limits=(0, 1)),
    _signal("sensors.accelerator_pct", "Accelerator position", "%", "Ideal pedal input", 2, "Driver",
            "Driver demand as a percentage; no dual-track electrical pedal circuit is modeled.", limits=(0, 100)),
    _signal("sensors.brake_pct", "Brake pedal position", "%", "Ideal pedal input", 2, "Driver",
            "Braking demand as a percentage; not hydraulic pressure or pedal force.", limits=(0, 100)),
    _signal("sensors.steer_deg", "Road-wheel steering", "°", "Ideal steering input", 2, "Driver",
            "Commanded road-wheel angle; not steering-wheel angle or a modeled position sensor voltage.", profiles=VEHICLE, limits=(-10, 10)),
    _signal("speed_kph", "Vehicle speed", "km/h", "Longitudinal plant", 2, "Vehicle",
            "Forward body speed. Engine stand speed is fixed at zero.", limits=(0, 130)),
    _signal("distance_m", "Distance travelled", "m", "Longitudinal plant integration", 2, "Vehicle",
            "Integral of forward model speed since reset; unrelated to a vehicle's stored odometer.", profiles=VEHICLE, limits=(0, 2000)),
    _signal("acceleration_m_s2", "Longitudinal acceleration", "m/s²", "Longitudinal force balance", 2, "Vehicle",
            "Net tire force minus road load, divided by model mass. A plant result, not a simulated accelerometer voltage.", profiles=VEHICLE, limits=(-5, 4)),
    _signal("energy.fuel_l", "Fuel used since reset", "L", "Engine fuel-flow integration", 2, "Engine",
            "Integrated modeled fuel flow; no fuel tank level or real consumption measurement is implied.", limits=(0, 1)),
    _signal("load_pct", "Calculated engine load", "%", "Mean-value engine estimate", 2, "Engine",
            "Modeled engine shaft demand relative to the teaching rating; the diagnostic application may quantize this value.", limits=(0, 100)),
    _signal("battery_voltage_v", "Pack voltage: physical", "V", "Battery plant", 2, "Battery",
            "Current terminal voltage; remains a plant truth when BMU reports become stale.", profiles=VEHICLE, limits=(250, 420)),
    _signal("battery_current_a", "Pack current: physical", "A", "Battery plant", 2, "Battery",
            "Positive discharge and negative charging current.", profiles=VEHICLE, limits=(-150, 250)),
    _signal("soc_pct", "SOC: physical model", "%", "Battery coulomb count", 2, "Battery",
            "Lumped model charge state; a perfect-state signal, not a production estimator.", profiles=VEHICLE, limits=(0, 100)),
    _signal("battery_temp_c", "Pack temperature", "°C", "Battery thermal plant", 2, "Battery",
            "One-node pack temperature.", profiles=VEHICLE, limits=(-20, 65)),
    _signal("battery_power_kw", "Battery terminal power", "kW", "Battery plant", 2, "Battery",
            "Positive discharge; negative charging. Includes conversion and auxiliary effects.", profiles=VEHICLE, limits=(-45, 85)),
    _signal("sensors.dc_link_v", "Inverter DC link", "V", "Precharge plant", 2, "Battery",
            "Behavioral precharge voltage. Capacitor charging energy is not represented.", profiles=VEHICLE, limits=(0, 420)),
    _signal("battery_charge_limit_kw", "BMU charge permission", "kW", "BMU computation", 100, "Battery",
            "Current charge-acceptance ceiling from temperature, SOC and current limits.", profiles=VEHICLE, limits=(0, 40)),
    _signal("battery_discharge_limit_kw", "BMU discharge permission", "kW", "BMU computation", 100, "Battery",
            "Current discharge ceiling, also bounded by the equivalent-circuit maximum.", profiles=VEHICLE, limits=(0, 80)),
    _signal("sensors.cell_min_v", "Minimum cell input", "V", "BMU cell-input model", 100, "Battery",
            "Pack/96 proxy with a nominal spread, or an injected low-cell input; not 96 cell states.", profiles=VEHICLE, limits=(2, 4.5)),
    _signal("bmu_report.pack_voltage_v", "BMU report: pack voltage", "V", "Last BMU status packet", 100, "Network",
            "Held last-received voltage. A stale packet must not be mistaken for a new sample.", profiles=VEHICLE, limits=(250, 420)),
    _signal("bmu_report.pack_current_a", "BMU report: pack current", "A", "Last BMU status packet", 100, "Network",
            "Held last-received battery current; positive discharge.", profiles=VEHICLE, limits=(-150, 250)),
    _signal("bmu_report.soc_pct", "BMU report: SOC", "%", "Last BMU status packet", 100, "Network",
            "Last-received SOC, distinct from the live model state during a dropout.", profiles=VEHICLE, limits=(0, 100)),
    _signal("bmu_report.charge_limit_kw", "BMU report: charge limit", "kW", "Last BMU status packet", 100, "Network",
            "Held last-received charge permission. The supervisor separately checks freshness.", profiles=VEHICLE, limits=(0, 40)),
    _signal("sensors.bmu_message_age_ms", "BMU message age", "ms", "Hybrid freshness monitor", 2, "Network",
            "Simulation time since the last received packet; timeout uses >300 ms.", profiles=VEHICLE, limits=(0, 500)),
    _signal("motor_power_kw", "Motor mechanical power", "kW", "Motor / wheel plant", 2, "Hybrid",
            "Positive propulsion, negative regenerative contribution.", profiles=VEHICLE, limits=(-50, 80)),
    _signal("regen_kw", "Regenerative braking power", "kW", "Brake blending model", 2, "Hybrid",
            "Positive mechanical recovery before generator/inverter losses.", profiles=VEHICLE, limits=(0, 50)),
    _signal("friction_brake_kw", "Friction brake power", "kW", "Wheel brake plant", 2, "Braking",
            "Mechanical dissipation through the friction brake torques.", profiles=VEHICLE, limits=(0, 200)),
    _signal("yaw_rate_deg_s", "Yaw rate: model", "°/s", "Reduced yaw plant", 2, "Braking",
            "Approximate yaw state; no lateral tire or sideslip dynamics.", profiles=VEHICLE, limits=(-45, 45)),
    _signal("yaw_target_deg_s", "Yaw reference", "°/s", "ABS / yaw supervisor", 10, "Braking",
            "Bicycle-reference yaw from vehicle speed and road-wheel steering.", profiles=VEHICLE, limits=(-45, 45)),
    _signal("abs_active", "ABS modulating", "", "ABS controller", 10, "Braking",
            "At least one wheel is in the modeled pressure-modulation state.", kind="digital", profiles=VEHICLE),
    _signal("esp_active", "Yaw assist active", "", "Simplified yaw controller", 10, "Braking",
            "Teaching corrective brake request, not validated production ESC.", kind="digital", profiles=VEHICLE),
    _signal("contactor", "HV contactor state", "", "BMU state machine", 100, "Battery",
            "OFF, PRECHARGE, CLOSED or FAULT; logical state, not measured relay contacts.", kind="state", profiles=VEHICLE),
    _signal("mode", "Operating mode", "", "Supervisory state machine", 20, "Controller",
            "Current behavioral engine or hybrid supervisory state.", kind="state"),
    _signal("mil", "Emissions MIL", "", "Engine diagnostic monitor", 10, "Diagnostics",
            "True for a stored confirmed emissions DTC in this teaching subset.", kind="digital"),
]

for index, corner in enumerate(("FL", "FR", "RL", "RR")):
    _CATALOG.extend([
        _signal(f"wheel_speeds_kph.{index}", f"{corner} wheel speed: physical", "km/h", "Wheel plant", 2, "Braking",
                "True wheel peripheral speed, still available as a model probe when its sensor drops out.", profiles=VEHICLE, limits=(0, 130)),
        _signal(f"sensors.wheel_speeds_kph.{index}", f"{corner} wheel speed sensor", "km/h", "Ideal wheel sensor", 2, "Braking",
                "Wheel peripheral speed; a dropped sensor is unavailable even while the physical wheel moves.", profiles=VEHICLE, limits=(0, 130)),
        _signal(f"slips.{index}", f"{corner} braking slip", "ratio", "Wheel / vehicle plant", 2, "Braking",
                "(Vehicle speed - wheel peripheral speed) / max(vehicle speed, 3 m/s).", profiles=VEHICLE, limits=(-0.2, 1)),
        _signal(f"brake_pressure.{index}", f"{corner} brake modulation", "ratio", "ABS controller", 10, "Braking",
                "Normalized torque modulation factor, not hydraulic pressure in bar.", profiles=VEHICLE, limits=(0, 1)),
    ])


def signal_catalog() -> list[dict[str, Any]]:
    """Return independent metadata objects safe for a caller to annotate."""
    return deepcopy(_CATALOG)


def value_at(snapshot: dict[str, Any], signal_id: str) -> Any:
    """Resolve a signal path without evaluating code or modifying state."""
    value: Any = snapshot
    try:
        for part in signal_id.split("."):
            value = value[int(part)] if isinstance(value, (list, tuple)) else value[part]
    except (KeyError, IndexError, TypeError, ValueError):
        return None
    return value


def _validity(snapshot, signal_id, value):
    sensed = snapshot.get("sensors", {})
    if signal_id == "sensors.ect_resistance_ohm" and sensed.get("ect_circuit_open"):
        return "invalid", "Open branch: no finite resistance is reported."
    if signal_id in ("sensors.ect_c", "sensors.ect_adc_count", "sensors.ect_used_c"):
        if not sensed.get("ect_powered", snapshot.get("inputs", {}).get("ignition", False)):
            return "unavailable", "ECU sensor circuit is not energized."
        if signal_id == "sensors.ect_used_c" and snapshot.get("ect_derate_factor", 1) < 1:
            return "substituted", "Control uses the documented 80°C fallback."
        if not sensed.get("ect_sensor_valid", True):
            return "invalid", "Electrical input cannot represent a valid temperature."
    if signal_id.startswith("sensors.wheel_speeds_kph.") and value is None:
        return "invalid", "Wheel-speed input is missing; the physical wheel state is separate."
    if value is None:
        return "unavailable", "No sample exists for this signal."
    if signal_id.startswith("bmu_report.") and sensed.get("bmu_message_age_ms", 0) > 300.0001:
        return "stale", "Last-received BMU status is older than 300 ms."
    return "valid", "Available model signal."


def read_signals(snapshot: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Return live records keyed by stable signal ID, without changing snapshot.

    Values remain available for invalid/stale signals to aid diagnosis; validity
    is mandatory display context. Uninstalled module values become None.
    """
    records = {}
    for metadata in signal_catalog():
        signal_id = metadata["id"]
        value = value_at(snapshot, signal_id)
        if snapshot.get("profile") not in metadata["profiles"]:
            value, validity, note = None, "unavailable", "Module is not installed in this profile."
        else:
            validity, note = _validity(snapshot, signal_id, value)
        records[signal_id] = {**metadata, "value": deepcopy(value), "validity": validity,
                              "validity_note": note, "t": snapshot.get("t", 0)}
    return records


def signals(snapshot: dict[str, Any]) -> list[dict[str, Any]]:
    """List form of read_signals(), useful for a table or exported probe list."""
    return list(read_signals(snapshot).values())
