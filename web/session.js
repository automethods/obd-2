/* One model, one clock and one command queue for every application view. */
(() => {
  'use strict';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const valueAt = (state, path) => String(path || '').split('.').reduce((v, key) => v == null ? undefined : v[key], state);
  function recordedSignal(metadata,state) {
    let value=valueAt(state,metadata.id),validity='valid';
    const config=state.vehicle?.configuration,id=metadata.id,sensed=state.sensors || {},reading=metadata.sensor_id?state.vehicle_sensors?.[metadata.sensor_id]:null;
    const electric=config&&['hev','phev','bev'].includes(config.powertrain);
    const missing=metadata.installed===false || reading?.installed===false || (metadata.profiles&&!metadata.profiles.includes(state.profile)) ||
      (config?.powertrain==='bev'&&['Engine','ECT','ECT circuit'].includes(metadata.group)) ||
      (config&&!electric&&['Battery','Network','Hybrid'].includes(metadata.group)) ||
      (config&&!config.abs_installed&&(id.startsWith('sensors.wheel_speeds_kph.')||metadata.unit_id==='abs'));
    if(missing)return {value:null,validity:'unavailable'};
    if(reading)validity=reading.validity || 'unavailable';
    if(metadata.sensor_id==='ect'&&id.endsWith('.signal_voltage_v')&&reading?.powered&&value!=null)validity='valid';
    if(id==='sensors.ect_resistance_ohm'&&sensed.ect_circuit_open)validity='invalid';
    if(['sensors.ect_c','sensors.ect_adc_count','sensors.ect_used_c'].includes(id)){
      if(!(sensed.ect_powered ?? state.inputs?.ignition))validity='unavailable';
      else if(id==='sensors.ect_used_c'&&state.ect_derate_factor<1)validity='substituted';
      else if(sensed.ect_sensor_valid===false)validity='invalid';
    }
    if(id.startsWith('sensors.wheel_speeds_kph.')&&value==null)validity='invalid';
    else if(value==null)validity='unavailable';
    if(id.startsWith('bmu_report.')&&sensed.bmu_message_age_ms>300.0001)validity='stale';
    return {value,validity};
  }
  function conversionMarkup(conversion) {
    if(!conversion?.steps?.length)return '';
    return '<ol class="measurement-path">'+conversion.steps.map(step=>'<li><span>'+escape(step.label)+'</span><code>'+escape(step.value)+'</code></li>').join('')+'</ol>'+(conversion.scope?'<p class="measurement-scope">'+escape(conversion.scope)+'</p>':'');
  }
  // One catalog for both picker choices and selection validation. Model probes
  // remain separate from decoded OBD services; no diagnostic PID is invented.
  function liveParameterCatalog(ctx,unitId) {
    const unit=ctx.systems?.units?.find(u=>u.id===unitId);
    const services=unitId==='ecu'?(ctx.definitions?.services||[]).filter(s=>s.decode?.kind==='linear').map(s=>({id:s.id,label:s.name,unit:s.unit,service:s})):[];
    const obdSensors=unitId==='ecu'?['ect','intake_temp','maf','throttle_sensor','crank_sensor']:[];
    const sensors=(ctx.systems?.sensors||[]).filter(s=>s.installed&&unit?.sensor_ids?.includes(s.id)&&!obdSensors.includes(s.id)).map(s=>({id:s.id,label:s.label,unit:s.unit,sensor:s}));
    const modelOutputs={ecu:['fuel_l_100km','fuel_l_h','energy.fuel_l','engine_torque_nm','engine_shaft_kw'],
      transmission:['rpm','sensors.accelerator_pct','sensors.brake_pct']};
    const signals=(ctx.signals||[]).filter(s=>s.installed!==false&&!s.id.endsWith('.value')&&(s.unit_id===unitId||(unit?.installed&&modelOutputs[unitId]?.includes(s.id)))).map(s=>({id:s.id,label:s.label,unit:s.unit,signal:s}));
    return [...services,...sensors,...signals];
  }
  function defaultLiveParameters(ctx,unitId) {
    if(!ctx.systems?.units?.some(u=>u.id===unitId&&u.installed))return [];
    const catalog=liveParameterCatalog(ctx,unitId);
    const defaults={
      ecu:['obd.rpm','obd.speed','obd.coolant','obd.load','obd.throttle','obd.intake_air','obd.airflow',
        'fuel_l_100km','fuel_l_h','lambda_sensor','map','rail_pressure','boost_sensor','oil_pressure','knock_sensor',
        'engine_torque_nm','engine_shaft_kw','energy.fuel_l','vehicle.low_voltage_v'],
      transmission:['transmission_range','vehicle.gear','vehicle.gear_ratio','vehicle_speed','transmission_temp',
        'rpm','sensors.accelerator_pct','sensors.brake_pct','clutch_position','vehicle.clutch_coupling','vehicle.clutch_torque_nm']
    };
    if(defaults[unitId])return defaults[unitId].filter(id=>catalog.some(p=>p.id===id));
    return catalog.filter(p=>p.sensor).sort((a,b)=>unitId==='abs'?Number(b.id.startsWith('wheel_'))-Number(a.id.startsWith('wheel_')):0).slice(0,unitId==='abs'?6:5).map(p=>p.id);
  }
  const groups = {
    engine:['Engine'], ecu:['Engine','ECT','ECT circuit','Diagnostics'], coolant_sensor:['ECT','ECT circuit'],
    battery:['Battery'], bmu:['Battery','Network'], supervisor:['Hybrid','Controller','Battery','Driver','Vehicle'],
    abs:['Braking'], dlc:['Engine','ECT','Vehicle','Diagnostics'], scan_tool:['Engine','ECT','Vehicle','Diagnostics']
  };
  function signalIdsForComponent(id, signals = []) {
    if (!id || id === 'overview') return signals.map(s => s.id);
    const declared=signals.filter(s=>s.unit_id===id||s.component_id===id).map(s=>s.id);
    if (id.startsWith('wheel_')) {
      const n = ['fl','fr','rl','rr'].indexOf(id.slice(6));
      return signals.filter(s => s.id.endsWith('.'+n) || s.id.includes('slip_'+id.slice(6)) || s.id === 'speed_kph').map(s => s.id);
    }
    return [...new Set([...declared,...signals.filter(s => (groups[id] || []).includes(s.group) ||
      (id === 'abs' && /wheel|slip|yaw|abs|brake_pressure/.test(s.id)) ||
      (id === 'supervisor' && /power|contactor|mode|soc|speed|inputs\./.test(s.id))).map(s => s.id)])];
  }
  function componentForSignal(signalId, signals) {
    const declared=signals.find(s=>s.id===signalId);if(declared?.component_id)return declared.component_id;
    if (/ect|coolant|sensor_return/.test(signalId)) return 'coolant_sensor';
    if (/bmu_report|bmu_message/.test(signalId)) return 'bmu';
    if (/wheel_speeds_kph\.([0-3])/.test(signalId)) return 'wheel_'+['fl','fr','rl','rr'][Number(signalId.slice(-1))];
    if (/abs|slip|yaw|brake_pressure/.test(signalId)) return 'abs';
    if (/battery|soc|cell_/.test(signalId)) return 'battery';
    if (signals.find(s => s.id === signalId)?.group === 'Engine') return 'engine';
    return 'supervisor';
  }
  function resolveSelection(selection = 'overview', catalog = {}, signals = []) {
    const components = catalog.components || [], sockets = catalog.sockets || [], wires = catalog.wires || [];
    const [prefix, rawId, number] = String(selection).split(':');
    let kind = 'component', id = selection, object, componentId, socketId, pin, signalId;
    if (selection === 'overview') return {kind:'overview',id:selection,label:'Whole vehicle',componentId:null,object:null};
    if (prefix === 'signal') {
      kind='signal'; id=String(selection).slice(7); signalId=id; object=signals.find(x=>x.id===id);
      componentId=componentForSignal(id, signals);
    } else if (prefix === 'wire') {
      kind='wire';id=rawId;object=wires.find(x=>x.id===id);signalId=object?.signal_id;
      socketId=object?.from.socket_id;componentId=sockets.find(x=>x.id===socketId)?.component_id;
    } else if (prefix === 'socket' || prefix === 'pin') {
      kind=prefix;id=rawId;socketId=id;const socket=sockets.find(x=>x.id===id);componentId=socket?.component_id;
      pin=prefix==='pin'?Number(number):undefined;object=pin == null?socket:socket?.pins.find(x=>x.number===pin);
    } else {
      if (prefix === 'component') id=rawId;
      object=components.find(x=>x.id===id);componentId=object?.id;
    }
    return {kind,id,label:object?.label || id,componentId,object,socketId,pin,signalId};
  }
  const presets = [
    {id:'city_drive',label:'Town drive',profile:'phev',scenario:'city_drive',config:{}},
    {id:'road_cruise',label:'Open road',profile:'phev',scenario:'road_cruise',config:{}},
    {id:'manual_drive',label:'Manual drive',profile:'phev',scenario:'manual',config:{initial_speed_kph:25,initial_coolant_c:70,initial_soc_pct:60}},
    {id:'engine_bench',label:'Engine bench',profile:'engine',scenario:'manual',config:{initial_coolant_c:70}},
    {id:'abs_split_mu',label:'Split-friction braking',profile:'braking',scenario:'abs_split_mu',config:{}},
    {id:'regen_limit',label:'Regeneration limit',profile:'braking',scenario:'regen_limit',config:{}},
    {id:'low_soc',label:'Low battery charge',profile:'phev',scenario:'low_soc',config:{}}
  ];
  class Session {
    constructor(options = {}) {
      this.fetch = options.fetch || window.fetch.bind(window);
      this.listeners = new Set();this.command = Promise.resolve();this.pending=0;this.controlsPending=0;this.timer=null;this.generation=0;
      this.result=null;this.catalog={};this.signals=[];this.definitions={};this.meta={};
      this.history=[];this.records=[];this.events=[];this.eventKeys=new Set();this.diagnostic=null;
      this.selection='overview';this.view='setup';this.unitView='overview';this.diagnosticView='scan';this.watch=['speed_kph','rpm','coolant_c','sensors.ect_c'];
      this.workflowStage='vehicle';this.setupComplete=false;this.setupEditing=false;this.setupReturn=null;this.setupDraftRevision=0;
      this.lastServiceView='diagnostics';this.committedSetupKey='';this.setupCommitPromise=null;this.configurationUncertain=false;
      this.systems={units:[],sensors:[],groups:[]};this.scannerCatalog={protocols:[],modules:[]};this.scanReport=null;this.unitReports={};this.vehicleConfigurations=[];this.configurationId='petrol_basic';this.configurationOptions={};
      this.recording=true;this.logInterval=1;this.logHistory=[];this.nextLogTime=0;
      this.scanPolling={enabled:false,interval:1,payload:'01 0C',canId:'7DF',nextAt:0};
      this.scanLive={enabled:true,visible:false,interval:.25,ids:[],replies:{},series:{},nextAt:0};
      this.testSettings={mode:'wltc_class3b',road_mu:.9,grade_pct:0};
      this.running=false;this.speed=1;this.inputs={};this.error='';this.preset=presets[0];this.recordNumber=0;this.ready=false;
    }
    context() {return {state:this.result?.state,result:this.result,network:this.result?.network,catalog:this.catalog,
      signals:this.signals,definitions:this.definitions,meta:this.meta,selection:this.selection,view:this.view,
      history:this.history,running:this.running,busy:this.pending>0,controlsBusy:this.controlsPending>0,diagnostic:this.diagnostic,records:this.records,
      events:this.events,watch:this.watch,inputs:this.inputs,preset:this.preset,speed:this.speed,error:this.error,ready:this.ready,
      unitView:this.unitView,diagnosticView:this.diagnosticView,systems:this.systems,scannerCatalog:this.scannerCatalog,scanner:this.result?.scanner,scanReport:this.scanReport,unitReports:this.unitReports,
      vehicleConfigurations:this.vehicleConfigurations,configurationOptions:this.configurationOptions,recording:this.recording,logInterval:this.logInterval,logHistory:this.logHistory,scanPolling:this.scanPolling,scanLive:this.scanLive,testSettings:this.testSettings,
      workspace:this.view==='drive'?'drive':'service',workflow:{stage:this.workflowStage,complete:this.setupComplete,editing:this.setupEditing,canCancel:this.setupComplete&&!this.configurationUncertain&&!this.setupCommitPromise,recoveryRequired:this.configurationUncertain,returnMode:this.setupReturn?(this.setupReturn.view==='drive'?'drive':'service'):null,draftRevision:this.setupDraftRevision}};}
    subscribe(fn) {this.listeners.add(fn);return ()=>this.listeners.delete(fn);}
    emit() {const ctx=this.context();this.listeners.forEach(fn=>fn(ctx));}
    event(name,detail) {if (typeof window.dispatchEvent === 'function') window.dispatchEvent(new CustomEvent(name,{detail}));}
    async api(path,body) {
      const response=await this.fetch(path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      const data=await response.json();if (!response.ok || data.error) {const error=new Error(data.error || 'The simulator did not respond.');error.apiStatus=response.status;throw error;}return data;
    }
    enqueue(action,{background=false}={}) {
      this.pending++;if(!background)this.controlsPending++;this.emit();
      const work=this.command.then(async()=>{this.error='';return action();});
      this.command=work.catch(error=>{this.error=error.message;}).finally(()=>{this.pending--;if(!background)this.controlsPending--;this.emit();});
      return work;
    }
    apply(result) {
      this.result=result;
      const samples=result.history || [];
      for (const sample of samples) {
        const last=this.history.at(-1);if (!last || sample.t > last.t+1e-8) this.history.push(sample);
        else if (Math.abs(sample.t-last.t)<1e-8) this.history[this.history.length-1]=sample;
      }
      const state=result.state;
      if (state && (!this.history.length || state.t>this.history.at(-1).t+1e-8)) this.history.push(state);
      else if (state && this.history.length && Math.abs(state.t-this.history.at(-1).t)<1e-8) this.history[this.history.length-1]=state;
      if(this.history.length>9000)this.history.splice(0,this.history.length-9000);
      if(this.recording){
        // History arrives on a 100 ms grid, while a Step or fault command can
        // finish between those points. Keep the actual final snapshot and
        // anchor deadlines to the chosen cadence instead of drifting each
        // deadline to the first later history sample. Never invent samples
        // for missed slots or interpolate an unavailable sensor value.
        const candidates=[...samples];
        if(state&&(!candidates.length||state.t>candidates.at(-1).t+1e-8))candidates.push(state);
        for(const sample of candidates){if(sample.t+1e-7>=this.nextLogTime){
          this.logHistory.push(sample);
          const slots=Math.max(1,Math.floor((sample.t-this.nextLogTime+1e-7)/this.logInterval)+1);
          this.nextLogTime+=slots*this.logInterval;
        }}
        if(this.logHistory.length>20000)this.logHistory.splice(0,this.logHistory.length-20000);
      }
      for(const event of result.events || []) {
        const key=JSON.stringify(event);if(!this.eventKeys.has(key)){this.eventKeys.add(key);this.events.push(event);}
      }
      if(this.events.length>500){this.events.splice(0,this.events.length-500);this.eventKeys=new Set(this.events.map(e=>JSON.stringify(e)));}
      this.event('lab:state',result);this.emit();return result;
    }
    async initialize() {
      try {
        await this.configure('petrol_basic');this.ready=true;this.emit();
      } catch(error) {this.ready=false;this.setRunning(false);this.error=error.message;this.emit();throw error;}
      return this.context();
    }
    configure(configuration=this.configurationId, options={}, initialInputs=null) {
      this.setRunning(false);
      return this.enqueue(async()=>{
        const body={configuration,options:options || {}};if(initialInputs)body.initial_inputs=initialInputs;
        let result;
        try {
          result=await this.api('/api/vehicle',body);
          if(!result.resources?.meta||!result.resources?.catalog||!result.resources?.definitions||!result.resources?.systems||!result.resources?.scanner)
            throw new Error('The vehicle response is incomplete. Restart the updated local simulator.');
        } catch(error) {
          if(!(error.apiStatus>=400&&error.apiStatus<500))this.configurationUncertain=true;
          if(this.configurationUncertain&&this.workflowStage==='active'){
            this.setupReturn={view:this.view,unitView:this.unitView,diagnosticView:this.diagnosticView};this.setupEditing=true;
            this.workflowStage='vehicle';this.view='setup';this.setupDraftRevision++;
          }
          if(this.configurationUncertain)error.message='The vehicle update could not be confirmed. Apply the setup again when the local simulator responds. Cancelling is unavailable until the vehicle is confirmed.';
          throw error;
        }
        const {meta,catalog,definitions,systems,scanner}=result.resources;this.configurationUncertain=false;
        this.meta=meta;this.catalog=catalog;this.definitions=definitions;this.systems=systems;this.scannerCatalog=scanner.catalog;this.vehicleConfigurations=meta.vehicle_configurations || [];
        this.signals=meta.signals || [];this.configurationId=configuration;this.configurationOptions={...(options || {})};this.inputs={throttle:0,brake:0,steer_deg:0,...initialInputs};
        if(result.state.vehicle.configuration.transmission_type==='manual_6')this.inputs.clutch=0;
        this.history=[];this.logHistory=[];this.nextLogTime=0;this.records=[];this.events=[];this.eventKeys.clear();this.diagnostic=null;this.scanReport=null;this.unitReports={};this.recordNumber=0;
        this.scanPolling.enabled=false;this.scanPolling.nextAt=0;
        this.scanLive={...this.scanLive,ids:defaultLiveParameters(this.context(),'ecu'),replies:{},series:{},nextAt:0};
        this.selection='overview';this.preset={id:configuration,label:result.state.vehicle.configuration.label,scenario:'manual',profile:result.state.profile};
        this.watch=result.state.vehicle.configuration.powertrain==='bev'?['speed_kph','soc_pct','battery_power_kw','motor_power_kw']:['speed_kph','rpm','coolant_c','sensors.ect_c'];
        this.event('lab:reset',{configuration});return this.apply(result);
      });
    }
    async setup(configuration,hardware,settings,{enterDrive=true}={}) {
      if(!settings||!['manual','wltc_class3b'].includes(settings.mode)||!Number.isFinite(settings.road_mu)||settings.road_mu<.05||settings.road_mu>1.2||!Number.isFinite(settings.grade_pct)||Math.abs(settings.grade_pct)>12)
        throw new Error('Choose a driving task, valid road surface and slope between −12% and 12%.');
      await this.configure(configuration,hardware,{road_mu:settings.road_mu,grade_pct:settings.grade_pct});
      this.testSettings={...settings};this.emit();
      if(enterDrive)this.navigate('drive');return this.context();
    }
    setupKey(configuration,hardware,settings) {
      const sorted=value=>Object.fromEntries(Object.entries(value||{}).sort(([a],[b])=>a.localeCompare(b)));
      return JSON.stringify([configuration,sorted(hardware),sorted(settings)]);
    }
    commitSetup(configuration,hardware,settings) {
      if(this.setupCommitPromise)return this.setupCommitPromise;
      if(this.workflowStage!=='vehicle')return Promise.resolve(this.context());
      const key=this.setupKey(configuration,hardware,settings),returnTo=this.setupReturn;
      const work=(async()=>{
        if(!this.setupComplete||this.configurationUncertain||key!==this.committedSetupKey)await this.setup(configuration,hardware,settings,{enterDrive:false});
        this.committedSetupKey=key;this.setupComplete=true;this.setupEditing=false;this.setupReturn=null;this.error='';
        if(returnTo){this.workflowStage='active';this.view=returnTo.view;this.unitView=returnTo.unitView;this.diagnosticView=returnTo.diagnosticView;this.setRunning(true);}
        else {this.workflowStage='workspace';this.view='setup';}
        this.emit();return this.context();
      })();
      this.setupCommitPromise=work;
      return work.finally(()=>{this.setupCommitPromise=null;this.emit();});
    }
    enterWorkspace(mode) {
      if(!this.setupComplete||this.workflowStage==='vehicle'||!['drive','service'].includes(mode))return false;
      this.workflowStage='active';this.setupEditing=false;this.setupReturn=null;
      this.view=mode==='drive'?'drive':this.lastServiceView;this.setRunning(true);this.emit();return true;
    }
    beginSetup() {
      if(!this.ready||this.setupCommitPromise||this.workflowStage==='vehicle')return;
      this.setRunning(false);
      if(this.workflowStage==='active')this.setupReturn={view:this.view,unitView:this.unitView,diagnosticView:this.diagnosticView};
      this.setupEditing=!!this.setupReturn;this.workflowStage='vehicle';this.view='setup';this.setupDraftRevision++;
      this.inputs={...this.inputs,throttle:0,brake:0,steer_deg:0};if('clutch' in this.inputs)this.inputs.clutch=0;
      this.error='';this.emit();
    }
    backToVehicle() {if(this.workflowStage==='workspace')this.beginSetup();}
    cancelSetup() {
      if(!this.setupComplete||this.configurationUncertain||this.setupCommitPromise||this.workflowStage!=='vehicle')return false;
      const previous=this.setupReturn;this.setupReturn=null;this.setupEditing=false;this.error='';
      if(previous){this.workflowStage='active';this.view=previous.view;this.unitView=previous.unitView;this.diagnosticView=previous.diagnosticView;this.setRunning(true);}
      else {this.workflowStage='workspace';this.view='setup';}
      this.emit();return true;
    }
    workspaceRequired() {
      return this.workflowStage!=='active'?Promise.reject(new Error('Choose a vehicle, continue, then open Drive or Diagnostics & service.')):null;
    }
    reset(presetId=this.preset.id) {
      const blocked=this.workspaceRequired();if(blocked)return blocked;
      if(this.result?.state?.vehicle)return this.setup(this.configurationId,this.configurationOptions,this.testSettings,{enterDrive:false}).then(()=>{this.setRunning(true);return this.context();});
      this.setRunning(false);const preset=presets.find(x=>x.id===presetId) || this.preset;
      return this.enqueue(async()=>{
        const result=await this.api('/api/reset',{profile:preset.profile,scenario:preset.scenario,config:preset.config});
        this.preset=preset;this.inputs={};this.history=[];this.records=[];this.events=[];this.eventKeys.clear();this.diagnostic=null;this.recordNumber=0;
        if(preset.id==='manual_drive')this.inputs={ignition:true,throttle:.15,brake:0};
        if(preset.id==='engine_bench')this.inputs={ignition:true,throttle:.2,brake:0};
        this.event('lab:reset',{preset});return this.apply(result);
      });
    }
    setRunning(value) {
      const running=!!value && this.ready && this.workflowStage==='active';
      if(this.running===running)return;
      this.running=running;this.generation++;if(this.timer)clearTimeout(this.timer);this.timer=null;
      this.event('lab:play',{playing:running,running});this.emit();
      if(running)this.schedule(this.generation);
    }
    schedule(generation) {
      this.timer=setTimeout(async()=>{
        if(!this.running || this.generation!==generation)return;
        try {
          await this.enqueue(async()=>{
            if(!this.running || this.generation!==generation)return;
            await this.advanceQueued(.1*this.speed);
          },{background:true});
        } catch(_) { this.setRunning(false); }
        if(this.running && this.generation===generation)this.schedule(generation);
      },100);
    }
    advance(seconds) {
      const blocked=this.workspaceRequired();if(blocked)return blocked;
      this.setRunning(false);const total=Number(seconds);
      if(!Number.isFinite(total)||total<=0||total>60)return Promise.reject(new Error('Choose an advance from 0 to 60 seconds.'));
      return this.enqueue(()=>this.advanceQueued(total));
    }
    async advanceQueued(total) {
      let remaining=total,result=this.result;
      while(remaining>1e-8){
        await this.pollScanner();
        const poll=this.scanPolling,t=this.result?.state?.t || 0;
        const deadlines=[poll.enabled&&this.result?.scanner?.connected?poll.nextAt:Infinity,this.liveDataActive()?this.scanLive.nextAt:Infinity];
        const untilPoll=Math.max(.001,Math.min(5,...deadlines.map(at=>at-t)));
        const step=Math.min(5,remaining,untilPoll);
        result=this.apply(await this.api('/api/advance',{seconds:step,inputs:{...this.inputs}}));remaining-=step;await this.pollScanner();
      }
      return result;
    }
    setInputs(inputs) {
      this.inputs={...this.inputs,...inputs};
      if(this.workflowStage!=='active'){this.inputs.throttle=0;this.inputs.brake=0;this.inputs.steer_deg=0;if('clutch' in this.inputs)this.inputs.clutch=0;}
      this.emit();return Promise.resolve(this.inputs);
    }
    control(action,value) {
      const blocked=this.workspaceRequired();if(blocked)return blocked;
      return this.enqueue(async()=>{
        const result=this.apply(await this.api('/api/control',{action,value,inputs:{...this.inputs}}));
        if(action==='start'||(action==='ignition'&&value===true))this.setRunning(true);
        return result;
      });
    }
    start({assist=false}={}) {
      const blocked=this.workspaceRequired();if(blocked)return blocked;
      if(!assist)return this.control('start');
      return this.enqueue(async()=>{
        let result,problem;
        try {
          result=this.apply(await this.api('/api/control',{action:'start',inputs:{...this.inputs,clutch:1,throttle:0,brake:Math.max(.35,Number(this.inputs.brake)||0)}}));
        } catch(error){problem=error;}
        try{result=this.apply(await this.api('/api/inputs',{inputs:{...this.inputs}}));}catch(error){if(!problem)problem=error;}
        if(problem)throw problem;this.setRunning(true);return result;
      });
    }
    shift(gear,{assist=false}={}) {
      const blocked=this.workspaceRequired();if(blocked)return blocked;
      if(!assist)return this.control('gear',gear);
      return this.enqueue(async()=>{
        // Only this queued command owns the temporary brake. The user's desired
        // pedals remain separate and may change while the request is in flight.
        let result,problem;
        try {
          const staged={...this.inputs,throttle:0,brake:Math.max(.35,Number(this.inputs.brake)||0)};
          if(this.result?.state?.vehicle?.configuration?.transmission_type==='manual_6')staged.clutch=1;
          result=this.apply(await this.api('/api/control',{action:'gear',value:gear,inputs:staged}));
        } catch(error) {problem=error;}
        try {
          result=this.apply(await this.api('/api/inputs',{inputs:{...this.inputs}}));
        } catch(error) {if(!problem)problem=error;}
        if(problem)throw problem;
        return result;
      });
    }
    cycleAction(action) {
      const blocked=this.workspaceRequired();if(blocked)return blocked;
      return this.enqueue(async()=>{
        this.inputs={...this.inputs,throttle:0,brake:0,steer_deg:0};
        const result=this.apply(await this.api('/api/cycle',{action,name:'wltc_class3b'}));
        if(action==='start'){this.setWatch('drive_target_kph',true);this.setWatch('speed_kph',true);}
        this.setRunning(true);
        return result;
      });
    }
    overrideCycle(){
      const blocked=this.workspaceRequired();if(blocked)return blocked;
      return this.enqueue(async()=>{
        if(['preparing','active','complete','fault'].includes(this.result?.state?.drive_cycle?.status))
          this.apply(await this.api('/api/cycle',{action:'stop'}));
      });
    }
    scannerAction(action,settings={}) {
      const blocked=this.workspaceRequired();if(blocked)return blocked;
      return this.enqueue(async()=>{
        const result=await this.api('/api/scanner',{action,...settings});
        if(!result.scanner?.connected||result.scanner.module_id!=='ecu')this.scanPolling.enabled=false;
        if(result.scan_report){this.scanReport=result.scan_report;for(const diagnostic of result.scan_report.diagnostics || [])this.captureDiagnostic({...diagnostic,sample_t:result.state.t},{select:false});}
        if(result.unit_report){this.unitReports[result.unit_report.module_id]=result.unit_report;for(const diagnostic of result.unit_report.diagnostics||[])this.captureDiagnostic({...diagnostic,sample_t:result.state.t},{select:false});}
        if(action==='connect'||action==='disconnect')this.scanLive={...this.scanLive,replies:{},series:{},nextAt:0};
        this.apply(result);
        if(action==='connect'&&this.liveDataActive())await this.readLiveDataQueued();
        return result.scan_report || result.unit_report || result.scanner;
      });
    }
    captureDiagnostic(diagnostic,{select=true}={}) {
      if(select)this.diagnostic=diagnostic;
      if(diagnostic.frames?.length)diagnostic.frames.forEach((frame,index)=>this.records.push({number:++this.recordNumber,t:diagnostic.sample_t,frame,index,diagnostic}));
      else this.records.push({number:++this.recordNumber,t:diagnostic.sample_t,frame:null,index:0,diagnostic});
      if(this.records.length>1000)this.records.splice(0,this.records.length-1000);
    }
    setScannerPolling(settings={}) {
      const interval=Number(settings.interval ?? this.scanPolling.interval);
      const period=[.25,1,60].includes(interval)?interval:1;
      this.scanPolling={...this.scanPolling,...settings,interval:period,nextAt:(this.result?.state?.t || 0)+period};this.emit();
    }
    async pollScanner(){
      if(this.liveDataActive()&&(this.result?.state?.t||0)+1e-7>=this.scanLive.nextAt)await this.readLiveDataQueued();
      const poll=this.scanPolling,t=this.result?.state?.t || 0;
      if(!poll.enabled||!this.result?.scanner?.connected||t+1e-7<poll.nextAt)return;
      poll.nextAt=t+poll.interval;
      const result=await this.api('/api/diagnostic',{payload:poll.payload,can_id:poll.canId});
      const diagnostic={...result.diagnostic,sample_t:result.state.t};this.captureDiagnostic(diagnostic);this.apply(result);this.event('lab:diagnostic',diagnostic);
    }
    liveDataActive(){return this.scanLive.visible&&this.scanLive.enabled&&this.scanLive.ids.some(id=>this.definitions.services?.some(s=>s.id===id&&s.decode?.kind==='linear'))&&this.view==='diagnostics'&&this.diagnosticView==='scan'&&this.result?.scanner?.module_id==='ecu'&&this.result?.scanner?.status==='ready';}
    setLiveData(settings={}){
      const ids=settings.ids||this.scanLive.ids,allowed=liveParameterCatalog(this.context(),'ecu').map(p=>p.id);
      const interval=Number(settings.interval??this.scanLive.interval);
      this.scanLive={...this.scanLive,...settings,interval:[.25,1,60].includes(interval)?interval:.25,ids:[...new Set(ids.filter(id=>allowed.includes(id)))],nextAt:0};this.emit();
    }
    readLiveData(){const blocked=this.workspaceRequired();if(blocked)return blocked;return this.enqueue(()=>this.readLiveDataQueued());}
    async readLiveDataQueued(){
      const services=this.scanLive.ids.map(id=>this.definitions.services?.find(s=>s.id===id&&s.decode?.kind==='linear')).filter(Boolean);
      if(!services.length||!this.result?.scanner?.connected||this.result.scanner.module_id!=='ecu')return;
      const result=await this.api('/api/scanner',{action:'read',payloads:services.map(s=>s.request_hex)});
      for(const reply of result.readings||[]){
        const service=services.find(s=>s.request_hex===reply.request_hex);if(!service)continue;
        const diagnostic={...reply,sample_t:reply.sample_t??result.state.t};
        this.scanLive.replies[service.id]=diagnostic;this.captureDiagnostic(diagnostic,{select:false});
        const series=this.scanLive.series[service.id]||[];
        if(series.at(-1)?.sample_t===diagnostic.sample_t)series[series.length-1]=diagnostic;else series.push(diagnostic);
        this.scanLive.series[service.id]=series.filter(d=>d.sample_t>=diagnostic.sample_t-120).slice(-481);
      }
      this.scanLive.nextAt=result.state.t+this.scanLive.interval;this.apply(result);return result;
    }
    connection(id,connected) {const blocked=this.workspaceRequired();if(blocked)return blocked;return this.enqueue(async()=>this.apply(await this.api('/api/connection',{id,connected:!!connected})));}
    connectionFault(id,settings={}) {
      const blocked=this.workspaceRequired();if(blocked)return blocked;
      return this.enqueue(async()=>this.apply(await this.api('/api/connection-fault',{...settings,id})));
    }
    request(payload,canId='7DF') {
      const blocked=this.workspaceRequired();if(blocked)return blocked;
      return this.enqueue(async()=>{
        const result=await this.api('/api/diagnostic',{payload,can_id:canId});
        const diagnostic={...result.diagnostic,sample_t:result.state.t};this.captureDiagnostic(diagnostic);
        this.apply(result);this.event('lab:diagnostic',diagnostic);return diagnostic;
      });
    }
    select(selection) {if(selection!==this.selection&&this.scannerCatalog.modules?.some(m=>m.installed&&m.id===String(selection).replace(/^component:/,'')))this.scanPolling.enabled=false;this.selection=String(selection);this.emit();}
    navigate(view) {
      if(view==='setup'){this.beginSetup();return;}
      if(this.workflowStage!=='active')return;
      if(view==='service')view=this.lastServiceView;
      if(['live','signals','wiring','locations','overview'].includes(view)){this.view='units';this.unitView=view==='live'?'signals':view;}
      else if(view==='diagnosis'){this.view='diagnostics';this.diagnosticView='tests';}
      else if(view==='scan'){this.view='diagnostics';this.diagnosticView='scan';}
      else if(['drive','units','diagnostics','configuration'].includes(view))this.view=view;
      else return;
      if(this.view!=='drive')this.lastServiceView=this.view;this.emit();
    }
    setUnitView(view){if(this.workflowStage==='active'&&['overview','signals','wiring','locations'].includes(view)){this.unitView=view;this.view='units';this.lastServiceView='units';this.emit();}}
    setDiagnosticView(view){if(this.workflowStage==='active'&&['scan','tests'].includes(view)){this.diagnosticView=view;this.view='diagnostics';this.lastServiceView='diagnostics';this.emit();}}
    setRecording(value){this.recording=!!value;if(this.recording)this.nextLogTime=this.result?.state?.t || 0;this.emit();}
    setLogInterval(value){const interval=Number(value);if([.1,1,60].includes(interval)){this.logInterval=interval;this.nextLogTime=(this.result?.state?.t || 0)+interval;this.emit();}}
    logCSV(){
      const header=['time_s','configuration','ignition','selector','gear',...this.signals.flatMap(s=>[s.id+(s.unit?' ['+s.unit+']':''),s.id+' validity'])];
      const cell=value=>'"'+String(value ?? '').replace(/"/g,'""')+'"';
      const rows=this.logHistory.map(state=>[state.t,state.vehicle?.configuration.id,state.vehicle?.ignition,state.vehicle?.selector,state.vehicle?.gear,...this.signals.flatMap(s=>{
        const record=recordedSignal(s,state);return [record.value,record.validity];
      })]);return [header,...rows].map(row=>row.map(cell).join(',')).join('\r\n');
    }
    setWatch(id,enabled) {if(!this.signals.some(s=>s.id===id))return;
      const next=enabled===undefined?!this.watch.includes(id):!!enabled;
      this.watch=next?[...new Set([...this.watch,id])].slice(-8):this.watch.filter(x=>x!==id);this.emit();
    }
    setSpeed(value) {this.speed=[.25,1,2,5].includes(Number(value))?Number(value):1;this.emit();}
    dispose() {this.setRunning(false);this.listeners.clear();}
  }
  window.AppModel={escape,conversionMarkup,valueAt,recordedSignal,liveParameterCatalog,defaultLiveParameters,resolveSelection,signalIdsForComponent,componentForSignal,presets};
  window.AppSession={create:options=>new Session(options)};
})();
