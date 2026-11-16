"""Reproducible experiment runner and exports. Python standard library only."""
from __future__ import annotations

import csv
import io
import json
import math
from dataclasses import asdict
from pathlib import Path

from . import __version__
from .core import Sim, SCENARIOS
from .diagnostics import DiagnosticServer
from .instrumentation import value_at

CSV_FIELDS = [
    "t", "profile", "scenario", "speed_kph", "rpm", "coolant_c", "ambient_c",
    "throttle_pct", "load_pct", "maf_g_s", "fuel_l_h", "soc_pct",
    "battery_voltage_v", "battery_current_a", "battery_temp_c", "battery_power_kw",
    "engine_power_kw", "engine_shaft_kw", "generator_kw", "motor_power_kw", "regen_kw", "friction_brake_kw",
    "battery_discharge_limit_kw", "battery_charge_limit_kw", "distance_m", "acceleration_m_s2",
    "mode", "contactor", "abs_active", "esp_active", "yaw_rate_deg_s",
    "yaw_target_deg_s", "mil", "dtcs", "pending_dtcs",
]

# Additive columns preserve the previous CSV columns and their ordering. A
# missing/open electrical value stays blank; it must not silently become zero.
INSTRUMENT_CSV_PATHS = {
    "ect_sample_time_s": "sensors.ect_sample_time_s",
    "ect_reference_v": "sensors.ect_reference_v",
    "ect_node_v": "sensors.ect_node_v",
    "ect_voltage_v": "sensors.ect_voltage_v",
    "ect_adc_count": "sensors.ect_adc_count",
    "ect_adc_full_scale": "sensors.ect_adc_full_scale",
    "ect_resistance_ohm": "sensors.ect_resistance_ohm",
    "ect_current_ma": "sensors.ect_current_ma",
    "ect_circuit_open": "sensors.ect_circuit_open",
    "ect_powered": "sensors.ect_powered",
    "ect_sensor_valid": "sensors.ect_sensor_valid",
    "ect_high_input": "sensors.ect_high_input",
    "ect_high_threshold_v": "sensors.ect_high_threshold_v",
    "ect_fault_elapsed_s": "ect_fault_elapsed_s",
    "ect_derate_factor": "ect_derate_factor",
    "engine_torque_nm": "engine_torque_nm",
    "engine_running": "engine_running",
    "engine_requested": "engine_requested",
    "bmu_report_time_s": "bmu_report.t",
    "bmu_report_pack_voltage_v": "bmu_report.pack_voltage_v",
    "bmu_report_pack_current_a": "bmu_report.pack_current_a",
    "bmu_report_soc_pct": "bmu_report.soc_pct",
    "bmu_report_pack_temp_c": "bmu_report.pack_temp_c",
    "bmu_report_cell_min_v": "bmu_report.cell_min_v",
    "bmu_report_cell_max_v": "bmu_report.cell_max_v",
    "bmu_report_charge_limit_kw": "bmu_report.charge_limit_kw",
    "bmu_report_discharge_limit_kw": "bmu_report.discharge_limit_kw",
}

# These columns are additive so older analysis scripts retain their original
# fields. Empty values describe absent equipment, not zero-valued sensors.
VEHICLE_CSV_PATHS = {
    "configuration_id": "configuration_id", "powertrain": "vehicle.configuration.powertrain",
    "engine_detail": "vehicle.configuration.engine_detail", "cylinders": "vehicle.configuration.cylinders",
    "abs_installed": "vehicle.configuration.abs_installed", "esp_installed": "vehicle.configuration.esp_installed",
    "can_bitrate": "vehicle.configuration.can_bitrate", "ignition_state": "vehicle.ignition",
    "start_state": "vehicle.start_state", "selector": "vehicle.selector", "gear": "vehicle.gear",
    "gear_ratio": "vehicle.gear_ratio", "signed_speed_kph": "signed_speed_kph",
    "signed_distance_m": "signed_distance_m", "parking_brake": "vehicle.parking_brake",
    "abs_enabled": "vehicle.abs_enabled", "esp_enabled": "vehicle.esp_enabled",
    "torque_factor": "vehicle.torque_factor", "low_voltage_v": "vehicle.low_voltage_v",
    "fuel_pct": "vehicle.fuel_pct", "fuel_remaining_l": "vehicle.fuel_l",
    "initial_odometer_km": "vehicle.configuration.initial_odometer_km",
    "odometer_km": "vehicle.odometer_km", "trip_distance_km": "vehicle.trip_distance_km",
}


