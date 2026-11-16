# A path from this lab to a virtual vehicle and real firmware

## 1. The intended extension point

The useful separation is **plant → sensor interface → controller → actuator interface → plant**. Diagnostics observes controller state through a separate service boundary. A future virtual vehicle can provide road, driver and body dynamics while this lab supplies one or more ECU models. Alternatively, the lab's physical plant can stimulate a controller running in another process or emulator.

The current lab is an executable model with deterministic simulation time and an implemented high-level JSON-lines process interface. It is not an instruction-set emulator, a hard-real-time system or a hardware-in-the-loop rack. The first integration should replace one controller while leaving the others as predictable models. Replacing the engine, battery and hybrid computers simultaneously makes a failed startup difficult to diagnose.

### The interface you can run now

Start the bridge from the package directory:

```bash
python3 run.py --bridge
```

Send one JSON object per line on standard input. Each command produces one JSON reply on standard output. For example:

```json
{"op":"reset","profile":"phev","config":{"initial_soc_pct":60}}
{"op":"step","dt_s":0.02,"inputs":{"ignition":true,"throttle":0.3}}
{"op":"observe"}
{"op":"diagnostic","payload":"01 0C","can_id":"7DF"}
{"op":"quit"}
```

`reset` creates a new manual simulation. `step` advances simulated time, with `dt_s` greater than zero and at most one second; repeat it to progress. `observe` returns the current state without advancing time. `diagnostic` executes the OBD payload handler. The response identifies the state schema as `obdii-lab.state.v1`; errors return `ok: false`. This bridge accepts driver/fault inputs and returns the complete high-level state. It does **not** expose ADC registers, raw actuator injection or an instruction-level ECU interface. It is a concrete starting boundary for a virtual-vehicle orchestrator, with richer controller replacement left to the next stages.

## 2. Four different meanings of “real firmware”

| Route | What executes | What must be available | First useful milestone |
|---|---|---|---|
| Source-level software-in-the-loop | Real controller logic compiled for the development computer | Source code, build dependencies, a defined I/O wrapper, rights to use it | Execute one periodic control function against recorded sensor inputs and compare outputs |
| Virtual ECU with software stack | Application plus selected scheduler, communication and diagnostic services | Buildable stack or a supplied vECU, configuration and OS/platform abstractions | Complete startup and a deterministic signal exchange with the plant |
| Binary emulation | Original target-machine instructions | Exact ISA, image layout, boot state and sufficiently accurate peripheral models | Reach startup, service a timer interrupt, then transmit one expected CAN message |
| Processor/hardware in the loop | Code on a target processor or an actual ECU | Target hardware, controlled power and I/O, a test harness and time guarantees appropriate to the experiment | Reproduce one closed-loop function without attaching the controller to a drivable vehicle |

MIL normally models controller and plant; SIL executes compiled controller code; PIL adds a target processor; HIL connects actual control hardware to a plant simulated in real time. These labels describe different test boundaries. A desktop Python program with a USB CAN adapter does not automatically become a complete HIL system. [S8]

## 3. Why a binary file alone is insufficient

A firmware image expects a particular computer. Before attempting execution, establish:

- **Identity and provenance:** ECU hardware part number, calibration/software IDs, original bytes, acquisition method, hash, image completeness and usage rights.
- **Processor:** exact ISA and variant, endianness, reset vectors, instruction mode, floating-point features and exception behavior.
- **Memory:** flash/RAM ranges, aliases, bootloader boundaries, calibration areas, nonvolatile data, executable permissions and initialization state.
- **Peripherals:** interrupt controller, clocks, timers, watchdogs, ADCs, PWM, DMA, CAN controllers/transceivers and any resolver/SPI/I²C devices the software accesses.
- **Startup environment:** power sequencing, reset causes, pin states, boot ROM services, checksums/signatures, nonvolatile configuration and expected peer modules.
- **Time:** instruction/peripheral synchronization, interrupt ordering, sampling deadlines and watchdog servicing.

A missing ADC-ready flag can trap firmware in a polling loop. An incorrect timer can change control periods. Returning zero for every unimplemented register can appear to “boot” while suppressing the behavior the experiment intended to study. Log unimplemented accesses and classify them rather than silently inventing device behavior.

QEMU's own documentation explains that an image for one Arm machine will often fail on another even when the CPU family is supported. Renode provides facilities for register and peripheral models, but those models still need to reproduce the relevant hardware contract. These are possible tools after target identification, not proof that an unidentified Toyota ECU is supported. [S6, S7]

The existing Prius firmware research reports static inspection of several Toyota-labelled engine files but leaves their MCU and complete memory layout unresolved; it also distinguishes those files from open replacement-controller firmware. Its documented Cortex-M example is a more tractable source-plus-binary exercise, but its CPU/address settings must not be copied to unrelated Toyota images. No original firmware is executed by this package. [U1]

## 4. A staged build plan with acceptance criteria

