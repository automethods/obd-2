// Replay the existing API acceptance checks against the browser Python build.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {loadPyodide} from '../vendor/pyodide/pyodide.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.resolve(process.env.OBD_SOURCE || path.join(root, '../source'));
const native = spawnSync('python3', ['-c', `
import json, runpy, sys
from pathlib import Path
source, site = map(Path, sys.argv[1:])
sys.path.insert(0, str(source))
api = runpy.run_path(str(site/'online/browser_api.py'))['browser_request']
requests = []
def request(url, data=None):
    call = dict(path=url, method='GET' if data is None else 'POST',
                body=None if data is None else json.dumps(data))
    result = json.loads(api(json.dumps(call)))
    assert result['status'] == 200, (url, result)
    if url.startswith('/api/'):
        requests.append(dict(request=call, response=result))
    return result['body'].encode()
checks = runpy.run_path(str(source/'tests/check_download.py'))
checks['check_configured_vehicle'].__globals__['request'] = request
for name in ['check_configured_vehicle', 'check_sensor_characteristics_and_intermittent_faults', 'check_setup_and_cycle']:
    checks[name]('')
for configuration in ['petrol_basic','petrol_advanced','diesel','hev','phev','bev']:
    request('/api/vehicle', {'configuration':configuration})
    request('/api/control', {'action':'ignition','value':True})
    request('/api/control', {'action':'start'})
    state = json.loads(request('/api/advance', {'seconds':2}))['state']
    assert state['vehicle']['ready'], configuration
    request('/api/control', {'action':'gear','value':'D','inputs':{'brake':.3}})
    request('/api/control', {'action':'parking_brake','value':False})
    state = json.loads(request('/api/advance', {'seconds':2,'inputs':{'throttle':.4,'brake':0}}))['state']
    assert state['speed_kph'] > 0, configuration
assert len(json.loads(request('/api/book'))['documents']) == 12
before = json.loads(request('/api/state'))['state']['t']
experiment = json.loads(request('/api/article-experiment', {}))
assert len(experiment['cases']) == 22
assert json.loads(request('/api/state'))['state']['t'] == before
request('/api/trace.txt')
print(json.dumps(requests, allow_nan=False))
`, source, root], {encoding:'utf8', maxBuffer:128 * 1024 * 1024,
  env:{...process.env, PYTHONDONTWRITEBYTECODE:'1'}});
assert.equal(native.status, 0, native.stderr);
const requests = JSON.parse(native.stdout);
const runtime = await loadPyodide({indexURL:path.join(root,'vendor/pyodide/')});
runtime.FS.mkdirTree('/app');
runtime.unpackArchive(new Uint8Array(fs.readFileSync(path.join(root,'python/model.zip'))), 'zip', {extractDir:'/app'});
runtime.runPython("import sys\nsys.path.insert(0, '/app')");
runtime.runPython(fs.readFileSync(path.join(root,'online/browser_api.py'),'utf8'));
const invoke = runtime.globals.get('browser_request');
let comparisons = 0;
function compare(actual, expected, location) {
  comparisons++;
  if (typeof expected === 'number') {
    assert.equal(typeof actual, 'number', location);
    assert.ok(Math.abs(actual - expected) <= 1e-8 * Math.max(1, Math.abs(expected)), `${location}: ${actual} != ${expected}`);
  } else if (expected !== null && typeof expected === 'object') {
    assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), location);
    for (const key of Object.keys(expected)) compare(actual[key],expected[key],location+'.'+key);
  } else assert.equal(actual,expected,location);
}
for (const {request,response} of requests) {
  const result = JSON.parse(invoke(JSON.stringify(request)));
  assert.equal(result.status,response.status,request.path);
  assert.deepEqual(result.headers,response.headers,request.path);
  if (response.headers['Content-Type'].startsWith('application/json')) {
    compare(JSON.parse(result.body),JSON.parse(response.body),request.path);
  } else if (response.headers['Content-Type'] === 'text/csv') {
    const rows = result.body.split(/\r?\n/), expected = response.body.split(/\r?\n/);
    assert.equal(rows.length,expected.length);
    rows.forEach((row,i) => {
      const fields = row.split(','), reference = expected[i].split(',');
      assert.equal(fields.length,reference.length);
      fields.forEach((value,j) => compare(value !== '' && Number.isFinite(Number(value)) ? Number(value) : value,
        reference[j] !== '' && Number.isFinite(Number(reference[j])) ? Number(reference[j]) : reference[j],`CSV ${i}:${j}`));
    });
  } else compare(result.body,response.body,request.path);
}
console.log(JSON.stringify({status:'PASS',requests:requests.length,comparisons,
  checks:['Original API acceptance checks','Six powertrains start and drive','Manual gearbox and HVAC',
    'Intermittent faults and retained DTCs','CAN / ISO-TP / UDS and sensor validity','WLTC and exports',
    'Twelve reference documents','All 22 MAF experiments preserve the current vehicle'],
  tolerance:'Numeric values agree with native Python within 1e-8 relative; protocol bytes agree exactly.'},null,2));
