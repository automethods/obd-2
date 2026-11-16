import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = process.env.OBD_QA_OUTPUT;
if (output) await fs.mkdir(output, {recursive: true});
const base = 'https://automethods.com/projects/obd-2/';
const mime = {'.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript',
  '.css':'text/css', '.wasm':'application/wasm', '.json':'application/json',
  '.svg':'image/svg+xml', '.png':'image/png', '.pdf':'application/pdf'};
const browser = await chromium.launch({executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
  headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
const report = {checks: [], errors: []};
let page;
try {
  const context = await browser.newContext({viewport: {width:1440, height:1000}, locale:'en-US', acceptDownloads:true});
  const httpApi = [], failures = [];
  await context.route('https://automethods.com/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/language.js') {
      await route.fulfill({contentType:'application/javascript', body:"globalThis.AutoMethodsLanguage?.applyCountryLanguage('uk');"});
      return;
    }
    if (url.pathname.startsWith('/api/')) httpApi.push(url.pathname);
    if (!url.pathname.startsWith('/projects/obd-2/')) {
      await route.fulfill({status:404, body:'Unknown route'});
      return;
    }
    const relative = decodeURIComponent(url.pathname.slice('/projects/obd-2/'.length)) || 'index.html';
    const filename = path.resolve(root, relative);
    assert.ok(filename.startsWith(root + path.sep));
    try {
      const body = await fs.readFile(filename);
      await route.fulfill({contentType:mime[path.extname(filename)] || 'application/octet-stream', body});
    } catch {
      failures.push(relative);
      await route.fulfill({status:404, body:'Missing publication asset'});
    }
  });
  page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  await page.goto(base, {waitUntil:'domcontentloaded'});
  await page.evaluate(() => window.OBDOnline.ready);
  await page.evaluate(() => window.VehicleApplication.ready);
  await page.waitForFunction(() => window.VehicleApplication.session.ready, {timeout:60000});
  assert.equal(await page.locator('html').getAttribute('lang'), 'uk');
  assert.equal(await page.locator('#online-startup').isVisible(), false);
  assert.equal(await page.locator('[data-setup="configuration"] option').count(), 6);
  report.checks.push('Actual browser worker starts the original model; all six vehicle presets are present.');
  await page.locator('[data-language-choice="en"]').click();
  assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  await page.locator('[data-setup-action="apply"]').click();
  await page.waitForSelector('[data-workspace-choice="drive"]');
  await page.locator('[data-workspace-choice="drive"]').click();
  await page.waitForFunction(() => window.VehicleApplication.session.workflowStage === 'active');
  const driving = await page.evaluate(async () => {
    const session = window.VehicleApplication.session;
    session.setRunning(false); await session.command;
    await session.control('ignition',true); session.setRunning(false);
    await session.start({assist:true}); session.setRunning(false);
    await session.advance(2);
    await session.shift('D',{assist:true});
    await session.control('parking_brake',false);
    await session.setInputs({throttle:.35,brake:0});
    await session.advance(2);
    return {speed:session.result.state.speed_kph,rpm:session.result.state.rpm,gear:session.result.state.vehicle.selector,samples:session.logHistory.length};
  });
  assert.ok(driving.speed > 0 && driving.rpm > 0 && driving.samples > 0);
  assert.equal(driving.gear,'D');
  report.checks.push({driving});
  await page.waitForFunction(() => VehicleApplication.session.controlsPending === 0 && !VehicleApplication.views.drive.inspect().pending);
  await page.locator('.ck-cluster').click();
  await page.keyboard.down('w');
  await page.waitForFunction(() => VehicleApplication.session.controlsPending === 0 && !VehicleApplication.views.drive.inspect().pending);
  await page.keyboard.down('ArrowUp');
  assert.equal(await page.evaluate(() => VehicleApplication.session.inputs.throttle),1);
  await page.keyboard.up('w');
  assert.equal(await page.evaluate(() => VehicleApplication.session.inputs.throttle),1);
  await page.keyboard.up('ArrowUp');
  assert.equal(await page.evaluate(() => VehicleApplication.session.inputs.throttle),0);
  report.checks.push('Driving keys retain independent held-key behavior.');
  const diagnostics = await page.evaluate(async () => {
    const session = VehicleApplication.session;
    session.setRunning(false); await session.command;
    const before = session.result.state.t;
    await session.enterWorkspace('service');
    session.setRunning(false); await session.command;
    const after = session.result.state.t;
    await session.scannerAction('connect',{protocol:'can11_500',module:'ecu'});
    await session.request('01 0C');
    const reply = session.diagnostic?.response_hex;
    await session.connection('ect',false);
    await session.advance(.7);
    const invalid = session.result.state.sensors.ect_sensor_valid;
    await session.connection('ect',true);
    await session.advance(.2);
    const valid = session.result.state.sensors.ect_sensor_valid;
    return {before,after,reply,invalid,valid,csv:session.logCSV().slice(0,400),stored:session.result.state.dtcs};
  });
  assert.equal(diagnostics.before,diagnostics.after);
  assert.ok(diagnostics.reply?.startsWith('41 0C'));
  assert.equal(diagnostics.invalid,false); assert.equal(diagnostics.valid,true);
  assert.ok(diagnostics.stored.includes('P0118'),'Repaired signal retains its diagnostic memory.');
  assert.ok(diagnostics.csv.includes('time_s'));
  report.checks.push({diagnostics});
  const downloadEvent = page.waitForEvent('download');
  await page.evaluate(() => {
    const link=document.createElement('a'); link.href='/api/export.json';
    document.body.append(link); link.click(); link.remove();
  });
  const download=await downloadEvent;
  assert.equal(download.suggestedFilename(),'obdii_run.json');
  const chunks=[];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk);
  const exported=JSON.parse(Buffer.concat(chunks).toString());
  assert.ok(exported.final_state.dtcs.includes('P0118'));
  report.checks.push('Browser downloads the original JSON run export with retained fault memory.');
  const experiment=await context.newPage();
  experiment.on('pageerror',error=>report.errors.push(error.message));
  await experiment.goto(base+'web/article-experiment.html',{waitUntil:'domcontentloaded'});
  await experiment.evaluate(()=>OBDOnline.ready);
  await experiment.locator('#run').click();
  await experiment.waitForFunction(()=>document.querySelectorAll('#rows tr').length===22,{timeout:90000});
  assert.equal(await experiment.locator('#json').isVisible(),true);
  assert.equal(await experiment.locator('#csv').isVisible(),true);
  await experiment.close();
  report.checks.push('The separate MAF experiment page computes and renders all 22 cases and enables CSV/JSON exports.');
  const beforeLanguage = await page.evaluate(() => VehicleApplication.session.result.state.t);
  await page.locator('[data-language-choice="uk"]').click();
  assert.equal(await page.locator('html').getAttribute('lang'),'uk');
  assert.equal(await page.evaluate(() => VehicleApplication.session.result.state.t),beforeLanguage);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.evaluate(() => window.VehicleApplication.ready);
  assert.equal(await page.locator('html').getAttribute('lang'),'uk');
  await page.locator('[data-language-choice="en"]').click();
  await page.reload({waitUntil:'domcontentloaded'});
  await page.evaluate(() => window.VehicleApplication.ready);
  assert.equal(await page.locator('html').getAttribute('lang'),'en');
  report.checks.push('Manual language choice overrides Ukraine defaults, survives reload and preserves a running vehicle when changed.');
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  if (output) await page.screenshot({path:path.join(output,'online-mobile.png'),fullPage:true});
  assert.deepEqual(httpApi,[],'Simulation APIs never require an HTTP backend.');
  assert.deepEqual(failures,[]);
  assert.deepEqual(report.errors,[]);
  report.status='PASS';
} catch(error) {
  report.status='FAIL'; report.error=error.stack;
  if (page) {
    report.state=await page.evaluate(() => ({text:document.body.innerText.slice(0,1500),error:window.VehicleApplication?.session?.error})).catch(()=>null);
    if (output) await page.screenshot({path:path.join(output,'online-failure.png'),fullPage:true}).catch(()=>{});
  }
  process.exitCode=1;
} finally {
  if(output) await fs.writeFile(path.join(output,'online-browser.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
  await browser.close();
}
