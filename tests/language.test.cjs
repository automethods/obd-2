'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const languageSource = fs.readFileSync(path.join(root, 'assets/language.js'), 'utf8');
const translationSource = fs.readFileSync(path.join(root, 'assets/i18n.js'), 'utf8');

function environment({saved, automatic, country = 'en', browser = 'en-US', denied = false} = {}) {
  const values = new Map();
  if (saved) values.set('motion-lab-language', saved);
  if (automatic) values.set('motion-lab-language-auto', automatic);
  const events = new Map(), buttons = new Map(), elements = [];
  let countryScript;
  for (const match of html.matchAll(/data-i18n(?:-(alt|content|title|aria-label))?="([^"]+)"/g)) {
    elements.push({attribute: match[1], key: match[2], dataset: {i18n: match[2]}, textContent: '',
      getAttribute() { return this.key; }, setAttribute(name, value) { this[name] = value; }});
  }
  for (const language of ['en', 'uk']) {
    buttons.set(language, {dataset: {language}, setAttribute() {}, addEventListener(_, fn) { this.click = fn; }});
  }
  const document = {
    documentElement: {dataset: {}}, head: {append(script) { countryScript = script; }},
    createElement: () => ({}),
    addEventListener(name, fn) { events.set(name, fn); },
    dispatchEvent(event) { events.get(event.type)?.(event); },
    querySelectorAll(selector) {
      if (selector === 'button[data-language]') return [...buttons.values()];
      if (selector === '[data-i18n]') return elements.filter(node => !node.attribute);
      return elements.filter(node => selector === `[data-i18n-${node.attribute}]`);
    },
  };
  const context = {document, location: {hostname: 'automethods.com'}, navigator: {languages: [browser]},
    localStorage: {
      getItem(key) { if (denied) throw Error('blocked'); return values.get(key) ?? null; },
      setItem(key, value) { if (denied) throw Error('blocked'); values.set(key, value); },
      removeItem(key) { if (denied) throw Error('blocked'); values.delete(key); },
    }, Event: class { constructor(type) { this.type = type; } }, addEventListener() {}};
  vm.createContext(context);
  vm.runInContext(languageSource, context);
  vm.runInContext(translationSource.replace('export function t', 'function t'), context);
  assert.equal(countryScript.src, '/api/language.js');
  const setCountry = language => { context.AutoMethodsLanguage.applyCountryLanguage(language); countryScript.onload(); };
  setCountry(country);
  return {values, document, elements, setCountry, choose(language) {
    const button = buttons.get(language);
    events.get('click')({target: {closest: () => button}});
    button.click();
  }};
}

assert.equal(environment({country: 'uk', browser: 'en-US'}).document.documentElement.lang, 'uk');
assert.equal(environment({country: 'en', browser: 'uk-UA'}).document.documentElement.lang, 'en');
assert.equal(environment({saved: 'en', country: 'uk'}).document.documentElement.lang, 'en');
assert.equal(environment({saved: 'uk', country: 'en'}).document.documentElement.lang, 'uk');
assert.equal(environment({saved: 'uk', automatic: 'uk', country: 'en'}).document.documentElement.lang, 'en');
const selected = environment({country: 'uk'});
selected.choose('en');
assert.equal(selected.values.get('motion-lab-language'), 'en');
assert.equal(selected.values.has('motion-lab-language-auto'), false);
selected.setCountry('uk');
assert.equal(selected.document.documentElement.lang, 'en', 'late country detection preserves an explicit choice');
assert.equal(environment({saved: selected.values.get('motion-lab-language'), country: 'uk'}).document.documentElement.lang, 'en');
assert.doesNotThrow(() => environment({denied: true, country: 'uk'}).choose('en'));
for (const country of ['en', 'uk']) {
  const state = environment({country});
  for (const element of state.elements) {
    const text = element.attribute ? element[element.attribute] : element.textContent;
    assert.ok(text && text !== element.key, `Missing ${country} translation: ${element.key}`);
  }
}
for (const match of html.matchAll(/\b(?:src|href)="([^"]+)"/g)) {
  if (/^(https?:|#)/.test(match[1])) continue;
  assert.ok(fs.statSync(path.join(root, match[1].split('?')[0])).isFile(), match[1]);
}
assert.ok(!html.includes('../../'), 'project assets do not depend on homepage source files');
assert.ok(!html.includes('/api/auth') && !html.includes('turnstile'), 'login and human verification belong to the selector');
for (const line of fs.readFileSync(path.join(root, 'downloads/SHA256SUMS.txt'), 'utf8').trim().split('\n')) {
  const [digest, name] = line.split('  ');
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'downloads', name))).digest('hex'), digest);
}
console.log('PASS: country defaults, remembered manual selection, late country hint, blocked storage, both languages, independent assets and unchanged simulator downloads.');
