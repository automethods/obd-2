# OBD-II Visual Workbench

Recovered build 0.4.0 | 9 November 2026

A practical guide to the offline training panel, transparent vehicle, connections, protocols and model bindings.

## Start with one question

The recovered visual workbench starts from the attached v0.3.2 source and reconstructs the visual features described in the earlier conversation. It preserves the learning book, instruments, original handbook, learning guide and EngDoc worksheet. It is a new recovery build, not a byte-for-byte copy of a missing release.

Download the standalone `run.sh`, keep it in any folder, then run `bash run.sh` from that folder. Python 3.10 or newer is required. No pip installation, Node.js, CDN or online model download is needed to use the lab. Open `http://127.0.0.1:8765` if the browser does not open. Keep the terminal running; Ctrl+C stops the server and normally removes its temporary working directory.

If port 8765 is busy, run `bash run.sh --port 8766`. Use `bash run.sh --no-browser` to open the browser yourself. The optional source ZIP has a flat layout: `run.sh`, `launcher.py`, `run.py`, `obdii_lab/`, `web/` and `docs/` are at its root.

The training panel, transparent vehicle, protocol desk and object view refer to the same simulation. The learning book supplies guided explanations; instruments expose more signals. Begin with the coolant sensor experiment, establish a healthy reading, disconnect one connector, then advance time. Reconnect the wire before deciding whether memory also needs clearing.

A connector switch changes the topology immediately. Sensor sampling, fault timers and controller decisions change on subsequent simulation steps. Always compare before and after at known simulation times.

## The socket, network and question

DLC means diagnostic link connector: the physical access point with cavities and contacts. It does not name the diagnostic question. CAN is a vehicle network that carries identified frames. ISO-TP assembles an application payload that may need several CAN frames. OBD emissions services and UDS diagnostic services define what that payload asks or reports. [1-4]

The runnable path here is DLC CAN branch -> Classical CAN lesson frames -> ISO-TP -> selected OBD or UDS services. The scan-tool trace is a synthetic sequence, not a model of arbitration, bit timing or analog bus voltage. Functional OBD requests use teaching ID 7DF; the single simulated engine ECU uses physical request ID 7E0 and response ID 7E8. UDS examples use 7E0.

OBD is focused on emissions-related reporting. It does not imply that a generic engine query reads every brake or battery module. UDS offers a broader diagnostic service vocabulary and is independent of one particular data link. This lab implements only a small part of either application. [1,4]

ISO 9141-2 and ISO 14230/KWP2000 are legacy diagnostic families associated with K-line. J1850 has different PWM and VPW physical-layer variants. DoIP is a diagnostic route over IP. LIN is a local network for simpler nodes; it is not a synonym for an OBD port. These families have reference cards here, not running protocol engines. [5-10]

## Inspect a socket and every wire

Select a component, then its socket or wire. Inspect both endpoints, the associated signal, its unit, connection status and whether the value is currently available. A missing measurement must remain missing rather than becoming a displayed zero. A zero speed is a possible measurement; an unavailable speed is a different state.

The DLC diagram is viewed into the vehicle-side connector, with the wide edge at the top. In this CAN lesson, pin 6 is CAN-H and 14 is CAN-L. Pins 4 and 5 are grounds; pin 16 is the supply contact. Legacy reference roles include J1850 on 2/10 and K/L-line on 7/15. Actual use is protocol- and vehicle-dependent. [5]

The ECU, sensor and battery-monitor sockets are invented teaching connectors. Their pin assignments, wire dimensions, resistances and nominal values are model properties, not production vehicle service specifications. The drawn routes and vehicle coordinates are also illustrative.

The diagnostic disconnection experiment isolates the tester's CAN branch. It does not remove the DLC supply contacts or break the complete internal vehicle bus. A network animation can stop on that branch while the engine model continues.

Wire scopes display the bound model quantity. For a coolant wire, that can be the modeled sensor-node voltage. For a CAN wire, the display can be a logical payload or message-age value. It is not a measured CAN-H or CAN-L voltage waveform.

## Follow an open coolant circuit

The sensor lesson keeps three temperatures separate: physical coolant temperature, the sensor's reported temperature, and the temperature the controller uses. A temperature-sensitive resistance and a pull-up form an illustrative voltage divider. The controller samples the node through an idealized ADC.

