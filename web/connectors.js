/* Connector explorer. Standard DLC reference + explicitly fictional lesson pins. */
(function () {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const SOURCES = {
    elm: 'https://elmelectronics.com/wp-content/uploads/2020/05/ELM327DSL.pdf',
    scan: 'https://www.scantool.net/blog/which-obd-ii-protocol-is-supported-by-my-vehicle/'
  };
  const dlcPins = Array.from({length: 16}, (_, i) => ({
    n: i + 1, name: 'Vehicle-specific / other use', short: 'Other', kind: 'other',
    direction: 'Not assigned in this lesson', modeled: 'Unused by this CAN lesson',
    description: 'No signal is assigned here by this simulator. This position is not evidence of a particular manufacturer function.',
    provenance: 'No vehicle-specific assignment made'
  }));
  function assign(n, properties) { Object.assign(dlcPins[n - 1], properties); }
  assign(2, {name:'SAE J1850 Bus +',short:'J1850+',kind:'legacy',direction:'Protocol-dependent bus line',description:'Legacy J1850 use. It is not part of the CAN profile implemented by this lab.',provenance:'Protocol reference · not modeled'});
  assign(4, {name:'Chassis ground',short:'Chassis',kind:'ground',direction:'Electrical reference',modeled:'Ground reference · not electrically solved',description:'Chassis-ground position in the diagnostic connector reference. The simulator does not calculate chassis offsets or wiring resistance.',provenance:'Standard connector role'});
  assign(5, {name:'Signal ground',short:'SGND',kind:'ground',direction:'Signal reference',modeled:'Ground reference · not electrically solved',description:'Diagnostic signal-ground position. This is distinct from the lesson sensor-return connector label.',provenance:'Standard connector role'});
  assign(6, {name:'CAN High',short:'CAN-H',kind:'bus',direction:'Bidirectional diagnostic bus',modeled:'Frame layer only · voltage not modeled',description:'CAN-H for the ISO 15765-4 CAN profile. The lab models diagnostic frames; it does not generate analog dominant/recessive voltage waveforms.',provenance:'CAN-profile connector role'});
  assign(7, {name:'ISO K-line',short:'K-line',kind:'legacy',direction:'Legacy diagnostic line',description:'K-line for applicable ISO 9141/14230 systems. Not active in this CAN-only lesson.',provenance:'Protocol reference · not modeled'});
  assign(10, {name:'SAE J1850 Bus −',short:'J1850−',kind:'legacy',direction:'Protocol-dependent bus line',description:'Legacy J1850 PWM differential bus use. Not active in this CAN-only lesson.',provenance:'Protocol reference · not modeled'});
  assign(14, {name:'CAN Low',short:'CAN-L',kind:'bus',direction:'Bidirectional diagnostic bus',modeled:'Frame layer only · voltage not modeled',description:'CAN-L pairs with CAN-H on pin 6 for this diagnostic CAN profile. A displayed CAN frame is not a measured voltage at the pin.',provenance:'CAN-profile connector role'});
  assign(15, {name:'ISO L-line',short:'L-line',kind:'legacy',direction:'Legacy protocol-dependent line',description:'L-line may be present for applicable ISO 9141/14230 initialization. No L-line protocol is implemented here.',provenance:'Protocol reference · not modeled'});
  assign(16, {name:'Vehicle battery positive',short:'Supply',kind:'power',direction:'Power to diagnostic equipment',modeled:'Supply voltage not simulated',description:'Vehicle battery-positive connection. This view deliberately does not invent a measured 12 V value or connect the traction-pack voltage to this pin.',provenance:'Standard connector role'});
  const definitions = {
    dlc: {title:'Vehicle diagnostic connector',subtitle:'J1962 Type A reference · ISO 15765-4 CAN lesson',badge:'STANDARD REFERENCE',view:'Looking into the vehicle socket · mating face · wide edge up',
      note:'Numbering is a reference for the vehicle socket. Rear/wire-side view mirrors the drawing; this is not a connector part-number drawing.',pins:dlcPins},
    j_ect: {title:'J-ECT · coolant-sensor harness',subtitle:'Two cavities assigned only for this teaching circuit',badge:'ILLUSTRATIVE LESSON CONNECTOR',view:'Looking into the harness-side cavities · sensor disconnected from this face',
      note:'J-ECT.1 is the ECU-side harness node. An open sensor path lets the pull-up raise this node; the sensor-side terminal is not separately modeled.',pins:[
        {n:1,name:'ECT signal / THW lesson label',short:'Signal',kind:'signal',direction:'Sensor circuit → ECU ADC',signal:'sensors.ect_node_v',unit:'V',description:'Connects to illustrative ECU node X1.2. Probe the physical divider node here. The ECU also exposes its ADC-reconstructed voltage as a separate signal.',provenance:'Invented pin assignment · not a Toyota pinout'},
        {n:2,name:'Sensor return',short:'Return',kind:'ground',direction:'Circuit reference',signal:'sensors.sensor_return_v',unit:'V',description:'Connects to illustrative X1.3. The teaching circuit holds this reference at 0 V; return-wire resistance and ground offset are not modeled.',provenance:'Invented pin assignment · ideal model reference'}]},
    x1: {title:'X1 · virtual ECU test points',subtitle:'Illustrative ECU boundary and internal reference; not a real connector',badge:'ILLUSTRATIVE TEST POINTS',view:'Virtual test-point view · numbers belong only to this lesson',
      note:'X1.1 denotes an internal reference test point. It is not a claim that a real ECU exposes that reference at physical cavity 1.',pins:[
        {n:1,name:'Internal sensor reference',short:'Vref',kind:'power',direction:'Ideal source → pull-up resistor',signal:'sensors.ect_reference_v',unit:'V',description:'Powered model reference for the pull-up resistor. Default is 5 V when ignition is on. It is an illustrative internal test point.',provenance:'Teaching parameter · not an OEM terminal'},
        {n:2,name:'ECT input / THW lesson label',short:'ECT in',kind:'signal',direction:'J-ECT.1 → ADC input',signal:'sensors.ect_node_v',unit:'V',description:'Physical ECT divider node, electrically shared with J-ECT.1 in this ideal circuit. The separate ADC-reconstructed voltage can differ slightly because of quantization.',provenance:'Invented test-point mapping · physical model signal'},
        {n:3,name:'Sensor return',short:'Return',kind:'ground',direction:'Circuit reference',signal:'sensors.sensor_return_v',unit:'V',description:'Ideal 0 V return shared with J-ECT.2. No physical Toyota connector cavity is identified by this label.',provenance:'Invented test-point mapping · ideal model reference'}]}
  };
  const color = {other:'#98a7ad', legacy:'#8f83a5', ground:'#6f7e88', bus:'#007f81', power:'#b86d29', signal:'#007f81'};
  function element(tag, cls, text) { const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node; }
  function svgElement(tag, attrs, text) {const node=document.createElementNS(NS,tag);Object.entries(attrs||{}).forEach(([k,v])=>node.setAttribute(k,String(v)));if(text!==undefined)node.textContent=text;return node;}
  function getValue(snapshot, path) {return path.split('.').reduce((obj,key)=>obj==null?undefined:obj[key],snapshot);}
  function valueText(pin, snapshot) {
    if(!pin.signal)return pin.modeled;
    const value=getValue(snapshot,pin.signal);
    if(value===undefined||value===null)return 'Waiting for simulation sample';
    return (typeof value==='number'?value.toFixed(3):String(value))+' '+(pin.unit||'');
  }
  function init(options) {
    const host=typeof options.container==='string'?document.querySelector(options.container):options.container;
    if(!host)throw new Error('ConnectorView needs a container element.');
    let current='dlc',selected=6,rear=false,state={};
    host.classList.add('con-workspace');host.replaceChildren();
    const top=element('div','con-toolbar');
    const selectLabel=element('label','con-select-label','Connector');
    const select=element('select','con-select');select.setAttribute('aria-label','Connector reference');
    Object.entries(definitions).forEach(([id,d])=>{const op=element('option','',d.title);op.value=id;select.append(op);});
    selectLabel.append(select);top.append(selectLabel);
    const face=element('button','con-face','Show rear / wire side');face.type='button';top.append(face);
    const save=element('button','con-save','Export connector SVG');save.type='button';top.append(save);host.append(top);
    const badge=element('div','con-badge');host.append(badge);
    const title=element('h3','con-title');const subtitle=element('p','con-subtitle');host.append(title,subtitle);
    const body=element('div','con-body');const drawing=element('div','con-drawing');const inspector=element('section','con-inspector');inspector.setAttribute('aria-label','Selected pin');body.append(drawing,inspector);host.append(body);
    const note=element('p','con-note');host.append(note);
    const tableWrap=element('div','con-table-wrap');host.append(tableWrap);
    const sources=element('p','con-sources');sources.append(document.createTextNode('Reference: '));
    for(const [index,entry] of [['Elm Electronics, Fig. 8 / Fig. 9',SOURCES.elm],['ScanTool protocol/pin guide',SOURCES.scan]].entries()){
      if(index)sources.append(document.createTextNode(' · '));const a=element('a','',entry[0]);a.href=entry[1];a.target='_blank';a.rel='noopener noreferrer';sources.append(a);
    }host.append(sources);
    let pinReadout, pinVoltageText, drawSvg, tableRows=[];
    function choosePin(n) {selected=n;renderInspector();updateHighlight();}
    function makePin(x,y,pin,small) {
      const group=svgElement('g',{class:'con-pin','data-pin':pin.n,role:'button',tabindex:0,'aria-label':`Pin ${pin.n}, ${pin.name}`});
      group.append(svgElement('rect',{x:x-21,y:y-18,width:42,height:36,rx:5,fill:'#f8faf9',stroke:color[pin.kind],'stroke-width':1.8}));
      group.append(svgElement('text',{x,y:y+5,'text-anchor':'middle','font-family':'system-ui,sans-serif','font-size':15,'font-weight':700,fill:'#163844'},pin.n));
      group.append(svgElement('text',{x,y:y+(small?36:42),'text-anchor':'middle','font-family':'system-ui,sans-serif','font-size':small?9.5:13,fill:'#536d77'},pin.short));
      group.addEventListener('click',()=>choosePin(pin.n));group.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();choosePin(pin.n);}});
      return group;
    }
    function renderDrawing() {
      const def=definitions[current];drawing.replaceChildren();
      drawSvg=svgElement('svg',{viewBox:'0 0 640 300',xmlns:NS,role:'group','aria-label':def.title+'; '+(rear?'rear wire-side view':def.view)});
      drawSvg.append(svgElement('rect',{width:640,height:300,fill:'#f7faf8'}));
      drawSvg.append(svgElement('text',{x:320,y:26,'text-anchor':'middle','font-family':'system-ui,sans-serif','font-size':12,fill:'#3e626e'},rear?'Rear / wire-side view of the same connector · mirrored':'Mating face / reference view · select a numbered cavity'));
      if(current==='dlc') {
        drawSvg.append(svgElement('path',{d:'M55 62 L585 62 L554 237 L86 237 Z',fill:'#e7efec',stroke:'#8fa6a9','stroke-width':2}));
        drawSvg.append(svgElement('path',{d:'M78 84 L562 84 L539 216 L101 216 Z',fill:'#fff',stroke:'#bdcdcc'}));
        drawSvg.append(svgElement('rect',{x:130,y:145,width:380,height:9,rx:3,fill:'#bacac7'}));
        def.pins.forEach(pin=>{let x=119+((pin.n-1)%8)*57.5;if(rear)x=640-x;drawSvg.append(makePin(x,pin.n<=8?111:182,pin,true));});
      } else {
        const count=def.pins.length,w=count===2?260:340,x0=(640-w)/2;
        drawSvg.append(svgElement('rect',{x:x0,y:65,width:w,height:172,rx:16,fill:'#e8efec',stroke:'#9bb2b5','stroke-width':2}));
        drawSvg.append(svgElement('rect',{x:280,y:55,width:80,height:20,rx:4,fill:'#c1d3ce',stroke:'#9bb2b5'}));
        def.pins.forEach((pin,i)=>{let x=320+(i-(count-1)/2)*100;if(rear)x=640-x;drawSvg.append(makePin(x,137,pin,false));});
        drawSvg.append(svgElement('text',{x:320,y:221,'text-anchor':'middle','font-family':'system-ui,sans-serif','font-size':11,fill:'#526e76'},'ILLUSTRATIVE PIN ASSIGNMENT'));
      }
      drawSvg.append(svgElement('text',{x:320,y:272,'text-anchor':'middle','font-family':'system-ui,sans-serif','font-size':11,fill:'#5b747d'},current==='dlc'?'Wide edge at top · vehicle socket numbering':'No Toyota connector part number or physical cavity is implied'));
      drawing.append(drawSvg);
      const view=element('p','con-view',rear?'Rear / wire-side view: left/right mirrored relative to the mating face.':def.view);drawing.append(view);updateHighlight();
    }
    function updateHighlight() {
      if(drawSvg)drawSvg.querySelectorAll('.con-pin').forEach(g=>{const active=Number(g.dataset.pin)===selected;g.setAttribute('aria-pressed',String(active));const rect=g.querySelector('rect');rect.setAttribute('fill',active?'#ccece3':'#f8faf9');rect.setAttribute('stroke-width',active?3:1.8);});
      for(const row of tableRows)row.element.classList.toggle('con-selected',row.pin.n===selected);
    }
    function renderInspector() {
      const pin=definitions[current].pins.find(p=>p.n===selected);inspector.replaceChildren();
      const ref=current==='dlc'?'DLC '+pin.n:(current==='j_ect'?'J-ECT.':'X1.')+pin.n;
      inspector.append(element('div','con-pin-ref',ref),element('h4','con-pin-name',pin.name));
      pinReadout=element('div','con-readout',valueText(pin,state));inspector.append(pinReadout);
      inspector.append(element('p','con-direction',pin.direction),element('p','con-description',pin.description),element('p','con-provenance',pin.provenance));
      if(pin.signal){
        const probe=element('button','con-probe','Add this signal to scope');probe.type='button';probe.addEventListener('click',()=>options.onProbe?.(pin.signal));inspector.append(probe);
        const signal=element('code','con-signal-id',pin.signal);inspector.append(signal);
        if((pin.n===1&&current==='j_ect')||(pin.n===2&&current==='x1')){
          pinVoltageText=element('p','con-live-note');inspector.append(pinVoltageText);
          const other=element('button','con-secondary','Probe ADC voltage instead');other.type='button';other.addEventListener('click',()=>options.onProbe?.('sensors.ect_voltage_v'));inspector.append(other);
        }else pinVoltageText=null;
      }else {pinVoltageText=null;inspector.append(element('p','con-live-note','No numerical scope channel is invented for an unmodeled electrical pin.'));}
      updateValues();
    }
    function renderTable() {
      tableWrap.replaceChildren();tableRows=[];
      const table=element('table','con-table');const caption=element('caption','','Pin mapping and modeled values');table.append(caption);
      const head=element('thead');const tr=element('tr');['Pin','Function','Direction / role','Model value or boundary'].forEach(s=>tr.append(element('th','',s)));head.append(tr);table.append(head);
      const tbody=element('tbody');definitions[current].pins.forEach(pin=>{const row=element('tr');const number=element('td');const b=element('button','con-pin-button',String(pin.n));b.type='button';b.setAttribute('aria-label',`Select pin ${pin.n}, ${pin.name}`);b.addEventListener('click',()=>choosePin(pin.n));number.append(b);const value=element('td','con-table-value',valueText(pin,state));row.append(number,element('td','',pin.name),element('td','',pin.direction),value);tbody.append(row);tableRows.push({element:row,value,pin});});table.append(tbody);tableWrap.append(table);updateHighlight();
    }
    function updateValues() {
      const pin=definitions[current].pins.find(p=>p.n===selected);
      if(pinReadout)pinReadout.textContent=valueText(pin,state);
      for(const row of tableRows)row.value.textContent=valueText(row.pin,state);
      if(pinVoltageText){const open=!!state.sensors?.ect_circuit_open;pinVoltageText.textContent=open?'Sensor path OPEN. Harness-side input is pulled toward the reference; current is zero.':'Sensor path connected. Physical node and ADC-reconstructed voltage can differ by quantization.';pinVoltageText.classList.toggle('con-open',open);}
    }
    function selectConnector(id) {
      if(!definitions[id])return;current=id;selected=id==='dlc'?6:id==='x1'?2:1;rear=false;select.value=id;
      const def=definitions[id];badge.textContent=def.badge;badge.classList.toggle('con-illustrative',id!=='dlc');title.textContent=def.title;subtitle.textContent=def.subtitle;note.textContent=def.note;face.textContent='Show rear / wire side';
      renderDrawing();renderTable();renderInspector();
    }
    function exportSvg() {
      // Preserve the explanatory boundary and actual snapshot values in an
      // offline export, including pins whose electrical layer is not modeled.
      const def=definitions[current], rowHeight=current==='dlc'?32:46;
      const top=426, tableBottom=top+29+def.pins.length*rowHeight;
      const height=tableBottom+(current==='dlc'?142:112);
      const out=svgElement('svg',{xmlns:NS,width:640,height,viewBox:`0 0 640 ${height}`,role:'img','aria-label':def.title});
      out.append(svgElement('title',{},def.title),svgElement('desc',{},def.subtitle+' '+def.note),svgElement('rect',{width:640,height,fill:'#f7faf8'}));
      const text=(x,y,value,size=11,fill='#45616c',weight=400)=>out.append(svgElement('text',{x,y,'font-family':'system-ui,sans-serif','font-size':size,'font-weight':weight,fill},value));
      const wrap=(value,max=104)=>{
        const lines=[];let line='';
        for(const word of String(value).split(/\s+/)){if(line&&line.length+word.length+1>max){lines.push(line);line=word;}else line+=(line?' ':'')+word;}
        if(line)lines.push(line);return lines;
      };
      text(24,30,def.title,20,'#173b46',650);
      text(24,51,def.badge,10,current==='dlc'?'#007f81':'#a06427',650);
      text(24,71,def.subtitle,11);
      const stamp=typeof state.t==='number'?`Simulation snapshot: ${state.t.toFixed(2)} s · ${state.profile||'model'} · ${state.scenario||'manual'}`:'No simulation snapshot loaded';
      text(24,90,stamp,10,'#6a7f87');
      const drawingCopy=drawSvg.cloneNode(true);
      drawingCopy.setAttribute('x','0');drawingCopy.setAttribute('y','104');drawingCopy.setAttribute('width','640');drawingCopy.setAttribute('height','300');
      const drawingTexts=drawingCopy.querySelectorAll('text');
      if(drawingTexts.length)drawingTexts[0].textContent=rear?'Rear / wire-side view · mirrored from the mating face':def.view;
      out.append(drawingCopy);
      text(24,top,'Pin assignment and modeled values',14,'#173b46',650);
      text(24,top+21,'PIN',9,'#72878e',650);text(65,top+21,'FUNCTION',9,'#72878e',650);text(333,top+21,'SNAPSHOT VALUE / MODEL BOUNDARY',9,'#72878e',650);
      def.pins.forEach((pin,index)=>{
        const y=top+29+index*rowHeight;
        out.append(svgElement('line',{x1:24,y1:y,x2:616,y2:y,stroke:'#d8e5df'}));
        text(24,y+20,String(pin.n),11,'#173b46',650);text(65,y+20,pin.name,10.5,'#2d505c');
        text(333,y+20,valueText(pin,state),pin.signal?12:10,pin.signal?'#007f81':'#526c76',pin.signal?600:400);
        if(pin.signal)text(333,y+35,pin.signal,8.5,'#6a7f87');
      });
      out.append(svgElement('line',{x1:24,y1:tableBottom,x2:616,y2:tableBottom,stroke:'#d8e5df'}));
      wrap(def.note).forEach((line,index)=>text(24,tableBottom+23+index*15,line,10));
      if(current==='dlc'){
        text(24,tableBottom+80,'References for connector roles:',9,'#6a7f87');
        text(24,tableBottom+95,SOURCES.elm,9,'#007f81');
        text(24,tableBottom+110,SOURCES.scan,9,'#007f81');
      }else{
        text(24,tableBottom+77,state.sensors?.ect_circuit_open?'Snapshot circuit state: sensor path OPEN.':'Snapshot circuit state: sensor path connected.',10,'#6a7f87');
        text(24,tableBottom+94,'Values belong to the teaching model; this is not a physical Toyota connector specification.',9,'#6a7f87');
      }
      out.append(svgElement('metadata',{},JSON.stringify({connector:current,rear,selected,simulation_time_s:state.t,profile:state.profile,scenario:state.scenario})));
      return '<?xml version="1.0" encoding="UTF-8"?>\n'+new XMLSerializer().serializeToString(out);
    }
    select.addEventListener('change',()=>selectConnector(select.value));face.addEventListener('click',()=>{rear=!rear;face.textContent=rear?'Show mating face':'Show rear / wire side';renderDrawing();});
    save.addEventListener('click',()=>{const url=URL.createObjectURL(new Blob([exportSvg()],{type:'image/svg+xml'}));const a=document.createElement('a');a.href=url;a.download=`obdii_${current}_${rear?'rear':'face'}.svg`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
    selectConnector(current);
    return {setState(snapshot){state=snapshot||{};updateValues();},selectConnector,exportSvg};
  }
  window.ConnectorView={init,definitions};
})();
