# Sources and evidence boundaries

Version 0.3.0 · Research date: 9 November 2026. The documentation paraphrases the sources; original documents remain in their existing locations. The simulator source code and tests are the authority for implemented behavior, not the source list below.

## Public primary sources

| ID | Source | What it supports |
|---|---|---|
| S1 | California Air Resources Board, [On-Board Diagnostic II Systems Fact Sheet](https://ww2.arb.ca.gov/resources/fact-sheets/board-diagnostic-ii-obd-ii-systems-fact-sheet), 19 September 2019 | OBD-II monitors emissions-related components and stores malfunction information. The document's regulatory dates are jurisdiction-specific and are not used as a global applicability claim. |
| S2 | Linux kernel documentation, [ISO 15765-2 / ISO-TP](https://docs.kernel.org/networking/iso15765-2.html) | Physical versus functional addressing, single/multi-frame transport, flow control, sequence handling and the Linux socket interface. It does not provide a Toyota message database. |
| S3 | Toyota Motor Corporation, [Toyota Develops New Hybrid System](https://global.toyota/en/detail/220017), 17 April 2003 | Manufacturer overview of THS-II power splitting, propulsion modes and regenerative braking. Describes that historical system, not every later Toyota hybrid. |
| S4 | Modelica Association, [Functional Mock-up Interface specification 3.0.2](https://fmi-standard.org/docs/3.0.2/), 27 November 2024 | FMU packaging, Model Exchange, Co-Simulation, Scheduled Execution and clocks. FMI export is a proposed extension, not a delivered capability. |
| S5 | Bosch Mobility, [Electronic stability program](https://www.bosch-mobility.com/en/solutions/braking-systems/electronic-stability-program/) | Functional roles of wheel speed, steering and yaw measurements; propulsion reduction and individual-wheel braking. The lab does not implement Bosch software or calibration. |
| S6 | QEMU project, [Arm System emulator](https://www.qemu.org/docs/master/system/target-arm.html) | A matching CPU architecture alone is insufficient; firmware depends on a supported board/machine and its devices. No assertion is made that QEMU supports an unidentified Toyota ECU. |
| S7 | Renode project, [Peripheral modeling guide](https://renode.readthedocs.io/en/latest/advanced/writing-peripherals.html) | Register/peripheral models and the relationship between CPU accesses, memory and the simulated system bus. No Renode peripheral implementation is included in this release. |
| S8 | MathWorks, [What Is Hardware-in-the-Loop?](https://www.mathworks.com/discovery/hardware-in-the-loop-hil.html) and [SIL, PIL and HIL tests](https://www.mathworks.com/help/sltest/sil-pil-and-hil-tests.html) | Terminology for model, compiled software, target processor and controller-hardware testing; equivalence testing. MathWorks products are not required by this lab. |
| S9 | python-can project, [Virtual interface documentation](https://python-can.readthedocs.io/en/stable/interfaces/virtual.html), [source repository](https://github.com/hardbyte/python-can), [license](https://github.com/hardbyte/python-can/blob/main/LICENSE.txt) | Same-process VirtualBus behavior and limitations; optional transport base. Stable documentation inspected identifies version 4.6.1; repository license is GNU LGPL version 3. |
| S10 | Linux-CAN, [can-utils repository](https://github.com/linux-can/can-utils), [candump source](https://github.com/linux-can/can-utils/blob/master/candump.c), [isotpsend source](https://github.com/linux-can/can-utils/blob/master/isotpsend.c) | Capture/replay and ISO-TP utilities for a later Linux virtual-CAN workflow. Those two source headers specify GPL-2.0-only OR BSD-3-Clause; inspect individual files rather than assuming a uniform repository license. |
| S11 | Ircama, [ELM327-emulator repository](https://github.com/Ircama/ELM327-emulator), [license](https://github.com/Ircama/ELM327-emulator/blob/master/LICENSE) | Adapter/scan-client emulation and an optional Toyota Auris Hybrid request dictionary. It is not a Prius firmware/physical model. The repository identifies CC BY-NC-SA 4.0. |
| S12 | Texas Instruments, [Monitoring NTC Thermistor Circuit With Single-Ended ADC, SBAA338A](https://www.ti.com/lit/an/sbaa338a/sbaa338a.pdf), revised June 2022 | NTC divider topology, beta resistance/temperature relationship and ratiometric ADC principle. The lab's 5 V, 2,200 Ω, 2,500 Ω, 3,500 K and timing choices are synthetic; this source does not establish a Toyota sensor calibration or pin assignment. ADC settling and tolerances in the application note are not implemented here. |
| S13 | Elm Electronics, [ELM327 data sheet, version 2.3](https://elmelectronics.com/wp-content/uploads/2020/05/ELM327DSL.pdf) | Printed p82, Figure 8: vehicle J1962 connector numbering and orientation. Printed p84, Figure 9: adapter reference circuit and protocol pin roles. Supports the DLC reference, not execution of an ELM adapter or analog CAN waveforms. |
| S14 | ScanTool.net / OBD Solutions, [Which OBD-II protocol is supported by my vehicle?](https://www.scantool.net/blog/which-obd-ii-protocol-is-supported-by-my-vehicle/) | Vehicle-connector diagrams, ground/supply functions and protocol-dependent pin assignments. The CAN lesson uses pins 6/14; legacy pins are reference-only. Historical market/date statements are not used as current global applicability guidance. |

## Toyota documents read from the user's Google Drive

These titles and file identities were verified through Google Drive, and their readable content was inspected. The local package links to them rather than redistributing their full contents. Page references below are printed document pages.

| ID | Document | Specific evidence used |
|---|---|---|
| T1 | [Toyota_Course_071_Hybrid_System_Operation.pdf](https://drive.google.com/file/d/1sP19XACX-a4BFxGerztVRn3W4aIGDcty/view) | Page 2-2: control-system components; 2-7 to 2-8: 30/78 tooth counts and engine/carrier, MG1/sun, MG2/ring connections; 2-12 to 2-15: inverter, converters and HV ECU roles. |
| T2 | [Toyota_Course_071_High_Voltage_Battery.pdf](https://drive.google.com/file/d/19PMbGTunAw-JCQ-0Jj0q9pgTOtDLz-Ia/view) | Page 3-3: 28 modules and 201.6 V Gen2 pack; 3-4 to 3-5: battery monitoring; 3-6: resistor-assisted SMR energizing sequence. |
| T3 | [Toyota_2004_Prius_THSII_Features.pdf](https://drive.google.com/file/d/1kOvFoF1_Ms7ZuBtGFPSnH7tiXQs2fcgd/view) | TH-4 to TH-6: planetary power splitting, operating modes and regenerative-brake cooperation. |

These documents are historical training/reference material. This lab does not reproduce servicing procedures or establish present-day repair instructions for any vehicle. Exact vehicle generation, market, hardware part numbers and calibration IDs would be required for a specific implementation.

## Existing user research read for continuity

| ID | Document | How it was used |
|---|---|---|
| U1 | [Prius_firmware_and_Ghidra_guide.html](https://drive.google.com/file/d/1BxVxB3-LT5IQJYzuwWgRdQJaOtuS2AhB/view), 2 November 2026 | Prior research separates Toyota-labelled engine calibration images, absent authenticated HV/battery images, and open replacement firmware. Its stated uncertainties about MCU identity, memory mapping and compatibility are retained. This turn did not re-download or independently execute the binaries. |
| U2 | [MODEL_NOTES.txt](https://drive.google.com/file/d/1CIxm2D7UZ2bdIesjmQIEDwPQyiiUKMRt/view) | Prior quasi-static Prius model explicitly labels controller choices and the 8.8 kWh PHEV extension as hypothetical. It informs the separation between manufacturer specifications and illustrative strategy; its JavaScript model was not imported into this package. |

## Evidence labels used in this package

**Manufacturer fact** means a scoped statement supported by a Toyota source, such as a historical gear connection or nominal battery voltage. **Standard/protocol reference** means a diagnostic or interoperability concept supported by its identified specification or official implementation documentation. **Teaching assumption** means a parameter, threshold, signal, control law or scenario chosen for learning. **Verified implementation result** means behavior observed by running this package; it does not imply measured vehicle fidelity.

All generic hybrid parameters, control periods, fault debounces, synthetic network signals, torque policies and simplified tire/thermal behavior belong to the teaching-assumption category unless an individual item says otherwise. No Toyota CAN identifier, proprietary PID, DTC subcode, firmware compatibility or production protection threshold is inferred from a plausible-looking number.

The new [connector reference](CONNECTOR_REFERENCE.md) applies the same boundary to schematics: the DLC's referenced positions and roles are distinct from fictional J-ECT and X1 lesson assignments. X1.1 is an internal reference test point, not a claimed physical ECU cavity. No real Toyota connector part number or harness layout is inferred. The 5 V ECT circuit and ideal 12-bit conversion are executable teaching models; their computed values are not recorded vehicle measurements. The [workspace guide](SCHEMATIC_WORKSPACE.md) explains how invalid, substituted and stale values remain visible with their validity context.

For a later vehicle-specific model, maintain a provenance record per parameter: symbol, unit, value or map, vehicle generation, source page or dataset, measurement conditions, uncertainty, software revision and license. A publicly visible file can still have redistribution restrictions. Reference source locations and preserve notices when including third-party firmware or model code.
