/* Transport adapter: the original application and model share one worker. */
(() => {
  'use strict';
  const base = new URL('../', document.currentScript.src);
  const nativeFetch = window.fetch.bind(window);
  const routes = new Set(['meta', 'book', 'network', 'systems', 'scanner',
    'diagnostic-definitions', 'signals', 'state', 'cycles', 'export.csv',
    'export.json', 'trace.txt', 'article-experiment', 'vehicle', 'control',
    'inputs', 'cycle', 'reset', 'advance', 'connection', 'connection-fault', 'diagnostic']);
  const pending = new Map();
  let nextId = 0, resolveReady, rejectReady, started = false;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  ready.catch(() => {});
  const worker = new Worker(new URL('online/engine-worker.mjs', base), {type: 'module'});
  let failure = '';

  function renderStatus() {
    const box = document.querySelector('#online-startup');
    if (!box) return;
    const uk = (window.AppI18n?.language || window.AutoMethodsLanguage?.language) === 'uk';
    box.hidden = started;
    box.querySelector('[data-online-status]').textContent = failure
      ? (uk ? 'Не вдалося запустити лабораторію. Оновіть сторінку, щоб спробувати знову.' : 'The lab could not start. Reload the page to try again.')
      : (uk ? 'Запуск OBD II Lab…' : 'Starting OBD II Lab…');
    box.querySelector('button').textContent = uk ? 'Спробувати знову' : 'Try again';
    box.querySelector('button').hidden = !failure;
    box.dataset.failed = String(Boolean(failure));
  }
  function fail(message) {
    failure = message || 'The simulator could not start.';
    rejectReady(new Error(failure));
    for (const job of pending.values()) job.reject(new Error(failure));
    pending.clear();
    renderStatus();
  }
  worker.addEventListener('error', event => fail(event.message));
  worker.addEventListener('message', ({data}) => {
    if (data.type === 'ready') { started = true; resolveReady(); renderStatus(); }
    else if (data.type === 'fatal') fail(data.message);
    else if (data.type === 'response') {
      const job = pending.get(data.id);
      if (!job) return;
      pending.delete(data.id);
      job.resolve(new Response(data.response.body, {
        status: data.response.status, headers: data.response.headers,
      }));
    }
  });
  function apiPath(url) {
    if (url.origin !== location.origin) return null;
    let path = url.pathname;
    if (path.startsWith(base.pathname + 'api/')) path = '/' + path.slice(base.pathname.length);
    return path.startsWith('/api/') && routes.has(path.slice(5)) ? path : null;
  }
  function staticPath(value) {
    if (value === '/') return base.href;
    return /^\/(?:web\/|docs\/|OBDII_|START_HERE\.html)/.test(value)
      ? new URL(value.slice(1), base).href : null;
  }
  window.fetch = async (input, options) => {
    const request = new Request(input instanceof Request ? input : new URL(input, location.href), options);
    const url = new URL(request.url), path = apiPath(url);
    if (path) {
      const body = ['GET', 'HEAD'].includes(request.method) ? null : await request.text();
      await ready;
      return new Promise((resolve, reject) => {
        const id = ++nextId;
        pending.set(id, {resolve, reject});
        worker.postMessage({id, request: {path, method: request.method, body}});
      });
    }
    const target = url.origin === location.origin ? staticPath(url.pathname) : null;
    return nativeFetch(target ? new Request(target + url.search, request) : request);
  };
  function rewrite(root) {
    const elements = root.nodeType === 1 ? [root, ...root.querySelectorAll('[src],[href]')] : [];
    for (const element of elements) {
      for (const attribute of ['src', 'href']) {
        const value = element.getAttribute(attribute);
        if (!value) continue;
        const target = staticPath(value);
        if (target) element.setAttribute(attribute, target);
      }
    }
  }
  function attach() {
    rewrite(document.documentElement);
    new MutationObserver(records => {
      for (const record of records) {
        if (record.type === 'attributes') rewrite(record.target);
        else for (const node of record.addedNodes) rewrite(node);
      }
    }).observe(document.documentElement, {subtree: true, childList: true, attributes: true, attributeFilter: ['src', 'href']});
    document.querySelector('#online-startup button')?.addEventListener('click', () => location.reload());
    renderStatus();
    document.addEventListener('automethodslanguagechange', renderStatus);
    document.addEventListener('click', async event => {
      const link = event.target.closest?.('a[href]');
      if (!link) return;
      const path = apiPath(new URL(link.href));
      if (!path || !['/api/export.csv', '/api/export.json', '/api/trace.txt'].includes(path)) return;
      event.preventDefault();
      const response = await window.fetch(link.href);
      const url = URL.createObjectURL(await response.blob());
      const save = document.createElement('a');
      save.href = url;
      save.download = response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] || 'obd-export';
      save.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }
  window.OBDOnline = Object.freeze({ready, base: base.href});
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', attach, {once: true});
  else attach();
})();
