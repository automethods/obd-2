"""Plain-language explanations of the existing teaching-model state.

This module observes snapshots; it does not invent measurements, change the
plant, diagnose a real car, or replace the model's controller decisions. The
browser can show these sentences first and keep byte-level details optional.
"""
from __future__ import annotations

from copy import deepcopy
import math
from typing import Any


_FAULTS = [
    {"id": "none", "title": "Everything connected", "kind": "normal",
     "plain_effect": "Remove the selected fault and let the model receive its normal inputs.",
     "meaning": "Removing a cause and clearing a remembered warning are separate actions.",
     "profiles": ["engine", "phev", "braking"]},
    {"id": "ect_open", "title": "Unplug the coolant temperature sensor", "kind": "sensor connection",
     "plain_effect": "Break the modeled sensor path while the coolant itself keeps its temperature.",
     "meaning": "The engine computer sees an unusable electrical reading and later chooses a substitute temperature.",
     "profiles": ["engine", "phev", "braking"]},
    {"id": "wheel_fl_dropout", "title": "Disconnect the front-left wheel sensor", "kind": "sensor connection",
     "plain_effect": "Remove the front-left speed report while the physical wheel can keep turning.",
     "meaning": "This model disables all automatic anti-lock and yaw brake assistance; ordinary friction braking continues.",
     "profiles": ["phev", "braking"]},
    {"id": "bmu_timeout", "title": "Stop the battery monitor's reports", "kind": "missing messages",
     "plain_effect": "Hold the last received battery report while its age keeps increasing.",
     "meaning": "After the freshness deadline, the hybrid computer stops propulsion and keeps that shutdown until a restart.",
     "profiles": ["phev", "braking"]},
    {"id": "cell_low", "title": "Give the battery monitor a low-cell reading", "kind": "test measurement",
     "plain_effect": "Supply a deliberately low voltage measurement to the battery monitor.",
     "meaning": "This tests the protection decision. It does not simulate physical damage to an individual battery cell.",
     "profiles": ["phev", "braking"]},
]


def fault_catalog() -> list[dict[str, Any]]:
    """Return independent beginner-facing descriptions of supported faults."""
    return deepcopy(_FAULTS)


def _number(value, fallback=0.0):
    return float(value) if isinstance(value, (int, float)) and math.isfinite(value) else fallback


def _fmt(value, places=1):
    if not isinstance(value, (int, float)) or not math.isfinite(value):
        return "not available"
    return f"{value:,.{places}f}"


def _observation(label, value_text, meaning, status, signal_id):
    return {"label": label, "value_text": value_text, "meaning": meaning,
            "status": status, "signal_id": signal_id}


def _fault(snapshot, *, title=None, present=False, detected=False,
           state="normal", cause_name=None, repair_instruction=""):
    selected = snapshot.get("inputs", {}).get("fault", "none")
    selected_info = next((item for item in _FAULTS if item["id"] == selected), _FAULTS[0])
    return {"name": selected, "cause_name": cause_name or selected,
            "title": title or selected_info["title"], "present": bool(present),
            "detected": bool(detected), "state": state,
            "repair_instruction": repair_instruction}


def _result(snapshot, heading, summary, changed, action, why, next_step,
            observations, fault=None):
    return {"heading": heading, "summary": summary, "what_changed": changed,
            "computer_action": action, "why": why, "next_step": next_step,
            "observations": observations, "fault": fault or _fault(snapshot),
            "model_note": "These explanations describe the supplied teaching model. A fault warning describes an observation, not a guaranteed failed part."}


def _coolant_observations(s):
    sensor = s.get("sensors", {})
    powered = sensor.get("ect_powered", s.get("inputs", {}).get("ignition", False))
    valid = bool(sensor.get("ect_sensor_valid", False))
    fallback = _number(s.get("ect_derate_factor"), 1) < 1
    actual = _observation("Actual coolant", f"About {_fmt(s.get('coolant_c'))} °C",
                          "This is the physical temperature inside the model. Unplugging a wire does not instantly change it.",
                          "normal", "coolant_c")
    if not powered:
        measured = _observation("What the sensor reports", "No powered measurement",
                                "The sensor circuit is switched off. A zero electrical reading is not a zero coolant temperature.",
                                "unavailable", "sensors.ect_c")
        used = _observation("Temperature used for control", "Not in use",
                            "Switch ignition on and advance time to give the computer a new measurement.",
                            "unavailable", "sensors.ect_used_c")
    elif valid:
        measured = _observation("What the sensor reports", f"About {_fmt(sensor.get('ect_c'))} °C",
                                "A small difference from the physical temperature comes from rounding the electrical measurement.",
                                "normal", "sensors.ect_c")
        used = _observation("Temperature used for control", f"The measured temperature: {_fmt(sensor.get('ect_used_c'))} °C",
                            "The computer can use this believable sensor reading.", "normal", "sensors.ect_used_c")
    else:
        measured = _observation("What the sensor reports", "Reading cannot be trusted",
                                "The detailed instrument shows minus forty degrees as an invalid-reading marker. The coolant has not suddenly frozen.",
                                "invalid", "sensors.ect_c")
        used = _observation("Temperature used for control",
                            f"A substitute: {_fmt(sensor.get('ect_used_c'), 0)} °C" if fallback else "Still checking the unusable input",
                            "A substitute lets the simplified controller continue with reduced requested torque." if fallback else
                            "The short persistence check has not yet selected the substitute. The bad reading is still present in the control input.",
                            "substituted" if fallback else "invalid", "sensors.ect_used_c")
    return [actual, measured, used]


