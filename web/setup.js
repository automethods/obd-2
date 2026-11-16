/* Choose a vehicle, then enter a workspace. Draft edits never own the simulator. */
(() => {
  'use strict';
  const esc=window.AppModel.escape;
  const labels={automatic_6:'6-speed automatic',manual_6:'6-speed manual with clutch',hybrid_power_split:'Hybrid power-split automatic',single_speed:'Single-speed electric reduction'};
  function create(container,options={}) {
    container.classList.add('setup-view');
    container.innerHTML=`<div class="setup-flow">
      <ol class="setup-progress" aria-label="Session preparation"><li data-setup-step="vehicle" aria-current="step"><span>1</span><div><strong>Vehicle</strong><small>Choose &amp; configure</small></div></li><li class="setup-progress-line" aria-hidden="true"></li><li data-setup-step="workspace"><span>2</span><div><strong>Workspace</strong><small>Drive or service</small></div></li></ol>
      <header class="setup-heading"><div><small data-setup="eyebrow">NEW SESSION</small><h2 data-setup="heading" tabindex="-1">Choose your vehicle</h2><p data-setup="intro">Start with a vehicle, adjust its equipment if needed, then choose what to do.</p></div><button type="button" data-setup-action="cancel" hidden>Cancel changes</button></header>
      <section data-setup-stage="vehicle" aria-label="Step 1: choose vehicle">
      <div class="setup-replacement-note" data-setup="replacement-note" hidden><div><strong>Your current session is paused</strong><p>Applying changed settings creates a new vehicle and clears this run. Cancel returns to the current vehicle and its recorded data.</p></div><button type="button" data-setup-action="export">Export current run</button></div>
    <form data-setup="form">
      <section class="setup-vehicle-choice"><div class="setup-vehicle-art" aria-hidden="true"><svg viewBox="0 0 240 108"><path class="body" d="M24 72V52l27-7 27-25h82l31 25 25 8v22H24Z"/><path class="glass" d="m64 45 21-19h67l23 19Z"/><path d="M115 25v20M25 60h21m151 0h18M97 56h9m32 0h9"/><circle class="tire" cx="65" cy="75" r="18"/><circle class="tire" cx="179" cy="75" r="18"/><circle cx="65" cy="75" r="8"/><circle cx="179" cy="75" r="8"/></svg><span data-setup="vehicle-kind">VIRTUAL VEHICLE</span></div><div class="setup-vehicle-selection"><label>Vehicle type<select data-setup="configuration" aria-label="Vehicle type"></select></label><p data-setup="description" class="setup-hint"></p><div class="setup-specs" data-setup="chosen-specs"></div></div></section>
      <details class="setup-customize" data-setup="customization"><summary><span><strong>Customize vehicle &amp; test conditions</strong><small>Transmission, chassis, sensors, cabin equipment and driving task</small></span><span class="setup-customize-label">Edit settings</span></summary><div class="setup-grid">
    <section class="setup-card"><h3><svg aria-hidden="true"><use href="#i-chip"/></svg> Powertrain & chassis</h3><div class="setup-fields"><label>Engine sensor set<select data-setup="engine_detail"><option value="basic">Basic</option><option value="extended">Extended</option></select></label><label>Cylinders<select data-setup="cylinders"><option value="4">4 cylinders</option><option value="6">6 cylinders</option><option value="8">8 cylinders</option></select></label><label class="setup-wide">Transmission<select data-setup="transmission_type" aria-label="Transmission type"></select></label><label>Driven wheels<select data-setup="drivetrain"><option value="fwd">Front-wheel drive</option><option value="rwd">Rear-wheel drive</option><option value="awd">All-wheel drive</option></select></label><label>Vehicle mass · kg<input data-setup="mass_kg" type="number" min="600" max="3500" step="10" required></label></div><div class="setup-checks"><label><input type="checkbox" data-setup="abs_installed"> Fit ABS</label><label><input type="checkbox" data-setup="esp_installed"> Fit ESP</label></div><p class="setup-hint">ABS modulates braking. ESP uses the wheel sensors and brake controller, so fitting ESP also fits ABS.</p><details><summary>Tires, road load & network</summary><div class="setup-fields"><label>Wheel rolling radius · mm<input data-setup="wheel_radius_mm" type="number" min="220" max="450" step="1" required></label><label>Drag area · m²<input data-setup="drag_area_m2" type="number" min="0.3" max="1.5" step="0.01" required></label><label>Rolling resistance coefficient<input data-setup="rolling_resistance" type="number" min="0.004" max="0.035" step="0.001" required></label><label>Diagnostic CAN bitrate<select data-setup="can_bitrate"><option value="500000">500 kbit/s</option><option value="250000">250 kbit/s</option></select></label></div><p class="setup-hint">Mass, tire radius, driven axle and road load affect the model’s motion. The CAN bitrate must match the scan tool.</p></details></section>
    <section class="setup-card"><h3><svg aria-hidden="true"><use href="#i-car"/></svg> Cabin & equipment</h3><div class="setup-checks"><label><input type="checkbox" data-setup="hvac_installed"> Fit cabin heater / ventilation</label><label><input type="checkbox" data-setup="ac_installed"> Fit air conditioning</label></div><label class="setup-wide">Cabin heat source<select data-setup="heater_type"><option value="coolant">Engine coolant heat</option><option value="electric">Electric resistance heater</option></select></label><p data-setup="heater-note" class="setup-hint"></p><div class="setup-climate-preview"><svg viewBox="0 0 220 90" aria-hidden="true"><path d="M20 65V38h26l21-21h84l25 21h24v27Z M55 38h111 M106 18v21"/><circle cx="56" cy="65" r="13"/><circle cx="164" cy="65" r="13"/><path class="air" d="M91 65V47m-6 6 6-6 6 6m23 12V47m-6 6 6-6 6 6"/></svg><div><strong>Use the cabin controls in Drive</strong><p>Set the temperature, fan and A/C. Cabin temperature changes gradually; heating and cooling draw energy from the vehicle.</p></div></div><div class="setup-fields"><label>Outside temperature · °C<input data-setup="ambient_c" type="number" min="-30" max="50" step="1" required></label><label data-setup="soc-field">Initial traction charge · %<input data-setup="initial_soc_pct" type="number" min="10" max="95" step="1"></label><label class="setup-wide">Starting odometer · km<input data-setup="initial_odometer_km" type="number" min="0" max="9999999" step="any" required aria-describedby="setup-odometer-note"></label></div><p class="setup-hint" id="setup-odometer-note">Choose a starting mileage for this virtual vehicle. ODO adds actual distance traveled; Trip A starts at zero. Resetting the session returns to this starting reading.</p><p class="setup-hint">A new vehicle’s cabin and engine coolant start at outside temperature. The basic cabin model includes thermal inertia and equipment loads.</p></section>
    <section class="setup-card setup-test"><h3><svg aria-hidden="true"><use href="#i-chart"/></svg> Driving task</h3><label class="setup-wide">Driver<select data-setup="driving_mode" aria-label="Driving task"><option value="wltc_class3b">WLTC Class 3b · automatic virtual driver</option><option value="manual">You drive · momentary pedals</option></select></label><div data-setup="cycle-note"><div class="setup-cycle-facts"><span><b>30</b> minutes</span><span><b>4</b> phases</span><span><b>131.3</b> km/h peak target</span></div><svg data-setup="cycle-preview" viewBox="0 0 580 124" role="img" aria-label="WLTC target speed over thirty minutes"></svg><p class="setup-hint">A virtual driver follows the official speed target using the same accelerator, brakes and vehicle model. The graph records actual speed separately. Start the cycle from the shared Driving task bar.</p><p class="setup-scope">Official target trace; generic training vehicle. This does not perform a certified WLTP test.</p></div><p data-setup="manual-note" class="setup-hint" hidden>Turn on ignition, start the engine or enable READY, then choose a gear. Hold W / ↑ for accelerator, S / ↓ for brake, A / D or ← / → for steering, and C for the manual clutch. Release keys to release pedals and centre keyboard steering.</p></section>
    <section class="setup-card"><h3><svg aria-hidden="true"><use href="#i-wheel"/></svg> Test environment</h3><div class="setup-fields"><label>Road surface<select data-setup="surface"><option value="0.9">Dry road</option><option value="0.55">Wet road</option><option value="0.25">Snow</option><option value="0.1">Ice</option></select></label><label>Road slope · %<input data-setup="grade_pct" type="number" min="-12" max="12" step="0.5" required></label></div><p class="setup-hint">Dry, level road is the baseline. Surface grip and slope are separate experiments; they are not part of the WLTC speed trace.</p><button type="button" data-setup-action="baseline">Use dry, level baseline</button><p class="setup-hint setup-environment-note" data-setup="environment-note"></p></section>
      </div></details>
      <div class="setup-error" data-setup="error" role="alert" hidden></div>
      <footer class="setup-apply"><div><small>SELECTED VEHICLE</small><strong data-setup="summary">Prepare a vehicle</strong><p data-setup="apply-note">Continue prepares this vehicle. You choose Drive or Diagnostics &amp; service next.</p></div><button type="submit" class="primary" data-setup-action="apply">Continue → choose workspace</button></footer></form></section>
      <section class="setup-workspaces" data-setup-stage="workspace" aria-label="Step 2: choose workspace" hidden>
        <div class="setup-committed"><div><small>YOUR VEHICLE IS READY</small><h3 data-setup="committed-name">Vehicle</h3></div><button type="button" data-setup-action="back">← Back to vehicle</button><dl data-setup="committed-specs"></dl></div>
        <div class="setup-workspace-grid">
          <button type="button" class="setup-workspace-card" data-workspace-choice="drive"><span class="setup-workspace-icon"><svg aria-hidden="true"><use href="#i-car"/></svg></span><strong>Drive</strong><span class="setup-workspace-description">Take the driver’s seat. Start the engine or enable READY, select a gear and use the pedals.</span><span class="setup-workspace-features">Dashboard · gears &amp; pedals · cabin controls<br>Manual controls · shared WLTC task above</span><span class="setup-workspace-enter">Enter Drive <b aria-hidden="true">→</b></span></button>
          <button type="button" class="setup-workspace-card" data-workspace-choice="service"><span class="setup-workspace-icon"><svg aria-hidden="true"><use href="#i-test"/></svg></span><strong>Diagnostics &amp; service</strong><span class="setup-workspace-description">Connect a scan tool, inspect the fitted units and follow a fault from its signal to the vehicle’s response.</span><span class="setup-workspace-features">Scan tool · fault tests · signals &amp; wiring<br>Unit map · connectors · vehicle configuration</span><span class="setup-workspace-enter">Enter Diagnostics &amp; service <b aria-hidden="true">→</b></span></button>
        </div>
        <p class="setup-shared-note"><svg aria-hidden="true"><use href="#i-car"/></svg><span>You can switch between both workspaces at any time. They share this vehicle, its faults and recorded data. WLTC is a shared driving task and keeps running when you open Diagnostics.</span></p>
      </section>
    </div>`;
    const $=id=>container.querySelector('[data-setup="'+id+'"]');
    let ctx=null,configKey=null,visible=false,pending=false,disposed=false,error='',lastStage='';
    const presets=()=>ctx?.vehicleConfigurations || [];
    const selected=()=>presets().find(p=>p.id===$('configuration').value)||presets()[0];
    function compatible(useDefaults=false){
      const preset=selected();if(!preset)return;
      const electric=preset.powertrain==='bev',hybrid=['hev','phev'].includes(preset.powertrain),ice=!electric&&!hybrid;
      const available=ice?['automatic_6','manual_6']:hybrid?['hybrid_power_split']:['single_speed'];
      const previous=$('transmission_type').value;
      $('transmission_type').innerHTML=available.map(id=>`<option value="${id}">${labels[id]}</option>`).join('');
      $('transmission_type').value=!useDefaults&&available.includes(previous)?previous:available[0];
      $('engine_detail').disabled=electric;$('cylinders').disabled=electric;
      $('soc-field').hidden=ice;$('initial_soc_pct').disabled=ice;
      $('heater_type').value=ice?'coolant':'electric';$('heater_type').disabled=true;
      $('heater-note').textContent=ice?'Cabin heating uses warm engine coolant. A cold engine cannot immediately supply full heat.':'This configuration uses an electric cabin heater. Heat and A/C draw energy from the traction battery.';
      $('description').textContent=preset.description;
      if(useDefaults){
        $('engine_detail').value=preset.engine_detail==='none'?'basic':preset.engine_detail;
        $('cylinders').value=String(preset.cylinders||4);$('mass_kg').value=String(preset.mass_kg);
        $('abs_installed').checked=!!preset.abs_installed;$('esp_installed').checked=!!preset.esp_installed;
      }
      updateChoice();
    }
    function updateChoice(){
      const manual=$('transmission_type').value==='manual_6';
      if(manual)$('driving_mode').value='manual';
      const wltc=$('driving_mode').querySelector('option[value="wltc_class3b"]');if(wltc)wltc.disabled=manual;
      const automated=$('driving_mode').value!=='manual';$('cycle-note').hidden=!automated;$('manual-note').hidden=automated;
      $('ac_installed').disabled=!$('hvac_installed').checked;if(!$('hvac_installed').checked)$('ac_installed').checked=false;
      $('environment-note').textContent=Number($('surface').value)===.9&&Number($('grade_pct').value)===0?'Baseline conditions selected.':'Modified road conditions: the virtual vehicle may follow the target less closely.';
      const preset=selected();
      $('summary').textContent=(preset?.label || 'Vehicle')+' · '+(labels[$('transmission_type').value] || '')+' · '+(automated?'WLTC Class 3b':'Manual driver');
      $('vehicle-kind').textContent=preset?.powertrain==='bev'?'BATTERY ELECTRIC':preset?.powertrain==='hev'?'HYBRID':preset?.powertrain==='phev'?'PLUG-IN HYBRID':preset?.powertrain==='diesel'?'DIESEL':'PETROL';
      const specs=[labels[$('transmission_type').value],preset?.powertrain==='bev'?'Electric drive sensors':($('engine_detail').value==='extended'?'Extended':'Basic')+' engine sensors',{fwd:'Front-wheel drive',rwd:'Rear-wheel drive',awd:'All-wheel drive'}[$('drivetrain').value],$('abs_installed').checked?'ABS fitted':'ABS not fitted',$('esp_installed').checked?'ESP fitted':'ESP not fitted',$('hvac_installed').checked?($('ac_installed').checked?'Cabin heater + A/C':'Cabin heater'):'No cabin climate'];
      $('chosen-specs').innerHTML=specs.filter(Boolean).map(text=>'<span>'+esc(text)+'</span>').join('');
    }
    function load(config){
      $('configuration').innerHTML=presets().map(p=>`<option value="${esc(p.id)}">${esc(p.label)}</option>`).join('');$('configuration').value=config.id;
      $('drivetrain').value=config.drivetrain || 'fwd';$('wheel_radius_mm').value=String((config.wheel_radius_m || .31)*1000);
      $('drag_area_m2').value=String(config.drag_area_m2 || .65);$('rolling_resistance').value=String(config.rolling_resistance || .012);
      $('can_bitrate').value=String(config.can_bitrate || 500000);$('hvac_installed').checked=config.hvac_installed!==false;$('ac_installed').checked=config.ac_installed!==false;
      $('ambient_c').value=String(config.ambient_c ?? 23);$('initial_soc_pct').value=String(ctx?.configurationOptions?.initial_soc_pct ?? ctx?.state?.soc_pct ?? 70);$('initial_odometer_km').value=String(config.initial_odometer_km ?? 0);
      $('surface').value=String(ctx?.testSettings?.road_mu ?? .9);$('grade_pct').value=String(ctx?.testSettings?.grade_pct ?? 0);
      $('driving_mode').value=ctx?.testSettings?.mode || 'wltc_class3b';compatible(true);
      $('mass_kg').value=String(config.mass_kg);$('transmission_type').value=config.transmission_type || $('transmission_type').value;
      $('engine_detail').value=config.engine_detail==='none'?'basic':config.engine_detail;$('cylinders').value=String(config.cylinders||4);
      $('abs_installed').checked=!!config.abs_installed;$('esp_installed').checked=!!config.esp_installed;updateChoice();
      const cycle=ctx?.meta?.drive_cycles?.find(c=>c.id==='wltc_class3b'),preview=cycle?.preview || cycle?.preview_points || [];
      if(preview.length){const pts=preview.map(p=>{const t=Array.isArray(p)?p[0]:p.t??p.time_s??p.t_s;const v=Array.isArray(p)?p[1]:p.speed_kph??p.speed;return [28+Number(t)/1800*532,96-Number(v)/140*78];});
        $('cycle-preview').innerHTML='<path d="M28 12V96H560" fill="none" stroke="#526579"/><path d="M28 57H560M28 18H560" stroke="#273747" stroke-dasharray="3 4"/><polyline points="'+pts.map(p=>p.join(',')).join(' ')+'" fill="none" stroke="#57d3bd" stroke-width="1.7"/><text x="28" y="116">0 min</text><text x="278" y="116">15 min</text><text x="514" y="116">30 min</text><text x="2" y="19">140</text><text x="8" y="99">0</text>';
      }else $('cycle-preview').innerHTML='<text x="20" y="45">Low → Medium → High → Extra high</text><text x="20" y="74">Official one-second speed samples · 1,800 seconds</text>';
    }
    async function submit(event){event.preventDefault();if(pending||ctx?.controlsBusy||(ctx?.workflow?.stage||'vehicle')!=='vehicle'||!selected())return;pending=true;error='';render();
      const configuration=$('configuration').value,preset=selected(),ice=['petrol','diesel'].includes(preset.powertrain);
      const hardware={transmission_type:$('transmission_type').value,drivetrain:$('drivetrain').value,mass_kg:Number($('mass_kg').value),wheel_radius_m:Number($('wheel_radius_mm').value)/1000,
        drag_area_m2:Number($('drag_area_m2').value),rolling_resistance:Number($('rolling_resistance').value),abs_installed:$('abs_installed').checked,esp_installed:$('esp_installed').checked,
        hvac_installed:$('hvac_installed').checked,ac_installed:$('ac_installed').checked,heater_type:$('heater_type').value,ambient_c:Number($('ambient_c').value),initial_coolant_c:Number($('ambient_c').value),can_bitrate:Number($('can_bitrate').value),initial_odometer_km:Number($('initial_odometer_km').value)};
      if(preset.powertrain!=='bev'){hardware.engine_detail=$('engine_detail').value;hardware.cylinders=Number($('cylinders').value);}
      if(!ice)hardware.initial_soc_pct=Number($('initial_soc_pct').value);
      try{await options.onSetup?.(configuration,hardware,{mode:$('driving_mode').value,road_mu:Number($('surface').value),grade_pct:Number($('grade_pct').value)});}
      catch(e){error=e.message;}finally{pending=false;render();}
    }
    function render(){
      if(disposed)return;
      const workflow=ctx?.workflow || {},stage=workflow.stage || 'vehicle',workspace=stage==='workspace',editing=!!workflow.editing,busy=pending||!!ctx?.controlsBusy;
      container.querySelector('[data-setup-stage="vehicle"]').hidden=workspace;
      container.querySelector('[data-setup-stage="workspace"]').hidden=!workspace;
      const step1=container.querySelector('[data-setup-step="vehicle"]'),step2=container.querySelector('[data-setup-step="workspace"]');
      step1.classList.toggle('complete',workspace);step1.classList.toggle('current',!workspace);step2.classList.toggle('current',workspace);
      step1.setAttribute('aria-current',workspace?'false':'step');step2.setAttribute('aria-current',workspace?'step':'false');
      $('eyebrow').textContent=workspace?'STEP 2 OF 2':editing?'VEHICLE CONFIGURATION':'STEP 1 OF 2';
      $('heading').textContent=workspace?'Choose a workspace':editing?'Change vehicle configuration':'Choose your vehicle';
      $('intro').textContent=workspace?'The vehicle is prepared. Open the workspace you want to use first.':editing?'Edit the complete vehicle here. Your current run stays paused until you apply or cancel.':'Start with a vehicle, adjust its equipment if needed, then choose what to do.';
      $('replacement-note').hidden=!editing;
      const cancel=container.querySelector('[data-setup-action="cancel"]');cancel.hidden=workspace||!workflow.complete;cancel.disabled=busy||workflow.canCancel===false;cancel.textContent=editing?'Cancel changes':'Back to workspace choice';
      cancel.title=workflow.recoveryRequired?'Apply again to confirm the vehicle before returning.':'';
      const apply=container.querySelector('[data-setup-action="apply"]');apply.disabled=busy||!selected();apply.textContent=pending?'Preparing vehicle…':editing?'Apply vehicle & return':'Continue → choose workspace';
      $('apply-note').textContent=editing?'Changed settings start a new session. Unchanged settings keep the current vehicle and data.':'Continue prepares this vehicle. You choose Drive or Diagnostics & service next.';
      $('error').hidden=!error;$('error').textContent=error;
      container.querySelectorAll('[data-workspace-choice],[data-setup-action="back"],[data-setup-action="export"]').forEach(button=>button.disabled=busy);
      const config=ctx?.state?.vehicle?.configuration;
      if(config){
        $('committed-name').textContent=config.label;
        const items=[['Transmission',labels[config.transmission_type] || config.transmission],['Driven wheels',{fwd:'Front-wheel drive',rwd:'Rear-wheel drive',awd:'All-wheel drive'}[config.drivetrain] || 'Front-wheel drive'],['Chassis electronics',[config.abs_installed?'ABS fitted':'ABS not fitted',config.esp_installed?'ESP fitted':'ESP not fitted'].join(' · ')],['Cabin equipment',config.hvac_installed===false?'Not fitted':config.ac_installed===false?'Heater / ventilation':'Heater / ventilation + A/C'],['Driving task',ctx?.testSettings?.mode==='manual'?'Manual driver':'Automatic WLTC Class 3b'],['Environment',(config.ambient_c ?? 20)+' °C · '+Number(ctx?.testSettings?.grade_pct || 0)+'% slope']];
        $('committed-specs').innerHTML=items.map(([label,value])=>'<div><dt>'+esc(label)+'</dt><dd>'+esc(value)+'</dd></div>').join('');
      }
      if(visible&&lastStage&&lastStage!==stage)$('heading').focus?.();
      lastStage=stage;
    }
    function change(event){const id=event.target.dataset.setup;if(id==='configuration')compatible(true);else if(id==='esp_installed'&&$('esp_installed').checked)$('abs_installed').checked=true;else if(id==='abs_installed'&&!$('abs_installed').checked)$('esp_installed').checked=false;updateChoice();}
    function invalid(event){for(let node=event.target?.parentElement;node&&node!==container;node=node.parentElement){if(node.tagName==='DETAILS')node.open=true;}}
    function click(event){
      const target=event.target.closest?.('[data-setup-action],[data-workspace-choice]');if(!target||target.disabled)return;
      if(target.dataset.workspaceChoice){if(ctx?.workflow?.stage==='workspace')options.onChooseWorkspace?.(target.dataset.workspaceChoice);return;}
      const action=target.dataset.setupAction;
      if(action==='cancel')options.onCancelSetup?.();
      if(action==='back')options.onBackToVehicle?.();
      if(action==='export')options.onExport?.();
      if(action==='baseline'){$('surface').value='0.9';$('grade_pct').value='0';updateChoice();}
    }
    $('form').addEventListener('submit',submit);$('form').addEventListener('invalid',invalid,true);container.addEventListener('change',change);container.addEventListener('input',updateChoice);container.addEventListener('click',click);
    return {
      update(next){ctx=next;const config=ctx.state?.vehicle?.configuration;if(config){const key=ctx.workflow?ctx.workflow.draftRevision:JSON.stringify([config,ctx.testSettings]);if(key!==configKey){configKey=key;load(config);error='';}}render();},
      setVisible(value){visible=!!value;},resize(){},
      inspect(){return{visible,pending,error,stage:ctx?.workflow?.stage || 'vehicle',mode:$('driving_mode').value,transmission:$('transmission_type').value};},
      dispose(){disposed=true;$('form').removeEventListener('submit',submit);$('form').removeEventListener('invalid',invalid,true);container.removeEventListener('change',change);container.removeEventListener('input',updateChoice);container.removeEventListener('click',click);}
    };
  }
  window.SetupView={create};
})();
