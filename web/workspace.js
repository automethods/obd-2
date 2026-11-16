/* Task-focused screens coordinated with the deterministic local simulation. */
(() => {
  'use strict';
  const byId=id=>document.getElementById(id);
  let scope,schematic,connectors,catalog=[],lastState,lastRecords={},taskBusy=false,taskStarted=false,ready=false;
  const engineProbes=['coolant_c','sensors.ect_c','sensors.ect_used_c','sensors.ect_voltage_v'];
  const hybridProbes=['speed_kph','battery_current_a','bmu_report.pack_current_a','sensors.bmu_message_age_ms'];
  const brakeProbes=['speed_kph','sensors.wheel_speeds_kph.0','slips.0','brake_pressure.0'];
  const tabs=[...document.querySelectorAll('[data-tab]')];
  function showTab(name,focus=false){
    tabs.forEach(b=>{const active=b.dataset.tab===name;b.classList.toggle('active',active);b.setAttribute('aria-selected',String(active));b.tabIndex=active?0:-1;if(active&&focus)b.focus();});
    document.querySelectorAll('[data-screen]').forEach(s=>s.hidden=s.dataset.screen!==name);
    requestAnimationFrame(()=>{scope?.redraw();window.LabUI?.draw();});
  }
  tabs.forEach((b,index)=>{b.onclick=()=>showTab(b.dataset.tab);b.onkeydown=e=>{let next;if(e.key==='ArrowRight')next=(index+1)%tabs.length;else if(e.key==='ArrowLeft')next=(index+tabs.length-1)%tabs.length;else if(e.key==='Home')next=0;else if(e.key==='End')next=tabs.length-1;else return;e.preventDefault();showTab(tabs[next].dataset.tab,true);};});
  showTab('task');
  function message(text){byId('task-status').textContent=text;}
  function display(value,unit=''){
    if(value==null)return '—';if(typeof value==='boolean')return value?'true':'false';
    if(typeof value==='number'){const decimals=Math.abs(value)>=1000?0:unit==='count'?0:Math.abs(value)>=100?1:3;return value.toFixed(decimals).replace(/(\.\d*?[1-9])0+$|\.0+$/,'$1')+(unit?' '+unit:'');}
    return String(value);
  }
  function probe(id){
    const result=scope.addSignal(id);
    if(!result.ok){window.LabUI.report(result.reason);return;}
    message('Probe added: '+(catalog.find(s=>s.id===id)?.label||id)+'. The scope uses recorded samples every 100 ms.');
    showTab('task');
    byId('scope').scrollIntoView({behavior:'smooth',block:'nearest'});
  }
  function signalTable(){
    const query=byId('signal-filter').value.toLowerCase(),body=byId('signal-rows');body.replaceChildren();
    for(const m of catalog){if(query&&![m.id,m.label,m.source,m.unit,m.group].join(' ').toLowerCase().includes(query))continue;const record=lastRecords[m.id]||{},tr=document.createElement('tr');
      const label=document.createElement('td'),name=document.createElement('strong'),source=document.createElement('small'),id=document.createElement('small');name.textContent=m.label;source.textContent=m.source;id.textContent=m.id;label.append(name,source,id);label.title=m.description;
      const value=document.createElement('td');value.textContent=display(record.value,m.unit);
      const quality=document.createElement('td'),badge=document.createElement('span');badge.className='validity '+(record.validity||'unavailable');badge.textContent=record.validity||'unavailable';badge.title=record.validity_note||'';quality.append(badge);
      const period=document.createElement('td');period.textContent=m.period_ms+' ms';period.title='Model update period. Scope records every 100 ms.';
      const action=document.createElement('td');if(m.kind!=='state'){const button=document.createElement('button');button.textContent='+ Scope';button.setAttribute('aria-label','Probe '+m.label);button.onclick=()=>probe(m.id);action.append(button);}else action.textContent='State';
      tr.append(label,value,quality,period,action);body.append(tr);
    }
  }
  function timeline(events){
    const box=byId('task-events');box.replaceChildren();if(!events?.length){const p=document.createElement('p');p.className='muted';p.textContent='Controller decisions will appear here as you step the task.';box.append(p);return;}
    for(const event of [...events].reverse()){const row=document.createElement('div');row.className='event';const time=document.createElement('time');time.textContent=Number(event.t).toFixed(2)+'s';const text=document.createElement('span'),source=document.createElement('strong');source.textContent=(event.source||event.module||'System')+' · ';text.append(source,document.createTextNode(event.message||event.event||''));row.append(time,text);box.append(row);}
  }
  function update(result){
    if(!ready||!result.state)return;lastState=result.state;lastRecords=result.signals||lastRecords;
    schematic.setState(lastState);connectors.setState(lastState);scope.setSignals(lastRecords);
    if(result.history)scope.append(result.history);if(result.events){scope.setEvents(result.events);timeline(result.events);}
    const s=lastState.sensors||{};byId('task-ecu').textContent=lastState.module_status?.ECU||lastState.module_status?.ENGINE||lastState.mode;
    byId('task-voltage').textContent=display(s.ect_voltage_v,'V');byId('task-adc').textContent=display(s.ect_adc_count);
    let monitor=lastState.dtcs?.includes('P0118')?'P0118 stored':lastState.pending_dtcs?.includes('P0118')?'pending / fallback':s.ect_high_input?'high input / counting':s.ect_sensor_valid?'healthy':'unavailable';
    byId('task-monitor').textContent=monitor;byId('task-monitor').classList.toggle('fault',monitor.includes('P0118')||monitor.includes('pending')||monitor.includes('high'));
    byId('task-fault-age').textContent=Number(lastState.ect_fault_elapsed_s||0).toFixed(2)+' s';
    signalTable();
  }
  function diagnosticResult({diagnostic:d,lines}){byId('task-diagnostic').textContent=d.error||d.meaning||'No reply from the configured ECU.';byId('task-trace').textContent=lines.join('\n');}
  async function perform(action){
    if(taskBusy||window.LabUI.isBusy()){message('Pause or finish the current advance, then try this task step again.');return;}
    taskBusy=true;document.querySelectorAll('.task-actions button').forEach(b=>b.disabled=true);
    try{await window.LabUI.pause();await action();}catch(e){message(e.message);window.LabUI.report(e.message);}finally{taskBusy=false;document.querySelectorAll('.task-actions button').forEach(b=>b.disabled=false);}
  }
  async function baseline(){await window.LabUI.baseline();taskStarted=true;byId('diagram').value='ect_circuit';schematic.setDiagram('ect_circuit');scope.setChannels(engineProbes);message('Healthy baseline: the two-wire NTC circuit is connected. Physical coolant is near 25°C; input is near 2.66 V. Click a connector pin or wire, then open the circuit.');showTab('task');}
  async function ensureTask(){if(!taskStarted||lastState?.profile!=='engine'||byId('lesson').value!=='manual')await baseline();}
  async function openFault(fault){await ensureTask();window.LabUI.setFault(fault);await window.LabUI.advance(.01);message(fault==='ect_open'?'Sensor disconnected. Input rises to 5 V and ADC reaches 4095. The ECU now sees a high input; the persistence timer has only just started.':'Sensor reconnected. The voltage and temperature reading recover. A stored DTC remains until cleared.');}
  function initialize(meta){
    if(ready)return;catalog=meta.signals||[];
    scope=window.SignalScope.init({container:byId('scope'),catalog});
    schematic=window.Schematic.init({container:byId('schematic-canvas'),inspector:byId('schematic-inspector'),catalog,onProbe:probe,onFault:fault=>perform(()=>openFault(fault))});
    connectors=window.ConnectorView.init({container:byId('connector-workspace'),onProbe:probe});
    for(const m of catalog.filter(s=>s.kind!=='state')){const option=document.createElement('option');option.value=m.id;option.textContent=m.label+(m.unit?' · '+m.unit:'');byId('scope-channel').append(option);}
    ready=true;scope.setChannels(engineProbes);timeline([]);
    if(window.LabUI.state())update({state:window.LabUI.state()});
  }
  window.addEventListener('lab:ready',e=>initialize(e.detail));
  window.addEventListener('lab:state',e=>update(e.detail));
  window.addEventListener('lab:diagnostic',e=>diagnosticResult(e.detail));
  window.addEventListener('lab:reset',e=>{if(!ready)return;taskStarted=false;scope.reset();const profile=e.detail.profile,diagram=profile==='engine'?'ect_loop':profile==='braking'?'brakes':'hybrid';byId('diagram').value=diagram;schematic.setDiagram(diagram);scope.setChannels(profile==='engine'?engineProbes:profile==='braking'?brakeProbes:hybridProbes);byId('task-diagnostic').textContent='No request in this experiment yet.';byId('task-trace').textContent='Application payloads and CAN frames appear here.';message('Experiment reset. Use the schematic and probes, or choose Healthy baseline for the guided coolant-sensor task.');});
  byId('diagram').onchange=()=>schematic.setDiagram(byId('diagram').value);
  byId('export-diagram').onclick=()=>{const data=schematic.exportSvg(),url=URL.createObjectURL(new Blob([data],{type:'image/svg+xml'})),a=document.createElement('a');a.href=url;a.download='obdii_'+byId('diagram').value+'.svg';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  byId('scope-add').onclick=()=>probe(byId('scope-channel').value);
  byId('scope-window').onchange=()=>scope.setWindow(byId('scope-window').value);
  byId('scope-export').onclick=()=>{const count=scope.exportCsv();message('Exported'+ ' '+count+' recorded samples with each selected signal’s units and validity.');};
  byId('signal-filter').oninput=signalTable;
  byId('open-scan-screen').onclick=()=>showTab('diagnostics');
  byId('task-start').onclick=()=>perform(baseline);
  byId('task-open').onclick=()=>perform(()=>openFault('ect_open'));
  byId('task-pending').onclick=()=>perform(async()=>{await ensureTask();await window.LabUI.advance(.2);await window.LabUI.diagnostic('07');message(lastState.pending_dtcs?.includes('P0118')?'Pending P0118: high input has persisted for at least 0.20 s. The controller substitutes 80°C and reduces requested engine torque.':'No pending P0118. Open the circuit first, then let the high input persist for 0.20 s.');});
  byId('task-confirm').onclick=()=>perform(async()=>{await ensureTask();await window.LabUI.advance(.3);message(lastState.dtcs?.includes('P0118')?'P0118 confirmed: high input has persisted for at least 0.50 s. The MIL is on and a freeze-frame snapshot is stored. Read the DTC next.':'Confirmation requires 0.50 s of continuous high input. Complete the open-circuit and pending steps first.');});
  byId('task-read').onclick=()=>perform(async()=>{await window.LabUI.diagnostic('03');message('Mode 03 returned the stored emissions codes. For P0118 the application reply is 43 01 01 18; the CAN frame adds ISO-TP length and padding.');});
  byId('task-repair').onclick=()=>perform(async()=>{await ensureTask();window.LabUI.setFault('none');await window.LabUI.advance(.02);await window.LabUI.diagnostic('04');await window.LabUI.advance(.1);message('Circuit repaired, then Mode 04 cleared the emissions DTC and freeze frame. The next controller cycles use the valid sensor temperature again.');});
  document.querySelectorAll('[data-task-payload]').forEach(b=>b.onclick=()=>perform(()=>window.LabUI.diagnostic(b.dataset.taskPayload)));
  if(window.LabUI?.meta())initialize(window.LabUI.meta());
})();
