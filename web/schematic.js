/* OBD II Lab: readable, live, task-focused SVG schematics.
 * This is an inspection surface over the Python plant, not a block-diagram solver.
 * No external libraries, vehicle connection or model editor are used here.
 */
(function (global) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const W = 1100, H = 550;
  const DIAGRAMS = [
    { id: 'ect_loop', title: 'Engine ECU · signal loop', kind: 'Logical model connections' },
    { id: 'ect_circuit', title: 'Coolant sensor · electrical circuit', kind: 'Illustrative electrical circuit' },
    { id: 'hybrid', title: 'Battery + hybrid coordination', kind: 'Logical signals and power flow' },
    { id: 'brakes', title: 'ABS / ESC · wheel feedback', kind: 'Logical brake-control connections' }
  ];
  const SIGNALS = {
    'coolant_c': { label: 'Actual coolant', unit: '°C', source: 'Engine thermal plant', period: 2, description: 'The physical temperature state. It keeps evolving even if the sensor circuit is open.' },
    'sensors.ect_reference_v': { label: 'ECU reference', unit: 'V', source: 'Illustrative ECU supply', period: 10, description: 'Internal reference for the pull-up circuit. X1.1 is a teaching test point, not a Toyota connector assignment.' },
    'sensors.sensor_return_v': { label: 'Sensor return', unit: 'V', source: 'Illustrative ECU sensor return', period: 10, description: 'The reference return of this ideal circuit. Harness ground offsets and return faults are not modeled.' },
    'sensors.ect_node_v': { label: 'Harness / ADC node', unit: 'V', source: 'NTC divider circuit', period: 10, description: 'Voltage on the ECU side of the sensor open-circuit gap. An open path leaves this node pulled toward the reference supply.' },
    'sensors.ect_voltage_v': { label: 'Sampled ECT voltage', unit: 'V', source: 'Engine ECU ADC', period: 10, description: 'ADC-derived voltage. A high electrical voltage in this NTC circuit is interpreted as a very low temperature or an open-circuit fault.' },
    'sensors.ect_adc_count': { label: 'ECT ADC count', unit: 'count', source: '12-bit teaching ADC', period: 10, description: 'Quantized input code. The selected ADC has 4096 representable codes, from 0 through 4095.' },
    'sensors.ect_resistance_ohm': { label: 'NTC resistance', unit: 'Ω', source: 'Teaching NTC model', period: 10, description: 'Connected resistance calculated with an NTC beta equation. An open branch has no finite resistance value in the exported signal.' },
    'sensors.ect_current_ma': { label: 'Sensor branch current', unit: 'mA', source: 'NTC divider circuit', period: 10, description: 'Current through the pull-up and connected sensor branch. It becomes zero when the signal path opens.' },
    'sensors.ect_c': { label: 'Reported ECT', unit: '°C', source: 'Engine ECU sensor conversion', period: 10, description: 'Converted sensor reading. This teaching ECU reports −40 °C for an open circuit; that is distinct from the true coolant temperature.' },
    'sensors.ect_used_c': { label: 'Temperature used by control', unit: '°C', source: 'Engine ECU plausibility / fallback', period: 10, description: 'The controller uses an 80 °C fallback after the teaching fault debounce. This is an assumption, not an OEM fallback calibration.' },
    'sensors.accelerator_pct': { label: 'Accelerator request', unit: '%', source: 'Driver / scenario', period: 2, description: 'The driver input delivered to this model. Pedal electronics and redundant tracks are abstracted.' },
    'sensors.brake_pct': { label: 'Brake request', unit: '%', source: 'Driver / scenario', period: 2, description: 'Normalized brake demand. Hydraulic pedal hardware is outside this teaching model.' },
    'rpm': { label: 'Engine speed', unit: 'rpm', source: 'Engine plant / crank signal', period: 2, description: 'Average crankshaft speed. There are no tooth edges, cam phasing or cylinder-resolved combustion events.' },
    'engine_torque_nm': { label: 'Delivered engine torque', unit: 'N·m', source: 'Engine plant', period: 2, description: 'The modeled actual torque. The diagram shows the controller/plant relationship, not a physical wire carrying torque.' },
    'engine_shaft_kw': { label: 'Engine shaft power', unit: 'kW', source: 'Engine plant', period: 2, description: 'Mechanical shaft output. The hybrid model can allocate part of this to the idealized generator path.' },
    'engine_power_kw': { label: 'Engine wheel contribution', unit: 'kW', source: 'Generic hybrid drivetrain', period: 2, description: 'The modeled engine contribution to wheel power. This is not a Toyota power-split gear measurement.' },
    'engine_requested': { label: 'Engine run request', unit: '', source: 'Hybrid / engine supervisor', period: 20, description: 'Logical request to start or keep the mean-value engine running.' },
    'soc_pct': { label: 'Battery SOC', unit: '%', source: 'Battery plant / BMU', period: 100, description: 'Lumped-pack state of charge estimated by the teaching model. Individual cell chemistry is not simulated.' },
    'battery_voltage_v': { label: 'Pack terminal voltage', unit: 'V', source: 'Battery equivalent circuit', period: 2, description: 'Open-circuit voltage minus current times pack resistance; positive current means discharge.' },
    'battery_current_a': { label: 'Pack current', unit: 'A', source: 'Battery equivalent circuit', period: 2, description: 'Positive is discharge; negative is charging. This is a high-voltage pack model signal, not a safe physical probe instruction.' },
    'battery_power_kw': { label: 'Battery terminal power', unit: 'kW', source: 'Battery equivalent circuit', period: 2, description: 'Positive power leaves the battery terminals. Negative power enters the pack during charging.' },
    'battery_charge_limit_kw': { label: 'Allowed charge power', unit: 'kW', source: 'BMU', period: 100, description: 'Current charge acceptance based on the teaching SOC and temperature limits.' },
    'battery_discharge_limit_kw': { label: 'Allowed discharge power', unit: 'kW', source: 'BMU', period: 100, description: 'The BMU limits battery power before the plant solves voltage and current.' },
    'sensors.bmu_message_age_ms': { label: 'BMU status age', unit: 'ms', source: 'Hybrid supervisor', period: 20, description: 'Age of the last in-memory BMU status update. It is a freshness check, not a physical CAN bus timing measurement.' },
    'bmu_report.pack_voltage_v': { label: 'Last BMU voltage report', unit: 'V', source: 'Last received BMU status', period: 100, description: 'Held voltage in the last received BMU status packet. It becomes stale when updates stop; the physical battery voltage remains a separate signal.' },
    'bmu_report.pack_current_a': { label: 'Last BMU current report', unit: 'A', source: 'Last received BMU status', period: 100, description: 'Held current in the last received BMU packet. Positive current means discharge.' },
    'bmu_report.soc_pct': { label: 'Last BMU SOC report', unit: '%', source: 'Last received BMU status', period: 100, description: 'Held SOC in the last received BMU packet, distinct from the evolving physical state during a timeout.' },
    'bmu_report.charge_limit_kw': { label: 'Last BMU charge permission', unit: 'kW', source: 'Last received BMU status', period: 100, description: 'Held charge permission. A supervisor must also consider whether this status is fresh.' },
    'motor_power_kw': { label: 'Motor / regen wheel power', unit: 'kW', source: 'Motor / inverter abstraction', period: 2, description: 'Positive means traction; negative means mechanical regeneration. Electrical power differs because the conversion has losses.' },
    'regen_kw': { label: 'Regenerative braking', unit: 'kW', source: 'Brake / power allocation', period: 2, description: 'Positive mechanical braking power recovered by the motor path, before electrical conversion losses.' },
    'friction_brake_kw': { label: 'Friction brake power', unit: 'kW', source: 'Wheel / brake plant', period: 2, description: 'Mechanical power dissipated by friction brakes. It replaces regenerative braking when charge acceptance is limited.' },
    'speed_kph': { label: 'Vehicle speed', unit: 'km/h', source: 'Vehicle longitudinal plant', period: 2, description: 'The physical body speed, which differs from wheel peripheral speed during slip.' },
    'yaw_rate_deg_s': { label: 'Actual yaw rate', unit: '°/s', source: 'Reduced yaw plant', period: 2, description: 'A simplified yaw state. Lateral tire forces, sideslip and full handling dynamics are absent.' },
    'yaw_target_deg_s': { label: 'Yaw reference', unit: '°/s', source: 'Approximate ESC reference', period: 10, description: 'A steering/speed reference used only by this simplified yaw-assist lesson.' },
    'sensors.steer_deg': { label: 'Road-wheel steering', unit: '°', source: 'Driver / scenario', period: 2, description: 'Road-wheel steering angle; it is not the angle at the steering wheel.' }
  };
  ['Front-left', 'Front-right', 'Rear-left', 'Rear-right'].forEach((name, i) => {
    SIGNALS['wheel_speeds_kph.' + i] = { label: name + ' wheel speed', unit: 'km/h', source: 'Wheel plant', period: 2, description: 'True wheel peripheral speed from wheel inertia. Compare it with body speed to understand slip.' };
    SIGNALS['sensors.wheel_speeds_kph.' + i] = { label: name + ' wheel sensor', unit: 'km/h', source: 'Wheel-speed sensor', period: 10, description: 'Measured wheel speed. A missing sensor is unavailable, not a physical zero-speed wheel.' };
    SIGNALS['slips.' + i] = { label: name + ' braking slip', unit: 'ratio', source: 'Wheel plant / ABS', period: 10, description: '(Vehicle speed − wheel peripheral speed) divided by the regularized vehicle speed. Near one means an almost locked wheel.' };
    SIGNALS['brake_pressure.' + i] = { label: name + ' brake modulation', unit: 'ratio', source: 'ABS controller', period: 10, description: 'Normalized pressure multiplier. This is a modulation factor, not a hydraulic pressure in bar.' };
  });

  const STYLE = `.sch-svg{font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#f8fbfa;color:#17343f}.sch-title{font-size:18px;font-weight:650;fill:#16343e}.sch-small{font-size:13px;fill:#687f87}.sch-label{font-size:14px;fill:#47636d}.sch-value{font-size:17px;font-family:ui-monospace,Consolas,monospace;fill:#007e80;font-weight:600}.sch-dim{fill:#8a9ca2}.sch-card{fill:#fff;stroke:#bdd4cf;stroke-width:1.5}.sch-card:hover,.sch-card-group:focus .sch-card{stroke:#00898b;stroke-width:2}.sch-card-group{cursor:pointer}.sch-card-group.sch-selected .sch-card{stroke:#00898b;stroke-width:2.5;fill:#eef9f4}.sch-card-group.sch-fault .sch-card{stroke:#cf7b36;fill:#fff8ef}.sch-wire-line{fill:none;stroke:#00898b;stroke-width:2}.sch-wire-line.sch-power{stroke:#526c79;stroke-width:3.5}.sch-wire-line.sch-feedback{stroke-dasharray:6 4}.sch-wire-hit{fill:none;stroke:transparent;stroke-width:16;cursor:pointer}.sch-wire-group:focus .sch-wire-line,.sch-wire-group:hover .sch-wire-line,.sch-wire-group.sch-selected .sch-wire-line{stroke-width:3.5;stroke:#005e60}.sch-wire-group.sch-fault .sch-wire-line{stroke:#cf7b36}.sch-pin{fill:#fff;stroke:#00898b;stroke-width:2;cursor:pointer}.sch-pin:focus,.sch-pin:hover,.sch-pin.sch-selected{fill:#c8f49b;stroke:#005d60;stroke-width:3}.sch-tag{font-size:11px;fill:#6b8188;letter-spacing:.5px}.sch-node{fill:#00898b}.sch-outline{fill:#f0f6f3;stroke:#9fbcb4;stroke-width:1.5;stroke-dasharray:7 5}.sch-circuit{fill:none;stroke:#3c626b;stroke-width:2.5}.sch-component{fill:#fff;stroke:#345a65;stroke-width:2}.sch-warning{fill:#b36c25}.sch-switch{stroke:#00898b;stroke-width:3;fill:none}.sch-switch-open{stroke:#ce7933}.sch-footnote{font-size:12px;fill:#758b92}.sch-probe-label{cursor:pointer}.sch-probe-label:focus text,.sch-probe-label:hover text{fill:#005b5e}.sch-halo{paint-order:stroke;stroke:#f8fbfa;stroke-width:6px;stroke-linejoin:round}.sch-live-fault{fill:#c3712e}.sch-wheel{fill:#233e48}.sch-slip-bg{fill:#e4edeb}.sch-slip-bar{fill:#00898b}`;

  function node(tag, attrs, text) {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, String(v));
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function dom(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function read(state, path) {
    return path.split('.').reduce((v, key) => v == null ? undefined : v[key], state);
  }
  function display(value, unit) {
    if (value === null || value === undefined || (typeof value === 'number' && !Number.isFinite(value))) return '—';
    if (typeof value === 'boolean') return value ? 'ON' : 'OFF';
    if (typeof value !== 'number') return String(value);
    const digits = ['rpm', 'count', 'ms', 'Ω'].includes(unit) ? 0 : unit === 'ratio' ? 3 : unit === 'V' || unit === 'mA' ? 3 : 1;
    return value.toFixed(digits) + (unit ? ' ' + unit : '');
  }
  function bindActivate(element, fn, label) {
    element.setAttribute('tabindex', '0');
    element.setAttribute('role', 'button');
    element.setAttribute('data-sch-action', 'true');
    if (label) element.setAttribute('aria-label', label);
    element.addEventListener('click', event => { event.stopPropagation(); fn(); });
    element.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); fn(); }
    });
  }

  function init(options) {
    const container = typeof options.container === 'string' ? document.querySelector(options.container) : options.container;
    const inspector = typeof options.inspector === 'string' ? document.querySelector(options.inspector) : options.inspector;
    if (!container || !inspector) throw new Error('Schematic requires a canvas container and inspector.');
    const onProbe = options.onProbe || (() => {}), onFault = options.onFault || (() => {});
    let state = {}, diagramId = 'ect_loop', svg, scene, selected = null, focusRefresh = null;
    let live = [], faultItems = [], blockMap = {}, wireMap = {}, catalog = {}, selectionItems = [];
    let view = { x: 0, y: 0, w: W, h: H }, drag = null;
    container.classList.add('sch-shell'); inspector.classList.add('sch-inspector');
    const toolbar = dom('div', 'sch-toolbar');
    const description = dom('span', 'sch-kind', DIAGRAMS[0].kind);
    const tools = dom('div', 'sch-tools');
    const viewport = dom('div', 'sch-viewport');
    const hint = dom('p', 'sch-hint', 'Select a block or signal. Use Add to scope in the inspector. Drag empty space to pan.');
    const zoomLabel = dom('span', 'sch-zoom', '100%');
    function tool(label, text, action) { const b = dom('button', 'sch-tool', text); b.type = 'button'; b.setAttribute('aria-label', label); b.title = label; b.addEventListener('click', action); return b; }
    tools.append(tool('Zoom out', '−', () => zoom(1.25)), zoomLabel, tool('Zoom in', '+', () => zoom(.8)), tool('Fit complete diagram', 'Fit', resetView));
    toolbar.append(description, tools); container.replaceChildren(toolbar, viewport, hint);

    function meta(id) { return Object.assign({ label: id, unit: '', source: 'Simulation state', period: 2, description: 'A live value from the current model snapshot.' }, SIGNALS[id] || {}, catalog[id] || {}); }
    function uninstalled(id) {
      const m = meta(id);
      return m.profiles ? !!state.profile && !m.profiles.includes(state.profile) : state.profile === 'engine' && /^(battery_|soc_pct|motor_power_kw|regen_kw|friction_brake_kw|bmu_report\.|sensors\.bmu_|sensors\.wheel_|wheel_speeds_kph\.|slips\.|brake_pressure\.|contactor|abs_active|esp_active)/.test(id);
    }
    function signalValue(id) {
      if (uninstalled(id)) return null;
      if (['sensors.ect_c', 'sensors.ect_adc_count', 'sensors.ect_used_c'].includes(id) && !(state.sensors?.ect_powered ?? state.inputs?.ignition)) return null;
      return read(state, id);
    }
    function validity(id) {
      const value = read(state, id);
      if (uninstalled(id)) return 'NOT INSTALLED';
      if (id === 'sensors.ect_resistance_ohm' && state.sensors?.ect_circuit_open) return 'OPEN CIRCUIT';
      if (['sensors.ect_c', 'sensors.ect_adc_count', 'sensors.ect_used_c'].includes(id)) {
        if (!(state.sensors?.ect_powered ?? state.inputs?.ignition)) return 'UNPOWERED';
        if (id === 'sensors.ect_used_c' && state.ect_derate_factor < 1) return 'FALLBACK VALUE';
        if (state.sensors?.ect_sensor_valid === false) return 'INVALID SENSOR';
      }
      if (id.startsWith('sensors.wheel_speeds_kph.') && value == null) return 'SENSOR MISSING';
      if (value === undefined || value === null) return 'UNAVAILABLE';
      if (id.startsWith('bmu_report.') && (state.sensors?.bmu_message_age_ms || 0) > 300.0001) return 'STALE · HELD';
      if (id === 'sensors.bmu_message_age_ms' && value > 300.0001) return 'TIMEOUT';
      return 'LIVE';
    }
    function unit(id) { return meta(id).unit; }
    function label(x, y, text, cls = 'sch-label', attrs = {}) { const n = node('text', { x, y, class: cls, ...attrs }, text); scene.append(n); return n; }
    function path(d, cls = 'sch-circuit') { const n = node('path', { d, class: cls }); scene.append(n); return n; }
    function point(x, y) { const n = node('circle', { cx: x, cy: y, r: 4, class: 'sch-node' }); scene.append(n); return n; }
    function liveText(parent, x, y, id, cls = 'sch-value', prefix = '', formatter = null) {
      const n = node('text', { x, y, class: cls }); parent.append(n);
      live.push(() => { const value = signalValue(id); n.textContent = prefix + (value == null ? '—' : formatter ? formatter(value) : display(value, unit(id))); n.classList.toggle('sch-live-fault', !['LIVE', 'NOT INSTALLED', 'UNAVAILABLE', 'UNPOWERED'].includes(validity(id))); });
      return n;
    }
    function probe(x, y, id, caption, attrs = {}) {
      const g = node('g', { class: 'sch-probe-label', ...attrs });
      if (caption) g.append(node('text', { x, y, class: 'sch-small sch-halo' }, caption));
      liveText(g, x, y + (caption ? 22 : 0), id, 'sch-value sch-halo');
      bindActivate(g, () => chooseSignal(id), 'Inspect ' + meta(id).label);
      scene.append(g); selectionItems.push({ el: g, signal: id }); return g;
    }
    function pin(x, y, id, title) {
      const c = node('circle', { cx: x, cy: y, r: 6, class: 'sch-pin' });
      bindActivate(c, () => chooseSignal(id), title || meta(id).label); scene.append(c);
      selectionItems.push({ el: c, signal: id }); return c;
    }
    function wire(d, id, options = {}) {
      const g = node('g', { class: 'sch-wire-group' });
      const cls = 'sch-wire-line' + (options.power ? ' sch-power' : '') + (options.feedback ? ' sch-feedback' : '');
      const line = node('path', { d, class: cls, 'marker-end': options.noArrow ? '' : 'url(#sch-arrow-' + (options.power ? 'power' : 'signal') + ')' });
      g.append(line, node('path', { d, class: 'sch-wire-hit' }));
      bindActivate(g, () => chooseSignal(id), 'Inspect ' + meta(id).label);
      scene.append(g); selectionItems.push({ el: g, signal: id });
      if (options.fault) faultItems.push(() => { const fault = options.fault(state); g.classList.toggle('sch-fault', fault); if (!options.noArrow) line.setAttribute('marker-end', 'url(#sch-arrow-' + (fault ? 'fault' : options.power ? 'power' : 'signal') + ')'); });
      if (options.label) probe(options.label[0], options.label[1], id, options.label[2]);
      wireMap[id] = g; return g;
    }
    function block(id, x, y, w, h, title, detail, fields, info, options = {}) {
      const g = node('g', { class: 'sch-card-group', 'data-block-id': id });
      g.append(node('rect', { x, y, width: w, height: h, rx: 10, class: 'sch-card' }));
      g.append(node('text', { x: x + 17, y: y + 28, class: 'sch-title' }, title));
      if (detail) g.append(node('text', { x: x + 17, y: y + 49, class: 'sch-small' }, detail));
      (fields || []).forEach((f, i) => liveText(g, x + 17, y + 76 + i * 23, f.id, 'sch-value', f.prefix || '', f.formatter));
      bindActivate(g, () => chooseBlock(id), 'Inspect ' + title);
      blockMap[id] = { id, title, detail, fields, info, options };
      selectionItems.push({ el: g, block: id });
      if (options.fault) faultItems.push(() => g.classList.toggle('sch-fault', options.fault(state)));
      scene.append(g); return g;
    }
    function tag(x, y, text) { label(x, y, text, 'sch-tag'); }
    function footer(text) { label(24, 534, text, 'sch-footnote'); }
    function header(title, text) { label(25, 31, title, 'sch-title'); label(25, 52, text, 'sch-small'); }

    function ectLoop() {
      header('Coolant diagnosis: follow one value through the model', 'Green arrows carry logical values. Every displayed number comes from the same simulation state.');
      wire('M260 137 H320', 'coolant_c');
      wire('M525 137 H585', 'sensors.ect_voltage_v', { fault: s => !!s.sensors?.ect_high_input });
      wire('M815 137 H875', 'sensors.ect_c', { fault: s => !!s.sensors?.ect_high_input });
      wire('M700 200 V264 H470 V350', 'sensors.ect_used_c', { label: [493, 282, 'Control input'] });
      wire('M260 397 H355', 'sensors.accelerator_pct', { label: [269, 361, 'Pedal'] });
      wire('M585 397 H700', 'engine_torque_nm', { label: [596, 361, 'Torque response'] });
      wire('M825 350 V235 H147 V200', 'coolant_c', { feedback: true, label: [273, 249, 'Physical temperature feedback'] });
      block('thermal', 35, 85, 225, 115, 'Thermal plant', 'Heat input − cooling', [{ id: 'coolant_c' }], {
        purpose: 'Store physical heat and evolve the actual coolant temperature. Opening the sensor does not set this physical state to −40 °C.',
        inputs: 'Engine heat, ambient temperature, thermal loss.', outputs: 'Actual coolant temperature.', period: 'Plant integration: 2 ms', signals: ['coolant_c']
      });
      block('ect_sensor', 320, 85, 205, 115, 'NTC + ADC', 'Divider → sampled voltage', [{ id: 'sensors.ect_voltage_v' }], {
        purpose: 'Convert physical temperature into resistance and voltage, then sample it. The detailed electrical view shows the divider and harness cavity.',
        inputs: 'Physical coolant temperature; connected/open path.', outputs: 'Sampled voltage, ADC code and converted sensor temperature.', period: 'Engine sensor task: 10 ms', signals: ['sensors.ect_voltage_v', 'sensors.ect_adc_count', 'sensors.ect_c'], faultControl: true
      }, { fault: s => !!s.sensors?.ect_high_input });
      block('ect_validate', 585, 85, 230, 115, 'ECU validation', 'Plausibility → fallback', [{ id: 'sensors.ect_used_c' }], {
        purpose: 'Distinguish a faulty measurement from the physical temperature. The teaching policy substitutes 80 °C after 200 ms and confirms P0118 after 500 ms.',
        inputs: 'ECT measurement and its fault state.', outputs: 'Temperature used by control, pending/confirmed diagnostic state.', period: 'Engine controller task: 10 ms', signals: ['sensors.ect_c', 'sensors.ect_used_c']
      }, { fault: s => s.ect_derate_factor < 1 });
      block('obd_report', 875, 85, 190, 115, 'OBD report', '01 05 · 03 · 07', [{ id: 'sensors.ect_c' }], {
        purpose: 'Encode the reported sensor value and diagnostic memory. The reported temperature is not automatically the controller fallback or the true thermal state.',
        inputs: 'Reported ECT, diagnostic state.', outputs: 'OBD responses and ISO-TP frames in the diagnostic panel.', period: 'On diagnostic request', signals: ['sensors.ect_c']
      });
      block('driver', 35, 350, 225, 115, 'Driver / scenario', 'Accelerator request', [{ id: 'sensors.accelerator_pct' }], {
        purpose: 'Supply the reproducible input schedule or manual accelerator demand.', inputs: 'Lesson time or manual controls.', outputs: 'Accelerator demand.', period: 'Input update: 2 ms', signals: ['sensors.accelerator_pct']
      });
      block('engine_control', 355, 350, 230, 115, 'Engine controller', 'Idle / load / fault derate', [{ id: 'engine_torque_nm' }], {
        purpose: 'Use the driver demand and validated temperature to govern the mean-value engine. The displayed torque is the resulting delivered torque, not a physical voltage.',
        inputs: 'Accelerator, speed and validated/fallback temperature.', outputs: 'Mean torque response.', period: 'Engine controller: 10 ms', signals: ['engine_torque_nm', 'sensors.ect_used_c', 'rpm']
      });
      block('engine_plant', 700, 350, 250, 115, 'Engine physical model', 'Inertia · fuel · thermal state', [{ id: 'rpm' }], {
        purpose: 'Integrate crankshaft inertia and thermal energy. This model averages combustion events and keeps the engine stand at zero road speed.',
        inputs: 'Torque, dynamometer load and losses.', outputs: 'RPM, coolant temperature and shaft power.', period: 'Plant integration: 2 ms', signals: ['rpm', 'engine_shaft_kw', 'coolant_c']
      });
      footer('Logical teaching connections. Open the electrical diagram for connector cavities and the voltage-divider circuit.');
    }

    function ectCircuit() {
      header('ECT electrical circuit: source → divider → ADC → sensor conversion', 'Illustrative ECU and harness. X1 and J-ECT assignments are local teaching names, not a Toyota pinout.');
      scene.append(node('rect', { x: 34, y: 76, width: 580, height: 383, rx: 16, class: 'sch-outline' }));
      scene.append(node('rect', { x: 777, y: 300, width: 269, height: 159, rx: 14, class: 'sch-outline' }));
      tag(52, 102, 'VIRTUAL ENGINE ECU'); tag(797, 325, 'NTC SENSOR ELEMENT');
      path('M227 132 V174');
      scene.append(node('rect', { x: 214, y: 174, width: 26, height: 63, class: 'sch-component' }));
      path('M227 237 V267');
      path('M227 267 H614');
      path('M475 267 V219'); point(475, 267);
      point(227, 267);
      path('M614 267 H746');
      path('M806 267 H861 V347');
      scene.append(node('rect', { x: 849, y: 347, width: 24, height: 60, class: 'sch-component' }));
      path('M839 405 L884 349');
      path('M861 407 V431 H227');
      path('M227 431 V444 M210 444 H244 M215 450 H239 M221 456 H233');
      label(253, 191, 'R pull-up', 'sch-label'); const pullupLabel = label(253, 214, '2.2 kΩ', 'sch-title');
      const r25Label = label(887, 368, '2.5 kΩ @ 25 °C', 'sch-label'); const betaLabel = label(887, 389, 'β = 3500 K', 'sch-small');
      live.push(() => { pullupLabel.textContent = ((state.sensors?.ect_pullup_ohm ?? 2200) / 1000).toFixed(1) + ' kΩ'; r25Label.textContent = ((state.sensors?.ect_r25_ohm ?? 2500) / 1000).toFixed(1) + ' kΩ @ 25 °C'; betaLabel.textContent = 'β = ' + (state.sensors?.ect_beta_k ?? 3500) + ' K'; });
      label(554, 250, 'X1.2', 'sch-small'); label(639, 244, 'J-ECT.1', 'sch-small');
      label(552, 414, 'X1.3', 'sch-small'); label(639, 414, 'J-ECT.2', 'sch-small');
      label(636, 467, 'Harness-side cavities', 'sch-tag');
      pin(614, 267, 'sensors.ect_node_v', 'X1.2: illustrative ECU ECT input');
      pin(697, 267, 'sensors.ect_node_v', 'J-ECT.1: harness-side ECT signal');
      pin(614, 431, 'sensors.sensor_return_v', 'X1.3: illustrative sensor return');
      pin(697, 431, 'sensors.sensor_return_v', 'J-ECT.2: harness-side sensor return');
      pin(227, 132, 'sensors.ect_reference_v', 'X1.1: illustrative internal reference test point');
      label(170, 128, 'X1.1', 'sch-small'); probe(50, 145, 'sensors.ect_reference_v', 'Internal reference');
      probe(50, 325, 'sensors.ect_node_v', 'Harness / ADC node');
      probe(50, 384, 'sensors.ect_current_ma', 'Branch current');
      probe(798, 488, 'sensors.ect_resistance_ohm', 'Connected resistance');
      block('adc', 369, 100, 216, 119, 'ADC input', 'Sample → inverse NTC law', [{ id: 'sensors.ect_adc_count', prefix: '' }], {
        purpose: 'Sample the divider node with the teaching 12-bit ADC, then convert voltage back into temperature. An open signal path is diagnosed separately from normal conversion.',
        inputs: 'ADC node voltage relative to sensor return.', outputs: 'ADC count, quantized voltage and reported temperature.', period: 'Engine sensor task: 10 ms', signals: ['sensors.ect_node_v', 'sensors.ect_voltage_v', 'sensors.ect_adc_count', 'sensors.ect_c']
      }, { fault: s => !!s.sensors?.ect_high_input });
      const ntc = node('rect', { x: 835, y: 338, width: 52, height: 78, fill: '#fff', 'fill-opacity': 0 });
      bindActivate(ntc, () => chooseBlock('ntc'), 'Inspect NTC thermistor'); scene.append(ntc);
      blockMap.ntc = { title: 'NTC sensor element', info: { purpose: 'The sensor resistance falls as temperature rises. R(T) = R25 × exp[β(1/T − 1/T25)], with temperatures in kelvin. Values shown are generic teaching assumptions.', inputs: 'Actual coolant temperature.', outputs: 'Resistance and divider current.', period: 'Engine sensor task: 10 ms', signals: ['coolant_c', 'sensors.ect_resistance_ohm', 'sensors.ect_current_ma'], faultControl: true } };
      const sw = node('g', { class: 'sch-card-group' });
      sw.append(node('rect', { x: 735, y: 232, width: 83, height: 61, rx: 8, fill: '#fff', 'fill-opacity': 0 }));
      sw.append(node('circle', { cx: 746, cy: 267, r: 4, class: 'sch-component' }), node('circle', { cx: 806, cy: 267, r: 4, class: 'sch-component' }));
      const arm = node('path', { d: 'M750 267 H802', class: 'sch-switch' }); sw.append(arm);
      const switchLabel = node('text', { x: 776, y: 218, 'text-anchor': 'middle', class: 'sch-label' }, 'Connected'); sw.append(switchLabel);
      bindActivate(sw, () => chooseBlock('sensor_switch'), 'Inspect or open the sensor signal path'); scene.append(sw);
      blockMap.sensor_switch = { title: 'Sensor signal path', info: { purpose: 'This gap is after the harness-side J-ECT.1 cavity and before the NTC branch. When open, the ECU/harness node rises toward 5 V; the branch carries no current.', inputs: 'Connected or open sensor path.', outputs: 'Changed node voltage and fault detection.', period: 'Fault is applied at the next simulation step', signals: ['sensors.ect_node_v', 'sensors.ect_current_ma', 'sensors.ect_c'], faultControl: true } };
      faultItems.push(() => { const open = !!state.sensors?.ect_circuit_open; arm.setAttribute('d', open ? 'M750 267 L798 238' : 'M750 267 H802'); arm.classList.toggle('sch-switch-open', open); switchLabel.textContent = open ? 'SIGNAL OPEN' : 'Connected'; switchLabel.classList.toggle('sch-warning', open); });
      tag(357, 351, 'SENSED'); probe(357, 373, 'sensors.ect_c');
      tag(472, 351, 'CONTROL USES'); probe(472, 373, 'sensors.ect_used_c');
      footer('Probe voltage on the harness side of the open path. Sensor return is an ideal reference; cable and ground-offset models are omitted.');
    }

    function hybrid() {
      header('Hybrid coordination: permissions first, then power', 'Thin green lines are logical signals. Thick slate lines show aggregate power paths. No physical CAN wiring is implied.');
      wire('M220 132 H310', 'sensors.accelerator_pct');
      wire('M545 132 H680', 'engine_requested', { label: [558, 91, 'Engine enable'] });
      wire('M427 335 V196', 'bmu_report.pack_voltage_v', { fault: s => (read(s, 'sensors.bmu_message_age_ms') || 0) > 300.0001, label: [249, 242, 'Last received voltage'] });
      const reportStatus = label(249, 284, '', 'sch-tag');
      live.push(() => { reportStatus.textContent = state.profile === 'engine' ? 'MODULE NOT INSTALLED' : (state.sensors?.bmu_message_age_ms || 0) > 300.0001 ? 'STALE PACKET · VALUE HELD' : 'STATUS PACKET · 100 MS'; reportStatus.classList.toggle('sch-warning', (state.sensors?.bmu_message_age_ms || 0) > 300.0001); });
      probe(449, 294, 'sensors.bmu_message_age_ms', 'BMU status age');
      wire('M255 397 H310', 'battery_voltage_v');
      wire('M545 397 H680', 'battery_charge_limit_kw', { label: [554, 434, 'Charge permission'] });
      wire('M535 185 V263 H785 V320', 'motor_power_kw', { label: [592, 223, 'Motor coordination'] });
      wire('M890 121 H999 V200', 'engine_power_kw', { power: true });
      wire('M890 379 H999 V320', 'motor_power_kw', { power: true });
      wire('M141 455 V493 H785 V440', 'battery_power_kw', { power: true, label: [337, 482, 'Battery terminal power: + discharge / − charge'] });
      block('hy_driver', 30, 75, 190, 115, 'Driver', 'Requested acceleration', [{ id: 'sensors.accelerator_pct' }], { purpose: 'Request propulsion or braking. The supervisor may reduce the request because of limits, faults or battery availability.', inputs: 'Scenario or manual controls.', outputs: 'Accelerator and brake demand.', period: 'Input update: 2 ms', signals: ['sensors.accelerator_pct', 'sensors.brake_pct'] });
      block('supervisor', 310, 75, 235, 121, 'PHEV supervisor', 'Allocate / enable / inhibit', [{ id: 'mode', formatter: v => String(v || 'OFF') }], { purpose: 'Coordinate engine and electric paths using driver demand, state of charge, battery limits and freshness. The implementation is a generic parallel hybrid. The held status probes expose the communication boundary separately from the live plant.', inputs: 'Driver demand, vehicle speed, BMU permissions and status age.', outputs: 'Mode and propulsion allocation.', period: 'Hybrid supervisor: 20 ms', signals: ['sensors.bmu_message_age_ms', 'bmu_report.pack_voltage_v', 'bmu_report.soc_pct', 'engine_requested', 'motor_power_kw'] }, { fault: s => s.mode === 'FAULT' });
      block('hy_engine', 680, 65, 210, 120, 'Engine', 'Idealized variable ratio', [{ id: 'rpm' }, { id: 'engine_power_kw' }], { purpose: 'Provide mechanical power in the generic hybrid. No Prius planetary gear constraint or MG1 speed is represented here.', inputs: 'Engine enable and load allocation.', outputs: 'Shaft power and wheel contribution.', period: 'Plant: 2 ms; ECU: 10 ms', signals: ['rpm', 'engine_shaft_kw', 'engine_power_kw'] });
      block('battery', 30, 335, 225, 120, 'Battery plant', 'Lumped equivalent circuit', [{ id: 'soc_pct' }, { id: 'battery_voltage_v' }], { purpose: 'Track pack charge, voltage, current and heat. The current convention is positive discharge, negative charge.', inputs: 'Permitted electrical power demand.', outputs: 'Pack voltage, current, SOC and temperature.', period: 'Plant: 2 ms', signals: ['soc_pct', 'battery_voltage_v', 'battery_current_a', 'battery_power_kw'] });
      block('bmu', 310, 335, 235, 120, 'Battery monitor', 'Power limits / contactor', [{ id: 'contactor', formatter: v => String(v || 'OFF') }, { id: 'battery_discharge_limit_kw', prefix: 'Discharge ' }], { purpose: 'Compute available charge/discharge power and the contactor state. The BMU publishes a status packet every 100 ms. A missing update holds the last received measurements while the physical battery continues evolving.', inputs: 'Pack voltage, current, SOC, temperature and fault state.', outputs: 'Power permission, contactor state and status update.', period: 'BMU: 100 ms', signals: ['battery_charge_limit_kw', 'battery_discharge_limit_kw', 'bmu_report.pack_voltage_v', 'bmu_report.pack_current_a', 'bmu_report.charge_limit_kw'] }, { fault: s => s.contactor === 'FAULT' });
      block('motor', 680, 320, 210, 120, 'Motor / inverter', 'Average power conversion', [{ id: 'motor_power_kw' }, { id: 'battery_current_a' }], { purpose: 'Convert electrical and mechanical power with fixed teaching efficiencies. Phase currents, PWM and electrical switching are not modeled.', inputs: 'Propulsion/braking allocation and battery permission.', outputs: 'Traction/regen wheel power and pack power request.', period: 'Average plant: 2 ms', signals: ['motor_power_kw', 'battery_current_a', 'regen_kw', 'battery_power_kw'] });
      block('hy_vehicle', 925, 200, 150, 120, 'Vehicle', 'Road load', [{ id: 'speed_kph' }], { purpose: 'Integrate the body and wheel response to applied power and road forces.', inputs: 'Wheel torque, brakes, friction and grade.', outputs: 'Vehicle and wheel speed.', period: 'Plant: 2 ms', signals: ['speed_kph', 'wheel_speeds_kph.0'] });
      footer('Reference architecture only: this executable drivetrain is generic. Toyota power-split mechanics require a separate plant model.');
    }

    function brakes() {
      header('Braking task: compare wheel speed with body speed', 'The ABS multiplier is dimensionless. ESC is an approximate yaw-assist model, not validated vehicle handling.');
      wire('M235 120 H310', 'sensors.brake_pct');
      wire('M550 120 H700', 'regen_kw', { label: [567, 76, 'Brake blending'] });
      wire('M430 330 V201', 'yaw_rate_deg_s', { feedback: true, label: [443, 249, 'Measured yaw'] });
      wire('M235 390 H310', 'speed_kph');
      wire('M675 285 H637 V390 H550', 'sensors.wheel_speeds_kph.0', { feedback: true });
      wire('M550 163 H612 V260 H675', 'brake_pressure.0', { label: [40, 245, 'Front-left brake factor'] });
      wire('M612 260 V370 H675', 'brake_pressure.2');
      wire('M612 260 V220 H960 V235', 'brake_pressure.1');
      wire('M960 220 H1080 V370 H1045', 'brake_pressure.3');
      wire('M800 185 V212 H760 V235', 'regen_kw', { power: true });
      wire('M800 212 H910 V235', 'regen_kw', { power: true });
      wire('M875 450 V489 H132 V450', 'speed_kph', { power: true, label: [337, 479, 'Body speed response'] });
      block('brake_driver', 30, 70, 205, 115, 'Brake demand', 'Driver / scenario', [{ id: 'sensors.brake_pct' }], { purpose: 'Apply the same brake input when comparing ABS enabled and disabled. The repeatable split-friction lesson begins braking after one second of coasting.', inputs: 'Script or manual brake input.', outputs: 'Normalized brake demand.', period: 'Input update: 2 ms', signals: ['sensors.brake_pct'] });
      block('abs', 310, 70, 240, 131, 'ABS / yaw assist', 'Release / hold / reapply', [{ id: 'abs_active', formatter: v => 'ABS ' + (v ? 'MODULATING' : 'IDLE') }, { id: 'esp_active', formatter: v => 'Yaw assist ' + (v ? 'ACTIVE' : 'IDLE') }], { purpose: 'Reduce and reapply modeled brake pressure as braking slip changes. The optional yaw correction uses a reduced body model; lateral tire forces are absent.', inputs: 'Four measured wheel speeds, body speed, steering and yaw.', outputs: 'Four normalized brake multipliers and limited yaw correction.', period: 'Brake control: 10 ms', signals: ['brake_pressure.0', 'slips.0', 'yaw_rate_deg_s', 'yaw_target_deg_s'] }, { fault: s => s.inputs?.fault === 'wheel_fl_dropout' });
      block('blend', 700, 70, 210, 115, 'Regen + friction', 'Respect battery acceptance', [{ id: 'regen_kw', prefix: 'Regen ' }, { id: 'friction_brake_kw', prefix: 'Friction ' }], { purpose: 'Blend motor braking and friction braking. Battery acceptance, motor limits and ABS intervention restrict recovery.', inputs: 'Brake demand, speed, grip and battery limits.', outputs: 'Mechanical regeneration and friction braking.', period: 'Scheduled control plus 2 ms plant', signals: ['regen_kw', 'friction_brake_kw', 'battery_charge_limit_kw'] });
      block('body', 30, 330, 205, 120, 'Vehicle body', 'Inertia / road forces', [{ id: 'speed_kph' }, { id: 'yaw_rate_deg_s' }], { purpose: 'Vehicle speed stays nonzero when a wheel locks. Use it as the comparison for each wheel peripheral speed.', inputs: 'Tire forces, road load and reduced yaw moment.', outputs: 'Body speed and reduced yaw rate.', period: 'Plant: 2 ms', signals: ['speed_kph', 'yaw_rate_deg_s'] });
      block('wheel_sensors', 310, 330, 240, 120, 'Feedback sensors', 'Wheel speed / steering / yaw', [{ id: 'sensors.wheel_speeds_kph.0', prefix: 'FL ' }, { id: 'sensors.steer_deg', prefix: 'Steer ' }], { purpose: 'The controller sees measured values. A missing front-left wheel signal is unavailable; it does not mean the actual wheel is stopped.', inputs: 'True wheel and body states; injected dropout.', outputs: 'Measured wheel speeds and yaw/steering signals.', period: 'Brake sensor/control task: 10 ms', signals: ['sensors.wheel_speeds_kph.0', 'sensors.wheel_speeds_kph.1', 'yaw_rate_deg_s', 'sensors.steer_deg'] }, { fault: s => s.inputs?.fault === 'wheel_fl_dropout' });
      ['Front left', 'Front right', 'Rear left', 'Rear right'].forEach((name, i) => {
        const x = i % 2 ? 875 : 675, y = i < 2 ? 235 : 350;
        const g = block('wheel_' + i, x, y, 170, 100, name, '', [{ id: 'wheel_speeds_kph.' + i }], { purpose: 'One wheel has its own inertia, local friction and brake multiplier. The four-wheel order is FL, FR, RL, RR.', inputs: 'Drive/brake torque and tire reaction.', outputs: 'Wheel peripheral speed and braking slip.', period: 'Plant: 2 ms; ABS: 10 ms', signals: ['wheel_speeds_kph.' + i, 'slips.' + i, 'brake_pressure.' + i] });
        const t = node('text', { x: x + 17, y: y + 53, class: 'sch-small' }); g.append(t);
        live.push(() => { t.textContent = 'Slip ' + (100 * (read(state, 'slips.' + i) || 0)).toFixed(1) + '%'; });
      });
      footer('Logical control connections, not a manufacturer brake harness. Pressure channels are normalized factors, not physical bar.');
    }

    function render() {
      live = []; faultItems = []; blockMap = {}; wireMap = {}; selectionItems = [];
      svg = node('svg', { xmlns: NS, class: 'sch-svg', viewBox: '0 0 1100 550', width: '100%', height: '100%', tabindex: '0', role: 'img', 'aria-label': DIAGRAMS.find(d => d.id === diagramId).title });
      svg.append(node('title', {}, DIAGRAMS.find(d => d.id === diagramId).title), node('desc', {}, 'Interactive teaching schematic. Tab to a block, wire or terminal and press Enter to inspect. Plus and minus zoom. Arrow keys pan. Zero fits the diagram.'));
      const defs = node('defs');
      for (const [id, color] of [['signal', '#00898b'], ['power', '#526c79'], ['fault', '#cf7b36']]) {
        const marker = node('marker', { id: 'sch-arrow-' + id, viewBox: '0 0 10 10', refX: 8.8, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' });
        marker.append(node('path', { d: 'M0 0 L10 5 L0 10 Z', fill: color })); defs.append(marker);
      }
      const pattern = node('pattern', { id: 'sch-grid', width: 22, height: 22, patternUnits: 'userSpaceOnUse' }); pattern.append(node('circle', { cx: 1, cy: 1, r: .8, fill: '#dbe7e1' })); defs.append(pattern); svg.append(defs, node('style', {}, STYLE), node('rect', { width: W, height: H, fill: 'url(#sch-grid)' }));
      scene = node('g'); svg.append(scene); viewport.replaceChildren(svg);
      ({ ect_loop: ectLoop, ect_circuit: ectCircuit, hybrid, brakes })[diagramId]();
      svg.addEventListener('pointerdown', event => {
        if (event.button !== 0 || event.target.closest('[data-sch-action]')) return;
        drag = { x: event.clientX, y: event.clientY, view: { ...view } }; svg.setPointerCapture(event.pointerId); svg.classList.add('sch-panning');
      });
      svg.addEventListener('pointermove', event => {
        if (!drag) return; const rect = svg.getBoundingClientRect();
        view.x = drag.view.x - (event.clientX - drag.x) * drag.view.w / rect.width;
        view.y = drag.view.y - (event.clientY - drag.y) * drag.view.h / rect.height; applyView();
      });
      const end = () => { drag = null; svg.classList.remove('sch-panning'); };
      svg.addEventListener('pointerup', end); svg.addEventListener('pointercancel', end);
      svg.addEventListener('wheel', event => { if (event.ctrlKey || event.metaKey) { event.preventDefault(); zoom(event.deltaY > 0 ? 1.15 : .87); } }, { passive: false });
      svg.addEventListener('keydown', event => {
        if (event.target !== svg) return;
        if (event.key === '+' || event.key === '=') zoom(.8);
        else if (event.key === '-') zoom(1.25);
        else if (event.key === '0') resetView();
        else if (event.key === 'ArrowLeft') { view.x -= view.w * .07; applyView(); }
        else if (event.key === 'ArrowRight') { view.x += view.w * .07; applyView(); }
        else if (event.key === 'ArrowUp') { view.y -= view.h * .07; applyView(); }
        else if (event.key === 'ArrowDown') { view.y += view.h * .07; applyView(); }
        else return;
        event.preventDefault();
      });
      description.textContent = DIAGRAMS.find(d => d.id === diagramId).kind;
      resetView(); updateLive();
      chooseSignal(diagramId === 'ect_circuit' ? 'sensors.ect_node_v' : diagramId === 'hybrid' ? 'sensors.bmu_message_age_ms' : diagramId === 'brakes' ? 'slips.0' : 'sensors.ect_voltage_v');
    }

    function applyView() { svg.setAttribute('viewBox', [view.x, view.y, view.w, view.h].join(' ')); zoomLabel.textContent = Math.round(W / view.w * 100) + '%'; }
    function resetView() { view = { x: 0, y: 0, w: W, h: H }; if (svg) applyView(); }
    function zoom(factor) { const scale = Math.min(2.5, Math.max(.28, view.w / W * factor)); const nw = W * scale, nh = H * scale; view.x += (view.w - nw) / 2; view.y += (view.h - nh) / 2; view.w = nw; view.h = nh; applyView(); }
    function selectionStyle() { for (const item of selectionItems) item.el.classList.toggle('sch-selected', selected?.type === 'signal' ? item.signal === selected.id : item.block === selected?.id); }
    function chooseSignal(id) { selected = { type: 'signal', id }; selectionStyle(); renderInspector(); }
    function chooseBlock(id) { selected = { type: 'block', id }; selectionStyle(); renderInspector(); }
    function infoRow(labelText, valueText) { const row = dom('div', 'sch-info-row'); row.append(dom('span', '', labelText), dom('strong', '', valueText)); return row; }
    function addProbeButton(id, labelText) { const b = dom('button', 'sch-add-probe', labelText || '＋ Add to scope'); b.type = 'button'; b.addEventListener('click', () => onProbe(id)); return b; }
    function renderInspector() {
      inspector.replaceChildren(); focusRefresh = null;
      if (!selected) return;
      if (selected.type === 'signal') {
        const id = selected.id, m = meta(id);
        inspector.append(dom('div', 'sch-eyebrow', 'SIGNAL PROBE'), dom('h3', 'sch-inspector-title', m.label));
        const value = dom('div', 'sch-inspector-value'); const valid = dom('span', 'sch-valid');
        inspector.append(value, valid, dom('p', 'sch-inspector-copy', m.description), addProbeButton(id));
        const rows = dom('div', 'sch-info'); rows.append(infoRow('Signal ID', id), infoRow('Source', m.source), infoRow('Update', m.period ? m.period + ' ms task / plant' : 'On demand'), infoRow('Unit', m.unit || 'state')); inspector.append(rows);
        focusRefresh = () => { value.textContent = display(signalValue(id), m.unit); const v = validity(id); valid.textContent = v; valid.classList.toggle('sch-valid-warning', v !== 'LIVE'); };
      } else {
        const b = blockMap[selected.id]; if (!b) return; const info = b.info || {};
        inspector.append(dom('div', 'sch-eyebrow', 'BLOCK INSPECTOR'), dom('h3', 'sch-inspector-title', b.title), dom('p', 'sch-inspector-copy', info.purpose || b.detail || ''));
        const rows = dom('div', 'sch-info'); rows.append(infoRow('Runs at', info.period || 'Model step'), infoRow('Inputs', info.inputs || '—'), infoRow('Outputs', info.outputs || '—')); inspector.append(rows);
        if (info.signals?.length) {
          const list = dom('div', 'sch-probe-list'); const valueNodes = [];
          for (const id of info.signals) {
            const item = dom('button', 'sch-probe-choice'); item.type = 'button';
            const name = dom('span', '', meta(id).label), value = dom('strong'); item.append(name, value);
            item.addEventListener('click', () => chooseSignal(id)); list.append(item); valueNodes.push([id, value]);
          }
          inspector.append(dom('h4', 'sch-inspector-subtitle', 'Inspect a signal'), list);
          focusRefresh = () => { for (const [id, value] of valueNodes) { value.textContent = display(signalValue(id), unit(id)); value.title = validity(id); } };
        }
        if (info.faultControl) {
          const button = dom('button', 'sch-fault-button'); button.type = 'button';
          button.addEventListener('click', () => onFault(state.inputs?.fault === 'ect_open' ? 'none' : 'ect_open'));
          inspector.append(button, dom('p', 'sch-inspector-foot', 'Applies a model fault override. Advance simulated time to observe the electrical and diagnostic response.'));
          const prior = focusRefresh;
          focusRefresh = () => { if (prior) prior(); button.textContent = state.inputs?.fault === 'ect_open' ? 'Reconnect sensor path' : 'Open sensor path'; button.classList.toggle('sch-fault-open', state.inputs?.fault === 'ect_open'); };
        }
      }
      if (focusRefresh) focusRefresh();
    }
    function updateLive() { live.forEach(fn => fn()); faultItems.forEach(fn => fn()); if (focusRefresh) focusRefresh(); }
    function setState(nextState) { state = nextState || {}; updateLive(); }
    function setDiagram(id) { if (!DIAGRAMS.some(d => d.id === id)) throw new Error('Unknown schematic: ' + id); if (id === diagramId) return; diagramId = id; render(); }
    function setCatalog(items) { catalog = {}; const entries = Array.isArray(items) ? items : Object.values(items || {}); for (const item of entries) if (item.id) catalog[item.id] = { label: item.label, unit: item.unit, source: item.source, period: item.period_ms, description: item.description, profiles: item.profiles, kind: item.kind }; updateLive(); renderInspector(); }
    function exportSvg() {
      const copy = svg.cloneNode(true); copy.setAttribute('viewBox', '0 0 1100 550'); copy.setAttribute('width', '1100'); copy.setAttribute('height', '550');
      copy.append(node('metadata', {}, JSON.stringify({diagram: diagramId, profile: state.profile, scenario: state.scenario, simulation_time_s: state.t})));
      if (typeof state.t === 'number') copy.append(node('text', {x: 1075, y: 31, 'text-anchor': 'end', class: 'sch-small'}, 't = ' + state.t.toFixed(2) + ' s'));
      return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(copy);
    }
    render();
    if (options.catalog) setCatalog(options.catalog);
    return { setState, setDiagram, resetView, exportSvg, selectSignal: chooseSignal, setCatalog, getDiagram: () => diagramId };
  }
  global.Schematic = { diagrams: DIAGRAMS, init };
})(window);
