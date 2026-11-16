/* Workbench, reading and instruments share one deterministic model. */
(() => {
  'use strict';
  let reader;
  const byId=id=>document.getElementById(id);
  function chooseView(view){
    reader?.pause();
    window.LabUI?.pause();
    const learning=view==='learning', instruments=view==='instruments';
    byId('learning-reader').hidden=!learning;
    byId('instrument-workspace').hidden=!instruments;
    byId('visual-workbench').hidden=view!=='workbench';
    document.body.classList.toggle('learning-mode',learning);
    document.body.classList.toggle('workbench-mode',view==='workbench');
    for(const name of ['workbench','learning','instruments']){
      byId('show-'+name).classList.toggle('active',view===name);
      byId('show-'+name).setAttribute('aria-pressed',String(view===name));
    }
    window.Workbench?.setVisible(view==='workbench');
    requestAnimationFrame(()=>{window.dispatchEvent(new Event('resize'));if(instruments)window.LabUI.draw();else if(learning)reader?.redraw();});
  }
  function initialize(){
    if(reader||!window.LabUI?.meta())return;
    reader=window.LearningReader.init({container:byId('learning-reader'),chapterContent:window.LessonContent,LabUI:window.LabUI,onAdvanced:()=>chooseView('instruments')});
    if(window.LabUI.result())reader.update(window.LabUI.result());
  }
  for(const view of ['workbench','learning','instruments'])byId('show-'+view).onclick=()=>chooseView(view);
  window.LabViews={show:chooseView};
  window.addEventListener('lab:ready',initialize);
  window.addEventListener('lab:state',event=>reader?.update(event.detail));
  initialize();
})();
