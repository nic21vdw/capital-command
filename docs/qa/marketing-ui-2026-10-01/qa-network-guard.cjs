// Verification-only guard. No non-loopback request can leave the app process.
const net = require('node:net');
const http = require('node:http');
const https = require('node:https');
const isLocal = (host) => ['localhost', '127.0.0.1', '::1', '[::1]'].includes(String(host));
const reject = (host) => { throw new Error('UI verification blocks external networking: ' + host); };
const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const first = args[0];
  if (typeof first === 'object' && first.path) return originalConnect.apply(this, args);
  const host = typeof first === 'object' ? first.host || 'localhost' : typeof args[1] === 'string' ? args[1] : 'localhost';
  if (!isLocal(host)) reject(host);
  return originalConnect.apply(this, args);
};
for (const mod of [http, https]) {
  const request = mod.request;
  mod.request = function (input, ...args) {
    const host = typeof input === 'string' || input instanceof URL ? new URL(input).hostname : input.hostname || input.host || 'localhost';
    if (!isLocal(host)) reject(host);
    return request.call(this, input, ...args);
  };
  mod.get = function (input, ...args) { const req = mod.request(input, ...args); req.end(); return req; };
}
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, ...args) => {
  const host = new URL(typeof input === 'string' || input instanceof URL ? input : input.url).hostname;
  if (!isLocal(host)) return Promise.reject(new Error('UI verification blocks external networking: ' + host));
  return originalFetch(input, ...args);
};
