/* The application shell owns selection and navigation; views never own time. */
(() => {
  'use strict';
  const $=selector=>document.querySelector(selector), $$=selector=>Array.from(document.querySelectorAll(selector));
  const M=window.AppModel, esc=M.escape, session=window.AppSession.create();
  let current=null,renderGeneration=0,treeKey='',inspectorKey='',dock=null,dockExpanded=false,selectedMessage=null,messageKey='',eventKey='',previousView='',previousStage='',configurationKey='',drawerFocus=null,speedHistoryKey='';
  const format=(v,unit='')=>v==null?'—':(typeof v==='number'?(Number.isFinite(v)?v.toLocaleString(window.AppI18n?.locale||'en-US',{maximumFractionDigits:unit==='rpm'?0:2}):'—'):typeof v==='boolean'?(v?'Yes':'No'):Array.isArray(v)?v.join(', '):String(v));
  const invoke=promise=>Promise.resolve(promise).catch(error=>{session.error=error.message;session.emit();});
  window.LabUI={isRunning:()=>session.running};
  function showDock(name) {
    dock=name;$('#dock-content').hidden=!name;$('#messages-pane').hidden=name!=='messages';$('#events-pane').hidden=name!=='events';
    $$('[data-dock]').forEach(b=>b.setAttribute('aria-expanded',String(b.dataset.dock===name)));
    $('[data-action="collapse-dock"]').hidden=!name;
    $('[data-action="expand-dock"]').hidden=!name;if(!name)dockExpanded=false;renderDockSize();
    if(current)renderDock(current,true);Object.values(views).forEach(v=>v.resize?.());
  }
  function renderDockSize(){const button=$('[data-action="expand-dock"]');$('#message-dock').classList.toggle('expanded',dockExpanded);button.setAttribute('aria-expanded',String(dockExpanded));button.textContent=dockExpanded?'Compact trace':'Expand trace';}
  const options={
    embeddedSettings:false,
    onSelect:id=>session.select(id),onNavigate:id=>session.navigate(id),onWatch:(id,value)=>session.setWatch(id,value),
    onConnection:(id,value)=>session.connection(id,value),onConnectionFault:(id,settings)=>session.connectionFault(id,settings),onAdvance:seconds=>session.advance(seconds).finally(()=>session.setRunning(true)),onInputs:inputs=>session.setInputs(inputs),onReset:()=>session.reset(),
    onControl:(action,value)=>session.control(action,value),onStart:settings=>session.start(settings),onShift:(gear,settings)=>session.shift(gear,settings),onConfigure:(id,options)=>session.configure(id,options),onSetup:(id,hardware,settings)=>session.commitSetup(id,hardware,settings),
    onChooseWorkspace:mode=>session.enterWorkspace(mode),onBackToVehicle:()=>session.backToVehicle(),onCancelSetup:()=>session.cancelSetup(),onExport:()=>saveSession(),
    onManualOverride:()=>session.overrideCycle(),
    onLiveVisibility:value=>{session.scanLive.visible=value;},
    onLiveChange:settings=>{session.setLiveData(settings);if((settings.ids||settings.enabled||settings.interval!==undefined)&&session.liveDataActive())return invoke(session.readLiveData());},
    onScanner:(action,settings)=>session.scannerAction(action,settings),onPoll:settings=>session.setScannerPolling(settings),
    onRequest:async(payload,canId)=>{const d=await session.request(payload,canId);selectedMessage=session.records.at(-1)?.number ?? null;if(current&&dock==='messages')renderDock(current,true);return d;}
  };
  const views={setup:window.SetupView.create($('#view-setup'),options),drive:window.CockpitView.create($('#cockpit-content'),options),overview:window.UnitMapView.create($('#view-overview'),options),
    live:window.LiveDataView.create($('#view-live'),options),diagnosis:window.DiagnosisView.create($('#view-diagnosis'),options),scan:window.ScannerView.create($('#view-scan'),options),
    wiring:window.ConnectionView.create($('#view-wiring'),options),locations:window.LocationsView.create($('#view-locations'),options)};
  const monitor=window.VehicleMonitor.create($('#service-dashboard'),{...options,
    bindPedals:(controls,isActive)=>views.drive.bindPedals(controls,'service',isActive),
    onReleaseControls:()=>views.drive.releaseControls(),onTakeControl:()=>session.cycleAction('stop')});
  function renderTree(ctx) {
    const query=$('#system-filter').value.trim().toLowerCase(),units=ctx.systems.units || [],key=JSON.stringify([ctx.state.vehicle?.configuration,query,units.map(u=>[u.id,u.installed])]);
    if(key!==treeKey) {
      treeKey=key;const icons={engine:'chip',ecu:'chip',battery:'battery',bmu:'battery',abs:'wheel',dlc:'plug',scan_tool:'test',cluster:'chart'};
      const item=(id,label,kind,description='')=>`<button class="tree-item" data-select="${esc(id)}" title="${esc(description)}"><svg><use href="#i-${kind}"/></svg><span>${esc(label)}</span><i class="tree-dot" data-component-dot="${esc(id)}"></i></button>`;
      const groups=[...new Set(units.map(u=>u.group))];
      $('#system-tree').innerHTML=item('overview','Whole vehicle','car')+groups.map(group=>{
        const visible=units.filter(u=>u.group===group&&(!query||`${u.id} ${u.label} ${group} ${window.AppI18n?.t(u.label)||''} ${window.AppI18n?.t(group)||''}`.toLowerCase().includes(query)));
        return visible.length?`<div class="tree-group"><h3>${esc(group)}</h3>${visible.map(u=>item(u.id,u.label,icons[u.id]||'chip',u.description+(u.installed===false?' · Not fitted':''))).join('')}</div>`:'';
      }).join('');
    }
    const selected=M.resolveSelection(ctx.selection,ctx.catalog,ctx.signals),sensor=ctx.systems.sensors?.find(s=>s.component_id===selected.componentId),active=sensor?.unit_id || selected.componentId || 'overview';
    $$('#system-tree [data-select]').forEach(button=>{
      const id=button.dataset.select, component=ctx.network?.components?.[id],unit=units.find(u=>u.id===id);
      button.classList.toggle('active',id===active);button.setAttribute('aria-pressed',String(id===active));button.disabled=unit?.installed===false;
      const dot=button.querySelector('.tree-dot');if(dot){dot.classList.toggle('offline',unit?.installed===false);
        dot.classList.toggle('fault',ctx.network?.effective_connections?.['unit_'+id]===false||/fault|invalid|stale|fallback|degraded|timeout|disconnected/i.test(component?.status || ''));}
    });
  }
  function connectionFor(selected,ctx) {
    if(selected.kind==='wire')return selected.object?.connection_id;
    const socket=ctx.catalog.sockets?.find(s=>s.id===selected.socketId);
    if(socket?.connection_id)return socket.connection_id;
    const sensor=ctx.systems.sensors?.find(s=>s.component_id===selected.componentId);if(sensor?.connection_id)return sensor.connection_id;
    const unitConnection='unit_'+selected.componentId;if(ctx.catalog.connections?.some(c=>c.id===unitConnection))return unitConnection;
    return ({coolant_sensor:'ect',dlc:'dlc',scan_tool:'dlc',bmu:'bmu',wheel_fl:'wheel_fl'})[selected.componentId];
  }
  function relatedSignals(selected,ctx) {
    if(selected.kind==='wire')return selected.signalId?[selected.signalId]:[];
    if(selected.signalId)return [selected.signalId];
    if(selected.kind==='pin')return [...new Set((ctx.catalog.wires || []).filter(w=>
      [w.from,w.to].some(e=>e.socket_id===selected.socketId&&e.pin===selected.pin)).map(w=>w.signal_id).filter(Boolean))];
    if(selected.kind==='socket')return [...new Set((ctx.catalog.wires || []).filter(w=>[w.from,w.to].some(e=>e.socket_id===selected.socketId)).map(w=>w.signal_id).filter(Boolean))];
    const comp=ctx.catalog.components?.find(c=>c.id===selected.componentId);
    return [...new Set([...Object.values(comp?.bindings || {}),...M.signalIdsForComponent(selected.componentId,ctx.signals)])].filter(id=>ctx.signals.some(s=>s.id===id)).slice(0,5);
  }
  function inspectorStatic(selected,ctx) {
    if(selected.kind==='overview')return `<div class="inspector-kind">SIMULATION</div><h2 class="inspector-title">One vehicle session</h2><p class="inspector-description">Pick a component on the left. Its measurements, test, wiring and location stay connected as you change views.</p><div class="inspector-value"><strong data-model-speed>—</strong> <small>km/h</small><p data-model-mode>Vehicle state</p></div><div class="overview-actions"><button data-action="start-example">${icon('test')} Diagnose a coolant fault</button><button data-select="socket:dlc_socket" data-go="wiring">${icon('plug')} Inspect the OBD socket</button><button data-go="locations">${icon('pin')} Find components on the car</button></div><div class="inspector-block"><h4>LIVE SESSION</h4><dl class="inspector-measurements"><div><dt>Model</dt><dd data-model-profile>—</dd></div><div><dt>Stored emissions codes</dt><dd data-model-dtcs>—</dd></div><div><dt>Controller mode</dt><dd data-model-status>—</dd></div></dl></div><p class="inspector-hint">Run controls apply to every view. Selecting and inspecting an object does not change simulation time.</p>`;
    const component=ctx.catalog.components?.find(c=>c.id===selected.componentId),object=selected.object || {},signals=relatedSignals(selected,ctx);
    const socket=ctx.catalog.sockets?.find(s=>s.id===selected.socketId),connection=connectionFor(selected,ctx);
    const connectionInfo=ctx.catalog.connections?.find(c=>c.id===connection);
    const signal=signals[0],metadata=ctx.signals.find(s=>s.id===signal);
    const sensor=ctx.systems.sensors?.find(s=>s.component_id===selected.componentId||s.id===metadata?.sensor_id);
    const selectedWire=selected.kind==='wire'?object:selected.kind==='pin'?(ctx.catalog.wires || []).find(w=>[w.from,w.to].some(e=>e.socket_id===selected.socketId&&e.pin===selected.pin)):null;
    const sockets=selected.kind==='component'?(ctx.catalog.sockets || []).filter(s=>s.component_id===selected.componentId):socket?[socket]:[];
    const wireEndpoints=selected.kind==='wire'?`<div class="inspector-block"><h4>ENDPOINTS</h4><div class="inspector-links">${[object.from,object.to].map(e=>`<button data-select="pin:${esc(e.socket_id)}:${e.pin}" data-go="wiring">${esc(e.socket_id)} · pin ${e.pin}</button>`).join('')}</div></div>`:'';
    const properties={...(object.properties || {}),...(selected.kind==='pin'?{role:object.role,connector:socket?.label}:{}),...(selected.kind==='wire'?{kind:object.kind,signal:object.signal_id}:{}),...(selected.kind==='signal'?{source:object.source,period_ms:object.period_ms,provenance:object.provenance}:{}),id:selected.id};
    return `<div class="inspector-kind">${esc(selected.kind)}${selected.kind==='pin'?' · '+selected.pin:''}</div><h2 class="inspector-title">${esc(selected.label)}</h2><p class="inspector-description">${esc(object.description || component?.description || '')}</p>
      ${selectedWire?`<div class="inspector-value"><strong data-wire-value="${esc(selectedWire.id)}">—</strong> <small>${esc(selectedWire.unit || '')}</small><p data-wire-validity="${esc(selectedWire.id)}"></p></div>`:signal?`<div class="inspector-value"><strong data-signal-value="${esc(signal)}">—</strong> <small>${esc(metadata?.unit || '')}</small><p data-signal-validity="${esc(signal)}">${esc(metadata?.label || signal)}</p></div>`:''}
      <div class="inspector-actions">${signal?`<button data-action="graph-selection">${selectedWire?.kind==='can'?'Graph model signal':'Graph signal'}</button>`:''}<button data-go="wiring">Open wiring</button><button data-go="locations">Show location</button><button data-go="diagnostics">Diagnose</button></div>
      ${selectedWire?.kind==='can'?'<p class="inspector-hint">The graph follows the underlying model signal. Connection availability is shown above; it is not a CAN voltage trace.</p>':''}
      ${connection?`<div class="connection-state" data-connection-panel="${connection}"><strong data-connection-status="${connection}">Connected</strong><p>${esc(connectionInfo?.description || (connection==='dlc'?'Switches the tester CAN branch; supply and ground references remain.':'The connection affects the shared vehicle. Sample to observe controller response.'))}</p><button data-connection-id="${connection}">Disconnect</button></div>`:''}
      ${sensor?`<details class="inspector-properties"><summary>Conversion path</summary><div data-inspector-conversion="${esc(sensor.id)}"></div></details>`:''}
      ${sockets.length?`<div class="inspector-block"><h4>CONNECTORS</h4><div class="inspector-links">${sockets.map(s=>`<button data-select="socket:${esc(s.id)}" data-go="wiring">${esc(s.label)} <small>· ${s.pins.length} pins</small></button>`).join('')}</div></div>`:''}${wireEndpoints}
      ${signals.length?`<div class="inspector-block"><h4>RELATED READINGS</h4><dl class="inspector-measurements">${signals.map(id=>{const s=ctx.signals.find(x=>x.id===id);return `<div><dt><button class="quiet" data-select="signal:${esc(id)}" title="Inspect ${esc(s?.label || id)}">${esc(s?.label || id)}</button></dt><dd data-signal-small="${esc(id)}">—</dd></div>`;}).join('')}</dl></div>`:''}
      <details class="inspector-properties"><summary>Object properties</summary><dl>${Object.entries(properties).map(([k,v])=>`<dt>${esc(k.replace(/_/g,' '))}</dt><dd>${esc(typeof v==='object'?JSON.stringify(v):v)}</dd>`).join('')}</dl></details>`;
  }
  function icon(id){return `<svg><use href="#i-${id}"/></svg>`;}
  function renderInspector(ctx) {
    const selected=M.resolveSelection(ctx.selection,ctx.catalog,ctx.signals),key=ctx.selection+'|'+JSON.stringify(ctx.state.vehicle?.configuration || ctx.state.profile);
    if(key!==inspectorKey){inspectorKey=key;$('#inspector-content').innerHTML=inspectorStatic(selected,ctx);}
    const component=ctx.catalog.components?.find(c=>c.id===selected.componentId);
    $$('[data-inspector-conversion]').forEach(node=>{const markup=M.conversionMarkup(ctx.state.vehicle_sensors?.[node.dataset.inspectorConversion]?.conversion);if(node.innerHTML!==markup)node.innerHTML=markup;});
    $('#selection-breadcrumb').innerHTML=`Vehicle <span>/</span>${selected.kind!=='component'&&component?esc(component.label)+' <span>/</span>':''}${esc(selected.label)}${selected.kind==='pin'?' · pin '+selected.pin:''}`;
    $$('[data-signal-value]').forEach(e=>{const record=ctx.result.signals[e.dataset.signalValue];e.textContent=format(record?.value,record?.unit);});
    $$('[data-signal-validity]').forEach(e=>{const record=ctx.result.signals[e.dataset.signalValidity];e.textContent=(record?.label||'')+' · '+(record?.validity || 'unavailable');e.title=record?.validity_note || '';});
    $$('[data-wire-value]').forEach(e=>{const record=ctx.network.wires[e.dataset.wireValue];e.textContent=record?.available===false?'Unavailable':format(record?.value,record?.unit);});
    $$('[data-wire-validity]').forEach(e=>{const record=ctx.network.wires[e.dataset.wireValidity];e.textContent=(record?.sample_kind||'Reference')+' · '+(record?.status||'unavailable');e.title=record?.note || '';});
    $$('[data-signal-small]').forEach(e=>{const record=ctx.result.signals[e.dataset.signalSmall];e.textContent=format(record?.value,record?.unit)+(record?.unit?' '+record.unit:'');e.title=record?.validity_note || '';});
    $$('[data-connection-id]').forEach(button=>{const id=button.dataset.connectionId,connected=ctx.network.effective_connections[id]!==false;button.textContent=connected?'Disconnect':'Reconnect';button.disabled=ctx.controlsBusy || ctx.network.components[selected.componentId]?.installed===false;});
    $$('[data-connection-panel]').forEach(e=>e.classList.toggle('open',ctx.network.effective_connections[e.dataset.connectionPanel]===false));
    $$('[data-connection-status]').forEach(e=>e.textContent=ctx.network.effective_connections[e.dataset.connectionStatus]===false?'Open connection':'Connected');
    const values={'model-speed':format(ctx.state.speed_kph),'model-mode':ctx.state.drive_phase || ctx.state.mode,'model-profile':ctx.state.vehicle?.configuration.label || ctx.state.profile.toUpperCase(),'model-dtcs':ctx.state.dtcs.length?ctx.state.dtcs.join(', '):'None','model-status':ctx.state.mode};
    Object.entries(values).forEach(([k,v])=>{const el=$('[data-'+k+']');if(el)el.textContent=v;});
  }
  function renderDock(ctx,force=false) {
    $('#message-count').textContent=ctx.records.length;$('#event-count').textContent=ctx.events.length;
    const key=ctx.records.length+'|'+ctx.records.at(-1)?.number+'|'+selectedMessage;
    if(dock==='messages'&&(key!==messageKey||force)) {
      messageKey=key;$('#messages-empty').hidden=ctx.records.length>0;
      if(!ctx.records.some(r=>r.number===selectedMessage))selectedMessage=ctx.records.at(-1)?.number ?? null;
      $('#message-rows').innerHTML=ctx.records.slice(-150).map(r=>`<tr data-message="${r.number}" tabindex="0" aria-selected="${r.number===selectedMessage}" class="${r.number===selectedMessage?'selected':''}"><td>${r.number}</td><td>${r.t.toFixed(2)} s</td><td>${esc(r.frame?.direction || 'No reply')}</td><td>${esc(r.frame?.id || '—')}${r.frame?'<small class="message-id-decimal">'+parseInt(r.frame.id,16)+' dec</small>':''}</td><td>${esc(r.frame?.data || r.diagnostic.request_hex+' · timeout')}</td></tr>`).join('');
      const record=ctx.records.find(r=>r.number===selectedMessage);
      if(record) {
        $('#message-detail').innerHTML=window.MessageInspector.render(record);
      } else $('#message-detail').innerHTML='<p class="app-muted">Select a message to inspect its bytes.</p>';
    }
    const eventSignature=JSON.stringify(ctx.events.at(-1));
    if(dock==='events'&&(eventKey!==eventSignature||force)) {
      eventKey=eventSignature;$('#events-pane').innerHTML=ctx.events.slice(-100).reverse().map(e=>`<div class="event-row"><time>${Number(e.t).toFixed(2)} s</time><b>${esc(e.source)}</b><span>${esc(e.message)}</span></div>`).join('')||'<p class="app-muted">Controller events appear when the simulation runs.</p>';
    }
  }
  function renderConfiguration(ctx) {
    const config=ctx.state.vehicle.configuration,key=JSON.stringify([config,ctx.testSettings]);if(configurationKey===key)return;configurationKey=key;
    const fitted=value=>value?'Fitted':'Not fitted',transmission={automatic_6:'6-speed automatic',manual_6:'6-speed manual with clutch',hybrid_power_split:'Hybrid power-split automatic',single_speed:'Single-speed electric reduction'};
    const sections=[['Powertrain',[
      ['Vehicle',config.label],['Transmission',transmission[config.transmission_type]||config.transmission],
      ['Engine',config.powertrain==='bev'?'No combustion engine':config.cylinders+' cylinders · '+config.engine_detail+' sensor set'],['Diagnostic CAN',config.can_bitrate/1000+' kbit/s']
    ]],['Chassis',[
      ['Driven wheels',{fwd:'Front-wheel drive',rwd:'Rear-wheel drive',awd:'All-wheel drive'}[config.drivetrain]],['Vehicle mass',config.mass_kg+' kg'],['Wheel rolling radius',Math.round(config.wheel_radius_m*1000)+' mm'],['ABS / ESP',fitted(config.abs_installed)+' / '+fitted(config.esp_installed)]
    ]],['Cabin equipment',[
      ['Heater / ventilation',fitted(config.hvac_installed)],['Air conditioning',fitted(config.ac_installed)],['Heat source',config.hvac_installed?(config.heater_type==='coolant'?'Engine coolant heat':'Electric heater'):'Not fitted'],['Outside temperature',config.ambient_c+' °C']
    ]],['Test conditions',[
      ['Driving task',ctx.testSettings.mode==='wltc_class3b'?'WLTC Class 3b · automatic virtual driver':'Manual driving'],['Road surface',({'.9':'Dry','.55':'Wet','.25':'Snow','.1':'Ice'}[String(ctx.testSettings.road_mu).replace(/^0/,'')]||'Custom')+' · grip '+ctx.testSettings.road_mu],['Road slope',ctx.testSettings.grade_pct+'%'],['Starting odometer',format(config.initial_odometer_km??0)+' km'],['Initial state','Parked · ignition off']
    ]]];
    $('#service-configuration-title').textContent=config.label;
    $('#service-configuration-summary').innerHTML=sections.map(([title,rows])=>'<section><h3>'+esc(title)+'</h3><dl>'+rows.map(([name,value])=>'<div><dt>'+esc(name)+'</dt><dd>'+esc(value)+'</dd></div>').join('')+'</dl></section>').join('');
  }
  function renderSpeedHistory(ctx){
    const state=ctx.state,cycle=state.drive_cycle,showTarget=!!cycle&&['preparing','active','complete','fault'].includes(cycle.status);
    const key=JSON.stringify([ctx.history[0]?.t,Math.floor(state.t*2),showTarget,state.speed_kph]);if(key===speedHistoryKey)return;speedHistoryKey=key;
    $('#speed-history-value').innerHTML=state.speed_kph.toFixed(1)+' <small>km/h</small>';
    $('#speed-history-target-legend').hidden=!showTarget;
    const end=state.t,start=Math.max(0,end-120),span=Math.max(120,end-start);
    const recent=ctx.history.filter(s=>s.t>=end-120).filter((s,i,a)=>i===0||Math.floor(s.t*2)!==Math.floor(a[i-1].t*2)||i===a.length-1);
    const max=Math.max(50,...recent.map(s=>Math.max(s.speed_kph||0,showTarget?s.drive_target_kph||0:0)))*1.1;
    const x=t=>1+(t-(end-120))/span*178,y=v=>40-Math.max(0,v)/max*37;
    function line(field){let move=true,path='';for(const point of recent){const value=field(point);if(!Number.isFinite(value)){move=true;continue;}path+=(move?'M':'L')+x(point.t).toFixed(1)+' '+y(value).toFixed(1)+' ';move=false;}return path;}
    const actual=line(s=>s.speed_kph);$('#speed-history-actual').setAttribute('d',actual);
    $('#speed-history-area').setAttribute('d',actual&&recent.length?actual+'L'+x(recent.at(-1).t).toFixed(1)+' 40L'+x(recent[0].t).toFixed(1)+' 40Z':'');
    $('#speed-history-target').setAttribute('d',showTarget?line(s=>s.drive_target_kph):'');
    $('#speed-history').setAttribute('aria-label','Vehicle speed '+state.speed_kph.toFixed(1)+' km/h. Last 120 seconds; solid blue actual speed'+(showTarget?', dashed amber WLTC target.':'.'));
  }
  function update(ctx) {
    const generation=++renderGeneration;
    current=ctx;const error=$('#application-error');error.hidden=!ctx.error;error.textContent=ctx.error;
    const workspaceActive=ctx.workflow.stage==='active',inService=workspaceActive&&ctx.view!=='drive';
    for(const selector of ['.simulation-toolbar','.app-tabs','.app-statusbar','#message-dock']){$(selector).hidden=!workspaceActive;$(selector).inert=!workspaceActive;}
    $('.system-sidebar').hidden=!inService||ctx.view==='configuration';$('.context-bar').hidden=!inService||ctx.view==='configuration';
    $('#context-inspector').hidden=!inService||ctx.view!=='units';$('.app-menu').hidden=!ctx.workflow.complete;
    $('#vehicle-application').classList.toggle('mode-setup',!workspaceActive);$('#vehicle-application').classList.toggle('mode-drive',workspaceActive&&ctx.view==='drive');
    $('#vehicle-application').classList.toggle('mode-diagnostics',inService&&ctx.view==='diagnostics');$('#vehicle-application').classList.toggle('mode-configuration',inService&&ctx.view==='configuration');
    $('#vehicle-application').classList.toggle('unit-wiring',inService&&ctx.view==='units'&&ctx.unitView==='wiring');
    $('#vehicle-application').classList.toggle('unit-page-scroll',inService&&ctx.view==='units'&&['overview','locations'].includes(ctx.unitView));
    $('#view-service').hidden=!inService;monitor.setVisible(inService);views.drive.setServiceInputEnabled(inService);
    if(generation!==renderGeneration)return;
    if(!ctx.state){views.setup.update(ctx);return;}
    const vehicle=ctx.state.vehicle,configuration=vehicle?.configuration;
    $('#configuration-label').textContent=configuration?.label || ctx.state.profile;$('#playback-rate').value=String(ctx.speed);
    $('[data-action="restart"]').disabled=!ctx.ready||ctx.controlsBusy||!workspaceActive;
    $('#simulation-badge').textContent=ctx.running?'VEHICLE LIVE':'VEHICLE PAUSED';
    $('#simulation-time').innerHTML=ctx.state.t.toFixed(1)+' <small>s</small>';$('.simulation-time').classList.toggle('running',ctx.running);
    const enginePhase={off:'Vehicle off',ignition_on:'Ignition on · engine stopped',cranking:'Starter cranking',running:'Engine running',ready:'Drive system READY',precharge:'Preparing READY',inhibited:configuration?.powertrain==='bev'?'Drive inhibited':'Engine stopped · start inhibited',fault:'Start fault',stalled:'Engine stalled'};
    $('#simulation-phase').textContent=vehicle?`${enginePhase[vehicle.start_state] || vehicle.start_state} · ${vehicle.selector}${vehicle.selector==='D'&&Number.isFinite(Number(vehicle.gear))?' '+vehicle.gear:''}`:ctx.state.mode;
    monitor.update(ctx);renderSpeedHistory(ctx);
    $('#vehicle-profile').textContent=(configuration?.powertrain || ctx.state.profile).toUpperCase();
    $('#status-connection').textContent=ctx.scanner?.connected?'Scan tool: '+ctx.scanner.status.replaceAll('_',' '):'Scan tool disconnected';$('#status-connection').classList.toggle('warning',ctx.scanner?.connected&&!['ready','state_only'].includes(ctx.scanner.status));
    $('#status-faults').textContent=ctx.state.dtcs.length?ctx.state.dtcs.join(', ')+' stored':ctx.state.pending_dtcs.length?ctx.state.pending_dtcs.join(', ')+' pending':'No stored emissions codes';$('#status-faults').classList.toggle('warning',!!ctx.state.dtcs.length||!!ctx.state.pending_dtcs.length);
    $('#status-samples').textContent=ctx.logHistory.length.toLocaleString()+' recorded samples';$('#status-mode').textContent=ctx.running?'Running · '+ctx.speed+'×':'Paused · '+ctx.state.t.toFixed(1)+' s';
    $('#record-toggle').innerHTML='<i></i>'+(ctx.recording?'Recording':'Record');$('#record-toggle').setAttribute('aria-pressed',String(ctx.recording));$('#log-interval').value=String(ctx.logInterval);
    const open=Object.values(ctx.network.effective_connections).filter(x=>x===false).length;
    $('#session-health').textContent=open?open+' open connection'+(open>1?'s':''):'One shared vehicle';
    $('#session-health-detail').textContent=open?'Inspect the affected inputs and fault memory.':'Choose a unit, then its signals or connector.';
    renderTree(ctx);renderInspector(ctx);renderDock(ctx);
    $('#mode-description').textContent=ctx.view==='drive'?'Driver controls':'Inspect the same vehicle while it runs';
    const cycle=ctx.state.drive_cycle,cycleOwned=cycle&&['preparing','active','complete','fault'].includes(cycle.status),manual=configuration?.transmission_type==='manual_6',moving=Math.abs(ctx.state.speed_kph)>.5;
    $('#drive-task-bar').hidden=!workspaceActive;
    $('#drive-task-bar').classList.toggle('cycle-owned',!!cycleOwned);
    $('#drive-task-title').textContent=cycleOwned?'WLTC Class 3b · '+(cycle.status==='active'?cycle.phase:cycle.status):'Manual driving';
    const blocked=manual?'The WLTC virtual driver requires an automatic transmission. Choose an automatic in vehicle settings.':moving?'Brake to a complete stop to start WLTC.':null;
    $('#drive-task-note').textContent=cycleOwned?(cycle.status==='complete'?'Cycle complete. Choose Drive manually to release the virtual driver.':cycle.status==='fault'?cycle.note+' Choose Drive manually to inspect the vehicle.':'Virtual driver active. Press a pedal or choose Drive manually to take over. Drive and Diagnostics follow the same vehicle.'):(blocked||'Pedals control the vehicle. Start WLTC to let the virtual driver switch ignition on, start the vehicle and drive the cycle.');
    $('#cycle-metrics').hidden=!cycleOwned;$('#cycle-progress').hidden=!cycleOwned;$('#cycle-progress').value=cycle?.progress || 0;
    $('#cycle-target').textContent=format(cycle?.target_speed_kph);$('#cycle-actual').textContent=format(ctx.state.speed_kph);$('#cycle-elapsed').textContent=(cycle?.elapsed_s || 0).toFixed(1)+' / 1800';
    const startCycle=$('[data-action="start-cycle"]');startCycle.hidden=!!cycleOwned;startCycle.disabled=ctx.controlsBusy||!!blocked;startCycle.title=blocked||'Start WLTC Class 3b with the virtual driver';
    $('[data-action="stop-cycle"]').hidden=!cycleOwned;$('[data-action="stop-cycle"]').disabled=ctx.controlsBusy;
    $$('[data-workspace]').forEach(button=>{const active=workspaceActive&&button.dataset.workspace===(ctx.view==='drive'?'drive':'service');button.classList.toggle('active',active);button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;});
    $$('[data-service-view]').forEach(button=>{const active=button.dataset.serviceView===ctx.view;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));});
    $$('[data-unit-view]').forEach(button=>{const active=button.dataset.unitView===ctx.unitView;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));});
    $$('[data-diagnostic-view]').forEach(button=>{const active=button.dataset.diagnosticView===ctx.diagnosticView;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));});
    ['setup','drive','units','diagnostics','configuration'].forEach(id=>$('#view-'+id).hidden=id!==ctx.view);
    const active=ctx.view==='setup'?'setup':ctx.view==='drive'?'drive':ctx.view==='configuration'?'configuration':ctx.view==='units'?(ctx.unitView==='signals'?'live':ctx.unitView):(ctx.diagnosticView==='tests'?'diagnosis':'scan');
    for(const [id,view] of Object.entries(views)){
      const visible=id===active;$('#view-'+id).hidden=!visible;view.setVisible(visible);
      // Releasing a control emits synchronously. The nested render has the
      // new inputs; this older render must not overwrite them afterwards.
      if(generation!==renderGeneration)return;
      view.update(ctx);if(generation!==renderGeneration)return;
    }
    if(inService&&ctx.view==='configuration')renderConfiguration(ctx);
    if(previousView!==active){previousView=active;if(['setup','configuration','wiring','overview','locations'].includes(active))showDock(null);views[active]?.resize?.();}
    if(previousStage!==ctx.workflow.stage){previousStage=ctx.workflow.stage;
      if(workspaceActive)$('#tab-'+(ctx.view==='drive'?'drive':'service')).focus();
      else $('[data-setup="heading"]').focus();
    }
  }
  function openDrawer() {
    views.drive.setInputEnabled(false);
    drawerFocus=document.activeElement;$('#help-drawer').hidden=false;$('#drawer-shade').hidden=false;$('#vehicle-application').inert=true;
    $('#help-drawer').setAttribute('role','dialog');$('#help-drawer').setAttribute('aria-modal','true');$('#help-drawer').querySelector('[data-action="close-drawer"]').focus();
  }
  function closeDrawer() {$('#help-drawer').hidden=true;$('#drawer-shade').hidden=true;$('#vehicle-application').inert=false;views.drive.setInputEnabled(true);drawerFocus?.focus?.();}
  function graphSelection() {const selected=M.resolveSelection(session.selection,session.catalog,session.signals);relatedSignals(selected,session.context()).forEach(id=>session.setWatch(id,true));session.navigate('live');}
  function download(text,name,type){const url=URL.createObjectURL(new Blob([text],{type})),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),5000);}
  function saveSession() {
    const payload={schema:'obdii-lab.workspace.v2',version:session.meta.version,selection:session.selection,view:session.view,watch:session.watch,configuration:session.result?.state.vehicle?.configuration,state:session.result?.state,recording:{interval_s:session.logInterval,samples:session.logHistory},events:session.events,diagnostic_frames:session.records,scan_report:session.scanReport};
    download(JSON.stringify(payload,null,2),'OBD_Lab_workspace.json','application/json');
  }
  document.addEventListener('click',event=>{
    const target=event.target.closest?.('[data-select],[data-go],[data-workspace],[data-service-view],[data-unit-view],[data-diagnostic-view],[data-dock],[data-action],[data-connection-id],[data-message]');
    if(!target||target.disabled)return;
    if(target.dataset.select)session.select(target.dataset.select);
    if(target.dataset.go)session.navigate(target.dataset.go);
    if(target.dataset.workspace)session.navigate(target.dataset.workspace);
    if(target.dataset.serviceView)session.navigate(target.dataset.serviceView);
    if(target.dataset.unitView)session.setUnitView(target.dataset.unitView);
    if(target.dataset.diagnosticView)session.setDiagnosticView(target.dataset.diagnosticView);
    if(target.dataset.dock)showDock(dock===target.dataset.dock?null:target.dataset.dock);
    if(target.dataset.connectionId){const id=target.dataset.connectionId;invoke(session.connection(id,session.result.network.effective_connections[id]===false));}
    if(target.dataset.message){selectedMessage=Number(target.dataset.message);session.select('ecu');renderDock(session.context(),true);}
    switch(target.dataset.action) {
      case 'restart':invoke(session.reset());break;
      case 'configuration':session.beginSetup();break;
      case 'service-ignition':invoke(session.control('ignition',true));break;
      case 'start-cycle':invoke(session.cycleAction('start'));break;
      case 'stop-cycle':invoke(session.cycleAction('stop'));break;
      case 'help':openDrawer('help');break;
      case 'close-drawer':closeDrawer();break;
      case 'record':session.setRecording(!session.recording);break;
      case 'save-log':download(session.logCSV(),'OBD_Lab_recorded_signals.csv','text/csv');break;
      case 'collapse-dock':showDock(null);break;
      case 'expand-dock':dockExpanded=!dockExpanded;renderDockSize();break;
      case 'inspector':{const open=$('#context-inspector').classList.toggle('open');$('.inspector-toggle').setAttribute('aria-expanded',String(open));break;}
      case 'graph-selection':graphSelection();break;
      case 'start-example':closeDrawer();session.select('coolant_sensor');session.navigate('diagnosis');break;
      case 'show-dlc':closeDrawer();session.select('pin:dlc_socket:6');session.navigate('wiring');break;
      case 'save-session':saveSession();break;
    }
  });
  $('#drawer-shade').addEventListener('click',closeDrawer);
  $('#playback-rate').addEventListener('change',e=>session.setSpeed(e.target.value));
  $('#log-interval').addEventListener('change',e=>session.setLogInterval(e.target.value));
  $('#system-filter').addEventListener('input',()=>{if(current)renderTree(current);});
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'){closeDrawer();$('#context-inspector').classList.remove('open');$('.inspector-toggle').setAttribute('aria-expanded','false');return;}
    if(!$('#drawer-shade').hidden){
      if(event.key==='Tab'){
        const activeDrawer=$('#help-drawer');
        const focusable=Array.from(activeDrawer.querySelectorAll('button,a[href],input,select,textarea,[tabindex]')).filter(el=>!el.disabled&&!el.closest('[hidden]')&&el.tabIndex!==-1);
        const first=focusable[0],last=focusable.at(-1);
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
      }
      return;
    }
    if(event.ctrlKey||event.metaKey||event.altKey||/INPUT|TEXTAREA|SELECT/.test(event.target.tagName)||event.target.isContentEditable)return;
    if(session.workflowStage!=='active')return;
    if(event.target.matches?.('[role="tab"]')&&['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) {
      event.preventDefault();const ids=['drive','service'],i=session.view==='drive'?0:1,next=event.key==='Home'?0:event.key==='End'?1:1-i;session.navigate(ids[next]);$('#tab-'+ids[next]).focus();return;
    }
    if(event.target.dataset?.message&&(event.key==='Enter'||event.key===' ')){event.preventDefault();event.target.click();return;}
    if(/^[12]$/.test(event.key)){event.preventDefault();session.navigate(['drive','service'][Number(event.key)-1]);}
  });
  window.addEventListener('resize',()=>Object.values(views).forEach(v=>v.resize?.()));
  window.AppI18n?.subscribe(()=>{treeKey='';if(current?.state)renderTree(current);Object.values(views).forEach(v=>v.resize?.());});
  window.addEventListener('beforeunload',()=>{session.dispose();monitor.dispose();Object.values(views).forEach(v=>v.dispose?.());});
  session.subscribe(update);
  const ready=session.initialize();ready.catch(()=>{});
  window.VehicleApplication={session,views,monitor,ready,inspect:()=>({view:session.view,workflow:session.context().workflow,selection:session.selection,time:session.result?.state?.t,history:session.history.length,records:session.records.length,dock,running:session.running}),dispose:()=>{session.dispose();monitor.dispose();Object.values(views).forEach(v=>v.dispose?.());}};
})();
