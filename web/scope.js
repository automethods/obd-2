/* Read-only multichannel scope. It uses the same 100 ms records as the exports. */
(() => {
  'use strict';
  const colors = ['#00858a','#d2772a','#7861b1','#3b8f60','#2e6fb0','#a74771'];
  const valueAt = (object,id) => id.split('.').reduce((v,k)=>v==null?undefined:v[k],object);
  const number = value => typeof value==='boolean' ? Number(value) : typeof value==='number'&&Number.isFinite(value)?value:null;
  const fmt = value => value==null?'—':typeof value==='boolean'?(value?'1':'0'):Math.abs(value)>=1000?value.toFixed(0):Math.abs(value)>=100?value.toFixed(1):value.toFixed(3).replace(/\.?0+$/,'');
  function validity(p,id,metadata) {
    const s=p.sensors||{},v=valueAt(p,id);
    if(metadata.profiles&&!metadata.profiles.includes(p.profile))return 'unavailable';
    if(id==='sensors.ect_resistance_ohm'&&s.ect_circuit_open)return 'invalid';
    if(['sensors.ect_c','sensors.ect_adc_count','sensors.ect_used_c'].includes(id)) {
      if(!(s.ect_powered??p.inputs?.ignition))return 'unavailable';
      if(id==='sensors.ect_used_c'&&p.ect_derate_factor<1)return 'substituted';
      if(s.ect_sensor_valid===false)return 'invalid';
    }
    if(id.startsWith('sensors.wheel_speeds_kph.')&&v==null)return 'invalid';
    if(v==null)return 'unavailable';
    if(id.startsWith('bmu_report.')&&s.bmu_message_age_ms>300.0001)return 'stale';
    return 'valid';
  }
  function init({container,catalog}) {
    const metadata=new Map(catalog.map(s=>[s.id,s]));
    let selected=[],points=[],live={},seconds=15,cursor=null,events=[];
    const rows=new Map();
    const hint=document.createElement('div');hint.className='scope-hint';
    function emitFile(filename,text,mime) {
      const a=document.createElement('a'),url=URL.createObjectURL(new Blob([text],{type:mime}));
      a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }
    function renderRows() {
      container.replaceChildren();rows.clear();
      if(!selected.length){const empty=document.createElement('div');empty.className='scope-empty';empty.textContent='Click a schematic wire and choose Add to scope, or select a channel above.';container.append(empty);}
      selected.forEach((id,index)=>{
        const m=metadata.get(id),row=document.createElement('div');row.className='scope-row';
        const label=document.createElement('div');label.className='scope-label';
        const title=document.createElement('strong');title.textContent=m.label;
        const small=document.createElement('small');small.textContent=m.source;
        const value=document.createElement('div');value.className='scope-value';value.style.color=colors[index];
        const status=document.createElement('span');status.className='validity';
        const remove=document.createElement('button');remove.className='scope-remove';remove.textContent='×';remove.title='Remove '+m.label;remove.setAttribute('aria-label',remove.title);remove.onclick=()=>{selected=selected.filter(k=>k!==id);renderRows();};
        label.append(title,small,value,status,remove);
        const plot=document.createElement('div');plot.className='scope-plot';
        const canvas=document.createElement('canvas');canvas.setAttribute('aria-label',m.label+' over time, '+m.unit);canvas.tabIndex=0;plot.append(canvas);
        canvas.onclick=e=>{const b=canvas.getBoundingClientRect(),window=limits(),fraction=Math.max(0,Math.min(1,(e.clientX-b.left-42)/(b.width-55)));const t=window.start+fraction*(window.end-window.start);if(points.length)cursor=points.reduce((a,p)=>Math.abs(p.t-t)<Math.abs(a.t-t)?p:a,points[0]).t;redraw();};
        canvas.onkeydown=e=>{if(!points.length)return;if(e.key==='Escape'){cursor=null;redraw();return;}if(!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();const i=cursor==null?points.length-1:points.findIndex(p=>p.t>=cursor-.00001);cursor=points[Math.max(0,Math.min(points.length-1,i+(e.key==='ArrowLeft'?-1:1)))].t;redraw();};
        row.append(label,plot);container.append(row);rows.set(id,{canvas,value,status,m,color:colors[index]});
      });
      container.append(hint);redraw();
    }
    function limits(){const last=points.length?points[points.length-1].t:0;return {start:seconds?Math.max(0,last-seconds):0,end:Math.max(1,last)};}
    function sample(p,id,m){return m.profiles&&!m.profiles.includes(p.profile)?null:number(valueAt(p,id));}
    function redraw() {
      const span=limits(),visible=points.filter(p=>p.t>=span.start),selectedPoint=cursor==null?null:points.find(p=>Math.abs(p.t-cursor)<.00001);
      for(const [id,row] of rows){
        const {canvas,value,status,m,color}=row;
        const current=selectedPoint?sample(selectedPoint,id,m):number(live[id]?.value),quality=selectedPoint?validity(selectedPoint,id,m):(live[id]?.validity||'unavailable');
        value.replaceChildren(document.createTextNode(fmt(current)));const unit=document.createElement('span');unit.className='unit';unit.textContent=m.unit;value.append(unit);
        status.textContent=quality;status.className='validity '+quality;status.title=selectedPoint?'Validity at the selected recorded sample':live[id]?.validity_note||'';
        const rect=canvas.getBoundingClientRect();if(!rect.width)continue;
        const w=rect.width,h=rect.height,dpr=window.devicePixelRatio||1;canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);const c=canvas.getContext('2d');c.scale(dpr,dpr);
        const left=42,right=13,top=10,bottom=23,pw=w-left-right,ph=h-top-bottom;
        const values=visible.map(p=>sample(p,id,m)).filter(v=>v!=null);
        let lo=values.length?Math.min(...values):0,hi=values.length?Math.max(...values):1;
        if(m.kind==='digital'){lo=-.12;hi=1.12;}else{const padding=Math.max((hi-lo)*.12,Math.abs(hi)*.025,.05);lo-=padding;hi+=padding;}
        const x=t=>left+(t-span.start)/(span.end-span.start)*pw,y=v=>top+(hi-v)/(hi-lo)*ph;
        c.font='9px ui-monospace,monospace';c.fillStyle='#82928c';c.textAlign='right';c.lineWidth=1;
        for(let i=0;i<3;i++){const v=lo+(hi-lo)*i/2,py=y(v);c.strokeStyle='#e7eeea';c.beginPath();c.moveTo(left,py);c.lineTo(w-right,py);c.stroke();c.fillText(fmt(v),left-7,py+3);}
        c.textAlign='center';for(let i=0;i<4;i++){const t=span.start+(span.end-span.start)*i/3;c.fillText(t.toFixed(t<10?2:1),x(t),h-5);}
        for(const event of events){if(event.t<span.start||event.t>span.end)continue;c.setLineDash([2,3]);c.strokeStyle='#bd8d5938';c.beginPath();c.moveTo(x(event.t),top);c.lineTo(x(event.t),top+ph);c.stroke();}c.setLineDash([]);
        for(let i=1;i<visible.length;i++){const a=visible[i-1],b=visible[i],av=sample(a,id,m),bv=sample(b,id,m);if(av==null||bv==null)continue;const q=validity(b,id,m);c.strokeStyle=color;c.lineWidth=1.8;c.setLineDash(q==='valid'?[]:[4,3]);c.beginPath();c.moveTo(x(a.t),y(av));if(m.kind==='digital')c.lineTo(x(b.t),y(av));c.lineTo(x(b.t),y(bv));c.stroke();}
        c.setLineDash([]);
        if(!visible.length){c.fillStyle='#7b9088';c.textAlign='center';c.fillText('Run or step to record samples',left+pw/2,top+ph/2);}
        if(selectedPoint&&selectedPoint.t>=span.start&&selectedPoint.t<=span.end){c.strokeStyle='#4e625c';c.lineWidth=1;c.setLineDash([3,3]);c.beginPath();c.moveTo(x(selectedPoint.t),top);c.lineTo(x(selectedPoint.t),top+ph);c.stroke();c.setLineDash([]);const v=sample(selectedPoint,id,m);if(v!=null){c.fillStyle=color;c.beginPath();c.arc(x(selectedPoint.t),y(v),3,0,Math.PI*2);c.fill();}}
      }
      hint.replaceChildren(document.createTextNode(cursor==null?'TIME / seconds · live values · dashed segments: invalid, substituted or stale':'CURSOR / '+cursor.toFixed(2)+' s · saved sample values'));
      if(cursor!=null){const clear=document.createElement('button');clear.textContent='Return to live';clear.onclick=()=>{cursor=null;redraw();};hint.append(clear);}
    }
    function addSignal(id){if(!metadata.has(id)||metadata.get(id).kind==='state')return {ok:false,reason:'Choose a numerical or digital signal to plot.'};if(selected.includes(id))return {ok:true};if(selected.length>=6)return {ok:false,reason:'The scope holds six channels. Remove one with × before adding another.'};selected.push(id);renderRows();return {ok:true};}
    function setChannels(ids){selected=ids.filter(id=>metadata.has(id)&&metadata.get(id).kind!=='state').slice(0,6);renderRows();}
    function append(samples){for(const p of samples||[])if(!points.length||p.t>points[points.length-1].t)points.push(p);if(points.length>20000)points.splice(0,points.length-20000);redraw();}
    function exportCsv(){const quote=v=>'"'+String(v??'').replaceAll('"','""')+'"';const header=['time_s',...selected.flatMap(id=>[id+' ['+(metadata.get(id).unit||'boolean')+']',id+'.validity'])];const lines=[header.map(quote).join(',')];for(const p of points)lines.push([p.t,...selected.flatMap(id=>[sample(p,id,metadata.get(id)),validity(p,id,metadata.get(id))])].map(quote).join(','));emitFile('obdii_scope.csv',lines.join('\r\n')+'\r\n','text/csv');return lines.length-1;}
    window.addEventListener('resize',redraw);
    renderRows();
    return {addSignal,setChannels,append,redraw,exportCsv,setSignals(records){live=records||{};redraw();},setWindow(value){seconds=Number(value);redraw();},setEvents(value){events=value||[];redraw();},reset(){points=[];cursor=null;events=[];redraw();},getChannels(){return selected.slice();}};
  }
  window.SignalScope={init,valueAt};
})();
