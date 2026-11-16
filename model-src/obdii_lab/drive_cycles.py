"""Official target-speed data and a deterministic virtual driver.

The WLTC Class 3b speed trace is transcribed from UN R154 Annex B1, as
published by the Australian Federal Register of Legislation. Source and
checksum metadata travel with the data. Only the target trace is normative:
our generic vehicle, pedal controller, road model and test preparation are
educational approximations, not a WLTP emissions/consumption test.

DriveCycleRunner owns no thread or wall clock. Its 20 Hz driver updates are
scheduled on VehicleSim's existing 2 ms clock. It changes ordinary pedals and
controls; it never assigns vehicle speed, engine speed or sensor readings.
"""
from __future__ import annotations

from copy import deepcopy
from functools import lru_cache
import json
import math
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .vehicle import VehicleSim


DATA_PATH = Path(__file__).resolve().parent.parent / "data" / "wltc_class3b.json"
DEFAULT_CYCLE = "wltc_class3b"


def _finite_number(value, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(label + " must be a finite number")
    return float(value)


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


@lru_cache(maxsize=1)
def _cycle_data() -> dict:
    data = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    speeds = data["speed_kph"]
    if len(speeds) != 1801 or data["sample_interval_s"] != 1 or data["duration_s"] != 1800:
        raise ValueError("The bundled WLTC trace has an invalid time axis")
    if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or v < 0 for v in speeds):
        raise ValueError("The bundled WLTC trace contains an invalid speed")
    if speeds[0] != 0 or speeds[-1] != 0 or max(speeds) != 131.3:
        raise ValueError("The bundled WLTC trace has invalid endpoint or maximum speeds")
    # Exact integer tenths avoid accepting rounding errors in the source data.
    if sum(round(v * 10) for v in speeds) != 837586:
        raise ValueError("The bundled WLTC trace fails the official checksum")
    for phase in data["phases"]:
        values = speeds[phase["start_s"]:phase["end_s"] + 1]
        if sum(round(v * 10) for v in values) != round(phase["checksum_kph"] * 10):
            raise ValueError("The bundled WLTC phase fails its official checksum")
    return data


def _named_cycle(name: str) -> dict:
    if name != DEFAULT_CYCLE:
        raise ValueError("Unknown drive cycle")
    return _cycle_data()


def cycle_info(name: str = DEFAULT_CYCLE) -> dict:
    """Return JSON-safe metadata and a small preview, without mutable cached data."""
    data = _named_cycle(name)
    result = deepcopy({key: value for key, value in data.items() if key != "speed_kph"})
    result["sample_count"] = len(data["speed_kph"])
    result["preview"] = [[second, data["speed_kph"][second]] for second in range(0, 1801, 10)]
    result["controller"] = "Virtual driver; automatic transmissions only"
    result["driver_period_s"] = DriveCycleRunner.DRIVER_PERIOD_S
    return result


def drive_cycle_catalog() -> list[dict]:
    return [cycle_info()]


def cycle_trace(name: str = DEFAULT_CYCLE) -> list[list[float]]:
    """Return all 1 Hz target samples for charting or export."""
    return [[second, value] for second, value in enumerate(_named_cycle(name)["speed_kph"])]


def target_speed(name: str, seconds: float) -> float:
    """Linearly interpolate the official 1 Hz trace, holding zero outside it."""
    data = _named_cycle(name)
    seconds = _finite_number(seconds, "Cycle time")
    if seconds <= 0 or seconds >= data["duration_s"]:
        return 0.0
    index = int(seconds)
    fraction = seconds - index
    speeds = data["speed_kph"]
    return speeds[index] + (speeds[index + 1] - speeds[index]) * fraction


def target_acceleration(name: str, seconds: float) -> float:
    """Slope of the current target segment, in m/s²; not actual acceleration."""
    data = _named_cycle(name)
    seconds = _finite_number(seconds, "Cycle time")
    if seconds < 0 or seconds >= data["duration_s"]:
        return 0.0
    index = int(seconds)
    return (data["speed_kph"][index + 1] - data["speed_kph"][index]) / 3.6


