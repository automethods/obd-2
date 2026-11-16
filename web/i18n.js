/* UI language adapter. The model/API, diagnostic bytes and object IDs stay stable.
 * AutoMethods shares the en/uk preference through motion-lab-language. */
(() => {
  'use strict';
  const supported=value=>['en','uk'].includes(value),storageKey='motion-lab-language',automaticKey='motion-lab-language-auto';
  const normalize=value=>String(value||'').replace(/\s+/g,' ').trim();
  const dictionary=window.OBDUkrainian||{},sourceText=new WeakMap(),sourceAttributes=new WeakMap(),listeners=new Set();
  let language='en',observer,scheduled=false;
  function preferred({queryOverride=true}={}){
    let saved,automatic;try{saved=localStorage.getItem(storageKey);automatic=localStorage.getItem(automaticKey);}catch(_){}
    const query=queryOverride?new URLSearchParams(location.search).get('lang'):null;
    return supported(query)?query:supported(saved)&&saved!==automatic?saved:window.AutoMethodsLanguage?.language||'en';
  }
  function translate(value){
    if(language!=='uk')return String(value??'');
    const original=String(value??''),key=normalize(original);if(!key)return original;
    let result=dictionary[key];
    if(result===undefined){
      // Generated sentences use explicit templates; values are never translated.
      const patterns=window.OBDUkrainianPatterns||[];
      for(const [pattern,render] of patterns){const match=key.match(pattern);if(match){result=render(match,translate);break;}}
    }
    if(result===undefined&&key.includes(' · '))result=key.split(' · ').map(translate).join(' · ');
    if(result===undefined)return original;
    return original.slice(0,original.indexOf(original.trimStart()))+result+original.slice(original.trimEnd().length);
  }
  const skip=node=>node.parentElement?.closest('script,style,code,pre,textarea,[translate="no"],[data-i18n-skip]');
  function textNode(node){
    if(skip(node))return;const current=node.nodeValue,previous=sourceText.get(node);
    const english=previous&&current===previous.translated?previous.english:current,translated=translate(english);
    sourceText.set(node,{english,translated});if(current!==translated)node.nodeValue=translated;
  }
  const attributes=['title','aria-label','placeholder','alt'];
  function element(node){
    if(node.closest('script,style,code,pre,[translate="no"],[data-i18n-skip]'))return;
    const saved=sourceAttributes.get(node)||{};
    for(const name of attributes){if(!node.hasAttribute(name))continue;const current=node.getAttribute(name),previous=saved[name],english=previous&&current===previous.translated?previous.english:current,translated=translate(english);saved[name]={english,translated};if(current!==translated)node.setAttribute(name,translated);}
    sourceAttributes.set(node,saved);
  }
  function render(root=document.documentElement){
    observer?.disconnect();
    try{
      if(root.nodeType===3)textNode(root);
      else if(root.nodeType===1){element(root);const walker=document.createTreeWalker(root,NodeFilter.SHOW_ELEMENT|NodeFilter.SHOW_TEXT);let node;while((node=walker.nextNode())){if(node.nodeType===3)textNode(node);else element(node);}}
    }finally{observer?.observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:attributes});}
  }
  function updateControls(){document.documentElement.lang=language;document.documentElement.dataset.language=language;document.querySelectorAll('[data-language-choice]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.languageChoice===language)));}
  function setLanguage(value,{persist=true}={}){
    if(!supported(value))return;language=value;
    if(persist){
      try{localStorage.setItem(storageKey,value);localStorage.removeItem(automaticKey);}catch(_){}
      // A shared ?lang= link selects the initial language; a later manual
      // choice updates that link and remains authoritative on reload.
      try{const url=new URL(location.href);if(url.searchParams.has('lang')){url.searchParams.set('lang',value);history.replaceState(null,'',url);}}catch(_){}
    }
    updateControls();render();listeners.forEach(fn=>fn(language));
  }
  function start(){
    const dirty=new Set();
    observer=new MutationObserver(records=>{
      records.forEach(record=>dirty.add(record.target));if(scheduled||!dirty.size)return;
      scheduled=true;queueMicrotask(()=>{
        scheduled=false;const roots=[...dirty];dirty.clear();
        for(const root of roots){
          if(root.isConnected===false)continue;
          let covered=false;for(let parent=root.parentNode;parent;parent=parent.parentNode)if(roots.includes(parent)){covered=true;break;}
          if(!covered)render(root);
        }
      });
    });
    setLanguage(preferred(),{persist:false});
    document.addEventListener('click',event=>{const choice=event.target.closest?.('[data-language-choice]');if(!choice)return;setLanguage(choice.dataset.languageChoice);document.dispatchEvent(new Event('automethodslanguagechange'));});
    window.addEventListener('storage',event=>{if(event.key===storageKey||event.key===automaticKey)setLanguage(preferred({queryOverride:false}),{persist:false});});
    document.addEventListener('automethodslanguagechange',()=>{const next=preferred({queryOverride:false});if(next!==language)setLanguage(next,{persist:false});});
  }
  window.AppI18n={t:translate,render,setLanguage,get language(){return language;},get locale(){return language==='uk'?'uk-UA':'en-GB';},subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);}};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