def scenario_info(name):
    return next((s for s in SCENARIOS if s["id"] == name), None)


def diagnostic_server(sim):
    return DiagnosticServer(sim.snapshot, clear_callback=sim.clear_emissions_dtcs)


def csv_text(history):
    stream = io.StringIO(newline="")
    fields = CSV_FIELDS + ["ect_sensed_c", "ect_used_c", "bmu_message_age_ms"] + [f"wheel_{p}_kph" for p in ("fl", "fr", "rl", "rr")] + [
        f"slip_{p}" for p in ("fl", "fr", "rl", "rr")]
    fields += list(INSTRUMENT_CSV_PATHS) + ["bmu_report_stale"] + list(VEHICLE_CSV_PATHS)
    fields += [f"wheel_{p}_measured_kph" for p in ("fl", "fr", "rl", "rr")]
    sensor_ids = sorted({identifier for point in history for identifier, reading in point.get("vehicle_sensors", {}).items()
                         if reading.get("installed", False)})
    sampled_fields = ("value", "validity", "sampled_at", "age_ms", "signal_voltage_v", "frequency_hz")
    fields += [f"sensor_{identifier}_{field}" for identifier in sensor_ids for field in sampled_fields]
    writer = csv.DictWriter(stream, fieldnames=fields, extrasaction="ignore")
    writer.writeheader()
    for point in history:
        row = {k: point.get(k, "") for k in CSV_FIELDS}
        for key in ("dtcs", "pending_dtcs"):
            row[key] = "|".join(row[key]) if isinstance(row[key], list) else row[key]
        for field, key in (("ect_sensed_c", "ect_c"), ("ect_used_c", "ect_used_c"), ("bmu_message_age_ms", "bmu_message_age_ms")):
            row[field] = point.get("sensors", {}).get(key, "")
        for i, p in enumerate(("fl", "fr", "rl", "rr")):
            row[f"wheel_{p}_kph"] = point.get("wheel_speeds_kph", [0]*4)[i]
            row[f"slip_{p}"] = point.get("slips", [0]*4)[i]
        row.update({field: value_at(point, path) for field, path in INSTRUMENT_CSV_PATHS.items()})
        row.update({field: value_at(point, path) for field, path in VEHICLE_CSV_PATHS.items()})
        for i, corner in enumerate(("fl", "fr", "rl", "rr")):
            row[f"wheel_{corner}_measured_kph"] = value_at(point, f"sensors.wheel_speeds_kph.{i}")
        for identifier in sensor_ids:
            reading = point.get("vehicle_sensors", {}).get(identifier, {})
            row.update({f"sensor_{identifier}_{field}": reading.get(field) for field in sampled_fields})
        message_age = point.get("sensors", {}).get("bmu_message_age_ms", 0)
        row["bmu_report_stale"] = message_age > 300.0001 if point.get("bmu_report") and isinstance(message_age, (int, float)) else ""
        writer.writerow(row)
    return stream.getvalue()


def summary(sim):
    samples = sim.history or [sim.snapshot()]
    end = sim.snapshot()
    def peak(key):
        values = [float(s[key]) for s in samples if isinstance(s.get(key), (int, float)) and math.isfinite(s[key])]
        return max(values) if values else None
    # Stop is detected after the vehicle has moved, rather than at its initial rest.
    moving = False
    stopped_at = None
    for s in samples:
        moving |= s["speed_kph"] > 5
        if moving and s["speed_kph"] < 0.5 and stopped_at is None:
            stopped_at = s["t"]
    result = {
        "elapsed_s": end["t"], "peak_speed_kph": peak("speed_kph"),
        "peak_rpm": peak("rpm"), "final_soc_pct": end["soc_pct"],
        "final_coolant_c": end["coolant_c"], "peak_regen_kw": peak("regen_kw"),
        "abs_sample_count": sum(bool(s["abs_active"]) for s in samples),
        "esp_sample_count": sum(bool(s["esp_active"]) for s in samples),
        "first_stop_after_moving_s": stopped_at,
        "final_dtcs": end["dtcs"], "final_module_dtc": end.get("module_dtc", {}),
        "final_mode": end["mode"], "energy": end.get("energy", {}),
    }
    if "vehicle" in end:
        result.update(configuration_id=end["vehicle"]["configuration"]["id"],
                      powertrain=end["vehicle"]["configuration"]["powertrain"],
                      final_selector=end["vehicle"]["selector"], final_gear=end["vehicle"]["gear"],
                      final_start_state=end["vehicle"]["start_state"],
                      signed_distance_m=end.get("signed_distance_m"),
                      sensor_module_faults=end.get("sensor_dtcs", {}).get("modules", {}))
    return result


