/* Interactive learning book. Plain-language explanations are supplied by the
 * same Python state that drives the diagrams. Reading a page never resets it. */
(() => {
  'use strict';
  const NS='http://www.w3.org/2000/svg';
  const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
  const svgEl=(tag,attrs,text)=>{const n=document.createElementNS(NS,tag);for(const [k,v]of Object.entries(attrs||{}))n.setAttribute(k,String(v));if(text!==undefined)n.textContent=text;return n;};
  const presets={
    engine:{profile:'engine',scenario:'manual',config:{initial_coolant_c:25,ambient_c:25},inputs:{ignition:true,throttle:.12,brake:0,fault:'none'}},
    low_soc:{profile:'phev',scenario:'manual',config:{initial_soc_pct:22,initial_coolant_c:25},inputs:{ignition:true,throttle:.3,brake:0,fault:'none'}},
    phev_city:{profile:'phev',scenario:'phev_city',config:{},inputs:{fault:'none'}},
    abs_split_mu:{profile:'braking',scenario:'abs_split_mu',config:{},inputs:{fault:'none'}},
    wheel_fault:{profile:'braking',scenario:'manual',config:{initial_speed_kph:70},inputs:{ignition:true,throttle:0,brake:.65,road_mu:.8,fault:'none'}},
    ect_open:{profile:'engine',scenario:'manual',config:{initial_coolant_c:25,ambient_c:25},inputs:{ignition:true,throttle:.12,brake:0,fault:'none'}},
    bmu_timeout:{profile:'phev',scenario:'manual',config:{initial_soc_pct:65},inputs:{ignition:true,throttle:.3,brake:0,fault:'none'}}
  };
  const channelSets={ect_loop:['rpm','coolant_c'],ect_circuit:['coolant_c','sensors.ect_c','sensors.ect_used_c'],hybrid:['speed_kph','battery_current_a','soc_pct'],brakes:['speed_kph','sensors.wheel_speeds_kph.0','slips.0']};
  const friendlyTitles={engine:'Engine on a test stand',phev:'Hybrid vehicle',braking:'Braking vehicle'};
  const friendlySignals={
    coolant_c:'Actual coolant temperature',rpm:'How fast the engine turns',speed_kph:'How fast the vehicle moves',
    'sensors.ect_c':'Temperature reported by the sensor','sensors.ect_used_c':'Temperature used by the computer',
    'sensors.ect_voltage_v':'Electrical signal read by the computer','sensors.ect_node_v':'Voltage on the sensor wire',
    'sensors.ect_adc_count':'Input converted to a digital number',battery_current_a:'Current entering or leaving the battery',
    soc_pct:'Battery charge remaining','sensors.wheel_speeds_kph.0':'Reported front-left wheel speed',
    'wheel_speeds_kph.0':'Actual front-left wheel speed','slips.0':'Front-left wheel slip',
    'bmu_report.pack_current_a':'Last current report from the battery monitor','sensors.bmu_message_age_ms':'Age of the battery report'
  };
  const format=(value,unit='')=>value==null?'No reading':(typeof value==='number'?value.toFixed(unit==='rpm'?0:1):String(value))+(unit?' '+unit:'');
  const clone=value=>JSON.parse(JSON.stringify(value));
  function init({container,chapterContent,LabUI,onAdvanced}){
    if(typeof container==='string')container=document.querySelector(container);
    if(!container||!LabUI)throw new Error('LearningReader needs a container and LabUI.');
    const content=chapterContent||window.LessonContent||{chapters:[],glossary:[]};
    const chapters=content.chapters||[],glossary=content.glossary||[],catalog=LabUI.meta()?.signals||[];
    let activeChapter=chapters[0]||{id:'welcome',title:'Welcome',paragraphs:[],diagram:'ect_loop',experiment:'engine'},activeKey=activeChapter.id;
    let state=LabUI.state(),records={},explanation=null,book=[],events=[],busy=false,playing=false,currentDiagram='',selectedNode=0,referenceView=false,destroyed=false;
    const navButtons=[],chapterButtonMap=new Map(),referenceButtonMap=new Map(),controlButtons=[];
    const root=el('div','lr-book');container.replaceChildren(root);
    const nav=el('aside','lr-nav'),navHead=el('div','lr-nav-head'),navTitle=el('h2','','Learning book'),navNote=el('p','','Read a little. Change one thing. See what happens.');
    const navToggle=el('button','lr-nav-toggle','Chapters & reference');navToggle.type='button';navToggle.setAttribute('aria-expanded','true');
    const search=el('input','lr-search');search.type='search';search.placeholder='Find a chapter or word';search.setAttribute('aria-label','Find a chapter or glossary word');
    const tree=el('nav','lr-tree');tree.setAttribute('aria-label','Learning book contents');
    navHead.append(navTitle,navNote,navToggle,search);nav.append(navHead,tree);
    const navFoot=el('div','lr-nav-foot'),pdf=el('a','','Download reading copy');pdf.href='/OBDII_Beginner_Handbook.pdf';pdf.target='_blank';pdf.rel='noopener';
    const fullPdf=el('a','','Complete theory PDF');fullPdf.href='/OBDII_Learning_Guide.pdf';fullPdf.target='_blank';fullPdf.rel='noopener';
    const advanced=el('button','lr-advanced','Open detailed instruments');advanced.type='button';advanced.onclick=()=>{stopPlaying();onAdvanced?.();};
    navFoot.append(pdf,fullPdf,advanced,el('p','','Changing pages keeps your experiment. Start experiment creates a fresh one.'));nav.append(navFoot);
    const page=el('section','lr-page'),pageHead=el('header','lr-page-head'),breadcrumb=el('p','lr-breadcrumb'),title=el('h1','lr-title'),subtitle=el('p','lr-subtitle');
    const topTools=el('div','lr-page-tools'),back=el('button','','← Previous'),next=el('button','','Next chapter →'),jump=el('button','','Go to the experiment ↓');back.type=next.type=jump.type='button';topTools.append(back,next,jump);pageHead.append(breadcrumb,title,subtitle,topTools);
    const body=el('div','lr-body'),article=el('article','lr-article'),workbench=el('aside','lr-workbench');workbench.setAttribute('aria-label','Live experiment beside the chapter');
    jump.onclick=()=>workbench.scrollIntoView?.({behavior:'smooth',block:'start'});body.append(article,workbench);page.append(pageHead,body);root.append(nav,page);
    const liveHead=el('div','lr-live-head'),liveTitle=el('h2','','Your experiment'),clock=el('span','lr-clock','Not started');liveHead.append(liveTitle,clock);
    const experimentName=el('p','lr-experiment-name','Choose Start experiment to begin this chapter.'),modelNotice=el('p','lr-model-notice');
    const controlCard=el('section','lr-controls'),start=el('button','lr-start','Start this experiment');start.type='button';start.dataset.readerAction='start';controlButtons.push(start);
    const playRow=el('div','lr-play-row'),play=el('button','','▶ Watch it run'),step=el('button','','One small step'),longStep=el('button','','Run five seconds');
    for(const b of[play,step,longStep]){b.type='button';controlButtons.push(b);}play.dataset.readerAction='play';step.dataset.readerAction='step';longStep.dataset.readerAction='advance-five';playRow.append(play,step,longStep);
    const status=el('p','lr-status','Use Start this experiment, then change one control.');status.setAttribute('role','status');
    controlCard.append(start,playRow,status);
    const setup=el('details','lr-setup'),setupSummary=el('summary','','Choose the starting conditions');setup.append(setupSummary);
    const tempWrap=el('div','lr-input'),tempLabel=el('label','','Starting coolant temperature'),tempValue=el('output','','25°C'),temp=el('input');temp.type='range';temp.min='-10';temp.max='90';temp.step='5';temp.value='25';temp.id='lr-start-temperature';tempLabel.htmlFor=temp.id;tempLabel.append(tempValue);tempWrap.append(tempLabel,temp,el('small','','Coolant is the liquid carrying heat away from the engine. This value is applied by Start experiment.'));
    const socWrap=el('div','lr-input'),socLabel=el('label','','Starting battery charge'),socValue=el('output','','75%'),soc=el('input');soc.type='range';soc.min='10';soc.max='95';soc.step='1';soc.value='75';soc.id='lr-start-charge';socLabel.htmlFor=soc.id;socLabel.append(socValue);socWrap.append(socLabel,soc,el('small','','Like a fuel gauge for the battery. Applied by Start experiment.'));
    setup.append(tempWrap,socWrap);
    temp.oninput=()=>tempValue.textContent=temp.value+'°C';soc.oninput=()=>socValue.textContent=soc.value+'%';
    const driver=el('div','lr-driver'),accelerator=rangeControl('lr-accelerator','Ask for more power','0','70','1','12','%','More pedal asks the controller for more drive. Change it, then watch the response.'),brake=rangeControl('lr-brake','Press the brake','0','100','1','0','%','The wheel model slows through friction braking and, when available, energy recovery.');
    driver.append(accelerator.wrapper,brake.wrapper);controlCard.append(setup,driver);
    const story=el('section','lr-story'),storyTitle=el('h3','','What is happening now'),storyHeading=el('p','lr-story-heading','Waiting for the model'),storySummary=el('p','lr-story-summary','Start or step the experiment to read its current explanation.');
    const narrative=el('dl','lr-narrative'),narrativeItems={};for(const[key,label]of[['what_changed','What changed'],['computer_action','What the computer does'],['why','Why this happens'],['next_step','Try next']]){const term=el('dt','',label),definition=el('dd','','—');narrative.append(term,definition);narrativeItems[key]=definition;}
    story.append(storyTitle,storyHeading,storySummary,narrative);
    const picture=el('section','lr-picture'),pictureHead=el('div','lr-section-head'),pictureTitle=el('h3','','Follow the cause and effect'),viewNote=el('span','','Select a box for a note');pictureHead.append(pictureTitle,viewNote);
    const pictureCanvas=el('div','lr-picture-canvas'),pictureNote=el('div','lr-picture-note');pictureNote.setAttribute('role','status');picture.append(pictureHead,pictureCanvas,pictureNote);
    const observations=el('section','lr-observations'),observationTitle=el('h3','','Read the result in words'),observationList=el('div','lr-observation-list');observations.append(observationTitle,observationList);
    const faultCard=el('section','lr-faults'),faultTitle=el('h3','','Try a missing signal'),faultIntro=el('p','','Disconnect one input and watch how the controller reacts. These switches change only the virtual experiment.'),faultChoices=el('div','lr-fault-choices'),repairText=el('p','lr-repair-note');
    const faultDefs=[['ect_open','Disconnect the temperature sensor','The engine computer loses a usable coolant-temperature measurement.'],['wheel_fl_dropout','Disconnect the front-left wheel sensor','The vehicle still moves; its computer can no longer read this wheel.'],['bmu_timeout','Stop the battery monitor reports','The battery continues to exist, but fresh status messages stop arriving.']];
    const faultButtons=new Map();for(const[name,label,hint]of faultDefs){const b=el('button','',label);b.type='button';b.title=hint;b.dataset.readerFault=name;b.onclick=()=>perform(async()=>{LabUI.setFault(name);await LabUI.advance(.1);setStatus('Input disconnected. Watch the explanation, then use One small step to follow the decision.');});faultChoices.append(b);faultButtons.set(name,b);controlButtons.push(b);}
    const repair=el('button','lr-repair','Reconnect / restore the input'),restart=el('button','','Restart after repair');repair.type=restart.type='button';repair.dataset.readerAction='repair';restart.dataset.readerAction='restart';controlButtons.push(repair,restart);
    repair.onclick=()=>perform(async()=>{LabUI.setFault('none');await LabUI.advance(.1);setStatus('The input is restored. Read the repair note: some protection remains remembered until restart.');});
    restart.onclick=()=>perform(async()=>{LabUI.setFault('none');LabUI.setInputs({ignition:false});await LabUI.advance(.2);LabUI.setInputs({ignition:true});await LabUI.advance(.8);setStatus('Power was switched off and on in the model. Watch the controller check its inputs again.');});
    const repairs=el('div','lr-repair-actions');repairs.append(repair,restart);faultCard.append(faultTitle,faultIntro,faultChoices,el('small','','One injected fault is active at a time. Choosing another replaces it.'),repairs,repairText);
    const diagnosis=el('section','lr-diagnosis'),diagnosisTitle=el('h3','','Ask the engine computer'),readWarning=el('button','','Read remembered engine warnings'),clearWarning=el('button','','Clear remembered engine warnings'),diagnosticText=el('p','lr-diagnostic-text','The answer will be translated into words here.');
    readWarning.type=clearWarning.type='button';readWarning.dataset.readerAction='read-warnings';clearWarning.dataset.readerAction='clear-warnings';controlButtons.push(readWarning,clearWarning);
    const diagButtons=el('div','lr-diagnostic-buttons');diagButtons.append(readWarning,clearWarning);diagnosis.append(diagnosisTitle,diagButtons,diagnosticText,el('small','','Clearing a remembered warning does not reconnect a sensor. Battery and brake-module warnings have separate explanations above.'));
    const technical=el('details','lr-technical'),technicalSummary=el('summary','','Look closer at the electronics and measured signals');technical.append(technicalSummary,el('p','','Optional detail: the same experiment shown as an electrical/control schematic. A voltage is an electrical measurement; it is not itself a temperature.'));
    const technicalLayout=el('div','lr-technical-layout'),schematicContainer=el('div','lr-schematic'),inspector=el('aside','lr-inspector');technicalLayout.append(schematicContainer,inspector);technical.append(technicalLayout);
    const probeRow=el('div','lr-probe-row'),probeChoice=el('select'),probeAdd=el('button','','Add a trace');probeChoice.setAttribute('aria-label','Measurement to plot');probeAdd.type='button';
    for(const m of catalog.filter(s=>s.kind!=='state')){const option=el('option','',friendlySignals[m.id]||m.label);option.value=m.id;probeChoice.append(option);}probeRow.append(probeChoice,probeAdd);
    const scopeContainer=el('div','lr-scope'),scopeNote=el('p','lr-small','A trace is a measurement drawn over time. Each row uses its own units. Saved points are one tenth of a second apart; dashed values are invalid, substituted or old.');technical.append(el('h3','','Measurements over time'),probeRow,scopeContainer,scopeNote);
    const byteDetails=el('details','lr-bytes'),byteSummary=el('summary','','Show the exact diagnostic message'),byteText=el('pre','','No diagnostic request yet.');byteDetails.append(byteSummary,byteText);technical.append(byteDetails);
    const limitations=el('p','lr-small lr-boundary','This is a simplified teaching model. The wiring names are illustrative, and the hybrid model is generic. The computer does not run production vehicle firmware.');
    workbench.append(liveHead,experimentName,modelNotice,controlCard,picture,story,observations,faultCard,diagnosis,technical,limitations);
    const schematic=window.Schematic.init({container:schematicContainer,inspector,catalog,onProbe:addProbe,onFault:name=>perform(async()=>{LabUI.setFault(name);await LabUI.advance(.1);})});
    const scope=window.SignalScope.init({container:scopeContainer,catalog:catalog.map(m=>({...m,label:friendlySignals[m.id]||m.label}))});
    scope.setChannels(channelSets.ect_loop);
    technical.ontoggle=()=>{if(technical.open)requestAnimationFrame(()=>scope.redraw());};
    probeAdd.onclick=()=>addProbe(probeChoice.value);
    let pictureNodes=[],pictureSvg;

    function rangeControl(id,label,min,max,stepValue,value,unit,hint){const wrapper=el('div','lr-input'),l=el('label','',label),output=el('output','',value+unit),input=el('input');input.type='range';Object.assign(input,{id,min,max,step:stepValue,value});l.htmlFor=id;l.append(output);wrapper.append(l,input,el('small','',hint));return {wrapper,input,output};}
    function setStatus(text){status.textContent=text;}
    function refreshClock(){clock.textContent=state?(playing?'Running · ':'Paused · ')+Number(state.t).toFixed(1)+' seconds':'Not started';}
    function stopPlaying(){playing=false;play.textContent='▶ Watch it run';play.setAttribute('aria-pressed','false');refreshClock();}
    async function perform(action){
      if(busy&&!playing){setStatus('The previous change is still being applied. You can try again in a moment.');return false;}
      stopPlaying();while(busy)await new Promise(resolve=>setTimeout(resolve,10));busy=true;controlButtons.forEach(b=>b.disabled=true);
      try{await LabUI.pause();await action();return true;}catch(error){setStatus(error.message||'The experiment could not apply this change.');return false;}finally{busy=false;refreshControls();}
    }
    async function startExperiment(){const preset=clone(presets[activeChapter.experiment]||presets.engine);preset.config.initial_coolant_c=Number(temp.value);if(preset.profile!=='engine')preset.config.initial_soc_pct=Number(soc.value);await LabUI.loadExperiment(preset);await LabUI.advance(1);setStatus('A fresh experiment is ready. Change one input, or disconnect a signal, and compare the result.');}
    start.onclick=()=>perform(startExperiment);
    play.onclick=async()=>{if(playing){stopPlaying();setStatus('Paused. The experiment keeps its current values.');return;}if(busy)return;await LabUI.pause();playing=true;play.textContent='Ⅱ Pause and inspect';play.setAttribute('aria-pressed','true');refreshClock();setStatus('The model is running. Pause whenever you want to read a result.');};
    step.onclick=()=>perform(async()=>{await LabUI.advance(.1);setStatus('The model advanced one tenth of a second. Read what changed.');});
    longStep.onclick=()=>perform(async()=>{await LabUI.advance(5);setStatus('Five seconds of model time have passed. Compare the new result with your prediction.');});
    function driverChange(){const inputs={throttle:Number(accelerator.input.value)/100,brake:Number(brake.input.value)/100};accelerator.output.textContent=accelerator.input.value+'%';brake.output.textContent=brake.input.value+'%';LabUI.setInputs(inputs);if(!playing&&!busy)perform(async()=>{await LabUI.advance(.1);setStatus('Your pedal request has changed. Use Watch it run to see the response develop.');});}
    accelerator.input.oninput=driverChange;brake.input.oninput=driverChange;
    readWarning.onclick=()=>perform(async()=>{const result=await LabUI.diagnostic('03');showDiagnostic(result);});
    clearWarning.onclick=()=>perform(async()=>{const result=await LabUI.diagnostic('04');showDiagnostic(result,true);});
    function showDiagnostic(result,cleared=false){
      if(!result)return;state=LabUI.state();const has=state?.dtcs?.includes('P0118'),plain=result.diagnostic_explanation||result.plain_explanation;
      diagnosticText.textContent=cleared?'The remembered engine warning was cleared. If the sensor is still disconnected, the computer will detect the problem again.':has?'The engine computer remembers a coolant-temperature sensor signal problem. This describes the electrical input; it does not prove that the coolant is cold.':'The engine computer has no stored warning in this teaching example. A newly disconnected input may still be under observation.';
      if(plain)diagnosticText.textContent=[plain.answer,plain.explanation,plain.next_step].filter(Boolean).join(' ');
      byteText.textContent=(result.request_hex||'')+' → '+(result.response_hex||'No response')+'\n'+(result.meaning||'');
    }
    function addProbe(id){const result=scope.addSignal(id);if(!result.ok){setStatus(result.reason);return;}technical.open=true;setStatus('A trace was added for '+(friendlySignals[id]||catalog.find(x=>x.id===id)?.label||'the selected measurement')+'.');scopeContainer.scrollIntoView?.({behavior:'smooth',block:'nearest'});}
    function addNavButton(parent,label,key,action,cls=''){const b=el('button','lr-nav-link '+cls,label);b.type='button';b.dataset.readerNav=key;b.onclick=action;parent.append(b);navButtons.push(b);return b;}
    const groupNames=[...new Set(chapters.map(c=>c.group||'Learn by trying'))];
    for(const group of groupNames){const details=el('details','lr-nav-group');details.open=true;details.append(el('summary','',group));for(const chapter of chapters.filter(c=>(c.group||'Learn by trying')===group)){const b=addNavButton(details,chapter.title,chapter.id,()=>activateChapter(chapter.id));b.dataset.readerChapter=chapter.id;chapterButtonMap.set(chapter.id,b);}tree.append(details);}
    const glossaryButton=addNavButton(tree,'Words explained','glossary',showGlossary,'lr-nav-special');
    const refs=el('details','lr-nav-group lr-references');refs.open=false;refs.append(el('summary','','Complete theory & reference'),el('p','lr-nav-loading','Loading the reference book…'));tree.append(refs);
    navToggle.onclick=()=>{const collapsed=nav.classList.toggle('lr-nav-collapsed');navToggle.setAttribute('aria-expanded',String(!collapsed));};
    search.oninput=()=>{const query=search.value.toLowerCase().trim();for(const b of navButtons)b.hidden=!!query&&!b.textContent.toLowerCase().includes(query);const glossaryMatch=query&&glossary.some(g=>[g.term,g.plain,g.detail].join(' ').toLowerCase().includes(query));glossaryButton.hidden=!!query&&!glossaryMatch&&!glossaryButton.textContent.toLowerCase().includes(query);if(query)tree.querySelectorAll('details').forEach(d=>d.open=true);};
    tree.onkeydown=e=>{if(!['ArrowDown','ArrowUp','Home','End'].includes(e.key)||e.target.tagName!=='BUTTON')return;const visible=navButtons.filter(b=>!b.hidden&&!b.closest('details:not([open])'));let index=visible.indexOf(e.target);if(index<0)return;e.preventDefault();if(e.key==='Home')index=0;else if(e.key==='End')index=visible.length-1;else index=Math.max(0,Math.min(visible.length-1,index+(e.key==='ArrowDown'?1:-1)));visible[index]?.focus();};
    function selectNav(key){activeKey=key;for(const b of navButtons){const selected=b.dataset.readerNav===key;b.classList.toggle('lr-selected',selected);if(selected)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');}search.value='';navButtons.forEach(b=>b.hidden=false);}
    function paragraph(parent,text,cls){if(text)parent.append(el('p',cls||'',text));}
    function list(parent,items,ordered=false){if(!items?.length)return;const node=el(ordered?'ol':'ul');for(const item of items)node.append(el('li','',typeof item==='string'?item:item.text||item.label||''));parent.append(node);}
    function sectionHeading(parent,text){parent.append(el('h2','',text));}
    function activateChapter(id){
      const chapter=chapters.find(c=>c.id===id);if(!chapter)return;activeChapter=chapter;referenceView=false;selectNav(id);root.classList.remove('lr-reference-view');
      breadcrumb.textContent=chapter.group||'Learn by trying';title.textContent=chapter.title;subtitle.textContent=chapter.subtitle||'';article.replaceChildren();article.classList.remove('lr-reference-content');
      const goal=el('div','lr-goal');goal.append(el('strong','','What you will understand'));paragraph(goal,chapter.goal);article.append(goal);
      sectionHeading(article,'The idea in everyday words');for(const p of chapter.paragraphs||[])paragraph(article,p);
      sectionHeading(article,chapter.tryLabel||'Try it for yourself');list(article,chapter.steps,true);
      sectionHeading(article,'What to look for');list(article,chapter.observe);
      if(chapter.question){const question=el('aside','lr-reflect');question.append(el('strong','','Before you change it, make a prediction'));paragraph(question,chapter.question);article.append(question);}
      const help=el('div','lr-help');help.append(el('strong','','A word you do not know?'));paragraph(help,'Open Words explained. You can keep this experiment running while you read.');const link=el('button','','Open the plain-language glossary');link.type='button';link.onclick=showGlossary;help.append(link);article.append(help);
      if(chapter.reference){const ref=el('button','lr-reference-link','Read the deeper explanation');ref.type='button';ref.onclick=()=>openReference(chapter.reference.doc,chapter.reference.heading);article.append(ref);}
      const index=chapters.indexOf(chapter);back.disabled=index<=0;next.disabled=index>=chapters.length-1;back.onclick=()=>activateChapter(chapters[index-1]?.id);next.onclick=()=>activateChapter(chapters[index+1]?.id);
      const preset=presets[chapter.experiment]||presets.engine;temp.value=String(preset.config.initial_coolant_c??25);temp.oninput();soc.value=String(preset.config.initial_soc_pct??75);soc.oninput();socWrap.hidden=preset.profile==='engine';
      start.textContent='Start this experiment';configureDiagram(chapter.diagram||'ect_loop');refreshControls();setStatus('You are reading '+chapter.title+'. Your current experiment is unchanged. Choose Start this experiment for a fresh example.');
    }
    function showGlossary(query=search.value.trim()){query=typeof query==='string'?query.toLowerCase():'';referenceView=true;selectNav('glossary');root.classList.add('lr-reference-view');breadcrumb.textContent='Reference you can read at any time';title.textContent='Words explained';subtitle.textContent='Plain meanings first. Technical names are here when you need them.';article.replaceChildren();article.classList.remove('lr-reference-content');for(const entry of glossary.filter(g=>!query||[g.term,g.plain,g.detail].join(' ').toLowerCase().includes(query))){const card=el('section','lr-glossary-entry');card.append(el('h2','',entry.term),el('p','lr-plain-definition',entry.plain));paragraph(card,entry.detail);article.append(card);}back.disabled=next.disabled=true;setStatus('Reading the glossary keeps the same experiment and recorded traces.');}
    function setBook(data){book=Array.isArray(data?.documents)?data.documents:[];refs.replaceChildren(el('summary','','Complete theory & reference'));for(const doc of book){const group=el('details','lr-document');group.append(el('summary','',doc.title));const open=addNavButton(group,'Read this document','ref:'+doc.id,()=>openReference(doc.id));referenceButtonMap.set(doc.id,open);for(const heading of doc.headings||[]){if(heading.level>3)continue;const b=addNavButton(group,heading.title,'ref:'+doc.id+'#'+heading.id,()=>openReference(doc.id,heading.id),'lr-nav-heading lr-depth-'+heading.level);referenceButtonMap.set(doc.id+'#'+heading.id,b);}refs.append(group);}if(!book.length)refs.append(el('p','lr-nav-loading','The reference book has not been generated yet. The PDF links remain available.'));}
    function matchDoc(id){const token=String(id||'').replace(/^.*\//,'').replace(/\.(md|html)$/i,'').toLowerCase();return book.find(d=>String(d.id).toLowerCase()===token||String(d.id).toLowerCase().replace(/\.(md|html)$/i,'')===token);}
    function openReference(id,heading){
      const doc=matchDoc(id);if(!doc){setStatus('That reference chapter is not available in the reader yet. You can use the complete theory PDF.');return;}
      referenceView=true;root.classList.add('lr-reference-view');const h=heading&&(doc.headings||[]).find(x=>x.id===heading||x.id.endsWith('--'+heading)||x.title===heading);selectNav('ref:'+doc.id+(h?'#'+h.id:''));refs.open=true;referenceButtonMap.get(doc.id)?.closest('details').setAttribute('open','');
      breadcrumb.textContent='Complete theory & reference';title.textContent=doc.title;subtitle.textContent='The whole document is available here. Your current experiment stays beside it.';article.innerHTML=doc.html||'';article.classList.add('lr-reference-content');
      article.querySelectorAll('a[href]').forEach(a=>{const href=a.getAttribute('href');if(/^https?:/.test(href)){a.target='_blank';a.rel='noopener';}a.addEventListener('click',event=>{if(href.startsWith('#')){event.preventDefault();findHeading(href.slice(1))?.scrollIntoView?.({behavior:'smooth',block:'start'});}else if(href.startsWith('/docs/')){const [path,hash]=href.split('#');const target=matchDoc(path);if(target){event.preventDefault();openReference(target.id,hash);}}});});
      back.disabled=next.disabled=true;setStatus('Reading this document does not change the simulation.');if(h)requestAnimationFrame(()=>findHeading(h.id)?.scrollIntoView?.({behavior:'smooth',block:'start'}));
    }
    function findHeading(id){return [...article.querySelectorAll('[id]')].find(n=>n.id===id);}
    function refreshControls(){
      const desired=(presets[activeChapter.experiment]||presets.engine).profile,installed=state?.profile;
      for(const b of controlButtons)b.disabled=busy;
      accelerator.input.disabled=busy||installed==='braking';brake.input.disabled=busy||installed==='engine';
      for(const[name,b]of faultButtons)b.disabled=busy||!state||(name!=='ect_open'&&installed==='engine');
      modelNotice.hidden=installed===desired||!installed;
      modelNotice.textContent=installed&&installed!==desired?'This page describes a different setup. The current experiment is still '+(friendlyTitles[installed]||installed)+'. Choose Start this experiment when you are ready.':'';
      repair.disabled=busy||!state;restart.disabled=busy||!state;
    }
    function renderExplanation(){
      if(!explanation)return;storyHeading.textContent=explanation.heading||'Current experiment';storySummary.textContent=explanation.summary||'';for(const[key,node]of Object.entries(narrativeItems))node.textContent=explanation[key]||'—';
      observationList.replaceChildren();for(const item of explanation.observations||[]){const card=el('div','lr-observation'),label=el('h4','',item.label),word=el('strong','',item.value_text),meaning=el('p','',item.meaning),statusBadge=el('span','lr-reading-status',item.status||'');card.dataset.status=item.status||'';card.append(label,word,meaning,statusBadge);observationList.append(card);}
      repairText.textContent=explanation.fault?.repair_instruction||'Restore a signal after the experiment, then compare the normal and faulted behavior.';
      for(const[name,b]of faultButtons){const active=explanation.fault?.name===name&&explanation.fault?.present;b.classList.toggle('lr-fault-active',!!active);b.setAttribute('aria-pressed',String(!!active));}
    }
    function configureDiagram(id){if(id===currentDiagram)return;currentDiagram=id;schematic.setDiagram(id);scope.setChannels(channelSets[id]||channelSets.ect_loop);selectedNode=0;buildPicture();if(state)schematic.setState(state);renderPicture();}
    function pictureData(){
      const s=state||{},sensor=s.sensors||{},isEngine=currentDiagram.startsWith('ect_');
      if(isEngine){const valid=sensor.ect_sensor_valid,backup=(s.ect_derate_factor??1)<1;return [
        {title:'The real engine',status:'Actual coolant temperature',measurement:format(s.coolant_c,'°C'),note:'This is the actual temperature inside the model. Unplugging the sensor does not instantly cool the engine.'},
        {title:'Temperature sensor',status:!sensor.ect_powered?'Not powered':valid?'A usable reading':'No usable temperature',measurement:valid?format(sensor.ect_c,'°C'):'Input missing or invalid',note:'The sensor turns temperature into an electrical signal. When the path is open, the wire can have a voltage without containing a believable temperature measurement.',warning:!valid},
        {title:'Engine computer',status:!sensor.ect_powered?'Not powered':backup?'Uses a backup value':valid?'Uses the sensor reading':'Checks the input',measurement:backup?'Backup: '+format(sensor.ect_used_c,'°C'):'Decides what to request',note:'The computer checks the signal before trusting it. After a persistent fault it substitutes a teaching fallback and remembers a warning.',warning:backup},
        {title:'Engine response',status:!s.engine_running?'Engine is stopped':backup?'Reduced power request':'Normal power request',measurement:format(s.rpm,'rpm'),note:'The engine follows the controller request through its inertia. A changed request takes time to change engine speed.',warning:backup}
      ];}
      if(currentDiagram==='brakes'){const installed=s.profile!=='engine',missing=sensor.wheel_speeds_kph?.[0]==null;return[
        {title:'The moving vehicle',status:installed?(s.speed_kph>1?'Still moving':'Almost stopped'):'Not in this setup',measurement:installed?format(s.speed_kph,'km/h'):'Start the braking example',note:'Vehicle speed is the speed of the body. A wheel can slow faster than the body when it slips.'},
        {title:'Wheel-speed sensor',status:!installed?'Not in this setup':missing?'Front-left reading missing':'Wheel readings arriving',measurement:installed&&!missing?format(sensor.wheel_speeds_kph?.[0],'km/h'):'No usable front-left reading',note:'A disconnected sensor loses information. It does not physically stop that wheel.',warning:missing&&installed},
        {title:'Brake computer',status:!installed?'Not in this setup':missing?'Wheel assistance unavailable':s.inputs?.abs_enabled===false?'Assistance switched off':s.abs_active?'Adjusting wheel braking':'Watching wheel grip',measurement:missing?'Friction braking continues':'Compares wheels with vehicle',note:'In this teaching model, a missing wheel input disables ABS and yaw assistance. Ordinary friction braking remains in the model.',warning:missing&&installed},
        {title:'Wheel response',status:installed?(s.abs_active?'Brake effort is adjusted':'Brake effort follows demand'):'Not in this setup',measurement:installed?format(s.wheel_speeds_kph?.[0],'km/h'):'No vehicle wheels',note:'The wheel speed responds to road grip, wheel inertia and brake torque. ABS tries to stop excessive slip.'}
      ];}
      const installed=s.profile!=='engine',stale=(sensor.bmu_message_age_ms||0)>300,latched=s.contactor==='FAULT';
      return[
        {title:'Energy in the battery',status:installed?'The physical pack remains':'Not in this setup',measurement:installed?format(s.soc_pct,'% charge'):'Start a hybrid example',note:'The battery stores energy. Its physical charge and current keep evolving even when a status report is lost.'},
        {title:'Battery monitor',status:!installed?'Not in this setup':stale?'Fresh reports missing':'Fresh reports arriving',measurement:stale?'Last report is old':'Checks charge and limits',note:'The battery monitor tells the rest of the vehicle how much power may be used or returned. A held old report is not a new measurement.',warning:stale},
        {title:'Hybrid coordinator',status:!installed?'Not in this setup':latched?'Drive is held off':s.contactor==='CLOSED'?'Coordinates the two drives':'Waiting for permission',measurement:latched?'Restart after repair':stale?'Protection can stay latched':'Engine and motor requests',note:'The coordinator combines driver demand with battery permission. This teaching policy stops traction after a battery-message timeout and needs a restart after repair.',warning:stale||latched},
        {title:'Vehicle response',status:installed?(s.speed_kph>1?'Moving through road load':'Standing or starting'):'Not in this setup',measurement:installed?format(s.speed_kph,'km/h'):'No vehicle motion',note:'The wheels respond to the allowed engine and motor power. Braking can send some energy back only when the battery accepts it.'}
      ];
    }
    function buildPicture(){
      pictureSvg=svgEl('svg',{viewBox:'0 0 680 320',role:'group','aria-label':'Simple cause-and-effect diagram; select a part for its explanation',class:'lr-story-svg'});const defs=svgEl('defs');const marker=svgEl('marker',{id:'lr-story-arrow',viewBox:'0 0 10 10',refX:9,refY:5,markerWidth:6,markerHeight:6,orient:'auto-start-reverse'});marker.append(svgEl('path',{d:'M 0 0 L 10 5 L 0 10 z',fill:'#5b9086'}));defs.append(marker);pictureSvg.append(svgEl('style',{},'.lr-story-box{fill:#fff;stroke:#b9d7c8;stroke-width:1.5}.lr-story-name{font-family:system-ui,sans-serif;font-weight:600;font-size:17px;fill:#315547}.lr-story-reading{font-family:system-ui,sans-serif;font-size:14px;fill:#5b7d65}.lr-story-measurement{font-family:monospace;font-size:12px;fill:#7c9580}.lr-story-node.lr-picked .lr-story-box{stroke:#297f63;stroke-width:2.5;fill:#f2faed}.lr-story-node.lr-warning .lr-story-box{fill:#fff8eb;stroke:#dcaa69}.lr-story-node.lr-warning .lr-story-reading{fill:#a26c2e}'));pictureSvg.append(defs);
      for(const d of['M 300 74 H 380','M 520 132 V 188','M 380 246 H 300','M 160 188 V 132'])pictureSvg.append(svgEl('path',{d,fill:'none',stroke:'#81a99f','stroke-width':3,'marker-end':'url(#lr-story-arrow)'}));
      pictureNodes=[];const positions=[[20,20],[380,20],[380,188],[20,188]];
      for(let i=0;i<4;i++){const [x,y]=positions[i],g=svgEl('g',{transform:'translate('+x+' '+y+')',tabindex:0,role:'button',class:'lr-story-node','aria-label':'Explain this part'});const rect=svgEl('rect',{x:0,y:0,width:280,height:112,rx:12,class:'lr-story-box'}),name=svgEl('text',{x:18,y:28,class:'lr-story-name'}),reading=svgEl('text',{x:18,y:58,class:'lr-story-reading'}),measurement=svgEl('text',{x:18,y:86,class:'lr-story-measurement'});g.append(rect,name,reading,measurement);const choose=()=>{selectedNode=i;renderPicture();};g.onclick=choose;g.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();choose();}};pictureNodes.push({g,name,reading,measurement});pictureSvg.append(g);}
      pictureCanvas.replaceChildren(pictureSvg);
    }
    function renderPicture(){if(!pictureNodes.length)return;const data=pictureData();data.forEach((item,i)=>{const n=pictureNodes[i];n.name.textContent=item.title;n.reading.textContent=item.status;n.measurement.textContent=item.measurement;n.g.setAttribute('aria-label','Explain '+item.title);n.g.classList.toggle('lr-warning',!!item.warning);n.g.classList.toggle('lr-picked',selectedNode===i);});const selected=data[selectedNode];pictureNote.replaceChildren(el('strong','',selected.title),el('p','',selected.note));}
    function update(result){
      if(!result?.state)return;const priorTime=state?.t;state=result.state;records=result.signals||records;explanation=result.explanation||explanation;
      if(priorTime!=null&&state.t<priorTime)scope.reset();if(result.history)scope.append(result.history);if(result.events){events=result.events;scope.setEvents(events);}scope.setSignals(records);schematic.setState(state);
      if(document.activeElement!==accelerator.input){accelerator.input.value=String(Math.round((state.inputs?.throttle||0)*100));accelerator.output.textContent=accelerator.input.value+'%';}if(document.activeElement!==brake.input){brake.input.value=String(Math.round((state.inputs?.brake||0)*100));brake.output.textContent=brake.input.value+'%';}
      refreshClock();experimentName.textContent=friendlyTitles[state.profile]||'Current experiment';renderExplanation();renderPicture();refreshControls();
    }
    const timer=setInterval(async()=>{if(!playing||busy||LabUI.isBusy?.())return;busy=true;const before=LabUI.state()?.t;try{await LabUI.advance(.2);if(LabUI.state()?.t===before){stopPlaying();setStatus('This scripted experiment has finished. You can start it again or explore another chapter.');}}finally{busy=false;refreshControls();}},250);
    window.addEventListener('lab:reset',()=>{scope.reset();byteText.textContent='No diagnostic request in this experiment yet.';diagnosticText.textContent='The answer will be translated into words here.';});
    fetch('/api/book').then(r=>{if(!r.ok)throw new Error('Reference book unavailable');return r.json();}).then(data=>{if(!destroyed)setBook(data);}).catch(()=>{if(destroyed)return;refs.replaceChildren(el('summary','','Complete theory & reference'),el('p','lr-nav-loading','The live reference index could not be loaded. Use the complete theory PDF link.'));});
    activateChapter(activeChapter.id);if(state)update({state});
    return {update,activateChapter,openReference,setBook,showGlossary,pause:stopPlaying,redraw(){scope.redraw();},exportSvg(){return new XMLSerializer().serializeToString(pictureSvg);},destroy(){destroyed=true;clearInterval(timer);stopPlaying();}};
  }
  window.LearningReader={init};
})();
