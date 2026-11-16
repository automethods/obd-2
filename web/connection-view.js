/* One connection graph, shared by the wiring workspace and spatial locator.
 * Values come exclusively from the session snapshot/network observation.
 * There is no view-owned simulation, polling or electrical bus animation. */
(() => {
  'use strict';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt = (value, unit = '') => value == null || (typeof value === 'number' && !Number.isFinite(value)) ? 'Unavailable' : `${typeof value === 'number' ? value.toLocaleString('en-US', {maximumFractionDigits: unit === 'V' ? 3 : 2}) : String(value)}${unit ? ' ' + unit : ''}`;
  const short = (text, length = 29) => String(text || '').length > length ? String(text).slice(0, length - 1) + '…' : String(text || '');
  const SCHEMES = [
    {component:'coolant_sensor', title:'Coolant sensor', path:'J-ECT → Engine ECU · X1', text:'Two-wire NTC circuit. Compare physical temperature, input voltage and the ECU reading.', type:'Analog circuit'},
    {component:'dlc', title:'Diagnostic connector', path:'DLC → Engine ECU / scan tool', text:'Select a numbered pin, inspect the CAN pair, or follow the tester supply and ground.', type:'CAN + power'},
    {component:'bmu', title:'Battery communication', path:'BMU → Vehicle controller', text:'Follow message freshness and the traction shutdown caused by a lost connection.', type:'CAN messages'},
    {component:'abs', title:'Wheel speed sensors', path:'Four sensors → Brake controller', text:'Separate physical wheel rotation from the signals received by the ABS controller.', type:'Sensor signals'}
  ];
  function resolve(selection, catalog, signals) {
    const external = window.AppModel?.resolveSelection?.(selection, catalog, signals);
    if (external) return external;
    const [kind, id, number] = String(selection || 'overview').split(':');
    if (kind === 'socket' || kind === 'pin') {
      const object = catalog?.sockets?.find(s => s.id === id);
      return {kind, id, socketId:id, pin:number == null ? null : Number(number), object, componentId:object?.component_id, label:object?.label};
    }
    if (kind === 'wire') {
      const object = catalog?.wires?.find(w => w.id === id), socketId=object?.from?.socket_id;
      return {kind, id, object, socketId, componentId:catalog?.sockets?.find(s => s.id === socketId)?.component_id, label:object?.label};
    }
    const object=catalog?.components?.find(c => c.id === selection);
    return {kind:selection === 'overview' ? 'overview':'component', id:selection, object, componentId:object?.id, label:object?.label};
  }
  function relatedWires(catalog, socketId) {
    return (catalog?.wires || []).filter(w => w.from.socket_id === socketId || w.to.socket_id === socketId);
  }
  function selectedSocket(selection, catalog, signals, previousId) {
    const info=resolve(selection,catalog,signals);
    if (info.kind === 'overview' || selection === 'overview') return null;
    if (info.kind === 'wire') {
      const wire=catalog?.wires?.find(w => w.id === info.id);
      if (wire && [wire.from.socket_id,wire.to.socket_id].includes(previousId)) return previousId;
      return wire?.from.socket_id || null;
    }
    if (info.socketId) return info.socketId;
    if (info.kind === 'socket' || info.kind === 'pin') return info.id;
    return catalog?.sockets?.find(s => s.component_id === info.componentId)?.id || null;
  }
  function circuit(catalog, socketId) {
    const anchor=catalog?.sockets?.find(s => s.id === socketId);
    if (!anchor) return {anchor:null,partners:[],wires:[],height:300};
    const wires=relatedWires(catalog,socketId), ids=[...new Set(wires.map(w => w.from.socket_id === socketId ? w.to.socket_id : w.from.socket_id))];
    const partners=ids.map(id => {
      const socket=catalog.sockets.find(s => s.id === id);if(!socket)return null;
      const connectedPins=new Set(wires.flatMap(w=>[w.from,w.to]).filter(p=>p.socket_id===id).map(p=>p.pin));
      return {...socket,fullPinCount:socket.pins.length,pins:socket.pins.filter(p=>connectedPins.has(p.number))};
    }).filter(Boolean);
    let offset=35;
    const positioned=partners.map(socket => {const h=68 + socket.pins.length*29; const result={socket,y:offset,height:h};offset+=h+22;return result;});
    const anchorHeight=68+anchor.pins.length*29;
    return {anchor,partners:positioned,wires,height:Math.max(300,anchorHeight+70,offset+10),anchorHeight};
  }
  function ownerFor(info,catalog,systems) {
    const component=catalog.components?.find(c=>c.id===info.componentId);
    const sensor=systems?.sensors?.find(s=>s.component_id===info.componentId);
    if(sensor)return sensor.unit_id;
    if(component?.properties?.unit_id)return component.properties.unit_id;
    if(component?.kind==='sensor') {
      const sockets=catalog.sockets?.filter(s=>s.component_id===component.id)||[];
      for(const socket of sockets)for(const wire of relatedWires(catalog,socket.id)) {
        const other=catalog.sockets?.find(s=>s.id===(wire.from.socket_id===socket.id?wire.to.socket_id:wire.from.socket_id));
        if(catalog.components?.find(c=>c.id===other?.component_id)?.kind==='controller')return other.component_id;
      }
    }
    return info.componentId;
  }
  const stateValue=(state,path)=>String(path).split('.').reduce((value,key)=>value?.[key],state);
  const TYPE_LABELS={analog:'Analogue',digital:'Digital on/off',pulse:'Pulse',discrete:'Discrete state',derived:'Calculated'};
  const TYPE_ORDER={analog:0,digital:1,pulse:2,discrete:3,derived:4,network:5,linked:6};
  function characteristics(sensor){
    if(!sensor)return null;
    const declared=sensor.characteristics||{},signal_type=declared.signal_type||(sensor.connection_id?({state:'discrete'})[sensor.kind]||sensor.kind:'derived');
    const period=declared.timing?.sample_period_ms??sensor.period_ms,rate=declared.timing?.sample_rate_hz??(period>0?1000/period:null);
    return {...declared,signal_type,label:declared.label||TYPE_LABELS[signal_type]||'Signal',timing:{...declared.timing,sample_period_ms:period,sample_rate_hz:rate,group_id:declared.timing?.group_id||'period_'+period+'ms',group_label:declared.timing?.group_label||(period>0?`${fmt(rate,'Hz')} · every ${fmt(period,'ms')}`:'Sampling not declared')}};
  }
  function arrangementCategory(group,arrangement){
    const c=characteristics(group.sensor);
    if(c){
      if(arrangement==='rate')return {id:c.timing.group_id,label:`${fmt(c.timing.sample_rate_hz,'Hz')} · sample every ${fmt(c.timing.sample_period_ms,'ms')}`,order:c.timing.sample_period_ms||99999};
      return {id:c.signal_type,label:TYPE_LABELS[c.signal_type]||c.label,order:TYPE_ORDER[c.signal_type]??7};
    }
    const network=group.wires.some(w=>w.kind==='can');
    return {id:network?'network':'linked',label:network?'CAN network · message transport':'Linked devices · no sensor sampling',order:arrangement==='rate'?(network?100000:100001):(network?5:6)};
  }
  function sampleBadge(sensor){const c=characteristics(sensor);return c?`${TYPE_LABELS[c.signal_type]||c.label} · sample ${fmt(c.timing.sample_period_ms,'ms')} / ${fmt(c.timing.sample_rate_hz,'Hz')}`:'';}
  function electricalReading(sensor,sample,connected=true){
    const c=characteristics(sensor);if(!c)return '';
    const valid=connected&&sample?.validity==='valid';
    if(c.signal_type==='pulse')return valid&&Number.isFinite(sample.frequency_hz)?`Pulses ${fmt(sample.frequency_hz,'Hz')}`:'Pulses unavailable';
    if(c.signal_type==='analog'||c.signal_type==='digital'){
      // The solved coolant divider can retain its open-circuit voltage while its input is invalid.
      const solvedOpen=sensor.id==='ect'&&sample?.powered&&Number.isFinite(sample.signal_voltage_v);
      if((valid||solvedOpen)&&Number.isFinite(sample.signal_voltage_v))return `Signal ${fmt(sample.signal_voltage_v,'V')}${valid?'':' · invalid sensor input'}`;
      return valid?'Voltage not modeled':'Voltage unavailable';
    }
    return c.signal_type==='derived'?'Calculated value · no separate wire':'State value · no voltage waveform';
  }
  function modelOutputs(unitId,state={}) {
    const definitions={
      ecu:{title:'Engine response',note:'Mean result; injection / ignition signals not modeled',values:[['Combustion','engine_running',''],['Shaft speed','rpm','rpm'],['Shaft torque','engine_torque_nm','N·m'],['Fuel flow','fuel_l_h','L/h']]},
      abs:{title:'Brake outputs',note:'Live brake model · actuator pin faults are not modeled',values:[['ABS modulation','abs_active',''],['Friction braking','friction_brake_kw','kW'],['Regeneration','regen_kw','kW']]},
      inverter:{title:'Traction motor response',note:'Live motor model · no individual inverter-pin faults',values:[['Motor speed','vehicle.motor_rpm','rpm'],['Mechanical power','motor_power_kw','kW'],['Regeneration','regen_kw','kW']]},
      bmu:{title:'Pack / contactor response',note:'Live pack model · no individual contactor-pin faults',values:[['Contactor','contactor',''],['Discharge permission','battery_discharge_limit_kw','kW'],['Charge permission','battery_charge_limit_kw','kW']]},
      supervisor:{title:'Propulsion response',note:'Live propulsion model · not a physical output pin map',values:[['Engine requested','engine_requested',''],['Engine running','engine_running',''],['Motor power','motor_power_kw','kW']]},
      hvac:{title:'Climate actuators',note:'Live heat / power outputs · no individual actuator faults',values:[['Blower','vehicle.hvac.blower_kw','kW'],['Compressor','vehicle.hvac.compressor_kw','kW'],['Cabin heating','vehicle.hvac.heat_kw','kW'],['Cabin cooling','vehicle.hvac.cooling_kw','kW']]},
      transmission:{title:'Transmission response',note:'Live driveline state · no individual solenoid model',values:[['Selected gear','vehicle.gear',''],['Gear ratio','vehicle.gear_ratio',''],['Clutch coupling','vehicle.clutch_coupling','']]}
    };
    const descriptor=definitions[unitId];if(!descriptor)return [];
    const values=descriptor.values.filter(item=>stateValue(state,item[1])!==undefined);
    return values.length?[{...descriptor,id:unitId+'_output',values,x:1090,y:110,width:320,height:112+values.length*23}]:[];
  }
  function systemCircuit(catalog,unitId,systems,focusId=null,state={},arrangement='function') {
    const component=catalog.components?.find(c=>c.id===unitId),ownSockets=(catalog.sockets||[]).filter(s=>s.component_id===unitId);
    const focusedSocket=focusId?catalog.sockets?.find(s=>s.id===focusId):null;
    const ownFocus=focusedSocket?.component_id===unitId;
    const owned=!focusId?ownSockets:ownFocus?ownSockets.filter(s=>s.id===focusId):ownSockets.filter(s=>relatedWires(catalog,s.id).some(w=>w.from.socket_id===focusId||w.to.socket_id===focusId));
    const fallback=owned.length?owned:focusedSocket?[focusedSocket]:[];
    const outputs=modelOutputs(unitId,state),parts=[],allWires=[],socketIds=new Set(),nodes=[],drafts=[],categoryGroups=[];
    const cursor={left:210,right:outputs.length?outputs[0].y+outputs[0].height+40:210};
    const body={x:550,y:98,width:340,height:0,connectionId:catalog.connections?.find(c=>c.id==='unit_'+unitId)?.id||(ownSockets.length===1?ownSockets[0].connection_id:null)||null};
    const floating=[];
    for(const anchor of fallback) {
      const candidates=relatedWires(catalog,anchor.id).filter(w=>!focusId||ownFocus||w.from.socket_id===focusId||w.to.socket_id===focusId);
      const ids=[...new Set(candidates.map(w=>w.from.socket_id===anchor.id?w.to.socket_id:w.from.socket_id))];
      const peers=ids.map(id=>catalog.sockets.find(s=>s.id===id)).filter(Boolean).filter(s=>anchor.installed===false||s.installed!==false);
      const ownPin=w=>w.from.socket_id===anchor.id?w.from.pin:w.to.pin;
      const groups=peers.map(socket=>({socket,sensor:systems?.sensors?.find(s=>s.component_id===socket.component_id),wires:candidates.filter(w=>w.from.socket_id===socket.id||w.to.socket_id===socket.id)})).sort((a,b)=>Math.min(...a.wires.map(ownPin))-Math.min(...b.wires.map(ownPin)));
      const sensor=systems?.sensors?.find(s=>s.component_id===peers[0]?.component_id),groupLabel=systems?.groups?.find(g=>g.id===sensor?.group)?.label;
      const title=anchor.id==='ecu_socket'?'Coolant / diagnostic':anchor.id.endsWith('_module_socket')?'Unit connection':groupLabel||anchor.label.replace(component?.label+' · ','');
      const bankCode=anchor.label.match(/\bX\d+\b/)?.[0]||'X'+(ownSockets.indexOf(anchor)+1||drafts.length+1);
      const included=new Set(groups.flatMap(group=>group.wires.map(w=>w.id))),used=new Set(groups.flatMap(group=>group.wires.map(ownPin)));
      const hidden=new Set(relatedWires(catalog,anchor.id).filter(w=>!included.has(w.id)).map(ownPin));
      const spare=anchor.pins.filter(pin=>!used.has(pin.number)&&!hidden.has(pin.number));
      drafts.push({anchor,title,bankCode,groups,spare:groups.length?spare:anchor.pins});socketIds.add(anchor.id);
    }
    const planned=[];
    if(arrangement==='function'||focusId){planned.push(...drafts);}
    else{
      const categories=new Map();
      for(const draft of drafts){
        if(!draft.groups.length){planned.push(draft);continue;}
        const partitions=new Map();
        for(const group of draft.groups){const category=arrangementCategory(group,arrangement);if(!partitions.has(category.id))partitions.set(category.id,{...draft,groups:[],spare:[],category});partitions.get(category.id).groups.push(group);}
        const split=[...partitions.values()];if(split.length)split[0].spare=draft.spare;
        for(const part of split){if(!categories.has(part.category.id))categories.set(part.category.id,{...part.category,parts:[]});categories.get(part.category.id).parts.push(part);}
      }
      for(const category of [...categories.values()].sort((a,b)=>a.order-b.order))planned.push(...category.parts);
    }
    let previousCategory=null;
    for(const draft of planned){
      const {anchor,title,bankCode,groups}=draft,ownPin=w=>w.from.socket_id===anchor.id?w.from.pin:w.to.pin;
      const part={anchor,title,bankCode,category:draft.category||null,peers:[],rows:[],spare:draft.spare,side:null,y:0,height:0};
      if(!groups.length){floating.push(part);parts.push(part);continue;}
      if(draft.category&&draft.category.id!==previousCategory){
        const y=Math.max(cursor.left,cursor.right)+14;categoryGroups.push({...draft.category,y});cursor.left=y+28;cursor.right=y+28;previousCategory=draft.category.id;
      }
      const side=cursor.left<=cursor.right?'left':'right';part.side=side;part.y=cursor[side];
      for(const group of groups){
        group.wires.sort((a,b)=>ownPin(a)-ownPin(b));
        const x=side==='left'?30:1090,y=cursor[side],height=188+Math.max(0,group.wires.length-1)*26;
        const rows=group.wires.map((wire,index)=>{
          const end=wire.from.socket_id===group.socket.id?wire.from:wire.to,own=wire.from.socket_id===anchor.id?wire.from:wire.to;
          const py=y+166+index*26,ownY=py+8;
          const pin=group.socket.pins.find(p=>p.number===end.pin)||{number:end.pin,label:'Connection'},bankPin=anchor.pins.find(p=>p.number===own.pin)||{number:own.pin,label:'Connection'};
          const bend=side==='left'?450+index*7:990-index*7,path=side==='left'?`M350 ${py}H${bend}V${ownY}H550`:`M1090 ${py}H${bend}V${ownY}H890`;
          const row={pin,y:py,wire,ownY,path,readingX:side==='left'?442:998};part.rows.push({pin:bankPin,y:ownY,wire,nodeId:group.socket.id});allWires.push(wire);return row;
        });
        const sensor=group.sensor,connectionId=group.socket.connection_id||sensor?.connection_id||null;
        const node={socket:group.socket,sensor,connectionId,x,y,width:320,height,rows,side,anchorId:anchor.id,category:draft.category||null};part.peers.push(node);nodes.push(node);socketIds.add(group.socket.id);cursor[side]+=height+25;
      }
      const spareStart=cursor[side]-6;part.spare.forEach((pin,index)=>part.rows.push({pin,y:spareStart+index*24,wire:null}));
      if(part.spare.length)cursor[side]=spareStart+part.spare.length*24+20;
      part.height=cursor[side]-part.y-12;cursor[side]+=12;parts.push(part);
    }
    let bottom=Math.max(380,cursor.left,cursor.right)+8;
    for(const part of floating){part.side='footer';part.y=bottom;part.height=52+part.spare.length*24;part.rows=part.spare.map((pin,index)=>({pin,y:bottom+55+index*24,wire:null}));bottom+=part.height+20;}
    body.height=Math.max(370,bottom-body.y+24);
    return {component,parts,nodes,outputs,body,categoryGroups,arrangement:focusId?'function':arrangement,wires:[...new Map(allWires.map(w=>[w.id,w])).values()],socketIds:[...socketIds],width:1440,height:body.y+body.height+40};
  }
  function create(container,options={}) {
    if(!container)throw new Error('ConnectionView requires a container.');
    container.classList.add('connection-view');
    container.innerHTML=`<header class="cv-heading"><div><h2 data-cv-title>Wiring</h2><p data-cv-subtitle>Choose a vehicle unit to inspect its sensors and outputs around one central controller.</p></div><div class="cv-heading-actions"><button type="button" data-cv-action="location">Show location</button><button type="button" data-cv-action="diagnosis">Diagnose</button></div></header>
      <div class="cv-content"><div data-cv-overview></div><div class="cv-circuit" data-cv-circuit hidden><div class="cv-toolbar"><div class="cv-scope-switch"><button type="button" data-cv-action="whole" aria-pressed="true">Whole unit</button><button type="button" data-cv-action="focus" aria-pressed="false">Focus connector</button></div><label class="cv-arrangement">Arrangement <select data-cv-arrangement aria-label="Arrange unit schematic by"><option value="function">Functional group</option><option value="type">Signal type</option><option value="rate">Sample rate</option></select></label><div class="cv-zoom"><button type="button" data-cv-action="fit">Fit width</button><button type="button" data-cv-action="zoom-out" aria-label="Zoom schematic out">−</button><output data-cv-scale>Fit width</output><button type="button" data-cv-action="zoom-in" aria-label="Zoom schematic in">+</button><button type="button" data-cv-action="actual">100%</button></div></div><div class="cv-socket-tabs" data-cv-sockets></div><p class="cv-arrangement-note" data-cv-arrangement-note>Grouping changes the drawing; connector names and pins are unchanged.</p><div class="cv-circuit-strip"><span data-cv-connection></span><span>Use Disconnect on a sensor to unplug it. Click its pins to inspect the signal path.</span></div><section data-cv-face></section><section class="cv-impact" data-cv-impact aria-live="polite" hidden><strong data-cv-impact-title></strong><div class="cv-impact-facts" data-cv-impact-facts></div><p data-cv-impact-effect></p><small data-cv-impact-clock></small><div class="cv-fault-test" data-cv-fault-controls hidden><div class="cv-fault-heading"><strong>Intermittent sensor fault</strong><span data-cv-fault-status role="status"></span></div><div class="cv-fault-fields"><label>Pattern<select data-cv-fault-pattern><option value="regular">Regular</option><option value="irregular">Irregular (±25%)</option></select></label><label>Connected for (s)<input data-cv-fault-connected type="number" value="3" min="0.002" max="3600" step="0.001"></label><label>Disconnected for (s)<input data-cv-fault-dropout type="number" value="1" min="0.002" max="3600" step="0.001"></label><button type="button" data-cv-action="start-intermittent">Start intermittent</button><button type="button" data-cv-action="stop-intermittent" hidden>Stop &amp; reconnect</button></div><small>Advances with the vehicle clock while a workspace is open. Durations round up to a 2 ms step. Short dropouts may not confirm a fault code; stored codes remain after reconnection.</small><p class="cv-action-error" data-cv-fault-error role="alert" hidden></p></div></section><details class="cv-signal-help"><summary>Signal types and timing explained</summary><dl><div><dt>Analogue voltage</dt><dd>A varying voltage represents a physical quantity. The declared transfer tells you how to interpret it.</dd></div><div><dt>Digital on/off</dt><dd>Two logic states, such as a brake switch. A discrete state can also be a gear or mode without a modeled voltage.</dd></div><div><dt>Pulse frequency</dt><dd>Counted pulses represent movement. Pulses per second change with speed; the sampling schedule stays fixed.</dd></div><div><dt>CAN network</dt><dd>Controllers exchange messages over a shared pair. Bus bit rate is not the sensor sampling rate; the lab models message delivery, not electrical bit timing.</dd></div></dl><p>Sampling is how often the receiving unit reads an input. 20 ms means 50 samples per second. Recording and diagnostic requests have separate intervals. Calculated channels have no independent sensor connector.</p></details><div class="cv-legend"><span><i class="cv-color-high"></i>CAN-H</span><span><i class="cv-color-low"></i>CAN-L</span><span><i class="cv-color-signal"></i>Sensor signal</span><span><i class="cv-color-reference"></i>Reference / power</span><span><i class="cv-color-ground"></i>Return / ground</span><span class="cv-legend-open">Dashed = connection open</span></div><div class="cv-diagram-scroll" tabindex="0" role="region" aria-label="Scrollable vehicle wiring schematic"><div data-cv-diagram></div></div><section class="cv-selection-detail" data-cv-detail><div data-cv-detail-body aria-live="polite"></div><div class="cv-connection-action" data-cv-connection-action hidden><button type="button" data-cv-action="connection"></button><span data-cv-action-scope></span></div><p class="cv-action-error" data-cv-action-error role="alert" hidden></p></section><details class="cv-wire-section"><summary>Wire values and connection list <span data-cv-wire-count></span></summary><div class="cv-table-scroll"><table class="cv-wire-table"><thead><tr><th>Wire / endpoints</th><th>Type</th><th>Observed value</th><th>Connection</th><th><span class="cv-sr-only">Graph</span></th></tr></thead><tbody data-cv-wires></tbody></table></div></details></div><div class="cv-empty" data-cv-empty hidden></div></div>
      <footer class="cv-note">Teaching harness: ECU and sensor cavity numbers are fictional. CAN lines show delivered message data; no electrical CAN waveform is solved. <a href="https://www.ti.com/lit/an/slla270/slla270.pdf" target="_blank" rel="noopener">CAN reference ↗</a> · <a href="https://www.csselectronics.com/pages/obd2-explained-simple-intro" target="_blank" rel="noopener">DLC reference ↗</a></footer>`;
    const $=selector=>container.querySelector(selector);
    let ctx=null,anchorId=null,unitId=null,data=null,topologyKey='',faceKey='',mode='system',arrangement='function',zoom=1,fit=true,visible=true,disposed=false,connectionControl=null,connectionPending=false,connectionError='',faultConnectionId=null,faultSensor=null,faultConfigKey='',faultError='';
    const color=wire=>wire.kind==='can'?(/CAN.?L|Communication L|bus.*low/i.test(wire.label)?'#e5ae66':'#51c9bc'):({ground:'#a8b8cb',reference:'#d7c077',power:'#e58484'})[wire.kind]||'#78b2e8';
    const pinKey=(socket,pin)=>`pin:${socket.id}:${pin.number}`;
    function applyZoom(){const svg=$('.cv-schematic');if(!svg)return;const width=data?.width||1440,available=$('.cv-diagram-scroll').getBoundingClientRect?.().width||container.getBoundingClientRect?.().width||width;const scale=fit?Math.min(1,Math.max(.4,(available-2)/width)):zoom;if(fit)zoom=scale;svg.setAttribute('style',`width:${(width*scale).toFixed(0)}px;max-width:none;min-width:0`);$('[data-cv-scale]').textContent=(fit?'Fit · ':'')+Math.round(scale*100)+'%';}
    function nodeAction(id,x,y,label,unit=false){
      if(!id||!options.onConnection)return '';
      return `<g class="cv-node-action" role="button" tabindex="0" data-cv-node-connection="${escape(id)}" aria-label="Disconnect ${escape(label)} connector"><rect x="${x}" y="${y}" width="132" height="32" rx="5"/><text x="${x+66}" y="${y+21}" text-anchor="middle" data-cv-node-action-text="${escape(id)}">Disconnect${unit?' unit':''}</text><title>Disconnect or reconnect the entire modeled connector; this is not a single pin fault.</title></g>`;
    }
    function peerMarkup(node){
      const {socket,x,y,width,height,side}=node,label=node.sensor?.label||socket.label,group=ctx.systems?.groups?.find(g=>g.id===node.sensor?.group)?.label||'Network / linked device';
      const network=node.rows.some(row=>row.wire.kind==='can'),bitrate=ctx.catalog?.configuration?.can_bitrate??node.rows.find(row=>row.wire.kind==='can')?.wire.properties?.bitrate_reference_bps;
      const badge=node.sensor?sampleBadge(node.sensor):network?`CAN network${Number.isFinite(bitrate)?' · '+fmt(bitrate/1000,'kbit/s'):''}`:'Linked device · inspect pins';
      const header=`<g class="cv-device-node" data-cv-device-socket="${escape(socket.id)}" data-cv-signal-type="${escape(characteristics(node.sensor)?.signal_type||(network?'network':'linked'))}"><g class="cv-socket-heading" role="button" tabindex="0" data-cv-select="socket:${escape(socket.id)}" aria-label="Inspect ${escape(label)}"><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="9"/><text x="${x+16}" y="${y+24}">${escape(short(label,39))}</text><text class="cv-socket-id" x="${x+16}" y="${y+43}">${escape(group)}</text><title>${escape(socket.label)} · ${escape(socket.id)}</title></g><text class="cv-node-state" x="${x+17}" y="${y+69}" data-cv-node-state="${escape(socket.id)}">Connected</text>${nodeAction(node.connectionId,x+171,y+49,label)}<text class="cv-node-sample" x="${x+17}" y="${y+95}" data-cv-node-sample="${escape(socket.id)}">Input available</text><rect class="cv-characteristic-badge" x="${x+11}" y="${y+105}" width="298" height="22" rx="4"/><text class="cv-node-characteristics" x="${x+17}" y="${y+120}" data-cv-node-characteristics="${escape(socket.id)}">${escape(badge)}</text><text class="cv-node-electrical" x="${x+17}" y="${y+143}" data-cv-node-electrical="${escape(socket.id)}">${network?'Bus bit rate; not sensor sampling':'Signal unavailable'}</text>`;
      const pins=node.rows.map(row=>`<g class="cv-pin" role="button" tabindex="0" data-cv-select="${escape(pinKey(socket,row.pin))}" aria-label="${escape(label)} pin ${row.pin.number}: ${escape(row.pin.label)}"><rect class="cv-pin-hit" x="${x+8}" y="${row.y-12}" width="${width-16}" height="23" rx="3"/><circle cx="${side==='left'?x+width:x}" cy="${row.y}" r="4"/><text class="cv-pin-number" x="${x+17}" y="${row.y+4}">${row.pin.number}</text><text class="cv-pin-label" x="${x+46}" y="${row.y+4}">${escape(short(row.pin.label,35))}</text><title>${escape(row.pin.label)}</title></g>`).join('');
      return header+pins+'</g>';
    }
    function drawDiagram(){
      const b=data.body,unitLabel=data.component?.label||'Unit';
      const body=`<rect class="cv-controller-body" data-cv-central="true" x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" rx="16"/><path class="cv-controller-header-rule" d="M${b.x+14} ${b.y+99}H${b.x+b.width-14}"/><text class="cv-controller-title" x="${b.x+b.width/2}" y="${b.y+31}" text-anchor="middle">${escape(short(unitLabel,27))}</text><text class="cv-controller-subtitle" x="${b.x+b.width/2}" y="${b.y+51}" text-anchor="middle">${data.component?.kind==='controller'?'ONE CONTROL UNIT · CONNECTOR BANKS INSIDE':'CENTRAL CONNECTOR · LINKED DEVICES AROUND IT'}</text><text class="cv-node-state" data-cv-controller-state x="${b.x+16}" y="${b.y+80}">Connected</text>${nodeAction(b.connectionId,b.x+b.width-148,b.y+60,unitLabel,true)}`;
      const banks=data.parts.map(part=>{
        const side=part.side,x=side==='left'?558:side==='right'?724:558,width=side==='footer'?324:158,edge=side==='right'?890:550;
        const categoryLabel=part.category?(part.category.id==='network'?'CAN network':part.category.id==='linked'?'Linked devices':arrangement==='rate'?fmt(part.category.order,'ms'):TYPE_LABELS[part.category.id]||'Signal'):null;
        const title=`<g class="cv-bank-heading" role="button" tabindex="0" data-cv-select="socket:${escape(part.anchor.id)}" data-cv-bank="${escape(part.anchor.id)}" data-cv-bank-category="${escape(part.category?.id||'function')}" aria-label="Inspect ${escape(part.anchor.label)}"><rect x="${x}" y="${part.y}" width="${width}" height="${part.height}" rx="4"/><text class="cv-bank-code" x="${x+9}" y="${part.y+20}">${escape(part.bankCode)} · ${escape(short(categoryLabel||part.title,side==='footer'?35:19))}</text>${part.category?`<text class="cv-bank-original" x="${x+9}" y="${part.y+36}">${escape(short(part.title,22))}</text>`:''}<title>${escape(part.anchor.label)} · ${escape(part.anchor.id)}${part.category?' · '+escape(part.category.label)+' arrangement; original connector unchanged':''}</title></g>`;
        const pins=part.rows.map(row=>`<g class="cv-pin cv-bank-pin" role="button" tabindex="0" data-cv-select="${escape(pinKey(part.anchor,row.pin))}" aria-label="${escape(part.anchor.label)} pin ${row.pin.number}: ${escape(row.pin.label)}"><rect class="cv-pin-hit" x="${x+4}" y="${row.y-12}" width="${width-8}" height="23" rx="3"/><circle cx="${edge}" cy="${row.y}" r="4"/><text class="cv-pin-number" x="${x+9}" y="${row.y+4}">${row.pin.number}</text><text class="cv-bank-pin-role" x="${x+32}" y="${row.y+4}">${escape(short(({reference:'Reference',ground:'Return',analog:'Signal input',pulse:'Pulse input',can:row.pin.label,power:'Supply'})[row.pin.role]||row.pin.label,side==='footer'?34:18))}</text><title>${escape(row.pin.label)}${row.wire?'':' · no external wire modeled'}</title></g>`).join('');return title+pins;
      }).join('');
      const links=data.nodes.flatMap(node=>node.rows.map(row=>`<g role="button" tabindex="0" class="cv-wire" data-cv-wire="${escape(row.wire.id)}" data-cv-select="wire:${escape(row.wire.id)}" aria-label="Select ${escape(row.wire.label)}"><path class="cv-wire-hit" d="${row.path}"/><path class="cv-wire-stroke" stroke="${color(row.wire)}" d="${row.path}"/><text class="cv-wire-reading" data-cv-reading="${escape(row.wire.id)}" x="${row.readingX}" y="${row.y-7}" text-anchor="middle">—</text><title>${escape(row.wire.label)}: ${escape(row.wire.from.socket_id)}.${row.wire.from.pin} → ${escape(row.wire.to.socket_id)}.${row.wire.to.pin}</title></g>`)).join('');
      const outputs=data.outputs.map(output=>`<g class="cv-output-node"><path class="cv-output-link" d="M890 174H991V${output.y+61}H1090"/><text class="cv-output-link-label" x="990" y="${output.y+43}" text-anchor="middle">Model result</text><rect x="${output.x}" y="${output.y}" width="${output.width}" height="${output.height}" rx="9"/><text class="cv-output-title" x="${output.x+16}" y="${output.y+26}">${escape(output.title)}</text><text class="cv-output-tag" x="${output.x+16}" y="${output.y+47}">LIVE OUTPUT · READ ONLY</text>${output.values.map(([label,path,unit],index)=>`<text class="cv-output-label" x="${output.x+16}" y="${output.y+77+index*23}">${escape(label)}</text><text class="cv-output-value" x="${output.x+output.width-16}" y="${output.y+77+index*23}" text-anchor="end" data-cv-output="${escape(path)}" data-cv-output-unit="${escape(unit)}">—</text>`).join('')}<text class="cv-output-scope" x="${output.x+16}" y="${output.y+output.height-24}">${escape(short(output.note,65))}</text><text class="cv-output-scope" x="${output.x+16}" y="${output.y+output.height-9}">No unplug control for these physical outputs.</text></g>`).join('');
      const categories=data.categoryGroups.map(category=>`<g class="cv-arrangement-group" data-cv-group="${escape(category.id)}"><text x="30" y="${category.y}">${escape(category.label)}</text><text x="1090" y="${category.y}">${escape(category.label)}</text><path d="M30 ${category.y+9}H350M1090 ${category.y+9}H1410"/></g>`).join('');
      $('[data-cv-diagram]').innerHTML=`<svg class="cv-schematic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${data.width} ${data.height}" role="group" aria-label="${escape(unitLabel)} central controller with surrounding sensors and modeled outputs"><rect class="cv-diagram-bg" width="${data.width}" height="${data.height}"/><text class="cv-sheet-title" x="30" y="32">${escape(unitLabel)} · ${mode==='system'?'complete system':'connector focus'}</text><text class="cv-sheet-subtitle" x="30" y="57">Disconnect a sensor at its own connector button. Reconnect it in the same place.</text><text class="cv-sheet-caption" x="30" y="78">One central controller · peripheral sensors · modeled outputs · fictional ECU cavity assignments</text>${body}${categories}${banks}${links}${data.nodes.map(peerMarkup).join('')}${outputs}</svg>`;
      applyZoom();
    }
    function rebuild(){
      const catalog=ctx.catalog||{},info=resolve(ctx.selection,catalog,ctx.signals),isOverview=ctx.selection==='overview'||info.kind==='overview';
      data=systemCircuit(catalog,unitId,ctx.systems,mode==='connector'?anchorId:null,ctx.state,arrangement);
      $('[data-cv-overview]').hidden=!isOverview;$('[data-cv-circuit]').hidden=isOverview||!data.parts.length;$('[data-cv-empty]').hidden=isOverview||!!data.parts.length;
      $('[data-cv-title]').textContent=isOverview?'Vehicle wiring':`${data.component?.label||info.label||'Component'} · wiring`;
      $('[data-cv-subtitle]').textContent=isOverview?'Choose a unit, then follow its sensors, connector banks and network access.':'The controller stays in the center. Unplug a sensor with its Disconnect button; inspect its reading and the vehicle response together.';
      $('[data-cv-action="location"]').hidden=isOverview;$('[data-cv-action="diagnosis"]').hidden=isOverview;
      if(isOverview){const fitted=SCHEMES.filter(s=>catalog.components?.find(c=>c.id===s.component)?.installed!==false),engineFitted=catalog.components?.find(c=>c.id==='ecu')?.installed!==false;
        $('[data-cv-overview]').innerHTML=`<div class="cv-circuit-list">${fitted.map(s=>{const path=s.component==='dlc'&&!engineFitted?'DLC → scan tool':s.component==='bmu'?'BMU → '+(catalog.components?.find(c=>c.id==='supervisor')?.label||'Vehicle controller'):s.path;return `<button type="button" class="cv-circuit-row" data-cv-select="${s.component}"><span class="cv-circuit-icon" aria-hidden="true">⌁</span><span><strong>${escape(s.title)}</strong><small>${escape(path)}</small><p>${escape(s.text)}</p></span><span class="cv-circuit-type">Open schematic <b>›</b></span></button>`;}).join('')}</div><div class="cv-reading-key"><strong>Read the complete connection path</strong><p>Select a unit from the vehicle map or tree. Its fitted sensors surround one central controller. Each supported sensor has its own Disconnect/Reconnect button. Pin selections highlight the path while the rest of the system stays visible.</p></div>`;return;}
      if(!data.parts.length){$('[data-cv-empty]').innerHTML=`<h3>${escape(info.label||'Component')}</h3><p>This physical or derived channel has no independent connector in the teaching model.</p><button type="button" data-cv-select="ecu">Inspect the engine ECU</button><button type="button" data-cv-select="dlc">Inspect the diagnostic socket</button>`;return;}
      const siblings=catalog.sockets?.filter(s=>s.component_id===unitId)||[];
      $('[data-cv-sockets]').innerHTML=siblings.map(s=>`<button type="button" data-cv-select="socket:${escape(s.id)}" aria-pressed="${s.id===anchorId}">${escape(s.label)}</button>`).join('');$('[data-cv-sockets]').hidden=siblings.length<2;
      $('[data-cv-action="whole"]').setAttribute('aria-pressed',String(mode==='system'));$('[data-cv-action="focus"]').setAttribute('aria-pressed',String(mode==='connector'));
      $('[data-cv-arrangement]').value=arrangement;$('[data-cv-arrangement]').disabled=mode==='connector';
      $('[data-cv-arrangement-note]').textContent=mode==='connector'?'Connector focus shows its original bank. Choose Whole unit to arrange all sensors.':'Grouping changes the drawing; connector names and pins are unchanged.';
      drawDiagram();
      $('[data-cv-wire-count]').textContent=`· ${data.wires.length} wires`;
      $('[data-cv-wires]').innerHTML=data.wires.map(w=>`<tr data-cv-row="${escape(w.id)}"><td><button type="button" class="cv-wire-select" data-cv-select="wire:${escape(w.id)}"><i style="--wire-color:${color(w)}"></i>${escape(w.label)}</button><small>${escape(w.from.socket_id)}.${w.from.pin} → ${escape(w.to.socket_id)}.${w.to.pin}</small></td><td>${escape(w.kind==='can'?'CAN message probe':w.kind)}</td><td><strong data-cv-value="${escape(w.id)}">—</strong><small data-cv-kind="${escape(w.id)}"></small></td><td><span class="cv-state" data-cv-state="${escape(w.id)}">—</span></td><td>${w.signal_id?`<button type="button" class="cv-graph" data-cv-watch="${escape(w.signal_id)}">Graph ↗</button>`:'<span class="cv-reference">Reference</span>'}</td></tr>`).join('');
    }
    function drawFace(anchor){
      const show=anchor?.id==='dlc_socket';$('[data-cv-face]').hidden=!show;
      if(!show)return;
      const key=JSON.stringify(anchor.pins);if(key===faceKey)return;faceKey=key;
      $('[data-cv-face]').innerHTML=`<div class="cv-dlc-layout"><div class="cv-dlc-shell"><div class="cv-dlc-pins">${anchor.pins.map(pin=>`<button type="button" class="cv-dlc-pin cv-role-${escape(pin.role)}" data-cv-select="pin:dlc_socket:${pin.number}" aria-label="DLC pin ${pin.number}: ${escape(pin.label)}"><b>${pin.number}</b><small>${escape(({6:'CAN-H',14:'CAN-L',4:'CH GND',5:'SIG GND',16:'+12 V',2:'J1850+',10:'J1850−',7:'K-line',15:'L-line'})[pin.number]||'OEM')}</small></button>`).join('')}</div></div><p><b>Vehicle socket · looking into its mating face</b><span>Wide edge at top · 1–8 above 9–16</span><span>CAN-H 6 + CAN-L 14 carry one differential data signal.</span><span>The unplug experiment isolates the tester branch; supply and ground references remain.</span></p></div>`;
    }
    function selectionDetail(info){
      const catalog=ctx.catalog||{},wire=info.kind==='wire'?catalog.wires?.find(w=>w.id===info.id):null;
      const sid=info.socketId||wire?.from.socket_id, socket=catalog.sockets?.find(s=>s.id===sid);
      const pin=info.kind==='pin'?socket?.pins.find(p=>p.number===info.pin):null;
      const pinMeta=sid==='dlc_socket'&&pin?ctx.scannerCatalog?.socket?.pins?.find(p=>p.number===pin.number):null;
      const links=wire?[wire]:pin?relatedWires(catalog,sid).filter(w=>[w.from,w.to].some(e=>e.socket_id===sid&&e.pin===pin.number)):[];
      const sensor=ctx.systems?.sensors?.find(s=>s.component_id===(socket?.component_id||info.componentId)||s.id===wire?.properties?.sensor_id||links.some(w=>w.connection_id===s.connection_id));
      const comp=catalog.components?.find(c=>c.id===(socket?.component_id||info.componentId));
      if(!pin&&!wire){$('[data-cv-detail-body]').innerHTML=`<strong>Select a pin or wire to inspect its job</strong><p>Highlighted paths keep the complete unit in view. Connector-bank names and sensor groups belong to this generic vehicle; the ECU cavity numbers are teaching assignments.</p>`;return;}
      const pinDescription=pin?.description&&!/Teaching connector assignment/i.test(pin.description)?pin.description:null;
      const purpose=pinMeta?.function||pinDescription||wire?.description||sensor?.description||links[0]?.description||({analog:'Analog measurement input',pulse:'A pulse signal whose frequency represents the measured quantity',reference:'Reference supply for the sensor',ground:'Sensor return / ground reference',can:'One conductor of a CAN communication pair',power:'Supply reference'})[pin?.role]||pin?.label;
      const failure=pinMeta?.failure_effect||sensor?.failure_effect||comp?.properties?.failure_effect||'Disconnect the associated connector to test its modeled effect. Individual pin faults are not simulated.';
      const sample=links.map(w=>{const live=ctx.network?.wires?.[w.id];return `${w.kind==='can'?'Message value: ':''}${w.label}: ${fmt(live?.value,live?.unit||w.unit)}`;}).join(' · ')||'No measured wire value is modeled for this cavity.';
      const endpoints=links.flatMap(w=>[w.from,w.to]).filter(e=>!(e.socket_id===sid&&e.pin===pin?.number));
      const paired=pinMeta?.paired_pins?.length?`Companion cavity ${pinMeta.paired_pins.join(', ')}${[6,14].includes(pin.number)?' · CAN differential pair':''}`:'';
      const scope=pinMeta?.model_scope||((sid==='dlc_socket')?'DLC roles are a standard connector reference; communication is modeled at message level.':'Fictional ECU/sensor pin assignment. Additional analog transfers are illustrations; only the declared coolant divider is solved.');
      const c=characteristics(sensor),liveSensor=sensor?ctx.state?.vehicle_sensors?.[sensor.id]:null,sensorConnected=!sensor?.connection_id||ctx.network?.effective_connections?.[sensor.connection_id]!==false;
      const characteristicRows=[];
      if(c){
        characteristicRows.push(`<div><dt>Sensor channel</dt><dd>${escape(c.label)}${c.range?.length===2?` · ${escape(fmt(c.range[0],c.unit||sensor.unit))} to ${escape(fmt(c.range[1],c.unit||sensor.unit))}`:''}<small>${escape(c.description||sensor.description||'')}</small></dd></div>`);
        characteristicRows.push(`<div><dt>Input sampling</dt><dd>${escape(fmt(c.timing.sample_period_ms,'ms'))} between readings · ${escape(fmt(c.timing.sample_rate_hz,'Hz'))} (samples/second)<small>${Number.isFinite(liveSensor?.age_ms)?`Last sample age: ${escape(fmt(liveSensor.age_ms,'ms'))}. `:''}${escape(sensor.importance_label||sensor.group||'')} · recording and scan-tool requests have separate intervals.</small></dd></div>`);
        if(c.electrical){
          const spec=c.electrical,levels=spec.levels?.map(level=>`${level.label} (${level.value}): ${fmt(level.voltage_v,'V')}`).join(' · ');
          characteristicRows.push(`<div><dt>Sensor electrical characteristics</dt><dd><b>${escape(electricalReading(sensor,liveSensor,sensorConnected))}</b><small>${escape(spec.label||'')}${spec.range_v?.length===2?' · '+escape(fmt(spec.range_v[0],'V'))+' to '+escape(fmt(spec.range_v[1],'V')):''}</small>${levels?`<small>${escape(levels)}</small>`:''}<small>${escape(spec.formula||'')}</small><small>${escape(spec.description||'')}</small></dd></div>`);
        }
        if(c.signal_type==='pulse')characteristicRows.push(`<div><dt>Live pulse frequency</dt><dd><b>${escape(electricalReading(sensor,liveSensor,sensorConnected))}</b><small>${escape(c.pulse?.formula||'Pulse conversion is not declared for this input.')}</small><small>${escape(c.pulse?.description||'Frequency is derived from motion, not captured electrical edges.')} Pulse frequency changes with movement; the input sampling rate above stays fixed.</small></dd></div>`);
        if(liveSensor?.conversion)characteristicRows.push('<div><dt>Conversion path</dt><dd>'+window.AppModel.conversionMarkup(liveSensor.conversion)+'</dd></div>');
      }else if(links.some(link=>link.kind==='can')){
        const bitrate=ctx.catalog?.configuration?.can_bitrate??links.find(link=>link.kind==='can')?.properties?.bitrate_reference_bps;
        characteristicRows.push(`<div><dt>CAN network timing</dt><dd>${Number.isFinite(bitrate)?escape(fmt(bitrate,'bit/s')):'Bus bit rate not declared'}<small>Shared message transport. This is not a sensor sample frequency or message update period. The lab shows delivered message values; electrical bit timing is not simulated.</small></dd></div>`);
      }
      $('[data-cv-detail-body]').innerHTML=`<div class="cv-detail-title"><strong>${escape(wire?.label||socket.label+' · pin '+pin.number+' · '+pin.label)}</strong><span>${pin?'CAVITY '+pin.number:'WIRE'}</span></div><dl><div><dt>Job</dt><dd>${escape(purpose)}</dd></div><div><dt>Signal / sample</dt><dd>${escape(sample)}</dd></div>${characteristicRows.join('')}<div><dt>Connected path</dt><dd>${endpoints.length?endpoints.map(e=>`<button type="button" data-cv-select="pin:${escape(e.socket_id)}:${e.pin}">${escape(e.socket_id)} · pin ${e.pin}</button>`).join(' '):'No external wire modeled.'}${paired?`<small>${escape(paired)}</small>`:''}</dd></div><div><dt>Unplug effect</dt><dd>${escape(failure)}</dd></div></dl><p class="cv-detail-scope">${escape(scope)}${c?.scope?' '+escape(c.scope):''}</p>`;
    }
    function connectionAction(info){
      const catalog=ctx.catalog||{},wire=info.kind==='wire'?catalog.wires?.find(w=>w.id===info.id):null;
      const sid=info.socketId||wire?.from.socket_id,socket=catalog.sockets?.find(s=>s.id===sid);
      const componentId=socket?.component_id||info.componentId,component=catalog.components?.find(c=>c.id===componentId);
      const sensor=ctx.systems?.sensors?.find(s=>s.component_id===componentId||s.id===wire?.properties?.sensor_id);
      const pinWires=info.kind==='pin'?relatedWires(catalog,sid).filter(w=>[w.from,w.to].some(e=>e.socket_id===sid&&e.pin===info.pin)):[];
      const pinConnections=[...new Set(pinWires.map(w=>w.connection_id).filter(Boolean))];
      const moduleId='unit_'+componentId,known=id=>id&&(catalog.connections?.some(c=>c.id===id)||Object.prototype.hasOwnProperty.call(ctx.network?.effective_connections||{},id));
      let id=wire?wire.connection_id:pinConnections.length===1?pinConnections[0]:socket?.connection_id||sensor?.connection_id||(known(moduleId)?moduleId:({coolant_sensor:'ect',dlc:'dlc',scan_tool:'dlc',bmu:'bmu',wheel_fl:'wheel_fl'})[componentId]);
      if(info.kind==='pin'&&sid==='dlc_socket'&&![6,14].includes(info.pin))id=null;
      if(!known(id)||!options.onConnection)id=null;
      if(connectionControl?.id!==id)connectionError='';
      const installed=socket?.installed!==false&&component?.installed!==false&&sensor?.installed!==false&&ctx.network?.components?.[componentId]?.installed!==false;
      const connected=id?ctx.network?.effective_connections?.[id]!==false:true;
      connectionControl=id?{id,connected,installed}:null;
      const row=$('[data-cv-connection-action]'),button=$('[data-cv-action="connection"]');row.hidden=!id;
      button.disabled=!id||connectionPending||(ctx.controlsBusy??ctx.busy)||!installed;
      if(id){
        button.textContent=connectionPending?'Applying connection…':id==='dlc'?(connected?'Open tester CAN branch':'Reconnect tester CAN branch'):id.startsWith('unit_')?(connected?'Disconnect unit connector':'Reconnect unit connector'):(connected?'Disconnect sensor connector':'Reconnect sensor connector');
        const target=ctx.systems?.sensors?.find(s=>s.connection_id===id)?.label||component?.label||id;
        $('[data-cv-action-scope]').textContent=id==='dlc'?'Opens the tester communication branch only; supply and ground references stay present.':id.startsWith('unit_')?'Whole unit connection: '+(component?.label||id)+'. Individual electrical pin faults are not modeled.':'Connector: '+target+'. This disconnects the modeled input; it does not open just one selected cavity.';
      }
      $('[data-cv-action-error]').hidden=!connectionError;$('[data-cv-action-error]').textContent=connectionError;
    }
    function renderNodeStates(){
      if(!ctx||!data)return;
      for(const node of data.nodes||[]){
        const connected=!node.connectionId||ctx.network?.effective_connections?.[node.connectionId]!==false;
        const sample=node.sensor?ctx.state?.vehicle_sensors?.[node.sensor.id]:null,installed=node.socket.installed!==false&&ctx.network?.components?.[node.socket.component_id]?.installed!==false;
        const row=$(`[data-cv-device-socket="${node.socket.id}"]`),status=$(`[data-cv-node-state="${node.socket.id}"]`),reading=$(`[data-cv-node-sample="${node.socket.id}"]`),electrical=$(`[data-cv-node-electrical="${node.socket.id}"]`);
        if(row){row.classList.toggle('cv-device-open',!connected);row.classList.toggle('cv-device-unfitted',!installed);}
        if(status)status.textContent=!installed?'Not fitted':connected?'Connected':'Unplugged';
        if(reading){
          const inputLabel=node.sensor?.unit_id==='ecu'?'ECU input':'Unit input';
          let message=sample?sample.validity==='valid'?`${inputLabel}: ${fmt(sample.value,sample.unit)}`:`${inputLabel}: unavailable (${sample.validity||'no sample'})`:node.connectionId==='dlc'?(connected?'Tester CAN branch available':'Tester CAN branch open'):'Inspect pins for the available values';
          if(!connected&&sample?.validity==='valid')message='Unplugged · waiting for next sample';
          reading.textContent=short(message,48);
        }
        if(electrical&&node.sensor)electrical.textContent=short(electricalReading(node.sensor,sample,connected&&installed),49);
      }
      for(const button of container.querySelectorAll('[data-cv-node-connection]')){
        const id=button.dataset.cvNodeConnection,entry=ctx.catalog?.connections?.find(c=>c.id===id),connected=ctx.network?.effective_connections?.[id]!==false;
        const disabled=connectionPending||(ctx.controlsBusy??ctx.busy)||entry?.installed===false||ctx.network?.components?.[entry?.component_id]?.installed===false;
        button.setAttribute('aria-disabled',String(!!disabled));button.setAttribute('tabindex',disabled?'-1':'0');button.classList.toggle('cv-reconnect',!connected);
        button.setAttribute('aria-label',`${connected?'Disconnect':'Reconnect'} ${entry?.label||id}${id==='dlc'?' (tester CAN branch only)':''}`);
        const text=button.querySelector('[data-cv-node-action-text]');if(text)text.textContent=connectionPending?'Applying…':id==='dlc'?(connected?'Open CAN branch':'Reconnect CAN'):connected?'Disconnect':'Reconnect';
      }
      const controllerState=$('[data-cv-controller-state]');if(controllerState){const fitted=data.component?.installed!==false&&ctx.network?.components?.[unitId]?.installed!==false,connected=!data.body.connectionId||ctx.network?.effective_connections?.[data.body.connectionId]!==false;controllerState.textContent=!fitted?'Not fitted':data.body.connectionId==='dlc'?(connected?'CAN branch connected':'CAN branch open'):connected?'Unit connected':'Unit unplugged';}
      for(const field of container.querySelectorAll('[data-cv-output]')){
        const path=field.dataset.cvOutput,value=stateValue(ctx.state,path);
        field.textContent=typeof value==='boolean'?(path==='engine_running'?(value?'Running':'Stopped'):(value?'Active':'Inactive')):fmt(value,field.dataset.cvOutputUnit);
      }
    }
    function renderImpact(info){
      const sensors=ctx.systems?.sensors||[],wire=info.kind==='wire'?ctx.catalog?.wires?.find(w=>w.id===info.id):null;
      const selected=sensors.find(sensor=>sensor.component_id===info.componentId||sensor.connection_id===wire?.connection_id);
      const visibleIds=new Set((data?.nodes||[]).map(node=>node.sensor?.id).filter(Boolean));
      const open=sensors.filter(sensor=>visibleIds.has(sensor.id)&&sensor.installed!==false&&ctx.network?.effective_connections?.[sensor.connection_id]===false);
      const sensor=selected||open[0];
      const panel=$('[data-cv-impact]');panel.hidden=!sensor;if(!sensor){renderFaultControls(null);return;}
      const disconnected=ctx.network?.effective_connections?.[sensor.connection_id]===false,sample=ctx.state?.vehicle_sensors?.[sensor.id],vehicle=ctx.state?.vehicle||{};
      panel.classList.toggle('cv-impact-fault',disconnected);
      $('[data-cv-impact-title]').textContent=`${sensor.label} · ${disconnected?'Unplugged':'Connected'}`;
      const input=sample?.validity==='valid'?(disconnected?'Last sample '+fmt(sample.value,sample.unit)+'; update pending':fmt(sample.value,sample.unit)):sample?'Unavailable · '+(sample.validity_note||sample.validity):'See the declared signal sample';
      let engine=vehicle.configuration?.has_engine===false?'No combustion engine in this vehicle':ctx.state.engine_running?'Combustion running':vehicle.engine_inhibited||vehicle.start_state==='inhibited'?'Combustion stopped / start inhibited':'Combustion stopped';
      const detail=ctx.state?.sensor_dtcs?.details?.find(d=>d.sensor_id===sensor.id),moduleMemory=ctx.state?.sensor_dtcs?.modules?.[sensor.unit_id]||[];
      const codes=detail?.stored?detail.code+' stored':detail?.pending?detail.code+' pending':moduleMemory.length?moduleMemory.join(', ')+' · retained unit events':sensor.unit_id==='ecu'?'No sensor DTC recorded yet':'No recorded unit faults';
      const hasEngine=vehicle.configuration?.has_engine!==false;
      const facts=[[sensor.unit_id==='ecu'?'ECU reading':'Unit reading',input],[hasEngine?'Engine state':'Drive state',hasEngine?engine:vehicle.ready?'READY':vehicle.start_state||'Off'],[hasEngine?'Physical shaft':'Vehicle speed',hasEngine?fmt(ctx.state.rpm,'rpm'):fmt(ctx.state.speed_kph,'km/h')],['Fault memory',codes]];
      if(['derate','zero_torque'].includes(sensor.fault_effect)&&Number.isFinite(vehicle.torque_factor))facts.push(['Vehicle torque allowance',fmt(vehicle.torque_factor*100,'%')]);
      if(sensor.fault_effect==='abs_inhibit'&&typeof vehicle.abs_inhibited==='boolean')facts.push(['Vehicle ABS inhibited',vehicle.abs_inhibited?'Yes':'No']);
      if(['abs_inhibit','esp_inhibit'].includes(sensor.fault_effect)&&typeof vehicle.esp_inhibited==='boolean')facts.push(['Vehicle ESP inhibited',vehicle.esp_inhibited?'Yes':'No']);
      $('[data-cv-impact-facts]').innerHTML=facts.map(([label,value])=>`<span><b>${escape(label)}</b>${escape(value)}</span>`).join('');
      $('[data-cv-impact-effect]').textContent=(disconnected?'Modeled consequence: ':'If unplugged: ')+(sensor.failure_effect||sensor.description);
      const clockState=ctx.running===true?'running':ctx.running===false?'paused; check the local server connection':'shared vehicle clock';
      $('[data-cv-impact-clock]').textContent=`Simulation time ${fmt(ctx.state.t,'s')} · ${clockState}. Physical shaft and wheel motion can coast while a sensor input is missing.${open.length>1?' '+open.length+' sensor connectors are currently unplugged.':''}`;
      renderFaultControls(sensor);
    }
    function renderFaultControls(sensor){
      faultSensor=sensor;
      const control=$('[data-cv-fault-controls]'),id=sensor?.connection_id;
      const supported=!!(id&&sensor.installed!==false&&sensor.disconnectable!==false&&options.onConnectionFault&&ctx.catalog?.connections?.some(connection=>connection.id===id&&connection.installed!==false)&&ctx.network?.components?.[sensor.component_id]?.installed!==false);
      control.hidden=!supported;faultConnectionId=supported?id:null;if(!supported)return;
      const fault=ctx.state?.connection_faults?.[id],active=fault?.mode==='intermittent',connected=ctx.network?.effective_connections?.[id]!==false;
      const configKey=JSON.stringify([id,active,fault?.pattern,fault?.connected_s,fault?.dropout_s]);
      if(configKey!==faultConfigKey){faultConfigKey=configKey;faultError='';$('[data-cv-fault-pattern]').value=fault?.pattern||'regular';$('[data-cv-fault-connected]').value=fault?.connected_s??3;$('[data-cv-fault-dropout]').value=fault?.dropout_s??1;}
      const status=active?`${fault.phase==='dropout'?'Disconnected':'Connected'} · ${fault.phase==='dropout'?'reconnects':'disconnects'} in ${fmt(fault.time_to_change_s,'s')} · ${fault.dropout_count??0} dropouts`:connected?'Connected · steady input':'Disconnected · steady fault';
      $('[data-cv-fault-status]').textContent=status;
      const busy=connectionPending||(ctx.controlsBusy??ctx.busy),start=$('[data-cv-action="start-intermittent"]'),stop=$('[data-cv-action="stop-intermittent"]');
      start.textContent=connectionPending?'Applying…':active?'Apply & restart':'Start intermittent';start.disabled=!!busy;stop.hidden=!active;stop.disabled=!!busy;
      for(const field of ['[data-cv-fault-pattern]','[data-cv-fault-connected]','[data-cv-fault-dropout]'])$(field).disabled=!!busy;
      $('[data-cv-fault-error]').hidden=!faultError;$('[data-cv-fault-error]').textContent=faultError;
    }
    async function operateConnectionFault(mode){
      if(!faultConnectionId||!options.onConnectionFault||connectionPending||(ctx.controlsBusy??ctx.busy))return;
      const id=faultConnectionId,settings={mode};
      if(mode==='intermittent'){
        const connected=Number($('[data-cv-fault-connected]').value),dropout=Number($('[data-cv-fault-dropout]').value);
        if(![connected,dropout].every(value=>Number.isFinite(value)&&value>=.002&&value<=3600)){faultError='Choose durations from 0.002 to 3,600 seconds.';renderFaultControls(faultSensor);return;}
        Object.assign(settings,{pattern:$('[data-cv-fault-pattern]').value,connected_s:connected,dropout_s:dropout});
      }
      connectionPending=true;faultError='';renderFaultControls(faultSensor);renderNodeStates();
      try{await options.onConnectionFault(id,settings);}catch(error){faultError=error.message||String(error);}finally{connectionPending=false;renderFaultControls(faultSensor);renderNodeStates();connectionAction(resolve(ctx.selection,ctx.catalog||{},ctx.signals));}
    }
    async function operateConnection(id=null){
      const entry=id?ctx.catalog?.connections?.find(c=>c.id===id):null;
      const target=id?{id,connected:ctx.network?.effective_connections?.[id]!==false,installed:entry?.installed!==false&&ctx.network?.components?.[entry?.component_id]?.installed!==false}:connectionControl;
      if(!target||!options.onConnection||connectionPending||!target.installed||(ctx.controlsBusy??ctx.busy))return;
      connectionPending=true;connectionError='';connectionAction(resolve(ctx.selection,ctx.catalog||{},ctx.signals));renderNodeStates();renderFaultControls(faultSensor);
      try{await options.onConnection(target.id,!target.connected);}catch(error){connectionError=error.message||String(error);}finally{connectionPending=false;connectionAction(resolve(ctx.selection,ctx.catalog||{},ctx.signals));renderNodeStates();renderFaultControls(faultSensor);}
    }
    function refresh(){
      if(!ctx||disposed||!visible)return;
      const catalog=ctx.catalog||{},info=resolve(ctx.selection,catalog,ctx.signals),nextAnchor=selectedSocket(ctx.selection,catalog,ctx.signals,anchorId);
      const touching=info.kind==='wire'?catalog.wires?.find(w=>w.id===info.id):null;
      const inContext=data?.socketIds.includes(nextAnchor)||(touching&&[touching.from.socket_id,touching.to.socket_id].some(id=>data?.socketIds.includes(id)));
      const nextUnit=['pin','socket','wire'].includes(info.kind)&&inContext&&unitId?unitId:ownerFor(info,catalog,ctx.systems);
      anchorId=nextAnchor;unitId=nextUnit;
      const key=JSON.stringify([unitId,mode,arrangement,mode==='connector'?anchorId:null,ctx.selection==='overview',catalog.configuration,catalog.schema,catalog.sockets?.length,catalog.wires?.length]);
      if(key!==topologyKey){topologyKey=key;rebuild();}
      const anchor=catalog.sockets?.find(s=>s.id===anchorId),installed=anchor?anchor.installed!==false&&ctx.network?.components?.[anchor.component_id]?.installed!==false:true;
      const connection=anchor?.connection_id,connected=connection?ctx.network?.effective_connections?.[connection]!==false:true;
      $('[data-cv-connection]').textContent=!installed?'Not installed in this vehicle configuration':connection?(connected?'Connector connected':'Connector open'):`${data?.parts.length||0} connector banks · ${data?.wires.length||0} connected wires`;
      $('[data-cv-connection]').className=!installed?'cv-status-muted':connected?'cv-status-good':'cv-status-open';
      drawFace(anchor);
      const highlighted=new Set(info.kind==='wire'?[info.id]:info.kind==='pin'?relatedWires(catalog,info.socketId||info.id).filter(w=>[w.from,w.to].some(e=>e.socket_id===(info.socketId||info.id)&&e.pin===info.pin)).map(w=>w.id):[]);
      for(const element of container.querySelectorAll('[data-cv-select]')){
        const selected=element.dataset.cvSelect===ctx.selection;element.classList.toggle('selected',selected);if(element.tagName?.toLowerCase()==='g')element.setAttribute('aria-pressed',String(selected));
      }
      for(const wire of data?.wires||[]){
        const live=ctx.network?.wires?.[wire.id],element=$(`[data-cv-wire="${wire.id}"]`),row=$(`[data-cv-row="${wire.id}"]`);
        element?.classList.toggle('cv-open',live?.connected===false);element?.classList.toggle('cv-unavailable',live?.available===false);element?.classList.toggle('cv-highlight',highlighted.has(wire.id));element?.classList.toggle('cv-dim',highlighted.size>0&&!highlighted.has(wire.id));
        row?.classList.toggle('selected',highlighted.has(wire.id));
        const value=$(`[data-cv-value="${wire.id}"]`),kind=$(`[data-cv-kind="${wire.id}"]`),status=$(`[data-cv-state="${wire.id}"]`),reading=$(`[data-cv-reading="${wire.id}"]`);
        if(value)value.textContent=fmt(live?.value,live?.unit||wire.unit);if(reading)reading.textContent=short((wire.kind==='can'?'Data · ':'')+fmt(live?.value,live?.unit||wire.unit),26);
        if(kind)kind.textContent=wire.kind==='can'?'Application data, not CAN voltage':live?.sample_kind||'No sample yet';
        if(status){status.textContent=live?.status||'No sample';status.className='cv-state '+(live?.connected===false?'cv-state-open':live?.available===false?'cv-state-muted':'cv-state-good');}
      }
      selectionDetail(info);connectionAction(info);renderNodeStates();renderImpact(info);
    }
    function click(event){const target=event.target.closest?.('[data-cv-select],[data-cv-watch],[data-cv-action],[data-cv-node-connection]');if(!target||target.disabled||target.getAttribute?.('aria-disabled')==='true'||!container.contains?.(target)&&!target.closest?.('.connection-view'))return;
      if(target.dataset.cvNodeConnection){const id=target.dataset.cvNodeConnection,entry=ctx.catalog?.connections?.find(c=>c.id===id);if(entry?.component_id)options.onSelect?.(entry.component_id);return operateConnection(id);}
      if(target.dataset.cvSelect)options.onSelect?.(target.dataset.cvSelect);
      else if(target.dataset.cvWatch){options.onWatch?.(target.dataset.cvWatch,true);options.onNavigate?.('live');}
      else{const action=target.dataset.cvAction;if(action==='connection')return operateConnection();else if(action==='start-intermittent')return operateConnectionFault('intermittent');else if(action==='stop-intermittent')return operateConnectionFault('normal');else if(action==='location')options.onNavigate?.('locations');else if(action==='diagnosis')options.onNavigate?.('diagnosis');else if(action==='whole'||action==='focus'){mode=action==='whole'?'system':'connector';topologyKey='';refresh();}else if(action==='fit'){fit=true;applyZoom();}else if(action==='actual'){fit=false;zoom=1;applyZoom();}else if(action==='zoom-in'||action==='zoom-out'){fit=false;zoom=_zoom(action==='zoom-in'?.15:-.15);applyZoom();}}
    }
    function _zoom(delta){return Math.min(2,Math.max(.4,zoom+delta));}
    function change(event){if(event.target.matches?.('[data-cv-arrangement]')&&!event.target.disabled&&['function','type','rate'].includes(event.target.value)){arrangement=event.target.value;topologyKey='';refresh();}}
    function key(event){if(['Enter',' '].includes(event.key)&&event.target.closest?.('g[data-cv-select],g[data-cv-node-connection]')){event.preventDefault();click(event);}}
    container.addEventListener('click',click);container.addEventListener('keydown',key);container.addEventListener('change',change);
    return {update(value){ctx=value;refresh();},setVisible(value){visible=!!value;if(visible){refresh();applyZoom();}},resize(){applyZoom();},inspect(){return {selection:ctx?.selection,anchorId,unitId,mode,arrangement,visible,zoom:fit?'fit':zoom,width:data?.width,height:data?.height,groups:data?.parts.map(p=>({title:p.title,anchorId:p.anchor.id,bankCode:p.bankCode,categoryId:p.category?.id||null,side:p.side,y:p.y,height:p.height})),categories:data?.categoryGroups.map(c=>({id:c.id,label:c.label,y:c.y})),nodes:data?.nodes.map(n=>({socketId:n.socket.id,componentId:n.socket.component_id,connectionId:n.connectionId,signalType:characteristics(n.sensor)?.signal_type||null,samplePeriodMs:characteristics(n.sensor)?.timing.sample_period_ms||null,categoryId:n.category?.id||null,side:n.side,x:n.x,y:n.y,width:n.width,height:n.height,pins:n.rows.map(r=>({number:r.pin.number,y:r.y,bankY:r.ownY,wireId:r.wire.id}))})),body:data?.body,outputs:data?.outputs.map(o=>o.id),wires:data?.wires.map(w=>w.id)||[]};},dispose(){disposed=true;container.removeEventListener('click',click);container.removeEventListener('keydown',key);container.removeEventListener('change',change);container.replaceChildren();}};
  }
  function createLocations(container,options={}) {
    if(!container)throw new Error('LocationsView requires a container.');
    container.classList.add('locations-view');
    container.innerHTML=`<header class="lv-heading"><div><h2>Component locations</h2><p data-lv-context>Select a component to locate it in the teaching vehicle.</p></div><button type="button" data-lv-wiring>Open wiring →</button></header><div class="lv-vehicle"></div><footer class="lv-note">Generic teaching locations. Wheels follow the same physical simulation; socket geometry and OEM service locations are not modeled.</footer>`;
    const $=selector=>container.querySelector(selector), root=$('.lv-vehicle');
    let current=null,selected=null,visible=true;
    const view=window.VehicleView?.create(root,{theme:'dark',locator:true,onSelect(id){const wire=current?.catalog?.wires?.find(w=>w.id===id);options.onSelect?.(wire?`wire:${id}`:id);}});
    if(!view)root.textContent='The vehicle location renderer could not be loaded. Use Wiring to inspect the same connection graph.';
    const wiring=()=>options.onNavigate?.('wiring');$('[data-lv-wiring]').addEventListener('click',wiring);
    return {
      update(ctx){
        current=ctx;const info=resolve(ctx.selection,ctx.catalog,ctx.signals);
        const id=info.componentId || (ctx.catalog?.components?.some(c=>c.id===ctx.selection)?ctx.selection:'');
        view?.update(ctx.state,ctx.network,ctx.catalog);
        if(selected!==id){selected=id;view?.select(id);}
        $('[data-lv-context]').textContent=id?`${info.label||ctx.catalog?.components?.find(c=>c.id===id)?.label||id} · selected in every view`:'Select a component in the tree or on the vehicle.';
        $('[data-lv-wiring]').disabled=!id;
      },
      setVisible(value){visible=!!value;view?.setVisible(visible);if(visible)view?.resize();},
      resize(){view?.resize();},inspect(){return {selected,visible,vehicle:view?.inspect?.()};},
      dispose(){$('[data-lv-wiring]').removeEventListener('click',wiring);view?.dispose();container.replaceChildren();}
    };
  }
  window.ConnectionView={create,circuit,selectedSocket,systemCircuit};
  window.LocationsView={create:createLocations};
})();
