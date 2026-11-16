/* A selectable unit inventory over the same vehicle snapshot as the cockpit. */
(() => {
  'use strict';
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const finite=value=>typeof value==='number'&&Number.isFinite(value);
  const read=(object,path)=>String(path||'').split('.').reduce((value,key)=>value?.[key],object);
  const format=(value,unit='')=>value==null?'—':typeof value==='boolean'?(value?'On':'Off'):finite(value)?value.toLocaleString('en-GB',{maximumFractionDigits:Math.abs(value)>=100?0:2})+(unit?' '+unit:''):String(value)+(unit?' '+unit:'');
  const period=ms=>finite(ms)?ms>=1000?format(ms/1000,'s'):format(ms,'ms'):'—';
  const shortEffect=value=>{const text=String(value||'');return text.length<=110?text:text.slice(0,110).replace(/\s+\S*$/,'')+'…';};
  const SIGNAL_TYPES=[
    {id:'analog',label:'Analogue voltage',glyph:'M1 8C3 0 5 0 7 8s4 8 6 0 4-8 6 0'},
    {id:'digital',label:'Digital on/off',glyph:'M1 13h7V3h11'},
    {id:'pulse',label:'Pulse frequency',glyph:'M1 13h3V3h4v10h4V3h4v10h3'},
    {id:'discrete',label:'Discrete state',glyph:'M2 4h5m6 0h5M2 12h5m6 0h5M10 2v12'},
    {id:'derived',label:'Calculated value',glyph:'M3 2h14M3 2l7 6-7 6h14'}
  ];
  const characteristics=sensor=>{
    if(sensor.characteristics)return sensor.characteristics;
    const type=sensor.disconnectable===false||sensor.connection_id===null?'derived':sensor.kind==='state'?'discrete':sensor.kind||'analog',timingMs=sensor.period_ms;
    return {signal_type:type,label:SIGNAL_TYPES.find(item=>item.id===type)?.label||'Signal',unit:sensor.unit,range:sensor.range,description:sensor.description,electrical:null,pulse:null,timing:{sample_period_ms:timingMs,sample_rate_hz:finite(timingMs)&&timingMs>0?1000/timingMs:null,group_id:finite(timingMs)?'period_'+timingMs+'ms':'unspecified'},scope:'Characteristics describe this configured teaching model.'};
  };
  const sampling=sensor=>{const c=characteristics(sensor),ms=c.timing?.sample_period_ms??sensor.period_ms,rate=c.timing?.sample_rate_hz??(finite(ms)&&ms>0?1000/ms:null);return {ms,rate,id:c.timing?.group_id||(finite(ms)?'period_'+ms+'ms':'unspecified')};};
  const samplingLabel=sensor=>{const {ms,rate}=sampling(sensor);return finite(ms)&&finite(rate)?format(ms,'ms')+' · '+format(rate)+(rate===1?' sample/s':' samples/s'):'Sampling not specified';};
  function signalBadge(sensor){const c=characteristics(sensor),definition=SIGNAL_TYPES.find(item=>item.id===c.signal_type);return `<span class="um-signal-type" data-um-signal-type="${esc(sensor.id)}" data-signal-type="${esc(c.signal_type)}">${definition?`<svg class="um-type-glyph" viewBox="0 0 20 16" aria-hidden="true"><path d="${definition.glyph}"/></svg>`:''}${esc(c.label||definition?.label||'Signal')}</span>`;}
  function characteristicsMarkup(sensor){const c=characteristics(sensor),type=c.signal_type,range=Array.isArray(c.range)&&c.range.length===2?c.range.map(value=>format(value,c.unit||sensor.unit)).join(' to '):type==='digital'?'Off / On':type==='discrete'?'Defined selector states': 'Not specified',electrical=c.electrical,pulse=c.pulse;
    const facts=[['Physical range',range],['Signal',c.description],['Sampling',samplingLabel(sensor)]];
    if(electrical){facts.push(['Electrical model',electrical.label||electrical.model]);if(Array.isArray(electrical.range_v))facts.push(['Signal voltage range',electrical.range_v.map(value=>format(value,'V')).join(' to ')]);if(electrical.formula)facts.push(['Transfer',electrical.formula]);if(electrical.levels?.length)facts.push(['Logic levels',electrical.levels.map(level=>level.label+': '+format(level.voltage_v,'V')).join('; ')]);if(electrical.description)facts.push(['Electrical scope',electrical.description]);}
    if(pulse){if(finite(pulse.pulses_per_revolution))facts.push(['Pulses per revolution',format(pulse.pulses_per_revolution)]);if(pulse.reference)facts.push(['Rotation reference',pulse.reference]);if(pulse.formula)facts.push(['Pulse calculation',pulse.formula]);if(pulse.description)facts.push(['Pulse scope',pulse.description]);}
    if(type==='derived')facts.push(['Connection','Calculated channel; no independent sensor connector or wire voltage.']);
    return `<details class="um-characteristics-detail" data-um-characteristics="${esc(sensor.id)}"><summary>Characteristics</summary><dl>${facts.filter(([,value])=>value).map(([label,value])=>`<dt>${esc(label)}</dt><dd>${esc(value)}</dd>`).join('')}</dl>${c.scope?`<p>${esc(c.scope)}</p>`:''}</details>`;
  }
  const icons={
    engine:'<path d="M4 8h4V5h9v3h3v10h-4v2H8v-3H4zM10 2h5M1 10v5M20 11h3v5h-3"/>',
    ecu:'<rect x="5" y="5" width="14" height="14" rx="2"/><path d="M9 1v4m6-4v4M9 19v4m6-4v4M1 9h4m-4 6h4m14-6h4m-4 6h4M9 9h6v6H9z"/>',
    transmission:'<path d="M5 3v18M19 3v9H5m7-9v18"/><circle cx="5" cy="3" r="2"/><circle cx="19" cy="3" r="2"/><circle cx="12" cy="21" r="2"/>',
    abs:'<circle cx="12" cy="12" r="7"/><path d="M3 5a11 11 0 0 0 0 14M21 5a11 11 0 0 1 0 14M12 8v5m0 2v1"/>',
    battery:'<rect x="2" y="6" width="18" height="13" rx="2"/><path d="M20 10h2v5h-2M6 9v7m-3-3h6m5 0h3"/>',
    bmu:'<rect x="4" y="4" width="16" height="16" rx="3"/><path d="m7 13 3-4 3 7 2-4h3M9 1v3m6-3v3M9 20v3m6-3v3"/>',
    inverter:'<circle cx="12" cy="12" r="9"/><path d="m13 4-6 9h5l-1 7 7-10h-5z"/>',
    supervisor:'<circle cx="12" cy="12" r="5"/><path d="M12 1v6m0 10v6M1 12h6m10 0h6M4 4l4 4m8 8 4 4M4 20l4-4m8-8 4-4"/>',
    body:'<path d="m4 10 3-6h10l3 6v9h-3v-3H7v3H4zM4 10h16M7 13h1m8 0h1"/>',
    cluster:'<path d="M3 17a9 9 0 1 1 18 0Z"/><path d="m12 13 5-5M5 13h2m11 0h1M12 5v2"/>',
    hvac:'<circle cx="12" cy="12" r="2"/><path d="M12 10c-6-1-6-7-2-7 3 0 5 4 2 7Zm2 2c1-6 7-6 7-2 0 3-4 5-7 2Zm-2 2c6 1 6 7 2 7-3 0-5-4-2-7Zm-2-2c-1 6-7 6-7 2 0-3 4-5 7-2Z"/>',
    charging:'<path d="M9 2v6m6-6v6M6 8h12v4a6 6 0 0 1-6 6v4M9 18v3"/>',
    dlc:'<path d="M3 6h18l-3 12H6zM7 10h1m3 0h1m3 0h1m-8 4h1m3 0h1m3 0h1"/>',
    scan_tool:'<rect x="5" y="2" width="14" height="19" rx="2"/><path d="M8 5h8v8H8zM8 17h2m3 0h3M12 21v2"/>'
  };
  const ORDER=['engine','ecu','transmission','abs','supervisor','inverter','battery','bmu','charging','body','hvac','cluster','dlc','scan_tool'];
  function create(container,options={}) {
    if(!container)throw new Error('UnitMapView requires a container');
    container.classList.add('um-view');
    container.innerHTML=`<header class="um-heading"><div><span class="um-eyebrow">VEHICLE UNITS</span><h2>Open a unit. Follow its signals.</h2><p data-um="configuration"></p></div><div class="um-heading-actions"><button type="button" class="um-full-wiring" data-um-action="full-wiring">Open full wiring schematic</button><label class="um-unfitted"><input type="checkbox" data-um="show-unfitted"> Show units not fitted</label></div></header>
      <section class="um-map-panel" aria-label="Selectable vehicle unit map"><div class="um-map-heading"><span>Functional map</span><span data-um="map-count"></span></div><svg class="um-map" data-um="map" role="group" aria-label="Click a vehicle unit to inspect its state and sensor groups" viewBox="0 0 900 400"></svg><p class="um-map-note">Lines group the systems in this teaching vehicle. Open Wiring for individual conductors and connectors.</p></section>
      <section class="um-detail" aria-label="Selected unit"><div class="um-detail-heading"><div><span class="um-eyebrow" data-um="unit-group">UNIT INSPECTION</span><h3 data-um="unit-title">Choose a unit above</h3><p data-um="unit-description">Inspect the ECU, brakes, transmission or electrical system without changing the simulation.</p></div><span class="um-unit-status" data-um="unit-status"></span></div>
        <div class="um-unit-actions" data-um="unit-actions" hidden><button type="button" data-um-action="signals">Signals</button><button type="button" data-um-action="wiring">Wiring &amp; connectors</button><button type="button" data-um-action="location">Vehicle location</button><button type="button" data-um-action="diagnostics">Open scan tool</button></div>
        <div class="um-sensors-toolbar" data-um="sensors-toolbar" hidden><label class="um-grouping-control">Group by <select data-um="group-by" aria-label="Group sensor rows by"><option value="purpose">Purpose</option><option value="system">Sensor system</option><option value="signal-type">Signal type</option><option value="sample-rate">Sample rate</option></select></label><label>Purpose <select data-um="purpose" aria-label="Functional purpose of sensors in selected unit"><option value="all">All purposes</option></select></label><label>Sensor group <select data-um="group" aria-label="Sensor group in selected vehicle unit"><option value="all">All groups</option></select></label><span data-um="sensor-count"></span></div>
        <p class="um-timing-help" data-um="timing-help" hidden><strong>Sampling:</strong> 20 ms = 50 samples/s (50 Hz). <strong>Pulse frequency:</strong> how many sensor pulses pass each second; it changes with speed. The recording interval only controls saved log rows.</p>
        <p class="um-empty-sensors" data-um="empty-sensors" hidden>No inputs match both filters. <button type="button" data-um-action="clear-filters">Show all inputs in this unit</button></p>
        <div class="um-sensor-table-wrap" data-um="sensor-table-wrap" hidden><table class="um-sensor-table"><thead><tr><th>Sensor / input</th><th>Reported value</th><th>Sample / quality</th><th>Inspect</th></tr></thead><tbody data-um="sensor-rows"></tbody></table></div>
        <p class="um-unit-note" data-um="unit-note">One vehicle, one simulation clock. Selecting a unit keeps your current drive and diagnostic log.</p>
      </section>`;
    const $=name=>container.querySelector(`[data-um="${name}"]`);
    let ctx=null,disposed=false,visible=true,mapKey='',detailKey='',selectedId='',externalSelection='',selectedGroup='all',selectedPurpose='all',groupBy='purpose',showUnfitted=false;
    const connectionPending=new Set(),connectionErrors=new Map();
    const listeners=[],listen=(node,type,fn)=>{node.addEventListener(type,fn);listeners.push([node,type,fn]);};
    const units=()=>ctx?.systems?.units||[],sensors=()=>ctx?.systems?.sensors||[];
    const unitId=unit=>unit.id||unit.component_id;
    const unitSensors=unit=>sensors().filter(sensor=>sensor.unit_id===unitId(unit)||(unit.sensor_ids||[]).includes(sensor.id));
    const availableSensors=unit=>unitSensors(unit).filter(sensor=>showUnfitted||sensor.installed!==false);
    const currentUnit=()=>units().find(unit=>unitId(unit)===selectedId);
    const purposeGroups=()=>ctx?.systems?.functional_groups||[
      {id:'start_critical',label:'Starting and engine timing'}, {id:'running_control',label:'Propulsion and running control'},
      {id:'safety_control',label:'Braking and stability'}, {id:'energy_thermal',label:'Energy and temperature'},
      {id:'comfort_control',label:'Cabin comfort'}, {id:'monitoring',label:'Information and monitoring'}
    ];
    const sensorPurpose=sensor=>sensor.functional_group||'monitoring';
    const currentValue=sensor=>ctx?.state?.vehicle_sensors?.[sensor.id] || {value:read(ctx?.state,sensor.signal_id),validity:read(ctx?.state,sensor.signal_id)==null?'unavailable':'valid'};
    const connectionOpen=(sensor,reading)=>{const connections=ctx?.state?.effective_connections||ctx?.state?.connections||{};return reading.connected===false||connections['unit_'+sensor.unit_id]===false||(sensor.connection_id&&connections[sensor.connection_id]===false);};
    const connectorClosed=sensor=>{const connections=ctx?.state?.connections||ctx?.state?.effective_connections||{};return Object.hasOwn(connections,sensor.connection_id)?connections[sensor.connection_id]!==false:currentValue(sensor).connected!==false;};
    function text(name,value){const node=$(name);if(node.textContent!==String(value??''))node.textContent=String(value??'');}
    function status(unit){if(unit.installed===false)return {label:'Not fitted',tone:'unfitted'};
      if(unitId(unit)==='scan_tool'){const scanner=ctx?.scanner||ctx?.result?.scanner;if(!scanner?.connected)return {label:'Disconnected',tone:'off'};const labels={ready:'Ready · engine ECU',state_only:'State inspection',vehicle_off:'Vehicle off',dlc_open:'DLC branch open',bitrate_mismatch:'CAN bitrate mismatch',unit_open:'Module disconnected',not_installed:'Module not fitted'};return {label:labels[scanner.status]||scanner.status||'Connected',tone:['ready','state_only'].includes(scanner.status)?'ok':'fault'};}
      if(unitId(unit)==='dlc'){const connected=(ctx?.state?.effective_connections||ctx?.state?.connections||{}).dlc!==false;return {label:connected?'CAN branch connected':'CAN branch open',tone:!connected?'fault':ctx?.state?.vehicle?.ignition==='off'?'off':'ok'};}
      if(ctx?.state?.vehicle?.ignition==='off')return {label:'Ignition off',tone:'off'};
      const readings=unitSensors(unit).filter(sensor=>sensor.installed!==false).map(currentValue),missing=readings.filter(value=>value.powered!==false&&value.validity==='invalid').length;
      if(missing)return {label:`${missing} input${missing===1?'':'s'} invalid`,tone:'fault'};
      let value=read(ctx?.state,unit.status_path);if(/not installed/i.test(String(value||'')))value=ctx?.state?.vehicle?.start_state;
      if(/fault|timeout|disconnected|inhibit/i.test(String(value||'')))return {label:String(value).replaceAll('_',' '),tone:'fault'};
      if(ctx?.state?.vehicle?.ignition==='off'||value==='off'||value==='OFF')return {label:'Ignition off',tone:'off'};
      if(value!=null){const label=String(value).replaceAll('_',' ').toLowerCase();return {label:label.charAt(0).toUpperCase()+label.slice(1),tone:'ok'};}
      return {label:'State available',tone:'ok'};
    }
    function select(id){selectedId=id;selectedGroup='all';selectedPurpose='all';detailKey='';options.onSelect?.(id);render();}
    function resolveSelection(selection){
      const bare=String(selection||'');if(units().some(unit=>unitId(unit)===bare))return bare;
      const resolved=window.AppModel?.resolveSelection?.(bare,ctx?.catalog,ctx?.signals),component=resolved?.componentId||bare;
      if(units().some(unit=>unitId(unit)===component))return component;
      const sensor=sensors().find(item=>item.component_id===component||item.id===component||'signal:'+item.signal_id===bare||'socket:'+item.socket_id===bare);
      return sensor?.unit_id||'';
    }
    function mapMarkup(){const sorted=units().filter(unit=>showUnfitted||unit.installed!==false).sort((a,b)=>{
        const ai=ORDER.indexOf(unitId(a)),bi=ORDER.indexOf(unitId(b));return (ai<0?99:ai)-(bi<0?99:bi);
      }),width=container.getBoundingClientRect?.().width||900,columns=width<400?1:width<650?2:3,key=JSON.stringify([columns,sorted.map(unit=>[unitId(unit),unit.label,unit.installed,unit.sensor_ids])]);
      if(key===mapKey)return;mapKey=key;
      const rows=Math.max(1,Math.ceil(sorted.length/columns)),height=rows*112+26;$('map').setAttribute('viewBox',`0 0 ${columns*300} ${height}`);
      let markup='';
      const trunk=columns===3?450:columns===2?300:150;
      if(rows>1)markup+=`<path class="um-group-line" d="M${trunk} 47V${(rows-1)*112+47}"/>`;
      for(let row=0;row<rows;row++){const first=row*columns,count=Math.min(columns,sorted.length-first);if(count>1)markup+=`<path class="um-group-line" d="M156 ${row*112+47}H${count===3?744:450}"/>`;}
      sorted.forEach((unit,index)=>{const id=unitId(unit),x=24+(index%columns)*300,y=14+Math.floor(index/columns)*112,icon=icons[id]||icons.ecu,label=unit.label||id,words=label.split(' ');let line1=label,line2='';
        if(label.length>24){let joined='';while(words.length&&(joined+' '+words[0]).trim().length<=24)joined+=(joined?' ':'')+words.shift();line1=joined;line2=words.join(' ');}
        const inputCount=unitSensors(unit).filter(sensor=>sensor.installed!==false).length,summary=inputCount?inputCount+' inputs':({engine:'Plant state',battery:'Plant state',dlc:'16 pins',scan_tool:'Adapter',charging:'Reference only'})[id]||'Model state';
        markup+=`<g class="um-node ${unit.installed===false?'unfitted':''}" data-um-unit="${esc(id)}" transform="translate(${x} ${y})" role="button" tabindex="0" aria-label="${esc(label)}${unit.installed===false?', not fitted':''}" aria-pressed="false"><rect class="um-node-card" width="252" height="88" rx="8"/><g class="um-node-icon" transform="translate(14 15)">${icon}</g><text x="51" y="26" class="um-node-title">${esc(line1)}</text>${line2?`<text x="51" y="42" class="um-node-title um-title-second">${esc(line2)}</text>`:''}<circle class="um-status-dot" cx="18" cy="67" r="3"/><text class="um-node-state" x="29" y="71" data-um-node-state="${esc(id)}">—</text><text class="um-node-sensors" x="237" y="71" text-anchor="end">${summary}</text></g>`;
      });
      $('map').innerHTML=markup;
    }
    function detailMarkup(unit){const list=unit?availableSensors(unit):[],key=JSON.stringify([unit&&unitId(unit),showUnfitted,list.map(sensor=>[sensor.id,sensor.group,sensor.functional_group,sensor.importance_label,sensor.failure_effect,sensor.installed,sensor.characteristics,sensor.period_ms]),selectedGroup,selectedPurpose,groupBy]);
      if(detailKey===key)return;detailKey=key;
      if(!unit){$('unit-actions').hidden=true;$('sensors-toolbar').hidden=true;$('timing-help').hidden=true;$('sensor-table-wrap').hidden=true;$('empty-sensors').hidden=true;return;}
      const groups=[...new Set(list.map(sensor=>sensor.group))],labels=new Map((ctx.systems.groups||[]).map(group=>[group.id,group.label]));
      $('group').innerHTML='<option value="all">All groups</option>'+groups.map(group=>`<option value="${esc(group)}">${esc(labels.get(group)||group)}</option>`).join('');
      if(!groups.includes(selectedGroup))selectedGroup='all';$('group').value=selectedGroup;
      const purposes=purposeGroups().filter(group=>list.some(sensor=>sensorPurpose(sensor)===group.id));
      if(!purposes.some(group=>group.id===selectedPurpose))selectedPurpose='all';
      $('purpose').innerHTML='<option value="all">All purposes</option>'+purposes.map(group=>`<option value="${esc(group.id)}">${esc(group.label)} (${list.filter(sensor=>sensorPurpose(sensor)===group.id).length})</option>`).join('');
      $('purpose').value=selectedPurpose;
      const shown=list.filter(sensor=>(selectedGroup==='all'||sensor.group===selectedGroup)&&(selectedPurpose==='all'||sensorPurpose(sensor)===selectedPurpose));
      $('group-by').value=groupBy;
      let rowGroups=purposes,keyFor=sensorPurpose;
      if(groupBy==='system'){rowGroups=groups.map(id=>({id,label:labels.get(id)||id}));keyFor=sensor=>sensor.group;}
      else if(groupBy==='signal-type'){rowGroups=ctx.systems.signal_types||SIGNAL_TYPES;keyFor=sensor=>characteristics(sensor).signal_type;}
      else if(groupBy==='sample-rate'){
        const cadences=new Map();shown.forEach(sensor=>{const {ms,rate,id}=sampling(sensor);if(!cadences.has(id))cadences.set(id,{id,ms,label:finite(ms)&&finite(rate)?format(ms,'ms')+' · '+format(rate,'Hz'):'Sampling not specified',description:finite(rate)?format(rate)+(rate===1?' sample':' samples')+' per second. Grouped by the configured sample schedule; pulse frequency is shown beside the measured value.':''});});
        rowGroups=[...cadences.values()].sort((a,b)=>(a.ms??Infinity)-(b.ms??Infinity));keyFor=sensor=>sampling(sensor).id;
      }
      $('sensor-rows').innerHTML=rowGroups.map(group=>{
        const members=shown.filter(sensor=>keyFor(sensor)===group.id);if(!members.length)return '';
        const heading=`<tr class="um-purpose-heading" data-um-group-heading="${esc(group.id)}" data-group-by="${groupBy}" ${groupBy==='purpose'?`data-um-purpose-heading="${esc(group.id)}"`:''}><th colspan="4"><span>${esc(group.label)}</span><b>${members.length} ${members.length===1?'input':'inputs'}</b>${group.description?`<small>${esc(group.description)}</small>`:''}</th></tr>`;
        return heading+members.map(sensor=>`<tr data-um-sensor="${esc(sensor.id)}" data-um-purpose="${esc(sensorPurpose(sensor))}" class="${sensor.installed===false?'um-unfitted-row':''}"><td><button type="button" class="um-sensor-name" data-um-inspect="${esc(sensor.id)}">${esc(sensor.label||sensor.id)}</button>${signalBadge(sensor)}<span class="um-importance" data-um-importance="${esc(sensor.id)}">${esc(sensor.importance_label||'Information / monitoring')}</span><small>${esc(labels.get(sensor.group)||sensor.group)}${characteristics(sensor).signal_type==='derived'?' · Derived channel':''}</small>${sensor.failure_effect?`<small class="um-loss-summary">${esc(shortEffect(sensor.failure_effect))}</small><details class="um-loss-detail"><summary>Effect of missing input</summary><p>${esc(sensor.failure_effect)}</p>${sensor.importance_scope?`<small>${esc(sensor.importance_scope)}</small>`:''}</details>`:''}${characteristicsMarkup(sensor)}<details class="um-characteristics-detail"><summary>Conversion path</summary><div data-um-conversion="${esc(sensor.id)}"></div></details></td><td><strong data-um-reading="${esc(sensor.id)}">—</strong><small class="um-live-signal" data-um-live-signal="${esc(sensor.id)}"></small><small data-um-physical="${esc(sensor.id)}"></small></td><td><span class="um-reading-quality" data-um-quality="${esc(sensor.id)}"></span><small class="um-fault-pattern" data-um-connection-status="${esc(sensor.id)}"></small><small data-um-sample="${esc(sensor.id)}">${esc(samplingLabel(sensor))}</small><small data-um-age="${esc(sensor.id)}"></small></td><td class="um-row-actions"><div class="um-inspect-actions"><button type="button" data-um-plot="${esc(sensor.id)}" ${sensor.installed===false?'disabled':''} title="Plot this signal">Plot</button>${sensor.socket_id&&sensor.disconnectable!==false?`<button type="button" data-um-pins="${esc(sensor.id)}" ${sensor.installed===false?'disabled':''} title="Open this sensor connector and fault-test controls">Pins</button>`:''}</div>${options.onConnection&&sensor.connection_id&&sensor.disconnectable!==false?`<button type="button" class="um-connection-action" data-um-connection="${esc(sensor.id)}" title="Disconnect or reconnect this sensor in the running vehicle">Disconnect</button><small class="um-connection-message" data-um-connection-message="${esc(sensor.id)}" role="status"></small>`:''}</td></tr>`).join('');
      }).join('');
      $('unit-actions').hidden=false;$('sensors-toolbar').hidden=!list.length;$('timing-help').hidden=!list.length;$('sensor-table-wrap').hidden=!shown.length;$('empty-sensors').hidden=!list.length||shown.length>0;
      text('sensor-count',shown.length+' of '+list.length+' inputs');
    }
    function render(){if(disposed||!ctx?.state)return;
      const fitted=units().filter(unit=>unit.installed!==false).length,configuration=ctx.state.vehicle?.configuration||ctx.systems?.configuration||{};
      text('configuration',(configuration.label||'Configured vehicle')+' · '+fitted+' fitted units');text('map-count',fitted+' fitted · '+(units().length-fitted)+' not fitted');
      mapMarkup();
      container.querySelectorAll('[data-um-unit]').forEach(node=>{const unit=units().find(item=>unitId(item)===node.dataset.umUnit),summary=status(unit);node.classList.toggle('selected',unitId(unit)===selectedId);node.classList.toggle('fault',summary.tone==='fault');node.classList.toggle('powered',summary.tone==='ok');node.setAttribute('aria-pressed',String(unitId(unit)===selectedId));const stateNode=node.querySelector('[data-um-node-state]');stateNode.textContent=summary.label.length>26?summary.label.slice(0,25)+'…':summary.label;node.setAttribute('aria-label',(unit.label||unitId(unit))+' · '+summary.label);});
      const unit=currentUnit();detailMarkup(unit);
      if(!unit){text('unit-title','Choose a unit above');text('unit-group','UNIT INSPECTION');text('unit-description','Inspect the ECU, brakes, transmission or electrical system without changing the simulation.');text('unit-status','');text('unit-note','One vehicle, one simulation clock. Selecting a unit keeps your current drive and diagnostic log.');return;}
      const summary=status(unit);text('unit-title',unit.label||unitId(unit));text('unit-group',unit.group||'UNIT INSPECTION');text('unit-description',unit.description||'Inspect this unit in the shared vehicle model.');text('unit-status',summary.label);$('unit-status').classList.toggle('fault',summary.tone==='fault');$('unit-status').classList.toggle('unfitted',summary.tone==='unfitted');
      const unavailable=unit.installed===false;container.querySelectorAll('[data-um-action]').forEach(button=>{button.disabled=button.dataset.umAction==='full-wiring'?false:unavailable;});
      const diagnostic=container.querySelector('[data-um-action="diagnostics"]');diagnostic.hidden=unit.diagnostic_capability!=='obd_uds'&&!['dlc','scan_tool'].includes(unitId(unit));
      const note=unavailable?'This unit is not fitted. Choose a compatible configuration in Setup.':unitId(unit)==='charging'?'The charge interface has a location and connector. External charging behavior is reference-only in this version.':availableSensors(unit).length?'Purpose groups describe the implemented training behavior. Starting requirements, drive fallback and display-only information are distinct. Open an input’s loss explanation or connector for details.':'This unit exposes plant or network state. Use Signals, Wiring or Vehicle location to inspect it.';
      text('unit-note',note);
      container.querySelectorAll('[data-um-sensor]').forEach(row=>{const sensor=sensors().find(item=>item.id===row.dataset.umSensor),reading=currentValue(sensor),installed=sensor.installed!==false,open=connectionOpen(sensor,reading),valid=reading.validity==='valid'&&installed&&reading.powered!==false&&!open,c=characteristics(sensor);
        const conversion=row.querySelector('[data-um-conversion]'),markup=window.AppModel?.conversionMarkup?.(reading.conversion)||'';if(conversion.innerHTML!==markup)conversion.innerHTML=markup;
        row.querySelector('[data-um-reading]').textContent=valid?format(reading.value,sensor.unit):'—';
        const physical=row.querySelector('[data-um-physical]');physical.textContent=!valid&&installed&&reading.physical_value!=null?'Physical: '+format(reading.physical_value,sensor.unit)+' (model)':'';
        const quality=row.querySelector('[data-um-quality]');quality.textContent=!installed?'Not fitted':reading.powered===false?'Unpowered':open?'Connector open':valid?'Valid sample':reading.validity==='invalid'?'Invalid input':'Unavailable';quality.classList.toggle('invalid',installed&&(open||reading.validity==='invalid'));quality.classList.toggle('valid',valid);quality.title=open&&reading.validity==='valid'?'Connector is open. The unit detects the missing input at its next scheduled sample.':reading.validity_note||'';
        let liveSignal='';
        if(c.signal_type==='pulse')liveSignal='Pulse frequency: '+(valid&&finite(reading.frequency_hz)?format(reading.frequency_hz,'Hz'):'unavailable');
        else if(['analog','digital'].includes(c.signal_type)){
          const solvedOpen=sensor.id==='ect'&&installed&&reading.powered!==false&&open&&reading.connected===false&&finite(reading.signal_voltage_v);
          liveSignal=solvedOpen?'ECU input: '+format(reading.signal_voltage_v,'V')+' · open circuit':'Signal voltage: '+(valid&&finite(reading.signal_voltage_v)?format(reading.signal_voltage_v,'V'):'unavailable');
        }
        row.querySelector('[data-um-live-signal]').textContent=liveSignal;
        row.querySelector('[data-um-sample]').textContent='Sampling: '+samplingLabel(sensor);
        row.querySelector('[data-um-age]').textContent=finite(reading.age_ms)?'Sample age: '+period(reading.age_ms):'';
        const schedule=ctx.state.connection_faults?.[sensor.connection_id],pattern=row.querySelector('[data-um-connection-status]');
        pattern.textContent=schedule?.mode==='intermittent'?'Intermittent · '+(schedule.phase==='dropout'?'dropout':'connected')+(finite(schedule.time_to_change_s)?' · next in '+format(schedule.time_to_change_s,'s'):''):'';
        const connectionButton=row.querySelector('[data-um-connection]');if(connectionButton){const pending=connectionPending.has(sensor.connection_id);connectionButton.textContent=schedule?.mode==='intermittent'?'Stop test & reconnect':connectorClosed(sensor)?'Disconnect':'Reconnect';connectionButton.disabled=!installed||pending||ctx.controlsBusy===true;connectionButton.classList.toggle('reconnect',!!schedule||!connectorClosed(sensor));row.querySelector('[data-um-connection-message]').textContent=pending?'Updating connector…':connectionErrors.get(sensor.connection_id)||'';}
      });
    }
    listen(container,'click',async event=>{const node=event.target.closest?.('[data-um-unit]');if(node){select(node.dataset.umUnit);return;}
      const button=event.target.closest?.('[data-um-action],[data-um-inspect],[data-um-plot],[data-um-pins],[data-um-connection]');if(!button||button.disabled)return;
      const action=button.dataset.umAction;if(action==='clear-filters'){selectedGroup=selectedPurpose='all';detailKey='';render();return;}if(action==='full-wiring'){options.onSelect?.(selectedId||'ecu');options.onNavigate?.('wiring');return;}if(action){if(!currentUnit())return;options.onSelect?.(selectedId);options.onNavigate?.(action==='location'?'locations':action==='diagnostics'?'scan':action);return;}
      const id=button.dataset.umInspect||button.dataset.umPlot||button.dataset.umPins||button.dataset.umConnection,sensor=sensors().find(item=>item.id===id);if(!sensor)return;
      if(button.dataset.umConnection){const connectionId=sensor.connection_id;if(!options.onConnection||!connectionId||sensor.disconnectable===false||connectionPending.has(connectionId))return;const next=ctx.state.connection_faults?.[connectionId]?.mode==='intermittent'||!connectorClosed(sensor);connectionPending.add(connectionId);connectionErrors.delete(connectionId);render();try{await options.onConnection(connectionId,next);}catch(error){connectionErrors.set(connectionId,error.message||'Could not update this connector.');}finally{connectionPending.delete(connectionId);render();}return;}
      if(button.dataset.umInspect)options.onSelect?.(sensor.component_id||sensor.id);
      if(button.dataset.umPlot){options.onWatch?.(sensor.signal_id,true);options.onSelect?.('signal:'+sensor.signal_id);options.onNavigate?.('signals');}
      if(button.dataset.umPins){options.onSelect?.('socket:'+sensor.socket_id);options.onNavigate?.('wiring');}
    });
    listen(container,'keydown',event=>{const node=event.target.closest?.('[data-um-unit]');if(node&&['Enter',' '].includes(event.key)){event.preventDefault();select(node.dataset.umUnit);}});
    listen($('group'),'change',event=>{selectedGroup=event.target.value;detailKey='';render();});
    listen($('purpose'),'change',event=>{selectedPurpose=event.target.value;detailKey='';render();});
    listen($('group-by'),'change',event=>{if(!['purpose','system','signal-type','sample-rate'].includes(event.target.value))return;groupBy=event.target.value;detailKey='';render();});
    listen($('show-unfitted'),'change',event=>{showUnfitted=event.target.checked;mapKey=detailKey='';render();});
    return {update(next){ctx=next;if(ctx.selection!==externalSelection){externalSelection=ctx.selection;const id=resolveSelection(ctx.selection);if(id!==selectedId){selectedId=id;selectedGroup='all';selectedPurpose='all';detailKey='';}}if(selectedId&&!units().some(unit=>unitId(unit)===selectedId))selectedId='';render();},setVisible(value){visible=!!value;if(visible)render();},resize(){render();},dispose(){disposed=true;listeners.forEach(([node,type,fn])=>node.removeEventListener(type,fn));container.replaceChildren();},inspect(){return {selectedUnit:selectedId,group:selectedGroup,purpose:selectedPurpose,groupBy,showUnfitted,unitCount:units().length,visible,time:ctx?.state?.t};}};
  }
  window.UnitMapView={create};
})();
