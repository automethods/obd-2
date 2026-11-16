/* Object selection, experiment controls and live wire probes share LabUI state. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const pretty=value=>typeof value==='number'?(Number.isInteger(value)?String(value):value.toFixed(Math.abs(value)<10?3:1)):value===null||value===undefined?'Unavailable':typeof value==='object'?JSON.stringify(value):String(value);
  const fmt=(v,d=1)=>v===null||v===undefined||!Number.isFinite(Number(v))?'—':Number(v).toFixed(d);
  const get=(o,path)=>String(path||'').replace(/\[(\d+)\]/g,'.$1').split('.').reduce((v,k)=>v==null?undefined:v[k],o);
  const experiments={
    ect:{title:'Coolant sensor',sub:'Temperature → voltage → ECU',profile:'engine',scenario:'manual',config:{initial_coolant_c:25,ambient_c:25},inputs:{throttle:.18},selection:'ect_signal',request:'01 05',observe:'Compare actual coolant temperature with the voltage the ECU measures. Open the connector, then step the model to see detection and fallback.',hint:'A wire can be open while the engine and coolant still exist. Repair the connection, then compare the current measurement with a stored warning.',labels:['Actual coolant','ECU measurement','ECU decision']},
    dlc:{title:'Diagnostic connection',sub:'Socket → CAN → scan tool',profile:'engine',scenario:'manual',config:{initial_coolant_c:40},inputs:{throttle:.2},selection:'dlc_socket',request:'01 0C',observe:'Read engine speed, disconnect the diagnostic CAN branch, then request it again. The engine continues; the scanner cannot reach it.',hint:'The 16-pin socket is a connector. CAN carries messages. OBD defines the question and the reply. These are different layers.',labels:['Engine speed','Diagnostic CAN','Vehicle control']},
    bmu:{title:'Battery monitor',sub:'Message freshness → permission',profile:'phev',scenario:'manual',config:{initial_soc_pct:65,initial_speed_kph:25},inputs:{throttle:.2},selection:'bmu_can_h',request:'01 0D',observe:'Disconnect the battery-monitor CAN connector, then advance time. Watch message age increase and the hybrid controller remove electric power permission.',hint:'Reconnecting restores messages. The battery shutdown is latched in this model: cycle ignition or reset the experiment to restore power.',labels:['Message age','Contactor','Hybrid mode']},
    wheel_fl:{title:'Wheel-speed sensor',sub:'Turning wheel ≠ valid measurement',profile:'braking',scenario:'manual',config:{initial_speed_kph:70},inputs:{throttle:0,brake:.25},selection:'wheel_fl_signal',request:'01 0D',observe:'Disconnect the front-left wheel sensor while the wheel is turning. Compare physical wheel speed with the missing measurement and the ABS response.',hint:'No sensor signal does not mean the physical wheel stopped. The diagram, scope and vehicle view keep that distinction visible.',labels:['Physical FL wheel','Measured FL wheel','ABS controller']}
  };
  const layout={coolant_sensor:[95,125,150,80],ecu:[345,125,170,94],dlc:[610,125,136,94],scan_tool:[815,125,145,80],engine:[95,255,150,65],battery:[85,400,140,70],bmu:[270,360,150,80],supervisor:[470,360,160,80],abs:[715,350,150,80],wheel_fl:[580,465,105,54],wheel_fr:[695,465,105,54],wheel_rl:[810,465,105,54],wheel_rr:[875,360,75,60]};
  const wirePaths={
    ect_signal:'M170 112 H260',ect_return:'M170 138 H260',
    dlc_can_h:'M430 106 H542 M678 106 H743',dlc_can_l:'M430 144 H542 M678 144 H743',
    dlc_power:'M610 172 V218 H662',dlc_ground:'M630 172 V242 H662',
    bmu_can_h:'M345 147 V255 H260 V320 M260 255 H460 V320',bmu_can_l:'M365 147 V272 H280 V320 M280 272 H480 V320',
    wheel_fl_signal:'M675 390 V420 H580 V438',wheel_fr_signal:'M700 390 V438',wheel_rl_signal:'M730 390 V420 H810 V438',wheel_rr_signal:'M790 350 H838'
  };
  const socketPositions={coolant_socket:[170,125],ecu_socket:[260,125],dlc_socket:[610,187],scan_socket:[743,125],bmu_socket:[270,320],abs_socket:[715,390],wheel_fl_socket:[580,438],wheel_fr_socket:[695,438],wheel_rl_socket:[810,438],wheel_rr_socket:[838,350]};
  const palette={ect_signal:'#209eac',ect_return:'#9aa6b9',dlc_can_h:'#7774bf',dlc_can_l:'#aaa5d6',dlc_power:'#c7936b',dlc_ground:'#91a0b2',bmu_can_h:'#7774bf',bmu_can_l:'#aaa5d6',wheel_fl_signal:'#219eac',wheel_fr_signal:'#5cabb5',wheel_rl_signal:'#5cabb5',wheel_rr_signal:'#5cabb5'};
  const bindingPaths={ect_signal:'sensors.ect_voltage_v',ect_return:'sensors.sensor_return_v',dlc_can_h:'rpm',dlc_can_l:'rpm',bmu_can_h:'sensors.bmu_message_age_ms',bmu_can_l:'sensors.bmu_message_age_ms',wheel_fl_signal:'sensors.wheel_speeds_kph.0',wheel_fr_signal:'sensors.wheel_speeds_kph.1',wheel_rl_signal:'sensors.wheel_speeds_kph.2',wheel_rr_signal:'sensors.wheel_speeds_kph.3'};
  let catalog, snapshot, network, selected='ect_signal', experiment='ect', view='dashboard', visible=true, initialized=false, pendingInit=false, vehicle, protocols, dashboard, points=[], pending=false, theme='dark', activeRun='drive';
  const row=(label,value)=>`<tr><th>${esc(label)}</th><td>${esc(pretty(value))}</td></tr>`;
  function currentConnection(id){
    const obj=findObject(id)?.object;
    if(obj&&Object.prototype.hasOwnProperty.call(obj,'connection_id'))return obj.connection_id;
    if(/^(ect_|coolant_)/.test(id))return 'ect';
    if(/^(dlc_|scan_)/.test(id))return 'dlc';
    if(/^bmu/.test(id))return 'bmu';
    if(/^wheel_fl/.test(id))return 'wheel_fl';
    return null;
  }
  function findObject(id){
    if(id.startsWith('pin:')){const [,socketId,num]=id.split(':');const socket=catalog.sockets.find(x=>x.id===socketId);const pin=socket?.pins?.find(p=>String(p.number??p.id)===num);return pin?{type:'Pin',object:pin,socket}:null;}
    for(const [key,type] of [['components','Component'],['sockets','Socket'],['wires','Wire']]){const object=catalog[key]?.find(x=>x.id===id);if(object)return {type,object};}
    return null;
  }
  function markup(){
    return `<section class="wb-heading"><div><div class="wb-overline">Virtual vehicle lab · v0.5</div><h1 id="wb-page-title">Live session</h1><p id="wb-page-description">A virtual car, its signals and its diagnostics. One shared simulation.</p></div><div class="wb-heading-right"><button id="wb-theme" class="wb-theme" aria-label="Switch to light appearance">☀ Light</button><span class="wb-model-tag">Offline simulation</span><a class="wb-guide" href="/docs/LIVE_DASHBOARD.html" target="_blank">Start here ↗</a></div></section>
      <nav class="wb-tabs" role="tablist" aria-label="Workbench views"><div class="wb-nav-vehicle"><span id="wb-nav-connection">● Virtual CAN connected</span><small>SIMULATED VEHICLE</small><strong>OBD II Lab Hybrid</strong><p>Original teaching vehicle<br>CAN · ISO-TP · OBD / UDS</p></div>${[['dashboard','◴','Live dashboard'],['vehicle','◇','Virtual vehicle'],['panel','⌘','Training panel'],['protocols','⇄','Diagnostics'],['objects','{}','Object layers']].map(([id,icon,label])=>`<button role="tab" id="wb-tab-${id}" aria-controls="wb-view-${id}" aria-selected="${id==='dashboard'}" class="${id==='dashboard'?'active':''}" data-wb-view="${id}"><span class="wb-tab-icon">${icon}</span>${label}</button>`).join('')}<div class="wb-nav-footer"><span>LOCAL SIMULATOR</span><p>Every view follows the same clock.<br>No vehicle adapter required.</p><a href="/docs/LIVE_DASHBOARD.html" target="_blank">Guide & test checklist ↗</a></div></nav>
      <div class="wb-layout" id="wb-layout"><aside class="wb-left"><h2 class="wb-side-title">Choose an experiment</h2><div class="wb-experiments">${Object.entries(experiments).map(([id,e],i)=>`<button class="wb-experiment ${id===experiment?'active':''}" data-experiment="${id}" aria-pressed="${id===experiment}"><span class="wb-number">0${i+1}</span><span><b>${e.title}</b><small>${e.sub}</small></span></button>`).join('')}</div><p class="wb-left-note">Choosing an experiment resets the model.</p><section class="wb-card wb-driver"><h3>Driver controls</h3><label>Ignition / READY<input type="checkbox" id="wb-ignition" checked></label><label for="wb-throttle">Accelerator <output id="wb-throttle-value">18%</output></label><input id="wb-throttle" type="range" min="0" max="100" value="18"><label for="wb-brake">Brake <output id="wb-brake-value">0%</output></label><input id="wb-brake" type="range" min="0" max="100" value="0"></section><section class="wb-hint"><h3>What to look for</h3><p id="wb-hint"></p><a href="/docs/VISUAL_WORKBENCH.html" target="_blank">Read the experiment notes ↗</a></section></aside>
      <div class="wb-center"><section class="wb-toolbar" aria-label="Simulation playback"><div class="wb-controls"><button class="wb-primary" id="wb-run">▶ Run</button><button id="wb-step-small">+0.1 s</button><button id="wb-step">+1 s</button><button id="wb-reset" title="Reset the chosen experiment">↺ Reset</button><select id="wb-playback" aria-label="Playback speed"><option value="1">1× speed</option><option value="5">5× speed</option><option value="10">10× speed</option></select></div><div class="wb-time"><span class="wb-time-label"><i id="wb-running-dot" class="wb-running-dot"></i>SIMULATION TIME</span><span id="wb-clock">0.00</span><small>s</small></div></section>
      <section class="wb-view" id="wb-view-dashboard" role="tabpanel" aria-labelledby="wb-tab-dashboard"><div id="wb-dashboard-root"></div></section>
      <section class="wb-view" id="wb-view-panel" role="tabpanel" aria-labelledby="wb-tab-panel" hidden><div class="wb-card"><div class="wb-panel-header"><div><h2>Connections you can inspect.</h2><p>Select a component, a socket or a wire.</p></div><span class="wb-badge" id="wb-profile">ENGINE STAND</span></div><div class="wb-circuit-wrap" id="wb-circuit-wrap"></div><div class="wb-legend"><span><i></i>Sensor signal</span><span><i class="wb-can"></i>CAN link</span><span><i class="wb-power"></i>Power reference</span><span><i class="wb-open"></i>Disconnected</span></div><div class="wb-footnote">Simplified teaching topology. Moving dots indicate data activity; they do not represent bus bit timing.</div></div></section>
      <section class="wb-view" id="wb-view-vehicle" role="tabpanel" aria-labelledby="wb-tab-vehicle" hidden><div class="wb-card" id="wb-vehicle-root"></div></section>
      <section class="wb-view" id="wb-view-protocols" role="tabpanel" aria-labelledby="wb-tab-protocols" hidden><div id="wb-protocols-root"></div></section>
      <section class="wb-view" id="wb-view-objects" role="tabpanel" aria-labelledby="wb-tab-objects" hidden><div class="wb-card wb-object-view"><div class="wb-overline">One simulation · replaceable presentation</div><h2>Objects, properties and behavior.</h2><p class="wb-object-intro">A vehicle part, its connector, a wire and the message on that wire are separate objects. The same simulated state drives this diagram and the 3D scene.</p><div class="wb-layer-list">${[
        ['Physical model','Engine, battery and wheels evolve with simulation time. A disconnected sensor does not delete the physical quantity.','Sim → snapshot'],
        ['Component & socket','A component owns sockets. Each socket has numbered pins with a role, signal direction and reference properties.','Component → Socket → Pin'],
        ['Wire & connection','A wire connects two pin endpoints. Its connection state controls signal availability and the modeled fault consequences.','Wire → from / to / connection_id'],
        ['Protocol & meaning','CAN moves messages; ISO-TP carries longer diagnostic payloads. OBD and UDS define the request and response meaning.','CAN → ISO-TP → OBD / UDS'],
        ['Presentation binding','Scene nodes read values from the snapshot. A future model can replace the body geometry while retaining the signal paths.','state_path → node / rotation / color']
      ].map(([name,description,code],i)=>`<article class="wb-layer"><span>0${i+1}</span><div><h3>${name}</h3><p>${description}</p><code>${esc(code)}</code></div></article>`).join('')}</div><div class="wb-prop-title">Inspect an object</div><div class="wb-object-browser" id="wb-object-browser"></div><p class="wb-object-intro" style="margin-top:17px;margin-bottom:0"><a href="/docs/VEHICLE_MODELS.html" target="_blank">Model bindings and Three.js integration ↗</a> · <a href="/api/network" target="_blank">Network object catalog ↗</a></p></div></section>
      <section class="wb-card wb-mission" id="wb-mission"><div class="wb-mission-head"><h3 id="wb-mission-title"></h3><span class="wb-badge">GUIDED EXPERIMENT</span></div><p id="wb-mission-description"></p><div class="wb-steps"><button id="wb-mission-reset">1 · Healthy baseline</button><button class="wb-fault-button" id="wb-disconnect">2 · Disconnect</button><button id="wb-detect">3 · Advance 0.6 s</button><button id="wb-read">4 · Read diagnostic</button><button class="wb-repair-button" id="wb-reconnect">5 · Reconnect</button></div><div class="wb-observation" id="wb-observation"></div><div class="wb-readout" id="wb-readout" hidden aria-live="polite"></div></section>
      <section class="wb-card wb-scope" id="wb-scope"><div class="wb-scope-head"><div><h3>Selected wire · <span id="wb-scope-title">Coolant signal</span></h3><p id="wb-scope-note">Sampled model value over simulation time</p></div><strong class="wb-scope-value" id="wb-scope-value">—</strong></div><canvas id="wb-scope-canvas" class="wb-scope-canvas" aria-label="Selected wire signal over simulation time"></canvas><div class="wb-scope-footer"><span id="wb-scope-range">0.0 s</span><span>Gaps mean unavailable · live model samples</span></div></section></div>
      <aside class="wb-right"><section class="wb-card" id="wb-inspector" aria-label="Selected object inspector"></section></aside></div><footer class="wb-statusline"><span>Generic educational models · synthetic values · no connection to a real vehicle</span><span><a href="/api/export.json">Export run</a> · <a href="/api/export.csv">Signal CSV</a> · <a href="/api/trace.txt">Diagnostic trace</a></span></footer>`;
  }
  function icon(id,x,y){
    if(id==='coolant_sensor')return `<path class="wb-node-icon" d="M${x-5} ${y-10} v17 a7 7 0 1 0 10 0 v-17 a5 5 0 0 0-10 0 m5 1v20"/>`;
    if(id.startsWith('wheel'))return `<circle class="wb-node-icon" cx="${x}" cy="${y}" r="9"/><circle class="wb-node-icon" cx="${x}" cy="${y}" r="3"/>`;
    if(id==='battery')return `<path class="wb-node-icon" d="M${x-12} ${y-7}h23v16h-23z m7-4v4m9-4v4m-11 7h5m5-3v6m-3-3h6"/>`;
    if(id==='dlc')return `<path class="wb-node-icon" d="M${x-15} ${y-8}h30l-4 17h-22z"/><path class="wb-node-icon" d="M${x-8} ${y-3}h16m-15 7h14"/>`;
    return `<rect class="wb-node-icon" x="${x-12}" y="${y-10}" width="24" height="20" rx="3"/><path class="wb-node-icon" d="M${x-7} ${y-5}h14m-14 5h8m-8 5h11"/>`;
  }
  function circuit(){
    const nodes=catalog.components.filter(c=>layout[c.id]).map(c=>{
      const [x,y,w,h]=layout[c.id];const small=w<120;const label=({coolant_sensor:'Coolant sensor',engine:'Engine plant',ecu:'Engine ECU',dlc:'DLC16',scan_tool:'Scan tool',battery:'HV battery',bmu:'Battery monitor',supervisor:'Hybrid ECU',abs:'ABS controller'})[c.id]||c.label||c.name||c.id;
      return `<g class="wb-svg-node" data-wb-select="${esc(c.id)}" id="wb-node-${esc(c.id)}" tabindex="0" role="button" aria-label="Inspect ${esc(label)}"><rect class="wb-node-box" x="${x-w/2}" y="${y-h/2}" width="${w}" height="${h}" rx="8"/>${icon(c.id,small?x-w/2+16:x-w/2+24,small?y:y-10)}<text class="wb-node-kind" x="${small?x-26:x-w/2+45}" y="${small?y-6:y-21}">${small?'WHEEL':esc((c.kind||c.type||'component').toUpperCase().slice(0,16))}</text><text x="${small?x-26:x-w/2+45}" y="${small?y+9:y-5}">${esc(small?c.id.replace('wheel_','').toUpperCase():label.length>20?label.slice(0,19)+'…':label)}</text>${small?'':`<text class="wb-node-value" x="${x-w/2+14}" y="${y+25}" id="wb-value-${esc(c.id)}">—</text>`}</g>`;
    }).join('');
    const wires=catalog.wires.filter(w=>wirePaths[w.id]).map(w=>`<g class="wb-wire" data-wb-select="${esc(w.id)}" id="wb-wire-${esc(w.id)}" tabindex="0" role="button" aria-label="Inspect wire ${esc(w.label||w.id)}"><path class="wb-wire-hit" d="${wirePaths[w.id]}"/><path class="wb-wire-line" id="wb-path-${esc(w.id)}" d="${wirePaths[w.id]}" stroke="${palette[w.id]||'#8894ae'}"/><circle class="wb-signal-dot" id="wb-pulse-${esc(w.id)}" r="4" fill="${palette[w.id]||'#8894ae'}"/></g>`).join('');
    const sockets=catalog.sockets.filter(s=>socketPositions[s.id]).map(s=>{const [x,y]=socketPositions[s.id];return `<circle class="wb-svg-socket" id="wb-socket-${esc(s.id)}" data-wb-select="${esc(s.id)}" cx="${x}" cy="${y}" r="6" tabindex="0" role="button" aria-label="Inspect socket ${esc(s.label||s.id)}"/>`;}).join('');
    $('wb-circuit-wrap').innerHTML=`<svg class="wb-circuit" viewBox="0 0 920 520" role="group" aria-label="Interactive teaching network"><text class="wb-annotation" x="21" y="28">PHYSICAL WORLD</text><text class="wb-annotation" x="264" y="28">CONTROL & MEASUREMENT</text><text class="wb-annotation" x="553" y="28">DIAGNOSTIC ACCESS</text><path d="M215 38V492 M520 38V225" stroke="#e7eaf1" stroke-dasharray="3 5"/><path d="M95 221V167" stroke="#d9dee7" stroke-dasharray="3 4"/><text class="wb-annotation" x="112" y="200">temperature</text><path d="M155 400H195" stroke="#c4936d" stroke-width="2"/><text class="wb-can-label" x="342" y="298">CAN · CONTROLLER MESSAGES</text><text class="wb-annotation" x="668" y="221">12 V reference</text><text class="wb-annotation" x="668" y="245">ground</text><text class="wb-annotation" x="21" y="315">HYBRID & BRAKING MODULES</text>${wires}${nodes}${sockets}<text class="wb-selection-label" x="21" y="510">Connector pin roles and electrical values are teaching references, not a vehicle service pinout.</text></svg>`;
    $('wb-circuit-wrap').addEventListener('click',e=>{const target=e.target.closest('[data-wb-select]');if(target)select(target.dataset.wbSelect);});
    $('wb-circuit-wrap').addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){const target=e.target.closest('[data-wb-select]');if(target){e.preventDefault();select(target.dataset.wbSelect);}}});
  }
  function select(id){
    if(!findObject(id))return;
    if(selected!==id){selected=id;points=[];if(snapshot)addSamples({state:snapshot,history:[]});}
    renderInspector();renderSelection();vehicle?.select(id);renderScope();
  }
  function renderSelection(){
    for(const node of document.querySelectorAll('[data-wb-select],#wb-object-browser button'))node.classList.toggle('selected',node.dataset.wbSelect===selected);
  }
  function renderInspector(){
    const found=findObject(selected);if(!found)return;
    const detailsOpen=$('wb-inspector').querySelector('details')?.open;
    const {object:o,type,socket}=found;const live=type==='Wire'?network?.wires?.[o.id]:network?.components?.[o.id];
    const connection=type==='Pin'?socket?.connection_id||currentConnection(socket?.id||''):currentConnection(o.id||'');
    const connected=connection?(snapshot?.connections?.[connection]??network?.connections?.[connection]??true):true;
    const effectiveConnected=live?.connected??(connection?(snapshot?.effective_connections?.[connection]??connected):connected);
    const value=type==='Wire'?live?.value:undefined;
    const properties=o.properties||{};
    const from=o.from||o.source, to=o.to||o.target;
    const endpoint=e=>typeof e==='object'?`${e.socket_id||e.socket||e.component_id||e.component||'?'} · pin ${e.pin??e.pin_number??'—'}`:e;
    const path=o.state_path||o.binding?.state_path||o.binding?.path||bindingPaths[o.id];
    const title=type==='Pin'?`Pin ${o.number??o.id} · ${o.label||o.name||o.role||'terminal'}`:o.label||o.name||o.id;
    const pairs=[];
    if(type==='Wire'){pairs.push(row('From',endpoint(from)),row('To',endpoint(to)),row('Signal type',o.kind||o.signal_type||live?.sample_kind||'model signal'),row('Continuity',effectiveConnected?'Connected':'Open circuit'),row('Availability',live?.available===false?'Unavailable':'Available'));
      for(const [key,val] of Object.entries(properties))pairs.push(row(key.replaceAll('_',' '),val));
      for(const key of ['length_m','resistance_ohm','gauge_mm2','nominal_voltage_v'])if(o[key]!==undefined)pairs.push(row(key.replaceAll('_',' '),o[key]));
    }else if(type==='Socket'){pairs.push(row('Component',o.component_id||o.component),row('Pins',o.pins?.length||0),row('Continuity',connection?(effectiveConnected?'Connected':'Open'):'Fixed teaching connector'));}
    else if(type==='Pin'){for(const [key,val] of Object.entries(o))if(!['label','name','id'].includes(key))pairs.push(row(key.replaceAll('_',' '),val));}
    else {pairs.push(row('Kind',o.kind||o.type),row('Status',live?.status||snapshot?.module_status?.[o.id.toUpperCase()]||'Teaching component'));if(o.position)pairs.push(row('Scene position',o.position));for(const [key,val]of Object.entries(properties))pairs.push(row(key.replaceAll('_',' '),val));}
    const pins=type==='Socket'?o.pins:socket?.pins;
    const socketObject=type==='Socket'?o:socket;
    const pinHtml=pins?.length?`<div class="wb-prop-title">${socketObject.id==='dlc_socket'?'DLC16 · looking into vehicle socket':'Socket pins'}</div><div class="wb-pin-grid">${pins.map(p=>`<button class="${p.signal_id||p.role&&!/reserved|manufacturer|unused|unassigned/i.test(p.role)?'assigned':''} ${selected===`pin:${socketObject.id}:${p.number??p.id}`?'selected':''}" data-pin="pin:${esc(socketObject.id)}:${esc(p.number??p.id)}" title="${esc(p.label||p.name||p.role||'Pin')}">${esc(p.number??p.id)}</button>`).join('')}</div><p class="wb-pin-note">${socketObject.id==='dlc_socket'?'Pins 1–8 above; 9–16 below. Protocol support and manufacturer-assigned pins vary by vehicle.':'These are lab connector assignments, not production vehicle specifications.'}</p>`:'';
    const connectionDisabled=connection&&['bmu','wheel_fl'].includes(connection)&&snapshot?.profile==='engine';
    $('wb-inspector').innerHTML=`<div class="wb-inspector-head"><h2>Object inspector <span>↗</span></h2><span class="wb-object-chip">${type}</span><h3>${esc(title)}</h3><p>${esc(o.description||live?.note||'Select properties and inspect the shared state binding below.')}</p></div><div class="wb-inspector-body">${type==='Wire'?`<div class="wb-inspector-reading"><strong>${fmt(value,Math.abs(value||0)<10?2:1)}</strong><small>${esc(live?.unit||o.unit||'')}<br>${esc(live?.available===false?'unavailable':live?.sample_kind==='reference'?'reference value':'live sample')}</small></div>`:''}<table class="wb-property-table">${pairs.join('')}</table>${pinHtml}${connection?`<div class="wb-connection-control"><span class="wb-connection-status ${connected?'':'open'}">${connected?'● Switch connected':'○ Switch disconnected'}${effectiveConnected!==connected?' · injected fault active':''} · ${esc(connection==='dlc'?'diagnostic CAN branch':connection)}</span><button id="wb-inspector-connect" ${connectionDisabled?'disabled':''}>${connected?'Disconnect this connection':'Reconnect this connection'}</button>${connectionDisabled?'<small class="wb-pin-note">Choose the matching experiment to install this module.</small>':''}</div>`:''}${path?`<div class="wb-prop-title">Simulation binding</div><div class="wb-binding">snapshot.${esc(path)}<br>→ ${esc(o.id)}<br>→ diagram / scope / scene</div>`:''}${type==='Component'?`<div class="wb-prop-title">Sockets</div>${catalog.sockets.filter(s=>s.component_id===o.id||s.component===o.id).map(s=>`<button class="wb-link-button" data-inspect="${esc(s.id)}">${esc(s.label||s.id)} →</button>`).join('<br>')||'<small class="wb-pin-note">No exposed connector in this teaching subset.</small>'}`:''}<details><summary>Object properties · JSON</summary><pre class="wb-inspector-json">${esc(JSON.stringify({...o,live},null,2))}</pre></details></div>`;
    if(detailsOpen)$('wb-inspector').querySelector('details').open=true;
    $('wb-inspector-connect')?.addEventListener('click',()=>action(()=>window.LabUI.connection(connection,!connected)));
    $('wb-inspector').querySelectorAll('[data-pin]').forEach(b=>b.onclick=()=>select(b.dataset.pin));
    $('wb-inspector').querySelectorAll('[data-inspect]').forEach(b=>b.onclick=()=>select(b.dataset.inspect));
  }
  function renderNodes(){
    if(!snapshot)return;
    const vals={coolant_sensor:`${fmt(snapshot.coolant_c)} °C actual`,ecu:`${fmt(snapshot.rpm,0)} rpm`,dlc:snapshot.connections?.dlc===false?'CAN branch open':'16-pin socket',scan_tool:snapshot.connections?.dlc===false?'No communication':'OBD / UDS',engine:`${fmt(snapshot.coolant_c)} °C coolant`,battery:`${fmt(snapshot.soc_pct)}% SOC`,bmu:`${fmt(snapshot.sensors?.bmu_message_age_ms,0)} ms age`,supervisor:snapshot.mode,abs:snapshot.module_status?.ABS_ESP};
    for(const [id,value]of Object.entries(vals)){const node=$('wb-value-'+id);if(node)node.textContent=value;}
    for(const c of catalog.components){const node=$('wb-node-'+c.id);if(!node)continue;const live=network?.components?.[c.id];const uninstalled=live?.installed===false||snapshot.profile==='engine'&&['battery','bmu','supervisor','abs','wheel_fl','wheel_fr','wheel_rl','wheel_rr'].includes(c.id);node.classList.toggle('uninstalled',uninstalled);node.classList.toggle('offline',live?.available===false&&!uninstalled);}
    for(const [i,w]of catalog.wires.entries()){
      const live=network?.wires?.[w.id],g=$('wb-wire-'+w.id);if(!g)continue;
      g.classList.toggle('disconnected',live?.connected===false);g.classList.toggle('unavailable',live?.available===false&&live?.connected!==false);
      const pulse=$('wb-pulse-'+w.id),path=$('wb-path-'+w.id);const active=live?.connected!==false&&live?.available!==false&&live?.activity!==false;
      if(pulse){pulse.style.display=active?'':'none';if(active&&path?.getTotalLength){try{const p=path.getPointAtLength(((snapshot.t*.7+i*.13)%1)*path.getTotalLength());pulse.setAttribute('cx',p.x);pulse.setAttribute('cy',p.y);}catch{pulse.style.display='none';}}}
    }
    renderSelection();
  }
  function sampleValue(s){
    const found=findObject(selected);if(found?.type!=='Wire')return null;
    const w=found.object,conn=currentConnection(w.id);if(['dlc','wheel_fl'].includes(conn)&&(s.effective_connections||s.connections)?.[conn]===false)return null;
    if(s.profile==='engine'&&/^(bmu_|wheel_)/.test(w.id))return null;
    const path=w.state_path||w.binding?.state_path||w.binding?.path||bindingPaths[w.id];
    if(!path&&Number.isFinite(w.properties?.nominal_voltage_v))return w.properties.nominal_voltage_v;
    const value=get(s,path);return Number.isFinite(value)?value:null;
  }
  function addSamples(result){
    if(!findObject(selected)||findObject(selected).type!=='Wire')return;
    for(const s of [...(result.history||[]),result.state].filter(Boolean)){
      if(points.length&&s.t<points[points.length-1].t)continue;
      const v=s===result.state?(network?.wires?.[selected]?.available===false?null:network?.wires?.[selected]?.value):sampleValue(s);
      const value=Number.isFinite(v)?v:null;
      if(points.length&&s.t===points[points.length-1].t){points[points.length-1]={t:s.t,v:value};continue;}
      points.push({t:s.t,v:value});
    }
    if(points.length>800)points.splice(0,points.length-800);
  }
  function renderScope(){
    if(!initialized)return;
    const found=findObject(selected),wire=found?.type==='Wire'?found.object:null,live=wire?network?.wires?.[wire.id]:null;
    $('wb-scope-title').textContent=wire?.label||wire?.id||'select a wire to probe';
    $('wb-scope-note').textContent=wire?(live?.note||'Sampled model value over simulation time'):'Select a colored connection in the training panel or an object in the vehicle.';
    $('wb-scope-value').textContent=wire?`${live?.available===false?'Unavailable':fmt(live?.value,Math.abs(live?.value||0)<10?2:1)} ${live?.unit||wire.unit||''}`:'—';
    const canvas=$('wb-scope-canvas'),rect=canvas.getBoundingClientRect();if(!rect.width)return;
    const dpr=window.devicePixelRatio||1;canvas.width=Math.round(rect.width*dpr);canvas.height=Math.round(rect.height*dpr);const c=canvas.getContext('2d');if(!c)return;c.scale(dpr,dpr);
    const width=rect.width,height=rect.height,left=36,right=9,top=15,bottom=21,pw=width-left-right,ph=height-top-bottom;
    c.clearRect(0,0,width,height);c.font='9px ui-monospace,monospace';c.lineWidth=1;
    const values=points.map(p=>p.v).filter(v=>v!==null);let min=values.length?Math.min(...values):0,max=values.length?Math.max(...values):5;
    if(Math.abs(max-min)<.01){min-=.5;max+=.5;}else{const pad=(max-min)*.12;min-=pad;max+=pad;}
    const first=points[0]?.t||0,last=points[points.length-1]?.t||0,span=Math.max(1,last-first);
    for(let i=0;i<4;i++){const y=top+ph*i/3;c.strokeStyle='#edf0f5';c.beginPath();c.moveTo(left,y);c.lineTo(width-right,y);c.stroke();c.fillStyle='#9aa4b5';c.fillText(fmt(max-(max-min)*i/3,Math.abs(max)<10?1:0),2,y+3);}
    c.strokeStyle=palette[selected]||'#209eac';c.lineWidth=2;c.beginPath();let pen=false;
    for(const p of points){if(p.v===null){pen=false;continue;}const x=left+(p.t-first)/span*pw,y=top+(max-p.v)/(max-min)*ph;if(!pen){c.moveTo(x,y);pen=true;}else c.lineTo(x,y);}c.stroke();
    if(values.length===1){const p=points.find(p=>p.v!==null);c.fillStyle=palette[selected]||'#209eac';c.beginPath();c.arc(left+(p.t-first)/span*pw,top+(max-p.v)/(max-min)*ph,3,0,Math.PI*2);c.fill();}
    if(!values.length){c.fillStyle='#9aa4b5';c.fillText(wire?'No available samples yet. Run or step the simulation.':'Choose a wire to view its sampled signal.',left+8,top+ph/2);}
    c.fillStyle='#9aa4b5';c.fillText(fmt(first)+' s',left,height-4);c.fillText(fmt(last)+' s',Math.max(left,width-48),height-4);
    $('wb-scope-range').textContent=wire?`${live?.unit||wire.unit||'value'} / simulation seconds`:'NO WIRE SELECTED';
  }
  function observe(){
    const e=experiments[experiment],s=snapshot;if(!s)return;
    let values;
    if(experiment==='ect')values=[`${fmt(s.coolant_c)} °C`,!s.inputs?.ignition?'Unpowered':s.sensors?.ect_sensor_valid===false?'−40 °C marker':`${fmt(s.sensors?.ect_c)} °C`,!s.inputs?.ignition?'Unpowered':s.ect_derate_factor<1?'Fallback':s.sensors?.ect_sensor_valid===false?'Checking input':s.engine_running?'Running':'Stopped'];
    else if(experiment==='dlc')values=[`${fmt(s.rpm,0)} rpm`,s.connections?.dlc===false?'Disconnected':'Connected',s.engine_running?'Running':'Stopped'];
    else if(experiment==='bmu')values=[`${fmt(s.sensors?.bmu_message_age_ms,0)} ms`,s.contactor,s.mode];
    else values=[`${fmt(s.wheel_speeds_kph?.[0])} km/h`,s.sensors?.wheel_speeds_kph?.[0]==null?'Unavailable':`${fmt(s.sensors.wheel_speeds_kph[0])} km/h`,s.module_status?.ABS_ESP];
    $('wb-observation').innerHTML=e.labels.map((label,i)=>`<div><small>${label}</small><strong class="${/unavailable|fallback|disconnect|fault/i.test(values[i])?'warn':''}">${esc(values[i])}</strong></div>`).join('');
    $('wb-disconnect').disabled=pending||s.connections?.[experiment]===false;
    $('wb-reconnect').disabled=pending||s.connections?.[experiment]!==false;
  }
  function update(result){
    if(!initialized||!result.state)return;snapshot=result.state;network=result.network||network;
    $('wb-clock').textContent=fmt(snapshot.t,2);$('wb-profile').textContent=({engine:'ENGINE STAND',phev:'GENERIC HYBRID',braking:'BRAKING MODEL'})[snapshot.profile]||snapshot.profile;
    $('wb-ignition').checked=!!snapshot.inputs?.ignition;
    for(const key of ['throttle','brake']){if(document.activeElement!==$('wb-'+key))$('wb-'+key).value=Math.round((snapshot.inputs?.[key]||0)*100);$('wb-'+key+'-value').textContent=$('wb-'+key).value+'%';}
    addSamples(result);renderNodes();renderInspector();observe();renderScope();
    vehicle?.update(snapshot,network,catalog);protocols?.update(snapshot,network,catalog);dashboard?.update(result,catalog);playState();
    $('wb-nav-connection').textContent=snapshot.connections?.dlc===false?'○ Diagnostic CAN branch open':'● Virtual CAN connected';
    $('wb-nav-connection').classList.toggle('open',snapshot.connections?.dlc===false);
  }
  async function action(fn){
    if(pending)return;pending=true;observe();
    try{return await fn();}catch(e){window.LabUI.report(e.message||String(e));}finally{pending=false;observe();playState();}
  }
  async function chooseExperiment(id){
    if(!experiments[id])throw new Error('Unknown workbench experiment.');
    activeRun='experiment';experiment=id;const e=experiments[id];points=[];
    document.querySelectorAll('[data-experiment]').forEach(b=>{const active=b.dataset.experiment===id;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});
    $('wb-hint').textContent=e.hint;$('wb-mission-title').textContent=e.title;$('wb-mission-description').textContent=e.observe;$('wb-readout').hidden=true;
    await window.LabUI.loadExperiment(e);await window.LabUI.advance(.8);select(e.selection);
  }
  function chooseView(id){
    view=id;
    for(const panel of document.querySelectorAll('#visual-workbench .wb-view'))panel.hidden=panel.id!=='wb-view-'+id;
    for(const tab of document.querySelectorAll('[data-wb-view]')){const active=tab.dataset.wbView===id;tab.classList.toggle('active',active);tab.setAttribute('aria-selected',String(active));}
    const wide=id==='protocols';$('wb-layout').classList.toggle('wb-wide',wide);$('wb-layout').classList.toggle('wb-dashboard',id==='dashboard');$('wb-mission').hidden=wide||id==='objects'||id==='dashboard'||activeRun==='drive';$('wb-scope').hidden=wide||id==='objects'||id==='dashboard';
    const titles={dashboard:['Live session','A virtual car, its signals and its diagnostics. One shared simulation.'],panel:['Training panel','Select a socket, follow a wire, and observe what happens when its signal disappears.'],vehicle:['Virtual vehicle','Explore the body, the components and the connections beneath them.'],protocols:['Diagnostics','Ask an ECU a question. Follow the bytes. Understand the reply.'],objects:['Object layers','Physical parts, electrical connections, diagnostic meaning and presentation.']};
    if(titles[id]){$('wb-page-title').textContent=titles[id][0];$('wb-page-description').textContent=titles[id][1];}
    vehicle?.setVisible?.(visible&&id==='vehicle');dashboard?.setVisible?.(visible&&id==='dashboard');protocols?.setVisible?.(visible&&id==='protocols');requestAnimationFrame(()=>{vehicle?.resize();dashboard?.resize();renderScope();});
  }
  function setTheme(value){theme=value==='light'?'light':'dark';$('visual-workbench').classList.toggle('wb-dark',theme==='dark');document.body.classList.toggle('workbench-dark',visible&&theme==='dark');$('wb-theme').textContent=theme==='dark'?'☀ Light':'☾ Dark';$('wb-theme').setAttribute('aria-label',theme==='dark'?'Switch to light appearance':'Switch to dark appearance');vehicle?.setTheme?.(theme);dashboard?.setTheme?.(theme);try{localStorage.setItem('obdii-theme',theme);}catch{}}
  async function chooseDrive(id,definition){if(!definition)definition=window.DashboardView?.presets[id];if(!definition)throw new Error('Unknown drive.');activeRun='drive';document.querySelectorAll('[data-experiment]').forEach(b=>{b.classList.remove('active');b.setAttribute('aria-pressed','false');});await window.LabUI.loadExperiment(definition);select('engine');chooseView('dashboard');}
  function playState(){
    if(!initialized)return;const running=window.LabUI.isRunning();$('wb-run').textContent=running?'Ⅱ Pause':'▶ Run';$('wb-running-dot').classList.toggle('running',running);
  }
  async function initialize(){
    if(initialized||pendingInit||!window.LabUI?.meta())return;pendingInit=true;
    try{
      const response=await fetch('/api/network');if(!response.ok)throw new Error('Could not open the network object catalog.');catalog=await response.json();
      $('visual-workbench').innerHTML=markup();initialized=true;circuit();
      $('wb-object-browser').innerHTML=['components','sockets','wires'].flatMap(key=>(catalog[key]||[]).map(o=>`<button data-wb-select="${esc(o.id)}">${esc(o.id)}</button>`)).join('');
      $('wb-object-browser').onclick=e=>{const button=e.target.closest('[data-wb-select]');if(button)select(button.dataset.wbSelect);};
      vehicle=window.VehicleView?.create($('wb-vehicle-root'),{theme:'dark',onSelect:select,onConnection:(id,connected)=>action(()=>window.LabUI.connection(id,connected))});
      vehicle?.setVisible?.(false);
      protocols=window.ProtocolsView?.create($('wb-protocols-root'),{onRequest:(payload,canId)=>window.LabUI.diagnostic(payload,canId),onSelect:select,onExperiment:id=>action(async()=>{await chooseExperiment(id);chooseView('panel');})});
      dashboard=window.DashboardView?.create($('wb-dashboard-root'),{onRequest:(payload,canId)=>window.LabUI.diagnostic(payload,canId),onSelect:select,onConnection:(id,connected)=>action(()=>window.LabUI.connection(id,connected)),onPreset:(id,definition)=>action(()=>chooseDrive(id,definition)),onInspect:id=>{select(id);chooseView('panel');},onExplain:d=>{if(d)protocols?.showResult(d);protocols?.setSection?.('desk');chooseView('protocols');}});
      $('wb-theme').onclick=()=>setTheme(theme==='dark'?'light':'dark');try{theme=localStorage.getItem('obdii-theme')||'dark';}catch{}setTheme(theme);
      document.querySelectorAll('[data-wb-view]').forEach(button=>button.onclick=()=>chooseView(button.dataset.wbView));
      document.querySelectorAll('[data-experiment]').forEach(button=>button.onclick=()=>action(async()=>{await chooseExperiment(button.dataset.experiment);chooseView('panel');}));
      $('wb-run').onclick=()=>{if(window.LabUI.isRunning())window.LabUI.pause();else window.LabUI.play();playState();};
      $('wb-step-small').onclick=()=>action(async()=>{await window.LabUI.pause();await window.LabUI.advance(.1);});
      $('wb-step').onclick=()=>action(async()=>{await window.LabUI.pause();await window.LabUI.advance(1);});
      $('wb-reset').onclick=()=>activeRun==='drive'?dashboard?.reset():action(()=>chooseExperiment(experiment));$('wb-mission-reset').onclick=()=>action(()=>chooseExperiment(experiment));
      $('wb-playback').onchange=()=>{$('speed').value=$('wb-playback').value;};$('speed').value='1';
      $('wb-ignition').onchange=()=>window.LabUI.setInputs({ignition:$('wb-ignition').checked});
      for(const key of ['throttle','brake'])$('wb-'+key).oninput=()=>{$('wb-'+key+'-value').textContent=$('wb-'+key).value+'%';window.LabUI.setInputs({[key]:Number($('wb-'+key).value)/100});};
      $('wb-disconnect').onclick=()=>action(()=>window.LabUI.connection(experiment,false));
      $('wb-reconnect').onclick=()=>action(()=>window.LabUI.connection(experiment,true));
      $('wb-detect').onclick=()=>action(async()=>{await window.LabUI.pause();await window.LabUI.advance(.6);});
      $('wb-read').onclick=()=>action(async()=>{const payload=experiment==='ect'&&snapshot.dtcs?.length?'03':experiments[experiment].request;const result=await window.LabUI.diagnostic(payload,'7DF');if(result){$('wb-readout').hidden=false;$('wb-readout').textContent=`Request ${result.request_hex||payload} → ${result.response_hex||'No reply'}\n${result.meaning||result.error||''}`;protocols?.showResult(result);}});
      window.addEventListener('lab:state',e=>update(e.detail));
      window.addEventListener('lab:reset',()=>{points=[];});
      window.addEventListener('lab:play',playState);
      window.addEventListener('lab:diagnostic',e=>protocols?.showResult(e.detail.diagnostic));
      window.addEventListener('resize',()=>{renderScope();vehicle?.resize();dashboard?.resize();});
      if(!window.LabUI.state())await new Promise(resolve=>window.addEventListener('lab:state',resolve,{once:true}));
      update(window.LabUI.result());$('wb-hint').textContent=experiments.ect.hint;$('wb-mission-title').textContent=experiments.ect.title;$('wb-mission-description').textContent=experiments.ect.observe;await action(()=>chooseDrive('city_drive'));chooseView('dashboard');
    }catch(e){window.LabUI.report(e.message);if(!initialized)$('visual-workbench').textContent=e.message;}finally{pendingInit=false;}
  }
  window.Workbench={ready:()=>initialized&&!pendingInit&&!pending,select,chooseView,chooseDrive:id=>action(()=>chooseDrive(id)),chooseExperiment:id=>action(()=>chooseExperiment(id)),setVisible(value){visible=value;vehicle?.setVisible?.(value&&view==='vehicle');dashboard?.setVisible?.(value&&view==='dashboard');protocols?.setVisible?.(value&&view==='protocols');document.body.classList.toggle('workbench-dark',value&&theme==='dark');if(value)renderScope();},catalog:()=>catalog,selection:()=>selected,dashboard:()=>dashboard,setTheme};
  window.addEventListener('lab:ready',initialize);initialize();
})();
