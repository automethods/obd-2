# Work through one fault with the schematic workspace

> **Recovered v0.4.0 scope.** The original teaching text and numerical examples are retained below. The two PDF books remain v0.3 reading copies; use [Visual Workbench](VISUAL_WORKBENCH.md) and its new PDF as the v0.4 addendum for vehicle, connection and protocol features. The app now opens the visual Workbench; Learning book and Instruments remain available.

Version 0.3.0 · 9 November 2026

In the Learning book, choose **Instruments** or **Open detailed instruments** to use these five screens. The learning book and instruments share the same experiment state.

The task workspace follows one complete causal path: **coolant temperature → thermistor resistance → input voltage → ADC measurement → ECU decision → OBD response**. Its diagrams and instruments share the running simulation state. This makes it possible to probe a signal, interrupt the sensor path, advance time and see why a diagnostic code appears.

The interface borrows the useful inspection pattern of a block-diagram environment: a system view, selected-object inspector, connector view and signal scope. This version has fixed, documented model connections. It does not provide arbitrary block placement, wire editing, code generation or a general numerical solver editor.

## Five screens, one running experiment

| Screen | What to use it for |
|---|---|
| **01 · Task workspace** | Follow the six-step ECT exercise; inspect a system or circuit schematic, probe signals, compare traces and read controller events |
| **02 · Connectors** | Select a physical DLC reference or illustrative J-ECT/X1 view; inspect pin orientation, function and live sensor values |
| **03 · Signal list** | Search 69 cataloged signals; inspect current value, units, validity and nominal update period; add one of 67 numerical/digital channels to the scope |
| **04 · Scan tool** | Send an OBD application request and inspect the generated CAN/ISO-TP transcript and decoded result |
| **05 · Dashboard** | View vehicle, engine, battery and braking behavior across the existing lessons; export the complete run |

The schematic selector includes an engine sensor/ECU loop, the ECT electrical circuit, hybrid control and power, and ABS/braking signals. These are views of the model’s boundaries. A connection representing a controller request is not automatically a physical wire or a verified OEM CAN message. The connector reference documents the physical-versus-illustrative distinction separately.

## The six-step ECT task

1. **Healthy baseline.** Start the guided task and select **ECT electrical circuit**. The task runs for 1 s from a selected 25°C coolant initial condition. A powered 5 V reference feeds a 2,200 Ω pull-up and the coolant thermistor returns to an ideal sensor ground. Near 25°C, resistance is about 2,500 Ω, physical node voltage is about 2.6596 V and ADC count is near 2178; small thermal changes during the baseline can move these values. These are model outputs, not measurements from a Toyota.
2. **Open circuit.** Disconnect the modeled sensor path. The ECU/harness side remains attached to the pull-up. Its physical voltage rises to 5.000 V, current becomes zero and ADC count reaches 4095. Actual coolant temperature stays close to its previous value. Probe `coolant_c`, `sensors.ect_c` and `sensors.ect_used_c` to distinguish the plant, interpreted measurement and controller input.
3. **+0.20 s.** Advance the fault timer to the pending/fallback threshold. The teaching ECU marks P0118 pending, substitutes 80°C for control and applies a 0.65 torque multiplier. Its sensor report remains the invalid −40°C sentinel. The monitor checks an ADC input at or above 99% of the reference, or 4.95 V with the default 5 V source.
4. **+0.30 s.** Advance to 0.50 s of persistent fault. P0118 becomes confirmed and the MIL turns on. These short timers support observation in a lesson; they are not a manufacturer calibration or regulatory trip-confirmation rule.
5. **Read DTC.** Inspect service `03` for the confirmed code. Compare `07` for pending codes and `01 05` for coolant data. In this model, the open sensor yields application reply `41 05 00`; the PID conversion `A − 40` gives −40°C. The event timeline explains when the controller changed state.
6. **Repair & clear.** Reconnect the sensor path and clear diagnostic memory with service `04`. Check that the input returns to a plausible voltage, the fallback ends and fault memory clears. Clearing alone while the path is still open does not repair the cause: advance time and the monitor will set the fault again.

The task controls create a controlled demonstration. The existing scripted **ect_open** lesson instead introduces the open at simulation time 3.00 s. Use that lesson for a reproducible unattended recording; use the task buttons to inspect each transition interactively.

## Read the instruments carefully

The scope plots saved samples at **100 ms** intervals. Engine sensor/monitor updates occur every **10 ms**, while the plant advances in **2 ms** steps. UI playback speed changes wall-clock presentation, not those model periods. A transition may occur between plotted samples; the controller event timeline and current monitor timer are better evidence of its exact simulated timing.

Each scope row has its own signal name and units, with up to six channels at once. Adding volts, ADC counts and degrees Celsius does not put them on one common physical scale. Click a trace to inspect a saved sample, choose a time window, and export selected traces as CSV. The signal catalog distinguishes valid, invalid, substituted, stale and unavailable values. Invalid, substituted and stale finite samples use dashed scope segments. An open-path resistance is `null`, marked invalid, because no finite measurement is reported; null samples leave gaps instead of drawing a fabricated resistance.

Physical node voltage and ADC-reconstructed voltage should usually be close. At 25°C they are 2.659574 V and 2.659341 V respectively; the latter comes from count 2178. Their difference is expected quantization. The [connector reference](CONNECTOR_REFERENCE.md) shows the hand calculation and identifies which probe belongs to which point.

The diagnostic console models application data and in-memory classical CAN/ISO-TP frames. It does not simulate CAN bit timing or electrical waveforms. Consequently, clicking DLC CAN-H or CAN-L provides a protocol explanation rather than a made-up analog trace.

## How this supports later expansion

Keep each future subsystem explicit about its physical state, sensors, controller inputs, outputs, update period and validity rules. A BMU lesson can follow current integration into SOC and power limits; a braking lesson can follow wheel-speed validity into slip control and pressure requests. More detailed models can then replace a block without changing what a student probes at its boundary.

Real firmware remains a future integration path. The current inspector is not a firmware editor or an ECU flashing tool. Executing firmware will require an appropriate processor/peripheral environment, input/output mapping and an agreed simulation clock. See [Firmware roadmap](FIRMWARE_ROADMAP.md) for that progression and [Protocol](PROTOCOL.md) for the implemented diagnostic subset.

The numerical claims in this guide come from this release’s executable teaching model, primarily `obdii_lab/core.py` and `obdii_lab/instrumentation.py`. The physical connector claims are sourced in the [connector reference](CONNECTOR_REFERENCE.md); they do not validate the synthetic sensor parameters or lesson pin assignments.
