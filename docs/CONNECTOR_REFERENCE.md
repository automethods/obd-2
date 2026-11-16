# Connectors, pin numbering and live probes

> **Recovered v0.4.0 scope.** The pin diagrams and electrical calculations below describe the preserved Instruments view. The new Workbench also exposes logical connection properties and a nominal supply reference. See [Visual Workbench](VISUAL_WORKBENCH.md).

Version 0.3.0 · 9 November 2026

The **Connectors** screen separates a referenced vehicle diagnostic connector from the invented connector assignments used by this lesson. A connector drawing is useful only when its viewing direction and applicability are clear. Every view therefore identifies its orientation, function and evidence status.

## 1. Vehicle diagnostic connector

The default drawing shows the **mating face of a J1962 Type A vehicle socket**, looking into the socket with its wide edge at the top. Pin 1 is at the upper left, pin 8 at the upper right, pin 9 at the lower left and pin 16 at the lower right. Elm Electronics illustrates this vehicle-connector numbering in Figure 8 of its ELM327 data sheet. [C1]

**Show rear / wire side** mirrors the drawing left to right to show the opposite side of the *same connector*. A view of a mating cable plug is a different reference. Before using an actual connector, check its own drawing and whether the manufacturer labels the mating face or wire side. The lab’s rear view is an orientation aid, not a dimensioned harness assembly drawing.

| Pin | Reference function | Treatment in this lab |
|---|---|---|
| 4 | Chassis ground | Role identified; electrical ground offsets not solved |
| 5 | Signal ground | Role identified; not the separately named ECT sensor-return cavity |
| 6 | CAN High for ISO 15765-4 | Diagnostic frames; analog voltage not modeled |
| 14 | CAN Low for ISO 15765-4 | Diagnostic frames; analog voltage not modeled |
| 16 | Vehicle battery positive | No supply-voltage plant; Workbench exposes nominal 12.6 V as reference only |
| 2 | J1850 Bus + | Legacy reference; inactive |
| 10 | J1850 PWM Bus − | Legacy reference; inactive |
| 7 | ISO K-line | Legacy reference; inactive |
| 15 | ISO L-line where applicable | Legacy reference; inactive |
| 1, 3, 8, 9, 11, 12, 13 | No vehicle-specific role assigned here | No simulated signal |

The manufacturer pin guide supports these reference functions and distinguishes the protocols. Pins 6 and 14 belong to the selected CAN profile; their use must not be generalized to every OBD-II protocol. [C2] Figure 9 of the Elm data sheet provides a corresponding adapter circuit. [C1]

In the preserved Instruments connector view, selecting a CAN pin explains its frame-layer boundary and pin 16 has no numerical voltage probe. The recovered Workbench adds logical wire signals and a nominal 12.6 V supply property explicitly marked as a reference, not a measurement. Neither view models dominant/recessive voltage waveforms, termination measurements, supply-battery dynamics or bus arbitration. The hybrid traction-pack voltage is never assigned to pin 16.

## 2. Lesson sensor and ECU assignments

**J-ECT and X1 are fictional teaching labels.** They do not identify Toyota connector part numbers or establish a cavity assignment for any real ECU. “THW” is used only as an ECT signal label in this circuit. Applying the lesson to an actual vehicle requires the applicable electrical wiring diagram and component documentation.

| Lesson point | Meaning | Live signal |
|---|---|---|
| J-ECT.1 | Harness-side ECT input, joined to X1.2 | `sensors.ect_node_v` |
| J-ECT.2 | Sensor return, joined to X1.3 | `sensors.sensor_return_v` |
| X1.1 | Internal reference test point | `sensors.ect_reference_v` |
| X1.2 | Physical ECU input node | `sensors.ect_node_v` |
| X1.3 | Ideal sensor-return reference | `sensors.sensor_return_v` |

J-ECT shows the cavities of the harness-side connector. The open-path switch lies after J-ECT.1 toward the thermistor; the harness remains connected to the ECU pull-up. An isolated sensor-side terminal is not separately modeled. X1.1 is an internal reference test point, not an assertion that a real ECU exposes a 5 V supply at cavity 1.

Select a pin with the mouse, or focus it and press Enter or Space. **Add this signal to scope** adds its channel to the task workspace. The ECT input also offers **Probe ADC voltage instead**, because the physical voltage and its digital reconstruction are different quantities. The mapping table provides an equivalent keyboard-accessible route. **Export connector SVG** saves the displayed orientation and selection.

## 3. A numerical circuit example

The default teaching model uses a 5 V reference, a 2,200 Ω pull-up and a beta-model NTC with 2,500 Ω at 25°C and beta 3,500 K. The return is an ideal 0 V reference. These are selected model parameters, not Toyota calibration values. See `obdii_lab/core.py`, `Parameters` and `ect_circuit`, for the executable definition. With absolute temperature `T` in kelvin, resistance follows:

\[
R(T)=2500\exp\left[3500\left(\frac{1}{T}-\frac{1}{298.15}\right)\right]\ \Omega.
\]

At 25°C, the thermistor is 2,500 Ω. The divider gives

\[
V_{node}=5\frac{2500}{2200+2500}=2.659574\ \mathrm{V}.
\]

The branch current is 1.06383 mA. A 12-bit ADC gives `round(2.659574 / 5 × 4095) = 2178`, reconstructed as **2.659341 V**. That small difference is quantization, not a voltage drop along the wire. J-ECT.1 and X1.2 therefore show the same physical value, while the ADC channel shows the reconstruction.

For a valid reconstructed voltage `Vm`, recover resistance as `Rm = 2200 × Vm / (5 − Vm)` and temperature as `1 / [1/298.15 + ln(Rm/2500)/3500] − 273.15` °C. Validity checks precede this inverse calculation; the open circuit is not interpreted by dividing by zero.

Opening the path makes current zero and pulls the harness node to **5.000 V**, giving ADC count **4095**. Version 0.2 replaces the earlier 4.98 V placeholder with this ideal open-circuit result. The temperature channel becomes invalid; the displayed −40°C is a diagnostic sentinel, not evidence that the coolant suddenly froze. The controller’s later 80°C fallback is a third, explicitly separate value. The [workspace guide](SCHEMATIC_WORKSPACE.md) follows this transition through the diagnostic monitor.

## Sources

- **[C1] Elm Electronics, ELM327 data sheet, version 2.3:** printed page 82, Figure 8, vehicle connector; printed page 84, Figure 9, reference circuit. [Manufacturer PDF](https://elmelectronics.com/wp-content/uploads/2020/05/ELM327DSL.pdf).
- **[C2] ScanTool.net / OBD Solutions, “Which OBD-II protocol is supported by my vehicle?”:** connector illustrations, protocol assignments and ground/supply notes. [Manufacturer guide](https://www.scantool.net/blog/which-obd-ii-protocol-is-supported-by-my-vehicle/). Its historical market/date statements are not used as current applicability guidance here.

