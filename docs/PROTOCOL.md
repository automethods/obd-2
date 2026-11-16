# OBD-II and ISO-TP: the diagnostic lesson

> **Recovered v0.4.0 scope.** This reference now includes the reconstructed connector behavior and small UDS subset. The [Visual Workbench guide](VISUAL_WORKBENCH.md) is the current addendum. The two original PDF books are retained v0.3 reading copies.


## Recovered UDS and connection behavior

The existing OBD request table below remains valid. UDS examples use the physical request ID `7E0`; the functional OBD ID `7DF` does not run UDS.

| UDS request | Teaching response |
|---|---|
| `10 01` / `10 03` | Default / extended diagnostic session; timing fields are illustrative |
| `22 F1 90` | Synthetic VIN `LAB00000000000001` |
| `22 F1 87` | Synthetic manufacturer spare-part number `LAB-ECU-0001` |
| `3E 00` | Tester-present acknowledgement; refresh the session timer |

The extended session expires after 5 seconds of simulation time without a physical diagnostic request. Supported physical UDS handling can return a negative response for an unsupported or invalid request. These services do not provide programming, security access, actuator tests or complete UDS conformance.

`Sim.set_connection(id, connected)` controls `ect`, `dlc`, `bmu` and `wheel_fl` paths. A disconnected `dlc` prevents tester replies while the internal vehicle network and plant continue. Reconnecting BMU CAN resumes messages, but its protective shutdown remains latched until a simulated ignition cycle or reset. Connection topology changes immediately; controller sampling and fault decisions require subsequent simulation steps.

## 1. What the interface does

OBD-II is the diagnostic window into an ECU. It does not calculate vehicle motion, manage the battery contactors, or execute the engine controller. In this lab the vehicle model produces a sensor snapshot; the diagnostic server encodes selected values into request/response messages. SAE J1979 describes emissions-related diagnostic services and distinguishes them from the transport and physical layers [R1].

The separation is:

| Layer | Example in this lab | What it means |
|---|---|---|
| Physical process | Engine actually turning at 2,000 rpm | A mathematical state of the simulated plant |
| Sensor/controller | Crank-speed estimate and ECU state | The ECU's view of that process |
| Diagnostic application | Request `01 0C`; reply `41 0C 1F 40` | Ask for engine speed and encode the result |
| Transport | ISO-TP single frame | Add a length/control byte and, if necessary, split a large reply |
| Data link | CAN identifier `7E8`, eight data bytes | Identify the sender/message on the configured network |
| Electrical network | Explicit connector paths and CAN branches | Connection state affects behavior; transceiver voltage, arbitration and bit timing are not simulated |

**Implemented scope:** one diagnostic ECU, Classical CAN, 11-bit identifiers, normal ISO-TP addressing, selected OBD services and the small physical-address UDS subset below. The configured bitrate is 500 kbit/s, but the trace is not a timing or bus-load simulation. No physical adapter is opened. This is a learning implementation, not an ISO/SAE conformance claim.

An optional working integration, `examples/python_can_demo.py`, reuses the existing **python-can 4.6.1 VirtualBus** transport. Two same-process endpoints exchange live requests and responses through real library queues. The example validates flow control before sending consecutive frames, and reassembles the reply. It is a bounded cooperative lesson rather than a complete asynchronous ECU server. See `EXISTING_BASES.md` for installation, reuse choices, and the next integration stages.

**Toyota boundary:** the identifiers and data values below describe this lab configuration. They are not a claim that every Toyota, Prius generation, powertrain ECU, battery ECU, or gateway uses the same arrangement. Generic emissions requests do not automatically expose every vehicle subsystem. An actual vehicle needs the correct model/year/network specification and supported diagnostic services.

## 2. Addresses and supported requests

| Address | Role in the lab |
|---|---|
| `0x7DF` | Functional emissions request: addressed to potential responders |
| `0x7E0` | Physical request to this lab's engine ECU |
| `0x7E8` | Response from that ECU |

These are conventional 11-bit OBD-on-CAN examples documented by Elm Electronics [R3]. A real functional query can receive more than one ECU reply. This release intentionally creates one responder. Requests to other identifiers produce no response.

