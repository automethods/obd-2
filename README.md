# OBD II Lab v0.9.10

Independent AutoMethods project: `automethods/obd-2`.
Published address: https://automethods.com/projects/obd-2/

This repository owns its page, English/Ukrainian text, styles, ECU/vehicle visual
and simulator downloads. The selector in `automethods/home` references a pinned
release of this project, like the other AutoMethods applications.

The shared login and human verification belong to the homepage. This project
adds neither a second login nor another verification flow. Its country-language
hint uses the selector's existing `/api/language.js` service when hosted on
AutoMethods. Ukraine defaults to Ukrainian, other countries to English. An
explicit user choice is remembered with the existing shared language key.

The simulator itself is unchanged: Python 3.10+, local driving and diagnostics,
all existing vehicle presets, sensor/fault tools, CAN/ISO-TP views, recordings,
exports and both languages. `downloads/run.sh` is the standalone Linux launcher;
`downloads/OBDII_Lab.zip` includes the editable simulator source and Windows launcher.

Run publication checks with `node tests/language.test.cjs`.