def _engine_observations(s):
    return _coolant_observations(s) + [
        _observation("Engine movement", f"About {_fmt(s.get('rpm'), 0)} turns per minute",
                     "Engine speed describes how quickly the crankshaft is turning. It is not the car's road speed.",
                     "normal", "rpm")]


def _battery_observations(s):
    sensor = s.get("sensors", {})
    current = _number(s.get("battery_current_a"))
    flow = "Energy is leaving the battery" if current > .2 else "Energy is entering the battery" if current < -.2 else "Almost no battery current"
    age = _number(sensor.get("bmu_message_age_ms"))
    stale = age > 300.0001
    contactor = s.get("contactor", "OFF")
    switch_text = {"CLOSED": "Main battery switch closed", "PRECHARGE": "Preparing the electrical connection",
                   "FAULT": "Main battery switch held open", "OFF": "Main battery switch open"}.get(contactor, "Connection state unavailable")
    return [
        _observation("Battery charge", f"About {_fmt(s.get('soc_pct'), 0)} percent remaining",
                     "This is the model's stored charge fraction, like a fuel gauge for the battery.", "normal", "soc_pct"),
        _observation("Actual energy flow", flow,
                     f"The model's battery current is {_fmt(s.get('battery_current_a'))} amperes. Positive means discharge; negative means charging.",
                     "normal", "battery_current_a"),
        _observation("Battery reports", "Last report is too old" if stale else "Recent battery report available",
                     f"The last report is {_fmt(age, 0)} milliseconds old. A held value is not a new measurement." if stale else
                     "The hybrid computer checks when the battery monitor last spoke, as well as what it reported.",
                     "stale" if stale else "normal", "sensors.bmu_message_age_ms"),
        _observation("Battery connection", switch_text,
                     "This switch controls the modeled high-voltage power path. A protection shutdown can keep it open after a fault is removed.",
                     "protected" if contactor == "FAULT" else "normal", "contactor")]


def _brake_observations(s):
    sensor = s.get("sensors", {})
    measured = sensor.get("wheel_speeds_kph", [None] * 4)
    fl = measured[0] if measured else None
    wheels = s.get("wheel_speeds_kph", [None] * 4)
    return [
        _observation("Vehicle movement", f"About {_fmt(s.get('speed_kph'))} kilometres per hour",
                     "The body speed can differ from a wheel's peripheral speed when a tyre is slipping.", "normal", "speed_kph"),
        _observation("Front-left wheel itself", f"Turning at an equivalent {_fmt(wheels[0] if wheels else None)} kilometres per hour",
                     "This physical model value remains observable even if that wheel's sensor is unplugged.", "normal", "wheel_speeds_kph.0"),
        _observation("Front-left speed report", "No measurement arriving" if fl is None else f"About {_fmt(fl)} kilometres per hour",
                     "A missing report does not prove the wheel has stopped." if fl is None else "The brake computer can compare this report with vehicle and other wheel motion.",
                     "missing" if fl is None else "normal", "sensors.wheel_speeds_kph.0"),
        _observation("Anti-lock assistance", "Adjusting brake force" if s.get("abs_active") else "Not adjusting brake force now",
                     "Automatic assistance can release and reapply the modeled brake force. Ordinary friction braking is a separate function.",
                     "active" if s.get("abs_active") else "normal", "abs_active")]


