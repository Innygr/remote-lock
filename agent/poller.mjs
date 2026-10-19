import process from 'node:process';

const device = process.env.REMOTE_LOCK_DEVICE;
const apiBase = (process.env.REMOTE_LOCK_AGENT_URL || '').replace(/\/$/, '');
const token = process.env.REMOTE_LOCK_AGENT_TOKEN || '';
const intervalMs = Number(process.env.REMOTE_LOCK_POLL_MS || 15000);

if (!['PC', 'Server'].includes(device)) {
  console.error('Set REMOTE_LOCK_DEVICE to PC or Server.');
  process.exit(1);
}
if (!apiBase || !/^https:\/\//.test(apiBase)) {
  console.error('Set REMOTE_LOCK_AGENT_URL to the private API HTTPS URL.');
  process.exit(1);
}
if (token.length < 32 || token.includes('replace-with-')) {
  console.error('Set REMOTE_LOCK_AGENT_TOKEN to this device’s unique 32+ character token.');
  process.exit(1);
}
if (!Number.isInteger(intervalMs) || intervalMs < 5000 || intervalMs > 120000) {
  console.error('REMOTE_LOCK_POLL_MS must be between 5000 and 120000.');
  process.exit(1);
}

let stopped = false;
let lastDesired = '';
let failures = 0;

async function request(path, options = {}) {
  const response = await fetch(apiBase + path, {
    method: options.method || 'GET',
    headers: {
      authorization: 'Bearer ' + token,
      ...(options.body ? { 'content-type': 'application/json' } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(8000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error('API request failed with HTTP ' + response.status + ': ' + (data.error || 'no details'));
  return data;
}

async function cycle() {
  try {
    const result = await request('/agent/' + device + '/desired');
    failures = 0;
    if (result.desiredState !== lastDesired) {
      console.log(new Date().toISOString(), device, 'desired state changed to', result.desiredState);
      lastDesired = result.desiredState;
    }
    // The polling prototype deliberately does not enforce a lock state.
    // Until a verified per-session UI and recovery path exist, report UNKNOWN.
    await request('/agent/' + device + '/report', {
      method: 'POST',
      body: { reportedState: 'UNKNOWN' }
    });
  } catch (error) {
    failures += 1;
    console.error(new Date().toISOString(), device, 'poll failed (' + failures + '):', error.message);
  }
}

function stop() {
  stopped = true;
  console.log('Remote Lock agent poller stopped.');
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

console.log('Remote Lock agent poller starting for', device);
console.log('Polling only; Windows lock enforcement is disabled.');
while (!stopped) {
  await cycle();
  if (!stopped) await new Promise(resolve => setTimeout(resolve, intervalMs));
}