Enter application bytes such as `01 0C`, without the CAN identifier, ISO-TP length byte, or padding. This interface does not implement an ELM327 serial command interpreter: `AT Z`, `AT SP`, and other AT commands are not accepted.

| Application request | Reply content | Lab behavior |
|---|---|---|
| `01 00` | Supported Mode 01 PID bitmap | `41 00 98 1B 80 00` |
| `01 01` | MIL, DTC count, limited monitor flags | Only a simplified comprehensive-component monitor is advertised |
| `01 04` | Calculated engine load | Model's load proxy |
| `01 05` | Engine coolant temperature | ECU sensor reading, which can differ from true plant temperature |
| `01 0C` | Engine speed | Quarter-rpm encoding |
| `01 0D` | Vehicle speed | Whole km/h encoding |
| `01 0F` | Intake-air temperature | Ambient-temperature proxy in this model |
| `01 10` | Mass air flow | Model's air-flow estimate |
| `01 11` | Throttle position | Model's throttle signal |
| `03` | Confirmed emissions DTCs | CAN-format count followed by two-byte codes |
| `07` | Pending emissions DTCs | Same count-and-code structure |
| `04` | Clear simulated emissions diagnostic memory | Requires a connected clearing callback; an active fault is detected again |
| `09 00` | Supported Mode 09 bitmap | `49 00 40 00 00 00` |
| `09 02` | Synthetic VIN field | `LAB00000000000001`, exactly 17 characters |

The synthetic VIN is a teaching identifier, not an OEM-issued or registration-valid identity. No real user's VIN is included.

Unsupported OBD services/PIDs and unsupported OBD request shapes produce no reply. This intentionally avoids inventing a UDS negative response to a functional J1979 request. Modes 02, 06, 08, and 0A, multi-PID requests, ECU discovery, and manufacturer-specific requests are outside this release. Although the core can retain a first-fault snapshot for teaching, Mode 02 freeze-frame transport is not implemented.

## 3. Work through the bytes

### Example A — 2,000 rpm

The requested mode is `01` and the engine-speed PID is `0C`.

    Application request: 01 0C
    Application reply:   41 0C 1F 40

The positive-response mode is the request mode plus hexadecimal `40`. The two data bytes are A=`1F` (31 decimal), B=`40` (64 decimal).

    rpm = (256 × A + B) / 4
        = (256 × 31 + 64) / 4
        = 2,000

The quarter-rpm representation is described in the manufacturer's diagnostic interpreter datasheet [R3]. The exact numerical example above is calculated for this lab.

| Direction | CAN ID | Eight data bytes | Interpretation |
|---|---|---|---|
| Tester → ECU | `7DF` | `02 01 0C 00 00 00 00 00` | `02` means two application bytes follow |
| ECU → tester | `7E8` | `04 41 0C 1F 40 00 00 00` | `04` means four application bytes follow |

The zero bytes at the end are padding. They are not additional sensor values.

### Example B — coolant at 90 °C, then an open sensor

    T_coolant = A − 40
    A = 90 + 40 = 130 decimal = 82 hexadecimal
    Reply = 41 05 82

An open NTC sensor circuit can be represented as a high signal voltage and an implausibly cold sensed temperature. In the lab's fault case:

| Quantity | Illustrative value | Meaning |
|---|---|---|
| `coolant_c` | 90 °C | True mathematical plant temperature |
| `sensors.ect_c` | −40 °C | Faulted sensor reading |
| `sensors.ect_used_c` | 80 °C after detection | Toy ECU fallback for control |
| `01 05` reply | `41 05 00` | Encoded faulted sensor reading: 0 − 40 = −40 °C |
| Emissions fault memory | `P0118` after debounce | The demonstration's engine-coolant high-input fault |

The specific fallback temperature, detection delay, and reported fault value are teaching choices. Production diagnostics may report different substituted values and require different enable conditions and drive cycles. They must be verified against the actual ECU specification.

### Example C — supported PIDs

`01 00` returns a 32-bit bitmap, not a list of 32 values. The most significant bit represents PID 01; the least significant bit represents PID 20. A set bit advertises support. The lab advertises precisely the requests in the table above, and its tests compare every bit against the implemented service. No higher PID range is advertised.

### Example D — diagnostic trouble codes

For Classical-CAN OBD, the Mode 03 payload includes a count byte before the encoded codes [R3]:

| Payload bytes | Meaning |
|---|---|
| `43` | Positive response to Mode 03 |
| `01` | One DTC follows |
| `01 18` | P0118 in its two-byte representation |

The four families use two high bits: powertrain `P`, chassis `C`, body `B`, and network `U`. The next two bits encode the first numeric digit (0–3), and the remaining 12 bits encode the last three hexadecimal digits. Examples computed by this lab:

| Human-readable DTC | Two encoded bytes |
|---|---|
| `P0118` | `01 18` |
| `P0300` | `03 00` |
| `C1234` | `52 34` |
| `U0100` | `C1 00` |

An empty confirmed-DTC list returns `43 00`. A code's valid binary format does not prove that its definition is assigned or applicable to a particular ECU. The simulated module fault list is separate from the emissions `dtcs` list. ABS/ESP/BMU warnings should not be indiscriminately inserted into the engine ECU's generic Mode 03 reply.

### Example E — clearing does not repair the sensor

1. Run the ECT open-circuit scenario until P0118 appears.
2. Read `03`; the response contains P0118.
3. Send `04`; the simulator clears its emissions diagnostic memory and returns `44`.
4. The underlying injected fault remains active. Advance simulation time; the monitor can detect it again.
5. Remove the injected fault and clear the memory to observe a fault-free monitor run.

The toy monitor uses compressed persistence times so the lesson is visible quickly. It does not reproduce regulatory confirmation, healing, permanent-code, warm-up-cycle, or readiness rules. Real Mode 04 has broader semantics than the implemented teaching memory [R3].

## 4. A longer message: VIN over ISO-TP

ISO-TP distinguishes physical and functional addressing and supports single-frame and multi-frame transfers. In a multi-frame transfer, the receiver sends flow control that specifies block size and minimum separation time before the sender continues [R2].

The 20-byte application payload here consists of `49 02 01` followed by the 17 VIN characters. It cannot fit into the seven application bytes available in one normally addressed Classical CAN frame.

| Step | CAN ID | Frame bytes | Meaning |
|---|---|---|---|
| 1 | `7DF` | `02 09 02 00 00 00 00 00` | Functional VIN request |
| 2 | `7E8` | `10 14 49 02 01 4C 41 42` | First frame: payload length `014` hex = 20 bytes; begins `LAB` |
| 3 | `7E0` | `30 00 00 00 00 00 00 00` | Flow control to the responding ECU's physical address |
| 4 | `7E8` | `21 30 30 30 30 30 30 30` | Consecutive frame, sequence number 1 |
| 5 | `7E8` | `22 30 30 30 30 30 30 31` | Consecutive frame, sequence number 2 |

`30` is Continue To Send. The chosen block size is zero (no intermediate block limit), and STmin is zero. The lesson trace inserts this ideal peer response automatically. It is not waiting for an actual tester. The original request can be functional, but the flow control goes to `7E0`, the physical request address of the ECU that sent the first frame.

The low-level `segment_payload()` helper only produces the single/first/consecutive frame bytes; it does not implement a transmitting protocol state machine. `isotp_trace()` adds the explanatory flow-control step. `IsoTpReceiver` is a genuine stateful parser for one already-filtered stream: it rejects bad sequence numbers, insufficient data, invalid lengths, optional padding mismatches, and simulated receive timeouts. Sequence numbers wrap after 15 to 0. Missing frames are rejected rather than silently reordered.

```python
from obdii_lab.diagnostics import DiagnosticServer, IsoTpReceiver

server = DiagnosticServer(lambda: {"rpm": 2000, "coolant_c": 90})
reply = server.request("09 02")
receiver = IsoTpReceiver(timeout_s=1.0, padding_byte=0)
payload = None
for n, frame in enumerate(reply["frames"]):
    if frame["id"] == "7E8":
        payload = receiver.feed(frame["data"], timestamp=n * 0.001)
print(payload[3:].decode("ascii"))
# LAB00000000000001
```

The receiver does not generate flow control itself, and it must be fed one ECU's data frames only. Production implementations need complete receive/transmit state machines, negotiated timing, addressing options, and transport error handling. The Linux ISO-TP stack provides an established path for a later virtual-CAN or CAN interface [R2].

## 5. Data scales and monitor flags

