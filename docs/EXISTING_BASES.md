# Existing bases: what to reuse and where

The most useful existing base depends on the layer being simulated. A transport library, a scan-tool adapter emulator and a physical vehicle model solve different problems. This lab keeps those boundaries separate so existing tools can be adopted without replacing the learning plant.

## Selected first reuse: python-can VirtualBus

The optional `examples/python_can_demo.py` uses **python-can 4.6.1** as the CAN-message transport between a tester endpoint and an ECU endpoint in one Python process. The ECU uses this package's live `DiagnosticServer`, so response values come from the simulated engine. The example demonstrates single-frame requests, a segmented reply, flow control and payload reassembly. It is a real library integration, not a claim that the whole lab is based on python-can.

Install the optional dependency and run the demonstration from the package directory:

```bash
python3 -m pip install -r requirements-optional.txt
python3 examples/python_can_demo.py
```

The main dashboard, command-line scenarios and JSON bridge continue to run without this dependency. Installation needs an available Python package source; the dependency is not bundled into the archive.

The upstream VirtualBus connects endpoints on the same channel **within one process**. It preserves ordering and delivery but does not model bitrate, identifier arbitration or priority under bus load. This makes it useful for protocol integration tests, not a CAN timing benchmark. The demo selects only the virtual backend; it does not detect or open a hardware adapter. python-can's source license is GNU LGPL version 3. [S9]

## Other useful bases and their boundaries

| Existing project or artifact | Best use here | Current integration status | Boundary to preserve |
|---|---|---|---|
| python-can | Virtual message transport now; supported backend abstraction for later adapters | Optional executable example included | VirtualBus is not cross-process SocketCAN and does not simulate physical arbitration |
| Linux SocketCAN + can-utils | Later multi-process Linux virtual bus, capture, replay and kernel ISO-TP testing | Researched extension; not configured by this release | Requires the appropriate Linux interface/kernel setup; a replay trace does not respond to changing vehicle controls |
| Ircama ELM327-emulator | Later compatibility layer for software that expects ELM AT commands and a serial/TCP adapter | Researched candidate; not installed, vendored or coupled | Adapter/diagnostic emulation is separate from engine and battery physics; its license includes a noncommercial condition |
| Existing Prius Hybrid Lab in the user's Drive | Reference for a later Gen2 planetary and energy-flow plant | Its model notes were read; source was not imported | Prior 8.8 kWh PHEV is explicitly hypothetical; preserve its HEV/PHEV and evidence distinctions |
| QEMU / Renode | Target-specific firmware execution after hardware identification | Roadmap candidates | Need matching processor, memory, peripherals and startup environment |

can-utils provides tools such as `candump`, `canplayer`, `cansend` and ISO-TP utilities. It is a suitable second transport step when separate processes need to communicate over Linux virtual CAN. The inspected `candump.c` and `isotpsend.c` headers offer GPL-2.0-only OR BSD-3-Clause; other files and dependencies need their own license review before redistribution. No can-utils binary or source is copied into this package. [S10]

ELM327-emulator already handles adapter commands and multiple simulated ECUs. Its Toyota preset is **Auris Hybrid**, selected with `scenario car`; its default preset is not a Prius. That dictionary can help test a scan application but does not establish factory behavior for another Toyota generation. The repository specifies **CC BY-NC-SA 4.0**, so its reuse terms differ from permissively licensed libraries. This release links to it as a candidate rather than incorporating its code or data. [S11]

## A practical reuse order

Start by understanding the built-in model and running the optional python-can example. Next, use a Linux virtual bus if separate ECU processes are needed. Add an ELM-compatible facade when a specific scan application requires it. Introduce the existing Prius planetary model only after defining a common signal, time and energy contract; validate the resulting combined model with repeatable scenarios. Treat source-level controller integration as a separate milestone from executing an original ECU binary.

The existing Drive model notes give a useful starting interface and explicitly list assumptions. They report a 201.6 V HEV baseline and a hypothetical 8.8 kWh extension, with simplified efficiencies and supervisory logic. This is a candidate physical-model base, not a factory calibration dataset or a firmware emulator. [U2]

Source links and evidence scope are in **SOURCES.md**; binary execution requirements are in **FIRMWARE_ROADMAP.md**. Each optional dependency should be pinned and its own tests run when introduced, so a future update does not silently change the simulator's behavior.