def cycle_phase(name: str, seconds: float) -> dict:
    data = _named_cycle(name)
    seconds = _finite_number(seconds, "Cycle time")
    for phase in data["phases"]:
        if seconds < phase["end_s"]:
            return deepcopy(phase)
    return deepcopy(data["phases"][-1])


class DriveCycleRunner:
    """Pedal feedback over one existing VehicleSim instance.

    start() requests ignition/start and holds the brake, without ticking time.
    advance() progresses that same simulation, waiting for engine/traction
    readiness before selecting D and starting cycle time. Active pedal values
    belong to this driver; call stop() before handing control back to the user.
    Road conditions and faults can still be changed through advance(inputs).
    """

    DRIVER_PERIOD_S = .05
    PREPARATION_TIMEOUT_S = 8.0
    AUTOMATIC_TYPES = {"automatic_6", "hybrid_power_split", "single_speed"}

    def __init__(self, sim: "VehicleSim", name: str = DEFAULT_CYCLE):
        self.sim = sim
        self.name = name
        self.data = _named_cycle(name)
        self.status = "idle"
        self.note = "Ready to prepare the vehicle for the cycle."
        self._start_tick: int | None = None
        self._preparation_tick: int | None = None
        self._next_control_tick = sim.tick
        self._period_ticks = max(1, round(self.DRIVER_PERIOD_S / sim.DT))
        self._frozen_elapsed = 0.0
        self._integral = 0.0
        self._squared_errors = 0.0
        self._error_samples = 0
        self._max_error = 0.0

    @property
    def complete(self) -> bool:
        return self.status == "complete"

    @property
    def active(self) -> bool:
        return self.status in ("preparing", "active")

    @property
    def elapsed_s(self) -> float:
        if self.status == "active" and self._start_tick is not None:
            return min(self.data["duration_s"], max(0.0, (self.sim.tick - self._start_tick) * self.sim.DT))
        return self._frozen_elapsed

    def _power_ready(self) -> bool:
        sim = self.sim
        if not sim.ignition_on or not sim.start_requested:
            return False
        if sim.is_ice:
            return bool(sim._engine_running and not sim.sensor_effects.get("engine_inhibit"))
        return sim.contactor == "CLOSED" and not sim._bmu_fault and not sim._network_fault

    def _set_pedals(self, throttle: float, brake: float) -> None:
        self.sim.advance(0, {"throttle": _clamp(throttle, 0, 1), "brake": _clamp(brake, 0, 1), "steer_deg": 0.0})

    def start(self) -> dict:
        if self.active:
            return self.snapshot()
        kind = self.sim.configuration.get("transmission_type")
        if kind is not None and kind not in self.AUTOMATIC_TYPES:
            raise ValueError("The automated WLTC driver requires an automatic transmission. Choose automatic in Setup or use manual driving.")
        if self.sim.v * 3.6 > .5:
            raise ValueError("Stop the vehicle before starting a drive cycle")
        self._integral = self._squared_errors = self._max_error = 0.0
        self._error_samples = 0
        self._start_tick = None
        self._frozen_elapsed = 0.0
        self._preparation_tick = self.sim.tick
        self._next_control_tick = self.sim.tick
        self.status = "preparing"
        self.note = "Holding the brake and starting the engine / requesting READY. Cycle time starts when Drive is engaged."
        self._set_pedals(0, .35)
        try:
            self.sim.control("parking_brake", True)
            if self.sim.selector not in ("P", "N"):
                self.sim.control("gear", "P")
            if not self.sim.ignition_on:
                self.sim.control("ignition", True)
            if not self._power_ready():
                self.sim.control("start")
        except ValueError as error:
            self.status = "fault"
            self.note = str(error)
            raise
        return self.snapshot()

    def stop(self) -> dict:
        """Release the virtual pedals immediately; no time or gear change."""
        self._frozen_elapsed = self.elapsed_s
        self.status = "stopped"
        self._integral = 0.0
        self.note = "Manual control. The virtual driver has released both pedals."
        self._set_pedals(0, 0)
        return self.snapshot()

    def _update_driver(self) -> None:
        sim = self.sim
        if self.status == "preparing":
            self._set_pedals(0, .35)
            if self._power_ready():
                sim.control("gear", "D")
                sim.control("parking_brake", False)
                self._start_tick = sim.tick
                self.status = "active"
                self.note = "Virtual driver following the target. Actual speed comes from the vehicle model."
            elif (sim.tick - self._preparation_tick) * sim.DT >= self.PREPARATION_TIMEOUT_S:
                self.status = "fault"
                self.note = "The vehicle did not become ready. Inspect the powertrain and its faults, then restart the cycle."
            return
        if self.status != "active":
            return
        elapsed = self.elapsed_s
        actual = sim.v * 3.6
        target = target_speed(self.name, elapsed)
        error_kph = target - actual
        self._squared_errors += error_kph ** 2
        self._error_samples += 1
        self._max_error = max(self._max_error, abs(error_kph))
        if elapsed >= self.data["duration_s"]:
            self._set_pedals(0, .35)
            self.note = "The target cycle has ended; holding the brake while the vehicle comes to rest."
            if actual < .2:
                self.status = "complete"
                self._frozen_elapsed = float(self.data["duration_s"])
                self.note = "Cycle complete. Brake held; engine/traction remains on. Take over to drive manually."
            return
        if not self._power_ready() or sim.selector != "D" or sim.parking_brake:
            self._set_pedals(0, .35)
            self._integral = 0.0
            self.note = "Power or Drive is unavailable. The target continues; actual motion reflects the vehicle condition."
            return
        if target < .05 and target_speed(self.name, elapsed + .1) < .05:
            self._integral = 0.0
            self._set_pedals(0, .35)
            self.note = "Target stop: holding the brake."
            return
        self.note = "Virtual driver following the target. Actual speed comes from the vehicle model."
        # Feed-forward target acceleration plus PI speed feedback. Force is
        # converted to an estimated pedal position, never imposed on the plant.
        # Small preview compensates the controller/drivetrain update delay.
        error = (target_speed(self.name, elapsed + .05) - actual) / 3.6
        old_integral = self._integral
        self._integral = _clamp(self._integral + error * self.DRIVER_PERIOD_S, -3, 3)
        acceleration = target_acceleration(self.name, elapsed) + .9 * error + .15 * self._integral
        p = sim.p
        road_load = (.5 * p.air_density_kg_m3 * p.drag_area_m2 * sim.v ** 2
                     + p.mass_kg * 9.81 * p.rolling_coefficient
                     + p.mass_kg * 9.81 * math.sin(math.atan(sim.inputs.get("grade_pct", 0) / 100)))
        force = p.mass_kg * _clamp(acceleration, -4, 3) + road_load
        if force >= 0:
            capacity = 5000.0
            if sim.is_ice:
                config = sim.configuration
                ratio = sim.RATIOS[sim.actual_gear - 1]
                peak_at = 2100.0 if config["powertrain"] == "diesel" else 3300.0
                curve = _clamp(1 - ((sim.rpm - peak_at) / (config["redline_rpm"] * .9)) ** 2, .5, 1)
                capacity = config["peak_torque_nm"] * curve * ratio * sim.FINAL_DRIVE * .9 / p.wheel_radius_m
            raw = force / max(500, capacity)
            if raw > .95 and error > 0:
                self._integral = old_integral
            self._set_pedals(min(.95, raw), 0)
        else:
            raw = -force / 7500
            if raw > .85 and error < 0:
                self._integral = old_integral
            self._set_pedals(0, min(.85, raw))

    def state(self, *, at_t: float | None = None, actual_speed_kph: float | None = None) -> dict:
        elapsed = self.elapsed_s
        status = self.status
        if at_t is not None and self._start_tick is not None:
            start_t = self._start_tick * self.sim.DT
            elapsed = _clamp(at_t - start_t, 0, self.data["duration_s"])
            if at_t < start_t:
                status = "preparing"
            elif elapsed < self.data["duration_s"] and status == "complete":
                status = "active"
        target = target_speed(self.name, elapsed) if status in ("active", "complete") else None
        actual = self.sim.v * 3.6 if actual_speed_kph is None else actual_speed_kph
        phase = cycle_phase(self.name, elapsed)
        return {"id": self.name, "label": self.data["label"], "status": status,
                "active": status in ("preparing", "active"), "complete": status == "complete",
                "driver": "virtual driver" if status in ("preparing", "active", "complete") else "manual",
                "elapsed_s": elapsed, "duration_s": self.data["duration_s"],
                "progress": elapsed / self.data["duration_s"], "phase": phase["label"], "phase_id": phase["id"],
                "target_speed_kph": target, "actual_speed_kph": actual,
                "tracking_error_kph": None if target is None else target - actual,
                "target_acceleration_m_s2": target_acceleration(self.name, elapsed) if target is not None else None,
                "tracking_rmse_kph": math.sqrt(self._squared_errors / self._error_samples) if self._error_samples else None,
                "max_tracking_error_kph": self._max_error if self._error_samples else None,
                "throttle": self.sim.inputs.get("throttle", 0), "brake": self.sim.inputs.get("brake", 0),
                "note": self.note, "source_url": self.data["source"]["url"], "scope": self.data["scope"]}

    def decorate_snapshot(self, snapshot: dict, *, historical: bool = False) -> dict:
        metadata = self.state(at_t=snapshot["t"] if historical else None, actual_speed_kph=snapshot["speed_kph"])
        metadata["throttle"] = snapshot["inputs"]["throttle"]
        metadata["brake"] = snapshot["inputs"]["brake"]
        snapshot["drive_cycle"] = metadata
        snapshot["drive_target_kph"] = metadata["target_speed_kph"]
        return snapshot

    def snapshot(self) -> dict:
        return self.decorate_snapshot(self.sim.snapshot())

    def advance(self, seconds: float, inputs: dict | None = None) -> dict:
        seconds = _finite_number(seconds, "seconds")
        if seconds < 0:
            raise ValueError("seconds must be nonnegative")
        if inputs is not None and not isinstance(inputs, dict):
            raise ValueError("inputs must be an object")
        supplied = dict(inputs or {})
        if self.status in ("preparing", "active", "complete", "fault"):
            # Validate even the ignored manual controls so malformed API input
            # cannot pass silently. The explicit stop() action transfers control.
            for key in ("throttle", "brake", "steer_deg"):
                if key in supplied:
                    self.sim._validate_inputs({key: supplied[key]})
                    del supplied[key]
        if supplied:
            self.sim.advance(0, supplied)
        remaining = seconds
        while remaining > 1e-10:
            if self.active and self.sim.tick >= self._next_control_tick:
                self._update_driver()
                self._next_control_tick = self.sim.tick + self._period_ticks
            if self.active:
                # Honour the plant's fractional-step accumulator so arbitrary
                # API chunks cannot move a driver update away from its tick.
                until_control = (self._next_control_tick - self.sim.tick) * self.sim.DT - self.sim._remainder
                chunk = min(remaining, max(self.sim.DT * .25, until_control))
            else:
                chunk = remaining
            before_tick = self.sim.tick
            self.sim.advance(chunk)
            new_history = self.sim.tick // 50 - before_tick // 50
            if new_history:
                for point in self.sim.history[-new_history:]:
                    self.decorate_snapshot(point, historical=True)
            remaining -= chunk
        # Completion is observable at exactly the last target sample, including
        # when an API request ends on that control boundary.
        if self.status == "active" and self.elapsed_s >= self.data["duration_s"] and self.sim.v * 3.6 < .2:
            self._set_pedals(0, .35)
            self.status = "complete"
            self._frozen_elapsed = float(self.data["duration_s"])
            self.note = "Cycle complete. Brake held; engine/traction remains on. Take over to drive manually."
            if self.sim.history and abs(self.sim.history[-1]["t"] - self.sim.t) < 1e-9:
                self.decorate_snapshot(self.sim.history[-1], historical=True)
        return self.snapshot()
