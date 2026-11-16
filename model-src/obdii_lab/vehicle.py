"""Driver-seat configurations over the deterministic teaching plant.

These are original generic calibrations, not models of particular production
vehicles. The six-speed automatic uses ratios and a simple torque converter;
the hybrid uses a power-split command approximation, not an OEM transaxle model.
The plant retains the existing 2 ms integration and 10/20/100 ms controller
schedules. Cockpit switches never advance the clock themselves.
"""
from __future__ import annotations

from copy import deepcopy
import math
from typing import Any

from .core import Sim, clamp, ect_circuit
from .connection_faults import ConnectionFaultSchedule, validate_connection_fault_settings


VEHICLE_CONFIGURATIONS = [
    {"id": "petrol_basic", "label": "Petrol · basic", "powertrain": "petrol", "engine_detail": "basic",
     "cylinders": 4, "displacement_l": 1.6, "abs_installed": False, "esp_installed": False,
     "transmission": "6-speed automatic", "mass_kg": 1250.0, "peak_torque_nm": 160.0,
     "peak_power_kw": 82.0, "redline_rpm": 6200.0, "idle_rpm": 850.0, "fuel_capacity_l": 45.0,
     "battery_capacity_kwh": None, "description": "Conventional port-injected petrol car with optional brake electronics."},
    {"id": "petrol_advanced", "label": "Petrol · extended", "powertrain": "petrol", "engine_detail": "extended",
     "cylinders": 4, "displacement_l": 2.0, "abs_installed": True, "esp_installed": True,
     "transmission": "6-speed automatic", "mass_kg": 1500.0, "peak_torque_nm": 260.0,
     "peak_power_kw": 140.0, "redline_rpm": 6500.0, "idle_rpm": 800.0, "fuel_capacity_l": 55.0,
     "battery_capacity_kwh": None, "description": "Generic turbo petrol car with an extended sensor set."},
    {"id": "diesel", "label": "Diesel · common-rail", "powertrain": "diesel", "engine_detail": "extended",
     "cylinders": 4, "displacement_l": 2.0, "abs_installed": True, "esp_installed": True,
     "transmission": "6-speed automatic", "mass_kg": 1580.0, "peak_torque_nm": 330.0,
     "peak_power_kw": 115.0, "redline_rpm": 4500.0, "idle_rpm": 780.0, "fuel_capacity_l": 55.0,
     "battery_capacity_kwh": None, "description": "Generic common-rail turbo diesel with lower-speed torque and an extended sensor set by default; a teaching model, not a Euro 4, 5 or 6 certified variant."},
    {"id": "hev", "label": "Hybrid · HEV", "powertrain": "hev", "engine_detail": "basic",
     "cylinders": 4, "displacement_l": 1.8, "abs_installed": True, "esp_installed": True,
     "transmission": "Hybrid automatic", "mass_kg": 1520.0, "peak_torque_nm": 170.0,
     "peak_power_kw": 75.0, "redline_rpm": 5200.0, "idle_rpm": 900.0, "fuel_capacity_l": 43.0,
     "battery_capacity_kwh": 1.5, "description": "A small traction battery supports electric launch, engine assist and regeneration."},
    {"id": "phev", "label": "Plug-in hybrid · PHEV", "powertrain": "phev", "engine_detail": "extended",
     "cylinders": 4, "displacement_l": 2.0, "abs_installed": True, "esp_installed": True,
     "transmission": "Hybrid automatic", "mass_kg": 1750.0, "peak_torque_nm": 200.0,
     "peak_power_kw": 95.0, "redline_rpm": 5500.0, "idle_rpm": 850.0, "fuel_capacity_l": 45.0,
     "battery_capacity_kwh": 18.75, "description": "A larger traction battery allows longer electric operation with engine assistance."},
    {"id": "bev", "label": "Battery electric · BEV", "powertrain": "bev", "engine_detail": "none",
     "cylinders": 0, "displacement_l": 0.0, "abs_installed": True, "esp_installed": True,
     "transmission": "Single-speed reduction", "mass_kg": 1850.0, "peak_torque_nm": 0.0,
     "peak_power_kw": 0.0, "redline_rpm": 0.0, "idle_rpm": 0.0, "fuel_capacity_l": None,
     "battery_capacity_kwh": 60.0, "description": "Battery, inverter and traction motor; no combustion engine or fuel system."},
]