| Stage | Add | Evidence required before progressing |
|---|---|---|
| A — Current learning model | Engine, battery, supervisor, longitudinal braking, fault scenarios, OBD subset | Repeatable runs, unit/sign checks, bounded state and fault-response tests |
| B — Explicit component interfaces | Separate sensor packets, actuator packets, timing/validity fields, reset and state serialization | Same scenario gives the same result after controller refactoring; stale/invalid signals are tested |
| C — External software controller | Host-compiled engine or BMU controller over a local IPC/shared-library boundary | Match a recorded reference trace within declared numerical tolerances; verify reset and missed deadlines |
| D — Vehicle co-simulation | External body/drivetrain, FMI wrapper or virtual network | Specify time ownership; show stable results when communication step is reduced; close the declared power balance |
| E — Target-specific vECU | ISA and peripheral models or a supplied virtual ECU | Boot and interrupt tests, peripheral contract tests, deterministic network traces, documented unsupported hardware |
| F — Bench HIL | Real ECU with appropriate electrical interfaces and a real-time plant | Characterized latency/jitter and failure response; reviewed pinout and power/I/O limits; controlled bench-only test procedures |
| G — Vehicle-specific validation | Measured maps, network definition and synchronized vehicle logs | Quantified error on independent data, parameter provenance, coverage of relevant operating conditions |

The safest early firmware task is a small function with known inputs and outputs, such as a battery power-limit calculation. A large engine binary that expects immobilizer messages, an operating system and undocumented peripherals is a later research project. Authentication and protected flashing are not necessary for learning the control/plant boundary and are outside this package.

## 5. A proposed interface contract

The following richer packet is a **design proposal for the next version**, distinct from the implemented high-level bridge described above. Use named signals first; introduce byte packing at a separate adapter boundary.

```json
{
  "schema": "obdii-lab-sensors/1",
  "simulation_time_ns": 1200000000,
  "sequence": 120,
  "step_ns": 10000000,
  "signals": {
    "engine_speed": {"value": 2000.0, "unit": "rpm", "valid": true, "age_ns": 0},
    "coolant_temperature": {"value": 90.0, "unit": "degC", "valid": true, "age_ns": 0},
    "battery_current": {"value": 60.0, "unit": "A", "valid": true, "age_ns": 20000000}
  }
}
```

An actuator response should include the input sequence it consumed, command timestamp, requested torque/power, validity and active limits. Commands must expire. Define reset behavior, retained state, rate limits, saturation and ownership of fault injection. Preserve physical state and measured state separately so the interface can represent sensor offset, quantization, noise, freeze, dropout and delayed delivery.

Use simulated time for reproducible offline tests. If an external controller has not responded at a synchronization point, either pause the simulation or apply the specified deadline policy; record which occurred. Wall-clock execution speed is a separate metric. Avoid silently advancing the plant with a command received from the future.

## 6. FMI, virtual CAN and data replay

FMI packages a model and its interface in an FMU. In **Co-Simulation**, a component normally brings its own integration or scheduling behavior; in **Model Exchange**, the importing environment performs integration; **Scheduled Execution** exposes partitions for an external scheduler. FMI 3 clocks can express timed controller activations. An FMU wrapper would be useful after the lab's component interfaces and reset/state contracts are stable. It is not delivered in v1. [S4]

For diagnostics, a later Linux adapter can map the existing payload handler to a virtual CAN/ISO-TP endpoint. Linux's ISO-TP sockets exchange diagnostic payloads while the kernel handles framing. Keep this transport adapter separate from the OBD application logic. Start on a virtual interface and test multiple responders, flow-control timing, request expiry and malformed frames before considering bench hardware. [S2]

A raw CAN replay is not a closed-loop vehicle: it repeats recorded messages regardless of new control requests. Replay is excellent for decoder and startup-sequence tests, but plant coupling needs commands to change subsequent sensor messages. Store log timestamps, bus/channel identity, arbitration IDs, data, direction and provenance. Distinguish replayed evidence from generated traffic in the trace.

## 7. What a future Toyota-specific integration still needs

Select an exact vehicle generation and hardware configuration before choosing gear relations, battery chemistry or signal definitions. Preserve the factory HEV architecture separately from a hypothetical plug-in conversion. Obtain synchronized measurements sufficient to identify engine and machine maps, battery electrical/thermal behavior, torque-request conventions, state transitions and network timing.

Model the Toyota planetary speed constraint explicitly if adopting the supplied Gen2 architecture. A single parallel engine/motor torque sum cannot reproduce the roles of MG1, MG2 and the power-split gearset. Keep kinematic constraints, power conversion and supervisory policy separate: knowing the gear teeth does not reveal the controller strategy. [T1, T3]

Finally, make validation claims narrow and measurable. “The ECU exchanged the expected startup frames” is different from “the torque controller is numerically equivalent,” which is different again from “the virtual vehicle matches measured driving behavior.” A successful simulator should show the evidence for the claim it makes and identify the components still represented by assumptions.

References and Google Drive source links are in **SOURCES.md**.
