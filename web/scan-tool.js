/* Scan-tool tasks use the shared model, clock and command queue. */
(() => {
  'use strict';
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const format=value=>value==null?'—':typeof value==='boolean'?(value?'On':'Off'):typeof value==='number'?value.toLocaleString(window.AppI18n?.locale||'en-GB',{maximumFractionDigits:2}):String(value);
  const friendly=value=>String(value || '').replaceAll('_',' ');
  function create(container,options={}) {
    container.classList.add('sc-view');
    const uid='scan-tool-'+(++create.nextId);
    container.innerHTML=`
      <div class="sc-console">
        <header class="sc-heading"><div class="sc-title"><h2>Scan tool</h2><span>Virtual adapter</span></div><div class="sc-session"><strong data-sc="vehicle-name">Current vehicle</strong><span class="sc-status" data-sc="connection-status">Disconnected</span></div></header>
        <section class="sc-toolbar" aria-label="Scan-tool connection">
          <div class="sc-connection-grid"><label>Transport<select data-sc="protocol" aria-label="Diagnostic transport"></select></label><label data-sc="unit-picker">Control unit<select data-sc="module" aria-label="Diagnostic target unit"></select></label><button type="button" class="primary" data-sc-action="connect">Connect</button><button type="button" data-sc-action="disconnect" disabled>Disconnect</button></div>
          <div class="sc-connection-foot"><span data-sc="vehicle-link"></span><p data-sc="connection-reason" class="sc-connection-reason"></p></div>
        </section>
        <div class="sc-tabs" role="tablist" aria-label="Scan-tool functions">
          <button type="button" id="${uid}-tab-data" role="tab" data-sc-tab="data" aria-controls="${uid}-panel-data" aria-selected="true">Live data</button>
          <button type="button" id="${uid}-tab-unit" role="tab" data-sc-tab="unit" aria-controls="${uid}-panel-unit" aria-selected="false" tabindex="-1">Fault codes</button>
          <button type="button" id="${uid}-tab-faults" role="tab" data-sc-tab="faults" aria-controls="${uid}-panel-faults" aria-selected="false" tabindex="-1">Vehicle scan</button>
          <button type="button" id="${uid}-tab-connector" role="tab" data-sc-tab="connector" aria-controls="${uid}-panel-connector" aria-selected="false" tabindex="-1">Connector</button>
        </div>
        <section class="sc-panel" id="${uid}-panel-faults" role="tabpanel" aria-labelledby="${uid}-tab-faults" data-sc-panel="faults" hidden>
          <p class="sc-capability">Discover all fitted control units over the selected transport. Choose Connect on a result to open that unit’s live data and fault memory.</p><div class="sc-panel-toolbar"><div><strong data-sc="scan-summary">Vehicle not scanned</strong><span data-sc="scan-time">Connect the adapter, switch ignition on, then scan.</span></div><button type="button" class="primary" data-sc-action="scan">Scan all control units</button><button type="button" data-sc-action="clear">Clear emissions codes</button></div>
          <div class="sc-table-wrap"><table><thead><tr><th>Control unit</th><th>Status</th><th>Fault memory</th><th>Data source / inspect</th></tr></thead><tbody data-sc="module-rows"></tbody></table></div>
          <p class="sc-footnote">Engine ECU results use OBD replies. Other fitted units report labelled simulation state. Clearing codes does not repair the cause.</p>
        </section>
        <section class="sc-panel" id="${uid}-panel-data" role="tabpanel" aria-labelledby="${uid}-tab-data" data-sc-panel="data">
          <p data-sc="target-capability" class="sc-capability"></p>
          <div class="sc-live-toolbar"><div><h3 data-sc="live-title">Engine ECU parameters</h3><p data-sc="live-status" role="status">Connect the adapter to read live data.</p></div><label class="sc-live-period">Refresh<select data-sc="live-interval" aria-label="Live data refresh interval"><option value="0.25">0.25 s</option><option value="1">1 s</option><option value="60">1 min</option></select></label><div class="sc-display-mode" role="group" aria-label="Live data display"><button type="button" data-sc-display="numbers" aria-pressed="true">Numbers</button><button type="button" data-sc-display="graphs" aria-pressed="false">Graphs</button></div><button type="button" data-sc-action="add-parameter" aria-expanded="false">+ Add parameter</button></div>
          <div class="sc-parameter-picker" data-sc="parameter-picker" hidden><label>Add a parameter<select data-sc="parameter-choice" aria-label="Parameter to add"></select></label><button type="button" data-sc-action="confirm-parameter">Add</button><button type="button" data-sc-action="close-picker" class="quiet">Cancel</button></div>
          <div class="sc-live-grid" data-sc="live-grid"></div>
          <div class="sc-live-options"><span data-sc="live-cadence">Live updates every 0.25 s of simulation time</span></div>
          <details class="sc-custom" data-sc="custom-request"><summary>Custom diagnostic request <span>Single parameter, service or raw bytes</span></summary>
          <form data-sc="request-form" class="sc-request-form">
            <div class="sc-read-row"><label class="sc-example">Parameter or service<select data-sc="service" aria-label="Diagnostic service"><option value="">Custom request</option></select></label><button type="submit" data-sc-action="send" class="primary">Read</button></div>
            <details class="sc-advanced" data-sc="request-details"><summary>Request details <span>CAN address and custom bytes</span></summary><div class="sc-request-advanced"><label>CAN address<select data-sc="address"><option value="7DF">All emissions ECUs · 0x7DF (2015)</option><option value="7E0">Engine ECU · 0x7E0 (2016)</option></select></label><label>Application bytes<input type="text" data-sc="payload" value="01 0C" maxlength="50" autocomplete="off" spellcheck="false" aria-label="Diagnostic application bytes"></label></div><p data-sc="service-note" class="sc-small">01 0C asks for engine speed. The reply uses the sampled crank sensor input.</p></details>
          </form>
          <div class="sc-poll"><label><input type="checkbox" data-sc="poll-enabled"> Read continuously</label><label>Every <select data-sc="poll-interval" aria-label="Diagnostic request interval"><option value="0.25">0.25 s</option><option value="1" selected>1 s</option><option value="60">1 min</option></select></label><span>Uses vehicle simulation time; pauses with the clock.</span></div>
          <div class="sc-response" aria-live="polite"><div><span data-sc="response-title">No request yet</span><time data-sc="response-time"></time></div><strong data-sc="response-value">—</strong><p data-sc="response-meaning">Connect the virtual adapter to request a value.</p><details class="sc-advanced" data-sc="response-details"><summary>Response details <span>Bytes and calculation</span></summary><dl><dt>Request</dt><dd data-sc="request-bytes">—</dd><dt>Response</dt><dd data-sc="response-bytes">—</dd></dl><p data-sc="response-formula" class="sc-small"></p></details></div>
          <section class="sc-trend"><div class="sc-trend-heading"><strong>Response trend</strong><span data-sc="trend-unit"></span></div><svg data-sc="trend" viewBox="0 0 640 152" role="img" aria-label="No numeric replies captured yet"></svg><p data-sc="trend-note">Read a numeric parameter to capture its responses.</p></section>
          </details>
        </section>
        <section class="sc-panel" id="${uid}-panel-unit" role="tabpanel" aria-labelledby="${uid}-tab-unit" data-sc-panel="unit" hidden>
          <div class="sc-panel-toolbar"><div><strong data-sc="unit-title">Selected unit fault memory</strong><span data-sc="unit-time">Read fault memory for the selected control unit.</span></div><button type="button" data-sc-action="scan-unit" class="primary">Read fault codes</button><button type="button" data-sc-action="clear-unit">Clear emissions codes</button></div><div data-sc="unit-faults" class="sc-unit-faults"></div>
        </section>
        <section class="sc-panel sc-reference" id="${uid}-panel-connector" role="tabpanel" aria-labelledby="${uid}-tab-connector" data-sc-panel="connector" hidden>
          <div class="sc-port-card"><div class="sc-section-head"><h3>Vehicle diagnostic socket</h3><span data-sc="protocol-scope" class="sc-tag"></span><button type="button" class="quiet" data-sc-action="dlc">Open in wiring</button></div><p data-sc="socket-view" class="sc-small"></p><svg data-sc="port" class="sc-port" viewBox="0 0 500 210" role="group" aria-label="16-pin vehicle diagnostic connector, looking into the vehicle socket"></svg><div class="sc-port-legend"><span><i class="sc-can-h"></i>6 · CAN-H</span><span><i class="sc-can-l"></i>14 · CAN-L</span><span>Outlined pins belong to the selected transport</span></div><div class="sc-pin-detail"><div class="sc-pin-heading"><strong data-sc="pin-title"></strong><span data-sc="pin-use"></span></div><p data-sc="pin-description"></p><dl data-sc="pin-facts"></dl><p data-sc="pin-scope" class="sc-pin-scope"></p><button type="button" data-sc-action="pin">Highlight this path in Wiring →</button></div></div>
          <div class="sc-connection-reference"><p data-sc="transport-description" class="sc-small"></p><p data-sc="bitrate-note" class="sc-bitrate"></p><div class="sc-waveform"><span>Signal example · static reference</span><svg data-sc="waveform" viewBox="0 0 500 225" role="img" aria-label="Explanatory signal waveform"></svg><p data-sc="signal-example"></p></div><details class="sc-advanced sc-layer-card"><summary>Protocol layers and references</summary><dl><dt>OBD-II / UDS</dt><dd>The diagnostic service: what is requested and how values or faults are described.</dd><dt>ISO-TP</dt><dd>Carries the application bytes in CAN frames. Longer replies use multiple frames.</dd><dt>CAN</dt><dd>Message identifiers and the shared vehicle network. The adapter bitrate must match.</dd><dt>DLC socket</dt><dd>The access connector. Its pin assignments depend on the transport.</dd></dl><p data-sc="reference-note" class="sc-small"></p><div data-sc="sources" class="sc-sources"></div></details></div>
        </section>
        <p class="sc-notice" data-sc="notice" role="status" hidden></p>
      </div>`;
    const $=name=>container.querySelector(`[data-sc="${name}"]`),buttons=action=>container.querySelector(`[data-sc-action="${action}"]`);
    let ctx=null,disposed=false,visible=true,pending=false,error='',catalogKey='',servicesKey='',reportKey=null,lastConfig='',lastReplyKey=null,lastDiagnostic=null,portKey='',portMapKey='',pin=6,activeTab='data',trend=[],displayMode='numbers',liveKey='',pickerKey='',modelSelections={},modelData={},modelConnectionKey='';
    const listeners=[],listen=(node,type,fn)=>{node.addEventListener(type,fn);listeners.push([node,type,fn]);};
    const text=(name,value)=>{const node=$(name);if(node.textContent!==String(value??''))node.textContent=String(value??'');};
    function setTab(name,focus=false){
      if(!['data','unit','faults','connector'].includes(name))return;
      activeTab=name;
      container.querySelectorAll('[data-sc-panel]').forEach(node=>{node.hidden=node.dataset.scPanel!==name;});
      container.querySelectorAll('[data-sc-tab]').forEach(node=>{const selected=node.dataset.scTab===name;node.classList.toggle('active',selected);node.setAttribute('aria-selected',String(selected));node.setAttribute('tabindex',selected?'0':'-1');if(selected&&focus)node.focus?.();});
    }
    const normalize=value=>String(value||'').trim().toUpperCase().replace(/\s+/g,' ');
    function renderTrend(){
      const valid=trend.filter(point=>point.value!==null),svg=$('trend');
      text('trend-unit',valid.at(-1)?.unit||'');
      if(!valid.length){svg.innerHTML='<text class="sc-trend-empty" x="320" y="75" text-anchor="middle">No numeric replies captured</text>';text('trend-note',trend.length?'No valid measurement returned. Missing replies are not zero-valued samples.':'Read a numeric parameter, or enable continuous reading, to capture a trend.');svg.setAttribute('aria-label','No numeric diagnostic replies captured yet');return;}
      const values=valid.map(point=>point.value),low=Math.min(...values),high=Math.max(...values),pad=high===low?Math.max(1,Math.abs(low)*.04):(high-low)*.12,y0=low-pad,y1=high+pad;
      const first=trend[0].t,last=trend.at(-1).t,span=Math.max(last-first,.001),x=t=>48+(t-first)/span*574,y=value=>116-(value-y0)/(y1-y0)*96;
      let path='',move=true;
      for(const point of trend){if(point.value===null){move=true;continue;}path+=(move?'M':'L')+x(point.t).toFixed(2)+' '+y(point.value).toFixed(2)+' ';move=false;}
      const gaps=trend.filter(point=>point.value===null),latest=trend.at(-1),labels=[y1,(y0+y1)/2,y0];
      svg.innerHTML=labels.map(value=>`<path class="sc-trend-grid" d="M48 ${y(value).toFixed(2)}H622"/><text x="41" y="${(y(value)+4).toFixed(2)}" text-anchor="end">${esc(format(value))}</text>`).join('')+
        gaps.map(point=>`<path class="sc-trend-gap" d="M${x(point.t).toFixed(2)} 20V116"/>`).join('')+
        `<path class="sc-trend-line" d="${path.trim()}"/>`+valid.map(point=>`<circle class="sc-trend-point" cx="${x(point.t).toFixed(2)}" cy="${y(point.value).toFixed(2)}" r="2.5"/>`).join('')+
        `<text x="48" y="140">${esc(format(first))} s</text>`+(last>first?`<text x="622" y="140" text-anchor="end">${esc(format(last))} s</text>`:'');
      text('trend-note',valid.length+' valid '+(valid.length===1?'reply':'replies')+(gaps.length?' · '+gaps.length+' missing':'')+' · ECU response times'+(latest.value===null?' · Latest request has no valid value.':' · Up to 120 requests.'));
      svg.setAttribute('aria-label',valid.length+' numeric diagnostic replies plotted at actual simulation timestamps; '+gaps.length+' missing replies break the line.');
    }
    function clearTrend(){trend=[];renderTrend();}
    function captureTrend(d,decoded){
      if(!d||normalize(d.request_hex)!==normalize($('payload').value)||!Number.isFinite(d.sample_t))return;
      const value=d.response_hex&&typeof decoded.value==='number'&&Number.isFinite(decoded.value)?decoded.value:null;
      const service=ctx.definitions?.services?.find(item=>normalize(item.request_hex)===normalize(d.request_hex));
      if(value===null&&service?.decode?.kind!=='linear'&&!trend.length)return;
      const point={t:d.sample_t,value,unit:decoded.unit||service?.unit||''};
      if(trend.length&&point.t<trend.at(-1).t)trend=[];
      if(trend.at(-1)?.t===point.t)trend[trend.length-1]=point;else trend.push(point);
      if(trend.length>120)trend.splice(0,trend.length-120);
      renderTrend();
    }
    const selectedProtocol=()=>ctx?.scannerCatalog?.protocols?.find(p=>p.id===$('protocol').value);
    const selectedModule=()=>ctx?.scannerCatalog?.modules?.find(m=>m.id===$('module').value);
    async function execute(message,action){if(pending)return;pending=true;error='';text('notice',message);$('notice').hidden=false;render();try{return await action();}catch(e){error=e.message||String(e);text('notice',error);$('notice').classList.add('error');}finally{pending=false;if(!error)$('notice').hidden=true;render();}}
    function catalog(){
      const c=ctx.scannerCatalog || {},key=JSON.stringify(c);
      if(key!==catalogKey){catalogKey=key;const previousProtocol=$('protocol').value,previousModule=$('module').value;
        $('protocol').innerHTML=(c.protocols||[]).map(p=>`<option value="${esc(p.id)}">${esc(p.label)}${p.availability==='reference'?' · reference':''}</option>`).join('');
        $('module').innerHTML=(c.modules||[]).filter(m=>m.installed).map(m=>`<option value="${esc(m.id)}">${esc(m.label)}${m.capability==='state_only'?' · model state':''}</option>`).join('');
        if((c.protocols||[]).some(p=>p.id===previousProtocol))$('protocol').value=previousProtocol;
        if((c.modules||[]).some(m=>m.id===previousModule&&m.installed))$('module').value=previousModule;
        text('socket-view',c.socket?.view||'Vehicle socket, mating face. Wide edge at top.');
        $('sources').innerHTML=(c.sources||[]).map(s=>`<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label)} ↗</a>`).join('');
      }
      const services=ctx.definitions?.services || [],key2=services.map(s=>s.id+':'+s.name).join('|');
      if(key2!==servicesKey){servicesKey=key2;$('service').innerHTML='<option value="">Custom request</option>'+services.map(s=>`<option value="${esc(s.id)}">${esc(s.protocol+' · '+s.name)}</option>`).join('');const rpm=services.find(s=>s.request_hex==='01 0C');if(rpm)$('service').value=rpm.id;}
    }
    function renderPort(){
      const protocol=selectedProtocol();if(!protocol)return;
      const key=JSON.stringify([catalogKey,protocol.id,pin]);if(key===portKey)return;portKey=key;
      const pins=ctx.scannerCatalog.socket?.pins||[],labels={2:'Bus+',4:'Chassis',5:'Signal',6:'CAN-H',7:'K-line',10:'Bus−',14:'CAN-L',15:'L-line',16:'+12 V'};
      const mapKey=JSON.stringify([catalogKey,protocol.id]);
      if(mapKey!==portMapKey){portMapKey=mapKey;$('port').innerHTML='<path d="M25 14H475Q491 14 484 34L452 197H48L16 34Q9 14 25 14Z" fill="#101923" stroke="#7890a6" stroke-width="2"/><path d="M63 94H437V117H63Z" fill="#243447" stroke="#61748b"/>'+pins.map(p=>{
        const x=p.number<=8?47+(p.number-1)*58:64+(p.number-9)*53,y=p.number<=8?52:151,active=protocol.pins.includes(p.number),role=p.number===6?'sc-pin-can-h':p.number===14?'sc-pin-can-l':'';
        return `<g class="sc-pin ${role} ${active?'active':''} ${pin===p.number?'selected':''}" data-sc-pin="${p.number}" role="button" tabindex="0" aria-label="Pin ${p.number}: ${esc(p.label)}${active?', used by selected transport':', not used by selected transport'}" aria-pressed="${pin===p.number}"><rect x="${x-17}" y="${y-16}" width="34" height="30" rx="4"/><text x="${x}" y="${y+4}" text-anchor="middle">${p.number}</text><text class="sc-port-role" x="${x}" y="${y+30}" text-anchor="middle">${esc(labels[p.number]||'OEM')}</text></g>`;
      }).join('');}
      $('port').querySelectorAll('[data-sc-pin]').forEach(node=>{const selected=Number(node.dataset.scPin)===pin;node.classList.toggle('selected',selected);node.setAttribute('aria-pressed',String(selected));});
      const selected=pins.find(p=>p.number===pin),used=protocol.pins.includes(pin),can=protocol.id.startsWith('can');
      text('pin-title','Pin '+pin+' · '+(selected?.label||'Vehicle-specific'));
      text('pin-description',selected?.function||selected?.description||'No generic signal assignment.');
      text('pin-use',used?'Used by this transport':'Not used by this transport');$('pin-use').classList.toggle('used',used);
      let pair=selected?.paired_pins?.length?'Pin '+selected.paired_pins.join(' / '):'No paired data conductor assigned';
      if([6,14].includes(pin))pair+=' · the other half of the CAN data pair';
      if([7,15].includes(pin))pair+=' · optional initialization companion, not a differential pair';
      if(pin===2&&protocol.id==='j1850_vpw')pair='VPW uses pin 2 only; pin 10 is not used.';
      $('pin-facts').innerHTML=`<div><dt>Companion / return</dt><dd>${esc(pair)}</dd></div><div><dt>Signal example</dt><dd>${esc(selected?.signal_example||'Reference only; no live wire waveform is modeled.')}</dd></div><div><dt>What unplugging does here</dt><dd>${esc(selected?.failure_effect||'The lab can unplug the tester branch. Individual pin faults are not modeled.')}</dd></div>`;
      text('pin-scope',selected?.model_scope||'Selecting a pin inspects its role. It does not disconnect a wire.');
      text('transport-description',protocol.description);text('protocol-scope',protocol.availability==='implemented'?'Runnable':'Reference only');$('protocol-scope').classList.toggle('reference',protocol.availability!=='implemented');text('signal-example',protocol.signal_example);
      text('bitrate-note',protocol.bitrate?`${format(protocol.bitrate/1000)} kbit/s = ${format(protocol.bitrate)} bits each second${can?` · ${format(1000000/protocol.bitrate)} µs per nominal bit`:''}. This static drawing is not a timed capture.`:'IP transport: the link speed depends on the network. No physical link is modeled.');
      text('reference-note',protocol.availability==='implemented'?'This adapter generates CAN / ISO-TP lesson frames in memory. It does not connect to a physical vehicle.':'This transport has pin and signal explanations only. Select an implemented 11-bit CAN transport to run requests.');
      if(can){
        $('waveform').setAttribute('aria-label','Typical CAN signal example: recessive bit 1 has both lines at about 2.5 volts; dominant bit 0 has CAN-H about 3.5 volts and CAN-L about 1.5 volts. Static reference, not a captured signal.');
        $('waveform').innerHTML='<rect x="194" y="46" width="134" height="116" fill="#263b45"/><path d="M64 60H473M64 103H473M64 146H473" stroke="#34495c" stroke-dasharray="3 4"/><text x="7" y="64">3.5 V</text><text x="7" y="107">2.5 V</text><text x="7" y="150">1.5 V</text><path class="sc-high" d="M64 103H194V60H328V103H473"/><path class="sc-low" d="M64 103H194V146H328V103H473"/><text class="sc-state-label" x="126" y="23" text-anchor="middle">Recessive · 1</text><text class="sc-state-label" x="261" y="23" text-anchor="middle">Dominant · 0</text><text class="sc-state-label" x="400" y="23" text-anchor="middle">Recessive · 1</text><text x="126" y="183" text-anchor="middle">H − L ≈ 0 V</text><text x="261" y="183" text-anchor="middle">H − L ≈ 2 V</text><text x="400" y="183" text-anchor="middle">H − L ≈ 0 V</text><text x="250" y="210" text-anchor="middle">Typical levels · both conductors carry one signal</text>';
      }else if(protocol.id==='doip'){
        $('waveform').setAttribute('aria-label','Diagnostic service through DoIP and TCP/IP over Ethernet. No universal DLC Ethernet pin assignment is claimed.');
        $('waveform').innerHTML='<text class="sc-state-label" x="250" y="75" text-anchor="middle">UDS → DoIP → TCP/IP → Ethernet</text><text x="250" y="110" text-anchor="middle">No universal DLC Ethernet pin map claimed</text><text x="250" y="145" text-anchor="middle">Reference only · no network connection is opened</text>';
      }else{
        $('waveform').setAttribute('aria-label','Symbolic legacy protocol pulse shape. It is not encoded data, a calibrated voltage axis or measured bit timing.');
        $('waveform').innerHTML='<path d="M55 73H475M55 146H475" stroke="#34495c" stroke-dasharray="3 4"/><path class="sc-high" d="M55 73H120V146H157V73H232V146H290V73H340V146H381V73H475"/><text class="sc-state-label" x="250" y="30" text-anchor="middle">Symbolic legacy pulse signal</text><text x="250" y="185" text-anchor="middle">Shape only · not an encoded frame or voltage capture</text>';
      }
    }
    function renderReport(){const report=ctx.scanReport,key=JSON.stringify(report);if(key===reportKey)return;reportKey=key;
      if(!report){$('module-rows').innerHTML='<tr><td colspan="4" class="sc-empty">No scan results yet. Choose the transport, switch ignition on, then Scan all control units. No individual unit connection is needed.</td></tr>';text('scan-summary','Vehicle not scanned');text('scan-time','Discovery uses the selected transport and keeps your current unit connection unchanged.');return;}
      const modules=(report.modules||[]).filter(m=>m.installed),stored=modules.reduce((n,m)=>n+(m.codes?.length||0),0),pendingCodes=modules.reduce((n,m)=>n+(m.pending_codes?.length||0),0);
      text('scan-summary',modules.length+' units · '+stored+' stored · '+pendingCodes+' pending');
      text('scan-time','Last scan at '+format(report.t)+' s · a snapshot, refreshed when you scan again.');
      $('module-rows').innerHTML=(report.modules||[]).filter(m=>m.installed).map(m=>`<tr><td><strong>${esc(m.label)}</strong></td><td><span class="sc-module-status ${['healthy'].includes(m.status)?'ok':'issue'}">${esc(friendly(m.status))}</span></td><td>${esc(m.codes?.length?m.codes.join(', '):m.pending_codes?.length?m.pending_codes.join(', ')+' pending':['healthy','faults'].includes(m.status)?'No stored codes':'Unavailable')}</td><td><small>${m.diagnostic_capability==='obd_uds'?'OBD replies + sampled inputs':'Simulation state'}</small><button type="button" data-sc-connect="${esc(m.id)}">Connect →</button><button class="quiet" data-sc-unit="${esc(m.id)}">Inspect signals →</button></td></tr>`).join('');
    }
    function parameterCatalog(){return ctx?window.AppModel.liveParameterCatalog(ctx,selectedModule()?.id):[];}
    const moduleId=()=>selectedModule()?.id;
    function parameterIds(){return moduleId()==='ecu'?ctx?.scanLive?.ids??window.AppModel.defaultLiveParameters(ctx,'ecu'):modelSelections[moduleId()]??window.AppModel.defaultLiveParameters(ctx,moduleId());}
    function changeParameters(ids){
      if(moduleId()==='ecu')options.onLiveChange?.({ids});else{modelSelections[moduleId()]=ids;captureModelData();}
      liveKey='';renderLive();
    }
    function closePicker(){$('parameter-picker').hidden=true;buttons('add-parameter').setAttribute('aria-expanded','false');buttons('add-parameter').focus?.();}
    function liveAvailable(){const connection=ctx.scanner||{};return connection.connected&&connection.protocol===$('protocol').value&&connection.module_id===$('module').value&&['ready','state_only'].includes(connection.status);}
    function modelReading(parameter,state){
      if(parameter.sensor){const reading=state.vehicle_sensors?.[parameter.id];return {value:reading?.validity==='valid'?reading.value:null,sampledAt:reading?.sampled_at,validity:reading?.validity,conversion:reading?.conversion};}
      const reading=window.AppModel.recordedSignal(parameter.signal,state);return {value:reading.validity==='valid'?reading.value:null,sampledAt:state.t,validity:reading.validity,conversion:parameter.signal.sensor_id?state.vehicle_sensors?.[parameter.signal.sensor_id]?.conversion:null};
    }
    function captureModelData(){
      if(!liveAvailable())return;
      const data=modelData[moduleId()]||{replies:{},series:{},nextAt:0};
      const interval=ctx.scanLive?.interval||.25;data.interval=interval;
      for(const parameter of parameterCatalog().filter(p=>!p.service)){
        const reading=modelReading(parameter,ctx.state),id=parameter.id;data.replies[id]=reading;
        if(!parameterIds().includes(id))continue;
        const series=data.series[id]||[],point={t:ctx.state.t,value:typeof reading.value==='boolean'?Number(reading.value):reading.value};
        if(series.at(-1)?.t===point.t)series[series.length-1]=point;else series.push(point);
        data.series[id]=series.filter(p=>p.t>=ctx.state.t-120).slice(-481);
      }
      data.nextAt=(Math.floor(ctx.state.t/interval+1e-7)+1)*interval;modelData[moduleId()]=data;
    }
    function graph(points){
      points=points.filter(p=>p.t>=ctx.state.t-120);
      const valid=points.filter(p=>Number.isFinite(p.value));
      if(!valid.length)return '<text x="160" y="52" text-anchor="middle">No valid samples yet</text>';
      const min=Math.min(...valid.map(p=>p.value)),max=Math.max(...valid.map(p=>p.value)),pad=Math.max((max-min)*.1,1),low=min-pad,high=max+pad;
      const end=ctx.state.t,start=Math.max(0,end-120),span=Math.max(1,end-start),x=t=>34+(t-start)/span*274,y=v=>84-(v-low)/(high-low)*64;
      let path='',move=true;for(const p of points){if(!Number.isFinite(p.value)){move=true;continue;}path+=(move?'M':'L')+x(p.t).toFixed(1)+' '+y(p.value).toFixed(1)+' ';move=false;}
      const last=valid.at(-1);
      return `<path class="sc-trend-grid" d="M34 20H308M34 52H308M34 84H308"/><text x="3" y="24">${esc(format(high))}</text><text x="3" y="87">${esc(format(low))}</text><path class="sc-trend-line" d="${path}"/><circle class="sc-trend-point" cx="${x(last.t)}" cy="${y(last.value)}" r="2.5"/><text x="34" y="104">${esc(format(start))} s</text><text x="308" y="104" text-anchor="end">${esc(format(end))} s</text>`;
    }
    function obdConversion(parameter,reply,decoded){
      const steps=[{label:'Request · hex',value:reply?.request_hex||parameter.service.request_hex}];
      if(!reply?.response_hex)return {steps:[...steps,{label:'Response · hex',value:'No reply'},{label:'Input validity',value:reply?.meaning||'No reading yet'}]};
      steps.push({label:'Response · hex',value:reply.response_hex});
      for(const frame of reply.frames||[])steps.push({label:'CAN / ISO-TP',value:`${frame.direction} · 0x${frame.id} · ${frame.data}`});
      const spec=parameter.service.decode,bytes=reply.response_hex.trim().split(/\s+/).map(b=>parseInt(b,16));
      const prefix=parameter.service.positive_prefix_hex.trim().split(/\s+/).map(b=>parseInt(b,16));
      if(typeof decoded.value==='number'&&prefix.every((byte,i)=>bytes[i]===byte)&&bytes.length>=spec.data_offset+spec.data_length){
        const data=bytes.slice(spec.data_offset,spec.data_offset+spec.data_length);
        steps.push({label:'Data bytes · hex → decimal',value:data.map((b,i)=>`${String.fromCharCode(65+i)}: 0x${b.toString(16).toUpperCase().padStart(2,'0')} = ${b}`).join('; ')});
        const ordered=spec.byte_order==='little'?[...data].reverse():data,raw=ordered.reduce((value,byte)=>value*256+byte,0);
        steps.push({label:'Raw integer',value:ordered.map((byte,i)=>`${byte} × ${256**(ordered.length-i-1)}`).join(' + ')+' = '+raw});
        steps.push({label:'Formula',value:decoded.formula||spec.formula},{label:'Calculation',value:decoded.calculation+' '+parameter.unit});
      }
      return {steps,scope:'Application bytes are decoded after ISO-TP framing is removed.'};
    }
    function renderLive(){
      const module=selectedModule(),endpoint=module?.id==='ecu',available=liveAvailable(),parameters=parameterCatalog(),ids=parameterIds(),live=ctx.scanLive||{};
      const connectionKey=JSON.stringify([ctx.scanner?.connected,ctx.scanner?.module_id,ctx.scanner?.protocol]);if(connectionKey!==modelConnectionKey){modelConnectionKey=connectionKey;modelData={};}
      if(available&&(!modelData[moduleId()]||modelData[moduleId()].interval!==(live.interval||.25)||ctx.state.t+1e-7>=modelData[moduleId()].nextAt))captureModelData();
      text('live-title',(module?.label||'Selected unit')+' parameters');
      text('live-status',!parameters.length?'This fitted module has no implemented live measurements.':!available?'Connect this unit and switch ignition on to read its parameters.':(ctx.running?'Live · ':'Simulation paused · ')+format(live.interval||.25)+' s sampling · '+ids.length+' parameters');
      text('target-capability',endpoint?'Engine ECU · OBD replies and available model measurements are labelled on each card. Basic / Extended describes this teaching sensor set, not a Euro emissions class.':(module?.label||'Selected unit')+' · sampled simulation values. No proprietary diagnostic protocol is implemented.');
      $('custom-request').hidden=!endpoint;
      if(document.activeElement!==$('live-interval'))$('live-interval').value=String(live.interval||.25);
      text('live-cadence','Live readings repeat every '+format(live.interval||.25)+' s of simulation time.');
      container.querySelectorAll('[data-sc-display]').forEach(node=>node.setAttribute('aria-pressed',String(node.dataset.scDisplay===displayMode)));
      const remaining=parameters.filter(p=>!ids.includes(p.id)),key=JSON.stringify(remaining.map(p=>p.id));
      if(key!==pickerKey){pickerKey=key;$('parameter-choice').innerHTML=remaining.map(p=>`<option value="${esc(p.id)}">${esc(p.label)}${p.unit?' · '+esc(p.unit):''} · ${p.service?'OBD':'Model'}</option>`).join('');}
      buttons('add-parameter').disabled=!remaining.length;buttons('confirm-parameter').disabled=!remaining.length;
      const samples=ids.map(id=>{
        const parameter=parameters.find(p=>p.id===id);if(!parameter)return null;
        const reply=live.replies?.[id],reading=modelData[moduleId()]?.replies[id],decoded=reply?decodeReply(reply):{};
        const obd=!!parameter.service;
        const value=available?(obd?(typeof decoded.value==='number'&&reply.response_hex?decoded.value:null):reading?.value??null):null;
        const sampledAt=obd?reply?.sample_t:reading?.sampledAt;
        const points=obd?(live.series?.[id]||[]).map(d=>({t:d.sample_t,value:d.response_hex?decodeReply(d).value:null})):modelData[moduleId()]?.series[id]||[];
        const reason=!available?'Not connected / unit unavailable':value==null?(obd?reply?.meaning:parameter.id==='fuel_l_100km'&&ctx.state.speed_kph<1?'Available from 1 km/h; use L/h while stationary.':'Invalid or unavailable sensor input')||'No reading yet':(obd?'OBD reply':'Model sample')+' · '+format(sampledAt)+' s';
        const conversion=available?(obd?obdConversion(parameter,reply,decoded):reading?.conversion):null;
        return {parameter,value,points,reason,conversion,sensorConversion:available&&obd?reply?.sensor_conversion:null};
      }).filter(Boolean);
      const contentKey=JSON.stringify([available,ids,displayMode,samples.map(s=>[s.value,s.reason,s.conversion,s.sensorConversion,displayMode==='graphs'?s.points:null]),displayMode==='graphs'?ctx.state.t:null]);
      if(contentKey===liveKey)return;liveKey=contentKey;
      $('live-grid').classList.toggle('sc-graph-mode',displayMode==='graphs');
      const expanded=new Set([...container.querySelectorAll('[data-sc-conversion]')].filter(node=>node.open).map(node=>node.dataset.scConversion));
      $('live-grid').innerHTML=samples.map(({parameter:p,value,points,reason,conversion,sensorConversion})=>`<article class="sc-live-card" data-sc-parameter="${esc(p.id)}"><header><strong title="${esc(p.sensor?.description||p.signal?.description||p.service?.note||p.label)}">${esc(p.label)}</strong><button type="button" class="quiet" data-sc-remove="${esc(p.id)}" aria-label="Remove ${esc(p.label)}">×</button></header><div class="sc-live-value">${esc(format(value))}<small>${esc(p.unit)}</small></div>${displayMode==='graphs'?`<svg viewBox="0 0 320 112" role="img" aria-label="${esc(p.label)} over the last 120 seconds of simulation time">${typeof value==='string'?'<text x="160" y="52" text-anchor="middle">State value · no numeric graph</text>':graph(points)}</svg>`:''}<p class="${value==null?'sc-missing':''}">${esc(reason)}</p>${conversion?`<details class="sc-conversion" data-sc-conversion="${esc(p.id)}" ${expanded.has(p.id)?'open':''}><summary>${p.service?'Bytes & calculation':'Conversion path'}</summary>${sensorConversion?'<h4>Sensor → ECU</h4>'+window.AppModel.conversionMarkup(sensorConversion):''}${sensorConversion?'<h4>ECU → scan tool</h4>':''}${window.AppModel.conversionMarkup(conversion)}</details>`:''}</article>`).join('')||`<p class="sc-empty">${parameters.length?'No parameters selected. Use + Add parameter to choose readings for this unit.':'No live measurements are implemented for this module. External charging is reference-only.'}</p>`;
    }
    function renderUnit(){
      const module=selectedModule(),report=ctx.unitReports?.[module?.id]||ctx.scanReport,unit=report?.modules?.find(m=>m.id===module?.id),available=liveAvailable(),busy=pending||(ctx.controlsBusy??ctx.busy);
      text('unit-title',(module?.label||'Selected unit')+' · fault memory');
      text('unit-time',unit?'Snapshot at '+format(report.t)+' s · read again to refresh.':'Read fault codes for this unit.');
      buttons('scan-unit').disabled=busy||!available;buttons('clear-unit').hidden=module?.id!=='ecu';buttons('clear-unit').disabled=buttons('clear').disabled;
      const codes=[...(unit?.codes||[]).map(code=>[code,'Stored']),...(unit?.pending_codes||[]).map(code=>[code,'Pending'])];
      const status=!available?'Connect the selected unit and switch ignition on.':!unit?'Fault memory has not been read yet.':!['healthy','faults'].includes(unit.status)?'Unit unavailable at last scan: '+friendly(unit.status):codes.length?'':'No stored or pending fault codes.';
      const html=status?`<p>${esc(status)}</p>`:codes.map(([code,state])=>`<p><strong>${esc(code)}</strong> · ${state}</p>`).join('');
      if($('unit-faults').innerHTML!==html)$('unit-faults').innerHTML=html;
    }
    function renderReply(){const d=ctx.diagnostic,key=d?JSON.stringify([d.sample_t,d.request_hex,d.response_hex,d.meaning]):'';if(key===lastReplyKey&&d===lastDiagnostic)return;lastReplyKey=key;lastDiagnostic=d;
      if(!d){if(trend.length)clearTrend();text('response-title','No request yet');text('response-time','');text('response-value','—');text('response-meaning','Connect the virtual adapter to request a value.');text('request-bytes','—');text('response-bytes','—');text('response-formula','');return;}
      const decoded=decodeReply(d);captureTrend(d,decoded);text('response-title',d.response_hex?(decoded.title||'ECU response'):d.error?'Invalid request':'No data returned');text('response-time',format(d.sample_t)+' s');
      text('response-value',decoded.value!=null?format(decoded.value)+(decoded.unit?' '+decoded.unit:''):decoded.decoded || d.decoded || (d.response_hex?'Response received':'—'));
      text('response-meaning',d.meaning||d.error||'');text('request-bytes',d.request_hex||'—');text('response-bytes',d.response_hex||'No reply');text('response-formula',[decoded.formula,decoded.calculation].filter(Boolean).join(' · '));
    }
    function decodeReply(d){
      const decoded=window.ProtocolsView?.decodeResponse?.(d)||{};if(decoded.value!=null||!d.response_hex)return decoded;
      const service=ctx.definitions?.services?.find(s=>s.request_hex===d.request_hex),spec=service?.decode;
      if(!spec||spec.kind!=='linear')return decoded;
      const bytes=String(d.response_hex).trim().split(/\s+/).map(x=>parseInt(x,16)),prefix=String(service.positive_prefix_hex||'').trim().split(/\s+/).map(x=>parseInt(x,16));
      if(bytes.some(x=>!Number.isInteger(x)||x<0||x>255)||!prefix.every((x,i)=>bytes[i]===x)||bytes.length<spec.data_offset+spec.data_length)return decoded;
      const data=bytes.slice(spec.data_offset,spec.data_offset+spec.data_length);if(spec.byte_order==='little')data.reverse();
      const raw=data.reduce((value,byte)=>value*256+byte,0),value=raw*spec.factor+spec.offset;if(!Number.isFinite(value))return decoded;
      return {...decoded,title:service.name,value,unit:service.unit,formula:spec.formula||'',calculation:`${raw} × ${spec.factor} + ${spec.offset} = ${format(value)}`};
    }
    let lastSelection;
    function render(){if(!ctx?.state||disposed)return;
      const configuration=JSON.stringify(ctx.state.vehicle?.configuration);if(configuration!==lastConfig){lastConfig=configuration;reportKey=lastReplyKey=lastDiagnostic=null;pin=6;error='';setTab('data');liveKey='';modelSelections={};modelData={};clearTrend();$('request-details').removeAttribute('open');$('response-details').removeAttribute('open');}
      catalog();
      if(lastSelection!==ctx.selection){
        lastSelection=ctx.selection;const id=String(ctx.selection||'').replace(/^component:/,'');
        if(ctx.scannerCatalog?.modules?.some(m=>m.installed&&m.id===id)&&$('module').value!==id){$('module').value=id;setTab('data');closePicker();clearTrend();}
      }
      const connection=ctx.scanner||{},protocol=selectedProtocol(),module=selectedModule(),implemented=protocol?.availability==='implemented';
      const busy=pending||(ctx.controlsBusy??ctx.busy),ready=['ready','state_only'].includes(connection.status),matches=connection.protocol===$('protocol').value&&connection.module_id===$('module').value;
      const changed=!!connection.connected&&!matches;
      const discovery=activeTab==='faults',connectedModule=ctx.scannerCatalog?.modules?.find(m=>m.id===connection.module_id);
      $('unit-picker').hidden=discovery;buttons('connect').hidden=buttons('disconnect').hidden=discovery;container.classList.toggle('sc-discovery-mode',discovery);
      text('connection-status',discovery?'Whole vehicle':changed?'Selection not applied':friendly(connection.status||'disconnected'));$('connection-status').classList.toggle('ready',!discovery&&ready&&matches);
      text('connection-reason',discovery?'Discover units using this transport; your open unit session stays unchanged.':changed?'The selected transport or unit is not applied. '+(!implemented?'This transport is reference-only. Choose an implemented transport to connect.':'Connect to '+(module?.label||'the selected unit')+' to apply this selection.'):(connection.connected?'Connected to '+(connectedModule?.label||connection.module_id)+'. ':'')+(connection.reason||'Connect the virtual scan tool.'));
      const vehicle=ctx.state.vehicle||{},electric=vehicle.configuration?.powertrain==='bev',operation=electric?(vehicle.ready?'Drive system READY':'Drive system not ready'):ctx.state.engine_running?'Engine running':vehicle.start_state==='inhibited'?'Engine stopped · start inhibited':vehicle.start_state==='cranking'?'Starter cranking':'Engine stopped';
      text('vehicle-name',vehicle.configuration?.label||'Current vehicle');
      text('vehicle-link','Vehicle CAN '+format((connection.vehicle_bitrate||vehicle.configuration?.can_bitrate||500000)/1000)+' kbit/s · ignition '+vehicle.ignition+' · '+operation);
      buttons('connect').disabled=busy||!implemented||!module||connection.connected&&matches;buttons('connect').textContent=!implemented?'Reference only':(connection.connected&&matches?'Connected to ':'Connect to ')+(module?.label||'unit');
      buttons('disconnect').disabled=busy||!connection.connected;buttons('scan').disabled=busy||!implemented;
      const endpoint=module?.id==='ecu',requestable=connection.connected&&matches&&implemented&&endpoint;buttons('send').disabled=busy||!requestable;buttons('clear').disabled=busy||!requestable;
      text('target-capability',endpoint?'Engine ECU · executable OBD / UDS subset. Readings come from sampled simulated inputs.':'Selected unit provides simulation-state inspection. Its OEM OBD / UDS endpoint is not implemented. Use the scan result or inspect its signals.');
      $('poll-enabled').disabled=busy||!requestable||!ctx.definitions?.services?.some(s=>normalize(s.request_hex)===normalize($('payload').value)&&s.decode?.kind==='linear');$('poll-enabled').checked=!!ctx.scanPolling?.enabled;
      if(document.activeElement!==$('poll-interval'))$('poll-interval').value=String(ctx.scanPolling?.interval||1);
      $('notice').classList.toggle('error',!!error);if(error){$('notice').hidden=false;text('notice',error);}
      options.onLiveVisibility?.(visible&&activeTab==='data'&&endpoint&&matches);
      renderReport();container.querySelectorAll('[data-sc-connect]').forEach(node=>{node.disabled=busy||!implemented;});renderReply();renderPort();if(visible&&activeTab==='data')renderLive();renderUnit();
    }
    function poll(){const numeric=ctx.definitions?.services?.some(s=>normalize(s.request_hex)===normalize($('payload').value)&&s.decode?.kind==='linear');options.onPoll?.({enabled:$('poll-enabled').checked&&!!numeric,payload:$('payload').value,canId:$('address').value,interval:Number($('poll-interval').value)});}
    listen(container,'click',event=>{const tabNode=event.target.closest?.('[data-sc-tab]');if(tabNode){setTab(tabNode.dataset.scTab);render();return;}const pinNode=event.target.closest?.('[data-sc-pin]');if(pinNode){pin=Number(pinNode.dataset.scPin);renderPort();return;}
      const display=event.target.closest?.('[data-sc-display]');if(display){displayMode=display.dataset.scDisplay;liveKey='';renderLive();return;}
      const remove=event.target.closest?.('[data-sc-remove]');if(remove){changeParameters(parameterIds().filter(id=>id!==remove.dataset.scRemove));return;}
      const openUnit=event.target.closest?.('[data-sc-connect]');if(openUnit&&!openUnit.disabled){$('module').value=openUnit.dataset.scConnect;setTab('data');options.onSelect?.($('module').value);render();if(liveAvailable())return;execute('Connecting to '+selectedModule()?.label+'…',()=>options.onScanner?.('connect',{protocol:$('protocol').value,module:$('module').value}));return;}
      const target=event.target.closest?.('[data-sc-action],[data-sc-unit]');if(!target||target.disabled)return;
      if(target.dataset.scUnit){options.onSelect?.(target.dataset.scUnit);options.onNavigate?.('signals');return;}
      switch(target.dataset.scAction){case 'connect':execute('Connecting to '+selectedModule()?.label+'…',()=>options.onScanner?.('connect',{protocol:$('protocol').value,module:$('module').value}));break;
        case 'disconnect':options.onPoll?.({enabled:false});execute('Disconnecting adapter…',()=>options.onScanner?.('disconnect'));break;
        case 'add-parameter':$('parameter-picker').hidden=false;buttons('add-parameter').setAttribute('aria-expanded','true');$('parameter-choice').focus?.();break;
        case 'close-picker':closePicker();break;
        case 'confirm-parameter':if($('parameter-choice').value)changeParameters([...parameterIds(),$('parameter-choice').value]);closePicker();break;
        case 'scan-unit':execute('Reading selected unit fault memory…',()=>options.onScanner?.('faults'));break;
        case 'scan':execute('Discovering control units…',()=>options.onScanner?.('scan',{protocol:$('protocol').value}));break;
        case 'clear-unit':
        case 'clear':execute('Clearing engine emissions memory…',async()=>{const reply=await options.onRequest?.('04','7DF');if(!/^44(?:\s|$)/.test(reply?.response_hex||''))throw Error(reply?.meaning||reply?.error||'The engine ECU did not confirm that codes were cleared.');return target.dataset.scAction==='clear'&&activeTab==='faults'?options.onScanner?.('scan',{protocol:$('protocol').value}):options.onScanner?.('faults');});break;
        case 'pin':options.onSelect?.('pin:dlc_socket:'+pin);options.onNavigate?.('wiring');break;
        case 'dlc':options.onSelect?.('socket:dlc_socket');options.onNavigate?.('wiring');break;
      }
    });
    listen(container,'keydown',event=>{const tabNode=event.target.closest?.('[data-sc-tab]');if(tabNode&&['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();event.stopPropagation?.();const names=['data','unit','faults','connector'],at=names.indexOf(tabNode.dataset.scTab);setTab(event.key==='Home'?names[0]:event.key==='End'?names.at(-1):names[(at+(event.key==='ArrowRight'?1:names.length-1))%names.length],true);render();return;}const node=event.target.closest?.('[data-sc-pin]');if(node&&['Enter',' '].includes(event.key)){event.preventDefault();pin=Number(node.dataset.scPin);renderPort();}});
    const selectionChanged=()=>{clearTrend();if(ctx.scanPolling?.enabled)options.onPoll?.({enabled:false});render();};
    listen($('protocol'),'change',selectionChanged);listen($('module'),'change',()=>{closePicker();options.onSelect?.($('module').value);selectionChanged();});
    listen($('request-form'),'submit',event=>{event.preventDefault();if(!buttons('send').disabled)execute('Reading ECU data…',async()=>{const reply=await options.onRequest?.($('payload').value,$('address').value);$('poll-enabled').checked=true;poll();return reply;});});
    listen($('service'),'change',()=>{clearTrend();const service=ctx.definitions?.services?.find(s=>s.id===$('service').value);if(service){$('payload').value=service.request_hex;$('address').value=service.can_id;text('service-note',service.protocol+' · '+(service.note||service.name));if($('poll-enabled').checked)poll();}else{$('request-details').setAttribute('open','');$('payload').focus?.();}});
    listen($('payload'),'change',()=>{clearTrend();$('service').value='';if($('poll-enabled').checked)poll();});listen($('address'),'change',()=>{clearTrend();if($('poll-enabled').checked)poll();});
    listen($('live-interval'),'change',()=>options.onLiveChange?.({interval:Number($('live-interval').value)}));
    listen($('poll-enabled'),'change',poll);listen($('poll-interval'),'change',poll);
    return {update(next){const before=catalogKey;ctx=next;render();if(before!==catalogKey)renderPort();},setVisible(value){visible=!!value;if(!visible)options.onLiveVisibility?.(false);if(visible)render();},resize(){},dispose(){disposed=true;listeners.forEach(([node,type,fn])=>node.removeEventListener(type,fn));container.replaceChildren();},inspect(){return {visible,pending,error,pin,activeTab,displayMode,parameters:parameterIds(),trend:trend.map(point=>({...point})),protocol:$('protocol').value,module:$('module').value,reportTime:ctx?.scanReport?.t};}};
  }
  create.nextId=0;
  window.ScannerView={create};
})();
