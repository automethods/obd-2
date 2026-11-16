/* One vehicle state, physical telemetry and real in-memory diagnostic requests. */
(function () {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const fmt = (value, digits = 1) => finite(value) ? value.toFixed(digits) : '—';
  const at = (obj, path) => path.split('.').reduce((v, k) => v == null ? null : v[k], obj);
  const PIDS = {
    speed: {title:'Vehicle speed', pid:'0D', unit:'km/h', path:'speed_kph', color:'#f26770', digits:1, min:0, max:100},
    rpm: {title:'Engine speed', pid:'0C', unit:'rpm', path:'rpm', color:'#79a7ff', digits:0, min:0, max:4000},
    coolant: {title:'Coolant temperature', pid:'05', unit:'°C', path:'coolant_c', color:'#f1b768', digits:1, min:0, max:110},
    load: {title:'Engine load', pid:'04', unit:'%', path:'load_pct', color:'#43cdb1', digits:1, min:0, max:100}
  };
  const PRESETS = {
    city_drive:{name:'City drive', subtitle:'Traffic lights · pull-away · braking', profile:'phev', scenario:'city_drive'},
    road_cruise:{name:'Road cruise', subtitle:'Acceleration · hill · steady cruise', profile:'phev', scenario:'road_cruise'},
    manual_drive:{name:'Manual drive', subtitle:'Your accelerator and brake', profile:'phev', scenario:'manual', config:{initial_speed_kph:25,initial_coolant_c:70,initial_soc_pct:60}, inputs:{throttle:.15,brake:0}}
  };
  function decodeOBD(d) {
    const b=String(d?.response_hex || '').trim().split(/\s+/).filter(Boolean).map(x=>parseInt(x,16));
    if (b[0]!==0x41 || b.some(v=>!Number.isInteger(v))) return null;
    if (b[1]===0x0C && b.length>=4) return {key:'rpm',value:(b[2]*256+b[3])/4,formula:`(256 × ${b[2]} + ${b[3]}) ÷ 4`,bytes:b};
    if (b[1]===0x0D && b.length>=3) return {key:'speed',value:b[2],formula:`A = ${b[2]}`,bytes:b};
    if (b[1]===0x05 && b.length>=3) return {key:'coolant',value:b[2]-40,formula:`${b[2]} − 40`,bytes:b};
    if (b[1]===0x04 && b.length>=3) return {key:'load',value:b[2]*100/255,formula:`${b[2]} × 100 ÷ 255`,bytes:b};
    return null;
  }
  function append(points, point, max=6000) {
    if (!finite(point?.t)) return;
    if (points.length && point.t < points[points.length-1].t) points.length=0;
    if (points.length && point.t === points[points.length-1].t) points[points.length-1]=point;
    else points.push(point);
    if (points.length>max) points.splice(0,points.length-max);
  }
  function nearest(points,t) {
    if(!points.length)return null;
    let lo=0,hi=points.length-1;
    while(lo<hi){const mid=Math.floor((lo+hi)/2);if(points[mid].t<t)lo=mid+1;else hi=mid;}
    return lo>0&&Math.abs(points[lo-1].t-t)<Math.abs(points[lo].t-t)?points[lo-1]:points[lo];
  }
  function create(container,options={}) {
    let state=null,network=null,catalog=null,samples=[],scanSamples={speed:[],rpm:[],coolant:[],load:[]},frames=[],lastBytes=new Map(),lastDiagnostic=null;
    let visible=true,disposed=false,polling=false,pollEnabled=true,lastPollT=-Infinity,pollGeneration=0,selectedSignal='speed',windowSeconds=30,cursorT=null,theme='dark',recording=true;
    let expanded=null,frameSerial=0,requestCount=0,replyCount=0,lastReplyT=null,selectedObject='engine',activePreset='city_drive';
    const $=selector=>container.querySelector(selector);
    const $$=selector=>[...container.querySelectorAll(selector)];
    const chartMarkup=(id,title,unit,note)=>`<article class="dash-chart" data-chart-card="${id}"><header><div><h3><i></i>${title}</h3><small>${note}</small></div><div class="dash-chart-actions"><strong data-chart-value="${id}">— <small>${unit}</small></strong><button data-expand="${id}" aria-label="Expand ${title}">⤢</button></div></header><canvas data-chart="${id}" aria-label="${title}, ${unit}, against simulation time" role="img"></canvas><div class="dash-chart-legend" data-legend="${id}"></div></article>`;
    container.innerHTML=`
      <section class="dash-session-strip"><span class="dash-session-status"><i></i><b data-session-label>Paused session</b></span><span><span data-session-vehicle>Virtual hybrid</span> · <b data-phase>Ready for city driving</b></span><span class="dash-session-count"><b data-sample-count>0</b> telemetry samples</span><button data-action="record" title="Pause or resume the dashboard telemetry capture">Ⅱ Capture</button></section>
      <div class="dash-route-bar"><div class="dash-presets" role="group" aria-label="Choose a virtual drive">${Object.entries(PRESETS).map(([id,p])=>`<button data-preset="${id}" class="${id===activePreset?'active':''}" title="${p.subtitle}. Starts a new run."><span>${id==='city_drive'?'⌂':id==='road_cruise'?'↝':'◉'}</span><b>${p.name}</b><small>${p.subtitle}</small></button>`).join('')}</div><div class="dash-window"><label>Chart window<select data-window><option value="15">15 seconds</option><option value="30" selected>30 seconds</option><option value="60">60 seconds</option><option value="90">Full drive · 90 s</option></select></label></div></div>
      <section class="dash-metrics" aria-label="Live physical vehicle measurements">${Object.entries(PIDS).map(([id,p])=>`<button class="dash-metric ${id===selectedSignal?'active':''}" data-signal="${id}" style="--signal:${p.color}"><div><span>${p.title}</span><small>OBD PID 0x${p.pid}</small></div><strong data-metric="${id}">—</strong><em>${p.unit}</em><canvas data-spark="${id}" aria-hidden="true"></canvas><small class="dash-metric-note" data-metric-note="${id}">${id==='coolant'?'Physical temperature':'Physical model'}</small></button>`).join('')}</section>
      <div class="dash-main-grid"><section class="dash-car-card"><div class="dash-section-heading"><div><span class="dash-overline">VIRTUAL VEHICLE</span><h2>A vehicle behind every value.</h2></div><span class="dash-mode" data-mode>READY</span></div><div class="dash-vehicle-root"></div><div class="dash-car-stats"><span>Distance <b data-trip>0 m</b></span><span>Fuel used <b data-fuel-used>0.000 L</b></span><span>Battery <b data-soc>— %</b></span></div><div class="dash-selection"><div><small>SELECTED PART</small><strong data-part-name>Engine</strong><span data-part-value>Choose a part of the virtual vehicle</span></div><button data-action="inspect">Inspect wiring ↗</button></div><div class="dash-drive-progress"><div><span data-route-label>City drive · 90 seconds</span><b data-route-progress>0%</b></div><div class="dash-progress-track"><span data-route-fill></span></div><p data-route-note>Press Run above to start the virtual driver. All views share this session.</p></div></section>
      <section class="dash-chart-grid" aria-label="Live sensor charts">
       ${chartMarkup('speed','Vehicle & wheel speed','km/h','Physical vehicle · front-left sensor · driver target')}
       ${chartMarkup('rpm','Engine RPM','rpm','PID 0x0C · engine stops during electric driving')}
       ${chartMarkup('coolant','Coolant temperature','°C','Physical temperature compared with the ECU sensor')}
       ${chartMarkup('power','Power flow','kW','Battery discharge + · charging / regeneration −')}
      </section></div>
      <div class="dash-secondary-grid"><section class="dash-panel dash-inputs"><div class="dash-section-heading"><div><span class="dash-overline">DRIVER & RESPONSE</span><h2>Inputs have consequences.</h2></div><span class="dash-tag" data-driver>Virtual driver</span></div><div class="dash-dials">${[['throttle','Accelerator','#43cdb1'],['brake','Brake','#f26770'],['load','Engine load','#79a7ff']].map(([id,title,color])=>`<div class="dash-dial" style="--dial:${color}"><svg viewBox="0 0 130 80" aria-hidden="true"><path d="M15 65 A50 50 0 0 1 115 65" class="dash-dial-track"/><path d="M15 65 A50 50 0 0 1 115 65" class="dash-dial-fill" pathLength="100" data-dial="${id}"/><line x1="65" y1="65" x2="65" y2="24" data-needle="${id}"/><circle cx="65" cy="65" r="4"/></svg><strong data-dial-value="${id}">0<small>%</small></strong><span>${title}</span></div>`).join('')}</div><div class="dash-driver-controls"><label>Accelerator <output data-throttle-label>0%</output><input type="range" min="0" max="100" value="0" data-input="throttle" aria-label="Manual accelerator" disabled></label><label>Brake <output data-brake-label>0%</output><input type="range" min="0" max="100" value="0" data-input="brake" aria-label="Manual brake" disabled></label></div><p class="dash-help" data-driver-note>The virtual driver operates the pedals. Select Manual drive to take control.</p><div class="dash-mini-readings"><span>Acceleration <b data-accel>— m/s²</b></span><span>Fuel rate <b data-fuel-rate>— L/h</b></span><span>Road grade <b data-grade>— %</b></span></div></section>
      <section class="dash-panel dash-health"><div class="dash-section-heading"><div><span class="dash-overline">CONNECTIONS & HEALTH</span><h2>Make a fault visible.</h2></div><span class="dash-tag" data-health-tag>Healthy</span></div><p class="dash-help">Open a connection while the car is moving. Watch the sensor, controller and scan reply change together.</p><div class="dash-connection-list">${[['ect','Coolant sensor','Temperature input'],['dlc','Diagnostic connector','Scanner CAN branch'],['bmu','Battery monitor','CAN message freshness'],['wheel_fl','Front-left wheel sensor','Wheel-speed measurement']].map(([id,label,desc])=>`<button data-connection="${id}" aria-pressed="false"><i></i><span><b>${label}</b><small>${desc}</small></span><em>Connected</em><span class="dash-switch"></span></button>`).join('')}</div><div class="dash-health-note" data-health-note role="status">No stored emissions warnings.</div><div class="dash-health-actions"><button data-action="fault-step">Advance 0.6 s</button><button data-action="read-dtcs">Read stored DTCs</button><button data-action="clear-dtcs">Clear emissions memory</button></div><small class="dash-help">Repair restores signals. Stored faults may remain; a BMU shutdown may need a fresh drive.</small></section></div>
      <section class="dash-panel dash-scan"><div class="dash-section-heading"><div><span class="dash-overline">LIVE OBD SESSION</span><h2>From CAN bytes to a measurement.</h2></div><div class="dash-scan-tools"><label class="dash-check"><input type="checkbox" data-poll checked>Poll OBD while running</label><button data-action="scan-once">Scan now</button><button data-action="explain">Explain this request ↗</button></div></div><div class="dash-scan-status"><i></i><span data-scan-status>Ready. Run the drive or select Scan now.</span><span data-scan-count>0 requests · 0 replies</span></div><div class="dash-scan-grid"><div class="dash-decode-card"><div class="dash-decode-head"><label>Compare signal<select data-compare>${Object.entries(PIDS).map(([id,p])=>`<option value="${id}">${p.title} · 0x${p.pid}</option>`).join('')}</select></label><span class="dash-tag">0x7DF → 0x7E8</span></div><div class="dash-decoded-values"><div><small>Physical model</small><strong data-physical-value>—</strong></div><span>↔</span><div><small>Last decoded OBD reply</small><strong data-decoded-value>—</strong></div></div><div class="dash-byte-line"><span>Response bytes</span><code data-response-bytes>—</code></div><div class="dash-formula" data-decode-formula>Waiting for a diagnostic reply</div><div class="dash-compare-chart">${chartMarkup('compare','Model and decoded reply','','OBD values are sampled and quantized; sensor faults can diverge')}</div><p class="dash-help" data-decode-note>All requests go through the simulator’s diagnostic service and ISO-TP framing.</p></div><div class="dash-frame-card"><div class="dash-frame-head"><h3>CAN frame monitor</h3><label class="sr-only" for="dash-frame-filter">Filter CAN frames</label><select id="dash-frame-filter" data-frame-filter><option value="all">All frames</option><option value="7DF">0x7DF requests</option><option value="7E8">0x7E8 replies</option></select><button data-action="clear-monitor">Clear display</button></div><div class="dash-frame-table"><table><thead><tr><th>Sim. time</th><th>Dir.</th><th>CAN ID</th><th>Data bytes</th></tr></thead><tbody data-frames><tr><td colspan="4" class="dash-empty">Start a scan to see actual generated request and response frames.</td></tr></tbody></table></div><p class="dash-help">Highlighted bytes changed since the previous frame with this ID. These are in-memory diagnostic frames; electrical bus timing is not simulated.</p></div></div></section>
      <section class="dash-bottom-grid"><section class="dash-panel dash-events"><div class="dash-section-heading"><div><span class="dash-overline">SESSION LOG</span><h2>What the controllers decided.</h2></div><span class="dash-tag">Simulation time</span></div><div data-events class="dash-event-list"></div></section><section class="dash-panel dash-export"><span class="dash-overline">KEEP YOUR EXPERIMENT</span><h2>Record, compare, explain.</h2><p>The same session drives the vehicle, charts, wiring and scanner. Export it to examine your measurements or report a problem.</p><div><a href="/api/export.csv">↓ Signal CSV</a><a href="/api/export.json">↓ Complete run</a><a href="/api/trace.txt">↓ Diagnostic trace</a></div><a class="dash-guide-link" href="/docs/LIVE_DASHBOARD.html" target="_blank" rel="noopener">Dashboard and testing guide ↗</a><small>Original educational vehicle model · no physical adapter needed</small></section></section>
    `;
    const vehicle=window.VehicleView?.create($('.dash-vehicle-root'),{compact:true,theme:'dark',onSelect:id=>{selectedObject=id;options.onSelect?.(id);renderSelected();},onConnection:(id,value)=>options.onConnection?.(id,value)});
    const details={};
    function selectSignal(id){if(!PIDS[id])return;selectedSignal=id;$('[data-compare]').value=id;$$('[data-signal]').forEach(b=>b.classList.toggle('active',b.dataset.signal===id));renderDecode();drawAll();}
    function clearCapture(){recording=true;$('[data-action="record"]').textContent='Ⅱ Capture';$('[data-action="record"]').classList.remove('capture-paused');$('[data-scan-count]').textContent='0 requests · 0 replies';$('[data-scan-status]').textContent='Ready. Run the drive or select Scan now.';$('.dash-scan-status').classList.remove('warn');samples=[];for(const k of Object.keys(scanSamples))scanSamples[k]=[];frames=[];lastBytes.clear();lastDiagnostic=null;requestCount=replyCount=frameSerial=0;lastReplyT=null;lastPollT=-Infinity;cursorT=null;for(const k of Object.keys(details))delete details[k];renderFrames();renderDecode();}
    function onReset(){++pollGeneration;clearCapture();}
    function addResult(d){
      if(!d||disposed)return;
      lastDiagnostic=d;++requestCount;
      const t=finite(d.sample_t)?d.sample_t:(state?.t??0),decoded=decodeOBD(d);
      if(d.response_hex){++replyCount;lastReplyT=t;}
      const requested=Object.keys(PIDS).find(k=>d.request_hex===`01 ${PIDS[k].pid}`);
      if(decoded){details[decoded.key]={...decoded,t,d};append(scanSamples[decoded.key],{t,v:decoded.value},1800);}
      else if(requested)append(scanSamples[requested],{t,v:null},1800);
      for(const frame of d.frames||[]){const bytes=String(frame.data||'').split(/\s+/),key=frame.direction+frame.id,prior=lastBytes.get(key);frames.push({...frame,t,serial:++frameSerial,bytes,changed:bytes.map((b,i)=>!!prior&&prior[i]!==b)});lastBytes.set(key,bytes);}
      if(frames.length>180)frames.splice(0,frames.length-180);
      $('[data-scan-count]').textContent=`${requestCount} requests · ${replyCount} replies`;
      $('[data-scan-status]').textContent=d.timeout?'No response — the diagnostic CAN branch is open.':d.error?d.error:`${d.response_hex?'Reply received':'No application reply'} at ${fmt(t,2)} s · ${d.request_hex}`;
      $('.dash-scan-status').classList.toggle('warn',!!d.timeout||!!d.error);
      renderFrames();renderDecode();if(visible)drawChart('compare');
    }
    async function scanOnce(){
      if(polling||disposed)return;
      polling=true;const generation=pollGeneration;
      try{
        for(const key of ['speed','rpm','coolant','load']){
          if(disposed||generation!==pollGeneration)break;
          const d=await options.onRequest?.(`01 ${PIDS[key].pid}`,'7DF');
          if(d&&generation===pollGeneration)addResult(d);
        }
      }catch(e){window.LabUI?.report(e.message);}finally{polling=false;}
    }
    function maybePoll(){
      if(!visible||!pollEnabled||polling||!state||!window.LabUI?.isRunning()||window.LabUI?.isBusy())return;
      if(state.t-lastPollT>=.95){lastPollT=state.t;scanOnce();}
    }
    function renderFrames(){
      const filter=$('[data-frame-filter]').value;
      const recent=frames.filter(f=>filter==='all'||String(f.id).toUpperCase().replace(/^0X/,'')===filter).slice(-14).reverse();
      $('[data-frames]').innerHTML=recent.length?recent.map(f=>`<tr><td>${fmt(f.t,2)}</td><td class="${f.direction.startsWith('tester')?'tx':'rx'}">${f.direction.startsWith('tester')?'TX':'RX'}</td><td>${esc(f.id)}</td><td><div class="dash-frame-bytes">${f.bytes.map((b,i)=>`<span class="${f.changed[i]?'changed':''}" title="Byte ${i}: ${parseInt(b,16)} decimal">${esc(b)}</span>`).join('')}</div></td></tr>`).join(''):'<tr><td colspan="4" class="dash-empty">No frames in this display. Use Scan now or Run.</td></tr>';
    }
    function renderDecode(){
      const p=PIDS[selectedSignal],d=details[selectedSignal];
      $('[data-physical-value]').innerHTML=`${fmt(at(state,p.path),p.digits)} <small>${p.unit}</small>`;
      $('[data-decoded-value]').innerHTML=d?`${fmt(d.value,p.digits)} <small>${p.unit}</small>`:'—';
      $('[data-response-bytes]').textContent=d?.d.response_hex||'—';
      $('[data-decode-formula]').textContent=d?`${d.formula} = ${fmt(d.value,p.digits)} ${p.unit}`:'Waiting for this PID’s response';
      const absent=state?.connections?.dlc===false;
      $('[data-decode-note]').textContent=absent?'Connection open. The value above is the last successful reply; no new reply is available.':d?`Reply sampled at ${fmt(d.t,2)} s. ${selectedSignal==='coolant'&&state?.sensors?.ect_sensor_valid===false?'The −40 °C sensor marker is invalid, while physical coolant remains warm.':'Quantization and sampling can make the decoded value differ slightly from the physical model.'}`:'Start the live scan to compare received bytes with the physical model.';
      $('.dash-decode-card').classList.toggle('stale',absent);
    }
    function renderSelected(){
      const item=catalog?.components?.find(c=>c.id===selectedObject)||catalog?.wires?.find(c=>c.id===selectedObject)||catalog?.sockets?.find(c=>c.id===selectedObject);
      $('[data-part-name]').textContent=item?.label||item?.name||selectedObject.replaceAll('_',' ');
      const readings={engine:`${fmt(state?.rpm,0)} rpm · ${fmt(state?.engine_shaft_kw)} kW`,coolant_sensor:`${fmt(state?.sensors?.ect_voltage_v,2)} V · ${state?.sensors?.ect_sensor_valid===false?'invalid measurement':'valid measurement'}`,battery:`${fmt(state?.soc_pct)}% · ${fmt(state?.battery_power_kw)} kW`,ecu:state?.engine_running?'Engine running':'Engine stopped',dlc:state?.connections?.dlc===false?'Diagnostic branch disconnected':'Diagnostic branch connected'};
      const wire=network?.wires?.[selectedObject];
      $('[data-part-value]').textContent=readings[selectedObject]||(wire?`${wire.available===false?'Unavailable':fmt(wire.value,2)} ${wire.unit||''} · ${wire.connected===false?'open':'connected'}`:item?.description||'Open the wiring view to inspect properties, sockets and signals.');
    }
    function renderState(result){
      if(!state)return;
      const running=window.LabUI?.isRunning(),manual=state.scenario==='manual';
      $('.dash-session-status').classList.toggle('live',!!running);
      $('[data-session-label]').textContent=running?'Live session':'Paused session';
      $('[data-session-vehicle]').textContent=state.profile==='engine'?'Engine stand':state.profile==='braking'?'Braking vehicle':'Virtual hybrid';
      $('[data-phase]').textContent=state.drive_phase||(state.profile==='engine'?'Engine stand':'Manual experiment');
      $('[data-sample-count]').textContent=samples.length;
      $('[data-mode]').textContent=String(state.mode||'READY').replaceAll('_',' ');
      for(const [id,p] of Object.entries(PIDS))$(`[data-metric="${id}"]`).textContent=fmt(at(state,p.path),p.digits);
      $('[data-metric-note="rpm"]').textContent=state.rpm<1&&state.speed_kph>1?'Electric driving · engine stopped':'Physical crankshaft speed';
      $('[data-metric-note="coolant"]').textContent=state.sensors?.ect_sensor_valid===false?'Sensor invalid · physical value shown':`ECU sensor ${fmt(state.sensors?.ect_c)} °C`;
      $('[data-trip]').textContent=state.distance_m>=1000?fmt(state.distance_m/1000,2)+' km':fmt(state.distance_m,0)+' m';
      $('[data-soc]').textContent=state.profile==='engine'?'Not installed':fmt(state.soc_pct)+'%';
      $('[data-fuel-used]').textContent=fmt(state.energy?.fuel_l,3)+' L';
      $('[data-accel]').textContent=fmt(state.acceleration_m_s2,2)+' m/s²';
      $('[data-fuel-rate]').textContent=fmt(state.fuel_l_h,2)+' L/h';
      $('[data-grade]').textContent=fmt(state.inputs?.grade_pct)+'%';
      const progress=state.drive_cycle?.progress??0;
      $('[data-route-progress]').textContent=state.drive_cycle?fmt(progress*100,0)+'%':'MANUAL';
      $('[data-route-fill]').style.width=(progress*100)+'%';
      $('[data-route-label]').textContent=state.drive_cycle?`${PRESETS[state.scenario]?.name||'Drive'} · ${state.drive_cycle.duration_s} seconds`:'Free driving · no fixed route';
      $('[data-route-note]').textContent=state.drive_cycle?.complete?'Drive complete. Reset or choose another drive to start a new session.':state.drive_cycle?`${state.drive_phase} · target ${fmt(state.drive_target_kph,0)} km/h. Actual speed responds to the pedals, road and faults.`:'Use accelerator and brake. Opening a sensor changes measurement availability, while the physical vehicle keeps responding.';
      $('[data-driver]').textContent=manual?'Manual controls':'Virtual driver';
      $('[data-driver-note]').textContent=manual?'Move a pedal, then Run or step. Your inputs drive the vehicle model.':'The virtual driver operates the pedals. Select Manual drive to take control.';
      for(const id of ['throttle','brake','load']){const value=Math.max(0,Math.min(100,id==='load'?state.load_pct||0:(state.inputs?.[id]||0)*100));$(`[data-dial="${id}"]`).style.strokeDasharray=`${value} 100`;$(`[data-needle="${id}"]`).setAttribute('transform',`rotate(${-90+value*1.8} 65 65)`);$(`[data-dial-value="${id}"]`).innerHTML=fmt(value,0)+'<small>%</small>';if(id!=='load'){const input=$(`[data-input="${id}"]`);input.disabled=!manual;if(document.activeElement!==input)input.value=value;$(`[data-${id}-label]`).textContent=fmt(value,0)+'%';}}
      for(const button of $$('.dash-connection-list [data-connection]')){const id=button.dataset.connection,connected=state.connections?.[id]!==false,installed=state.profile!=='engine'||!['bmu','wheel_fl'].includes(id);button.disabled=!installed;button.classList.toggle('open',!connected);button.setAttribute('aria-pressed',String(!connected));button.querySelector('em').textContent=!installed?'Not installed':connected?'Connected':'Open';}
      const codes=[...(state.dtcs||[]),...(state.pending_dtcs||[]),...Object.values(state.module_dtc||{}).flat()];
      const open=Object.entries(state.connections||{}).filter(([,connected])=>!connected).map(([id])=>id);
      $('[data-health-tag]').textContent=codes.length?'Warning':open.length?'Connection open':'Healthy';
      $('[data-health-tag]').classList.toggle('warn',!!codes.length||!!open.length);
      $('[data-health-note]').textContent=codes.length?`Stored / pending: ${[...new Set(codes)].join(' · ')}`:open.length?'An open connection is present. Advance time to see its sampled control consequences.':'No stored emissions warnings. Module state and connection status are shown separately.';
      if(result?.events)$('[data-events]').innerHTML=result.events.slice(-5).reverse().map(e=>`<div><time>${fmt(e.t,2)} s</time><span><b>${esc(e.source||'System')}</b>${esc(e.message)}</span></div>`).join('')||'<p class="dash-help">Controller decisions appear as the simulation advances.</p>';
      const preset=Object.keys(PRESETS).find(id=>id===state.scenario)||(manual&&state.profile==='phev'?'manual_drive':null);
      if(preset)activePreset=preset;$$('[data-preset]').forEach(b=>b.classList.toggle('active',b.dataset.preset===preset));
      renderSelected();renderDecode();
    }
    function chartSpec(id){
      const physical=(path,color,label)=>({points:samples.map(s=>({t:s.t,v:at(s,path)})),color,label});
      if(id==='speed')return {min:0,max:100,unit:'km/h',series:[physical('speed_kph','#f26770','Vehicle'),physical('sensors.wheel_speeds_kph.0','#43cdb1','FL sensor'),{...physical('drive_target_kph','#7e8ba2','Target'),dash:true}]};
      if(id==='rpm')return {min:0,max:4000,unit:'rpm',series:[physical('rpm','#79a7ff','Physical engine'),{points:scanSamples.rpm,color:'#e8bc79',label:'OBD reply',dots:true}]};
      if(id==='coolant')return {min:state?.sensors?.ect_sensor_valid===false?-45:0,max:110,unit:'°C',series:[physical('coolant_c','#f1b768','Physical'),{...physical('sensors.ect_c','#79a7ff','ECU sensor'),dash:true}]};
      if(id==='power')return {min:-35,max:50,unit:'kW',series:[physical('battery_power_kw','#43cdb1','Battery'),physical('engine_shaft_kw','#f26770','Engine')]};
      const p=PIDS[selectedSignal];return {min:selectedSignal==='coolant'&&state?.sensors?.ect_sensor_valid===false?-45:p.min,max:p.max,unit:p.unit,series:[physical(p.path,p.color,'Physical model'),{points:scanSamples[selectedSignal],color:'#d5b7ff',label:'Decoded OBD',dots:true}]};
    }
    function chartBounds(){const end=Math.max(10,state?.t||0);return {end,start:Math.max(0,end-windowSeconds)};}
    function drawChart(id){
      const canvas=$(`[data-chart="${id}"]`),rect=canvas.getBoundingClientRect();if(!rect.width||!rect.height)return;
      const dpr=Math.min(window.devicePixelRatio||1,2),w=rect.width,h=rect.height;
      if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);}
      const c=canvas.getContext('2d');if(!c)return;c.setTransform(dpr,0,0,dpr,0,0);c.clearRect(0,0,w,h);
      const spec=chartSpec(id),{start,end}=chartBounds(),left=40,right=12,top=14,bottom=24,pw=w-left-right,ph=h-top-bottom;
      const all=spec.series.flatMap(s=>s.points.filter(p=>p.t>=start&&finite(p.v)).map(p=>p.v));let min=Math.min(spec.min,...all),max=Math.max(spec.max,...all);if(max===min)max=min+1;
      const x=t=>left+(t-start)/(end-start)*pw,y=v=>top+(max-v)/(max-min)*ph;
      const dark=theme==='dark';c.font='10px ui-monospace,monospace';c.lineWidth=1;c.textAlign='right';
      for(let i=0;i<=3;i++){const v=min+(max-min)*i/3,py=y(v);c.strokeStyle=dark?'#2b323d':'#e1e6ec';c.setLineDash([3,4]);c.beginPath();c.moveTo(left,py);c.lineTo(w-right,py);c.stroke();c.fillStyle=dark?'#8b96a8':'#758197';c.fillText(fmt(v,Math.abs(max-min)<6?1:0),left-7,py+3);}
      c.setLineDash([]);c.textAlign='center';for(let i=0;i<=3;i++){const t=start+(end-start)*i/3;c.fillText(fmt(t,0)+'s',x(t),h-5);}
      for(const series of spec.series){const points=series.points.filter(p=>p.t>=start&&p.t<=end);c.save();c.beginPath();c.rect(left,top,pw,ph);c.clip();c.strokeStyle=series.color;c.fillStyle=series.color;c.lineWidth=series.dots?1.4:2;c.setLineDash(series.dash?[4,4]:[]);let pen=false;c.beginPath();for(const p of points){if(!finite(p.v)){pen=false;continue;}if(!pen){c.moveTo(x(p.t),y(p.v));pen=true;}else c.lineTo(x(p.t),y(p.v));}c.stroke();if(series.dots){c.setLineDash([]);for(const p of points){if(!finite(p.v))continue;c.beginPath();c.arc(x(p.t),y(p.v),2.3,0,2*Math.PI);c.fill();}}c.restore();}
      const t=cursorT===null?state?.t||0:cursorT;
      if(cursorT!==null&&cursorT>=start&&cursorT<=end){c.strokeStyle=dark?'#abb6c7':'#566379';c.setLineDash([2,3]);c.beginPath();c.moveTo(x(t),top);c.lineTo(x(t),h-bottom);c.stroke();c.setLineDash([]);}
      const v=nearest(spec.series[0].points,t)?.v;
      $(`[data-chart-value="${id}"]`).innerHTML=`${fmt(v,id==='rpm'?0:1)} <small>${spec.unit}</small>`;
      $(`[data-legend="${id}"]`).innerHTML=spec.series.map(s=>{const v=nearest(s.points,t)?.v;return `<span><i style="background:${s.color}"></i>${s.label}${cursorT!==null?` <b>${finite(v)?fmt(v,id==='rpm'?0:1):'—'}</b>`:''}</span>`;}).join('')+(cursorT!==null?`<time>${fmt(t,2)} s</time>`:'');
    }
    function drawSparks(){
      for(const [id,p] of Object.entries(PIDS)){const canvas=$(`[data-spark="${id}"]`),rect=canvas.getBoundingClientRect();if(!rect.width)continue;const dpr=Math.min(window.devicePixelRatio||1,2);canvas.width=rect.width*dpr;canvas.height=rect.height*dpr;const c=canvas.getContext('2d');if(!c)continue;c.scale(dpr,dpr);const points=samples.filter(s=>s.t>=(state?.t||0)-30).map(s=>({t:s.t,v:at(s,p.path)})),values=points.filter(s=>finite(s.v)).map(s=>s.v);if(!values.length)continue;const min=Math.min(...values),max=Math.max(min+1,...values),span=Math.max(1,points[points.length-1].t-points[0].t);c.strokeStyle=p.color;c.lineWidth=1.7;c.beginPath();let pen=false;for(const s of points){if(!finite(s.v)){pen=false;continue;}const x=(s.t-points[0].t)/span*rect.width,y=rect.height-3-(s.v-min)/(max-min)*(rect.height-6);if(pen)c.lineTo(x,y);else{c.moveTo(x,y);pen=true;}}c.stroke();}
    }
    function drawAll(){if(!visible)return;for(const id of ['speed','rpm','coolant','power','compare'])drawChart(id);drawSparks();}
    async function command(fn){try{await fn();}catch(e){window.LabUI?.report(e.message||String(e));}}
    $$('[data-preset]').forEach(b=>b.onclick=()=>command(()=>options.onPreset?.(b.dataset.preset,PRESETS[b.dataset.preset])));
    $$('[data-signal]').forEach(b=>b.onclick=()=>selectSignal(b.dataset.signal));
    $('[data-compare]').onchange=e=>selectSignal(e.target.value);
    $('[data-window]').onchange=e=>{windowSeconds=Number(e.target.value);cursorT=null;drawAll();};
    $('[data-poll]').onchange=e=>{pollEnabled=e.target.checked;lastPollT=-Infinity;};
    $('[data-frame-filter]').onchange=renderFrames;
    $$('[data-input]').forEach(input=>input.oninput=()=>{window.LabUI?.setInputs({[input.dataset.input]:Number(input.value)/100});$(`[data-${input.dataset.input}-label]`).textContent=input.value+'%';});
    $$('.dash-connection-list [data-connection]').forEach(b=>b.onclick=()=>command(()=>options.onConnection?.(b.dataset.connection,state?.connections?.[b.dataset.connection]===false)));
    $$('[data-action]').filter(button=>!button.closest('.dash-vehicle-root')).forEach(button=>button.onclick=()=>command(async()=>{
      const action=button.dataset.action;
      if(action==='record'){if(!recording&&samples.length&&state?.t>samples[samples.length-1].t)append(samples,{t:(samples[samples.length-1].t+state.t)/2,capture_gap:true});recording=!recording;button.textContent=recording?'Ⅱ Capture':'▶ Capture';button.classList.toggle('capture-paused',!recording);button.title=recording?'Pause dashboard telemetry capture':'Resume dashboard telemetry capture';}
      if(action==='inspect')options.onInspect?.(selectedObject);
      if(action==='scan-once')await scanOnce();
      if(action==='explain')options.onExplain?.(details[selectedSignal]?.d||lastDiagnostic);
      if(action==='clear-monitor'){frames=[];lastBytes.clear();renderFrames();}
      if(action==='fault-step'){await window.LabUI?.pause();await window.LabUI?.advance(.6);}
      if(action==='read-dtcs'||action==='clear-dtcs'){const d=await options.onRequest?.(action==='read-dtcs'?'03':'04','7DF');if(d){addResult(d);$('[data-health-note]').textContent=d.meaning||d.error||'No reply';}}
    }));
    $$('[data-expand]').forEach(button=>button.onclick=()=>{const id=button.dataset.expand;expanded=expanded===id?null:id;$$('[data-chart-card]').forEach(card=>card.classList.toggle('expanded',card.dataset.chartCard===expanded));button.setAttribute('aria-expanded',String(expanded===id));requestAnimationFrame(drawAll);});
    $$('[data-chart]').forEach(canvas=>{canvas.addEventListener('pointermove',e=>{const r=canvas.getBoundingClientRect(),{start,end}=chartBounds();cursorT=start+Math.max(0,Math.min(1,(e.clientX-r.left-40)/(r.width-52)))*(end-start);drawAll();});canvas.addEventListener('pointerleave',()=>{cursorT=null;drawAll();});});
    const observer=typeof ResizeObserver!=='undefined'?new ResizeObserver(()=>{if(visible)drawAll();}):null;observer?.observe(container);
    const timer=setInterval(maybePoll,170);
    const playListener=()=>renderState(null);window.addEventListener('lab:play',playListener);window.addEventListener('lab:reset',onReset);
    return {
      update(result,nextCatalog){if(!result?.state)return;state=result.state;network=result.network||network;catalog=nextCatalog||catalog;if(recording){for(const s of result.history||[])append(samples,s);append(samples,state);}vehicle?.update(state,network,catalog);renderState(result);drawAll();},
      setVisible(value){visible=!!value;vehicle?.setVisible?.(visible);if(visible){renderState(null);requestAnimationFrame(drawAll);}},
      setTheme(value){theme=value==='light'?'light':'dark';vehicle?.setTheme?.(theme);drawAll();},
      selectSignal,scanOnce,
      preset:()=>activePreset,
      reset:()=>options.onPreset?.(activePreset,PRESETS[activePreset]),
      resize(){vehicle?.resize?.();drawAll();},
      inspect:()=>({sampleCount:samples.length,requests:requestCount,replies:replyCount,lastReplyT,frameCount:frames.length,selectedSignal,visible,pollEnabled,recording,vehicle:vehicle?.inspect?.()}),
      dispose(){disposed=true;++pollGeneration;clearInterval(timer);observer?.disconnect();window.removeEventListener('lab:play',playListener);window.removeEventListener('lab:reset',onReset);vehicle?.dispose?.();}
    };
  }
  window.DashboardView={create,decodeOBD,presets:PRESETS};
})();
