import {loadPyodide} from '../vendor/pyodide/pyodide.mjs';

const resource = path => new URL(path, import.meta.url);
let invoke;
async function initialize() {
  const runtime = await loadPyodide({indexURL: resource('../vendor/pyodide/').href});
  const response = await fetch(resource('../python/model.zip'));
  if (!response.ok) throw new Error('The vehicle models could not be loaded.');
  runtime.FS.mkdirTree('/app');
  runtime.unpackArchive(new Uint8Array(await response.arrayBuffer()), 'zip', {extractDir: '/app'});
  runtime.runPython("import sys\nsys.path.insert(0, '/app')");
  const bridge = await fetch(resource('browser_api.py'));
  if (!bridge.ok) throw new Error('The simulator could not be initialized.');
  runtime.runPython(await bridge.text());
  invoke = runtime.globals.get('browser_request');
  postMessage({type: 'ready'});
}

const ready = initialize();
ready.catch(error => postMessage({type: 'fatal', message: error.message}));
let queue = Promise.resolve();
self.onmessage = ({data}) => {
  queue = queue.then(async () => {
    try {
      await ready;
      const response = JSON.parse(invoke(JSON.stringify(data.request)));
      postMessage({type: 'response', id: data.id, response});
    } catch (error) {
      postMessage({type: 'response', id: data.id, response: {
        status: 500, headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({error: error.message}),
      }});
    }
  });
};