def bundle(sim, trace=None):
    end = sim.snapshot()
    result = {"schema_version": "obdii-lab.run.v1", "simulator_version": __version__,
            "provenance": "Synthetic educational model; not Toyota calibration or measured vehicle data.",
            "profile": end["profile"], "scenario": end["scenario"],
            "parameters": asdict(sim.p), "integration_step_s": sim.DT,
            "controller_periods_ms": sim.PERIODS_MS,
            "summary": summary(sim), "events": sim.events, "final_state": end,
            "history": sim.history, "diagnostics": trace or []}
    if "vehicle" in end:
        result["vehicle_configuration"] = end["vehicle"]["configuration"]
        result["measurement_notes"] = {
            "availability": "Null values mean equipment or a valid measurement is absent; they do not mean zero.",
            "wheels": "Top-level wheel speeds are physical plant values; sensors.wheel_speeds_kph and vehicle_sensors are sampled measurements.",
            "timing": "History is captured every 100 ms. Sensor sampled_at and validity retain each channel's own acquisition timing.",
            "parameters": "Shared plant constants are not an equipment inventory. vehicle_configuration identifies fitted engine, battery and brake electronics.",
            "profile": "The legacy profile field names the shared simulation engine, not the selected vehicle type. Use vehicle_configuration.powertrain and vehicle_configuration.label for the configured vehicle.",
            "odometer": "Configured starting reading plus physical distance traveled in either direction. Trip resets only its distance baseline. A new vehicle/run starts from its configured reading; readings are not persisted between launches.",
            "gearbox": end["vehicle"]["transmission_model"],
        }
    return result


def run_experiment(scenario="engine_warmup", duration=None, profile=None, config=None, inputs=None):
    info = scenario_info(scenario)
    if scenario != "manual" and info is None:
        raise ValueError(f"Unknown scenario: {scenario}")
    profile = profile or (info["profile"] if info else "engine")
    duration = float(duration if duration is not None else (info["duration"] if info else 30))
    if not 0 < duration <= 3600:
        raise ValueError("Duration must be greater than 0 and at most 3600 seconds.")
    sim = Sim(profile=profile, scenario=scenario, config=config or {})
    # Small chunks keep CLI and UI paths identical and bound work per call.
    remaining = duration
    while remaining > 1e-9:
        step = min(1.0, remaining)
        sim.advance(step, inputs)
        remaining -= step
    return sim


def trace_text(records):
    lines = ["OBD II Lab - generated diagnostic transcript",
             "In-memory CAN/ISO-TP frames; no physical bus or measured frame timestamps.", ""]
    for record in records:
        lines.append(f"Request payload: {record.get('request_hex', '')}")
        for frame in record.get("frames", []):
            lines.append(f"{frame['direction']:16s} {frame['id']}  {frame['data']}  {frame.get('label', '')}")
        lines.append(f"Decoded: {record.get('meaning', '')}")
        lines.append("")
    return "\n".join(lines)


def export_run(sim, prefix, requests=None):
    prefix = Path(prefix)
    prefix.parent.mkdir(parents=True, exist_ok=True)
    diag = diagnostic_server(sim)
    default_requests = ["01 00", "01 0C", "01 05", "01 0D", "03", "07", "09 02"]
    if hasattr(sim, "configuration"):
        from .scanner import ScannerSession
        scanner = ScannerSession(sim, diag)
        combustion = sim.configuration["powertrain"] != "bev"
        scanner.connect("can11_250" if sim.configuration.get("can_bitrate") == 250000 else "can11_500",
                        "ecu" if combustion else "inverter")
        trace = [scanner.request(p) for p in (requests if requests is not None else default_requests if combustion else [])]
    else:
        trace = [diag.request(p) for p in (requests or default_requests)]
    outputs = {"csv": prefix.with_suffix(".csv"), "json": prefix.with_suffix(".json"),
               "trace": prefix.with_suffix(".trace.txt")}
    outputs["csv"].write_text(csv_text(sim.history), encoding="utf-8")
    outputs["json"].write_text(json.dumps(bundle(sim, trace), indent=2, allow_nan=False), encoding="utf-8")
    outputs["trace"].write_text(trace_text(trace), encoding="utf-8")
    return outputs
