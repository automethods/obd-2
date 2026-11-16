"""Fixed MAF contact-duration / sample-phase experiment using the ordinary model."""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
from pathlib import Path

from .vehicle import VehicleSim
from .vehicle_systems import SensorBank

DURATIONS_MS = (10, 20, 50, 100, 600)
PHASES_MS = (2, 10, 24, 48)
ROOT = Path(__file__).resolve().parents[1]


def configured_vehicle():
    sim = VehicleSim("petrol_advanced")
    sim.sensor_bank = SensorBank(sim.configuration)
    sim.sensor_bank.sample(sim.raw_snapshot())
    sim.control("ignition", True)
    sim.control("start")
    sim.advance(1, {"brake": .3})
    sim.control("gear", "D")
    sim.control("parking_brake", False)
    sim.advance(1, {"throttle": .35, "brake": 0})
    return sim


def run_case(duration_ms=None, phase_ms=2, *, sustained=False):
    """One pulse, observed every 2 ms; one separate vehicle per case.

    The open interval is [opening, closing). Both contact changes precede a
    controller task at the same tick. Controller timestamps identify that task;
    observed_at_s is its following integration boundary, up to 2 ms later.
    """
    if phase_ms not in PHASES_MS or duration_ms not in (None, *DURATIONS_MS):
        raise ValueError("Choose an article matrix duration and phase.")
    sim = configured_vehicle()
    opening = sim.tick + phase_ms // 2 if duration_ms is not None or sustained else None
    closing = opening + duration_ms // 2 if duration_ms is not None and not sustained else None
    name = "sustained_open" if sustained else "healthy" if duration_ms is None else f"maf_{duration_ms}ms_phase_{phase_ms}ms"
    result = dict(id=name, duration_ms=duration_ms, phase_ms=phase_ms if opening is not None else None,
                  opening_s=round(opening * sim.DT, 6) if opening is not None else None,
                  closing_s=round(closing * sim.DT, 6) if closing is not None else None,
                  first_invalid_sample_s=None, first_control_effect_s=None,
                  first_pending_s=None, first_stored_s=None, recovery_sample_s=None,
                  minimum_torque_factor=1., contact_events=[])
    trace = []
    # Common 1.8 s window covers the longest finite pulse plus >1 s recovery.
    for _ in range(900):
        task_time = round(sim.t, 6)
        if sim.tick in (opening, closing):
            connected = sim.tick == closing
            sim.set_connection("maf", connected)
            result["contact_events"].append(dict(t=task_time, connected=connected))
        controller_due = sim.tick % 5 == 0
        sim.advance(sim.DT)
        reading = sim.sensor_bank.readings["maf"]
        factor = sim.sensor_effects["torque_factor"]
        pending = "P0102" in sim.sensor_bank.pending_dtcs
        stored = "P0102" in sim.sensor_bank.stored_dtcs
        invalid = reading["validity"] == "invalid"
        if invalid and result["first_invalid_sample_s"] is None:
            result["first_invalid_sample_s"] = reading["sampled_at"]
        for key, active in (("first_control_effect_s", factor < 1),
                            ("first_pending_s", pending), ("first_stored_s", stored)):
            if active and result[key] is None:
                result[key] = task_time
        if result["first_invalid_sample_s"] is not None and not invalid and result["recovery_sample_s"] is None:
            result["recovery_sample_s"] = reading["sampled_at"]
        result["minimum_torque_factor"] = min(result["minimum_torque_factor"], factor)
        trace.append(dict(observed_at_s=sim.t, controller_at_s=task_time if controller_due else None,
                          contact_connected=sim.sensor_bank.connections["maf"],
                          sampled_at_s=reading["sampled_at"], validity=reading["validity"],
                          physical_maf_g_s=reading["physical_value"], measured_maf_g_s=reading["value"],
                          torque_factor=factor, pending_P0102=pending, stored_P0102=stored))
    result.update(final_validity=reading["validity"], final_torque_factor=factor,
                  final_stored_P0102=stored, final_pending_P0102=pending)
    return dict(summary=result, trace=trace)


def source_hashes():
    paths = ["obdii_lab/core.py", "obdii_lab/vehicle.py", "obdii_lab/vehicle_systems.py",
             "obdii_lab/article_experiment.py"]
    return {p: hashlib.sha256((ROOT / p).read_bytes()).hexdigest() for p in paths}


def run_matrix():
    cases = [run_case()]
    cases += [run_case(d, p) for d in DURATIONS_MS for p in PHASES_MS]
    cases += [run_case(sustained=True)]
    return dict(experiment="MAF single-contact interruption: duration and sample phase", schema_version=1,
                configuration="petrol_advanced", source_sha256=source_hashes(),
                conditions=dict(plant_step_s=.002, controller_period_s=.01, maf_period_s=.05,
                                warmup_s=2, throttle=.35, brake=0, gear="D", road_mu=.85, grade_pct=0,
                                observation_end_s=3.8, pending_delay_s=.2, stored_delay_s=.5,
                                missing_maf_torque_factor=.7, defaults=configured_vehicle().configuration),
                interpretation="Deterministic teaching model; phase counts are not real-world probabilities. "
                               "No OEM calibration, physical validation or student-outcome study is claimed.",
                cases=cases)


def summary_csv(report):
    out = io.StringIO(newline="")
    rows = [{k: v for k, v in c["summary"].items() if k != "contact_events"} for c in report["cases"]]
    writer = csv.DictWriter(out, fieldnames=list(rows[0]))
    writer.writeheader()
    writer.writerows(rows)
    return out.getvalue()


def write_report(report, destination):
    destination = Path(destination)
    destination.mkdir(parents=True, exist_ok=True)
    (destination / "matrix.json").write_text(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + "\n")
    (destination / "summary.csv").write_text(summary_csv(report))
    for case in report["cases"]:
        with (destination / (case["summary"]["id"] + ".csv")).open("w", newline="") as stream:
            writer = csv.DictWriter(stream, fieldnames=list(case["trace"][0]))
            writer.writeheader()
            writer.writerows(case["trace"])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("article_results"))
    args = parser.parse_args()
    report = run_matrix()
    write_report(report, args.output)
    print(summary_csv(report), end="")


if __name__ == "__main__":
    main()