In the formulas below A and B are unsigned bytes; two-byte values are big-endian. Encoding clips to the representable interval and rounds to the closest representable value. The readings are model-derived; correct byte scaling does not make the plant a calibrated production engine.

| PID | Decoding | Unit | Representable interval |
|---|---|---|---|
| `04` | `100A / 255` | % calculated load | 0–100 |
| `05` | `A − 40` | °C coolant | −40–215 |
| `0C` | `(256A+B) / 4` | rpm | 0–16,383.75 |
| `0D` | `A` | km/h | 0–255 |
| `0F` | `A − 40` | °C intake air | −40–215 |
| `10` | `(256A+B) / 100` | g/s air flow | 0–655.35 |
| `11` | `100A / 255` | % throttle | 0–100 |

For Mode 01 PID 01, data byte A's high bit is MIL and its lower seven bits count confirmed emissions codes. This lab's byte B has comprehensive components supported (bit 2); bit 6 reports that simplified monitor incomplete until the core marks it complete. Other support bits and bytes C/D are zero. Therefore the response must never be interpreted as "this simulated vehicle has passed all emissions monitors." Unsupported monitors were never run.

## 6. Extension contracts

The public interface is intentionally independent of the physics implementation:

```python
server = DiagnosticServer(sim.snapshot, sim.clear_emissions_dtcs)
result = server.request("01 0C", can_id=0x7DF)
# result: request_hex, response_hex (or None), meaning, frames, optional error
```

`snapshot()` supplies sensor/controller readings and dedicated emissions memory. `clear_emissions_dtcs()` clears simulated diagnostic memory while preserving the physical cause. The embedding application decides whether the ECU is powered and reachable; this diagnostic object itself remains available whenever called.

Reasonable next increments are:

1. Extend the optional python-can VirtualBus demonstration with scheduled delivery delays, dropped frames, and explicit bus-load estimates. Its existing ordered queues do not model arbitration or bitrate saturation.
2. Replace the ideal transcript with a full ISO-TP sender/receiver pair, including flow-control timeouts and block-size/STmin behavior.
3. Implement a gateway and additional ECU addresses from a documented target configuration.
4. Extend beyond the current synthetic UDS identification DIDs with validated module-specific services and signal definitions. UDS service 0x22 is a different diagnostic application, not an extra Mode 01 PID.
5. Add virtual CAN / SocketCAN as an explicit optional adapter; retain the deterministic in-process transport for repeatable tests.
6. Feed diagnostics from a real firmware execution environment only after its CPU/peripherals, sensor interfaces, scheduling, and network stack work. A `.bin` file is not a diagnostic-service implementation by itself.

No programming, security-access, immobilizer, or vehicle-flashing services are included. The current code is a local simulator with no hardware connector.

## References and evidence boundaries

Accessed 9 November 2026. These are primary publisher/manufacturer sources. The standards' public scope pages are not substitutes for the complete normative documents.

- **[R1] SAE International, J1979_202505, E/E Diagnostic Test Modes.** Public scope and layer mapping. <https://saemobilus.sae.org/standards/j1979_202505-e-e-diagnostic-test-modes>
- **[R2] Linux Kernel documentation, ISO 15765-2 (ISO-TP).** Addressing, single/multi-frame transport, flow control, socket interface, and transport-error behavior. <https://kernel.org/doc/html/latest/networking/iso15765-2.html>
- **[R3] Elm Electronics, ELM327DSL datasheet.** Manufacturer's examples for OBD requests, RPM/coolant scaling, CAN addressing, DTC count format, and ISO-TP frame types; particularly printed pages 33–37 and 43–46. <https://elmelectronics.com/wp-content/uploads/2020/05/ELM327DSL.pdf>
- **[R4] SAE International, J1979_201202 public scope.** Identifies the J1979-DA and J2012-DA presentation-data references used for parameter and DTC definitions. Obtain the applicable normative editions when building a compliant implementation. <https://saemobilus.sae.org/standards/j1979_201202-e-e-diagnostic-test-modes>

The precise test vectors, Python implementation, fictional VIN, selected subset, and fault-demonstration timings are original lab choices. Toyota-specific supported PIDs, enhanced diagnostics, calibration identifiers, security/session requirements, and network maps have not been inferred from these generic references.
