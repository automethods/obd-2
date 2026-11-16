/* Human-readable explanations of the recorded teaching diagnostic exchange. */
(() => {
  'use strict';
  const esc=window.AppModel.escape;
  const bytes=text=>String(text||'').trim().split(/\s+/).filter(x=>/^[0-9a-f]{2}$/i.test(x)).map(x=>parseInt(x,16));
  const hex=value=>Number(value).toString(16).toUpperCase().padStart(2,'0');
  const PIDS={1:['Warning lamp and emissions-monitor status','Lamp on/off, number of stored codes and monitor flags'],4:['Calculated engine load','0–100%'],5:['Engine coolant temperature','Degrees Celsius; one byte minus 40'],12:['Engine speed','Revolutions per minute'],13:['Vehicle speed','Kilometres per hour'],15:['Intake air temperature','Degrees Celsius'],16:['Mass air flow','Grams per second'],17:['Throttle position','0–100%'],32:['Further supported parameters','Capability map for the next block']};
  const negativeReasons={0x11:'This service is not supported by this ECU.',0x12:'This subfunction is not supported.',0x13:'The request has the wrong length or format.',0x22:'The ECU cannot perform this request in its current conditions.',0x31:'The requested identifier or parameter is outside the supported range.',0x7E:'This subfunction is not available in the current diagnostic session.',0x7F:'This service is not available in the current diagnostic session.'};
  function address(id){
    const number=parseInt(String(id||'').replace(/^0x/i,''),16);
    const meanings={0x7DF:'Functional OBD request: asks the emissions controllers that support this question.',0x7E0:'Physical request: addresses the engine ECU in this training vehicle.',0x7E8:'Engine ECU response: the reply identifier used by this training vehicle.'};
    return {number,hex:Number.isFinite(number)?number.toString(16).toUpperCase():'—',meaning:meanings[number]||'CAN message identifier for this recorded frame; its meaning requires the network definition.'};
  }
  function question(request){const b=bytes(request);if(!b.length)return 'No request recorded.';
    if(b[0]===1){if(b[1]===0)return 'Which current-data parameters can this ECU report?';return 'Read '+(PIDS[b[1]]?.[0].toLowerCase()||'parameter '+b[1])+'.';}
    if(b[0]===3)return 'Which emissions fault codes are stored?';if(b[0]===7)return 'Which emissions faults are pending confirmation?';
    if(b[0]===4)return 'Clear the stored emissions fault memory.';if(b[0]===9&&b[1]===2)return 'What is the vehicle identification number?';
    if(b[0]===0x10)return 'Enter the '+(b[1]===3?'extended':'default')+' diagnostic session.';
    if(b[0]===0x3E)return 'Keep the diagnostic session active.';if(b[0]===0x22)return 'Read the specified ECU identification item.';
    return 'Custom service request. Read the decoded response and service definition.';
  }
  function pidMask(response){const b=bytes(response);if(b[0]!==0x41||b[1]!==0||b.length<6)return '';
    const entries=[];for(let pid=1;pid<=32;pid++){const index=Math.floor((pid-1)/8),bit=7-(pid-1)%8,supported=!!(b[2+index]&(1<<bit));entries.push({pid,supported});}
    return `<section class="mi-capabilities"><h4>What this ECU can report</h4><p>This reply is a capability list. A <b>1</b> bit means the parameter is supported; <b>0</b> means it is not supported in this configuration. It does not say whether a sensor is healthy.</p><table><thead><tr><th>Parameter</th><th>PID · decimal / hex</th><th>Meaning</th></tr></thead><tbody>${entries.filter(p=>p.supported).map(p=>`<tr><td>${esc(PIDS[p.pid]?.[0]||'Parameter '+p.pid)}</td><td>${p.pid} / 0x${hex(p.pid)}</td><td>${esc(PIDS[p.pid]?.[1]||'See its definition')}</td></tr>`).join('')}</tbody></table><details><summary>Show all 32 capability bits</summary><div class="mi-bit-grid">${entries.map(p=>`<span class="${p.supported?'supported':''}" title="PID ${p.pid} (0x${hex(p.pid)}): ${p.supported?'supported':'not supported'}"><small>PID ${p.pid}</small><b>${p.supported?1:0}</b></span>`).join('')}</div></details></section>`;
  }
  function outcome(d){const b=bytes(d.response_hex),decoded=window.ProtocolsView.decodeResponse(d);
    if(!b.length)return {label:d.error?'Request error':'No reply',detail:d.error||d.meaning||'The scan tool received no reply. An absent reply is different from a sensor value of zero.'};
    if(b[0]===0x7F)return {label:'Request refused',detail:'The ECU replied, but did not complete the request. Reason '+b[2]+' (0x'+hex(b[2])+'): '+(negativeReasons[b[2]]||d.meaning||'See the service definition.')};
    if(b[0]===0x41&&b[1]===0&&b.length>=6){const count=b.slice(2,6).reduce((sum,value)=>sum+value.toString(2).replaceAll('0','').length,0);return {label:'Positive reply',detail:count+' current-data parameters are supported in PID range 1–32 (0x01–0x20). Their names are listed below.'};}
    return {label:'Positive reply',detail:decoded.value===null?(d.meaning||'The ECU accepted the request.'):(decoded.title+': '+decoded.value+(decoded.unit?' '+decoded.unit:''))};
  }
  function applicationMeaning(value,index,request,d){
    if(index===0){if(request)return ({1:'Service 1: read current emissions-related data.',3:'Service 3: read stored fault codes.',4:'Service 4: clear emissions fault memory.',7:'Service 7: read pending fault codes.',9:'Service 9: vehicle information.',16:'UDS diagnostic session control.',34:'UDS read data by identifier.',62:'UDS tester present.'})[value]||'Diagnostic request service.';
      if(value===0x7F)return 'Negative response: the ECU is returning a reason for refusal.';
      return 'Positive response service. In these services, request service + 64 (0x40) identifies a successful reply.';
    }
    const app=bytes(request?d.request_hex:d.response_hex);
    if((app[0]===1||app[0]===0x41)&&index===1)return value===0?'PID 0: asks for / identifies the supported-parameter list.':'Parameter '+value+' (PID): '+(PIDS[value]?.[0]||'see service definition')+'.';
    if(app[0]===0x41&&app[1]===0&&index>=2)return 'Capability flags. Each of the eight bits describes one supported PID; expand the named list below.';
    if(app[0]===0x7F&&index===1)return 'The service that was refused.';
    if(app[0]===0x7F&&index===2)return negativeReasons[value]||'Negative-response reason code.';
    if(app[0]===0x41&&app[1]===1&&index===2)return 'Bit 7 is the check-engine lamp: '+((value&128)?'on':'off')+'. Remaining seven bits report '+(value&127)+' stored code(s).';
    const decoded=window.ProtocolsView.decodeResponse(d);return !request&&decoded.fields[index]?decoded.fields[index].label+'. See the result calculation below.':'Service parameter or encoded data; interpreted by the selected diagnostic service.';
  }
  function render(record){const d=record.diagnostic,frame=record.frame,out=outcome(d),decoded=window.ProtocolsView.decodeResponse(d);
    const request=frame&&String(frame.direction).toLowerCase().startsWith('tester'),a=address(frame?.id),b=bytes(frame?.data),info=frame?window.ProtocolsView.inspectFrame(frame,record.index,d.frames):null;
    const offset=info?.type==='SF'?1:info?.type==='FF'?2:null;
    const rows=b.map((value,i)=>{let role=info.roles[i]?.role||'Data',detail='';
      if(info.roles[i]?.tone==='padding')detail='Unused space in this CAN frame. This zero is not a sensor reading.';
      else if(offset!==null&&i>=offset){role='Application byte '+(i-offset);detail=applicationMeaning(value,i-offset,request,d);}
      else if(info.type==='SF')detail='A single CAN frame contains the message. The low four bits specify '+(value&15)+' application bytes after this header.';
      else if(info.type==='FF')detail='Start of a longer message. The first two bytes together specify '+info.length+' application bytes.';
      else if(info.type==='CF'&&i===0)detail='Fragment number '+(value&15)+'. ISO-TP uses this to put the reply back in order.';
      else if(info.type==='FC')detail=i===0?'Flow-control status: 0 = continue, 1 = wait, 2 = overflow.':i===1?(value===0?'No additional block pauses requested.':'Send '+value+' consecutive frames before the next permission.'):'Minimum frame spacing requested by the receiver; encoded transport timing.';
      else detail='Part of a longer application message; read the reassembled result below.';
      return `<tr><td>${i}</td><td><code>0x${hex(value)}</code></td><td><b>${value}</b></td><td><strong>${esc(role)}</strong><p>${esc(detail)}</p></td></tr>`;});
    return `<div class="mi-heading"><div><small>${request?'SCAN TOOL → ECU':frame?'ECU → SCAN TOOL':'NO DELIVERED FRAME'}</small><h4>${esc(info?.title||out.label)} <span>· ${Number(record.t).toFixed(2)} s</span></h4></div><span class="mi-status">${esc(out.label)}</span></div><p class="mi-question"><strong>Question:</strong> ${esc(question(d.request_hex))}</p>${frame?`<div class="mi-address"><strong>CAN ID 0x${a.hex} <span>= ${a.number} decimal</span></strong><p>${esc(a.meaning)}</p><small>This is a message identifier on the CAN network. The diagnostic service is inside the data bytes.</small></div><details class="mi-byte-detail" open><summary>Read the bytes · hexadecimal and decimal</summary><table><thead><tr><th>Byte</th><th>Hex</th><th>Decimal</th><th>Purpose in this message</th></tr></thead><tbody>${rows.join('')}</tbody></table></details>`:''}<section class="mi-result"><h4>Reply in ordinary words</h4><p>${esc(out.detail)}</p>${decoded.formula?`<p><b>How the value is calculated:</b> ${esc(decoded.formula)}</p><p class="message-formula">${esc(decoded.calculation)}</p>`:''}<p class="mi-note">${esc(decoded.note||'')}</p></section>${pidMask(d.response_hex)}<details class="mi-raw"><summary>Request, complete reply & possible outcomes</summary><p><strong>Request:</strong> <code>${esc(d.request_hex||'—')}</code><br><strong>Reply:</strong> <code>${esc(d.response_hex||'No reply')}</code></p><ul><li><b>Positive reply:</b> the ECU accepted the service and returned data or confirmation.</li><li><b>Negative reply:</b> the ECU returned 0x7F (127), the refused service and a reason code.</li><li><b>No reply:</b> nothing was received; inspect ignition, connection, bitrate and the selected unit.</li></ul><p>Values shown here are recorded at the displayed simulation time. A new request reads the next sample.</p></details>`;
  }
  window.MessageInspector={render,address,question,pidMask,outcome};
})();
