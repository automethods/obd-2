# MAF contact interruption experiment · 0.9.7+article.1

Open Help → **MAF · experiment / дослід** or `/web/article-experiment.html`.
Predict which interruptions reach a sensor sample and which leave a stored
code, then run the 22 cases and compare the table and chart. Download complete
JSON or the summary CSV. Each case creates an independent vehicle; the driving
session is preserved.

Run from the source folder using Python 3.10 or newer:

```sh
python3 -m obdii_lab.article_experiment --output article_results
python3 -m unittest discover -s tests -p test_article_experiment.py -v
```

The experiment adds a runner and a separate results page. It uses the existing
plant, SensorBank and diagnostic monitor without changing their behavior.

Petrol extended is initialized with the full configuration saved in JSON.
Ignition and start are requested at 0 s, with 30% brake for 1 s. At 1 s the
selector changes to D, parking brake releases, and throttle becomes 35%, with
zero service brake. Road friction is 0.85 and grade is zero. Controls remain
fixed; speed, RPM and engine load can respond to the fault.

There are five single-pulse durations (10, 20, 50, 100, 600 ms) and four opening
phases (2, 10, 24, 48 ms) after the 2.000 s sample boundary, plus a healthy run
and an open circuit from 2.002 s to the end. All observations end at 3.800 s.
Finite pulses therefore have more than 1 s of recovery. The open interval is
half-open: [opening, closing). Both contact changes precede controller sampling
at the same tick. These are single interruptions, not recurring schedules.

The plant step is 2 ms, ECU task 10 ms, MAF sampling 50 ms. Existing model
assumptions apply: invalid MAF reduces available torque to 70%; a continuous
invalid sampled state produces pending P0102 after 0.20 s and stored P0102 after
0.50 s. Recovery clears pending state and restores normal torque. Stored memory
is retained until explicitly cleared.

`controller_at_s` is the task execution time; `observed_at_s` is the following
integration boundary, 2 ms later. Other rows between tasks have a null controller
timestamp. `sampled_at_s` is the sensor's own timestamp. The chart uses observation
boundaries. Summary event times refer to tasks/samples. The ordinary 100 ms
history is not used to locate these events.

For 10 and 20 ms pulses, only phase 48 ms reaches the 2.050 s sample. All 50,
100 and 600 ms pulses affect control at the four tested phases. Only 600 ms and
the sustained-open reference store P0102. First invalid sample is 2.050 s,
pending 2.250 s and stored 2.550 s in those long cases. Finite 600 ms pulses
recover at 2.650 s with stored memory retained.

Counts across these four deterministic phases are not real-world probabilities.
Software tests check sampling, model behavior, recovery and interface isolation.
No vehicle calibration accuracy or student learning effect is established.

Start the complete local simulator with `bash run.sh` from the main
Description_Sim folder. The experiment and its exports are part of that same
application. Website publication remains separate from this simulator update.
