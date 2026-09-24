import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';

// No provider, release process, filesystem data, or network is reachable here.
const calls = { release: 0, voice: 0, revoke: 0, status: 0 };
globalThis.__originTestCalls = calls;
const source = {
  'next/server': `export class NextRequest extends Request {};
    export const NextResponse = { json: (body, init) => Response.json(body, init) };`,
  'zod': `const chain = { optional() { return this; }, trim() { return this; }, max() { return this; } };
    export const z = { enum: () => chain, string: () => chain, boolean: () => chain,
    object: () => ({ safeParse: data => ({ success: true, data }) }) };`,
  '@/lib/release/status': `export async function readReleaseStatus() { globalThis.__originTestCalls.status++; return { releasable: true, pending: [1], latestShort: 'fixture' }; }`,
  '@/lib/release/run': `export const isReleaseInFlight = () => false; export function startRelease() { globalThis.__originTestCalls.release++; return { started: true }; }`,
  '@/lib/release/progress': `export const readReleaseProgress = async () => ({});`,
  '@/lib/release/shared': `export const releaseStillRunning = () => false;`,
  '@/lib/release/runtime': `export const releaseRuntime = () => ({});`,
  '@/lib/voice/providers': `export const voiceProviderStatus = async () => ({});`,
  '@/lib/voice/prompt': `export const voiceInstructions = async () => 'fixture';`,
  '@/lib/voice/session': `export async function createVoiceSession() { globalThis.__originTestCalls.voice++; return {}; } export function revokeGrant() { globalThis.__originTestCalls.revoke++; }`
};
const hooks = registerHooks({ resolve(specifier, context, next) {
  if (specifier === '@/lib/security/mutation-origin') return { url: new URL('../src/lib/security/mutation-origin.ts', import.meta.url).href, shortCircuit: true };
  if (Object.hasOwn(source, specifier)) return { url: 'data:text/javascript,' + encodeURIComponent(source[specifier]), shortCircuit: true };
  return next(specifier, context);
}});
const { mutationOriginAllowed } = await import('../src/lib/security/mutation-origin.ts');
const update = await import('../src/app/api/update/route.ts');
const voice = await import('../src/app/api/voice/session/route.ts');

function request(path, headers, method = 'POST') {
  const req = new Request(`http://localhost:3000/api/${path}`, { method, headers,
    ...(method === 'POST' ? { body: '{}' } : {}) });
  req.nextUrl = new URL(req.url);
  return req;
}

test('cross-site and opaque requests never reach mutation dependencies', async () => {
  for (const headers of [
    { origin: 'https://attacker.invalid', 'content-type': 'text/plain' },
    { origin: 'null' },
    { origin: 'http://localhost:3100' },
    { origin: 'http://localhost:3000.attacker.invalid' },
    { origin: 'http://localhost:3000/path' },
    { 'sec-fetch-site': 'cross-site' },
    { 'sec-fetch-site': 'same-site' },
    { origin: 'http://localhost:3000', 'sec-fetch-site': 'cross-site' }
  ]) {
    const before = { ...calls };
    assert.equal((await update.POST(request('update', headers))).status, 403);
    assert.equal((await voice.POST(request('voice/session', headers))).status, 403);
    assert.equal((await voice.DELETE(request('voice/session', headers, 'DELETE'))).status, 403);
    assert.deepEqual(calls, before);
  }
});

test('same-origin browser, same-origin iframe and direct local CLI remain operational', async () => {
  for (const key of Object.keys(calls)) calls[key] = 0;
  for (const headers of [
    { origin: 'http://localhost:3000', 'sec-fetch-site': 'same-origin' },
    { origin: 'http://localhost:3000', 'sec-fetch-site': 'same-origin', 'sec-fetch-dest': 'iframe' },
    { 'sec-fetch-site': 'same-origin' },
    {}
  ]) {
    assert.equal((await update.POST(request('update', headers))).status, 200);
    assert.equal((await voice.POST(request('voice/session', headers))).status, 201);
    assert.equal((await voice.DELETE(request('voice/session', headers, 'DELETE'))).status, 200);
  }
  assert.deepEqual(calls, { release: 4, voice: 4, revoke: 4, status: 4 });
});


test('loopback Host survives Next hostname normalization and rejects rebinding', () => {
  const normalized = new Request('http://127.0.0.1:3000/api/update', {
    headers: { host: 'localhost:3000', origin: 'http://localhost:3000', 'sec-fetch-site': 'same-origin' }
  });
  assert.equal(mutationOriginAllowed(normalized), true);
  for (const host of ['attacker.invalid:3000', 'localhost:3100', 'localhost:3000/path', 'user@localhost:3000']) {
    assert.equal(mutationOriginAllowed(new Request('http://127.0.0.1:3000/api/update', {
      headers: { host, origin: 'http://' + host }
    })), false, host);
  }
  assert.equal(mutationOriginAllowed(new Request('http://attacker.invalid:3000/api/update', {
    headers: { host: 'attacker.invalid:3000', origin: 'http://attacker.invalid:3000' }
  })), false);
});