def _explain_configured(s):
    """Describe fitted hardware and the explicit driver controls, not profile aliases."""
    cockpit = s["vehicle"]
    config = cockpit["configuration"]
    powertrain = config["powertrain"]
    engine = powertrain != "bev"
    electric = powertrain in ("hev", "phev", "bev")
    ignition = cockpit["ignition"] == "on"
    state, selector = cockpit["start_state"], cockpit["selector"]
    inputs, sensors = s.get("inputs", {}), s.get("sensors", {})
    selected = inputs.get("fault", "none")
    connections = s.get("effective_connections", s.get("connections", {}))
    open_ports = [name for name, connected in connections.items() if not connected]
    modules = s.get("module_dtc", {})
    engine_fault = engine and ignition and (sensors.get("ect_high_input") or
        sensors.get("ect_circuit_open") and sensors.get("ect_powered") or "P0118" in s.get("pending_dtcs", []))
    engine_memory = engine and "P0118" in s.get("dtcs", []) and not open_ports and not cockpit.get("engine_inhibited")
    battery_fault = electric and ignition and (selected in ("bmu_timeout", "cell_low") or "bmu" in open_ports or s.get("contactor") == "FAULT")
    wheel_fault = config["abs_installed"] and ignition and ("wheel_fl" in open_ports or selected == "wheel_fl_dropout")
    if ignition and (engine_fault or battery_fault or wheel_fault or engine_memory):
        # Existing electrical/debounce explanations remain the authority for
        # these original monitors. Only adapt which hardware is actually fitted.
        legacy = deepcopy(s)
        legacy.pop("vehicle", None)
        legacy["profile"] = "phev" if electric else "braking" if wheel_fault else "engine"
        result = explain(legacy)
        if powertrain == "bev":
            for key in ("heading", "summary", "what_changed", "computer_action", "why", "next_step"):
                result[key] = result[key].replace("hybrid computer", "traction controller").replace("hybrid supervisor", "traction controller")
        if battery_fault:
            result["next_step"] = "Restore the input, brake to a stop, select P, switch ignition off and on, then request START / READY again."
        return result

    observations = [
        _observation("Ignition", "ON" if ignition else "OFF",
                     "Ignition powers the control units. Starting the engine or requesting traction READY is a separate action.",
                     "normal" if ignition else "unpowered", "vehicle.ignition"),
        _observation("Transmission", f"{selector} · gear {cockpit['gear']}" if selector == "D" else selector,
                     "P holds the car; N disconnects drive torque; D selects forward drive; R selects reverse.",
                     "normal", "vehicle.selector"),
        _observation("Vehicle movement", f"{_fmt(s.get('speed_kph'))} km/h" + (" · reverse" if cockpit["direction"] < 0 else ""),
                     "Speed is produced by the wheel and body model. Signed speed identifies the travel direction.",
                     "normal", "signed_speed_kph"),
    ]
    if engine:
        observations.append(_observation("Engine", f"{_fmt(s.get('rpm'), 0)} rpm",
                            "Crankshaft rotation is separate from vehicle motion and from the selector position.", "normal", "rpm"))
    if electric:
        observations.append(_observation("Traction battery", f"{_fmt(s.get('soc_pct'))}% · {s.get('contactor', 'OFF')}",
                            "The battery and inverter provide drive only after the traction system reaches READY.", "normal", "soc_pct"))
    else:
        observations.append(_observation("Fuel remaining", f"{_fmt(cockpit.get('fuel_l'))} L",
                            "The configured tank loses fuel according to the simulated engine's fuel flow.", "normal", "vehicle.fuel_l"))

    if not ignition:
        return _result(s, "Ignition is off", "The vehicle begins parked with its engine and traction request off.",
                       "The selector and parking brake retain their positions; no start command has been issued.",
                       "Powered sensor samples are unavailable while the control units are off.",
                       "The ignition switch and START / READY request have different jobs.",
                       "Turn ignition on. You can connect the scan tool before starting, or press START / READY to prepare to drive.",
                       observations, _fault(s, title="Ignition off", present=bool(open_ports), state="unpowered"))

    details = s.get("sensor_dtcs", {})
    stored = details.get("stored", [])
    pending = details.get("pending", [])
    module_memory = details.get("modules", {})
    if open_ports or cockpit.get("engine_inhibited") or cockpit.get("abs_inhibited") or cockpit.get("esp_inhibited") or cockpit.get("torque_factor", 1) < 1:
        labels = ", ".join(name.replace("unit_", "").replace("_", " ") for name in open_ports[:4])
        actions = []
        if cockpit.get("engine_inhibited"):
            actions.append("Engine operation is inhibited.")
        if cockpit.get("torque_factor", 1) < 1:
            actions.append(f"The propulsion request multiplier is {_fmt(cockpit['torque_factor'], 2)}.")
        if cockpit.get("abs_inhibited"):
            actions.append("Anti-lock and yaw assistance are inhibited; friction brakes remain available.")
        elif cockpit.get("esp_inhibited"):
            actions.append("Yaw assistance is inhibited.")
        if "dlc" in open_ports:
            actions.append("The disconnected diagnostic branch blocks scan-tool replies.")
        detected = bool(stored or pending or any(module_memory.values()))
        return _result(s, "Inspect the open connection" if open_ports else "A sampled input is restricting operation",
                       ("Open ports: " + labels + ".") if labels else "A controller is using its declared response to an unavailable input.",
                       "Physical components remain in the model while their measured signals can become unavailable.",
                       " ".join(actions) or "The controller will evaluate the changed connection on its next scheduled sample.",
                       "Disconnecting a connector, sampling the input, and recording a persistent fault are separate steps.",
                       "Select the affected unit, compare its physical and measured values, reconnect the port, then sample again and inspect retained fault memory.",
                       observations, _fault(s, title="Connector or sensor interruption", present=bool(open_ports), detected=detected,
                                            state="confirmed" if stored else "pending" if pending else "checking",
                                            cause_name=open_ports[0] if open_ports else "sensor_input"))

    if state == "ignition_on":
        heading = "Ignition is on; propulsion has not been started"
        summary = "The control units can be diagnosed while the engine is stopped." if engine else "The electric control units are powered, but traction is not READY."
        action = "No engine or motor drive torque is requested."
        next_step = "Connect the scan tool to inspect this powered state, or select P/N and press START / READY."
    elif state == "cranking":
        heading, summary = "The starter is turning the engine", "Crankshaft speed rises before combustion reaches its running state."
        action = "The generic starter interval runs on the shared simulation clock."
        next_step = "Advance time or leave Run active until the engine settles to idle."
    elif state == "precharge":
        heading, summary = "Preparing the traction connection", "The inverter supply is being prepared before the main battery switch closes."
        action, next_step = "Propulsion remains inhibited until READY.", "Advance time and watch READY and the battery contactor state."
    elif selector == "P":
        heading = "The vehicle is ready in Park"
        summary = "The engine can idle while Park holds the vehicle." if not electric else "The traction system is READY while Park holds the vehicle."
        action = "The parking selection blocks vehicle movement."
        next_step = "Hold the foot brake, select D or R, release the parking brake, then ease off the foot brake and apply the accelerator."
    elif selector == "N":
        heading, summary = "Neutral disconnects propulsion", "The vehicle can coast, and an ICE engine can rev, without drive torque reaching the wheels."
        action = "The transmission path to the driven wheels is open in this model."
        next_step = "Apply the brake and select D or R when the direction-change interlock permits it."
    elif cockpit["parking_brake"]:
        heading, summary = "The parking brake is applied", "The drive selector is engaged, but this teaching vehicle inhibits propulsion with the parking brake applied."
        action, next_step = "The rear parking brakes hold the stationary vehicle.", "Hold the foot brake and release the parking brake before driving."
    elif _number(inputs.get("brake")) > .01:
        heading, summary = "The brake pedal requests deceleration", "Friction brakes act on the physical wheels."
        action = "ABS is modulating brake force." if s.get("abs_active") else "Regeneration supplies part of the brake request; friction brakes provide the rest." if _number(s.get("regen_kw")) > .01 else "The current brake request is supplied by friction braking."
        next_step = "Compare road speed, wheel motion and measured wheel speeds where the vehicle has ABS sensors."
    else:
        heading = "Driving in reverse" if selector == "R" else "Driving in forward gear"
        summary = "The accelerator requests propulsion through the selected drivetrain."
        if powertrain == "bev":
            action = "The traction motor uses the single-speed reduction; no combustion engine or fuel system is fitted."
        elif electric:
            action = "The engine and motor are providing the requested drive." if s.get("engine_running") else "The electric motor is providing drive; the combustion engine is currently stopped."
        else:
            action = f"The engine drives through {'reverse' if selector == 'R' else 'automatic gear ' + str(cockpit['gear'])}; wheel speed and transmission ratio influence engine RPM."
        next_step = "Adjust the accelerator and brake. Select a unit to inspect its current sampled signals without leaving the same vehicle session."

    remembered = bool(stored or any(module_memory.values()))
    result = _result(s, heading, summary, "Driver controls change one shared vehicle simulation.", action,
                     "The dashboard, unit map, sampled signals and scanner observe the same simulated clock and physical state.",
                     next_step, observations,
                     _fault(s, title="Earlier sensor fault retained" if remembered else "No current input interruption",
                            present=False, detected=remembered, state="remembered" if remembered else "normal"))
    if remembered:
        result["next_step"] += " Earlier fault records remain available; clearing them does not perform a repair."
    return result


