'use strict';
const $ = id => document.getElementById(id);
let meta, state, history = [], running = false, busy = false, finishing = false, socChanged = false, traceLines = [], faultOverride = null, readerOverrides = {}, lastResult = null;
const tips = {
  engine_warmup: 'Start with one ECU and one plant. The engine responds to the accelerator, airflow changes, and coolant warms through a heat balance. Read PID 0C for rpm, then PID 05 for the sensed coolant temperature. A 120-second lesson is not a full emissions drive cycle.',
  ect_open: 'The true coolant temperature and the sensor reading diverge. With an open circuit, this teaching sensor reports −40 °C; the controller detects the fault and uses a fallback. Request 03 and 07. Clear with 04, advance again, and see why a present fault returns.',
  phev_city: 'Follow the supervisor as it allocates propulsion between the engine and motor. Positive battery current discharges the pack; negative current charges it. When braking, regen is limited by battery acceptance, speed and grip. Friction braking supplies the remainder.',
  low_soc: 'A low state of charge changes the supervisory decision. The engine is requested to preserve energy reserves. Compare engine activity and battery current with the normal city lesson. This is a generic parallel-hybrid strategy, not Toyota control software.',
  abs_split_mu: 'The left and right sides have different grip. Compare the wheel peripheral speeds to vehicle speed and watch slip. Reset with ABS disabled for a controlled comparison. The yaw-assist model is intentionally simplified; this is not a validated handling simulation.',
  regen_limit: 'A nearly full battery cannot accept normal charging power. The brake controller must reduce regeneration and use friction brakes. Compare the power terms with the normal city lesson; the requested deceleration must still have a physical source.',
  bmu_timeout: 'A stale battery-controller message is different from a healthy measurement. When the freshness deadline is missed, the supervisor inhibits electric torque. Observe the module state and contactor response. Generic Mode 03 does not report this synthetic network fault.',
  cell_low: 'A low-cell-voltage fault reduces or removes battery power permission. The plant, battery monitor and supervisor must agree on the resulting torque restriction. This lesson models detection and protection, not electrochemical cell damage.',
  manual: 'Use the accelerator and brake to explore the loop. Try a coolant-sensor fault on the engine stand, or a low-grip brake event with the braking profile. Inputs persist until you change them. Reset creates a new deterministic experiment.'
};
const controls = ['ignition','throttle','brake','road-mu','steer','grade','fault'];
function error(message){$('toast').textContent=message;$('toast').hidden=false;setTimeout(()=>$('toast').hidden=true,7000);}
async function api(path, body){
  const response=await fetch('/api/'+path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data=await response.json();if(!response.ok||data.error)throw new Error(data.error||'The local server could not complete this request.');return data;
}
function n(value,digits=1){return Number(value??0).toFixed(digits);}
function isManual(){return $('lesson').value==='manual';}
function selection(){return isManual()?undefined:meta.scenarios.find(s=>s.id===$('lesson').value);}
function setRunning(value){running=value;$('run').textContent=running?'Ⅱ Pause':'▶ Run';$('run-status').textContent=running?'RUNNING':'PAUSED';window.dispatchEvent(new CustomEvent('lab:play',{detail:{running}}));}
function inputs(){
  const out={abs_enabled:$('abs-enabled').checked};
  if(isManual())Object.assign(out,{ignition:$('ignition').checked,throttle:+$('throttle').value/100,brake:+$('brake').value/100,road_mu:+$('road-mu').value,steer_deg:+$('steer').value,grade_pct:+$('grade').value,fault:$('fault').value});
  if(faultOverride!==null)out.fault=faultOverride;
  return Object.assign(out,readerOverrides);
}
function syncLabels(){[['throttle','%'],['brake','%'],['steer','°'],['grade','%']].forEach(([id,unit])=>$(id+'-out').textContent=$(id).value+unit);$('road-mu-out').textContent=n($('road-mu').value,2);}
function setupLesson(){
  const manual=isManual(), info=selection();$('manual-profile-wrap').hidden=!manual;
  document.querySelector('.sidebar').classList.toggle('manual',manual);
  $('lesson-description').textContent=info?info.description:'A free experiment with adjustable driver inputs, environment and faults.';
  $('insight').textContent=tips[$('lesson').value]||tips.manual;
  controls.forEach(id=>$(id).disabled=!manual);$('finish').disabled=manual;
  $('control-note').textContent=manual?'Adjust a control, then run or step the simulation.':'Scripted controls are shown live. Choose Manual to change them.';
}
async function reset(options={}){
  if(finishing)return;setRunning(false);while(busy)await new Promise(resolve=>setTimeout(resolve,20));busy=true;
  try{faultOverride=null;readerOverrides={};setupLesson();const info=selection();const config=options.config||(socChanged?{initial_soc_pct:+$('initial-soc').value}:{});
    const result=await api('reset',{profile:info?info.profile:$('profile').value,scenario:$('lesson').value,config});history=[];traceLines=[];window.dispatchEvent(new CustomEvent('lab:reset',{detail:{profile:result.state.profile}}));$('trace').textContent='No requests sent yet.';$('decoded').textContent='Try 01 0C: request current engine speed.';$('signal').value=result.state.profile==='engine'?'rpm':'speed_kph';apply(result);if(!socChanged)$('initial-soc').value=n(state.soc_pct,0);return state;
  }catch(e){error(e.message);}finally{busy=false;}
}
function appendHistory(points){for(const point of points||[])if(!history.length||point.t>history[history.length-1].t)history.push(point);if(history.length>20000)history.splice(0,history.length-20000);}
function apply(result){lastResult=result;if(result.state){state=result.state;render();}appendHistory(result.history);if(result.events)renderEvents(result.events);draw();window.dispatchEvent(new CustomEvent('lab:state',{detail:result}));}
async function advance(seconds){
  if(busy)return;busy=true;
  try{const info=selection();if(info)seconds=Math.min(seconds,Math.max(0,info.duration-(state?.t||0)));if(seconds<.001){setRunning(false);return;}apply(await api('advance',{seconds,inputs:inputs()}));if(info&&state.t>=info.duration-.001)setRunning(false);return state;
  }catch(e){setRunning(false);error(e.message);}finally{busy=false;}
}
function render(){
  const vehicleInstalled=state.profile!=='engine';
  $('clock').innerHTML=n(state.t,2)+' <small>s</small>';$('rpm').textContent=n(state.rpm,0);$('speed-kph').textContent=n(state.speed_kph);$('soc').textContent=vehicleInstalled?n(state.soc_pct):'—';$('coolant').textContent=n(state.coolant_c);$('mode').textContent=state.mode;
  $('engine-note').textContent=state.profile==='engine'?'Engine stand / no road load':'Engine ECU / generic hybrid';
  $('battery-note').textContent=state.profile==='engine'?'Battery plant inactive':'Contactor '+state.contactor;
  $('ect-note').textContent='Sensed '+n(state.sensors?.ect_c??state.coolant_c)+' °C';
  [['engine-power','engine_shaft_kw'],['motor-power','motor_power_kw'],['battery-power','battery_power_kw'],['regen-power','regen_kw'],['friction-power','friction_brake_kw']].forEach(([id,key])=>$(id).textContent=n(state[key]));
  $('voltage').textContent=vehicleInstalled?n(state.battery_voltage_v)+' V':'— V';$('current').textContent=vehicleInstalled?n(state.battery_current_a)+' A':'— A';$('temperature').textContent=vehicleInstalled?n(state.battery_temp_c)+' °C':'— °C';$('contactor').textContent=vehicleInstalled?String(state.contactor).toUpperCase():'NOT INSTALLED';
  if(!vehicleInstalled)['motor-power','battery-power','regen-power','friction-power'].forEach(id=>$(id).textContent='—');
  for(const option of $('signal').options)option.disabled=!vehicleInstalled&&!['rpm','coolant_c'].includes(option.value);
  if($('signal').selectedOptions[0]?.disabled)$('signal').value='rpm';
  const modules=state.module_status||{};$('modules').replaceChildren();
  for(const [key,raw] of Object.entries(modules)){const value=typeof raw==='object'?JSON.stringify(raw):String(raw);const row=document.createElement('div');row.className='module';const lamp=document.createElement('span');lamp.className='lamp '+(/fault|lost|timeout|inhibit|low.cell/i.test(value)?'bad':/off|standby|inactive|not/i.test(value)?'':'ok');const b=document.createElement('b');b.textContent=key;const text=document.createElement('span');text.className='module-value';text.textContent=value;row.append(lamp,b,text);$('modules').append(row);}
  const dtcs=state.dtcs||[], pending=state.pending_dtcs||[];const moduleFaults=Object.values(state.module_dtc||{}).flat().filter(Boolean);const hasFault=dtcs.length||pending.length||moduleFaults.length;
  $('fault-state').classList.toggle('warn',!!hasFault);$('fault-state').textContent=(state.mil?'MIL on. ':'')+(dtcs.length?'Stored: '+dtcs.join(', ')+'. ':pending.length?'Pending: '+pending.join(', ')+'. ':'No emissions DTCs stored. ')+(moduleFaults.length?'Module faults: '+moduleFaults.join(', '):'');
  for(const [id,key,label] of [['abs-chip','abs_active','ABS'],['esp-chip','esp_active','ESC']]){$(id).classList.toggle('active',!!state[key]);$(id).textContent=label+(!vehicleInstalled?' not installed':state[key]?' active':' idle');}
  $('wheels').replaceChildren();['FRONT LEFT','FRONT RIGHT','REAR LEFT','REAR RIGHT'].forEach((label,i)=>{const slip=state.slips?.[i]||0;const div=document.createElement('div');div.className='wheel';div.innerHTML='<div class="wheel-title">'+label+'</div><strong>'+(vehicleInstalled?n(state.wheel_speeds_kph?.[i]):'—')+' <small>km/h</small></strong><small>'+(!vehicleInstalled?'not installed':'slip '+n(slip*100,1)+'%')+'</small><div class="slip-track"><span style="width:'+Math.min(100,Math.abs(slip)*100)+'%;background:'+(Math.abs(slip)>.3?'#d48a38':'#008889')+'"></span></div>';$('wheels').append(div);});
  if(!isManual()&&state.inputs){const v=state.inputs;$('throttle').value=(v.throttle||0)*100;$('brake').value=(v.brake||0)*100;$('road-mu').value=v.road_mu??.8;$('steer').value=v.steer_deg||0;$('grade').value=v.grade_pct||0;$('ignition').checked=!!v.ignition;$('fault').value=v.fault||'none';syncLabels();}
  $('sensors').replaceChildren();for(const [key,value] of Object.entries(state.sensors||{})){const row=document.createElement('div');row.className='sensor-row';const k=document.createElement('span');k.textContent=key;const v=document.createElement('span');v.textContent=typeof value==='number'?n(value,3):Array.isArray(value)?value.map(x=>typeof x==='number'?n(x,2):x).join(', '):String(value);row.append(k,v);$('sensors').append(row);}
}
function renderEvents(events){$('events').replaceChildren();if(!events.length){const p=document.createElement('p');p.className='muted';p.textContent='Events appear as the simulation advances.';$('events').append(p);}for(const event of events.slice().reverse()){const row=document.createElement('div');row.className='event';const time=document.createElement('time');time.textContent=n(event.t,1)+'s';const content=document.createElement('span');const source=document.createElement('strong');source.textContent=(event.source||event.module||'System')+' · ';content.append(source,document.createTextNode(event.message||event.event||''));row.append(time,content);$('events').append(row);}}
function draw(){
  const canvas=$('chart'),rect=canvas.getBoundingClientRect();if(!rect.width)return;const dpr=window.devicePixelRatio||1;canvas.width=rect.width*dpr;canvas.height=rect.height*dpr;const c=canvas.getContext('2d');c.scale(dpr,dpr);const w=rect.width,h=rect.height,left=49,top=15,right=15,bottom=29,pw=w-left-right,ph=h-top-bottom;
  const key=$('signal').value;const val=p=>key==='slip_fl'?(p.slips?.[0]||0):Number(p[key]||0);const end=history.length?history[history.length-1].t:10;const start=Math.max(0,end-60),finish=Math.max(start+10,end);const points=history.filter(p=>p.t>=start);$('chart-empty').hidden=points.length>1;
  let values=points.map(val);if(key==='yaw_rate_deg_s')values=values.concat(points.map(p=>p.yaw_target_deg_s||0));let min=Math.min(0,...values),max=Math.max(...values,1);if(key==='soc_pct'){min=0;max=100;}else if(key==='rpm'){max=Math.max(max,1000);}else if(key==='coolant_c'){max=Math.max(max,100);}else if(key==='slip_fl'){min=Math.min(min,-.1);max=Math.max(max,1);}const pad=(max-min)*.08;if(key!=='soc_pct'){min-=min<0?pad:0;max+=pad;}
  const x=t=>left+(t-start)/(finish-start)*pw,y=v=>top+(max-v)/(max-min)*ph;c.lineWidth=1;c.font='10px ui-monospace,monospace';c.fillStyle='#7b8c92';c.textAlign='right';
  for(let i=0;i<=4;i++){const v=min+(max-min)*i/4,py=y(v);c.strokeStyle='#e7edeb';c.beginPath();c.moveTo(left,py);c.lineTo(w-right,py);c.stroke();c.fillText(Math.abs(max-min)<5?v.toFixed(2):v.toFixed(0),left-10,py+3);}
  c.textAlign='center';for(let i=0;i<=5;i++){const t=start+(finish-start)*i/5;c.fillText(t.toFixed(t<10?1:0),x(t),h-7);}
  if(points.length>1){c.beginPath();c.moveTo(x(points[0].t),y(val(points[0])));for(const p of points)c.lineTo(x(p.t),y(val(p)));c.lineTo(x(points[points.length-1].t),top+ph);c.lineTo(x(points[0].t),top+ph);c.closePath();const grad=c.createLinearGradient(0,top,0,top+ph);grad.addColorStop(0,'#00888b25');grad.addColorStop(1,'#00888b02');c.fillStyle=grad;c.fill();c.beginPath();points.forEach((p,i)=>i?c.lineTo(x(p.t),y(val(p))):c.moveTo(x(p.t),y(val(p))));c.lineWidth=2;c.strokeStyle='#00888b';c.stroke();if(key==='yaw_rate_deg_s'){c.beginPath();c.setLineDash([4,4]);points.forEach((p,i)=>i?c.lineTo(x(p.t),y(p.yaw_target_deg_s||0)):c.moveTo(x(p.t),y(p.yaw_target_deg_s||0)));c.strokeStyle='#9eabb1';c.stroke();c.setLineDash([]);}}
  document.querySelector('.legend-ref').style.display=key==='yaw_rate_deg_s'?'inline':'none';$('chart-range').textContent='SIMULATION TIME / s'+(start>0?' · last 60 s':'');
}
async function diagnostic(payload,canId){
  if(finishing){error('Wait for Finish lesson to complete before sending a scan request.');return;}
  while(busy)await new Promise(resolve=>setTimeout(resolve,20));busy=true;
  try{const result=await api('diagnostic',{payload:payload||$('payload').value,can_id:canId||$('can-id').value});const d={...result.diagnostic,diagnostic_explanation:result.diagnostic_explanation,sample_t:result.state?.t};$('decoded').textContent=d.error||d.meaning||'No response';const lines=['> '+d.request_hex+'  →  '+(d.response_hex||'[silence]')];for(const f of d.frames||[])lines.push(f.direction.padEnd(14)+' '+f.id+'   '+f.data+'   '+f.label);traceLines.push(...lines,'');traceLines=traceLines.slice(-120);$('trace').textContent=traceLines.join('\n');$('trace').scrollTop=$('trace').scrollHeight;apply(result);window.dispatchEvent(new CustomEvent('lab:diagnostic',{detail:{diagnostic:d,lines}}));return d;}catch(e){error(e.message);}finally{busy=false;}
}
$('run').onclick=()=>setRunning(!running);$('step').onclick=()=>{setRunning(false);advance(1);};$('reset').onclick=()=>reset();
$('lesson').onchange=()=>{socChanged=false;reset();};$('profile').onchange=()=>reset();$('initial-soc').oninput=()=>socChanged=true;
$('fault').addEventListener('change',()=>{faultOverride=null;delete readerOverrides.fault;});
const inputKeys={'ignition':'ignition','throttle':'throttle','brake':'brake','road-mu':'road_mu','steer':'steer_deg','grade':'grade_pct','abs-enabled':'abs_enabled'};
for(const [id,key] of Object.entries(inputKeys))$(id).addEventListener('input',()=>delete readerOverrides[key]);
$('signal').onchange=draw;controls.forEach(id=>$(id).addEventListener('input',syncLabels));
$('send').onclick=()=>diagnostic();$('payload').onkeydown=e=>{if(e.key==='Enter')diagnostic();};document.querySelectorAll('[data-payload]').forEach(b=>b.onclick=()=>{$('payload').value=b.dataset.payload;diagnostic(b.dataset.payload);});
$('finish').onclick=async()=>{if(busy||finishing)return;setRunning(false);finishing=true;$('finish').textContent='Running…';$('run').disabled=true;$('step').disabled=true;$('lesson').disabled=true;try{const info=selection();while(info&&state.t<info.duration-.001){const before=state.t;await advance(Math.min(5,info.duration-state.t));if(state.t<=before)break;await new Promise(resolve=>setTimeout(resolve,0));}}finally{finishing=false;$('finish').textContent='Finish lesson →';$('run').disabled=false;$('step').disabled=false;$('lesson').disabled=false;}};
window.LabUI={
  state:()=>state,meta:()=>meta,result:()=>lastResult,draw,diagnostic,
  play:()=>setRunning(true),isRunning:()=>running,
  connection:async(id,connected)=>{while(busy||finishing)await new Promise(resolve=>setTimeout(resolve,20));busy=true;try{const result=await api('connection',{id,connected});apply(result);return result;}catch(e){error(e.message);throw e;}finally{busy=false;}},
  isBusy:()=>busy||finishing,
  pause:async()=>{setRunning(false);while(busy)await new Promise(resolve=>setTimeout(resolve,20));},
  advance,
  setFault:value=>{faultOverride=value;readerOverrides.fault=value;$('fault').value=value;},
  setInputs:values=>{Object.assign(readerOverrides,values);for(const [key,value] of Object.entries(values)){const id=Object.keys(inputKeys).find(id=>inputKeys[id]===key);if(id){if(['ignition','abs-enabled'].includes(id))$(id).checked=!!value;else $(id).value=['throttle','brake'].includes(id)?Number(value)*100:value;}if(key==='fault'){faultOverride=value;$('fault').value=value;}}syncLabels();},
  loadExperiment:async(definition={})=>{if(finishing)throw new Error('Wait for the current lesson to finish.');await window.LabUI.pause();const scenario=definition.scenario||'manual';if(!meta.scenarios.some(s=>s.id===scenario))throw new Error('Unknown experiment.');$('lesson').value=scenario;$('profile').value=definition.profile||'engine';socChanged=false;const ok=await reset({config:definition.config||{}});if(!ok)throw new Error('Could not start this experiment.');window.LabUI.setInputs(scenario==='manual'?Object.assign({ignition:true,throttle:.12,brake:0,road_mu:.8,steer_deg:0,grade_pct:0,fault:'none',abs_enabled:true},definition.inputs||{}):(definition.inputs||{}));await advance(.1);return state;},
  baseline:async()=>{if(finishing)throw new Error('Wait for Finish lesson to complete.');$('lesson').value='manual';$('profile').value='engine';socChanged=false;$('ignition').checked=true;$('throttle').value=12;$('brake').value=0;$('fault').value='none';$('road-mu').value=.8;$('steer').value=0;$('grade').value=0;syncLabels();const ok=await reset({config:{initial_coolant_c:25,ambient_c:25}});if(!ok)throw new Error('Could not reset the task.');await advance(1);return state;},
  report:error
};
window.addEventListener('resize',draw);
setInterval(()=>{if(running&&!busy&&!finishing)advance(.1*+$('speed').value);},100);
(async()=>{try{meta=await api('meta');window.dispatchEvent(new CustomEvent('lab:ready',{detail:meta}));for(const s of meta.scenarios){if(s.id==='manual')continue;const option=document.createElement('option');option.value=s.id;option.textContent=s.title;$('lesson').append(option);}const manual=document.createElement('option');manual.value='manual';manual.textContent='Manual experiment';$('lesson').append(manual);$('lesson').value='engine_warmup';setupLesson();$('signal').value='rpm';apply(await api('state'));syncLabels();}catch(e){error('Cannot reach the local lab. Start it with: python3 run.py --serve. '+e.message);}})();
