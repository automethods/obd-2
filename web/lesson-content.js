/* Plain-language lesson content for the beginner reader. No HTML is embedded. */
(function () {
  "use strict";
  window.LessonContent = {
  "version": "0.3.0",
  "chapters": [
    {
      "id": "welcome",
      "title": "Start here: change one thing",
      "group": "Getting started",
      "subtitle": "A small experiment you can see and explain",
      "goal": "Follow a change from the driver or a sensor to the computer and then to the vehicle.",
      "diagram": "ect_loop",
      "experiment": "engine",
      "tryLabel": "Start a simple engine lesson",
      "question": "When you change the pedal, what changes first and what takes longer?",
      "paragraphs": [
        "Think of this book as a workbench beside an explanation. The chapter tree stays on the left. On the right you can read, inspect a diagram, change one control and watch the result. You do not need to type computer commands or understand message codes to complete the lessons.",
        "A sensor measures something. A vehicle computer checks the measurement and makes a decision. An actuator carries out a request, for example by changing engine effort or brake force. The engine, battery or wheels then respond. That response is measured again, so the loop repeats.",
        "The drawing and the instruments describe the same running experiment. Start with the words: what changed, what the sensor reports, what the computer decided, and why. Ordinary measurements such as temperature and speed help you compare before and after. Detailed electrical values and message bytes are available when you want to look deeper.",
        "This is a teaching vehicle. Its engine, battery and braking models are deliberately small enough to understand. Toyota documents provide separate examples of real vehicle architecture; the lab is not Toyota production software. The PDF is the reading and printing copy. Run the browser workbench to operate the controls."
      ],
      "steps": [
        "Choose Start this experiment and leave the controls unchanged for a moment.",
        "Choose Watch it run, then Pause and inspect. Notice that simulation time stops when paused.",
        "Change one control, choose One small step and read the explanation of the result.",
        "Choose Start this experiment again before comparing another change, so both experiments start from the same conditions."
      ],
      "observe": [
        "A command is a request, not an instant physical result.",
        "A measured value can be missing or wrong even when the physical part still exists.",
        "Faster playback advances simulated time faster on your screen; it does not change the model equations."
      ],
      "reference": {
        "doc": "LEARNING_GUIDE",
        "heading": "1. What you are learning"
      }
    },
    {
      "id": "engine",
      "title": "An engine responds gradually",
      "group": "Engine and temperature",
      "subtitle": "Pedal request, engine effort and warm-up",
      "goal": "See why engine speed and temperature respond on different timescales.",
      "diagram": "ect_loop",
      "experiment": "engine",
      "tryLabel": "Run the engine on its stand",
      "question": "Why can engine speed change quickly while the coolant temperature changes slowly?",
      "paragraphs": [
        "The accelerator asks for more engine effort. The engine computer turns that request into a bounded command. The rotating parts have inertia: they resist a sudden change of speed. Engine speed therefore moves toward a new condition rather than jumping instantly.",
        "The engine also produces heat. Coolant and metal store some of that heat, while cooling removes some. Temperature rises when heating is greater than cooling. It falls when cooling is greater. This is why a brief pedal change does not instantly heat or cool the engine.",
        "This first experiment is an engine on a virtual test stand. There is no moving car attached to it. Engine speed can rise while vehicle speed stays at zero, and battery or wheel instruments are marked unavailable. That is an intentional smaller starting model.",
        "Engine speed means how many turns the crankshaft makes in one minute. Temperature tells us how warm the coolant is. Fuel flow tells us how quickly fuel is being used. Read the explanation beside a measurement before interpreting a larger number as better or worse."
      ],
      "steps": [
        "Choose Start this experiment for a fresh engine lesson.",
        "Choose Watch it run with a modest accelerator setting and watch engine speed settle.",
        "Increase the accelerator, then compare the immediate speed change with the slower temperature change.",
        "Pause and inspect the engine loop: request, computer decision, physical response and measurement."
      ],
      "observe": [
        "A turning engine has stored motion; it does not stop or accelerate without a physical cause.",
        "Coolant warms gradually because the model includes heat storage.",
        "The engine stand intentionally has no installed battery controller or wheel controller."
      ],
      "reference": {
        "doc": "LEARNING_GUIDE",
        "heading": "5.1 Engine speed and mean torque"
      }
    },
    {
      "id": "coolant",
      "title": "How the computer knows the temperature",
      "group": "Engine and temperature",
      "subtitle": "From a warm sensor to a usable reading",
      "goal": "Separate the real temperature, the measurement and the value used for control.",
      "diagram": "ect_circuit",
      "experiment": "engine",
      "tryLabel": "Explore the connected temperature sensor",
      "question": "If a sensor reading changes, must the real temperature have changed?",
      "paragraphs": [
        "The computer cannot feel the coolant directly. A temperature-sensitive component changes its electrical resistance as it warms. In this circuit, warming reduces resistance. Together with a fixed resistor inside the computer, it makes a voltage that the computer can measure.",
        "The computer turns the measured voltage into a temperature estimate. In normal operation that estimate stays close to the actual coolant temperature. Small differences are expected because this model rounds an electrical measurement to a finite set of digital steps.",
        "Keep three ideas separate. Actual temperature is what the physical model says the coolant is doing. Reported temperature is what the sensor path lets the computer estimate. Control temperature is the value the computer chooses to use. They agree closely when healthy but can differ after a fault.",
        "The connector drawing shows a signal path and a return path. Opening the signal path breaks the measurement circuit; it does not remove heat from the coolant. The labels X1 and J-ECT are names chosen for this teaching harness, not the connector numbers of a particular Toyota."
      ],
      "steps": [
        "Start with the sensor connected.",
        "Change the starting temperature when the lesson offers that setting, then reset or apply the new starting condition.",
        "Compare the actual temperature with the reported temperature and the temperature used by control.",
        "Select the wire or sensor in the drawing and read its explanation before opening the advanced electrical details."
      ],
      "observe": [
        "A healthy sensor report should follow the physical temperature.",
        "For this particular temperature-sensor circuit, warmer coolant produces a lower signal voltage.",
        "The actual wire voltage and the rounded computer representation are separate observations of the same circuit."
      ],
      "reference": {
        "doc": "LEARNING_GUIDE",
        "heading": "5.2a From coolant temperature to an electrical measurement"
      }
    },
    {
      "id": "sensor_fault",
      "title": "What happens when a sensor is disconnected?",
      "group": "Engine and temperature",
      "subtitle": "A missing measurement, a fallback and a stored warning",
      "goal": "Explain a sensor fault without mistaking it for a sudden physical temperature change.",
      "diagram": "ect_circuit",
      "experiment": "engine",
      "tryLabel": "Disconnect the coolant sensor",
      "question": "Why should clearing a warning fail to repair a disconnected wire?",
      "paragraphs": [
        "Begin with a healthy engine, then disconnect the coolant sensor using the lesson fault control. The sensor branch no longer carries current. The computer input is pulled high by its internal resistor. That high input cannot be treated as a believable temperature measurement.",
        "The real coolant remains warm. The model shows an invalid cold reading in the sensor report, but its plain-language note explains that this is a failed measurement. A value marked invalid is not evidence that the physical engine reached that temperature.",
        "The engine computer waits briefly to see whether the bad input persists. In this lesson, after one fifth of a second it uses a substitute temperature and reduces its requested engine effort. After half a second it stores a confirmed warning and turns on the engine warning lamp. These short waiting times are teaching choices, not a manufacturer calibration.",
        "Reconnecting the sensor repairs the signal path. The current measurement can recover while the stored warning remains as a record of what happened. Clearing warning memory removes that record. Clearing memory while the sensor is still disconnected leaves the cause in place, so the warning can return."
      ],
      "steps": [
        "Choose Start this experiment, then Watch it run until you see a normal measurement.",
        "Choose Disconnect the temperature sensor, then One small step.",
        "Compare actual temperature, invalid sensor report and substitute control value as time advances.",
        "Read the stored warning in words. Repair the sensor connection, then clear the engine warning memory.",
        "For a second experiment, clear the warning while still disconnected and observe why it returns."
      ],
      "observe": [
        "The failure begins in the measurement path, not in the physical coolant.",
        "The substitute is a chosen control value; it is not a new measurement.",
        "Repairing a cause and clearing its history are separate actions."
      ],
      "reference": {
        "doc": "SCHEMATIC_WORKSPACE",
        "heading": "The six-step ECT task"
      }
    },
    {
      "id": "battery",
      "title": "The battery computer sets limits",
      "group": "Battery and hybrid drive",
      "subtitle": "Energy remaining, permitted power and fresh information",
      "goal": "Understand why the vehicle may refuse a request even when the driver keeps pressing the pedal.",
      "diagram": "hybrid",
      "experiment": "low_soc",
      "tryLabel": "Try the low-charge battery lesson",
      "question": "Can an old, believable battery report be trusted as a current report?",
      "paragraphs": [
        "The battery stores energy, but it cannot provide or accept unlimited power. Its controller watches charge level, temperature and voltage-related inputs. It tells the rest of the vehicle how much battery power may be used for driving and how much may be returned during braking.",
        "Charge level is an estimate of how full the battery is. Low charge can make the hybrid controller request more engine use. A nearly full battery may have little room to accept recovered braking energy, so the friction brakes must do more of the stopping work.",
        "The battery computer sends repeated status reports to the hybrid controller. A report needs to be both believable and recent. If updates stop, the last received numbers may still look reasonable. The workbench marks them as old while the actual battery model can continue changing.",
        "Try stopping the battery status messages. In this model, a report older than roughly three tenths of a second causes the hybrid controller to inhibit driving effort and request disconnection of the high-voltage path. That stop is latched: restoring messages alone does not remove it. Restore the messages, then choose Restart after repair or start a fresh experiment. This is the selected teaching policy, not a promise about every real vehicle."
      ],
      "steps": [
        "Choose Start this experiment, then Watch it run, and observe when the engine is requested in this low-charge lesson.",
        "Compare the current physical battery state with the latest report received by the hybrid controller.",
        "Use the fault control to stop battery status updates, then advance the simulation.",
        "Watch the report become old and read why the controller stops allowing driving effort.",
        "Choose Reconnect / restore the input, then Restart after repair to clear the teaching shutdown latch."
      ],
      "observe": [
        "A battery limit is permission, not a demand to use that much power.",
        "A held old value is different from a live measurement and different from zero.",
        "A stored shutdown condition can remain after the immediate communication problem is repaired."
      ],
      "reference": {
        "doc": "LEARNING_GUIDE",
        "heading": "5.4 Battery equivalent circuit and SOC"
      }
    },
    {
      "id": "hybrid",
      "title": "The engine and motor work together",
      "group": "Battery and hybrid drive",
      "subtitle": "Following the reason for each operating mode",
      "goal": "Explain how driver demand and battery limits change the use of engine, motor and brakes.",
      "diagram": "hybrid",
      "experiment": "phev_city",
      "tryLabel": "Follow the hybrid driving lesson",
      "question": "When the battery cannot accept more charging, where must the braking energy go?",
      "paragraphs": [
        "The hybrid supervisor coordinates the engine, electric motor and battery. It receives the driver request and checks what the other components can provide. It can request electric driving, engine assistance, or a mode that tries to preserve the battery charge.",
        "During acceleration, stored battery energy and fuel energy can become motion. During braking, the motor can act as a generator and return some motion energy to the battery. This is regenerative braking. Some energy is still lost, and the battery has limits on how much power it can accept.",
        "Friction brakes turn motion energy mainly into heat. They provide the part of the requested braking that regeneration cannot supply. A fuller battery can therefore mean less recovered energy and more friction-brake work during the same braking request.",
        "The diagram separates requests, information and energy flow. A line carrying a power value does not necessarily represent a physical harness wire. This lab uses a generic parallel-hybrid arrangement. A Toyota Prius power-split arrangement is explained separately in the reference material."
      ],
      "steps": [
        "Choose Start this experiment, then Watch it run, and read the plain-language hybrid operating mode.",
        "Choose Pause and inspect during acceleration and identify the engine and motor contributions.",
        "Continue into braking and observe whether the battery is supplying energy or receiving it.",
        "Compare with the nearly-full-battery braking lesson in the experiment list."
      ],
      "observe": [
        "The same pedal request can lead to a different decision when battery permission changes.",
        "Returned battery energy is smaller than the mechanical energy recovered because the model includes conversion losses.",
        "The motor and friction brakes must share a physically meaningful braking task."
      ],
      "reference": {
        "doc": "WORKED_CASES",
        "heading": "3. Follow power through EV, hybrid and braking states"
      }
    },
    {
      "id": "brakes",
      "title": "Why ABS watches the wheels",
      "group": "Brakes and fault practice",
      "subtitle": "Keeping a wheel from falling too far behind the vehicle",
      "goal": "Compare vehicle motion with wheel motion and see the brake controller adjust its request.",
      "diagram": "brakes",
      "experiment": "abs_split_mu",
      "tryLabel": "Try braking on unequal grip",
      "question": "Why does the controller need wheel speed as well as the driver brake request?",
      "paragraphs": [
        "A moving vehicle and a rotating wheel are related, but they are not the same thing. During hard braking a wheel can slow too much compared with the vehicle. It may slide across the road instead of rolling normally. The workbench calls this difference braking slip.",
        "The anti-lock brake controller watches the wheel-speed inputs and adjusts a brake multiplier. In this model it reduces braking on a wheel when slip becomes too large, then allows braking to build again. The multiplier is a relative command, not measured hydraulic pressure.",
        "The lesson begins with less grip on one side of the road than the other. The wheels therefore do not all respond alike. Compare each wheel with the vehicle body speed and watch which brake commands change.",
        "The lab also has a simplified yaw-assistance model. Yaw means the vehicle turning left or right around a vertical axis. The model demonstrates a feedback idea, but it does not reproduce a full vehicle stability-control system or all road conditions. Compare the supplied case carefully; it does not prove that ABS always makes every stopping distance shorter."
      ],
      "steps": [
        "Choose Start this experiment, then Watch it run, for the unequal-grip braking lesson.",
        "Choose Pause and inspect after braking begins and compare vehicle speed with each wheel speed.",
        "Inspect a wheel-speed signal and the corresponding brake multiplier.",
        "Choose Start this experiment for a fresh comparison, then use the next chapter to see what changes when a wheel signal is missing."
      ],
      "observe": [
        "A wheel turning much too slowly can be sliding while the vehicle is still moving.",
        "The controller changes individual brake commands because the wheels can have different grip.",
        "A comparison is meaningful only when starting speed, road conditions and driver request are held consistent."
      ],
      "reference": {
        "doc": "WORKED_CASES",
        "heading": "5. Compare ABS on the same split-friction surface"
      }
    },
    {
      "id": "wheel_fault",
      "title": "Turn off one wheel-speed signal",
      "group": "Brakes and fault practice",
      "subtitle": "A missing report is not a stopped wheel",
      "goal": "Distinguish a sensor failure from a physical wheel locking.",
      "diagram": "brakes",
      "experiment": "wheel_fault",
      "tryLabel": "Disconnect the front-left wheel sensor",
      "question": "What would go wrong if a missing sensor were silently displayed as a zero-speed wheel?",
      "paragraphs": [
        "Disconnect the front-left wheel-speed signal in the virtual lesson. The physical wheel remains in the vehicle model and may still be rotating. Its measured input becomes unavailable. The diagram and notes keep those two facts separate.",
        "The selected teaching policy disables both anti-lock modulation and the simplified yaw-brake assistance when that wheel input is missing. The driver brake request still produces friction braking. Losing assistance does not mean the model has removed every brake.",
        "A blank or missing sensor value must not be interpreted as a measured zero. Zero would mean the sensor successfully reported a stopped wheel. Missing means the controller does not have a usable report from that input.",
        "Reconnect the sensor and observe the measurement return. Assistance can resume when its speed and control conditions are met, while the module fault record remains part of the experiment history. Choose Start this experiment when you want to begin a new clean comparison."
      ],
      "steps": [
        "Start the wheel-sensor lesson with the vehicle already moving.",
        "Apply or keep a brake request and observe the healthy signals first.",
        "Choose Disconnect the front-left wheel sensor, then One small step.",
        "Compare the physical wheel speed, missing sensor report and changed brake-controller status.",
        "Choose Reconnect / restore the input, then Start this experiment before measuring a fresh before-and-after comparison."
      ],
      "observe": [
        "The wheel can keep rotating after its sensor signal disappears.",
        "The missing input is shown as unavailable, not as a fabricated zero.",
        "In this model friction braking continues while the selected electronic assistance is disabled."
      ],
      "reference": {
        "doc": "LEARNING_GUIDE",
        "heading": "4. What sensors and signals does each module need?"
      }
    },
    {
      "id": "diagnostics",
      "title": "Ask the computer what happened",
      "group": "Read results and go further",
      "subtitle": "Human-readable questions before message bytes",
      "goal": "Read current measurements and stored warnings in ordinary words.",
      "diagram": "ect_loop",
      "experiment": "ect_open",
      "tryLabel": "Read an engine warning",
      "question": "Does a stored warning identify the exact damaged part, or the problem the computer detected?",
      "paragraphs": [
        "A diagnostic tool asks a vehicle computer questions. Useful beginner questions are: What temperature do you currently report? Are you using a substitute value? Have you stored a warning? The workbench explains the answer before showing the underlying message representation.",
        "A stored trouble code names a condition the computer detected. It is evidence to investigate, not proof that one particular physical part must be replaced. A disconnected sensor, a broken wire or another input-circuit problem can be related to the same kind of detected condition.",
        "Current measurement, active failure and stored history are different. A repaired signal can give a normal reading while the computer still remembers the earlier fault. Clearing engine warning memory removes that record; it does not repair a connection or guarantee that every monitor has completed.",
        "Generic OBD-II mainly concerns emissions-related reporting. In this lab the engine scan questions do not automatically reveal every battery or brake-controller fault. Read those module explanations in their own lessons. The optional advanced view shows message bytes for people who want to learn the protocol later."
      ],
      "steps": [
        "Choose Start this experiment, then Watch it run, and read the explanation as the coolant-sensor fault develops.",
        "Ask for the current coolant reading and compare it with the physical temperature.",
        "Choose Read remembered engine warnings and compare the pending and stored history.",
        "Repair the sensor path, choose Clear remembered engine warnings, and check the current state again."
      ],
      "observe": [
        "An invalid reading needs its validity note, even if it is displayed as a number.",
        "Stored history can outlast the immediate fault.",
        "Engine emissions diagnostics and other vehicle-module reports have different scopes."
      ],
      "reference": {
        "doc": "PROTOCOL",
        "heading": "1. What the interface does"
      }
    },
    {
      "id": "next_steps",
      "title": "From a small lesson to a virtual vehicle",
      "group": "Read results and go further",
      "subtitle": "Add one tested boundary at a time",
      "goal": "See how the workbench can grow while keeping each change understandable.",
      "diagram": "ect_loop",
      "experiment": "engine",
      "tryLabel": "Return to the simple engine loop",
      "question": "What measurements and timing would a new controller need before it could replace this teaching block?",
      "paragraphs": [
        "A useful next step has one clear question. For example: Can a new battery model explain a measured current trace? Can a different engine controller react to the same temperature-sensor failure? Keep the surrounding experiment steady so the effect of the changed part is visible.",
        "For each new subsystem, write down what it measures, what it controls, the units, how often it updates and what happens when information is missing. Add a clear diagram and one reproducible healthy case before adding several interacting faults.",
        "The current workbench can exchange high-level driver and plant information through its supplied software interfaces. Original vehicle firmware is a later task. Such a program expects a particular processor, memory layout and hardware peripherals; a diagram or an arbitrary firmware file is not enough to run it correctly.",
        "The full theory and reference chapters remain available in the document tree, including equations, diagnostic bytes, existing software bases, Toyota examples and the firmware roadmap. The supplied EngDoc format has now been inspected. The separate native coolant worksheet lets you change a temperature and disconnect its measurement path; docs/ENGDOC_INTEGRATION.md explains its scope. It calculates a static circuit and does not replace the timed browser model or run vehicle firmware."
      ],
      "steps": [
        "Choose one component and one question to investigate.",
        "Record its inputs, outputs, units, update period and invalid-input behavior.",
        "Run a healthy baseline, change one assumption and compare the same measurements.",
        "Use the theory and reference chapters when you need the equations or implementation detail behind a result."
      ],
      "observe": [
        "A more detailed model should explain an additional behavior, not merely add more blocks.",
        "A claimed real-vehicle parameter needs a source and vehicle-version context.",
        "The PDF can explain a lesson; the browser workbench is where its interactive controls run."
      ],
      "reference": {
        "doc": "FIRMWARE_ROADMAP",
        "heading": "1. The intended extension point"
      }
    }
  ],
  "glossary": [
    {
      "term": "Sensor",
      "plain": "A part that measures something.",
      "detail": "Examples are coolant temperature and wheel speed. A sensor report may be valid, missing or unreliable; the physical part being measured can still exist."
    },
    {
      "term": "Engine computer / ECU",
      "plain": "The computer that checks inputs and requests engine actions.",
      "detail": "ECU means electronic control unit. In this lab, the engine ECU is a simplified software controller with a temperature-fault monitor."
    },
    {
      "term": "Actuator",
      "plain": "A part that carries out a control request.",
      "detail": "Examples include a brake mechanism or a motor. The requested action and the actual physical result can differ because of limits and delays."
    },
    {
      "term": "Physical model / plant",
      "plain": "The simulated engine, battery, wheels and their physical behavior.",
      "detail": "The plant changes according to equations. It is distinct from the controller that makes decisions."
    },
    {
      "term": "Signal",
      "plain": "A value or state passed from one part of the model to another.",
      "detail": "A signal can mean a measurement, a request, a permission or a status. A line on a logical diagram is not automatically a physical wire."
    },
    {
      "term": "Feedback",
      "plain": "Using the measured result to decide what to do next.",
      "detail": "The controller requests an action, the physical model responds, and a sensor reports the response. The loop repeats."
    },
    {
      "term": "Coolant",
      "plain": "The fluid represented by the engine temperature model.",
      "detail": "The lab uses one average temperature. It does not model each coolant passage, thermostat or local hot spot."
    },
    {
      "term": "Thermistor / NTC",
      "plain": "A resistor whose resistance changes with temperature.",
      "detail": "For this NTC model, warming lowers resistance. The computer measures a voltage produced by that changing resistance."
    },
    {
      "term": "Voltage",
      "plain": "An electrical difference measured between two points.",
      "detail": "The lesson sensor signal is measured relative to the sensor return. A high voltage can mean a broken sensor path in this particular circuit."
    },
    {
      "term": "Resistance",
      "plain": "How strongly a part opposes electrical current.",
      "detail": "A connected thermistor has a finite resistance. An open branch is shown as missing or invalid rather than a made-up very large reading."
    },
    {
      "term": "Current",
      "plain": "The rate of electrical charge flow.",
      "detail": "In the battery model, current flowing out supplies energy for the vehicle; current flowing in charges the battery. The display explains the direction."
    },
    {
      "term": "ADC",
      "plain": "The computer input that turns a measured voltage into digital steps.",
      "detail": "ADC means analog-to-digital converter. Finite steps cause small rounding differences even in a healthy ideal measurement."
    },
    {
      "term": "Valid / invalid",
      "plain": "Whether a measurement is usable for its stated purpose.",
      "detail": "Invalid does not mean the number must disappear. It means the learner and controller must not treat it as a reliable measurement."
    },
    {
      "term": "Unavailable",
      "plain": "No usable value is present for this signal here.",
      "detail": "A module may not be installed in the chosen lesson, or a sensor report may be missing. Unavailable is different from a measured zero."
    },
    {
      "term": "Fallback / substituted value",
      "plain": "A value the controller chooses when the normal measurement cannot be used.",
      "detail": "A substitute supports the selected failure response. It is not a fresh sensor measurement and does not change the actual physical temperature."
    },
    {
      "term": "Stale / old report",
      "plain": "Information that has not been updated recently enough.",
      "detail": "A last received battery report can remain believable while it is too old to use for current power permission."
    },
    {
      "term": "Warning / trouble code",
      "plain": "A stored name for a condition the computer detected.",
      "detail": "It helps identify a problem area. It does not by itself prove which physical part caused the condition."
    },
    {
      "term": "Battery computer / BMU",
      "plain": "The controller that reports battery condition and allowed power.",
      "detail": "BMU means battery management unit. BMS is another common battery-management name. This lab uses a simplified pack model."
    },
    {
      "term": "Charge level / SOC",
      "plain": "How full the battery is estimated to be.",
      "detail": "SOC means state of charge. It is commonly shown as a percentage; it is not the same as the battery voltage or total lifetime health."
    },
    {
      "term": "Power",
      "plain": "How quickly energy is being transferred.",
      "detail": "A power limit is a permitted rate, not a request to use all of it. Battery power, mechanical motor power and recovered braking power can differ."
    },
    {
      "term": "Contactor",
      "plain": "A controlled switch in the high-voltage power path.",
      "detail": "The lab represents its state and a simplified precharge sequence. It does not simulate relay arcs or provide physical wiring instructions."
    },
    {
      "term": "Hybrid supervisor",
      "plain": "The computer coordinating engine, motor, battery and braking requests.",
      "detail": "Its decision depends on driver demand and component permissions. This lab demonstrates a generic strategy rather than Toyota software."
    },
    {
      "term": "Regenerative braking",
      "plain": "Slowing the vehicle while returning some motion energy to the battery.",
      "detail": "The motor acts as a generator. Battery acceptance and conversion losses limit how much energy is recovered."
    },
    {
      "term": "Friction braking",
      "plain": "Slowing the vehicle by turning motion energy mainly into heat at the brakes.",
      "detail": "It supplies braking that regeneration cannot provide. In the missing wheel-sensor lesson it remains present when electronic assistance is disabled."
    },
    {
      "term": "ABS",
      "plain": "Anti-lock braking assistance.",
      "detail": "ABS compares wheel behavior with vehicle motion and changes individual brake commands to reduce excessive braking slip in the teaching model."
    },
    {
      "term": "Slip",
      "plain": "The difference between wheel rolling speed and vehicle speed during braking.",
      "detail": "A wheel turning too slowly for the vehicle speed may be sliding. The model uses a regularized ratio to express that difference."
    },
    {
      "term": "Yaw / ESC / ESP",
      "plain": "Vehicle turning motion and the assistance intended to influence it.",
      "detail": "Yaw is rotation left or right around a vertical axis. ESC and ESP are stability-control names; this lab includes only a simplified yaw-assistance demonstration."
    },
    {
      "term": "OBD-II",
      "plain": "A standard way to inspect emissions-related vehicle information.",
      "detail": "The lab includes current engine readings and engine warning memory. Other module information may require separate manufacturer-specific diagnostics in a real vehicle."
    },
    {
      "term": "CAN",
      "plain": "A communication method used by vehicle computers.",
      "detail": "The lab can display diagnostic frames and exchange them in a virtual-bus example. Physical voltage waveforms, wire faults and real bus arbitration are not modeled."
    },
    {
      "term": "Firmware",
      "plain": "The program intended to run inside a particular electronic controller.",
      "detail": "It depends on its processor and hardware environment. Running original firmware is a future integration task, not a current feature of this workbench."
    }
  ]
};
})();