With a healthy circuit, the model computes resistance, voltage and a temperature report. Disconnect the sensor connector and the circuit opens. The physical coolant does not jump to minus forty degrees. The diagnostic teaching report uses -40 degrees Celsius as an invalid-input marker; the controller can use a separate fallback value.

Advance time to let detection run. Read pending warnings with 07, stored warnings with 03, and the warning-lamp state with 01 01. P0118 describes the observed high-input circuit condition in this model; it does not prove a unique defective part.

Reconnect the sensor and advance again. A plausible input can return before stored fault memory clears. Clear the teaching engine memory with 04, then run and recheck. If the physical problem remains, detection can recur. Clearing memory does not repair a circuit.

This is a simplified educational detection cycle. The lab does not implement full regulatory drive cycles, permanent DTCs, all readiness monitors or a manufacturer's fault-confirmation strategy.

## Separate three kinds of missing information

No scan-tool reply: first ask 01 0C with the diagnostic branch connected. Disconnect DLC CAN and ask the identical question. The tester receives no application reply while the plant may continue evolving. Reconnect the branch and repeat the same request. Do not equate tester isolation with a stopped engine.

A stale battery-monitor message: use the hybrid profile. Establish healthy updates, disconnect the BMU CAN connector, and advance time. Compare message age, supervisor mode and battery permission. Reconnection restores the communication route and subsequent messages, but the protective shutdown can remain latched. Cycle the simulated ignition off and on, or reset the experiment, to start again with a cleared latch.

A missing front-left wheel signal: use the braking profile with initial motion. Disconnect the sensor, advance time, and compare physical wheel speed with measured speed. The wheel can keep rotating while the measured speed is unavailable. Watch the brake controller's degraded state. Reconnection restores input sampling after the next model update.

The four connector switches are independent. Existing fault-injection controls can also hold a fault active. If reconnecting a connector does not restore a value, inspect both the selected experiment and active input overrides. Reset is the clean way to return to the experiment's initial conditions.

## Read the bytes without losing the meaning

Choose a named question in the protocol desk. The request field contains application bytes only. The lab adds the ISO-TP length information, CAN identifier and padding for its trace.

For example, 01 0C asks for engine speed. A response 41 0C 0F A0 contains the value (256 x 0x0F + 0xA0) / 4 = 1000 rpm. The two application bytes in the request fit a single CAN frame; a longer synthetic VIN answer shows first, flow-control and consecutive frames. [3,5]

Available OBD examples include current sensor values, engine warning-lamp state, stored and pending emissions DTCs, clearing the teaching memory and a synthetic VIN. Modes 02, 06, 08 and 0A, broad ECU discovery and manufacturer-specific scan coverage remain outside this build.

UDS examples use physical address 7E0: 10 01 and 10 03 select the supported sessions, 22 F1 90 and 22 F1 87 read invented identification data, and 3E 00 demonstrates tester present. The extended session expires after five seconds of simulation time without a physical diagnostic request; tester present refreshes its timer. These functions do not imply support for vehicle flashing, security access, actuator tests or complete UDS conformance.

No response and a negative response mean different things. A disconnected branch may yield silence. A supported UDS path can return a negative-response payload for an unsupported or invalid request. Read the result explanation and frame trace together.

## Keep the model separate from the picture

The object view describes explicit parts rather than a single picture. A Component owns sockets. A Socket contains Pins. A Wire connects endpoints and identifies a signal binding. A Signal has a quantity, unit, value and validity. A Protocol gives meaning to exchanged bytes. A View renders those objects and responds to selection.

Stable identifiers join the layers. For example, coolant_sensor is a component, coolant_socket is a socket, ect_signal is a wire, and ect is the connector switch. The backend catalog describes structure and properties. The live network state describes availability and values. The model snapshot remains the authority for simulation time and physics.

Changes should flow through the model API. Do not infer a sensor fault solely from a red line in the renderer, and do not repair it by recoloring that line. The view sends a connector action, then paints the state returned by the server. This keeps the training panel, scope, vehicle and diagnostic desk consistent.

The backend entry points are network_catalog(), observe_network(snapshot) and Sim.set_connection(id, connected). Current switch IDs are ect, dlc, bmu and wheel_fl. A topology change becomes visible immediately; sampled effects occur as time advances.

The original Python API, local HTTP API and JSON-lines bridge remain useful for experiments. These are external simulation interfaces, not an instruction-set emulator or a hardware-in-the-loop system.

## Use the vehicle as another instrument

