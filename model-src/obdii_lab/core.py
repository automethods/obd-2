"""Deterministic, dependency-free teaching plant and controller models.

This is a GENERIC engine stand / parallel-hybrid vehicle, not a Toyota ECU,
Prius power-split model, homologation model, or safety controller. Every numeric
calibration below is an explicit teaching assumption, not OEM calibration.

SI units internally; battery current/power are positive on discharge. Wheels:
FL, FR, RL, RR. The plant uses 2 ms Euler steps; the ECU/ABS, supervisor and BMU
run at 10, 20 and 100 ms. advance() carries a fractional-step remainder.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict
import math
from typing import Any


SCENARIOS = [
    {"id": "manual", "title": "Manual laboratory", "profile": "engine", "duration": 60,
     "description": "Choose a profile and change driver inputs or inject a sensor/network fault."},
    {"id": "engine_warmup", "title": "1 · Engine start and warm-up", "profile": "engine", "duration": 120,
     "description": "Start an engine on a virtual dynamometer, apply load and observe thermal inertia and OBD signals."},
    {"id": "ect_open", "title": "2 · Coolant-sensor open circuit", "profile": "engine", "duration": 15,
     "description": "At 3 s, open the ECT sensor circuit. Observe -40 °C, fallback temperature, pending and confirmed P0118."},
    {"id": "phev_city", "title": "3 · Electric / hybrid / regenerative driving", "profile": "phev", "duration": 60,
     "description": "Precharge, electric launch, braking, a high-demand hybrid acceleration and another stop."},
    {"id": "low_soc", "title": "4 · Low state of charge", "profile": "phev", "duration": 45,
     "description": "Begin at 22% SOC. The supervisor starts the engine and requests 5 kW of generator shaft power."},
    {"id": "abs_split_mu", "title": "5 · ABS on a split-friction road", "profile": "braking", "duration": 12,
     "description": "Brake from 80 km/h after 1 s: left-road friction 0.20, right 0.80. Repeat with ABS disabled."},
    {"id": "regen_limit", "title": "6 · Regeneration limited by high SOC", "profile": "braking", "duration": 35,
     "description": "Begin at 97.5% SOC and 60 km/h; the BMU's taper forces friction brakes to supply most braking."},
    {"id": "bmu_timeout", "title": "7 · Missing BMU heartbeat", "profile": "phev", "duration": 20,
     "description": "Drop synthetic BMU status messages at 8 s. After 300 ms, inhibit traction and open the contactor."},
    {"id": "cell_low", "title": "8 · Low cell-voltage input", "profile": "phev", "duration": 20,
     "description": "Force one cell-voltage sensor to 2.30 V at 8 s. The teaching BMU latches a shutdown."},
]


# Short original demonstration routes, not measured traffic or certification
# drive cycles. Cubic transitions make requested speed and its derivative
# continuous at each boundary. The driver controls pedals; the plant determines
# actual speed, wheel slip, engine operation, energy use and fault consequences.
DRIVE_CYCLES = {
    "city_drive": {
        "title": "Live · Town and traffic lights", "duration": 90,
        "description": "A rolling start, a town cruise, traffic lights, a brisk pull-away and a final stop. Smooth pedal commands drive the same physical model.",
        "initial_config": {"initial_speed_kph": 12.0, "initial_coolant_c": 65.0, "initial_soc_pct": 60.0},
        "phases": [
            (0, 4, 12, 18, "Rolling start"),
            (4, 14, 18, 38, "Accelerate through town"),
            (14, 24, 38, 38, "Town cruise"),
            (24, 33, 38, 0, "Brake for the lights"),
            (33, 38, 0, 0, "Wait at the lights"),
            (38, 48, 0, 60, "Pull away onto the bypass"),
            (48, 63, 60, 60, "Steady bypass cruise"),
            (63, 73, 60, 24, "Slow for a bend"),
            (73, 79, 24, 24, "Gentle bend"),
            (79, 88, 24, 0, "Brake for the crossing"),
            (88, 90, 0, 0, "Stopped at the crossing"),
        ],
    },
    "road_cruise": {
        "title": "Live · Open road and hill", "duration": 90,
        "description": "Accelerate from a rolling start, settle into a cruise, climb a smooth hill, then slow and recover. Watch hybrid power sharing and thermal inertia.",
        "initial_config": {"initial_speed_kph": 55.0, "initial_coolant_c": 80.0, "initial_soc_pct": 55.0},
        "phases": [
            (0, 4, 55, 55, "Rolling road start"),
            (4, 19, 55, 90, "Accelerate onto the open road"),
            (19, 30, 90, 90, "Settle into cruise"),
            (30, 55, 90, 90, "Climb the hill"),
            (55, 67, 90, 65, "Lift and slow"),
            (67, 79, 65, 80, "Return to cruising speed"),
            (79, 90, 80, 80, "Steady road cruise"),
        ],
    },
}
for _cycle_id, _cycle in DRIVE_CYCLES.items():
    SCENARIOS.append({
        "id": _cycle_id, "title": _cycle["title"], "profile": "phev",
        "duration": _cycle["duration"], "description": _cycle["description"],
        "kind": "drive_cycle", "initial_config": dict(_cycle["initial_config"]),
        "phases": [{"start_s": start, "end_s": end, "start_speed_kph": speed0,
                    "end_speed_kph": speed1, "label": label}
                   for start, end, speed0, speed1, label in _cycle["phases"]],
    })


def clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


@dataclass
class Parameters:
    """Editable generic assumptions. Values are not a particular vehicle."""
    mass_kg: float = 1600.0
    capacity_ah: float = 50.0
    battery_r_ohm: float = 0.12
    initial_soc_pct: float = 75.0
    initial_speed_kph: float = 0.0
    initial_coolant_c: float = 20.0
    ambient_c: float = 20.0
    initial_battery_temp_c: float = 25.0
    wheel_radius_m: float = 0.31
    wheel_inertia_kg_m2: float = 1.5
    wheelbase_m: float = 2.70
    track_m: float = 1.58
    yaw_inertia_kg_m2: float = 2600.0
    drag_area_m2: float = 0.65
    rolling_coefficient: float = 0.011
    air_density_kg_m3: float = 1.225
    battery_thermal_capacity_j_k: float = 100000.0
    battery_cooling_w_k: float = 50.0
    coolant_thermal_capacity_j_k: float = 35000.0
    engine_inertia_kg_m2: float = 0.28
    fuel_lhv_j_kg: float = 44_000_000.0
    fuel_density_kg_l: float = 0.745
    # Educational ECT input circuit. These are selected lab values, not an OEM
    # schematic or thermistor calibration. NTC is the lower divider leg to ground.
    reference_voltage_v: float = 5.0
    ect_pullup_ohm: float = 2200.0
    ect_r25_ohm: float = 2500.0
    ect_beta_k: float = 3500.0
    ect_adc_bits: int = 12


def ect_circuit(temperature_c: float, p: Parameters, *, powered: bool = True,
                open_circuit: bool = False) -> dict[str, Any]:
    """Sample a ratiometric pull-up / NTC divider with an ideal ADC.

    Beta model: R(T)=R25*exp(B*(1/T-1/298.15)), temperatures in kelvin.
    The open branch has zero current and a node at Vref; resistance is None,
    never infinity. ADC readings are quantized, then inverted to temperature.
    -40 C is the documented teaching display for an invalid measurement, not
    a physical consequence of an open circuit. The validity flag is authoritative.

    References for topology/equations (chosen values above are independent):
    https://www.ti.com/lit/an/sbaa338a/sbaa338a.pdf
    https://www.analog.com/en/resources/design-notes/a-simple-thermistor-interface-to-an-adc.html
    """
    if not math.isfinite(temperature_c) or temperature_c <= -273.15:
        raise ValueError("ECT temperature must be finite and above absolute zero")
    ntc_r = p.ect_r25_ohm * math.exp(p.ect_beta_k * (1.0 / (temperature_c + 273.15) - 1.0 / 298.15))
    reference_v = p.reference_voltage_v if powered else 0.0
    resistance = None if open_circuit else ntc_r
    node_v = reference_v if open_circuit else reference_v * ntc_r / (p.ect_pullup_ohm + ntc_r)
    current_ma = 0.0 if open_circuit else reference_v / (p.ect_pullup_ohm + ntc_r) * 1000.0
    full_scale = (1 << p.ect_adc_bits) - 1
    count = int(round(node_v / p.reference_voltage_v * full_scale))
    measured_v = count / full_scale * p.reference_voltage_v
    high_input = powered and measured_v >= 0.99 * p.reference_voltage_v
    valid = powered and not high_input and 0 < count < full_scale
    temperature = -40.0
    if valid:
        measured_r = p.ect_pullup_ohm * measured_v / (p.reference_voltage_v - measured_v)
        temperature = 1.0 / (1.0 / 298.15 + math.log(measured_r / p.ect_r25_ohm) / p.ect_beta_k) - 273.15
    return {"ect_c": temperature, "ect_voltage_v": measured_v,
            "ect_node_v": node_v, "ect_reference_v": reference_v,
            "ect_resistance_ohm": resistance, "ect_current_ma": current_ma,
            "ect_adc_count": count, "ect_adc_full_scale": full_scale,
            "ect_circuit_open": bool(open_circuit), "ect_sensor_valid": bool(valid),
            "ect_high_input": bool(high_input), "ect_powered": bool(powered)}


class Sim:
    """Plant + scheduled behavioral ECUs, driven exclusively by simulation time.

    Explicit advance(..., inputs={...}) values persist and override scenario
    scripts. Create a fresh Sim to remove overrides/reset a run. Negative time,
    invalid inputs and non-finite values are rejected, never silently accepted.
    """
    DT = 0.002
    PROFILES = ("engine", "phev", "braking")
    FAULTS = ("none", "ect_open", "cell_low", "bmu_timeout", "wheel_fl_dropout")
    CONNECTIONS = ("ect", "dlc", "bmu", "wheel_fl")
    PERIODS_MS = {"plant": 2, "ECU": 10, "ABS_ESP": 10, "PHEV_ECU": 20, "BMU": 100, "logging": 100}

    def __init__(self, profile: str = "engine", scenario: str = "manual", config: dict | None = None):
        scenario_map = {s["id"]: s for s in SCENARIOS}
        if scenario not in scenario_map:
            raise ValueError(f"Unknown scenario: {scenario}")
        if scenario != "manual":
            profile = scenario_map[scenario]["profile"]
        if profile not in self.PROFILES:
            raise ValueError(f"Unknown profile: {profile}")
        self.profile, self.scenario = profile, scenario
        values = dict(config or {})
        for key, value in DRIVE_CYCLES.get(scenario, {}).get("initial_config", {}).items():
            values.setdefault(key, value)
        if "initial_soc_pct" not in values:
            values["initial_soc_pct"] = 22.0 if scenario == "low_soc" else 97.5 if scenario == "regen_limit" else 75.0
        if "initial_speed_kph" not in values:
            values["initial_speed_kph"] = 80.0 if scenario == "abs_split_mu" else 60.0 if profile == "braking" else 0.0
        allowed = Parameters.__dataclass_fields__
        unknown = set(values) - set(allowed)
        if unknown:
            raise ValueError("Unknown config keys: " + ", ".join(sorted(unknown)))
        for key, value in values.items():
            if not isinstance(value, (float, int)) or not math.isfinite(value):
                raise ValueError(f"Configuration {key} must be a finite number")
        self.p = Parameters(**values)
        for key, value in asdict(self.p).items():
            if key not in ("initial_soc_pct", "initial_speed_kph", "initial_coolant_c", "ambient_c", "initial_battery_temp_c") and value <= 0:
                raise ValueError(f"Configuration {key} must be positive")
        if not 0 <= self.p.initial_soc_pct <= 100 or not 0 <= self.p.initial_speed_kph <= 250:
            raise ValueError("SOC must be 0…100%; initial speed must be 0…250 km/h")
        for key in ("initial_coolant_c", "ambient_c"):
            if not -100 <= getattr(self.p, key) <= 200:
                raise ValueError(f"{key} must be within the teaching range -100…200 C")
        if isinstance(self.p.ect_adc_bits, bool) or not isinstance(self.p.ect_adc_bits, int) or not 2 <= self.p.ect_adc_bits <= 24:
            raise ValueError("ect_adc_bits must be an integer in [2, 24]")
        for key, low, high in (("reference_voltage_v", 0.5, 12.0), ("ect_pullup_ohm", 1.0, 1e7),
                               ("ect_r25_ohm", 1.0, 1e7), ("ect_beta_k", 500.0, 10000.0)):
            if not low <= getattr(self.p, key) <= high:
                raise ValueError(f"{key} must be in [{low}, {high}]")
        self.tick = 0
        self._remainder = 0.0
        self.events: list[dict] = []
        self.history: list[dict] = []
        self._overrides: dict = {}
        # Physical topology is independent of the legacy single fault input.
        # This allows simultaneous faults and preserves them during Mode 04.
        self.connections = {name: True for name in self.CONNECTIONS}
        self.inputs = self._script_inputs(0.0)
        self.v = self.p.initial_speed_kph / 3.6
        self.wheels = [self.v / self.p.wheel_radius_m] * 4
        self.slips = [0.0] * 4
        self.wheel_mu = [self.inputs["road_mu"]] * 4
        self.brake_pressure = [0.0] * 4
        self._extra_brake = [0.0] * 4
        self.rpm = 0.0
        self.engine_torque_nm = 0.0
        self.engine_power_kw = 0.0
        self.engine_shaft_kw = 0.0
        self._engine_running = False
        self._engine_wanted = profile == "engine"
        self._engine_last_on = -100.0
        self.coolant_c = self.p.initial_coolant_c
        self._ect_sample = ect_circuit(self.coolant_c, self.p, powered=self.inputs["ignition"],
                                       open_circuit=self.inputs["fault"] == "ect_open")
        self.ect_c = self._ect_sample["ect_c"]
        self.ect_used_c = self.ect_c
        self.ect_voltage_v = self._ect_sample["ect_voltage_v"]
        self.ect_sample_time_s = 0.0
        self._ect_derate = 1.0
        self.fuel_l_h = 0.0
        self.maf_g_s = 0.0
        self.load_pct = 0.0
        self.throttle_pct = 0.0
        self.soc = self.p.initial_soc_pct / 100.0
        self.battery_temp_c = self.p.initial_battery_temp_c
        self.battery_voltage_v = self._voc()
        self.battery_current_a = 0.0
        self.battery_power_kw = 0.0
        self.battery_discharge_limit_kw = 0.0
        self.battery_charge_limit_kw = 0.0
        self.min_cell_v = self._voc() / 96.0 - 0.012
        self.max_cell_v = self._voc() / 96.0 + 0.012
        self.contactor = "OFF"
        self.dc_link_v = 0.0
        self._precharge_start = 0.0
        self._bmu_fault = False
        self._network_fault = False
        self._cell_fault_time = 0.0
        self._cell_fault_start = None
        self._last_bmu_message = 0.0
        self._bmu_report: dict[str, Any] = {}
        self._charge_sustain = self.soc < 0.25
        self._drive_force = 0.0
        self._engine_force_request = 0.0
        self._motor_force_request = 0.0
        self._generator_request_kw = 0.0
        self.generator_kw = 0.0
        self.motor_power_kw = 0.0
        self.regen_kw = 0.0
        self.friction_brake_kw = 0.0
        self.abs_active = False
        self.esp_active = False
        self.yaw_rate = 0.0
        self.yaw_target = 0.0
        self.distance_m = 0.0
        self.acceleration_m_s2 = 0.0
        self.mode = "STOPPED" if profile == "engine" else "OFF"
        self.dtcs: set[str] = set()
        self.pending_dtcs: set[str] = set()
        self.module_dtc = {"ECU": [], "BMU": [], "PHEV_ECU": [], "ABS_ESP": []}
        self._ect_fault_time = 0.0
        self._ect_fault_start = None
        self._monitor_time = 0.0
        self._monitor_start = None
        self.components_monitor_complete = False
        self.freeze_frame: dict | None = None
        self._last_fault_input = "none"
        self._last_mode = self.mode
        self._last_contactor = self.contactor
        self.energy = {key: 0.0 for key in (
            "fuel_l", "battery_discharge_kwh", "battery_charge_kwh", "battery_chemical_kwh",
            "battery_ohmic_kwh", "battery_terminal_net_kwh", "engine_shaft_kwh",
            "motor_drive_kwh", "regen_mechanical_kwh", "friction_brake_kwh", "tire_slip_kwh",
            "road_load_kwh", "abs_active_s", "esp_active_s")}
        self._event("SIM", f"{profile} model initialized; generic teaching assumptions, 2 ms plant step")
        self.history.append(self.snapshot())

    @property
    def t(self) -> float:
        return self.tick * self.DT

    def _event(self, source: str, message: str) -> None:
        self.events.append({"t": round(self.t, 6), "source": source, "message": message})
        if len(self.events) > 1000:
            del self.events[:100]

    def set_connection(self, connection_id: str, connected: bool) -> dict:
        """Change one teaching connection without advancing simulation time.

        ``dlc`` isolates the tester CAN branch, not the vehicle control network.
        BMU shutdown is latched until an ignition cycle, even after reconnection.
        Topology changes immediately; sampled electrical readings, controller
        decisions and debounce timers change at their next ``advance`` tick.
        """
        if not isinstance(connection_id, str) or connection_id not in self.CONNECTIONS:
            raise ValueError("Unknown connection; choose ect, dlc, bmu or wheel_fl")
        if not isinstance(connected, bool):
            raise ValueError("connected must be boolean")
        if self.profile == "engine" and connection_id in ("bmu", "wheel_fl"):
            raise ValueError("This connection is not installed in the engine-only profile; use phev or braking")
        if self.connections[connection_id] != connected:
            self.connections[connection_id] = connected
            self._event("WIRING", connection_id + (" reconnected" if connected else " disconnected"))
        return self.snapshot()

    def _connection_open(self, connection_id: str) -> bool:
        legacy_fault = {"ect": "ect_open", "bmu": "bmu_timeout", "wheel_fl": "wheel_fl_dropout"}.get(connection_id)
        return not self.connections[connection_id] or (legacy_fault is not None and self.inputs["fault"] == legacy_fault)

    def _drive_program(self, t: float) -> dict | None:
        """Requested trajectory and display phase; these are not measurements."""
        cycle = DRIVE_CYCLES.get(self.scenario)
        if cycle is None:
            return None
        phases = cycle["phases"]
        index = next((i for i, phase in enumerate(phases) if t < phase[1]), len(phases) - 1)
        start, end, speed0, speed1, label = phases[index]
        u = clamp((t - start) / (end - start), 0, 1)
        target = speed0 + (speed1 - speed0) * u * u * (3 - 2 * u)
        target_accel = (speed1 - speed0) / 3.6 * 6 * u * (1 - u) / (end - start)
        return {"phase_index": index, "phase": label, "phase_start_s": start,
                "phase_end_s": end, "target_kph": target,
                "target_acceleration_m_s2": target_accel,
                "duration_s": cycle["duration"],
                "progress": clamp(t / cycle["duration"], 0, 1),
                "complete": t >= cycle["duration"]}

    def _drive_inputs(self, t: float, inp: dict) -> None:
        """A deterministic virtual driver follows the route through pedals.

        Requested force combines speed-error feedback with trajectory/road-load
        feed-forward. Neither vehicle velocity nor any diagnostic measurement is
        overwritten. Faults, traction limits and manual overrides still win.
        """
        route = self._drive_program(t)
        if route is None:
            return
        p = self.p
        speed = getattr(self, "v", p.initial_speed_kph / 3.6)
        if self.scenario == "road_cruise":
            hill = clamp((t - 28.0) / 35.0, 0, 1)
            inp["grade_pct"] = 6.8 * math.sin(math.pi * hill) ** 2
        elif 73 <= t <= 79:
            inp["steer_deg"] = 0.70 * math.sin(math.pi * (t - 73) / 6.0) ** 2
        drag = 0.5 * p.air_density_kg_m3 * p.drag_area_m2 * speed * speed
        rolling = p.mass_kg * 9.81 * p.rolling_coefficient * clamp(speed / .1, 0, 1)
        grade = p.mass_kg * 9.81 * math.sin(math.atan(inp["grade_pct"] / 100))
        acceleration = route["target_acceleration_m_s2"] + .65 * (route["target_kph"] / 3.6 - speed)
        force = p.mass_kg * acceleration + drag + rolling + grade
        inp["throttle"] = clamp(force / 5000.0, 0, .90)
        inp["brake"] = clamp(-force / 6500.0, 0, .60)
        if route["target_kph"] < .05 and speed < .12:
            inp["throttle"], inp["brake"] = 0.0, .18

    def _script_inputs(self, t: float) -> dict:
        inp = dict(ignition=True, throttle=0.0, brake=0.0, steer_deg=0.0,
                   road_mu=0.85, grade_pct=0.0, fault="none", abs_enabled=True)
        if self.scenario in DRIVE_CYCLES:
            self._drive_inputs(t, inp)
        elif self.scenario == "engine_warmup":
            inp["throttle"] = 0.0 if t < 10 else 0.22 if t < 45 else 0.08 if t < 90 else 0.0
        elif self.scenario == "ect_open":
            inp["throttle"] = 0.35
            inp["fault"] = "ect_open" if t >= 3 else "none"
        elif self.scenario == "phev_city":
            if 2 <= t < 16: inp["throttle"] = 0.35
            elif 16 <= t < 22: inp["throttle"] = 0.08
            elif 22 <= t < 30: inp["brake"] = 0.50
            elif 35 <= t < 47: inp["throttle"] = 0.85
            elif 47 <= t: inp["brake"] = 0.65
        elif self.scenario == "low_soc":
            if 1 <= t < 25: inp["throttle"] = 0.35
            elif 25 <= t < 32: inp["brake"] = 0.25
            elif 32 <= t: inp["throttle"] = 0.20
        elif self.scenario == "abs_split_mu":
            inp["brake"] = 0.85 if t >= 1 else 0.0
        elif self.scenario == "regen_limit":
            inp["brake"] = 0.30 if t >= 1 else 0.0
        elif self.scenario in ("bmu_timeout", "cell_low"):
            inp["throttle"] = 0.40 if t >= 2 else 0.0
            inp["fault"] = self.scenario if t >= 8 else "none"
        return inp

    def _validate_inputs(self, supplied: dict) -> dict:
        if not isinstance(supplied, dict):
            raise ValueError("inputs must be an object")
        checked = {}
        ranges = {"throttle": (0, 1), "brake": (0, 1), "steer_deg": (-10, 10),
                  "road_mu": (0.05, 1.0), "grade_pct": (-12, 12)}
        for key, value in supplied.items():
            if key in ranges:
                if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value):
                    raise ValueError(f"{key} must be a finite number")
                lo, hi = ranges[key]
                if not lo <= value <= hi:
                    raise ValueError(f"{key} must be in [{lo}, {hi}]")
                checked[key] = float(value)
            elif key in ("ignition", "abs_enabled"):
                if not isinstance(value, bool): raise ValueError(f"{key} must be boolean")
                checked[key] = value
            elif key == "fault":
                if value not in self.FAULTS: raise ValueError("Unknown fault")
                checked[key] = value
            else:
                raise ValueError(f"Unknown input: {key}")
        return checked

    def _before_tick(self) -> None:
        """Subclass hook for topology events due before controller sampling."""

    def advance(self, seconds: float, inputs: dict | None = None) -> dict:
        if not isinstance(seconds, (int, float)) or isinstance(seconds, bool) or not math.isfinite(seconds) or seconds < 0:
            raise ValueError("seconds must be finite and nonnegative")
        if inputs is not None:
            self._overrides.update(self._validate_inputs(inputs))
        self.inputs = self._script_inputs(self.t)
        self.inputs.update(self._overrides)
        elapsed = self._remainder + seconds
        steps = int(math.floor(elapsed / self.DT + 1e-9))
        self._remainder = elapsed - steps * self.DT
        for _ in range(steps):
            self.inputs = self._script_inputs(self.t)
            self.inputs.update(self._overrides)
            if self.inputs["fault"] != self._last_fault_input:
                self._event("FAULT", "Fault input: " + self.inputs["fault"])
                self._last_fault_input = self.inputs["fault"]
            # Sampling and scheduling order is deliberate and deterministic.
            self._before_tick()
            if self.tick % 50 == 0:
                self._bmu_update(0.100)
            if self.tick % 10 == 0:
                self._supervisor_update(0.020)
            if self.tick % 5 == 0:
                self._engine_ecu_update(0.010)
                self._abs_esp_update(0.010)
            self._plant_step(self.DT)
            self.tick += 1
            # Settle contacts at the new boundary before logging that time.
            # The next controller task will consume the new state; the hook
            # is idempotent when called again at the start of that next tick.
            self._before_tick()
            if self.contactor != self._last_contactor:
                self._event("BMU", "Contactor: " + self.contactor)
                self._last_contactor = self.contactor
            if self.mode != self._last_mode:
                self._event("PHEV_ECU" if self.profile != "engine" else "ECU", "Mode: " + self.mode)
                self._last_mode = self.mode
            if self.tick % 50 == 0:
                self.history.append(self.snapshot())
                if len(self.history) > 20000:
                    del self.history[:1000]
        return self.snapshot()

    def clear_emissions_dtcs(self) -> None:
        """Clear teaching emissions memory; no repair or ignition change occurs."""
        self.dtcs.clear()
        self.pending_dtcs.clear()
        self.module_dtc["ECU"] = []
        self._ect_fault_time = 0.0
        self._ect_fault_start = None
        self._monitor_time = 0.0
        self._monitor_start = None
        self.components_monitor_complete = False
        self.freeze_frame = None
        self._event("DIAG", "Emissions diagnostic memory cleared; an active fault will be detected again")

    def _voc(self) -> float:
        return 300.0 + 100.0 * self.soc

    def _bmu_update(self, dt: float) -> None:
        if self.profile == "engine":
            self.contactor = "OFF"
            return
        inp = self.inputs
        self.min_cell_v = self.battery_voltage_v / 96.0 - 0.012
        self.max_cell_v = self.battery_voltage_v / 96.0 + 0.012
        if inp["fault"] == "cell_low":
            self.min_cell_v = 2.30  # Injected measurement, not a fabricated full electrochemical cell model.
        if self.min_cell_v < 2.80 and inp["ignition"]:
            if self._cell_fault_start is None: self._cell_fault_start = self.t
            self._cell_fault_time = self.t - self._cell_fault_start
        else:
            self._cell_fault_time = 0.0
            self._cell_fault_start = None
        if self._cell_fault_time >= 0.20 - 1e-9 and not self._bmu_fault:
            self._bmu_fault = True
            self.module_dtc["BMU"].append("BMU_CELL_UNDERVOLTAGE")
            self._event("BMU", "Cell input below 2.80 V for 200 ms; traction shutdown latched")
        if not inp["ignition"]:
            self.contactor = "OFF"
            self._bmu_fault = False
            self._network_fault = False
            self.dc_link_v *= 0.5
        elif self._bmu_fault or self._network_fault:
            self.contactor = "FAULT"
        elif self.contactor == "OFF":
            self.contactor = "PRECHARGE"
            self._precharge_start = self.t
        elif self.contactor == "PRECHARGE" and self.t - self._precharge_start >= 0.4 and self.dc_link_v >= 0.95 * self._voc():
            self.contactor = "CLOSED"
        if not self._connection_open("bmu"):
            self._last_bmu_message = self.t
        thermal_dis = clamp((60 - self.battery_temp_c) / 15, 0, 1)
        thermal_chg = clamp((55 - self.battery_temp_c) / 10, 0, 1) * clamp((self.battery_temp_c + 10) / 10, 0, 1)
        soc_dis = clamp((self.soc - 0.08) / 0.07, 0, 1)
        soc_chg = clamp((0.98 - self.soc) / 0.08, 0, 1)
        voc = self._voc()
        imax_dis = min(220.0 * thermal_dis * soc_dis, voc / (2.0 * self.p.battery_r_ohm))
        imax_chg = 120.0 * thermal_chg * soc_chg
        self.battery_discharge_limit_kw = min(80.0, (voc - self.p.battery_r_ohm * imax_dis) * imax_dis / 1000)
        self.battery_charge_limit_kw = min(40.0, (voc + self.p.battery_r_ohm * imax_chg) * imax_chg / 1000)
        if not self._connection_open("bmu"):
            # This packet is a measurement of the current state at publication.
            # A dropout holds these values; it must not masquerade as live data.
            self._bmu_report = {"t": self.t, "pack_voltage_v": self.battery_voltage_v,
                                "pack_current_a": self.battery_current_a,
                                "soc_pct": self.soc * 100.0, "pack_temp_c": self.battery_temp_c,
                                "cell_min_v": self.min_cell_v, "cell_max_v": self.max_cell_v,
                                "charge_limit_kw": self.battery_charge_limit_kw,
                                "discharge_limit_kw": self.battery_discharge_limit_kw}

    def _supervisor_update(self, dt: float) -> None:
        if self.profile == "engine":
            self._engine_wanted = self.inputs["ignition"]
            return
        inp = self.inputs
        if inp["ignition"] and self.t - self._last_bmu_message > 0.3000001 and not self._network_fault:
            self._network_fault = True
            self.contactor = "FAULT"
            if "BMU_STATUS_TIMEOUT" not in self.module_dtc["PHEV_ECU"]:
                self.module_dtc["PHEV_ECU"].append("BMU_STATUS_TIMEOUT")
            self._event("PHEV_ECU", "BMU heartbeat age >300 ms; torque inhibited and contactor open requested")
        ready = inp["ignition"] and self.contactor == "CLOSED" and not self._bmu_fault and not self._network_fault
        self._drive_force = 5000.0 * inp["throttle"] if ready and inp["brake"] < 0.01 else 0.0
        if self.soc < 0.25: self._charge_sustain = True
        elif self.soc > 0.30: self._charge_sustain = False
        power_demand_kw = self._drive_force * max(self.v, 2.0) / 1000
        requested_engine = ready and self._drive_force > 10 and (self._charge_sustain or power_demand_kw > 35)
        # Five-second minimum engine-on dwell; braking and shutdown still stop it.
        if requested_engine and not self._engine_wanted:
            self._engine_last_on = self.t
        keep_on = self._engine_wanted and self.t - self._engine_last_on < 5.0 and self._drive_force > 10
        self._engine_wanted = ready and (requested_engine or keep_on)
        self._generator_request_kw = 5.0 if self._engine_wanted and self._charge_sustain else 0.0
        self._engine_force_request = 0.0
        self._motor_force_request = self._drive_force
        if self._engine_wanted:
            fraction = 1.0 if self._charge_sustain else 0.70
            self._engine_force_request = min(3500.0, self._drive_force * fraction, (70.0 - self._generator_request_kw) * 1000 / max(self.v, 2.0))
            self._motor_force_request = max(0.0, self._drive_force - self._engine_force_request)
        if not ready:
            self._engine_wanted = False
            self._engine_force_request = self._motor_force_request = self._generator_request_kw = 0.0
            self.mode = "FAULT" if self._bmu_fault or self._network_fault else self.contactor
        elif inp["brake"] > 0.01 and self.v > 0.5:
            self.mode = "REGEN + FRICTION" if self.battery_charge_limit_kw > 0.5 else "FRICTION BRAKING"
        elif self._drive_force > 10:
            self.mode = "CHARGE SUSTAIN" if self._charge_sustain else "HYBRID" if self._engine_wanted else "EV"
        else:
            self.mode = "READY" if self.v < 0.1 else "COAST"

    def _engine_ecu_update(self, dt: float) -> None:
        self._ect_sample = ect_circuit(self.coolant_c, self.p, powered=self.inputs["ignition"],
                                       open_circuit=self._connection_open("ect"))
        self.ect_sample_time_s = self.t
        self.ect_c = self._ect_sample["ect_c"]
        self.ect_voltage_v = self._ect_sample["ect_voltage_v"]
        # The monitor consumes the sampled voltage. 99% of Vref is a teaching
        # threshold, not a manufacturer's P0118 calibration.
        fault = self._ect_sample["ect_high_input"]
        if fault:
            if self._ect_fault_start is None: self._ect_fault_start = self.t
            self._ect_fault_time = self.t - self._ect_fault_start
        else:
            self._ect_fault_time = 0.0
            self._ect_fault_start = None
        if self.inputs["ignition"]:
            if self._monitor_start is None: self._monitor_start = self.t
            self._monitor_time = self.t - self._monitor_start
        else:
            self._monitor_start = None
        self.components_monitor_complete = self.components_monitor_complete or self._monitor_time >= 1.0
        if self._ect_fault_time >= 0.20 - 1e-9:
            self.pending_dtcs.add("P0118")
        elif not fault:
            self.pending_dtcs.discard("P0118")
        if self._ect_fault_time >= 0.50 - 1e-9 and "P0118" not in self.dtcs:
            self.dtcs.add("P0118")
            self.module_dtc["ECU"] = sorted(self.dtcs)
            self.freeze_frame = {"t": self.t, "rpm": self.rpm, "coolant_c": self.ect_c,
                                 "speed_kph": self.v * 3.6, "load_pct": self.load_pct}
            self._event("ECU", "P0118 confirmed; MIL on (accelerated teaching debounce, not statutory drive-cycle logic)")
        self.ect_used_c = 80.0 if self._ect_fault_time >= 0.20 - 1e-9 else self.ect_c
        # A modeled fallback changes control behavior: modest torque derate.
        self._ect_derate = 0.65 if self._ect_fault_time >= 0.20 - 1e-9 else 1.0

    def _abs_esp_update(self, dt: float) -> None:
        self.abs_active = self.esp_active = False
        self._extra_brake = [0.0] * 4
        if self.profile == "engine": return
        inp = self.inputs
        signal_ok = not self._connection_open("wheel_fl")
        if not signal_ok and "ABS_WHEEL_FL_SIGNAL" not in self.module_dtc["ABS_ESP"]:
            self.module_dtc["ABS_ESP"].append("ABS_WHEEL_FL_SIGNAL")
            self._event("ABS_ESP", "Front-left speed input missing; ABS and yaw brake assist disabled")
        active = inp["abs_enabled"] and signal_ok and self.v > 2.5
        for i, slip in enumerate(self.slips):
            if inp["brake"] < 0.01:
                self.brake_pressure[i] = 1.0
            elif not active:
                self.brake_pressure[i] = 1.0
            elif slip > 0.20:
                self.brake_pressure[i] = max(0.05, self.brake_pressure[i] - 8.0 * dt)
            elif slip < 0.10:
                self.brake_pressure[i] = min(1.0, self.brake_pressure[i] + 3.0 * dt)
            if active and inp["brake"] > 0.01 and self.brake_pressure[i] < 0.99:
                self.abs_active = True
        self.yaw_target = self.v / self.p.wheelbase_m * math.tan(math.radians(inp["steer_deg"]))
        error = self.yaw_target - self.yaw_rate
        if active and self.v > 4 and abs(error) > 0.12:
            # Simplified yaw-error brake assist: rear wheel on the correcting side.
            # This is NOT a validated ESC model; lateral tire forces are absent.
            index = 2 if error > 0 else 3
            self._extra_brake[index] = min(280.0, abs(error) * 900.0)
            self.esp_active = True

    @staticmethod
    def _tire_curve(slip: float) -> float:
        """Teaching longitudinal mu/slip curve: peak at 0.15, slide ratio 0.75."""
        mag = abs(slip)
        scale = mag / 0.15 if mag <= 0.15 else max(0.75, 1.0 - 0.25 * (mag - 0.15) / 0.85)
        return math.copysign(scale, slip) if mag else 0.0

    def _engine_stand_step(self, dt: float) -> None:
        omega = self.rpm * math.pi / 30
        friction = 9.0 + 0.006 * self.rpm
        dyno = 0.0000028 * self.rpm ** 2
        starter = 0.0
        if self._engine_wanted:
            if self.rpm < 300 and not self._engine_running:
                starter = 45.0
            else:
                self._engine_running = True
        else:
            self._engine_running = False
        command = 0.0
        if self._engine_running:
            maximum = max(80.0, 170.0 - 0.000004 * (self.rpm - 3000) ** 2)
            pedal_torque = self.inputs["throttle"] * maximum * self._ect_derate
            idle_torque = friction + dyno + 0.12 * (850 - self.rpm)
            command = clamp(max(pedal_torque, idle_torque), 0, maximum)
            if self.rpm > 6400: command = 0.0
        self.engine_torque_nm += (command - self.engine_torque_nm) * min(1, dt / 0.06)
        omega = max(0.0, omega + (self.engine_torque_nm + starter - friction - dyno) / self.p.engine_inertia_kg_m2 * dt)
        self.rpm = min(6800.0, omega * 30 / math.pi)
        if self.rpm < 1 and not self._engine_wanted: self.rpm = 0.0
        self.engine_power_kw = dyno * omega / 1000
        self.engine_shaft_kw = (dyno + friction) * omega / 1000 if self._engine_running else 0.0
        self.load_pct = clamp(command / 170.0 * 100, 0, 100)
        self.throttle_pct = clamp(command / 170.0 * 100, 0, 100)
        self.mode = "RUNNING" if self._engine_running else "CRANKING" if self._engine_wanted else "STOPPED"
        self._fuel_and_heat_step(dt)

    def _fuel_and_heat_step(self, dt: float) -> None:
        # Gross mechanical shaft load / 30% efficiency + 3 kW idling overhead.
        fuel_w = self.engine_shaft_kw * 1000 / 0.30 + 3000 if self._engine_running else 0.0
        mass_kg_s = fuel_w / self.p.fuel_lhv_j_kg
        self.fuel_l_h = mass_kg_s / self.p.fuel_density_kg_l * 3600
        self.maf_g_s = mass_kg_s * 1000 * 14.7
        radiator = 300.0 * clamp((self.coolant_c - 85) / 10, 0, 1)
        thermal_w = 0.23 * fuel_w - (35.0 + radiator) * (self.coolant_c - self.p.ambient_c)
        self.coolant_c += thermal_w / self.p.coolant_thermal_capacity_j_k * dt
        self.energy["fuel_l"] += self.fuel_l_h * dt / 3600
        self.energy["engine_shaft_kwh"] += self.engine_shaft_kw * dt / 3600

    def _battery_step(self, power_w: float, dt: float) -> None:
        if self.contactor != "CLOSED": power_w = 0.0
        voc, resistance = self._voc(), self.p.battery_r_ohm
        physical_max_w = voc * voc / (4 * resistance)
        power_w = clamp(power_w, -self.battery_charge_limit_kw * 1000, min(self.battery_discharge_limit_kw * 1000, physical_max_w))
        discriminant = max(0, voc * voc - 4 * resistance * power_w)
        # Stable quadratic root, also valid for negative (charging) power.
        current = 2 * power_w / (voc + math.sqrt(discriminant)) if power_w else 0.0
        voltage = voc - resistance * current
        self.battery_current_a, self.battery_voltage_v = current, voltage
        self.battery_power_kw = voltage * current / 1000
        self.soc = clamp(self.soc - current * dt / (self.p.capacity_ah * 3600), 0, 1)
        ohmic_w = current * current * resistance
        self.battery_temp_c += (ohmic_w - self.p.battery_cooling_w_k * (self.battery_temp_c - self.p.ambient_c)) / self.p.battery_thermal_capacity_j_k * dt
        self.energy["battery_discharge_kwh"] += max(power_w, 0) * dt / 3_600_000
        self.energy["battery_charge_kwh"] += max(-power_w, 0) * dt / 3_600_000
        self.energy["battery_chemical_kwh"] += voc * current * dt / 3_600_000
        self.energy["battery_ohmic_kwh"] += ohmic_w * dt / 3_600_000
        self.energy["battery_terminal_net_kwh"] += voltage * current * dt / 3_600_000

    def _vehicle_step(self, dt: float) -> None:
        p, inp = self.p, self.inputs
        ready = self.contactor == "CLOSED" and inp["ignition"] and not self._bmu_fault and not self._network_fault
        wheel_linear = max(0.0, (self.wheels[0] + self.wheels[1]) * 0.5 * p.wheel_radius_m)
        engine_req_kw = self._engine_force_request * max(wheel_linear, 2.0) / 1000 + self._generator_request_kw
        if self._engine_wanted:
            rpm_target = clamp(1200 + engine_req_kw * 45, 1200, 4500)
            self._engine_running = True
            self.rpm += (rpm_target - self.rpm) * dt / 0.30
        else:
            self._engine_running = False
            self.rpm += (0 - self.rpm) * dt / 0.15
            if self.rpm < 1: self.rpm = 0.0
        ramp = clamp(self.rpm / 1200.0, 0, 1) * self._ect_derate if self._engine_wanted else 0.0
        engine_force = self._engine_force_request * ramp if ready else 0.0
        self.generator_kw = self._generator_request_kw * ramp if ready else 0.0
        motor_force = self._motor_force_request if ready else 0.0
        available_motor_kw = max(0, self.battery_discharge_limit_kw - 0.5) * 0.90
        motor_force = min(motor_force, 4200, 60_000 / max(wheel_linear, 1), available_motor_kw * 1000 / max(wheel_linear, 1))
        brake_force = 6500.0 * inp["brake"]
        regen_force = 0.0
        if ready and brake_force > 0 and self.v > 1.0 and not self.abs_active and max(self.slips) < 0.12:
            regen_force = min(brake_force * 0.60, 2000.0, 25_000 / max(wheel_linear, 1),
                              (self.battery_charge_limit_kw + 0.5) * 1000 / (0.88 * max(wheel_linear, 1)))
        regen_force *= clamp((self.v - 1.0) / 2.0, 0, 1)
        friction_force = max(0.0, brake_force - regen_force)
        brake_shares = (0.325, 0.325, 0.175, 0.175)
        brake_torques = [(friction_force * share * p.wheel_radius_m + extra) * pressure
                         for share, extra, pressure in zip(brake_shares, self._extra_brake, self.brake_pressure)]
        drive_torques = [(engine_force + motor_force - regen_force) * p.wheel_radius_m / 2] * 2 + [0.0, 0.0]
        self.wheel_mu = [0.20, 0.80, 0.20, 0.80] if self.scenario == "abs_split_mu" else [inp["road_mu"]] * 4
        # Quasi-static longitudinal load transfer, with axle load bounds.
        front_share = clamp(0.5 - self.acceleration_m_s2 * 0.50 / (9.81 * p.wheelbase_m), 0.35, 0.75)
        weights = [p.mass_kg * 9.81 * front_share / 2] * 2 + [p.mass_kg * 9.81 * (1 - front_share) / 2] * 2
        tire_forces = []
        old_wheels = list(self.wheels)
        for i in range(4):
            # 3 m/s regularization avoids a singular stiffness at rest.
            kappa = (p.wheel_radius_m * self.wheels[i] - self.v) / max(self.v, 3.0)
            force = self.wheel_mu[i] * weights[i] * self._tire_curve(kappa)
            tire_forces.append(force)
            torque = drive_torques[i] - brake_torques[i] - force * p.wheel_radius_m
            self.wheels[i] = max(0.0, self.wheels[i] + torque / p.wheel_inertia_kg_m2 * dt)
            self.energy["tire_slip_kwh"] += max(0, force * (p.wheel_radius_m * old_wheels[i] - self.v)) * dt / 3_600_000
        drag = 0.5 * p.air_density_kg_m3 * p.drag_area_m2 * self.v ** 2
        rolling = p.mass_kg * 9.81 * p.rolling_coefficient * clamp(self.v / 0.1, 0, 1)
        grade = p.mass_kg * 9.81 * math.sin(math.atan(inp["grade_pct"] / 100))
        road_load = drag + rolling + grade
        self.acceleration_m_s2 = (sum(tire_forces) - road_load) / p.mass_kg
        old_v = self.v
        self.v = max(0.0, self.v + self.acceleration_m_s2 * dt)
        if self.v < 0.04 and inp["brake"] > 0.01:
            self.v, self.wheels = 0.0, [0.0] * 4
        self.distance_m += (old_v + self.v) * 0.5 * dt
        self.energy["road_load_kwh"] += road_load * old_v * dt / 3_600_000
        self.slips = [clamp((self.v - p.wheel_radius_m * omega) / max(self.v, 3), -3, 1) for omega in self.wheels]
        yaw_moment = (tire_forces[1] + tire_forces[3] - tire_forces[0] - tire_forces[2]) * p.track_m / 2
        # Reduced yaw response. No lateral tire/body sideslip/roll states exist.
        self.yaw_rate += ((self.yaw_target - self.yaw_rate) * 1.8 + yaw_moment / p.yaw_inertia_kg_m2) * dt
        if self.v < 0.1: self.yaw_rate *= max(0, 1 - 5 * dt)
        self.generator_kw = min(self.generator_kw, max(0.0,
            (self.battery_charge_limit_kw * 1000 + motor_force * wheel_linear / 0.90
             - regen_force * wheel_linear * 0.88 + 500) / 900.0)) if ready else 0.0
        self.engine_power_kw = engine_force * wheel_linear / 1000
        self.engine_shaft_kw = self.engine_power_kw / 0.94 + self.generator_kw
        self.motor_power_kw = (motor_force - regen_force) * wheel_linear / 1000
        self.regen_kw = regen_force * wheel_linear / 1000
        self.friction_brake_kw = sum(t * w for t, w in zip(brake_torques, old_wheels)) / 1000
        electrical_w = motor_force * wheel_linear / 0.90 - regen_force * wheel_linear * 0.88 + 500 - self.generator_kw * 1000 * 0.90
        self._battery_step(electrical_w if ready else 0, dt)
        self.engine_torque_nm = self.engine_shaft_kw * 1000 / max(self.rpm * math.pi / 30, 1)
        self.load_pct = clamp(self.engine_shaft_kw / 70 * 100, 0, 100)
        self.throttle_pct = inp["throttle"] * 100 if self._engine_running else 0.0
        self._fuel_and_heat_step(dt)
        self.energy["motor_drive_kwh"] += motor_force * wheel_linear * dt / 3_600_000
        self.energy["regen_mechanical_kwh"] += self.regen_kw * dt / 3600
        self.energy["friction_brake_kwh"] += self.friction_brake_kw * dt / 3600
        self.energy["abs_active_s"] += dt if self.abs_active else 0.0
        self.energy["esp_active_s"] += dt if self.esp_active else 0.0

    def _plant_step(self, dt: float) -> None:
        if self.contactor == "PRECHARGE":
            self.dc_link_v += (self._voc() - self.dc_link_v) * dt / 0.12
        elif self.contactor == "CLOSED":
            self.dc_link_v = self.battery_voltage_v
        else:
            self.dc_link_v *= max(0, 1 - dt / 0.3)
        if self.profile == "engine":
            self._engine_stand_step(dt)
        else:
            self._vehicle_step(dt)

    def snapshot(self) -> dict[str, Any]:
        inp = dict(self.inputs)
        wheel_speeds = [w * self.p.wheel_radius_m * 3.6 for w in self.wheels]
        measured_wheels = list(wheel_speeds)
        if self._connection_open("wheel_fl"): measured_wheels[0] = None
        module_status = {
            "ECU": "FALLBACK" if "P0118" in self.pending_dtcs else "RUNNING" if self._engine_running else "STOPPED",
            "BMU": "NOT INSTALLED" if self.profile == "engine" else self.contactor,
            "PHEV_ECU": "NOT INSTALLED" if self.profile == "engine" else self.mode,
            "ABS_ESP": "NOT INSTALLED" if self.profile == "engine" else "SIGNAL FAULT" if self._connection_open("wheel_fl") else "ABS DISABLED" if not inp["abs_enabled"] else "MODULATING" if self.abs_active else "MONITORING",
        }
        sensors = {**self._ect_sample, "ect_c": self.ect_c, "ect_used_c": self.ect_used_c,
                   "ect_sample_time_s": self.ect_sample_time_s,
                   "ect_pullup_ohm": self.p.ect_pullup_ohm, "ect_r25_ohm": self.p.ect_r25_ohm,
                   "ect_beta_k": self.p.ect_beta_k, "ect_adc_bits": self.p.ect_adc_bits,
                   "ect_high_threshold_v": self.p.reference_voltage_v * 0.99,
                   "sensor_return_v": 0.0,
                   "iat_c": self.p.ambient_c, "crank_rpm": self.rpm, "maf_g_s": self.maf_g_s,
                   "accelerator_pct": inp["throttle"] * 100, "brake_pct": inp["brake"] * 100,
                   "pack_voltage_v": self.battery_voltage_v, "pack_current_a": self.battery_current_a,
                   "cell_min_v": self.min_cell_v, "cell_max_v": self.max_cell_v,
                   "pack_temp_c": self.battery_temp_c, "dc_link_v": self.dc_link_v,
                   "wheel_speeds_kph": measured_wheels, "steer_deg": inp["steer_deg"],
                   "yaw_rate_deg_s": math.degrees(self.yaw_rate), "bmu_message_age_ms": max(0, self.t - self._last_bmu_message) * 1000}
        result = {"t": round(self.t, 6), "profile": self.profile, "scenario": self.scenario,
                  "speed_kph": self.v * 3.6, "rpm": self.rpm, "coolant_c": self.coolant_c,
                  "ambient_c": self.p.ambient_c, "throttle_pct": self.throttle_pct, "load_pct": self.load_pct,
                  "maf_g_s": self.maf_g_s, "fuel_l_h": self.fuel_l_h, "engine_torque_nm": self.engine_torque_nm,
                  "battery_voltage_v": self.battery_voltage_v, "battery_current_a": self.battery_current_a,
                  "soc_pct": self.soc * 100, "battery_temp_c": self.battery_temp_c, "battery_power_kw": self.battery_power_kw,
                  "battery_discharge_limit_kw": self.battery_discharge_limit_kw, "battery_charge_limit_kw": self.battery_charge_limit_kw,
                  "engine_power_kw": self.engine_power_kw, "engine_shaft_kw": self.engine_shaft_kw,
                  "motor_power_kw": self.motor_power_kw, "generator_kw": self.generator_kw,
                  "regen_kw": self.regen_kw, "friction_brake_kw": self.friction_brake_kw,
                  "mode": self.mode, "contactor": self.contactor, "abs_active": self.abs_active, "esp_active": self.esp_active,
                  "wheel_speeds_kph": wheel_speeds, "slips": list(self.slips), "road_mu_wheels": list(self.wheel_mu),
                  "brake_pressure": list(self.brake_pressure), "yaw_rate_deg_s": math.degrees(self.yaw_rate),
                  "yaw_target_deg_s": math.degrees(self.yaw_target), "distance_m": self.distance_m,
                  "acceleration_m_s2": self.acceleration_m_s2, "dtcs": sorted(self.dtcs),
                  "pending_dtcs": sorted(self.pending_dtcs), "mil": bool(self.dtcs), "sensors": sensors,
                  "inputs": inp, "module_status": module_status,
                  "connections": dict(self.connections),
                  "effective_connections": {key: not self._connection_open(key) for key in self.CONNECTIONS},
                  "wheel_radius_m": self.p.wheel_radius_m,
                  "bmu_report": dict(self._bmu_report),
                  "module_dtc": {k: list(v) for k, v in self.module_dtc.items()},
                  "components_monitor_complete": self.components_monitor_complete,
                  "ect_fault_elapsed_s": self._ect_fault_time,
                  "ect_derate_factor": self._ect_derate,
                  "engine_running": self._engine_running,
                  "engine_requested": self._engine_wanted,
                  "freeze_frame": dict(self.freeze_frame) if self.freeze_frame else None,
                  "energy": dict(self.energy)}
        route = self._drive_program(self.t)
        if route is not None:
            overrides = sorted(set(self._overrides) & {"throttle", "brake", "steer_deg", "grade_pct", "ignition"})
            route["driver_overrides"] = overrides
            route["driver"] = "manual override" if overrides else "scripted feedback driver"
            route["source"] = "Original teaching route; target is a driver request, not measured vehicle speed."
        result["drive_cycle"] = route
        result["drive_target_kph"] = route["target_kph"] if route is not None else None
        result["drive_phase"] = route["phase"] if route is not None else None
        return result
