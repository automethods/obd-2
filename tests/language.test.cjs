'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname,'../assets/language.js'),'utf8');

function environment({saved, automatic, country = 'en', denied = false} = {}) {
  const values = new Map(), events = new Map();
  if (saved) values.set('motion-lab-language',saved);
  if (automatic) values.set('motion-lab-language-auto',automatic);
  let countryScript;
  const document = {documentElement:{dataset:{}},
    head:{append(script) {countryScript=script;}}, createElement:() => ({}),
    addEventListener(name,fn) {events.set(name,fn);},
    dispatchEvent(event) {events.get(event.type)?.(event);}};
  const context = {document, location:{hostname:'automethods.com'},
    localStorage:{
      getItem(key) {if(denied) throw Error('blocked'); return values.get(key)??null;},
      setItem(key,value) {if(denied) throw Error('blocked'); values.set(key,value);},
      removeItem(key) {if(denied) throw Error('blocked'); values.delete(key);}},
    Event:class {constructor(type) {this.type=type;}},addEventListener() {}};
  vm.createContext(context); vm.runInContext(source,context);
  assert.equal(countryScript.src,'/api/language.js');
  const setCountry = value => {context.AutoMethodsLanguage.applyCountryLanguage(value);countryScript.onload();};
  setCountry(country);
  return {document,values,setCountry,choose(language) {
    events.get('click')({target:{closest:() => ({dataset:{languageChoice:language}})}});
  }};
}

assert.equal(environment({country:'uk'}).document.documentElement.lang,'uk');
assert.equal(environment({country:'en'}).document.documentElement.lang,'en');
assert.equal(environment({saved:'en',country:'uk'}).document.documentElement.lang,'en');
assert.equal(environment({saved:'uk',country:'en'}).document.documentElement.lang,'uk');
assert.equal(environment({saved:'uk',automatic:'uk',country:'en'}).document.documentElement.lang,'en');
const selected=environment({country:'uk'}); selected.choose('en'); selected.setCountry('uk');
assert.equal(selected.values.has('motion-lab-language-auto'),false);
assert.equal(selected.document.documentElement.lang,'en');
assert.equal(environment({saved:selected.values.get('motion-lab-language'),country:'uk'}).document.documentElement.lang,'en');
assert.doesNotThrow(() => environment({denied:true,country:'uk'}).choose('en'));
console.log('PASS: country defaults, shared remembered selection, late country hint and blocked storage.');