def explain(snapshot: dict[str, Any]) -> dict[str, Any]:
    """Explain one snapshot using its measured state and controller decisions.

    The text is a description of the present state, not a fabricated history or
    a promise that changing one input will immediately remove a latched fault.
    """
    if snapshot.get("vehicle", {}).get("configuration"):
        return _explain_configured(snapshot)
    s = snapshot
    inputs = s.get("inputs", {})
    sensor = s.get("sensors", {})
    profile = s.get("profile", "engine")
    selected = inputs.get("fault", "none")
    connections = s.get("connections", {})
    bmu_missing = selected == "bmu_timeout" or not connections.get("bmu", True)
    wheel_missing = selected == "wheel_fl_dropout" or not connections.get("wheel_fl", True)
    vehicle = profile in ("phev", "braking")
    modules = s.get("module_dtc", {})
    stored = "P0118" in s.get("dtcs", [])
    pending = "P0118" in s.get("pending_dtcs", [])
    powered = bool(sensor.get("ect_powered", inputs.get("ignition", False)))
    high = bool(sensor.get("ect_high_input", False))
    open_path = bool(sensor.get("ect_circuit_open", False))
    fallback = _number(s.get("ect_derate_factor"), 1) < 1
    network_record = "BMU_STATUS_TIMEOUT" in modules.get("PHEV_ECU", [])
    cell_record = "BMU_CELL_UNDERVOLTAGE" in modules.get("BMU", [])
    wheel_record = "ABS_WHEEL_FL_SIGNAL" in modules.get("ABS_ESP", [])
    latch = vehicle and inputs.get("ignition", False) and s.get("contactor") == "FAULT"

    if not inputs.get("ignition", False):
        return _result(s, "The experiment's power request is off",
                       "The computers are not being asked to run the engine or provide propulsion.",
                       "Ignition has been switched off; physical motion and temperature do not have to disappear instantly.",
                       "The engine request is off. Vehicle profiles also open the main battery switch on the battery monitor's next update.",
                       "A sensor needs its measuring circuit to be powered before its electrical reading can represent a temperature.",
                       "Remove any injected fault, switch ignition on, then advance time. Remembered warnings may still be listed.",
                       _engine_observations(s) if not vehicle else _battery_observations(s),
                       _fault(s, title="Power is off", present=selected != "none" or any(not connected for connected in connections.values()), detected=stored or network_record or cell_record or wheel_record,
                              state="unpowered", repair_instruction="Reconnect the selected input before switching the experiment back on."))

    coolant_memory_is_relevant = stored and selected in ("none", "ect_open") and not latch
    if high or (open_path and powered) or pending or coolant_memory_is_relevant:
        obs = _coolant_observations(s)
        obs.append(_observation("Engine warning memory", "Warning is stored" if stored else "Possible fault is being checked" if pending or high else "No stored coolant warning",
                                "A stored warning can remain after the sensor starts working again. Clearing the memory does not reconnect a broken wire.",
                                "remembered" if stored and not high else "warning" if stored or pending else "checking" if high else "normal", "mil"))
        repair = "Reconnect the coolant sensor, advance time to obtain a good reading, then clear the remembered engine warning."
        if not high and sensor.get("ect_sensor_valid"):
            return _result(s, "The sensor works again; the warning is remembered",
                           "The measured temperature is believable again, so the engine computer has stopped using its substitute.",
                           "The input is healthy now, while the earlier fault remains in the computer's memory.",
                           "The computer uses the measured coolant temperature. Its stored warning and warning lamp can remain until cleared.",
                           "Repairing the cause and erasing its record do different jobs. Keeping a record lets someone inspect what happened.",
                           "Read the warning in plain words, then clear it. Run a little longer to check that it does not return.", obs,
                           _fault(s, title="Earlier coolant-input warning", present=False, detected=True, state="remembered", cause_name="ect_open", repair_instruction=repair))
        changed = "The modeled sensor path is disconnected, but the actual coolant has not suddenly become cold." if open_path else "The measured sensor voltage is outside this model's accepted temperature range."
        why = "The small reference supply pulls a disconnected signal toward its maximum voltage. The computer cannot turn that reading into a trustworthy temperature." if open_path else "The computer tests the measured electrical input, not only the selected fault button. An out-of-range value can also trigger the same observation."
        if stored and high:
            heading = "The computer has confirmed the coolant-input problem"
            summary = "The bad reading has lasted long enough to store a warning and turn on the engine warning lamp."
            action = "The computer uses a substitute temperature and reduces requested engine torque in this teaching model."
            next_step = "Ask the scan tool to explain the stored warning, then reconnect the sensor and clear the memory."
            phase = "confirmed"
        elif fallback or pending:
            heading = "The computer chooses a substitute temperature"
            summary = "The input is still unusable, so the computer records a possible fault and changes its control behaviour." if pending else "The last control update still uses a substitute. Clearing warning memory does not immediately take a new sensor reading."
            action = "After the short check, it uses eighty degrees for control and reduces requested engine torque. The actual coolant remains a separate value."
            next_step = "Advance another short step to see the warning become confirmed, or reconnect the sensor before confirmation."
            phase = "pending" if pending else "checking"
        else:
            heading = "The computer is checking a suspicious coolant reading"
            summary = "The sensor input changed immediately, but the computer waits briefly before choosing its fallback."
            action = "It counts how long the bad input persists. The fallback has not yet been selected."
            next_step = "Advance the experiment by two tenths of a second and watch the control temperature change."
            phase = "checking"
        why += " The two-tenths and half-second thresholds are accelerated teaching settings, not manufacturer trip rules."
        return _result(s, heading, summary, changed, action, why, next_step, obs,
                       _fault(s, title="Coolant temperature input cannot be trusted", present=high or open_path,
                              detected=pending or stored, state=phase, cause_name="ect_open" if open_path else "coolant_high_input", repair_instruction=repair))

    if vehicle and (bmu_missing or (network_record and latch)):
        age = _number(sensor.get("bmu_message_age_ms"))
        stale = age > 300.0001
        stopped = latch and network_record
        present = bmu_missing
        obs = _battery_observations(s)
        report = s.get("bmu_report", {})
        obs.append(_observation("Last reported battery current", f"Held report: {_fmt(report.get('pack_current_a'))} amperes" if present or stale else f"New report: {_fmt(report.get('pack_current_a'))} amperes",
                                "Compare this report with actual energy flow. A remembered measurement can stay unchanged while the physical battery state changes.",
                                "stale" if stale else "held" if present else "normal", "bmu_report.pack_current_a"))
        return _result(s, "The hybrid computer has stopped propulsion" if stopped else "The battery reports have stopped arriving",
                       "A battery report that was once useful is no longer fresh enough to trust." if stale else
                       "The last report stays on screen while the computer checks how old it is." if present else
                       "Fresh reports have returned, but the earlier protection shutdown is still held.",
                       "Status messages are being withheld; this does not unplug the physical battery or freeze its state." if present else
                       "The message path has been restored, but a latched shutdown needs a restart.",
                       "Propulsion is inhibited and the main battery switch is held open." if stopped else
                       "The hybrid computer checks the report age. It has not yet exceeded the allowed delay.",
                       "A value needs a time as well as a number. This model stops trusting battery reports older than three tenths of a second, then holds the shutdown.",
                       "Restore battery reports, switch ignition off for a short step, then on and wait for the normal connection sequence. Resetting the experiment also starts fresh.", obs,
                       _fault(s, title="Battery status messages are missing" if present else "Battery-message shutdown is latched", present=present,
                              detected=network_record, state="latched" if stopped else "checking", cause_name="bmu_timeout",
                              repair_instruction="Restore the reports, then switch the experiment's ignition off and on, or reset. Clearing engine warning codes does not reset this battery-network shutdown."))

    if vehicle and (selected == "cell_low" or (cell_record and latch)):
        present = selected == "cell_low"
        detected = cell_record and latch
        obs = _battery_observations(s)
        obs.append(_observation("Lowest cell measurement", "Deliberately low test reading" if present else "Normal test input restored",
                                f"The displayed cell input is {_fmt(sensor.get('cell_min_v'), 2)} volts. This is an injected measurement, not a simulated damaged cell.",
                                "warning" if present else "normal", "sensors.cell_min_v"))
        return _result(s, "The battery monitor is protecting the power path" if detected else "The battery monitor sees a low test reading",
                       "The protection response is held even after the suspicious input is removed." if detected and not present else
                       "A deliberately low cell-voltage report asks the battery monitor to check for a problem.",
                       "One modeled cell measurement has been changed; the pack's physical charge has not instantly disappeared." if present else
                       "The measurement is normal again, but the shutdown remains latched.",
                       "The battery monitor holds the main switch open and propulsion is inhibited." if detected else
                       "The battery monitor waits for the low reading to persist before latching a shutdown.",
                       "A brief suspicious reading and a persistent one can lead to different decisions. This exercise uses a short persistence check and a latched protection response.",
                       "Restore the normal test input, switch ignition off and on, or reset the experiment. Compare the restored measurement with the held protection state.", obs,
                       _fault(s, title="Low cell-voltage test", present=present, detected=cell_record,
                              state="latched" if detected else "checking", cause_name="cell_low",
                              repair_instruction="Remove the low-cell test input, then switch ignition off and on or reset. This action repairs the simulated input; it does not model cell repair."))

    if vehicle and wheel_missing:
        return _result(s, "The wheel turns, but its speed report is missing",
                       "The front-left sensor no longer tells the brake computer how quickly that wheel is moving.",
                       "The measurement disappeared. The physical wheel and the ordinary friction brakes still exist.",
                       "This teaching model disables all anti-lock and yaw brake assistance while that input is missing. Ordinary friction braking continues.",
                       "Automatic wheel-slip control needs trustworthy speed feedback. The model uses a simple all-assistance-off response; real vehicles can use different fallback strategies.",
                       "Compare the physical wheel speed with its missing sensor report. Reconnect the sensor and advance time to allow assistance to operate again.",
                       _brake_observations(s),
                       _fault(s, title="Front-left wheel-speed report missing", present=True, detected=wheel_record,
                              state="detected" if wheel_record else "checking", cause_name="wheel_fl_dropout",
                              repair_instruction="Reconnect the front-left wheel sensor and advance time. Assistance resumes only when speed, braking and the assistance switch permit it; the module's earlier warning record can remain."))

    if not vehicle:
        running = bool(s.get("engine_running"))
        requested = bool(s.get("engine_requested"))
        return _result(s, "The engine is responding to the driver" if running else "The engine is starting" if requested else "Ready to start the engine experiment",
                       "The temperature measurement is believable, so the computer can use it normally.",
                       "The accelerator asks for engine effort; the sensor reports the resulting physical state.",
                       "The computer adjusts its simplified engine request using driver demand and the measured coolant temperature.",
                       "A sensor measures, a computer decides, and the engine changes the physical state. Heat and rotating mass take time to respond.",
                       "Change the accelerator and advance time. Then unplug the coolant sensor to compare physical temperature, measurement and fallback.",
                       _engine_observations(s))

    if profile == "braking" or _number(inputs.get("brake")) > .01:
        disabled = not inputs.get("abs_enabled", True)
        regen_limited = _number(s.get("soc_pct")) > 90 and _number(s.get("battery_charge_limit_kw")) < 30
        heading = "The nearly full battery limits recovered braking energy" if regen_limited and _number(inputs.get("brake")) > .01 else "Anti-lock assistance is adjusting the brakes" if s.get("abs_active") else "Ordinary braking is working without anti-lock assistance" if disabled else "Compare wheel motion with vehicle motion"
        obs = _brake_observations(s)
        if regen_limited:
            obs.append(_observation("Energy recovery", "Battery acceptance is limited",
                                    "Friction brakes supply braking that the motor-and-battery path cannot provide.", "limited", "battery_charge_limit_kw"))
        remembered = wheel_record and selected == "none"
        return _result(s, heading,
                       "Braking can slow a wheel faster than it slows the vehicle, so the computer compares their motion.",
                       "The anti-lock switch is off for this comparison." if disabled else "The current pedal request and road grip determine the wheel-slip problem.",
                       "The model uses friction braking when energy recovery is limited." if regen_limited else
                       "Automatic pressure modulation is disabled; the friction brakes still act." if disabled else
                       "The brake computer releases and reapplies its modeled brake force when wheel slip requires it." if s.get("abs_active") else
                       "The brake computer is observing the wheels; it is not modulating brake force at this instant.",
                       "A rolling wheel and a locked wheel interact differently with the road. The pressure display is a relative adjustment, not a pressure measurement in physical units.",
                       "Run the same braking lesson with assistance on and off, or disconnect one wheel sensor and compare the physical wheel with its report.", obs,
                       _fault(s, title="Earlier wheel-sensor warning remembered" if remembered else "Everything connected", present=False,
                              detected=remembered, state="remembered" if remembered else "normal", cause_name="wheel_fl_dropout" if remembered else "none",
                              repair_instruction="The input works again. The earlier module warning is kept until the experiment is reset." if remembered else ""))

    mode = s.get("mode", "OFF")
    action = {
        "PRECHARGE": "The battery connection is being prepared before the main switch closes. Propulsion is not yet allowed.",
        "OFF": "The main battery switch is open, so the model cannot provide electric propulsion yet.",
        "READY": "The system is ready and waiting for a driving request.",
        "COAST": "No propulsion is being requested; the vehicle is coasting under its modeled road forces.",
        "EV": "The electric motor supplies the requested drive in this operating condition.",
        "HYBRID": "The engine and electric motor share the requested propulsion.",
        "CHARGE SUSTAIN": "The supervisor starts the engine to preserve the battery's charge reserve and requests some generation.",
        "REGEN + FRICTION": "The motor recovers some braking energy and friction brakes supply the remaining braking.",
        "FRICTION BRAKING": "Battery acceptance limits energy recovery, so friction brakes provide the braking request.",
        "FAULT": "A protection condition is preventing normal propulsion. Inspect the module warning list for its recorded cause.",
    }.get(mode, "The supervisor is coordinating the modeled engine, motor and battery connection.")
    history = network_record or cell_record
    return _result(s, "The engine helps preserve the battery reserve" if mode == "CHARGE SUSTAIN" else "Follow where the driving energy comes from",
                   "The driver asks for motion; the hybrid computer chooses how the available power sources help.",
                   "Battery charge, driver demand and braking requests influence the present operating mode.",
                   action,
                   "The battery monitor sets power limits. The hybrid supervisor chooses engine and motor requests within those limits. A low charge gauge alone does not mean the battery is faulty.",
                   "Compare a normal charge level with the low-charge lesson. Watch engine activity and the direction of battery energy flow.",
                   _battery_observations(s),
                   _fault(s, title="Earlier battery warning remembered" if history else "Everything connected", present=False,
                          detected=history, state="remembered" if history else "normal", cause_name="bmu_timeout" if network_record else "cell_low" if cell_record else "none",
                          repair_instruction="The current system is operating again. Earlier module records remain until the experiment is reset." if history else ""))