class VehicleSim(Sim):
    """Configured vehicle with a real OFF→ON→START/READY sequence and PRND.

    Vehicle speed and wheel speeds are nonnegative magnitudes. Direction is
    explicit; signed_speed_kph and signed_distance_m describe forward/reverse
    displacement. This preserves the existing ABS slip model in either travel
    direction without representing a complete reverse/lateral dynamics model.
    """
    RATIOS = (3.80, 2.25, 1.52, 1.15, 0.89, 0.68)
    FINAL_DRIVE = 3.70

    def __init__(self, configuration: str = "petrol_basic", options: dict | None = None):
        preset = next((item for item in VEHICLE_CONFIGURATIONS if item["id"] == configuration), None)
        if preset is None:
            raise ValueError("Unknown vehicle configuration")
        if options is not None and not isinstance(options, dict):
            raise ValueError("Vehicle options must be an object")
        self.configuration = deepcopy(preset)
        options = dict(options or {})
        allowed = {"engine_detail", "cylinders", "abs_installed", "esp_installed", "initial_soc_pct", "initial_coolant_c", "can_bitrate",
                   "transmission_type", "drivetrain", "mass_kg", "wheel_radius_m", "drag_area_m2", "rolling_resistance",
                   "hvac_installed", "ac_installed", "heater_type", "ambient_c", "initial_odometer_km"}
        if set(options) - allowed:
            raise ValueError("Unknown vehicle option: " + ", ".join(sorted(set(options) - allowed)))
        bitrate = options.get("can_bitrate", 500_000)
        if isinstance(bitrate, bool) or bitrate not in (250_000, 500_000):
            raise ValueError("CAN bitrate must be 250000 or 500000 bits/s")
        self.configuration["can_bitrate"] = bitrate
        initial_odometer = options.get("initial_odometer_km", 0.)
        if (isinstance(initial_odometer, bool) or not isinstance(initial_odometer, (int, float))
                or not 0 <= initial_odometer <= 9_999_999 or not math.isfinite(initial_odometer)):
            raise ValueError("initial_odometer_km must be a finite number in [0, 9999999]")
        self.configuration["initial_odometer_km"] = float(initial_odometer)
        for field in ("abs_installed", "esp_installed"):
            if field in options:
                if not isinstance(options[field], bool):
                    raise ValueError(field + " must be boolean")
                self.configuration[field] = options[field]
        if self.configuration["esp_installed"] and not self.configuration["abs_installed"]:
            # Removing ABS also removes ESP unless ESP was explicitly requested.
            if options.get("esp_installed") is True:
                raise ValueError("ESP requires the ABS wheel sensors and brake controller")
            self.configuration["esp_installed"] = False
        if self.configuration["powertrain"] != "bev":
            detail = options.get("engine_detail", self.configuration["engine_detail"])
            if detail not in ("basic", "extended"):
                raise ValueError("Engine detail must be basic or extended")
            self.configuration["engine_detail"] = detail
            cylinders = options.get("cylinders", self.configuration["cylinders"])
            if isinstance(cylinders, bool) or cylinders not in (4, 6, 8):
                raise ValueError("Choose 4, 6 or 8 cylinders")
            scale = cylinders / self.configuration["cylinders"]
            self.configuration["cylinders"] = cylinders
            self.configuration["displacement_l"] = round(self.configuration["displacement_l"] * scale, 2)
            self.configuration["peak_torque_nm"] *= scale
            self.configuration["peak_power_kw"] *= scale
        else:
            if "cylinders" in options and (isinstance(options["cylinders"], bool) or options["cylinders"] != 0):
                raise ValueError("A battery-electric vehicle has no engine cylinders")
            if "engine_detail" in options and options["engine_detail"] != "none":
                raise ValueError("A battery-electric vehicle has no combustion-engine sensor option")
        self.has_engine = self.configuration["powertrain"] != "bev"
        self.has_hv = self.configuration["powertrain"] in ("hev", "phev", "bev")
        self.is_ice = self.configuration["powertrain"] in ("petrol", "diesel")
        compatible_transmissions = ("automatic_6", "manual_6") if self.is_ice else ("single_speed",) if not self.has_engine else ("hybrid_power_split",)
        transmission = options.get("transmission_type", compatible_transmissions[0])
        if transmission not in compatible_transmissions:
            raise ValueError("Transmission is incompatible with this powertrain; choose " + " or ".join(compatible_transmissions))
        self.manual_transmission = transmission == "manual_6"
        drivetrain = options.get("drivetrain", "fwd")
        if drivetrain not in ("fwd", "rwd", "awd"):
            raise ValueError("Driven wheels must be fwd, rwd or awd")
        chassis = {"mass_kg": (self.configuration["mass_kg"], 600., 3500.),
                   "wheel_radius_m": (.31, .22, .45), "drag_area_m2": (.65, .3, 1.5),
                   "rolling_resistance": (.011, .004, .035), "ambient_c": (20., -30., 50.)}
        for name, (default, low, high) in chassis.items():
            value = options.get(name, default)
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not low <= value <= high:
                raise ValueError(f"{name} must be a finite number in [{low}, {high}]")
            self.configuration[name] = float(value)
        hvac_installed = options.get("hvac_installed", True)
        ac_installed = options.get("ac_installed", hvac_installed)
        if not isinstance(hvac_installed, bool) or not isinstance(ac_installed, bool):
            raise ValueError("HVAC and air-conditioning installation options must be boolean")
        if ac_installed and not hvac_installed:
            raise ValueError("Air conditioning requires the cabin HVAC unit")
        heater = options.get("heater_type", "coolant" if self.is_ice else "electric")
        if heater != ("coolant" if self.is_ice else "electric"):
            raise ValueError("Choose coolant cabin heat for this combustion-only model or electric heat for hybrid/electric configurations")
        transmission_labels = {"automatic_6": "6-speed automatic", "manual_6": "6-speed manual",
                               "hybrid_power_split": "Hybrid power-split", "single_speed": "Single-speed reduction"}
        self.configuration.update(transmission_type=transmission, transmission=transmission_labels[transmission],
                                  drivetrain=drivetrain, hvac_installed=hvac_installed, ac_installed=ac_installed,
                                  heater_type=heater, has_engine=self.has_engine, has_hv=self.has_hv,
                                  has_traction_motor=self.has_hv,
                                  model_scope="Generic behavioral teaching vehicle; simplified longitudinal chassis and cabin thermal model, not OEM calibration")
        self.driven_wheels = {"fwd": (0, 1), "rwd": (2, 3), "awd": (0, 1, 2, 3)}[drivetrain]
        self.hvac = {"enabled": False, "setpoint_c": 22., "fan": .5, "ac_enabled": ac_installed}
        self.cabin_c = self.configuration["ambient_c"]
        self._hvac_output = {"powered": False, "connected": True, "status": "unpowered" if hvac_installed else "not installed", "heat_kw": 0., "cooling_kw": 0.,
                             "blower_kw": 0., "compressor_kw": 0., "electric_heater_kw": 0., "electrical_kw": 0., "shaft_load_kw": 0.}
        self._hvac_energy_kwh = 0.
        self._manual_stalled = False
        self._stall_elapsed = 0.
        self._clutch_torque_nm = 0.
        self.ignition_on = False
        self.start_requested = False
        self.selector = "N" if self.manual_transmission else "P"
        self.direction = 1
        self.actual_gear = 1
        self.parking_brake = True
        # Driver/body switches are independent of propulsion and the sampled
        # powertrain sensors. A new run begins ready for a normal drive.
        self.driver_seatbelt_fastened = True
        self.driver_door_open = False
        self.abs_enabled = self.configuration["abs_installed"]
        self.esp_enabled = self.configuration["esp_installed"]
        self._crank_until = 0.0
        self._last_shift = -10.0
        self.signed_distance_m = 0.0
        # distance_m is the plant's nonnegative path length, including Reverse.
        # Trip reset changes this baseline only; it never rewrites the journey.
        self._trip_start_distance_m = 0.0
        self.sensor_bank = None
        self._connection_faults = {}
        self.sensor_effects = {"engine_inhibit": False, "torque_factor": 1.0}
        self._initializing = True
        capacity = (self.configuration["battery_capacity_kwh"] or 18.75) * 1000 / 375.0
        config = {"mass_kg": self.configuration["mass_kg"], "capacity_ah": capacity,
                  "wheel_radius_m": self.configuration["wheel_radius_m"], "drag_area_m2": self.configuration["drag_area_m2"],
                  "rolling_coefficient": self.configuration["rolling_resistance"], "ambient_c": self.configuration["ambient_c"],
                  "initial_speed_kph": 0.0,
                  "initial_coolant_c": options.get("initial_coolant_c", self.configuration["ambient_c"]),
                  "initial_soc_pct": options.get("initial_soc_pct", 80.0 if configuration == "bev" else 60.0)}
        if self.configuration["powertrain"] == "diesel":
            config.update(fuel_density_kg_l=0.835, fuel_lhv_j_kg=42_500_000.0)
        super().__init__(profile="phev", scenario="manual", config=config)
        self._initializing = False
        self._engine_wanted = False
        self.mode = "OFF"
        if not self.has_hv:
            self.contactor = "NOT INSTALLED"
        self.events = []
        self._event("VEHICLE", self.configuration["label"] + " configured; ignition OFF, selector " + self.selector + ", parking brake applied")
        self.history = [self.snapshot()]

    def _script_inputs(self, t: float) -> dict:
        return {"ignition": self.ignition_on, "throttle": 0.0, "brake": 0.0, "clutch": 0.0,
                "steer_deg": 0.0, "road_mu": 0.85, "grade_pct": 0.0,
                "fault": "none", "abs_enabled": self.abs_enabled}

    def control(self, action: str, value: Any = None) -> dict:
        if action == "ignition":
            if not isinstance(value, bool):
                raise ValueError("Ignition value must be boolean")
            if not value and self.v * 3.6 > 1.0:
                raise ValueError("Stop the vehicle before switching the ignition off")
            self.ignition_on = value
            if not value:
                self._manual_stalled = False
                self.start_requested = False
                self._engine_wanted = False
                self._engine_running = False
                self._bmu_fault = self._network_fault = False
                self.contactor = "OFF" if self.has_hv else "NOT INSTALLED"
                self.mode = "OFF"
            elif not self.start_requested:
                self.mode = "IGNITION ON"
            self._overrides["ignition"] = value
            self.inputs["ignition"] = value
            self._event("DRIVER", "Ignition " + ("ON" if value else "OFF"))
        elif action == "start":
            if not self.ignition_on:
                raise ValueError("Turn ignition on before starting the engine or requesting READY")
            if self.selector not in ("P", "N") or self.v * 3.6 > 1.0:
                raise ValueError("Select N and stop before starting" if self.manual_transmission else "Select P or N and stop before starting")
            if self.manual_transmission and self.inputs.get("clutch", 0) < .9:
                raise ValueError("Hold the clutch at least 90% and select Neutral before starting")
            if self.manual_transmission and self.sensor_bank is not None and self.sensor_bank.connections.get("clutch_position") is False:
                raise ValueError("Clutch-position input is disconnected; restore the starter authorization input")
            if self.has_engine and self.sensor_effects.get("engine_inhibit") and self.is_ice:
                raise ValueError("The engine is inhibited by a sensor fault; inspect the engine ECU")
            if not self.start_requested:
                self.start_requested = True
                self._manual_stalled = False
                self._stall_elapsed = 0.
                self._crank_until = self.t + (0.80 if self.configuration["powertrain"] == "diesel" else 0.65)
                self._event("DRIVER", "Engine start requested" if self.is_ice else "Traction READY requested")
        elif action == "stop":
            self._manual_stalled = False
            self.start_requested = False
            self._engine_wanted = False
            self._engine_running = False
            self._drive_force = self._engine_force_request = self._motor_force_request = 0.0
            if self.has_hv:
                self.contactor = "OFF"
            self.mode = "IGNITION ON" if self.ignition_on else "OFF"
            self._event("DRIVER", "Engine / traction stopped; ignition remains " + ("ON" if self.ignition_on else "OFF"))
        elif action == "hvac":
            self._control_hvac(value)
        elif action == "reset_trip":
            trip_m = max(0., self.distance_m - self._trip_start_distance_m)
            if trip_m > 0:
                self._trip_start_distance_m = self.distance_m
                self._event("BODY", f"Trip reset after {trip_m / 1000:.3f} km; odometer unchanged")
        elif action in ("seatbelt", "driver_door"):
            if not isinstance(value, bool):
                raise ValueError(action + " must be boolean")
            field = "driver_seatbelt_fastened" if action == "seatbelt" else "driver_door_open"
            if getattr(self, field) != value:
                setattr(self, field, value)
                message = ("Driver seat belt " + ("fastened" if value else "unfastened")
                           if action == "seatbelt" else
                           "Driver door " + ("opened" if value else "closed"))
                self._event("BODY", message)
        elif action == "gear" and self.manual_transmission:
            self._control_manual_gear(value)
        elif action == "gear":
            if not isinstance(value, str) or value not in ("P", "R", "N", "D"):
                raise ValueError("Choose selector P, R, N or D")
            if value == self.selector:
                return self.snapshot()
            speed = self.v * 3.6
            changes_direction = value in ("R", "D") and (value == "R") != (self.direction < 0)
            if (value in ("P", "R") or changes_direction) and speed > 1.0:
                raise ValueError("Brake to a stop before selecting Park or changing direction")
            if (self.selector == "P" or value in ("P", "R") or changes_direction) and self.inputs.get("brake", 0) < 0.1:
                raise ValueError("Hold the foot brake at least 10% to shift out of Park or change direction")
            if value != "P" and not self.ignition_on:
                raise ValueError("Turn ignition on to release the Park selector interlock")
            if value in ("R", "D") and not self._cockpit()["ready"]:
                raise ValueError("Start the engine before selecting D or R" if self.is_ice else "Enable READY before selecting D or R")
            self.selector = value
            if value in ("R", "D"):
                self.direction = -1 if value == "R" else 1
                self.actual_gear = 1
            if value == "P":
                self.v, self.wheels = 0.0, [0.0] * 4
            self._event("TRANSMISSION", "Selector " + value)
        elif action in ("parking_brake", "abs_enabled", "esp_enabled"):
            if not isinstance(value, bool):
                raise ValueError(action + " must be boolean")
            if action == "abs_enabled" and value and not self.configuration["abs_installed"]:
                raise ValueError("ABS is not installed in this vehicle configuration")
            if action == "esp_enabled" and value and not self.configuration["esp_installed"]:
                raise ValueError("ESP is not installed in this vehicle configuration")
            setattr(self, action, value)
            if action == "abs_enabled":
                self.inputs["abs_enabled"] = value
                self._overrides["abs_enabled"] = value
                if not value:
                    self.esp_enabled = False
            if action == "esp_enabled" and value:
                self.abs_enabled = True
                self.inputs["abs_enabled"] = True
                self._overrides["abs_enabled"] = True
            self._event("DRIVER", action.replace("_", " ") + (" on" if value else " off"))
        else:
            raise ValueError("Unknown vehicle control")
        return self.snapshot()

    def _validate_inputs(self, supplied: dict) -> dict:
        if not isinstance(supplied, dict):
            raise ValueError("inputs must be an object")
        rest = dict(supplied)
        clutch = rest.pop("clutch", None)
        checked = super()._validate_inputs(rest)
        if "clutch" in supplied:
            if isinstance(clutch, bool) or not isinstance(clutch, (int, float)) or not math.isfinite(clutch) or not 0 <= clutch <= 1:
                raise ValueError("clutch must be a finite number in [0, 1]")
            checked["clutch"] = float(clutch)
        return checked

    def _control_manual_gear(self, value):
        if not isinstance(value, str) or value not in ("N", "R", "1", "2", "3", "4", "5", "6"):
            raise ValueError("Choose manual gear N, R or 1–6")
        if value == self.selector:
            return
        if not self.ignition_on:
            raise ValueError("Turn ignition on before changing the teaching transmission")
        if self.inputs.get("clutch", 0) < .9 and not (value == "N" and self.v * 3.6 <= 1):
            raise ValueError("Press the clutch at least 90% before selecting a manual gear")
        changes_direction = value != "N" and (value == "R") != (self.direction < 0)
        if (value == "R" or changes_direction) and self.v * 3.6 > 1:
            raise ValueError("Stop before selecting Reverse or changing direction")
        if value.isdigit():
            expected_rpm = self.v / self.p.wheel_radius_m * self.RATIOS[int(value)-1] * self.FINAL_DRIVE * 30 / math.pi
            if expected_rpm > self.configuration["redline_rpm"] * 1.05:
                raise ValueError("That gear would over-speed the engine; slow down or select a higher gear")
        self.selector = value
        if value != "N":
            self.direction = -1 if value == "R" else 1
            self.actual_gear = int(value) if value.isdigit() else 1
        self._event("TRANSMISSION", "Manual gear " + value)

    def _control_hvac(self, value):
        if not self.configuration["hvac_installed"]:
            raise ValueError("Cabin HVAC is not installed")
        if not isinstance(value, dict) or set(value) - {"enabled", "setpoint_c", "fan", "ac_enabled"}:
            raise ValueError("HVAC settings must be an object with enabled, setpoint_c, fan or ac_enabled")
        checked = dict(self.hvac)
        for key, item in value.items():
            if key in ("enabled", "ac_enabled"):
                if not isinstance(item, bool):
                    raise ValueError(key + " must be boolean")
                if key == "ac_enabled" and item and not self.configuration["ac_installed"]:
                    raise ValueError("Air conditioning is not installed")
            else:
                low, high = (16., 30.) if key == "setpoint_c" else (0., 1.)
                if isinstance(item, bool) or not isinstance(item, (int, float)) or not math.isfinite(item) or not low <= item <= high:
                    raise ValueError(f"HVAC {key} must be a finite number in [{low}, {high}]")
                item = float(item)
            checked[key] = item
        self.hvac = checked
        self._event("HVAC", "Cabin controls updated")

    def _engaged(self):
        if self.manual_transmission:
            return self.selector != "N"
        return self.selector in ("D", "R") and not self.parking_brake

    def advance(self, seconds: float, inputs: dict | None = None) -> dict:
        if not isinstance(seconds, (int, float)) or isinstance(seconds, bool) or not math.isfinite(seconds) or seconds < 0:
            raise ValueError("seconds must be finite and nonnegative")
        if inputs is not None and not isinstance(inputs, dict):
            raise ValueError("inputs must be an object")
        supplied = dict(inputs or {})
        controls = {key: supplied.pop(key) for key in ("ignition", "abs_enabled", "esp_enabled") if key in supplied}
        # Validate the whole request before committing any switch or pedal.
        self._validate_inputs(supplied)
        for key, value in controls.items():
            if not isinstance(value, bool):
                raise ValueError(key + " must be boolean")
        if controls.get("ignition") is False and self.v * 3.6 > 1:
            raise ValueError("Stop the vehicle before switching the ignition off")
        if controls.get("abs_enabled") and not self.configuration["abs_installed"]:
            raise ValueError("ABS is not installed in this vehicle configuration")
        if controls.get("esp_enabled") and not self.configuration["esp_installed"]:
            raise ValueError("ESP is not installed in this vehicle configuration")
        # Compatibility with existing ignition-cycle exercises. These controls
        # are still separate from the explicit start/READY latch.
        for key, value in controls.items():
            current = self.ignition_on if key == "ignition" else getattr(self, key)
            if value != current:
                self.control(key, value)
        return super().advance(seconds, supplied)

    def _validate_connection_change(self, connection_id, connected):
        if not isinstance(connection_id, str):
            raise ValueError("Connector ID must be text")
        if not isinstance(connected, bool):
            raise ValueError("connected must be boolean")
        if connection_id not in self.CONNECTIONS:
            if self.sensor_bank is None or connection_id not in self.sensor_bank.connections:
                raise ValueError("Unknown vehicle connection")
            if connection_id.startswith("unit_"):
                unit = next((unit for unit in self.sensor_bank.catalog["units"] if unit["id"] == connection_id[5:]), None)
                if not unit or not unit["installed"]:
                    raise ValueError("Unit is not installed in this configuration")
            elif not self.sensor_bank.specs[connection_id]["installed"]:
                raise ValueError("Sensor is not installed in this configuration")
            return
        if connection_id == "ect" and not self.has_engine:
            raise ValueError("No combustion-engine coolant sensor is installed")
        if connection_id == "bmu" and not self.has_hv:
            raise ValueError("No traction battery monitor is installed")
        if connection_id == "wheel_fl" and not self.configuration["abs_installed"]:
            raise ValueError("Wheel-speed electronics are not installed without ABS")

    def _write_connection(self, connection_id, connected, *, event=True):
        """Commit an already-validated contact without cancelling its schedule."""
        connections = self.connections if connection_id in self.CONNECTIONS else self.sensor_bank.connections
        changed = connections[connection_id] != connected
        connections[connection_id] = connected
        if event and changed:
            self._event("WIRING", connection_id + (" reconnected" if connected else " disconnected"))

    def set_connection(self, connection_id: str, connected: bool) -> dict:
        """Direct contact control cancels this connector's intermittent fault."""
        self._validate_connection_change(connection_id, connected)
        cancelled = self._connection_faults.pop(connection_id, None)
        self._write_connection(connection_id, connected)
        if cancelled is not None:
            self._event("WIRING", connection_id + ": intermittent fault cancelled; contact " + ("connected" if connected else "open"))
        return self.snapshot()

    def set_connection_fault(self, connection_id: str, mode="intermittent", pattern="regular", connected_s=3.0, dropout_s=1.0) -> dict:
        """Apply a manual or timed open circuit to an installed sensor only.

        Validation finishes before any schedule, contact or event is changed.
        Intermittent contact starts connected; normal sampling and diagnostic
        persistence determine whether a dropout is detected or stored.
        """
        mode, pattern, connected_s, dropout_s = validate_connection_fault_settings(mode, pattern, connected_s, dropout_s)
        if not isinstance(connection_id, str):
            raise ValueError("Connector ID must be text")
        sensor = next((sensor for sensor in self.sensor_bank.specs.values() if sensor["connection_id"] == connection_id), None) if self.sensor_bank is not None else None
        if sensor is None:
            raise ValueError("Choose a sensor with an independent connector; derived values and whole-unit connections cannot use this fault control")
        if not sensor["installed"]:
            raise ValueError("Sensor is not installed in this configuration")
        self._validate_connection_change(connection_id, True)
        if mode != "intermittent":
            return self.set_connection(connection_id, mode == "normal")
        schedule = ConnectionFaultSchedule(connection_id, pattern, connected_s, dropout_s,
                                           started_tick=self.tick, tick_seconds=self.DT)
        self._write_connection(connection_id, True)
        self._connection_faults[connection_id] = schedule
        self._event("WIRING", sensor["label"] + " (" + connection_id + "): " + pattern + " intermittent fault enabled; contact connected")
        return self.snapshot()

    def _before_tick(self) -> None:
        for connection_id in sorted(self._connection_faults):
            schedule = self._connection_faults[connection_id]
            for _, connected in schedule.advance_to(self.tick):
                self._write_connection(connection_id, connected, event=False)
                label = self.sensor_bank.specs[connection_id]["label"]
                self._event("WIRING", label + " (" + connection_id + "): intermittent " + ("restoration; contact connected" if connected else "dropout; contact open"))

    def _connection_fault_snapshot(self):
        result = {}
        for connection_id, schedule in self._connection_faults.items():
            connected = not self._connection_open(connection_id) if connection_id in self.CONNECTIONS else self.sensor_bank.connections[connection_id]
            result[connection_id] = schedule.snapshot(self.tick, connected)
        return result

    def apply_sensor_effects(self, effects: dict | None) -> None:
        effects = dict(effects or {})
        factor = effects.get("torque_factor", 1.0)
        self.sensor_effects = {**effects, "engine_inhibit": bool(effects.get("engine_inhibit", False)),
                               "torque_factor": clamp(float(factor), 0.0, 1.0)}

    def clear_emissions_dtcs(self) -> None:
        super().clear_emissions_dtcs()
        if self.sensor_bank is not None:
            self.sensor_bank.clear_codes()

    def _bmu_update(self, dt: float) -> None:
        if not self.has_hv:
            self.contactor = "NOT INSTALLED"
            self.battery_charge_limit_kw = self.battery_discharge_limit_kw = 0.0
            self.battery_current_a = self.battery_power_kw = 0.0
            return
        original = self.inputs["ignition"]
        self.inputs["ignition"] = self.ignition_on and self.start_requested
        try:
            super()._bmu_update(dt)
        finally:
            self.inputs["ignition"] = original

    def _supervisor_update(self, dt: float) -> None:
        inp = self.inputs
        engaged = self._engaged()
        torque_factor = self.sensor_effects.get("torque_factor", 1.0)
        if self.is_ice:
            self._engine_wanted = self.ignition_on and self.start_requested and not self.sensor_effects.get("engine_inhibit", False)
            self._engine_force_request = self._motor_force_request = self._generator_request_kw = 0.0
            if not self.ignition_on:
                self.mode = "OFF"
            elif not self.start_requested:
                self.mode = "IGNITION ON"
            elif not self._engine_wanted:
                self.mode = "ENGINE INHIBITED"
            elif self.t < self._crank_until:
                self.mode = "CRANKING"
            else:
                self.mode = "DRIVING" if engaged and inp["throttle"] > .01 else "IDLING"
            return
        original = {"ignition": inp["ignition"], "throttle": inp["throttle"]}
        inp["ignition"] = self.ignition_on and self.start_requested
        inp["throttle"] = inp["throttle"] * torque_factor if engaged else 0.0
        try:
            super()._supervisor_update(dt)
        finally:
            inp.update(original)
        if self.configuration["powertrain"] == "bev":
            self._engine_wanted = False
            self._generator_request_kw = self._engine_force_request = 0.0
            self._motor_force_request = self._drive_force if engaged else 0.0
            if self.mode in ("HYBRID", "CHARGE SUSTAIN"):
                # The reused hybrid supervisor must not advertise an engine
                # charging strategy in a vehicle with no combustion engine.
                self.mode = "EV" if self._drive_force > 0 else "COAST" if self.v > .2 else "READY"
        elif self.sensor_effects.get("engine_inhibit"):
            self._engine_wanted = False
            self._generator_request_kw = self._engine_force_request = 0.0
        if not engaged:
            self._engine_force_request = self._motor_force_request = 0.0
            self._generator_request_kw = 0.0
        if not self.start_requested:
            self.mode = "IGNITION ON" if self.ignition_on else "OFF"

    def _engine_ecu_update(self, dt: float) -> None:
        if self.has_engine:
            super()._engine_ecu_update(dt)
        else:
            self._ect_sample = ect_circuit(self.coolant_c, self.p, powered=False)
            self.ect_c = self.ect_used_c = -40.0
            self._ect_derate = 1.0
        if self.sensor_bank is not None:
            self.sensor_bank.sample(self.raw_snapshot(), dt)
            self.apply_sensor_effects(self.sensor_bank.effects)

    def _abs_esp_update(self, dt: float) -> None:
        if not self.configuration["abs_installed"]:
            self.abs_active = self.esp_active = False
            self._extra_brake = [0.0] * 4
            self.brake_pressure = [1.0] * 4
            self.yaw_target = self.v / self.p.wheelbase_m * math.tan(math.radians(self.inputs["steer_deg"]))
            return
        original = self.inputs["abs_enabled"]
        self.inputs["abs_enabled"] = self.abs_enabled and self.ignition_on and not self.sensor_effects.get("abs_inhibit", False)
        try:
            super()._abs_esp_update(dt)
        finally:
            self.inputs["abs_enabled"] = original
        if not self.configuration["esp_installed"] or not self.esp_enabled or self.sensor_effects.get("esp_inhibit", False):
            self.esp_active = False
            self._extra_brake = [0.0] * 4

    def _shift_update(self) -> None:
        if not self.is_ice or self.manual_transmission or self.selector != "D" or self.t - self._last_shift < .5:
            return
        speed, pedal = self.v * 3.6, self.inputs["throttle"]
        up = (15, 29, 46, 67, 91)
        down = (9, 20, 34, 51, 73)
        gear = self.actual_gear
        if gear < 6 and speed > up[gear - 1] + pedal * 14:
            self.actual_gear += 1
        elif gear > 1 and speed < down[gear - 2] + pedal * 5:
            self.actual_gear -= 1
        if gear != self.actual_gear:
            self._last_shift = self.t
            self._event("TRANSMISSION", "Automatic gear " + str(self.actual_gear))

    def _engine_force(self, dt: float, wheel_linear: float, ready: bool) -> float:
        p = self.configuration
        if not self.has_engine:
            self.rpm = self.engine_torque_nm = 0.0
            self._engine_running = False
            return 0.0
        if not self._engine_wanted:
            self._clutch_torque_nm = 0.
            self._engine_running = False
            self.rpm += (0.0 - self.rpm) * min(1.0, dt / .20)
            if self.rpm < 1:
                self.rpm = 0.0
            self.engine_torque_nm = 0.0
            return 0.0
        if self.is_ice and self.t < self._crank_until:
            self._engine_running = False
            self.rpm += (250.0 - self.rpm) * min(1.0, dt / .08)
            self.engine_torque_nm = 0.0
            return 0.0
        self._engine_running = True
        self._shift_update()
        pedal = self.inputs["throttle"]
        engaged = self._engaged()
        if self.is_ice:
            if self.manual_transmission:
                return self._manual_engine_force(dt, wheel_linear, ready)
            ratio = 3.1 if self.selector == "R" else self.RATIOS[self.actual_gear - 1]
            road_rpm = wheel_linear / self.p.wheel_radius_m * ratio * self.FINAL_DRIVE * 30 / math.pi
            if engaged:
                slip_rpm = pedal * 1300 * (1.0 - clamp(wheel_linear / 18.0, 0, 1))
                target = max(p["idle_rpm"], road_rpm + slip_rpm)
            else:
                target = p["idle_rpm"] + pedal * (p["redline_rpm"] - p["idle_rpm"]) * .90
            target = clamp(target, 0.0, p["redline_rpm"])
            self.rpm += (target - self.rpm) * min(1.0, dt / .20)
            peak_at = 2100.0 if p["powertrain"] == "diesel" else 3300.0
            curve = clamp(1.0 - ((self.rpm - peak_at) / (p["redline_rpm"] * .9)) ** 2, .50, 1.0)
            torque = p["peak_torque_nm"] * curve * pedal * self._ect_derate * self.sensor_effects.get("torque_factor", 1.0)
            if self.rpm > p["redline_rpm"] * .985:
                torque *= .10
            force = torque * ratio * self.FINAL_DRIVE * .90 / self.p.wheel_radius_m
            force = min(force, p["peak_power_kw"] * 1000 / max(wheel_linear, 1.0))
            if road_rpm >= p["redline_rpm"]:
                force = 0.0
            if ready and engaged and self.inputs["brake"] < .01:
                # A modest converter creep is a declared training assumption.
                return force + (160.0 * (1 - pedal) * self.sensor_effects.get("torque_factor", 1.0) if wheel_linear < 2.0 else 0.0)
            return 0.0
        demand = self._engine_force_request * max(wheel_linear, 2.0) / 1000 + self._generator_request_kw
        target = clamp(1200 + demand * 45, 1200, p["redline_rpm"])
        self.rpm += (target - self.rpm) * min(1.0, dt / .30)
        ramp = clamp(self.rpm / 1200.0, 0, 1) * self._ect_derate
        return self._engine_force_request * ramp if ready and engaged else 0.0

    def _manual_engine_force(self, dt: float, wheel_linear: float, ready: bool) -> float:
        """Lumped clutch slip and engine inertia, with a selectable ratio.

        The selected clutch capacity and speed controller are teaching assumptions;
        synchronizer dynamics, torsional vibration and clutch temperature are omitted.
        """
        p = self.configuration
        ratio = 3.1 if self.selector == "R" else self.RATIOS[self.actual_gear - 1]
        coupling = (1. - self.inputs.get("clutch", 0.)) ** 2 if self._engaged() else 0.
        road_rpm = wheel_linear / self.p.wheel_radius_m * ratio * self.FINAL_DRIVE * 30 / math.pi
        target = p["idle_rpm"] + self.inputs["throttle"] * (p["redline_rpm"] - p["idle_rpm"]) * .9
        curve = clamp(1. - ((self.rpm - (2100. if p["powertrain"] == "diesel" else 3300.)) / (p["redline_rpm"] * .9)) ** 2, .5, 1.)
        engine_torque = clamp((target - self.rpm) * .12, -50., p["peak_torque_nm"] * curve)
        engine_torque *= self._ect_derate * self.sensor_effects.get("torque_factor", 1.)
        engine_torque -= self._hvac_output["shaft_load_kw"] * 1000. / max(self.rpm * math.pi / 30., 25.)
        capacity = p["peak_torque_nm"] * 1.45 * coupling
        clutch_torque = clamp((self.rpm - road_rpm) * .20, -capacity, capacity)
        self._clutch_torque_nm = clutch_torque
        self.rpm = clamp(self.rpm + (engine_torque - clutch_torque) / self.p.engine_inertia_kg_m2 * dt * 30 / math.pi, 0., p["redline_rpm"] * 1.08)
        if coupling > .5 and self.rpm < 400.:
            self._stall_elapsed += dt
        else:
            self._stall_elapsed = 0.
        if self._stall_elapsed >= .12:
            self.start_requested = self._engine_wanted = self._engine_running = False
            self._manual_stalled = True
            self.mode = "STALLED"
            self._event("ENGINE", "Engine stalled under clutch load; select N, press clutch and restart")
            return 0.
        return clutch_torque * ratio * self.FINAL_DRIVE * .9 / self.p.wheel_radius_m if ready else 0.

    def _hvac_step(self, dt: float, ready: bool) -> None:
        conf, controls = self.configuration, self.hvac
        connected = self.sensor_bank is None or self.sensor_bank.connections.get("unit_hvac", True)
        sensor_ok = self.sensor_bank is None or self.sensor_bank.connections.get("cabin_temperature", True)
        powered = conf["hvac_installed"] and connected and self.ignition_on
        active = powered and controls["enabled"] and controls["fan"] > 0
        blower = .12 * controls["fan"] ** 2 if active else 0.
        heat = cooling = compressor = electric_heat = shaft_load = 0.
        status = "not installed" if not conf["hvac_installed"] else "disconnected" if not connected else "unpowered" if not powered else "off"
        if active:
            status = "ventilation"
            error = controls["setpoint_c"] - self.cabin_c
            if not sensor_ok:
                status = "temperature sensor fault; ventilation only"
            elif error > .25:
                requested = min(4.5, error * .60) * controls["fan"]
                if conf["heater_type"] == "coolant":
                    heat = min(requested, max(0., self.coolant_c - self.cabin_c - 5.) * .085 * controls["fan"])
                    status = "heating" if heat > .05 else "waiting for warm coolant"
                elif ready:
                    electric_heat = heat = requested
                    status = "heating"
                else:
                    status = "waiting for READY"
            elif error < -.25 and controls["ac_enabled"] and conf["ac_installed"]:
                if ready:
                    cooling = min(4., -error * .60) * controls["fan"]
                    compressor = cooling / 2.5
                    status = "cooling"
                else:
                    status = "waiting for engine / READY"
            elif abs(error) <= .25:
                status = "holding temperature"
        electrical = blower + electric_heat + (compressor if self.has_hv else 0.)
        if self.has_hv and ready and electrical > 0:
            available = max(0., self.battery_discharge_limit_kw - .5)
            scale = min(1., available / electrical)
            if scale < 1.:
                blower *= scale; heat *= scale; cooling *= scale
                compressor *= scale; electric_heat *= scale; electrical *= scale
                status = "limited by traction battery"
        if self.is_ice and self._engine_running:
            shaft_load = compressor + blower / .65
        # No low-voltage battery plant is claimed: ignition-only blower demand is
        # displayed, but terminal-energy integration starts at engine/READY.
        delivered_electrical = electrical if ready else 0.
        heat_flow_kw = heat - cooling + (self.p.ambient_c - self.cabin_c) * .075
        self.cabin_c += heat_flow_kw * 1000. / 70_000. * dt
        if conf["heater_type"] == "coolant":
            self.coolant_c -= heat * 1000. / self.p.coolant_thermal_capacity_j_k * dt
        self._hvac_energy_kwh += (shaft_load if self.is_ice else delivered_electrical) * dt / 3600.
        self._hvac_output = {"powered": powered, "connected": connected, "status": status,
                             "heat_kw": heat, "cooling_kw": cooling, "blower_kw": blower,
                             "compressor_kw": compressor, "electric_heater_kw": electric_heat,
                             "electrical_kw": delivered_electrical, "shaft_load_kw": shaft_load}

    def _fuel_and_heat_step(self, dt: float) -> None:
        if not self.has_engine:
            self.fuel_l_h = self.maf_g_s = 0.0
            return
        efficiency = .38 if self.configuration["powertrain"] == "diesel" else .30
        idle = 2300.0 if self.configuration["powertrain"] == "diesel" else 3000.0
        fuel_w = max(0., self.engine_shaft_kw) * 1000 / efficiency + idle if self._engine_running else 0.0
        mass_kg_s = fuel_w / self.p.fuel_lhv_j_kg
        self.fuel_l_h = mass_kg_s / self.p.fuel_density_kg_l * 3600
        # Diesel runs lean; this is a coarse airflow estimate, not combustion chemistry.
        self.maf_g_s = mass_kg_s * 1000 * (24.0 if self.configuration["powertrain"] == "diesel" else 14.7)
        radiator = 300.0 * clamp((self.coolant_c - 85) / 10, 0, 1)
        heat = .23 * fuel_w - (35 + radiator) * (self.coolant_c - self.p.ambient_c)
        self.coolant_c += heat / self.p.coolant_thermal_capacity_j_k * dt
        self.energy["fuel_l"] += self.fuel_l_h * dt / 3600
        self.energy["engine_shaft_kwh"] += self.engine_shaft_kw * dt / 3600

    def _vehicle_step(self, dt: float) -> None:
        p, inp = self.p, self.inputs
        ready = self.ignition_on and self.start_requested and (
            not self.sensor_effects.get("engine_inhibit", False) if self.is_ice else
            self.contactor == "CLOSED" and not self._bmu_fault and not self._network_fault)
        engaged = self._engaged()
        wheel_linear = max(0.0, sum(self.wheels[i] for i in self.driven_wheels) / len(self.driven_wheels) * p.wheel_radius_m)
        engine_force = self._engine_force(dt, wheel_linear, ready)
        ready = ready and (self._engine_running if self.is_ice else True)
        self._hvac_step(dt, ready)
        if self.is_ice and not self.manual_transmission and engine_force > 0:
            engine_force = max(0., engine_force - self._hvac_output["shaft_load_kw"] * 1000. * .90 / max(wheel_linear, 2.))
        self.generator_kw = self._generator_request_kw * self._ect_derate if self.has_hv and self._engine_running and ready else 0.0
        motor_force = self._motor_force_request if self.has_hv and ready and engaged else 0.0
        if self.has_hv:
            available_kw = max(0, self.battery_discharge_limit_kw - .5 - self._hvac_output["electrical_kw"]) * .90
            motor_force = min(motor_force, 4200, 60_000 / max(wheel_linear, 1), available_kw * 1000 / max(wheel_linear, 1))
        brake_force = 7500.0 * inp["brake"]
        regen_force = 0.0
        if self.has_hv and ready and self.selector in ("D", "R") and brake_force > 0 and self.v > 1 and not self.abs_active and max(self.slips) < .12:
            regen_force = min(brake_force * .60, 2000, 25_000 / max(wheel_linear, 1),
                              (self.battery_charge_limit_kw + .5) * 1000 / (.88 * max(wheel_linear, 1)))
        regen_force *= clamp((self.v - 1) / 2, 0, 1)
        friction_force = max(0, brake_force - regen_force)
        shares = (.325, .325, .175, .175)
        brake_torques = [(friction_force * share * p.wheel_radius_m + extra) * pressure
                         for share, extra, pressure in zip(shares, self._extra_brake, self.brake_pressure)]
        if self.parking_brake:
            brake_torques[2] += 1100
            brake_torques[3] += 1100
        drive_torques = [(engine_force + motor_force - regen_force) * p.wheel_radius_m / len(self.driven_wheels) if i in self.driven_wheels else 0. for i in range(4)]
        self.wheel_mu = [inp["road_mu"]] * 4
        front_share = clamp(.5 - self.acceleration_m_s2 * .50 / (9.81 * p.wheelbase_m), .35, .75)
        weights = [p.mass_kg * 9.81 * front_share / 2] * 2 + [p.mass_kg * 9.81 * (1 - front_share) / 2] * 2
        tire_forces, old_wheels = [], list(self.wheels)
        for i in range(4):
            kappa = (p.wheel_radius_m * self.wheels[i] - self.v) / max(self.v, 3.0)
            force = self.wheel_mu[i] * weights[i] * self._tire_curve(kappa)
            tire_forces.append(force)
            torque = drive_torques[i] - brake_torques[i] - force * p.wheel_radius_m
            self.wheels[i] = max(0.0, self.wheels[i] + torque / p.wheel_inertia_kg_m2 * dt)
            self.energy["tire_slip_kwh"] += max(0, force * (p.wheel_radius_m * old_wheels[i] - self.v)) * dt / 3_600_000
        drag = .5 * p.air_density_kg_m3 * p.drag_area_m2 * self.v ** 2
        rolling = p.mass_kg * 9.81 * p.rolling_coefficient * clamp(self.v / .1, 0, 1)
        grade = p.mass_kg * 9.81 * math.sin(math.atan(inp["grade_pct"] / 100)) * self.direction
        road_load = drag + rolling + grade
        self.acceleration_m_s2 = (sum(tire_forces) - road_load) / p.mass_kg
        old_v = self.v
        self.v = max(0.0, self.v + self.acceleration_m_s2 * dt)
        if self.selector == "P" or (self.v < .08 and (inp["brake"] > .01 or self.parking_brake)):
            self.v, self.wheels = 0.0, [0.0] * 4
            self.acceleration_m_s2 = 0.0
        travelled = (old_v + self.v) * .5 * dt
        self.distance_m += travelled
        self.signed_distance_m += travelled * self.direction
        self.energy["road_load_kwh"] += road_load * old_v * dt / 3_600_000
        self.slips = [clamp((self.v - p.wheel_radius_m * w) / max(self.v, 3), -3, 1) for w in self.wheels]
        moment = (tire_forces[1] + tire_forces[3] - tire_forces[0] - tire_forces[2]) * p.track_m / 2
        self.yaw_rate += ((self.yaw_target - self.yaw_rate) * 1.8 + moment / p.yaw_inertia_kg_m2) * dt
        if self.v < .1:
            self.yaw_rate *= max(0, 1 - 5 * dt)
        if self.has_hv:
            self.generator_kw = min(self.generator_kw, max(0.0,
                (self.battery_charge_limit_kw * 1000 + motor_force * wheel_linear / .90 - regen_force * wheel_linear * .88 + 500 + self._hvac_output["electrical_kw"] * 1000) / 900)) if ready else 0.0
        self.engine_power_kw = engine_force * wheel_linear / 1000
        # Revving in neutral consumes fuel and turns the engine but delivers no wheel power.
        free_rev_kw = max(0, (self.rpm - self.configuration["idle_rpm"]) * .0012) if self.is_ice and self._engine_running and not engaged else 0.0
        self.engine_shaft_kw = max(0., self.engine_power_kw / .90 + self.generator_kw + free_rev_kw) + self._hvac_output["shaft_load_kw"]
        self.motor_power_kw = (motor_force - regen_force) * wheel_linear / 1000
        self.regen_kw = regen_force * wheel_linear / 1000
        self.friction_brake_kw = sum(t * w for t, w in zip(brake_torques, old_wheels)) / 1000
        electrical_w = motor_force * wheel_linear / .90 - regen_force * wheel_linear * .88 + 500 + self._hvac_output["electrical_kw"] * 1000 - self.generator_kw * 1000 * .90
        if self.has_hv:
            self._battery_step(electrical_w if ready else 0, dt)
        self.engine_torque_nm = self.engine_shaft_kw * 1000 / max(self.rpm * math.pi / 30, 1)
        self.load_pct = clamp(self.engine_shaft_kw / max(self.configuration["peak_power_kw"], 1) * 100, 0, 100)
        self.throttle_pct = inp["throttle"] * 100 if self._engine_running else 0.0
        self._fuel_and_heat_step(dt)
        self.energy["motor_drive_kwh"] += motor_force * wheel_linear * dt / 3_600_000
        self.energy["regen_mechanical_kwh"] += self.regen_kw * dt / 3600
        self.energy["friction_brake_kwh"] += self.friction_brake_kw * dt / 3600
        self.energy["abs_active_s"] += dt if self.abs_active else 0
        self.energy["esp_active_s"] += dt if self.esp_active else 0

    def _cockpit(self) -> dict:
        fault = self._bmu_fault or self._network_fault
        ready = self.ignition_on and self.start_requested and (self._engine_running if self.is_ice else self.contactor == "CLOSED" and not fault)
        if not self.ignition_on:
            state = "off"
        elif not self.start_requested:
            state = "stalled" if self._manual_stalled else "ignition_on"
        elif self.is_ice:
            state = "running" if self._engine_running else "inhibited" if self.sensor_effects.get("engine_inhibit") else "cranking"
        else:
            state = "ready" if ready else "fault" if fault else "precharge"
        can_start = self.ignition_on and not self.start_requested and self.selector in ("P", "N") and self.v * 3.6 <= 1.0 and not (self.is_ice and self.sensor_effects.get("engine_inhibit", False))
        if self.manual_transmission:
            can_start = can_start and self.inputs.get("clutch", 0) >= .9 and not (self.sensor_bank is not None and self.sensor_bank.connections.get("clutch_position") is False)
        low_voltage = 14.2 if ready else 10.6 if state == "cranking" else 12.4 if self.ignition_on else 12.6
        fuel_capacity = self.configuration["fuel_capacity_l"]
        fuel_l = max(0, fuel_capacity - self.energy["fuel_l"]) if fuel_capacity else None
        actual_gear = (self.actual_gear if self.is_ice else 1 if self.configuration["powertrain"] == "bev" else "AUTO") if self.selector == "D" else int(self.selector) if self.manual_transmission and self.selector.isdigit() else self.selector
        return {"configuration": deepcopy(self.configuration), "ignition": "on" if self.ignition_on else "off",
                "start_state": state, "ready": ready, "selector": self.selector, "gear": actual_gear,
                "direction": self.direction, "parking_brake": self.parking_brake,
                "driver_seatbelt_fastened": self.driver_seatbelt_fastened,
                "driver_door_open": self.driver_door_open,
                "odometer_km": self.configuration["initial_odometer_km"] + max(0., self.distance_m) / 1000,
                "trip_distance_km": max(0., self.distance_m - self._trip_start_distance_m) / 1000,
                "abs_enabled": self.abs_enabled, "esp_enabled": self.esp_enabled,
                "can_start": can_start, "can_shift": self.ignition_on and (self.inputs.get("clutch", 0) >= .9 if self.manual_transmission else self.v * 3.6 <= 1.0 and self.inputs.get("brake", 0) >= .1),
                "shift_note": "Press clutch to select a gear; stop before Reverse. Release clutch progressively while applying throttle." if self.manual_transmission else "Hold the foot brake to release P or change direction; stop before selecting P/R.",
                "clutch_coupling": (1. - self.inputs.get("clutch", 0.)) ** 2 if self.manual_transmission and self.selector != "N" else 0.,
                "clutch_torque_nm": self._clutch_torque_nm if self.manual_transmission else None,
                "chassis": {key: deepcopy(self.configuration[key]) for key in ("transmission_type", "drivetrain", "mass_kg", "wheel_radius_m", "drag_area_m2", "rolling_resistance")},
                "hvac": {**deepcopy(self.hvac), **deepcopy(self._hvac_output), "installed": self.configuration["hvac_installed"],
                         "ac_installed": self.configuration["ac_installed"], "heater_type": self.configuration["heater_type"],
                         "cabin_c": self.cabin_c, "ambient_c": self.p.ambient_c, "energy_kwh": self._hvac_energy_kwh,
                         "model_note": "Lumped cabin heat balance; ignition-only blower energy is not integrated without a low-voltage battery plant."},
                "engine_inhibited": bool(self.sensor_effects.get("engine_inhibit")),
                "abs_inhibited": bool(self.sensor_effects.get("abs_inhibit")),
                "esp_inhibited": bool(self.sensor_effects.get("esp_inhibit")),
                "torque_factor": self.sensor_effects.get("torque_factor", 1.0),
                "low_voltage_v": low_voltage, "fuel_l": fuel_l,
                "fuel_pct": fuel_l / fuel_capacity * 100 if fuel_capacity else None,
                "motor_rpm": self.v / self.p.wheel_radius_m * 9.0 * 30 / math.pi if self.has_hv else None,
                "gear_ratio": (3.1 if self.selector == "R" else self.RATIOS[self.actual_gear - 1]) if self.is_ice and self.selector not in ("N", "P") else 9.0 if self.configuration["powertrain"] == "bev" else None,
                "transmission_model": "Ratio-based manual with lumped clutch slip, engine inertia and stalling" if self.manual_transmission else "Ratio-based automatic with torque-converter slip" if self.is_ice else self.configuration["transmission"],
                "fuel_system_installed": self.has_engine, "traction_battery_installed": self.has_hv,
                "glow_plug": self.configuration["powertrain"] == "diesel" and self.ignition_on and not self.start_requested and self.coolant_c < 35}

    def raw_snapshot(self) -> dict:
        result = super().snapshot()
        result["vehicle"] = self._cockpit()
        result["vehicle"]["chassis"]["driven_wheels"] = [["fl", "fr", "rl", "rr"][i] for i in self.driven_wheels]
        result["ambient_c"] = self.p.ambient_c
        result["module_status"]["HVAC"] = result["vehicle"]["hvac"]["status"].upper()
        result["signed_speed_kph"] = self.v * 3.6 * self.direction
        result["signed_distance_m"] = self.signed_distance_m
        result["configuration_id"] = self.configuration["id"]
        # Instantaneous distance consumption is undefined at a standstill.
        result["fuel_l_100km"] = (result["fuel_l_h"] * 100 / result["speed_kph"]
                                   if self.has_engine and result["speed_kph"] >= 1 else None)
        result["inputs"]["esp_enabled"] = self.esp_enabled
        result["inputs"]["parking_brake"] = self.parking_brake
        result["inputs"]["selector"] = self.selector
        if not self.has_hv:
            for key in ("soc_pct", "battery_voltage_v", "battery_current_a", "battery_temp_c", "battery_power_kw",
                        "battery_discharge_limit_kw", "battery_charge_limit_kw"):
                result[key] = None
            result["bmu_report"] = {}
            result["module_status"]["BMU"] = result["module_status"]["PHEV_ECU"] = "NOT INSTALLED"
            for key in ("pack_voltage_v", "pack_current_a", "cell_min_v", "cell_max_v", "pack_temp_c", "dc_link_v", "bmu_message_age_ms"):
                result["sensors"][key] = None
        if not self.has_engine:
            result["module_status"]["ECU"] = "NOT INSTALLED"
            result["coolant_c"] = None
            result["sensors"].update(ect_c=None, ect_used_c=None, ect_voltage_v=None, ect_sensor_valid=False,
                                     crank_rpm=None, maf_g_s=None, iat_c=None)
        if not self.configuration["abs_installed"]:
            result["module_status"]["ABS_ESP"] = "NOT INSTALLED"
            result["sensors"]["wheel_speeds_kph"] = [None] * 4
        elif not self.ignition_on:
            result["module_status"]["ABS_ESP"] = "OFF"
        elif self.sensor_effects.get("abs_inhibit", False):
            result["module_status"]["ABS_ESP"] = "SIGNAL FAULT"
        result["vehicle"]["warning_lamps"] = {
            "mil": self.ignition_on and (bool(result["dtcs"]) or self.has_engine and not self._engine_running),
            "oil": self.ignition_on and self.has_engine and not self._engine_running,
            "battery": self.ignition_on and not result["vehicle"]["ready"],
            "parking_brake": self.ignition_on and self.parking_brake,
            "seatbelt": self.ignition_on and not self.driver_seatbelt_fastened,
            "door_open": self.ignition_on and self.driver_door_open,
            "abs": self.configuration["abs_installed"] and self.ignition_on and (not self.abs_enabled or self._connection_open("wheel_fl") or bool(self.sensor_effects.get("abs_inhibit"))),
            "esp": self.configuration["esp_installed"] and self.ignition_on and (not self.esp_enabled or self.esp_active or bool(self.sensor_effects.get("esp_inhibit"))),
            "ready": result["vehicle"]["ready"], "glow_plug": result["vehicle"]["glow_plug"]}
        return result

    def snapshot(self) -> dict:
        result = self.raw_snapshot()
        result["connection_faults"] = self._connection_fault_snapshot()
        if self.sensor_bank is not None:
            result["vehicle_sensors"] = deepcopy(self.sensor_bank.readings)
            result["connections"].update(self.sensor_bank.connections)
            result["effective_connections"].update(self.sensor_bank.connections)
            if self.configuration["abs_installed"]:
                # Preserve the physical wheel velocities above, but never turn
                # a missing measured channel into an apparent valid speed.
                for index, corner in enumerate(("fl", "fr", "rl", "rr")):
                    reading = self.sensor_bank.readings.get("wheel_" + corner)
                    if reading is not None:
                        result["sensors"]["wheel_speeds_kph"][index] = reading.get("value")
            stored, pending = list(self.sensor_bank.stored_dtcs), list(self.sensor_bank.pending_dtcs)
            result["sensor_dtcs"] = {"stored": sorted(stored), "pending": sorted(pending),
                                     "details": self.sensor_bank.fault_details(),
                                     "modules": deepcopy(self.sensor_bank.module_faults)}
            result["dtcs"] = sorted(set(result["dtcs"]) | set(stored))
            result["pending_dtcs"] = sorted(set(result["pending_dtcs"]) | set(pending))
            result["mil"] = bool(result["dtcs"])
            result["module_dtc"]["ECU"] = result["dtcs"]
            result["vehicle"]["warning_lamps"]["mil"] = self.ignition_on and (bool(result["dtcs"]) or self.has_engine and not self._engine_running)
            for unit, old_unit in (("ecu", "ECU"), ("abs", "ABS_ESP"), ("supervisor", "PHEV_ECU")):
                if self.sensor_bank.connections.get("unit_" + unit) is False:
                    result["module_status"][old_unit] = "DISCONNECTED"
        return result
