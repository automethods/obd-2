# EngDoc: a first interactive coolant-sensor worksheet

OBD II Lab · Version 0.3.0 · 9 November 2026

## What is ready

The supplied EngDoc source has been inspected, and the lab now includes **examples/engdoc_coolant_sensor.json**, a native `engdoc-native-draft/0.3` worksheet. It brings a circuit explanation, an embedded diagram, adjustable inputs, calculated results, a small table and a line plot into one document. The file follows the actual uploaded native contract and its publishing example. [Native contract](https://drive.google.com/file/d/1KO5YVd2jsnmzEheObOkHf3jZeRNkIR6S/view) · [Publishing example](https://drive.google.com/file/d/1kMrxPzzJTQwF2bf1rARQQE_omSbNdhSK/view)

The question is deliberately small: **What reaches the engine computer when the coolant gets warmer, and what changes if the sensor connection is broken?** This is a useful first connection between a readable engineering document and the larger virtual vehicle. It does not require entering hexadecimal codes or writing a program.

The worksheet recalculates a steady electrical circuit when an input changes. The browser OBD II Lab adds simulated time, changing physical temperature, computer decisions, fault timers and warning memory. The two tools explain different parts of the same measurement path.

| Place to learn | What you can change | What you can observe |
|---|---|---|
| EngDoc coolant worksheet | Actual temperature, connection state, reference supply, fixed resistor | Sensor resistance, computer-side voltage, branch current and a temperature curve |
| Browser learning book | Driver requests, starting conditions and a named fault | Physical response, measured information, controller decisions, timing and diagnostic history |
| PDF handbook | Read the same explanations and exercises | Reference pictures and worked reasoning; the PDF itself does not run the model |

## Open and try the worksheet

Use the supplied EngDoc application's native-document import or open workflow to select **examples/engdoc_coolant_sensor.json**. It requires the `/0.3` native draft capability because the document contains an embedded PNG. The exact menu label depends on the EngDoc build. A complete EngDoc application import and rendering session has not yet been run for this deliverable; the verification below covers the actual native validator and the calculation data. See the supplied [EngDoc README](https://drive.google.com/file/d/1hARjKZ9JbShr4k-nM1GEm7AtLjmrtrvv/view) for that application's startup instructions.

Start with these settings:

| Control | Initial value | Plain meaning |
|---|---:|---|
| Actual coolant temperature | 25 degrees Celsius | The physical condition at the sensor |
| Sensor connection | 0 | Connected; choose 1 to disconnect |
| Computer reference supply | 5 volts | The supply used by this measurement circuit |
| Fixed resistor inside computer | 2,200 ohms | One of the two parts that divide the voltage |

The connection control uses the choices **0 = connected** and **1 = disconnected** because the native contract stores scalar choices. The worksheet repeats that meaning beside the control and results. These numbers are switch positions, not diagnostic codes. The browser book provides named fault buttons for the same learning idea.

Try the three experiments in order:

1. **Warm the connected sensor.** Keep the connection at 0. Change temperature from 25 to 90 degrees Celsius. The signal falls from about 2.660 to 0.610 volts. Warmer coolant lowers the sensor resistance, which lowers the measured junction voltage.
2. **Break the information path.** Return to 25 degrees Celsius, then select connection 1. The signal rises to 5.000 volts and sensor-branch current becomes zero. Move temperature again: the intrinsic sensor resistance changes, but the computer-side signal stays at the reference supply. The broken path hides the temperature change.
3. **Repair the connection.** Select 0 again. The signal returns to the value associated with the current physical temperature. This worksheet has no warning memory. In the browser lab, repair and clearing remembered warnings are separate actions.

The six-row table uses fixed temperatures from −20 to 110 degrees Celsius. It follows your selected supply, fixed resistor and connection state, so it shows the wider relationship alongside the single-temperature control. The line chart joins those six points as a visual guide. The embedded circuit picture stays still; it is a reference drawing, not an animated switch or a vehicle connector pinout.

## The small calculation underneath

The illustrative sensor is an NTC thermistor: its resistance decreases as it gets warmer. The worksheet uses the same illustrative beta approximation and default component values as the lab's `ect_circuit()` function in **obdii_lab/core.py**. These are teaching parameters, not extracted Toyota calibration values.

The equations are:

- Temperature for the calculation: `T_K = T_C + 273.15`.
- Sensor material resistance: `R = 2500 × exp(3500 × (1 / T_K − 1 / 298.15))` ohms.
- Connected signal voltage: `V_connected = V_reference × R / (R_pullup + R)`.
- Selected signal voltage: `V_signal = (1 − open) × V_connected + open × V_reference`.
- Branch current: `I_mA = (1 − open) × 1000 × V_reference / (R_pullup + R)`.

Here, `open` is restricted by its selector to 0 or 1. The displayed resistance is the **intrinsic sensor resistance if connected**. The disconnected branch itself is open; it is not assigned that finite resistance. No inverse-temperature formula is applied to an open signal, so the worksheet does not manufacture a plausible temperature from a broken measurement path.

The source adapter's function allowlist includes `exp()`, and it permits the simple arithmetic and bound symbols used here. Values use the `float64` profile with units written in their labels. This avoids mixing absolute-temperature units with an exponential argument. It also means the worksheet does not perform unit conversion or dimensional checking: enter the units shown by each control. [Uploaded expression adapter](https://drive.google.com/file/d/14VPKVnIrzxcmEBjY4KGjCI_b6LHrfCWE/view)

The circuit assumes an ideal reference supply and return, no wire resistance, no input leakage and no measurement noise. It has no analogue-to-digital quantization. The browser lab's reported voltage includes its selected ADC rounding, so it can differ slightly from the worksheet's ideal junction voltage. Compare the worksheet with the lab's ideal circuit node when checking exact values.

## What was verified

The JSON passed the **actual uploaded `validateNativeDocument()`** function after its TypeScript source and local dependencies were transpiled. This checked the `/0.3` schema, ownership of inputs and calculations, value references, table and chart references, embedded PNG structure and size limits. The document has 37 nodes and 29 values and is about 175 KiB, including its own diagram.

Every calculation expression was also evaluated by an independent, restricted arithmetic evaluator. Results were compared with the lab circuit for 54 combinations of temperature, supply voltage, fixed resistor and connection state, including the allowed input boundaries. All comparisons passed. The six table rows were checked separately against the same circuit function.

| Healthy case, default circuit | Signal voltage | Sensor-branch current |
|---|---:|---:|
| −20 degrees Celsius | 4.507752 V | 0.223749 mA |
| 0 degrees Celsius | 3.844623 V | 0.525172 mA |
| 25 degrees Celsius | 2.659574 V | 1.063830 mA |
| 60 degrees Celsius | 1.243604 V | 1.707453 mA |
| 90 degrees Celsius | 0.610156 V | 1.995383 mA |
| 110 degrees Celsius | 0.387639 V | 2.096528 mA |

At 25 degrees Celsius the sensor resistance is exactly 2,500 ohms in this model. With the connection open, every temperature case produces the selected reference voltage and zero branch current. These are useful known answers when first opening the worksheet.

**Verification boundary:** schema validation, numerical agreement and inspection of the expression adapter are complete. The full EngDoc expression runtime, editor rendering, interactive input widgets and export workflow have not been exercised here. A native document passing its contract does not by itself prove those application paths. The worksheet contains no document-supplied code and does not execute vehicle firmware.

## How this grows toward the user's workbench

The next useful step is to open this one worksheet in the supplied EngDoc build and verify its controls, table, chart and printed layout there. After that, the same pattern can be reused for a wheel-speed measurement or a battery-current measurement. A later bridge could pass explicitly named, unit-labelled values between an EngDoc worksheet and the running lab. Such a bridge needs defined ownership, update timing, validity flags and reset behavior before it can represent controller interactions reliably.

The native worksheet is currently a separate, bounded document. No live EngDoc-to-simulator synchronization is implemented. Original firmware still needs a specified processor, memory and peripheral environment; neither this JSON nor the browser teaching controller supplies that environment. The firmware roadmap explains those later boundaries.

The supplied [EngDoc project](https://drive.google.com/drive/folders/1InkrfSinOcs8MFvnQSOK73NMmhw6565U) was used as the format reference. The separately named [Wordcraft upload folder](https://drive.google.com/drive/folders/1HltAm7bN7aSBeYkCqSR1RJxJ1an8yfag) has not been evaluated as a running application for this release, and no Wordcraft integration is claimed. This first worksheet can be reviewed independently before choosing that integration boundary.
