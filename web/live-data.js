/* Linked live-data view. Time, samples and selected objects belong to AppSession. */
(function (global) {
  'use strict';
  const COLORS = ['#57d3bd', '#85b5ff', '#ffc66a', '#dd9bed', '#ef8894', '#b8d78e', '#80d8e7', '#c7b4ff'];
  const DEFAULT_WATCH = ['speed_kph', 'rpm', 'coolant_c', 'sensors.ect_c'];
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const t=value=>global.AppI18n?.t(value)??value;
  const at = (object, path) => global.AppModel?.valueAt ? global.AppModel.valueAt(object, path) : String(path).split('.').reduce((value, key) => value == null ? undefined : value[key], object);
  const esc = value => global.AppModel?.escape ? global.AppModel.escape(value) : String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const labels = {valid:'Live', invalid:'Invalid', unavailable:'Missing', stale:'Stale', substituted:'Fallback'};
  function format(value, unit = '') {
    if (typeof value === 'boolean') return value ? 'On' : 'Off';
    if (value === null || value === undefined || (typeof value === 'number' && !Number.isFinite(value))) return '—';
    if (typeof value !== 'number') return String(value);
    const digits = unit === 'rpm' || unit === 'count' || Math.abs(value) >= 1000 ? 0 : unit === 'ratio' || unit === 'V' || Math.abs(value) < 1 && value !== 0 ? 2 : 1;
    return value.toLocaleString('en-US', {minimumFractionDigits:digits, maximumFractionDigits:digits});
  }
  function installed(metadata,state) {
    if(metadata.installed===false)return false;
    const config=state?.vehicle?.configuration;if(!config)return true;
    const reading=metadata.sensor_id?state?.vehicle_sensors?.[metadata.sensor_id]:null;
    if(reading?.installed===false)return false;
    const id=metadata.id,combustion=config.powertrain!=='bev',electric=['hev','phev','bev'].includes(config.powertrain);
    if(!combustion&&(['Engine','ECT','ECT circuit'].includes(metadata.group)||['engine','ecu'].includes(metadata.unit_id)||id==='mil'))return false;
    if(!electric&&(['Battery','Network','Hybrid'].includes(metadata.group)||['battery','bmu','inverter'].includes(metadata.unit_id)))return false;
    if(!config.abs_installed&&(id.startsWith('sensors.wheel_speeds_kph.')||id==='abs_active'||metadata.unit_id==='abs'))return false;
    if(!config.esp_installed&&['esp_active','yaw_target_deg_s'].includes(id))return false;
    return true;
  }
  function validity(metadata, state) {
    if(!installed(metadata,state))return 'unavailable';
    if (metadata.profiles && !metadata.profiles.includes(state?.profile)) return 'unavailable';
    const id = metadata.id, value = at(state, id), sensed = state?.sensors || {};
    if(metadata.sensor_id){
      const reading=state?.vehicle_sensors?.[metadata.sensor_id];
      // An open NTC's high voltage is a valid circuit measurement even though
      // its converted temperature is invalid. Preserve the backend distinction.
      if(metadata.sensor_id==='ect'&&id.endsWith('.signal_voltage_v')&&reading?.powered&&value!=null)return 'valid';
      return reading?.validity || 'unavailable';
    }
    if (id === 'sensors.ect_resistance_ohm' && sensed.ect_circuit_open) return 'invalid';
    if (['sensors.ect_c','sensors.ect_adc_count','sensors.ect_used_c'].includes(id)) {
      if (!(sensed.ect_powered ?? state?.inputs?.ignition)) return 'unavailable';
      if (id === 'sensors.ect_used_c' && state?.ect_derate_factor < 1) return 'substituted';
      if (sensed.ect_sensor_valid === false) return 'invalid';
    }
    if (id.startsWith('sensors.wheel_speeds_kph.') && value == null) return 'invalid';
    if (value == null) return 'unavailable';
    if (id.startsWith('bmu_report.') && sensed.bmu_message_age_ms > 300.0001) return 'stale';
    return 'valid';
  }
  function plottedValue(metadata, state) {
    const status = validity(metadata, state);
    // Never join a dropped, uninstalled or invalid signal to a later good sample.
    if (!['valid','substituted','stale'].includes(status)) return null;
    const value = at(state, metadata.id);
    return typeof value === 'boolean' ? Number(value) : finite(value) ? value : null;
  }
  function nearest(samples, t) {
    if (!samples.length) return null;
    let lo = 0, hi = samples.length - 1;
    while (lo < hi) {const mid = (lo + hi) >> 1; if (samples[mid].t < t) lo = mid + 1; else hi = mid;}
    return lo && Math.abs(samples[lo-1].t-t) <= Math.abs(samples[lo].t-t) ? samples[lo-1] : samples[lo];
  }
  function componentSignals(componentId, signals) {
    const supplied = global.AppModel?.signalIdsForComponent?.(componentId, signals);
    if (supplied) return new Set(supplied);
    const groups = {engine:['Engine','Driver','Vehicle'],ecu:['Engine','ECT','ECT circuit','Diagnostics'],coolant_sensor:['ECT','ECT circuit'],battery:['Battery'],bmu:['Battery','Network'],supervisor:['Controller','Driver','Battery'],abs:['Braking'],dlc:['Diagnostics','Engine','Vehicle'],scan_tool:['Diagnostics','Engine','Vehicle']};
    if (componentId?.startsWith('wheel_')) {
      const index = ['fl','fr','rl','rr'].indexOf(componentId.slice(6));
      return new Set(signals.filter(s => s.id.endsWith('.'+index) || s.id === 'speed_kph').map(s => s.id));
    }
    return new Set(signals.filter(s => s.unit_id===componentId||s.component_id===componentId||(groups[componentId] || []).includes(s.group)).map(s => s.id));
  }
  function create(container, options = {}) {
    container.classList.add('ld-view');
    container.innerHTML = `<div class="ld-metrics" aria-label="Live vehicle summary">
      <div data-ld-summary="speed"><span>Vehicle speed</span><strong data-ld-metric="speed_kph">—</strong><small>km/h · physical</small></div>
      <div data-ld-summary="drive"><span>Engine speed</span><strong data-ld-metric="rpm">—</strong><small>rpm · physical</small></div>
      <div data-ld-summary="temperature"><span>Coolant</span><strong data-ld-metric="coolant_c">—</strong><small>°C · physical</small></div>
      <div data-ld-summary="energy"><span>Battery charge</span><strong data-ld-metric="soc_pct">—</strong><small>% · physical</small></div>
    </div>
    <div class="ld-workspace">
      <section class="ld-signals" aria-label="Available live signals">
        <div class="ld-pane-title"><div><h2>Signals</h2><span data-ld-scope-note>All vehicle systems</span></div><span class="ld-count" data-ld-count>0</span></div>
        <div class="ld-filter"><input type="search" data-ld-search placeholder="Find a signal…" aria-label="Find a live signal"><label><span class="ld-sr-only">Signal scope</span><select data-ld-scope aria-label="Signal scope"><option value="selected">Selected system</option><option value="all">All signals</option><option value="watched">On chart</option></select></label><label style="grid-column:1 / -1"><span class="ld-sr-only">Sensor group</span><select data-ld-group aria-label="Sensor group"><option value="all">All sensor groups</option></select></label></div>
        <div class="ld-table-scroll"><table class="ld-table"><thead><tr><th scope="col" class="ld-check-head" title="Show on chart">Plot</th><th scope="col">Signal</th><th scope="col" class="ld-value-head">Value</th></tr></thead><tbody data-ld-rows></tbody></table><p class="ld-empty" data-ld-empty hidden>No matching signals.</p></div>
        <p class="ld-table-help">Select a signal to inspect it. Check its box to compare it on the chart.</p>
      </section>
      <section class="ld-plot" aria-label="Signals over simulation time">
        <div class="ld-pane-title ld-chart-toolbar"><div><h2>Signal history</h2><span data-ld-history-status>Ready to record</span></div><div class="ld-chart-tools"><label><span class="ld-sr-only">History time window</span><select data-ld-window aria-label="History time window"><option value="10">10 s</option><option value="30" selected>30 s</option><option value="60">60 s</option><option value="0">All samples</option></select></label><button type="button" data-ld-live title="Return the chart cursor to the latest sample">Live cursor</button></div></div>
        <div class="ld-watch-list" data-ld-watch aria-label="Signals displayed on the chart"></div>
        <div class="ld-chart-scroll"><canvas data-ld-chart tabindex="0" role="img" aria-label="Selected signal histories with a shared time cursor. Click to inspect a saved sample; press Escape to return to live values."></canvas><div class="ld-no-chart" data-ld-no-chart hidden><strong>Choose signals to compare</strong><p>Use the checkboxes in the signal list.</p></div></div>
        <div class="ld-chart-foot"><span data-ld-cursor>Latest sample</span><span>Shared time · independent units · gaps mean invalid or missing data</span></div>
      </section>
    </div>`;
    const $ = selector => container.querySelector(selector), $$ = selector => [...container.querySelectorAll(selector)];
    const canvas = $('[data-ld-chart]'), rowHost = $('[data-ld-rows]');
    let ctx = null, visible = true, disposed = false, query = '', scope = 'selected', group='all', seconds = 30, cursor = null, held = false;
    let rowSignature = '', watchSignature = '', groupSignature='', lastTime = null, chartSpec = null, rows = new Map(), traces = [];
    const listeners = [];
    const listen = (node,type,fn) => {node.addEventListener(type,fn);listeners.push([node,type,fn]);};
    function metadata() {return ctx?.signals || [];}
    function resolved() {return global.AppModel?.resolveSelection?.(ctx?.selection || 'overview',ctx?.catalog,metadata()) || {kind:'component',id:ctx?.selection,componentId:ctx?.selection};}
    function watchIds() {return Array.isArray(ctx?.watch) ? ctx.watch : DEFAULT_WATCH;}
    function signalRecord(meta, snapshot = ctx?.state) {
      if(!installed(meta,snapshot))return {...meta,value:null,validity:'unavailable',validity_note:'Not installed in this vehicle configuration.'};
      const record = snapshot === ctx?.state ? ctx?.result?.signals?.[meta.id] : null;
      const reading=meta.sensor_id?snapshot?.vehicle_sensors?.[meta.sensor_id]:null;
      if(meta.sensor_id)return {...meta,...record,value:at(snapshot,meta.id),validity:validity(meta,snapshot),validity_note:reading?.validity_note||'No sampled input is available.'};
      return record || {...meta, value:at(snapshot,meta.id),validity:validity(meta,snapshot),validity_note:''};
    }
    function scopedSignals() {
      const selection = resolved(), ids = componentSignals(selection.componentId,metadata()), watched = new Set(watchIds());
      return metadata().filter(meta => {
        const inScope = scope === 'all' || scope === 'watched' && watched.has(meta.id) || scope === 'selected' && (!selection.componentId || selection.componentId === 'overview' || ids.has(meta.id) || selection.signalId === meta.id);
        return inScope && installed(meta,ctx.state);
      });
    }
    function renderRows() {
      if (!ctx) return;
      const available=scopedSignals(),groups=[...new Set(available.map(meta=>meta.group||'Other'))].sort(),nextGroups=groups.join('|');
      if(nextGroups!==groupSignature){groupSignature=nextGroups;$('[data-ld-group]').innerHTML='<option value="all">All sensor groups</option>'+groups.map(label=>`<option value="${esc(label)}">${esc(label)}</option>`).join('');if(!groups.includes(group))group='all';$('[data-ld-group]').value=group;}
      const filtered=available.filter(meta=>(group==='all'||(meta.group||'Other')===group)&&(!query||`${meta.label} ${t(meta.label)} ${meta.id} ${meta.source} ${meta.group} ${t(meta.group)} ${meta.unit}`.toLowerCase().includes(query))), selection = resolved(), signature = filtered.map(s => s.id).join('|');
      $('[data-ld-count]').textContent = String(filtered.length);
      $('[data-ld-empty]').hidden = !!filtered.length;
      $('[data-ld-scope-note]').textContent = scope === 'watched' ? 'Signals on your chart' : scope === 'all' || !selection.componentId || selection.componentId === 'overview' ? 'All vehicle systems' : (ctx.catalog?.components || []).find(c => c.id === selection.componentId)?.label || selection.label || 'Selected system';
      if (signature !== rowSignature) {
        rowSignature = signature;
        rowHost.innerHTML = filtered.map(meta => `<tr class="ld-signal-row" data-ld-id="${esc(meta.id)}"><td><input type="checkbox" data-ld-pin aria-label="Plot ${esc(meta.label)}"></td><td><button type="button" class="ld-signal-name" data-ld-select>${esc(meta.label)}</button><span class="ld-signal-source">${esc(meta.source)}</span></td><td class="ld-number"><span data-ld-value>—</span><small data-ld-unit>${esc(meta.unit)}</small><span class="ld-validity" data-ld-validity>—</span></td></tr>`).join('');
        rows = new Map();
        $$('.ld-signal-row').forEach(row => {
          const id = row.dataset.ldId, pin = row.querySelector('[data-ld-pin]'), select = row.querySelector('[data-ld-select]');
          pin.onchange = () => options.onWatch?.(id,pin.checked);
          select.onclick = () => options.onSelect?.('signal:'+id);
          rows.set(id,{row,pin,value:row.querySelector('[data-ld-value]'),unit:row.querySelector('[data-ld-unit]'),status:row.querySelector('[data-ld-validity]')});
        });
      }
      const watched = new Set(watchIds());
      filtered.forEach(meta => {
        const r = rows.get(meta.id), record = signalRecord(meta), isState = meta.kind === 'state';
        r.pin.checked = watched.has(meta.id);r.pin.disabled = isState;
        r.pin.title = isState ? 'This state is shown as text. Select it to inspect its meaning.' : 'Show this signal on the chart';
        r.value.textContent = format(record.value,meta.unit);r.unit.textContent = record.value == null ? '' : meta.unit;
        r.status.textContent = labels[record.validity] || record.validity;
        r.status.dataset.validity = record.validity;r.status.title = record.validity_note || meta.description || '';
        r.row.classList.toggle('ld-selected',selection.signalId === meta.id || ctx.selection === 'signal:'+meta.id);
      });
    }
    function renderWatch() {
      const byId = new Map(metadata().map(s => [s.id,s]));
      traces = watchIds().map(id => byId.get(id)).filter(meta => meta && meta.kind !== 'state' && installed(meta,ctx.state));
      const signature = traces.map(s => s.id).join('|');
      if (signature === watchSignature) return;
      watchSignature = signature;
      $('[data-ld-watch]').innerHTML = traces.map((meta,i) => `<span class="ld-watch-chip" style="--trace-color:${COLORS[i%COLORS.length]}"><button type="button" data-ld-jump="${esc(meta.id)}" title="Inspect ${esc(meta.label)}"><i></i>${esc(meta.label)}</button><button type="button" data-ld-remove="${esc(meta.id)}" aria-label="Remove ${esc(meta.label)} from chart">×</button></span>`).join('');
      $$('[data-ld-remove]').forEach(button => {button.onclick=()=>options.onWatch?.(button.dataset.ldRemove,false);});
      $$('[data-ld-jump]').forEach(button => {button.onclick=()=>options.onSelect?.('signal:'+button.dataset.ldJump);});
    }
    function samples() {
      const list = ctx?.history || [], current = ctx?.state;
      if (!current) return list;
      if (!list.length) return [current];
      // The live state can contain an immediate connector change at the same timestamp.
      return list[list.length-1].t === current.t ? [...list.slice(0,-1),current] : [...list,current];
    }
    function draw() {
      if (!ctx?.state || !visible || disposed) return;
      renderWatch();
      $('[data-ld-no-chart]').hidden = !!traces.length;
      canvas.hidden = !traces.length;
      if (!traces.length) {chartSpec = null; return;}
      const rect = canvas.getBoundingClientRect(), width = Math.max(240,rect.width || 640), height = Math.max(304,traces.length * 100 + 38);
      canvas.style.height = `${height}px`;
      const dpr = Math.min(global.devicePixelRatio || 1,2);
      if (canvas.width !== Math.round(width*dpr) || canvas.height !== Math.round(height*dpr)) {canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);}
      const c = canvas.getContext('2d');if (!c) return;
      c.setTransform(dpr,0,0,dpr,0,0);c.clearRect(0,0,width,height);
      const list = samples(), end = Math.max(1,ctx.state.t), start = seconds ? Math.max(0,end-seconds) : Math.max(0,list[0]?.t||0), stop = Math.max(start+1,end);
      const left = 63, right = 18, top = 12, bottom = 30, span = stop-start, plotWidth = width-left-right, rowHeight = (height-top-bottom)/traces.length;
      const x = t => left+(t-start)/span*plotWidth, plotted = list.filter(s=>s.t>=start && s.t<=stop);
      const target = cursor === null ? ctx.state.t : Math.max(start,Math.min(stop,cursor)), selected = nearest(list,target) || ctx.state;
      chartSpec = {start,end:stop,left,right,width,height,plotWidth,rowHeight,sampleTime:selected.t,traceIds:traces.map(s=>s.id)};
      c.font='11px ui-monospace, SFMono-Regular, Consolas, monospace';
      traces.forEach((meta,index) => {
        const base = top+index*rowHeight, graphTop=base+28, graphBottom=base+rowHeight-10, values=plotted.map(s=>plottedValue(meta,s)).filter(finite);
        let min,max;
        if (meta.kind === 'digital') {min=0;max=1;}
        else if (values.length) {min=Math.min(...values);max=Math.max(...values);const pad=Math.max((max-min)*.12,Math.abs(max)*.03,meta.unit==='rpm'?25:meta.unit==='V'?.05:.5);min-=pad;max+=pad;}
        else {[min,max]=meta.range || [0,1];}
        if (max===min) max=min+1;
        const y=value=>graphBottom-(value-min)/(max-min)*(graphBottom-graphTop);
        c.strokeStyle='#303b4b';c.lineWidth=1;c.setLineDash([2,4]);
        for(let tick=0;tick<=2;tick++) {const value=min+(max-min)*tick/2,py=y(value);c.beginPath();c.moveTo(left,py);c.lineTo(width-right,py);c.stroke();c.textAlign='right';c.fillStyle='#8292a6';c.fillText(format(value,meta.unit),left-8,py+3);}
        for(let tick=0;tick<=4;tick++) {c.beginPath();c.moveTo(left+plotWidth*tick/4,graphTop);c.lineTo(left+plotWidth*tick/4,graphBottom);c.stroke();}
        c.setLineDash([]);c.fillStyle=COLORS[index%COLORS.length];c.textAlign='left';
        const textWidth = Math.max(80,width-left-155), title = fitLabel(c,`${t(meta.label)}${meta.unit?' · '+meta.unit:''}`,textWidth);c.fillText(title,left,base+14);
        const record=signalRecord(meta,selected), status=record.validity, text=`${format(record.value,meta.unit)}${meta.unit?' '+meta.unit:''}${status!=='valid'?' · '+(labels[status]||status):''}`;
        c.textAlign='right';c.fillStyle=status==='valid'?'#eef3f8':'#ffc66a';c.fillText(text,width-right,base+14);
        c.save();c.beginPath();c.rect(left,graphTop,plotWidth,graphBottom-graphTop);c.clip();c.strokeStyle=COLORS[index%COLORS.length];c.lineWidth=1.8;c.beginPath();
        let pen=false, lastPoint=null;
        plotted.forEach(snapshot=>{const value=plottedValue(meta,snapshot);if(!finite(value)){pen=false;lastPoint=null;return;}const px=x(snapshot.t),py=y(value);if(!pen){c.moveTo(px,py);pen=true;}else if(meta.kind==='digital'&&lastPoint){c.lineTo(px,lastPoint.y);c.lineTo(px,py);}else c.lineTo(px,py);lastPoint={x:px,y:py};});c.stroke();
        const cursorValue=plottedValue(meta,selected);
        if(finite(cursorValue)){c.fillStyle=COLORS[index%COLORS.length];c.beginPath();c.arc(x(selected.t),y(cursorValue),2.8,0,Math.PI*2);c.fill();}
        c.restore();
        if(!values.length){c.fillStyle='#8292a6';c.textAlign='left';c.fillText(t('No valid samples in this window'),left+12,(graphTop+graphBottom)/2);}
      });
      if(cursor!==null){c.strokeStyle=held?'#eef3f8':'#8e9eb2';c.lineWidth=1;c.setLineDash([3,4]);c.beginPath();c.moveTo(x(selected.t),top);c.lineTo(x(selected.t),height-bottom);c.stroke();c.setLineDash([]);}
      c.fillStyle='#9aaabd';c.textAlign='center';for(let tick=0;tick<=4;tick++){const time=start+span*tick/4;c.fillText(`${format(time,'s')} s`,left+plotWidth*tick/4,height-10);}
      $('[data-ld-cursor]').textContent = `${cursor===null?'Latest':held?'Held sample':'Sample'} · ${Number(selected.t).toFixed(2)} s`;
      $('[data-ld-live]').classList.toggle('ld-live-active',cursor===null);
      $('[data-ld-live]').textContent=held?'Release cursor':'Live cursor';
      $('[data-ld-history-status]').textContent = `${list.length.toLocaleString('en-US')} samples · ${ctx.running?'recording':'paused'}${ctx.state.t>0?` · ${ctx.state.t.toFixed(1)} s`:''}`;
    }
    function fitLabel(c,text,width){if(c.measureText(text).width<=width)return text;let s=text;while(s.length>4&&c.measureText(s+'…').width>width)s=s.slice(0,-1);return s+'…';}
    function eventTime(event){if(!chartSpec)return null;const rect=canvas.getBoundingClientRect(),px=event.clientX-rect.left;return chartSpec.start+Math.max(0,Math.min(1,(px-chartSpec.left)/chartSpec.plotWidth))*(chartSpec.end-chartSpec.start);}
    listen($('[data-ld-search]'),'input',event=>{query=event.target.value.trim().toLowerCase();renderRows();});
    listen($('[data-ld-scope]'),'change',event=>{scope=event.target.value;renderRows();});
    listen($('[data-ld-group]'),'change',event=>{group=event.target.value;renderRows();});
    listen($('[data-ld-window]'),'change',event=>{seconds=Number(event.target.value);cursor=null;held=false;draw();});
    listen($('[data-ld-live]'),'click',()=>{cursor=null;held=false;draw();});
    listen(canvas,'pointermove',event=>{if(!held){cursor=eventTime(event);draw();}});
    listen(canvas,'pointerleave',()=>{if(!held){cursor=null;draw();}});
    listen(canvas,'click',event=>{cursor=eventTime(event);held=true;draw();});
    listen(canvas,'keydown',event=>{if(event.key==='Escape'){cursor=null;held=false;draw();}});
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(()=>draw()) : null;
    observer?.observe(container);
    return {
      update(next) {
        ctx=next;if(!ctx?.state||disposed)return;
        if(lastTime!==null&&ctx.state.t<lastTime){cursor=null;held=false;}
        lastTime=ctx.state.t;
        const config=ctx.state.vehicle?.configuration,electric=config?.powertrain==='bev',fuel=config&&['petrol','diesel'].includes(config.powertrain);
        const summary=[['speed','speed_kph','Vehicle speed','km/h'],['drive',electric?'motor_power_kw':'rpm',electric?'Motor power':'Engine speed',electric?'kW':'rpm'],['temperature',electric?'battery_temp_c':'coolant_c',electric?'Battery temperature':'Coolant','°C'],['energy',fuel?'vehicle.fuel_pct':'soc_pct',fuel?'Fuel remaining':'Battery charge','%']];
        summary.forEach(([name,id,label,unit])=>{const pane=$(`[data-ld-summary="${name}"]`),node=pane.querySelector('[data-ld-metric]'),meta=metadata().find(s=>s.id===id),record=meta?signalRecord(meta):{value:at(ctx.state,id)};node.dataset.ldMetric=id;node.textContent=format(record.value,unit);pane.querySelector('span').textContent=label;pane.querySelector('small').textContent=unit+' · physical';});
        renderRows();draw();
      },
      setVisible(value){visible=!!value;if(visible){renderRows();draw();}},
      resize:draw,
      dispose(){disposed=true;observer?.disconnect();listeners.forEach(([node,type,fn])=>node.removeEventListener(type,fn));rows.clear();},
      inspect(){return {visible,scope,query,group,watch:traces.map(s=>s.id),rows:[...rows.keys()],cursor,held,chart:chartSpec,sampleCount:samples().length};}
    };
  }
  global.LiveDataView={create,format,validity,installed,plottedValue,nearest,defaultWatch:DEFAULT_WATCH.slice()};
})(window);