def explain_diagnostic(response: dict[str, Any], snapshot: dict[str, Any]) -> dict[str, Any]:
    """Translate the supported scan-tool operations into ordinary language.

    Raw bytes and code names remain in the separate technical object so a
    beginner's answer does not depend on reading hexadecimal notation.
    """
    request = str(response.get("request_hex", "")).upper().split()
    service = request[0] if request else ""
    pid = request[1] if len(request) > 1 else ""
    s = snapshot
    sensor = s.get("sensors", {})
    technical = {"request_hex": response.get("request_hex"), "response_hex": response.get("response_hex"),
                 "stored_codes": list(s.get("dtcs", [])), "pending_codes": list(s.get("pending_dtcs", []))}
    if "sample_t" in response:
        technical["sample_t"] = response["sample_t"]
        technical["source"] = response.get("source")
    result = {"request_name": "Ask the engine computer", "answer": "No usable reply",
              "explanation": "This lab implements a small, documented set of diagnostic questions.",
              "next_step": "Choose one of the named questions in the lesson.", "technical": technical}
    if response.get("error"):
        result.update(answer="The question could not be read", explanation="Use one of the named questions, or check the optional technical request format.")
        return result
    if response.get("status") == "sample_unavailable":
        result.update(request_name="Inspect the requested sensor", answer="The requested measurement is unavailable",
                      explanation=response.get("meaning", "No valid sample is available for this request."),
                      next_step="Inspect the sensor connection and its sampled validity, restore the input, advance time, then repeat the request.")
        technical.update(status="sample_unavailable", sensor_id=response.get("sensor_id"))
        return result
    if response.get("status") == "state_only":
        result.update(request_name="Inspect the selected module", answer="This module provides simulation-state inspection",
                      explanation=response.get("meaning", "No byte-addressed endpoint is implemented for this module."),
                      next_step="Use Scan modules or select the unit to inspect its signals and stored lab events.")
        technical["status"] = "state_only"
        return result
    if response.get("timeout"):
        connection = response.get("connection", {})
        status = connection.get("status")
        steps = {"disconnected": "Connect the virtual scan tool and choose an installed target module.",
                 "vehicle_off": "Turn ignition on; starting the engine is not required for an ECU query.",
                 "bitrate_mismatch": "Choose the same CAN bitrate in the vehicle configuration and scan-tool connection.",
                 "unit_open": "Reconnect the selected module, sample again, then repeat the request.",
                 "not_installed": "Choose a module that is fitted to this vehicle configuration."}
        result.update(request_name="Check the diagnostic connection", answer="The scan tool cannot reach the selected computer",
                      explanation=connection.get("reason") or "The diagnostic CAN branch is disconnected, so this question never reaches the computer. The simulated engine and vehicle controllers can continue operating.",
                      next_step=steps.get(status, "Reconnect the diagnostic CAN branch and repeat the same question."))
        technical["delivery"] = response.get("delivery")
        return result
    if response.get("positive_response_suppressed"):
        result.update(request_name="Send a diagnostic request without a positive reply", answer="The computer handled the request with its positive reply suppressed",
                      explanation="The request explicitly asked for silence after success. This differs from an unplugged connection or an unsupported request.",
                      next_step="Use the ordinary session or keep-alive button to request a visible reply.")
        technical["session"] = response.get("session")
        return result
    if not response.get("response_hex"):
        result.update(answer="This teaching computer did not answer that question", explanation="A silent reply can mean that this request or destination is outside the implemented teaching subset.")
        if response.get("protocol") == "UDS teaching subset":
            result.update(explanation="The lab's UDS examples use the direct engine-computer address. The shared emissions address is used by the OBD lessons.",
                          next_step="Select the direct engine address, then repeat the UDS request.")
        return result
    def reply_value(fallback, offset=2, count=1, factor=1.0, add=0.0):
        """Explain the returned sample, which can precede the current plant state."""
        try:
            data = bytes.fromhex(response["response_hex"])
            return int.from_bytes(data[offset:offset + count], "big") * factor + add if len(data) >= offset + count else fallback
        except (ValueError, TypeError):
            return fallback
    if response.get("protocol") == "UDS teaching subset":
        technical["session"] = response.get("session")
        raw_reply = str(response.get("response_hex", "")).split()
        if raw_reply and raw_reply[0] == "7F":
            code = raw_reply[2] if len(raw_reply) > 2 else ""
            descriptions = {"11": "That service is outside the implemented teaching subset.",
                            "12": "That option within the service is not supported by this lab.",
                            "13": "The request has an unsupported length or format.",
                            "31": "That data identifier is not available in this teaching computer."}
            result.update(request_name="Read the computer's refusal", answer="The computer declined the diagnostic request",
                          explanation=descriptions.get(code, "The computer supplied a negative diagnostic response."),
                          next_step="Choose one of the named, supported UDS examples and compare its positive reply.")
            technical["negative_response_code"] = code
        elif service == "10":
            extended = response.get("session", {}).get("hex") == "03"
            result.update(request_name="Choose a diagnostic session",
                          answer="The extended diagnostic session is active" if extended else "The default diagnostic session is active",
                          explanation="This changes the diagnostic session, not the vehicle's physical operating state. The extended session expires after five seconds of simulation time without a direct diagnostic request.",
                          next_step="Send the keep-alive question before five simulated seconds pass, or let the timer expire and inspect the session again.")
        elif service == "22":
            is_vin = request[1:] == ["F1", "90"]
            result.update(request_name="Read the vehicle identity" if is_vin else "Read the ECU spare-part identity",
                          answer="This is the lab's invented vehicle identity" if is_vin else "This is the lab's invented ECU spare-part number",
                          explanation="The identity is synthetic and belongs to this simulator. Its longer reply is split into several transport frames and reassembled by the tester.",
                          next_step="Compare this identification request with the OBD vehicle-identity question and inspect their different application bytes.")
        elif service == "3E":
            result.update(request_name="Keep the diagnostic session alive", answer="The computer received the keep-alive question",
                          explanation="A direct keep-alive request refreshes the five-second timer of an active extended session. The timer advances only when the simulator advances.",
                          next_step="Advance a few seconds, send another keep-alive question, and compare that with letting the session expire.")
        return result
    if service in ("03", "07"):
        codes = s.get("dtcs" if service == "03" else "pending_dtcs", [])
        details = s.get("sensor_dtcs", {}).get("details", [])
        known = [item.get("label", item["code"]) for item in details if item.get("code") in codes]
        result["request_name"] = "Read remembered engine warnings" if service == "03" else "Read possible engine problems"
        result["answer"] = "The coolant-temperature input was not trustworthy" if "P0118" in codes else "Recorded input warning: " + ", ".join(known) if known else "The computer lists a warning that needs the technical reference" if codes else "No engine warnings in this list"
        result["explanation"] = "This records an observation at the computer input; it does not prove that a named sensor is the only possible cause." if codes else "This engine query does not read the separate battery or brake module warning lists."
        result["next_step"] = "Select the affected unit, compare physical and measured signals, and restore the input before clearing memory." if codes else "Try a sensor-disconnection lesson and ask again after the computer has had time to check it."
    elif service == "04":
        result.update(request_name="Clear remembered engine warnings", answer="The engine warning memory has been cleared",
                      explanation="Clearing memory does not repair a missing input. A present fault will be recorded again after the model's checks. This action does not clear battery or brake module shutdowns.",
                      next_step="Run a little longer and ask for warnings again. A returning warning shows that its cause is still present.")
    elif service == "01" and pid == "05":
        if not sensor.get("ect_powered", s.get("inputs", {}).get("ignition", False)):
            answer, detail = "The sensor circuit is not powered", "Any numeric display from this teaching reply is unavailable as a real temperature measurement."
        elif not sensor.get("ect_sensor_valid", True):
            answer, detail = "The temperature report cannot be trusted", "The detailed reply uses minus forty degrees as its invalid-input marker. The actual coolant temperature is a separate physical value."
        else:
            answer, detail = f"The sensor reports about {_fmt(sensor.get('ect_c'))} degrees Celsius", "The diagnostic reply rounds the sensor measurement to the whole-degree format used by this question."
        result.update(request_name="Ask for coolant temperature", answer=answer, explanation=detail,
                      next_step="Compare this report with actual coolant and the temperature the controller uses.")
    elif service == "01" and pid == "0C":
        result.update(request_name="Ask how fast the engine is turning", answer=f"About {_fmt(reply_value(s.get('rpm'), count=2, factor=.25), 0)} turns per minute",
                      explanation="This describes crankshaft rotation. It is different from the vehicle's road speed.",
                      next_step="Change accelerator demand, advance time, and ask again.")
    elif service == "01" and pid == "0D":
        result.update(request_name="Ask for vehicle speed", answer=f"About {_fmt(reply_value(s.get('speed_kph')), 0)} kilometres per hour",
                      explanation="This standardized value is speed magnitude; the cockpit's signed speed separately identifies reverse motion." if s.get("vehicle") else "This is forward vehicle speed. The engine stand stays at zero road speed even when its engine turns.",
                      next_step="Choose a driving or braking lesson to observe changing road speed.")
    elif service == "01" and pid == "00":
        result.update(request_name="Ask which measurements are available", answer="The computer lists its supported teaching measurements",
                      explanation="The detailed reply encodes that list compactly. Named buttons let you ask supported questions without decoding the bytes.",
                      next_step="Choose coolant temperature or engine speed to read a live value.")
    elif service == "01" and pid == "01":
        result.update(request_name="Ask about the engine warning lamp", answer="The engine warning lamp is on" if s.get("mil") else "The engine warning lamp is off",
                      explanation="Lamp state, stored warnings and completed checks are related but distinct. This model implements only a small teaching subset of those checks.",
                      next_step="Read the remembered warnings to understand any stored engine observation.")
    elif service == "09" and pid == "02":
        result.update(request_name="Ask for the vehicle identity field", answer="This is the lab's invented vehicle identity",
                      explanation="The demonstration identity belongs to the simulator, not a registered vehicle. The longer answer shows how one reply can be split into several transport frames.",
                      next_step="Open optional technical details if you want to follow the split reply.")
    elif service == "09" and pid == "00":
        result.update(request_name="Ask which identity questions are available", answer="The lab supports its synthetic identity example",
                      explanation="This is a list of implemented identity questions, not a vehicle capability assessment.")
    else:
        lookup = {"04": ("Estimated engine load", s.get("load_pct"), "percent", "A model estimate of current engine demand, not a health score."),
                  "0F": ("Incoming air temperature", sensor.get("iat_c"), "degrees Celsius", "This teaching model uses the chosen ambient air temperature."),
                  "10": ("Air entering the engine", s.get("maf_g_s"), "grams per second", "This is the model's airflow estimate, not a measured production-engine calibration."),
                  "11": ("Throttle opening", s.get("throttle_pct"), "percent", "This describes the simplified throttle signal used by the engine model.")}
        if service == "01" and pid in lookup:
            name, value, units, detail = lookup[pid]
            if pid in ("04", "11"):
                value = reply_value(value, factor=100 / 255)
            elif pid == "0F":
                value = reply_value(value, add=-40)
            elif pid == "10":
                value = reply_value(value, count=2, factor=.01)
            result.update(request_name="Ask for " + name.lower(), answer=f"{name}: about {_fmt(value)} {units}", explanation=detail,
                          next_step="Change the driver input, advance time, and compare the new reading.")
    return result
