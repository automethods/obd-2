# OBD II Lab 0.9.10 — online edition

Independent AutoMethods project: `automethods/obd-2`.
Published address: https://automethods.com/projects/obd-2/

Open the lab in a browser. No Python installation, terminal or installer is needed. The original Python simulation engine runs inside the browser tab through a vendored Pyodide WebAssembly worker. Each tab owns its vehicle and recordings; export wanted data before closing or reloading the tab.

The complete existing application is retained: six vehicle presets, vehicle and road settings, driving controls and keyboard input, manual gearbox and clutch, HVAC, WLTC, synchronized service dashboard, unit maps and wiring, sensor disconnects and intermittent faults, live values and graphs, OBD/UDS/CAN/ISO-TP messages, diagnostic memory, recordings and CSV/JSON/trace exports, MAF experiments, 3D model import, help and reference documents. The 17 simulation engine files are unchanged; `model-provenance.json` records their checksums.

The homepage repository owns the selector, shared login and human verification. This project adds no authentication or human verification. Its files are assembled under `/projects/obd-2/` from a pinned GitHub commit by the existing homepage build, like the other projects.

Ukraine defaults to Ukrainian; other countries default to English using the existing `/api/language.js` country hint. EN / Українська saves the explicit choice using AutoMethods' shared `motion-lab-language` preference. Interface language changes preserve the current vehicle. Reference PDFs and historical engineering documents remain in their original English.

`web/` contains the original application with publication-path and language adaptations. `model-src/` preserves the editable engine source; `python/model.zip` is the same model prepared for the worker. `online/` adapts the original API handlers to in-memory browser requests. `vendor/pyodide/ORIGIN.json` identifies the pinned runtime and its included license files. Simulator exports are data files, not application installers.

Verification:

```
node tests/language.test.cjs
OBD_SOURCE=/path/to/original/source node tests/model-parity.mjs
PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs node tests/online-browser.mjs
```

The parity check replays original API acceptance checks against native Python and the browser runtime. Browser checks exercise the actual worker and interface under the production URL prefix, without an HTTP simulation backend. To refresh the imported application, run `python3 tools/import-simulator.py --source /path/to/original/source`, then rerun verification. There is no website build step for this repository: the homepage's existing build copies the publication files listed in `publication-manifest.json`.
