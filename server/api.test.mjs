import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

const password = 'test-only-password-0123456789-secure';
const pcAgentToken = 'test-pc-agent-token-0123456789-abcdef';
const serverAgentToken = 'test-server-agent-token-0123456789-abcdef';
const origin = 'https://dashboard.example';

async function freePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function startApi(stateFile, port) {
  const child = spawn(process.execPath, ['index.mjs'], {
    cwd: new URL('.', import.meta.url),
    env: {
      ...process.env,
      REMOTE_LOCK_OWNER: 'Innygr',
      REMOTE_LOCK_PASSWORD: password,
      REMOTE_LOCK_ALLOWED_ORIGIN: origin,
      REMOTE_LOCK_HOST: '127.0.0.1',
      REMOTE_LOCK_PORT: String(port),
      REMOTE_LOCK_STATE_FILE: stateFile,
      REMOTE_LOCK_AGENT_PC_TOKEN: pcAgentToken,
      REMOTE_LOCK_AGENT_SERVER_TOKEN: serverAgentToken
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk.toString(); });
  child.stderr.on('data', chunk => { output += chunk.toString(); });
  const base = 'http://127.0.0.1:' + port;
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('API exited during startup: ' + output);
    try {
      const response = await fetch(base + '/health');
      if (response.ok) return { child, base, output: () => output };
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  child.kill();
  throw new Error('API did not start: ' + output);
}

async function stopApi(child) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([once(child, 'exit'), new Promise(resolve => setTimeout(resolve, 1500))]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

async function login(base) {
  const response = await fetch(base + '/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ username: 'Innygr', password })
  });
  assert.equal(response.status, 200);
  return (await response.json()).token;
}

test('private API protects state and persists desired state across restart', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'remote-lock-test-'));
  const stateFile = path.join(dir, 'state.json');
  const port = await freePort();
  let running = await startApi(stateFile, port);
  t.after(async () => {
    await stopApi(running.child);
    await fs.rm(dir, { recursive: true, force: true });
  });

  const health = await fetch(running.base + '/health');
  assert.equal(health.status, 200);
  assert.equal((await health.json()).enforcement, 'DISABLED');

  const wrongOrigin = await fetch(running.base + '/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://attacker.example' },
    body: JSON.stringify({ username: 'Innygr', password })
  });
  assert.equal(wrongOrigin.status, 403);

  const noAuth = await fetch(running.base + '/api/devices');
  assert.equal(noAuth.status, 401);

  const noAgentAuth = await fetch(running.base + '/agent/PC/desired');
  assert.equal(noAgentAuth.status, 401);

  const badAgentAuth = await fetch(running.base + '/agent/PC/desired', {
    headers: { authorization: 'Bearer incorrect-agent-token' }
  });
  assert.equal(badAgentAuth.status, 401);

  const agentDesired = await fetch(running.base + '/agent/PC/desired', {
    headers: { authorization: 'Bearer ' + pcAgentToken }
  });
  assert.equal(agentDesired.status, 200);
  assert.equal((await agentDesired.json()).enforcement, 'DISABLED');

  const agentReport = await fetch(running.base + '/agent/PC/report', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + pcAgentToken },
    body: JSON.stringify({ reportedState: 'LOCKED' })
  });
  assert.equal(agentReport.status, 200);

  const token = await login(running.base);
  const unauthorizedChange = await fetch(running.base + '/api/devices/PC/state', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin, authorization: 'Bearer invalid-token' },
    body: JSON.stringify({ desiredState: 'LOCKED' })
  });
  assert.equal(unauthorizedChange.status, 401);

  const change = await fetch(running.base + '/api/devices/PC/state', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin, authorization: 'Bearer ' + token },
    body: JSON.stringify({ desiredState: 'LOCKED' })
  });
  assert.equal(change.status, 202);
  const changeResult = await change.json();
  assert.equal(changeResult.enforcement, 'DISABLED');

  const invalidState = await fetch(running.base + '/api/devices/PC/state', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin, authorization: 'Bearer ' + token },
    body: JSON.stringify({ desiredState: 'FORMAT_DISK' })
  });
  assert.equal(invalidState.status, 400);

  await stopApi(running.child);
  running = await startApi(stateFile, port);
  const tokenAfterRestart = await login(running.base);
  const stateResponse = await fetch(running.base + '/api/devices', {
    headers: { origin, authorization: 'Bearer ' + tokenAfterRestart }
  });
  assert.equal(stateResponse.status, 200);
  const persisted = await stateResponse.json();
  assert.equal(persisted.devices.PC.desiredState, 'LOCKED');
  assert.equal(persisted.devices.Server.desiredState, 'UNLOCKED');
  assert.equal(persisted.devices.PC.requestedBy, 'Innygr');
  assert.equal(persisted.devices.PC.reportedState, 'LOCKED');
  assert.equal(persisted.enforcement, 'DISABLED');

  const auditResponse = await fetch(running.base + '/api/audit', {
    headers: { origin, authorization: 'Bearer ' + tokenAfterRestart }
  });
  assert.equal(auditResponse.status, 200);
  const audit = await auditResponse.json();
  assert.equal(audit.entries.at(-1).action, 'DESIRED_STATE_CHANGED');
  assert.equal(audit.entries.at(-1).device, 'PC');
  assert.equal(audit.entries.at(-1).desiredState, 'LOCKED');
});
