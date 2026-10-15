import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const output = process.env.QA_OUTPUT_DIR || await mkdtemp(join(tmpdir(), 'marketing-usability-'));
await mkdir(output, { recursive: true });
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || '/workspace/.cloud-setup/browser/node_modules/playwright-core');
const guard = join(repo, 'docs/qa/marketing-ui-2026-10-01/qa-network-guard.cjs');
const env = {
  PATH: dirname(process.execPath), NODE_OPTIONS: '--require=' + guard,
  CAPITAL_COMMAND_DATA_DIR: join(output, 'data'), NEXT_TELEMETRY_DISABLED: '1',
  AI_TIER: 'free', INBOX_SYNC_ENABLED: 'false', ANALYTICS_SYNC: 'off', LISTENING_SCHEDULE: '0'
};
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', '3100'], { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
const ready = new Promise((resolveReady, reject) => {
  const timeout = setTimeout(() => reject(new Error('Sandbox startup exceeded 60 seconds')), 60_000);
  const receive = chunk => {
    log += chunk.toString();
    if (log.includes('Ready in')) { clearTimeout(timeout); resolveReady(); }
  };
  server.stdout.on('data', receive);
  server.stderr.on('data', receive);
  server.once('exit', code => { clearTimeout(timeout); reject(new Error('Sandbox exited: ' + code)); });
});
const results = [], exceptions = [], mutations = [];
let browser;
const accounts = { accounts: [{ id: 'youtube-primary', platform: 'youtube', primary: true, connected: true, youtube: { title: 'Fixture channel', thumbnail: null, handle: 'fixture' }, profile: null, needsReconnect: false }] };
const job = { id: 'fixture-job', fileName: 'Fixture stream', sourceUrl: '', createdAt: '2026-10-14T14:00:00.000Z', status: 'done', stage: 'finished', progress: 100, notices: [], clips: [{ id: 'fixture-clip', start: 0, end: 5, file: 'fixture.mp4', title: 'Fixture clip', score: 9, breakdown: { hook: 3, pacing: 3, standalone: 3, intensity: 3 }, rationale: 'Synthetic' }] };
const project = JSON.parse(execFileSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', '--eval', `import {clipProjectSchema} from './src/lib/storage/schemas'; console.log(JSON.stringify(clipProjectSchema.parse({id:'fixture-project',jobId:'fixture-job',sourceFile:'fixture.mp4',name:'Fixture saved edit',title:'Fixture title',baseDurationSec:5,clipEnd:5,trimEnd:5,createdAt:'2026-10-14T14:00:00.000Z',updatedAt:'2026-10-14T14:30:00.000Z',captions:[{id:'fixture-caption',start:1,end:2,text:'Hand edited fixture words',words:[],enabled:true}]})));`], { cwd: repo, encoding: 'utf8', env }));
let bootstrap;
async function pageFor(route, width = 1440, summary = false) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  page.on('pageerror', error => exceptions.push(error.message));
  await page.route('**/*', async r => {
    const u = new URL(r.request().url());
    if (!['127.0.0.1', 'localhost'].includes(u.hostname) && !['blob:', 'data:'].includes(u.protocol)) return r.abort('blockedbyclient');
    if (u.pathname.startsWith('/api/') && !['GET', 'HEAD'].includes(r.request().method())) {
      mutations.push({ path: u.pathname, method: r.request().method() });
      return r.fulfill({ status: 405, json: { error: 'Read-only fixture verification' } });
    }
    return r.continue();
  });
  await page.route('**/api/bootstrap', r => {
    const b = structuredClone(bootstrap);
    if (summary) b.data.clipProjects = [{ ...project, captions: [], captionsOmitted: true, captionCount: 1 }];
    return r.fulfill({ json: b });
  });
  await page.route('**/api/publish/accounts', r => r.fulfill({ json: accounts }));
  await page.route('**/api/clips', r => r.fulfill({ json: { jobs: [job] } }));
  return page;
}
async function check(name, fn) {
  if (process.env.QA_CHECK_FILTER && !new RegExp(process.env.QA_CHECK_FILTER).test(name)) return;
  await fn(); results.push({ name, passed: true }); console.log('PASS ' + name);
}
async function navigate(page, path) {
  await page.goto('http://127.0.0.1:3100' + path, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.getByRole('region', { name: 'Marketing assistant' }).waitFor({ timeout: 60_000 });
}
const visibleRetry = page => page.getByRole('button', { name: /Account status .*Retry account status/ }).filter({ visible: true }).first();
try {
  await ready;
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const setup = await browser.newPage();
  await setup.route('**/*', r => ['127.0.0.1', 'localhost'].includes(new URL(r.request().url()).hostname) ? r.continue() : r.abort('blockedbyclient'));
  await setup.goto('http://127.0.0.1:3100/editor', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  const skip = setup.getByRole('button', { name: 'Skip for now', exact: true });
  await skip.or(setup.getByRole('region', { name: 'Marketing assistant' })).first().waitFor({ timeout: 60_000 });
  if (await skip.isVisible()) await skip.click();
  await setup.getByRole('region', { name: 'Marketing assistant' }).waitFor({ timeout: 60_000 });
  bootstrap = await (await setup.request.get('http://127.0.0.1:3100/api/bootstrap')).json();
  await setup.close();

  for (const width of [1440, 400]) await check(`Account outage, malformed response and retry at ${width}px`, async () => {
    const p = await pageFor('/editor', width);
    let mode = 'failed';
    await p.route('**/api/publish/accounts', r => r.fulfill(mode === 'failed' ? { status: 503, json: { error: 'Fixture outage' } } : { json: mode === 'malformed' ? { accounts: null } : accounts }));
    await navigate(p, '/editor');
    await visibleRetry(p).waitFor();
    assert.equal(await p.getByText('Connect accounts', { exact: true }).filter({ visible: true }).count(), 0);
    const retryRead = async nextMode => {
      mode = nextMode;
      const response = p.waitForResponse(r => new URL(r.url()).pathname === '/api/publish/accounts');
      await visibleRetry(p).click(); await response;
      await p.getByRole('button', { name: /Account status .*Checking account status/ }).filter({ visible: true }).waitFor({ state: 'hidden' });
    };
    await retryRead('malformed'); await visibleRetry(p).waitFor();
    await retryRead('good'); assert.equal(await visibleRetry(p).count(), 0);
    await p.getByText('Fixture channel', { exact: true }).filter({ visible: true }).or(p.locator('[title*="Fixture channel"]').filter({ visible: true })).or(p.getByRole('link', { name: /fixture/i }).filter({ visible: true })).first().waitFor();
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await p.screenshot({ path: join(output, `accounts-${width}.png`) }); await p.close();
  });
  await check('Stale accounts remain visible and recover after failure', async () => {
    const p = await pageFor('/editor');
    await p.addInitScript(({ accounts }) => sessionStorage.setItem('capital-command:connected-accounts:v2', JSON.stringify({ at: Date.now() - 61_000, accounts })), accounts);
    let failed = true;
    await p.route('**/api/publish/accounts', r => r.fulfill(failed ? { status: 503, json: {} } : { json: accounts }));
    await navigate(p, '/editor'); await visibleRetry(p).waitFor();
    await p.getByText('Fixture channel', { exact: true }).filter({ visible: true }).or(p.getByRole('link', { name: /fixture/i }).filter({ visible: true })).first().waitFor();
    failed = false;
    const response = p.waitForResponse(r => new URL(r.url()).pathname === '/api/publish/accounts');
    await visibleRetry(p).click(); await response;
    await p.getByRole('button', { name: /Account status .*Checking account status/ }).filter({ visible: true }).waitFor({ state: 'hidden' });
    assert.equal(await visibleRetry(p).count(), 0); await p.close();
  });
  await check('A hanging account read stops and offers recovery', async () => {
    const p = await pageFor('/editor', 400);
    await p.route('**/api/publish/accounts', () => {});
    await navigate(p, '/editor');
    await visibleRetry(p).waitFor({ timeout: 25_000 });
    await p.unroute('**/api/publish/accounts');
    await p.route('**/api/publish/accounts', r => r.fulfill({ json: accounts }));
    const response = p.waitForResponse(r => new URL(r.url()).pathname === '/api/publish/accounts');
    await visibleRetry(p).click(); await response;
    await p.getByRole('link', { name: /Fixture channel.*YouTube/ }).waitFor(); await p.close();
  });
  await check('Editor clip library failure, valid empty and populated retry', async () => {
    const p = await pageFor('/editor', 400);
    let mode = 'failed';
    await p.route('**/api/clips', r => r.fulfill(mode === 'failed' ? { status: 503, json: {} } : { json: { jobs: mode === 'empty' ? [] : [job] } }));
    await navigate(p, '/editor');
    await p.getByRole('button', { name: 'New project', exact: true }).first().click();
    const dialog = p.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Retry', exact: true }).waitFor();
    assert.equal(await dialog.getByText(/No rendered clips found/).count(), 0);
    mode = 'empty'; await dialog.getByRole('button', { name: 'Retry', exact: true }).click();
    await dialog.getByText(/No rendered clips found/).waitFor();
    await dialog.getByRole('button', { name: /Close/ }).click();
    mode = 'good'; await p.getByRole('button', { name: 'New project', exact: true }).first().click();
    await dialog.getByText('Fixture stream', { exact: true }).waitFor();
    await p.screenshot({ path: join(output, 'editor-library.png') }); await p.close();
  });
  await check('Editor full captions refusal and retry preserves saved edited words', async () => {
    const p = await pageFor('/editor', 400, true);
    let mode = 'failed';
    await p.route('**/api/clip-projects/fixture-project', r => r.fulfill(mode === 'failed' ? { status: 503, json: {} } : { json: { project: mode === 'malformed' ? { ...project, captionsOmitted: true } : project } }));
    await navigate(p, '/editor?open=fixture-project');
    await p.getByText('This clip project could not be opened', { exact: true }).waitFor();
    mode = 'malformed';
    let response = p.waitForResponse(r => new URL(r.url()).pathname === '/api/clip-projects/fixture-project');
    await p.getByRole('button', { name: 'Retry', exact: true }).click(); await response;
    await p.getByText('This clip project could not be opened', { exact: true }).waitFor();
    mode = 'good';
    response = p.waitForResponse(r => new URL(r.url()).pathname === '/api/clip-projects/fixture-project');
    await p.getByRole('button', { name: 'Retry', exact: true }).click(); await response;
    await p.getByRole('button', { name: /Saved|Save/, exact: true }).first().waitFor();
    assert.ok(await p.getByText('Hand edited fixture words', { exact: true }).count() > 0);
    await p.screenshot({ path: join(output, 'editor-detail.png') }); await p.close();
  });
  await check('Failed saves retain local edits, block leaving, and recover after reload', async () => {
    const p = await pageFor('/editor', 400, true);
    let storedProject = project, delayDetail = false, heldDetail;
    await p.route('**/api/clip-projects/fixture-project', r => {
      if (delayDetail) { heldDetail = r; return; }
      return r.fulfill({ json: { project: storedProject } });
    });
    let failed = true;
    const writes = [];
    await p.route('**/api/data', r => {
      const body = r.request().postDataJSON();
      assert.equal(body.action, 'upsertClipProject'); writes.push(body.payload);
      if (!failed) storedProject = body.payload;
      return r.fulfill(failed ? { status: 503, json: { error: 'Fixture server unavailable' } } : { json: { data: { ...bootstrap.data, clipProjects: [{ ...body.payload, captions: [], captionsOmitted: true, captionCount: body.payload.captions.length }] }, summary: bootstrap.summary } });
    });
    await navigate(p, '/editor?open=fixture-project');
    const title = p.locator('input.text-lg'); await title.waitFor();
    await title.fill('Recovered local edit');
    await p.getByText('Your clip changes are not saved', { exact: true }).waitFor();
    await p.getByText('Unsaved changes', { exact: true }).waitFor();
    assert.equal(await p.getByText('All changes saved', { exact: true }).count(), 0);
    const draft = await p.evaluate(() => JSON.parse(localStorage.getItem('capital-command:clip-editor-draft:fixture-project')));
    assert.equal(draft.name, 'Recovered local edit');
    await p.getByRole('button', { name: 'Projects', exact: true }).click();
    await p.getByRole('button', { name: 'Retry', exact: true }).waitFor();
    assert.ok(await title.isVisible());
    await p.reload({ waitUntil: 'domcontentloaded' });
    await title.waitFor(); assert.equal(await title.inputValue(), 'Recovered local edit');
    await p.getByText('Your clip changes are not saved', { exact: true }).waitFor();
    assert.equal(await p.getByText('All changes saved', { exact: true }).count(), 0);
    failed = false;
    await p.getByRole('button', { name: 'Retry', exact: true }).click();
    await p.getByText('All changes saved', { exact: true }).waitFor();
    await p.getByRole('button', { name: 'Projects', exact: true }).click();
    await p.getByRole('button', { name: 'New project', exact: true }).first().waitFor();
    assert.ok(writes.length >= 3);
    storedProject = { ...storedProject, captions: [{ ...project.captions[0], text: 'Latest saved caption after reopening' }] };
    delayDetail = true;
    const requested = p.waitForRequest(r => new URL(r.url()).pathname === '/api/clip-projects/fixture-project');
    await p.getByRole('button', { name: 'Open editor', exact: true }).click(); await requested;
    await p.getByText('Loading clip project…', { exact: true }).waitFor();
    assert.equal(await title.count(), 0, 'A previous full project must not mount before the new detail arrives');
    await heldDetail.fulfill({ json: { project: storedProject } });
    await title.waitFor();
    await p.getByRole('button', { name: 'Captions', exact: true }).click();
    await p.getByText('Latest saved caption after reopening', { exact: true }).first().waitFor({ state: 'attached' });
    await p.screenshot({ path: join(output, 'editor-save-recovery.png') }); await p.close();
  });
  assert.deepEqual(exceptions, [], 'Unexpected browser exceptions');
  assert.deepEqual(mutations, [], 'No mutation was authorized by the read recovery checks');
} finally {
  await browser?.close(); server.kill('SIGTERM');
  await writeFile(join(output, 'server.log'), log);
  await writeFile(join(output, 'browser-results.json'), JSON.stringify({ results, exceptions, mutations, output, mode: 'isolated next dev; fixture data; not deployment/performance evidence' }, null, 2));
  console.log('Evidence: ' + output);
}
