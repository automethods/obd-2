/* A diagnosis is an operation on the shared vehicle session, not another run. */
(function (global) {
  'use strict';
  const CASES = [
    {id:'ect', title:'Coolant sensor circuit', group:'Engine ECU', code:'P0118', component:'coolant_sensor', socket:'coolant_socket', connection:'ect', profiles:['engine','phev','braking'], sample:.6,
      summary:'Trace the temperature measurement from the thermistor to the ECU, then verify the repair.',
      path:['Coolant temperature','NTC & connector','ECU input & P0118'],
      watch:['coolant_c','sensors.ect_c','sensors.ect_voltage_v','sensors.ect_used_c'],
      legacy:'ect_open'},
    {id:'dlc', title:'Scan tool connection', group:'Diagnostic connector', code:'No reply', component:'dlc', socket:'dlc_socket', connection:'dlc', profiles:['engine','phev','braking'], sample:.2,
      summary:'Check the tester CAN branch. Vehicle control and the diagnostic connection are separate paths.',
      path:['Scan tool request','DLC pins 6 & 14','Engine ECU reply'],
      watch:['rpm','speed_kph'], legacy:null},
    {id:'bmu', title:'Battery message timeout', group:'Electric / hybrid drive', code:'BMU_STATUS_TIMEOUT', component:'bmu', socket:'bmu_socket', connection:'bmu', profiles:['phev','braking'], sample:.6,
      summary:'Compare the physical battery with its last received report and check the supervisor’s timeout.',
      path:['Battery monitor','Status message age','Traction permission'],
      watch:['battery_voltage_v','bmu_report.pack_voltage_v','sensors.bmu_message_age_ms','motor_power_kw'], legacy:'bmu_timeout'},
    {id:'wheel_fl', title:'Front-left wheel sensor', group:'ABS / braking', code:'ABS_WHEEL_FL_SIGNAL', component:'wheel_fl', socket:'wheel_fl_socket', connection:'wheel_fl', profiles:['phev','braking'], sample:.2,
      summary:'Separate the turning wheel from the sensor measurement used by the brake controller.',
      path:['Physical wheel','Speed signal wire','ABS / yaw assist'],
      watch:['wheel_speeds_kph.0','sensors.wheel_speeds_kph.0','speed_kph'], legacy:'wheel_fl_dropout'}
  ];
  const byId = id => CASES.find(item => item.id === id) || CASES[0];
  const esc = value => global.AppModel?.escape ? global.AppModel.escape(String(value ?? '')) : String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const at = (state,path) => global.AppModel?.valueAt ? global.AppModel.valueAt(state,path) : path.split('.').reduce((value,key) => value == null ? undefined : value[key], state);
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const fixed = (value, digits=1) => finite(value) ? value.toFixed(digits) : '—';
  const diagnosticOf = result => result?.diagnostic || result || null;
  const replyBytes = diagnostic => String(diagnostic?.response_hex || '').trim().split(/\s+/).filter(Boolean).map(byte => parseInt(byte,16));
  const metric = (label,value,unit,source,tone='') => ({label,value,unit,source,tone});
  const hasEngine = state => !state?.vehicle?.configuration || state.vehicle.configuration.powertrain!=='bev';
  function caseInstalled(item,state) {
    const configuration=state?.vehicle?.configuration;
    if(!configuration)return item.profiles.includes(state.profile||'phev');
    if(item.id==='ect')return hasEngine(state);
    if(item.id==='bmu')return ['hev','phev','bev'].includes(configuration.powertrain);
    if(item.id==='wheel_fl')return !!configuration.abs_installed;
    return true;
  }
  function restartAllowed(state) {return !state?.vehicle || Math.abs(state.signed_speed_kph??state.speed_kph??0)<=1&&['P','N'].includes(state.vehicle.selector);}

  function evaluateCase(id, state={}, diagnostic=null) {
    const item=byId(id), sensors=state.sensors || {}, connected=(state.effective_connections || state.connections || {})[item.connection] !== false;
    const installed=caseInstalled(item,state), ignition=state.vehicle?state.vehicle.ignition!=='off':state.inputs?.ignition !== false;
    const stored=state.dtcs || [], pending=state.pending_dtcs || [], module=state.module_dtc || {};
    const out={id:item.id,installed,connected,ignition,phase:'Ready to test',tone:'',active:false,recovered:false,memory:[],metrics:[],next:'Disconnect the selected circuit to introduce a controlled fault.',clearAllowed:false};
    if (!installed) return {...out,phase:'Not installed',next:state.vehicle?'This hardware is not fitted. Open Cockpit → Vehicle configuration to choose a compatible vehicle or add ABS.':'This system is not installed in the selected model. Choose a vehicle profile that includes it.'};
    if (id === 'ect') {
      out.active=!connected || !!sensors.ect_high_input;
      out.recovered=connected && sensors.ect_sensor_valid === true && !sensors.ect_high_input;
      out.memory=stored.filter(code=>code==='P0118');
      out.clearAllowed=out.recovered && out.memory.length>0;
      out.phase=!ignition?'Ignition off':!connected?(stored.includes('P0118')?'Fault confirmed':pending.includes('P0118')?'Pending fault':'Circuit open'):!out.recovered?'Awaiting sample':out.memory.length?'Repaired · code retained':'Reading valid';
      out.tone=out.active?'warning':out.recovered?'good':'';
      out.metrics=[metric('Physical coolant',fixed(state.coolant_c),'°C','Engine thermal state'),metric('ECU temperature',fixed(sensors.ect_c),'°C',sensors.ect_sensor_valid?'Sensor measurement':'Invalid / unavailable measurement',sensors.ect_sensor_valid?'':'warning'),metric('ECU input',fixed(sensors.ect_voltage_v,3),'V','ADC sampled voltage',sensors.ect_high_input?'warning':''),metric('Control temperature',fixed(sensors.ect_used_c),'°C',pending.includes('P0118')?'Substituted fallback':'Value used by the controller')];
      out.next=!ignition?'Switch ignition on in the driver controls, then sample the circuit.':!connected?'Sample for 0.6 s to observe high input, fallback and confirmation. Compare physical coolant with the invalid reported value before reconnecting.':!out.recovered?'The connector is connected. Sample again so the ECU can acquire a fresh reading.':out.memory.length?'The sensor reading is valid again. Read the retained code and freeze frame, then clear emissions memory.':'Compare the valid reading with physical coolant, or disconnect J-ECT to begin the test.';
    } else if (id === 'dlc') {
      const d=diagnosticOf(diagnostic), bytes=replyBytes(d), rpm=bytes[0]===0x41&&bytes[1]===0x0c&&bytes.length>=4?(bytes[2]*256+bytes[3])/4:null;
      out.active=!connected;out.recovered=connected;
      out.phase=connected?'CAN branch connected':'Tester branch isolated';out.tone=connected?'good':'warning';
      out.metrics=[metric('Diagnostic branch',connected?'Connected':'Open','','CAN pair · DLC pins 6 & 14',connected?'':'warning'),metric('Vehicle speed',fixed(state.speed_kph),'km/h','Physical vehicle continues'),metric('DLC supply', state.vehicle?fixed(state.vehicle.low_voltage_v):'12.6','V',state.vehicle?'Vehicle low-voltage reference':'Fixed low-voltage reference'),metric('Last RPM reply',rpm===null?'—':fixed(rpm,0),'rpm',!hasEngine(state)?'No combustion ECU in this configuration':d?.sample_t!=null?`Request sampled at ${fixed(d.sample_t,2)} s`:'Use Read RPM to request a value',rpm===null&&d?'warning':'')];
      out.next=!hasEngine(state)?'The diagnostic socket is fitted, but this battery-electric configuration has no combustion ECU or RPM service. Inspect its CAN pins and connection; use the scan tool to inspect supported modules.':connected?'Read RPM to verify a delivered reply. Disconnect the CAN branch and repeat; advancing the vehicle remains possible.':'Send Read RPM to observe the timeout. Reconnect the branch, then send the request again to verify communication.';
    } else if (id === 'bmu') {
      const age=sensors.bmu_message_age_ms, fresh=finite(age)&&age<=300.0001;
      out.active=ignition&&(!connected || !fresh || state.contactor==='FAULT');out.recovered=ignition&&connected&&fresh&&state.contactor==='CLOSED';
      out.memory=(module.PHEV_ECU || []).filter(code=>code==='BMU_STATUS_TIMEOUT');
      out.phase=!ignition?'Ignition off':!connected?(fresh?'Branch open · last report held':'Report stale'):state.contactor==='FAULT'?'Shutdown latched':out.recovered?'Fresh · traction enabled':'Waiting for readiness';out.tone=out.active?'warning':out.recovered?'good':'';
      out.metrics=[metric('Physical battery',fixed(state.battery_voltage_v),'V','Current plant voltage'),metric('Received report',fixed(state.bmu_report?.pack_voltage_v),'V',fresh?'Most recent BMU message':'Held last report · stale',fresh?'':'warning'),metric('Report age',fixed(age,0),'ms','Supervisor freshness monitor',fresh?'':'warning'),metric('Traction contactor',String(state.contactor || '—'),'','Readiness / shutdown state',state.contactor==='FAULT'?'warning':'')];
      out.next=!ignition?'Switch ignition on and enable READY in Cockpit before testing message freshness.':!connected?'Sample for 0.6 s. The report age should exceed the 300 ms timeout while physical battery values remain observable.':state.contactor==='FAULT'?state.vehicle?'Messages can recover before traction does. Stop the vehicle, hold the foot brake and select P or N; then use Restart READY to cycle ignition and request traction again.':'Messages can recover before traction does. With the branch connected, cycle ignition to release the modeled shutdown latch.':out.recovered?'The report is fresh and traction is enabled. The recorded module event remains in this run.':state.vehicle&&!state.vehicle.ready&&state.vehicle.start_state==='ignition_on'?'Ignition powers the units. Enable READY in Cockpit, then sample to verify a fresh report and a CLOSED contactor.':'Sample again to let status publication and precharge complete. Verify a fresh report and a CLOSED contactor.';
    } else {
      const measured=sensors.wheel_speeds_kph?.[0], physical=state.wheel_speeds_kph?.[0];
      out.active=ignition&&(!connected || !finite(measured));out.recovered=ignition&&connected&&finite(measured);
      out.memory=(module.ABS_ESP || []).filter(code=>code==='ABS_WHEEL_FL_SIGNAL');
      out.phase=!ignition?'Ignition off':!connected?'Wheel measurement lost':out.recovered?'Measurement restored':'Awaiting sample';out.tone=out.active?'warning':out.recovered?'good':'';
      out.metrics=[metric('Physical FL wheel',fixed(physical),'km/h','Wheel rotation in the plant'),metric('Measured FL wheel',fixed(measured),'km/h',finite(measured)?'Brake controller input':'No measurement · not zero',finite(measured)?'':'warning'),metric('Vehicle speed',fixed(state.speed_kph),'km/h','Body motion'),metric('Brake controller',String(state.module_status?.ABS_ESP || '—'),'','Current module state',out.active?'warning':'')];
      out.next=!ignition?'Switch ignition on to power the brake controller and wheel sensors.':!connected?'Sample the open circuit, then compare the physical wheel with the missing measurement. ABS and yaw assist lose this required input.':'Verify the measured wheel follows the physical wheel again. A recorded module event can remain after signal recovery.';
    }
    return out;
  }

  function selectionTarget(selection, catalog={}, signals=[]) {
    const resolved=global.AppModel?.resolveSelection?.(selection,catalog,signals);
    let id=resolved?.componentId;
    const [kind,key]=String(selection || '').split(':');
    if(!id && (kind==='socket'||kind==='pin'))id=catalog.sockets?.find(s=>s.id===key)?.component_id;
    if(!id && kind==='wire'){const socket=catalog.wires?.find(w=>w.id===key)?.from?.socket_id;id=catalog.sockets?.find(s=>s.id===socket)?.component_id;}
    if(!id && kind==='signal'){
      const wheel=key.match(/(?:wheel_speeds_kph|slips|brake_pressure)\.([0-3])$/);
      if(wheel)id='wheel_'+['fl','fr','rl','rr'][Number(wheel[1])];
      else if(/ect|coolant|sensor_return/.test(key))id='coolant_sensor';
      else if(/bmu/.test(key))id='bmu';
      else if(/battery|soc|cell_/.test(key))id='battery';
    }
    if(!id)id=kind==='component'?key:String(selection || 'overview');
    return {id,label:catalog.components?.find(c=>c.id===id)?.label || (id==='overview'?'Whole vehicle':resolved?.label || id)};
  }
  function caseForSelection(selection, catalog, signals) {
    const component=selectionTarget(selection,catalog,signals).id;
    const map={coolant_sensor:'ect',engine:'ect',ecu:'ect',dlc:'dlc',scan_tool:'dlc',battery:'bmu',bmu:'bmu',supervisor:'bmu',abs:'wheel_fl',wheel_fl:'wheel_fl',wheel_fr:'wheel_fl',wheel_rl:'wheel_fl',wheel_rr:'wheel_fl'};
    if (map[component]) return map[component];
    const value=String(selection || '');
    if (/ect|coolant/.test(value)) return 'ect';
    if (/dlc|scan_socket/.test(value)) return 'dlc';
    if (/bmu|battery|supervisor/.test(value)) return 'bmu';
    if (/wheel_|abs_socket/.test(value)) return 'wheel_fl';
    return null;
  }

  function create(container, options={}) {
    let ctx={}, selected='ect', previousSelection=null, pending=false, visible=true, disposed=false, lastReply=null, lastReplySource=null, definitionsKey='', localNotice='', localError=false;
    container.classList.add('dg-root');
    container.innerHTML=`<header class="dg-heading"><div><h2>Diagnosis</h2><p>Test a circuit, follow the evidence and verify the repair.</p></div><div class="dg-memory-summary" aria-label="Diagnostic memory"><span data-dg="scanner-brief" hidden></span><span data-dg="stored-count">0 stored</span><span data-dg="pending-count">0 pending</span></div></header>
      <div class="dg-layout"><aside class="dg-cases" aria-label="Diagnostic tests"><div class="dg-list-heading">Available tests <span data-dg="available-count">4</span></div>${CASES.map(item=>`<button type="button" class="dg-case" data-dg-case="${item.id}" aria-pressed="${item.id==='ect'}"><span class="dg-case-group">${esc(item.group)}</span><strong>${esc(item.title)}</strong><span class="dg-case-foot"><code>${esc(item.code)}</code><span data-dg-case-status="${item.id}">Ready</span></span></button>`).join('')}<p class="dg-list-note">These tests act on the current vehicle. Selecting a test keeps the run and its history.</p></aside>
      <section class="dg-detail" aria-label="Selected diagnostic procedure"><header class="dg-case-heading"><div><span class="dg-eyebrow" data-dg="case-group"></span><h3 data-dg="case-title"></h3><p data-dg="case-summary"></p></div><span class="dg-phase" data-dg="phase"></span></header>
        <div class="dg-context-notice" data-dg="scanner-prerequisite" hidden><p data-dg="scanner-message"></p><button type="button" data-dg-action="scanner">Open scan tool</button></div>
        <div class="dg-context-notice" data-dg="context-notice" hidden><p data-dg="context-message"></p><button type="button" data-dg-action="use-test">Use this test</button></div>
        <ol class="dg-path" data-dg="path" aria-label="Signal path"></ol>
        <div class="dg-metrics" data-dg="metrics"></div>
        <div class="dg-next"><span>Next check</span><p data-dg="next"></p></div>
        <div class="dg-procedure" role="group" aria-label="Test procedure"><div><span class="dg-step">1</span><strong>Introduce a fault</strong><button type="button" data-dg-action="disconnect">Disconnect</button></div><div><span class="dg-step">2</span><strong>Observe the effect</strong><button type="button" data-dg-action="sample">Sample +0.6 s</button></div><div><span class="dg-step">3</span><strong>Repair the path</strong><button type="button" data-dg-action="repair">Reconnect</button></div><div><span class="dg-step">4</span><strong>Verify recovery</strong><button type="button" data-dg-action="verify">Verify readings</button></div></div>
        <div class="dg-context-actions"><button type="button" data-dg-action="graph">Graph these signals</button><button type="button" data-dg-action="wiring">Open connector</button><button type="button" data-dg-action="location">Show location</button><button type="button" data-dg-action="cycle" hidden>Cycle ignition</button></div>
        <div class="dg-notice" data-dg="notice" role="status" hidden></div>
        <section class="dg-evidence"><div class="dg-evidence-head"><h4 data-dg="evidence-title">Diagnostic evidence</h4><div><button type="button" data-dg-action="read">Read stored codes</button><button type="button" data-dg-action="clear">Clear retained code</button></div></div><div data-dg="evidence"></div><p class="dg-small" data-dg="evidence-note"></p>
          <details class="dg-freeze" data-dg="freeze-section"><summary>Freeze frame <span data-dg="freeze-time">Not captured</span></summary><div data-dg="freeze"></div></details>
        </section>
        <details class="dg-requests"><summary>Other ECU requests <span>OBD / UDS</span></summary><form class="dg-request-form"><label>Request example<select data-dg="service" aria-label="ECU request example"><option value="">Custom request</option></select></label><label>CAN address<select data-dg="address"><option value="7DF">7DF · functional OBD</option><option value="7E0">7E0 · engine ECU</option></select></label><label>Application bytes<input data-dg="payload" value="01 0C" placeholder="01 0C" autocomplete="off" spellcheck="false" maxlength="50"></label><button type="submit" data-dg-action="send">Send request</button></form><p class="dg-small" data-dg="service-note">Only the engine ECU exposes diagnostic services in this model.</p></details>
        <section class="dg-last-request" aria-label="Last diagnostic result"><div><h4>Last ECU request</h4><span data-dg="reply-time">No request sent</span></div><p data-dg="reply-meaning">Use Read stored codes or choose an ECU request above.</p><dl><div><dt>Request</dt><dd><code data-dg="request-bytes">—</code></dd></div><div><dt>Reply</dt><dd><code data-dg="reply-bytes">—</code></dd></div></dl><p class="dg-small">Messages below show the delivered CAN frames and byte details for each request.</p></section>
      </section></div>`;
    const $ = name => container.querySelector(`[data-dg="${name}"]`);
    const action = name => container.querySelector(`[data-dg-action="${name}"]`);
    const setText=(name,value)=>{const node=$(name);if(node.textContent!==String(value ?? ''))node.textContent=String(value ?? '');};
    const listen=[];
    function on(node,event,fn){node.addEventListener(event,fn);listen.push([node,event,fn]);}
    function context(){return evaluateCase(selected,ctx.state,lastReply);}
    function contextBinding(){
      const target=selectionTarget(ctx.selection,ctx.catalog,ctx.signals);
      const compatible={ect:['coolant_sensor','engine','ecu'],dlc:['dlc','scan_tool'],bmu:['battery','bmu','supervisor'],wheel_fl:['wheel_fl','abs']}[selected].includes(target.id);
      return {...target,compatible};
    }
    function locked(){return pending || !!ctx.busy;}
    function selectCase(id, notify=true) {
      if(!CASES.some(item=>item.id===id))return;
      selected=id;localNotice='';localError=false;render();
      if(notify)options.onSelect?.(byId(id).component);
    }
    async function execute(label, fn) {
      if(locked()||disposed)return;
      pending=true;localError=false;localNotice=label;render();
      try {await fn(); if(localNotice===label)localNotice='';}
      catch(error){localError=true;localNotice=error?.message || String(error);}
      finally{pending=false;if(!disposed)render();}
    }
    async function request(payload,canId='7DF') {
      if(!hasEngine(ctx.state))throw new Error('This vehicle has no combustion ECU. Inspect supported modules in the scan tool.');
      const normalized=String(payload || '').trim().toUpperCase().replace(/\s+/g,' ');
      if(!/^(?:[0-9A-F]{2})(?: [0-9A-F]{2}){0,6}$/.test(normalized))throw new Error('Enter 1–7 hexadecimal bytes, separated by spaces.');
      if(normalized==='04' && !evaluateCase('ect',ctx.state).recovered)throw new Error('Reconnect the coolant circuit and acquire a valid sample before clearing its retained code.');
      const answer=await options.onRequest?.(normalized,canId), d=diagnosticOf(answer);
      if(d && typeof d==='object')lastReply={...d,sample_t:d.sample_t ?? answer?.state?.t ?? ctx.state?.t};
      renderReply();return lastReply;
    }
    async function runAction(name) {
      const item=byId(selected), current=context();
      if(name==='scanner'){options.onNavigate?.('scan');return;}
      if(name==='use-test'){selectCase(selected,true);return;}
      if(name==='graph'){item.watch.forEach(id=>options.onWatch?.(id,true));options.onSelect?.(item.component);options.onNavigate?.(ctx.state?.vehicle?'signals':'live');return;}
      if(name==='wiring'){options.onSelect?.('socket:'+item.socket);options.onNavigate?.('wiring');return;}
      if(name==='location'){options.onSelect?.(item.component);options.onNavigate?.('locations');return;}
      if(!current.installed || !contextBinding().compatible)return;
      if(name==='disconnect')return execute('Disconnecting the selected circuit…',async()=>{await options.onConnection?.(item.connection,false);localNotice='Circuit disconnected. Sampling advances the same vehicle and lets its controllers react.';});
      if(name==='sample')return execute('Sampling the current vehicle…',async()=>{await options.onAdvance?.(item.sample);localNotice=`Advanced ${item.sample.toFixed(1)} s. The evidence above comes from the resulting vehicle state.`;});
      if(name==='repair')return execute('Reconnecting the selected circuit…',async()=>{await options.onConnection?.(item.connection,true);if(item.legacy && ctx.state?.inputs?.fault===item.legacy)await options.onInputs?.({fault:'none'});localNotice='Path reconnected. Verify recovery to acquire fresh measurements; stored diagnostic memory is retained.';});
      if(name==='verify')return execute('Checking recovery…',async()=>{
        if(item.id==='dlc'&&hasEngine(ctx.state)){await request('01 0C');localNotice=lastReply?.response_hex?'The ECU returned an RPM response. Inspect its bytes in Messages.':'No reply was delivered. Check the diagnostic CAN branch and request again.';}
        else if(item.id==='dlc'){await options.onAdvance?.(.2);localNotice='The physical diagnostic branch was sampled. This vehicle has no combustion ECU, so an engine RPM reply is not expected.';}
        else{await options.onAdvance?.(item.id==='bmu'?1:.2);const updated=evaluateCase(item.id,ctx.state);localNotice=updated.recovered?'Recovery observed in the current measurement. Recorded diagnostic memory may still remain.':'Recovery is not yet established. Follow the current evidence and Next check above.';}
      });
      if(name==='read')return execute('Sending a diagnostic request…',async()=>{await request(item.id==='dlc'?'01 0C':'03');});
      if(name==='clear')return execute('Clearing retained emissions memory…',async()=>{if(!evaluateCase('ect',ctx.state).clearAllowed)throw new Error('A valid repaired coolant reading and a retained emissions code are required.');await request('04');localNotice='Emissions memory and its freeze frame were cleared. The repaired circuit is still connected.';});
      if(name==='cycle')return execute('Cycling the simulated ignition…',async()=>{if(!current.connected)throw new Error('Reconnect the battery message path before cycling ignition.');
        if(ctx.state?.vehicle){if(!restartAllowed(ctx.state))throw new Error('Stop the vehicle, hold the foot brake and select P or N before restarting READY.');if(typeof options.onControl!=='function')throw new Error('The driver control callback is unavailable. Use Cockpit to cycle ignition and request READY.');await options.onControl('ignition',false);await options.onAdvance?.(.2);await options.onControl('ignition',true);await options.onControl('start');await options.onAdvance?.(1);localNotice='Ignition was cycled and READY requested. Check the fresh battery report and CLOSED contactor above.';}
        else{await options.onInputs?.({ignition:false});await options.onAdvance?.(.2);await options.onInputs?.({ignition:true});await options.onAdvance?.(1);localNotice='Ignition was off for 0.2 s, then on for 1.0 s. Check report freshness and contactor readiness above.';}});
    }
    on(container,'click',event=>{
      const caseButton=event.target.closest?.('[data-dg-case]');if(caseButton){selectCase(caseButton.dataset.dgCase);return;}
      const button=event.target.closest?.('[data-dg-action]');if(!button||button.disabled||button.dataset.dgAction==='send')return;
      runAction(button.dataset.dgAction);
    });
    on(container.querySelector('.dg-request-form'),'submit',event=>{event.preventDefault();if(contextBinding().compatible&&hasEngine(ctx.state))execute('Sending ECU request…',()=>request($('payload').value,$('address').value));});
    on($('service'),'change',()=>{
      const service=ctx.definitions?.services?.find(s=>s.id===$('service').value);
      if(service){$('payload').value=service.request_hex;$('address').value=service.can_id;setText('service-note',`${service.protocol} · ${service.note || ''}`);}
      else setText('service-note','Custom application request to the lab engine ECU. OBD supports 7DF / 7E0; UDS uses 7E0.');
    });
    function renderDefinitions(){
      const services=ctx.definitions?.services || [], key=services.map(s=>s.id+':'+s.name).join('|');
      if(key===definitionsKey)return;definitionsKey=key;const previous=$('service').value;
      $('service').innerHTML='<option value="">Custom request</option>'+services.map(s=>`<option value="${esc(s.id)}">${esc(s.protocol+' · '+s.name)}</option>`).join('');
      if(services.some(s=>s.id===previous))$('service').value=previous;
    }
    function renderReply(){
      if(!lastReply){setText('reply-time','No request sent');setText('reply-meaning','Use Read stored codes or choose an ECU request above.');setText('request-bytes','—');setText('reply-bytes','—');return;}
      const d=lastReply;
      setText('reply-time',finite(d.sample_t)?`Sampled at ${d.sample_t.toFixed(2)} s`:'Last completed request');
      setText('reply-meaning',d.error || d.meaning || (d.response_hex?'The ECU returned an application reply.':'No application reply was delivered.'));
      setText('request-bytes',d.request_hex || '—');setText('reply-bytes',d.response_hex || 'No reply');
      container.querySelector('.dg-last-request').classList.toggle('dg-no-reply',!d.response_hex);
    }
    function render(){
      if(disposed)return;const state=ctx.state || {}, item=byId(selected), current=context(), binding=contextBinding(), isLocked=locked(), canMutate=!isLocked&&current.installed&&binding.compatible;
      setText('stored-count',`${(state.dtcs || []).length} stored`);setText('pending-count',`${(state.pending_dtcs || []).length} pending`);
      const scanner=ctx.scanner||ctx.result?.scanner,scanReady=scanner?.connected&&scanner?.status==='ready'&&scanner?.module_id==='ecu';
      $('scanner-brief').hidden=!state.vehicle;setText('scanner-brief','Scan: '+(scanner?.status||'disconnected').replaceAll('_',' '));
      $('scanner-prerequisite').hidden=!state.vehicle||scanReady||!hasEngine(state)&&!!scanner?.connected;
      const scanReason=scanner?.reason||'Connect the virtual scan tool before requesting data.';
      setText('scanner-message','Scan tool: '+scanReason+(hasEngine(state)?' In Scan tool, select Engine ECU and matching CAN settings before Read codes or Read RPM.':' The scan tool can inspect supported modules; this vehicle has no combustion ECU.'));
      action('scanner').disabled=isLocked;
      setText('available-count',CASES.filter(test=>caseInstalled(test,state)).length);
      container.querySelectorAll('[data-dg-case]').forEach(button=>{const id=button.dataset.dgCase, status=evaluateCase(id,state,lastReply);button.classList.toggle('active',id===selected);button.setAttribute('aria-pressed',String(id===selected));button.classList.toggle('dg-case-warning',status.installed&&status.active);const node=container.querySelector(`[data-dg-case-status="${id}"]`);node.textContent=!status.installed?'Not installed':status.active?'Fault active':status.memory.length?'Memory stored':'Available';});
      setText('case-group',item.group);setText('case-title',item.title);setText('case-summary',item.summary);setText('phase',current.phase);$('phase').className='dg-phase '+(current.tone?'dg-'+current.tone:'');
      $('context-notice').hidden=binding.compatible;
      setText('context-message',selected==='wheel_fl'?`The executable wheel test uses the front-left sensor. ${binding.label} is currently selected.`:`This procedure tests ${item.title.toLowerCase()}. ${binding.label} is currently selected. Select this test’s component to use its controls.`);
      action('use-test').textContent=selected==='wheel_fl'?'Select front-left test':'Use this test';action('use-test').disabled=isLocked;
      const path=item.path.map((label,i)=>`<li><span>${i+1}</span>${esc(item.id==='dlc'&&i===2&&!hasEngine(state)?'Configured modules':label)}</li>`).join('');if($('path').innerHTML!==path)$('path').innerHTML=path;
      $('metrics').innerHTML=current.installed?current.metrics.map(m=>`<article class="dg-metric ${m.tone?'dg-'+m.tone:''}"><span>${esc(m.label)}</span><strong>${esc(m.value)} <small>${esc(m.unit)}</small></strong><p>${esc(m.source)}</p></article>`).join(''):'<div class="dg-unavailable">This system is not installed in the selected model.</div>';
      setText('next',current.next);
      action('disconnect').disabled=!canMutate||!current.connected;
      action('sample').disabled=!canMutate;action('sample').textContent=`Sample +${item.sample.toFixed(1)} s`;
      action('repair').disabled=!canMutate||current.connected;
      action('verify').disabled=!canMutate;action('verify').textContent=selected==='dlc'&&hasEngine(state)?'Request & verify':'Sample & verify';
      action('cycle').hidden=selected!=='bmu';action('cycle').disabled=!canMutate||!current.connected||!restartAllowed(state);action('cycle').textContent=state.vehicle?'Restart READY':'Cycle ignition';action('cycle').title=restartAllowed(state)?'Cycle ignition and verify traction readiness':'Stop, hold the foot brake and select P or N first';
      action('read').hidden=!['ect','dlc'].includes(selected);action('read').disabled=!canMutate||!hasEngine(state);action('read').textContent=selected==='dlc'?'Read RPM':'Read stored codes';action('read').title=hasEngine(state)?'':'No combustion ECU is fitted in this vehicle';
      action('clear').hidden=selected!=='ect';action('clear').disabled=!canMutate||!current.clearAllowed;
      action('send').disabled=isLocked||!binding.compatible||!hasEngine(state);action('graph').disabled=!current.installed;action('wiring').disabled=!current.installed;action('location').disabled=!current.installed;
      const service=ctx.definitions?.services?.find(entry=>entry.id===$('service').value);setText('service-note',!hasEngine(state)?'No combustion ECU is fitted in this configuration. Use the scan tool for supported module information.':service?`${service.protocol} · ${service.note || ''}`:'Only the engine ECU exposes these OBD / UDS services in this model.');
      $('notice').hidden=!localNotice;setText('notice',localNotice);$('notice').classList.toggle('dg-error',localError);
      setText('evidence-title',selected==='ect'?'ECU diagnostic memory':selected==='dlc'?'Connection evidence':'Module evidence');
      if(selected==='ect'){
        $('evidence').innerHTML=`<dl class="dg-evidence-grid"><div><dt>Stored emissions codes</dt><dd>${(state.dtcs || []).length?(state.dtcs || []).map(c=>`<code>${esc(c)}</code>`).join(' '):'None'}</dd></div><div><dt>Pending codes</dt><dd>${(state.pending_dtcs || []).length?(state.pending_dtcs || []).map(c=>`<code>${esc(c)}</code>`).join(' '):'None'}</dd></div><div><dt>High-input duration</dt><dd>${fixed(state.ect_fault_elapsed_s,2)} s</dd></div><div><dt>ECU measurement</dt><dd>${state.sensors?.ect_sensor_valid?'Valid':'Invalid / unavailable'}</dd></div></dl>`;
        setText('evidence-note','This pane shows the ECU model’s memory. Read stored codes sends an OBD Mode 03 request through the diagnostic connector. Clearing memory does not repair a circuit.');
      }else if(selected==='dlc'){
        $('evidence').innerHTML=`<dl class="dg-evidence-grid"><div><dt>CAN branch</dt><dd>${current.connected?'Connected':'Isolated from tester'}</dd></div><div><dt>Supply / ground</dt><dd>Reference pins remain present</dd></div></dl>`;
        setText('evidence-note','A tester timeout is a communication result, not an invented fault code. The disconnection switch isolates the tester’s CAN pair; it does not remove vehicle power.');
      }else{
        $('evidence').innerHTML=`<dl class="dg-evidence-grid"><div><dt>Recorded lab module event</dt><dd>${current.memory.length?current.memory.map(c=>`<code>${esc(c)}</code>`).join(' '):'None'}</dd></div><div><dt>Current state</dt><dd>${esc(current.phase)}</dd></div></dl>`;
        setText('evidence-note','This module exposes simulation state, not an OBD/UDS endpoint. Repair restores the path; its recorded module event remains until the run is restarted.');
      }
      $('freeze-section').hidden=selected!=='ect';const f=state.freeze_frame;
      setText('freeze-time',f?`Captured at ${fixed(f.t,2)} s`:'Not captured');
      $('freeze').innerHTML=f?`<p class="dg-small">Retained values at confirmation. These are not live readings; coolant here is the ECU-reported value.</p><dl class="dg-evidence-grid"><div><dt>Engine speed</dt><dd>${fixed(f.rpm,0)} rpm</dd></div><div><dt>Reported coolant</dt><dd>${fixed(f.coolant_c)} °C</dd></div><div><dt>Vehicle speed</dt><dd>${fixed(f.speed_kph)} km/h</dd></div><div><dt>Engine load</dt><dd>${fixed(f.load_pct)} %</dd></div></dl>`:'<p class="dg-small">The engine ECU captures a freeze frame when P0118 becomes confirmed. Clearing emissions memory removes it.</p>';
      renderDefinitions();renderReply();
    }
    render();
    return {
      update(next={}){
        const oldTime=ctx.state?.t;ctx=next;
        if(finite(oldTime)&&finite(ctx.state?.t)&&ctx.state.t<oldTime){lastReply=null;lastReplySource=null;localNotice='';}
        if(ctx.diagnostic && ctx.diagnostic!==lastReplySource){lastReplySource=ctx.diagnostic;lastReply=diagnosticOf(ctx.diagnostic);}
        else if(ctx.diagnostic===null && lastReplySource!==null){lastReplySource=null;lastReply=null;}
        if(ctx.selection!==previousSelection){previousSelection=ctx.selection;const related=caseForSelection(ctx.selection,ctx.catalog,ctx.signals);if(related)selected=related;}
        render();
      },
      selectCase,
      setVisible(value){visible=!!value;if(visible)render();},
      dispose(){disposed=true;listen.forEach(([node,event,fn])=>node.removeEventListener(event,fn));container.replaceChildren();},
      inspect(){return {selected,visible,pending,state:context(),context:contextBinding(),lastReply,notice:localNotice};}
    };
  }
  global.DiagnosisView={create,cases:CASES,evaluateCase,caseForSelection,caseInstalled,restartAllowed};
})(window);