The transparent vehicle uses an offline WebGL2 renderer, with a Canvas 2D fallback where WebGL2 is unavailable. Drag to rotate, zoom, adjust body transparency and select parts. Wheel rotation follows physical simulated wheel speed; signal pulses follow simulation activity and pause with simulation time. Animated dots explain logical activity, not electron motion or bus timing.

The included editable asset is web/models/training_vehicle.glb, with web/models/vehicle_bindings.json. The local Load GLB control supports uncompressed embedded triangle geometry, node transforms and base colors. Named wheel_fl, wheel_fr, wheel_rl and wheel_rr nodes bind to the four physical wheels. The Load bindings JSON control accepts the matching node map. Imports are session-local: retain your asset files and load them again after restarting.

The lightweight importer does not support textures, skins, animation clips, Draco compression or external buffers. A model that needs those features belongs in a fuller renderer. Imported geometry is a visual replacement; it does not change the simulation's equations or make a vehicle-specific model.

A separate web/three-adapter.js supplies integration hooks for an installed Three.js scene graph. It does not bundle Three.js or GLTFLoader. A future full renderer can load a scene, resolve nodes by stable IDs, apply snapshot values and use the same selection and connection actions. See docs/VEHICLE_MODELS.md for the actual adapter contract.

Maintain separate physical and measured channels when adding an animation. The disconnected wheel sensor is the key test: physical wheel rotation should continue, while its measured-signal animation becomes unavailable.

## Record what happened and know the boundary

The working features are the generic engine, hybrid and braking models; four connector experiments; the object and wire catalog; live signal inspection; selected OBD services; and the small UDS identification/session set. The CAN/ISO-TP view is a teaching transcript. Legacy protocols, DoIP and LIN are reference material.

Use the CSV and JSON exports to retain signal history, and the diagnostic trace export to retain requests and replies. Record the profile, initial settings, connection state, input overrides and simulation time with any comparison. A screenshot alone cannot establish which physical and measured values produced the picture.

To add a component, give it a stable ID and explicit sockets/pins. Add the physical behavior or input model, define its observed signal and unit, decide when the signal is invalid or stale, expose a wire binding, and add a view node. Verify healthy behavior, loss of information and repair through the model API before adding visual polish.

All vehicle outputs and identifiers are synthetic. Vehicle geometry, module pinouts, parameter values and timers are educational assumptions. The build does not execute original ECU firmware, connect to a real vehicle, simulate every electrical effect or certify protocol conformance. The EngDoc worksheet remains a separate static circuit worksheet; full editor import and live synchronization are not established by this recovery.

The source package includes the validation record for the recovered build. That record distinguishes automated behavior checks, packaging checks and browser inspection. Follow the supplied launch instructions on Linux Mint; the user's particular Mint installation is a separate environment.

## Primary references

Checked 9 November 2026. These sources establish protocol roles; the lab implements only its documented teaching subset.

- [1] OBD application: [ISO 15031-5:2015 - Emissions-related diagnostic services](https://www.iso.org/standard/66368.html).
- [2] CAN diagnostic path: [ISO 15765-4:2021 - Requirements for emissions-related systems](https://www.iso.org/standard/78384.html).
- [3] ISO-TP transport: [Linux kernel documentation - ISO 15765-2](https://docs.kernel.org/networking/iso15765-2.html).
- [4] UDS application: [ISO 14229-1:2026 - Application layer](https://www.iso.org/standard/87962.html).
- [5] Connector and legacy interfaces: [Elm Electronics - ELM327 data sheet, v2.3; figures 8 and 9](https://elmelectronics.com/wp-content/uploads/2020/05/ELM327DSL.pdf).
- [6] Legacy ISO diagnostics: [ISO 9141-2:1994 - Digital information interchange](https://www.iso.org/standard/16738.html).
- [7] K-line physical layer: [ISO 14230-1:2012 - Diagnostic communication over K-Line](https://www.iso.org/standard/55591.html).
- [8] J1850 network: [SAE J1850_202212 - Class B Data Communications Network Interface](https://saemobilus.sae.org/standards/j1850_202212-class-b-data-communications-network-interface).
- [9] Diagnostics over IP: [ISO 13400-2:2025 - Transport protocol and network layer services](https://www.iso.org/standard/13400-2).
- [10] LIN physical layer: [ISO 17987-4:2025 - Electrical physical layer specification](https://www.iso.org/standard/85128.html).
