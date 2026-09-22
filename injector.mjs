import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const portIndex = args.indexOf('--port');
const port = Number(portIndex >= 0 ? args[portIndex + 1] : 19177);
const readyFileIndex = args.indexOf('--ready-file');
const readyFile = readyFileIndex >= 0 ? args[readyFileIndex + 1] : null;
const mode = args.includes('--remove') ? 'remove' : args.includes('--probe') ? 'probe' : 'inject';
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error('Port must be an integer from 1024 to 65535.');
}
if (readyFileIndex >= 0 && !readyFile) throw new Error('--ready-file needs a path.');

const overlaySource = await fs.readFile(path.join(directory, 'sticky.js'), 'utf8');
const installExpression = `${overlaySource}\n//# sourceURL=codex-sticky-prompt.js`;
const removeExpression = 'window.__codexStickyPrompt?.destroy?.(); true';
const probeExpression = `({
  scrollers: document.querySelectorAll('.thread-scroll-container').length,
  userBubbles: document.querySelectorAll('[data-user-message-bubble]').length,
  installed: Boolean(window.__codexStickyPrompt?.active),
  version: window.__codexStickyPrompt?.version ?? null,
  unavailable: Boolean(window.__codexStickyPrompt?.unavailable)
})`;

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function targetAllowed(target) {
  if (target.type !== 'page' || !target.webSocketDebuggerUrl) return false;
  let pageUrl;
  let socketUrl;
  try {
    pageUrl = new URL(target.url);
    socketUrl = new URL(target.webSocketDebuggerUrl);
  } catch {
    return false;
  }
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(socketUrl.hostname)) return false;
  if (Number(socketUrl.port) !== port) return false;
  return pageUrl.protocol === 'app:' ||
    (pageUrl.protocol === 'file:' && /app\.asar.*[\\/]webview[\\/]/i.test(pageUrl.pathname));
}

async function listTargets() {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
    signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) throw new Error(`CDP returned HTTP ${response.status}`);
  const targets = await response.json();
  return targets.filter(targetAllowed);
}

class CdpClient {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.pending = new Map();
    this.nextId = 1;
    this.closed = false;
  }

  async open() {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP WebSocket timeout')), 5000);
      this.socket.addEventListener('open', () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      this.socket.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new Error('CDP WebSocket connection failed'));
      }, { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      let message;
      try { message = JSON.parse(String(event.data)); } catch { return; }
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
    this.socket.addEventListener('close', () => {
      this.closed = true;
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error('CDP WebSocket closed'));
      }
      this.pending.clear();
    });
  }

  call(method, params = {}) {
    if (this.closed) return Promise.reject(new Error('CDP WebSocket closed'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} timeout`));
      }, 5000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.call('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || 'Renderer evaluation failed');
    }
    return result.result?.value;
  }

  close() {
    if (!this.closed) this.socket.close();
  }
}

async function connectTarget(target) {
  const client = new CdpClient(target.webSocketDebuggerUrl);
  await client.open();
  await client.call('Runtime.enable');
  return client;
}

async function oneShot() {
  const targets = await listTargets();
  if (targets.length === 0) throw new Error('No Codex renderer target found on this port.');
  for (const target of targets) {
    const client = await connectTarget(target);
    try {
      const result = await client.evaluate(mode === 'remove' ? removeExpression : probeExpression);
      console.log(JSON.stringify({ mode, target: target.id, result }));
    } finally {
      client.close();
    }
  }
}

async function watch() {
  const active = new Map();
  let seenTarget = false;
  let missingSince = Date.now();
  let stopping = false;
  let ready = false;

  const shutdown = () => { stopping = true; };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  while (!stopping) {
    try {
      const targets = await listTargets();
      if (targets.length > 0) {
        seenTarget = true;
        missingSince = Date.now();
      }
      const currentIds = new Set(targets.map((target) => target.id));
      for (const [id, client] of active) {
        if (client.closed || !currentIds.has(id)) {
          client.close();
          active.delete(id);
        }
      }
      for (const target of targets) {
        if (active.has(target.id)) continue;
        try {
          const client = await connectTarget(target);
           await client.call('Page.enable');
           await client.call('Page.addScriptToEvaluateOnNewDocument', { source: installExpression });
           await client.evaluate(installExpression);
           if (readyFile && !ready) {
             await fs.writeFile(readyFile, JSON.stringify({ target: target.id, at: Date.now() }));
             ready = true;
           }
           active.set(target.id, client);
           console.log(`Injected into Codex renderer ${target.id}`);
        } catch (error) {
          console.error(`Injection failed for ${target.id}: ${error.message}`);
        }
      }
    } catch (error) {
      console.error(`CDP connection: ${error.message}`);
    }
    if (Date.now() - missingSince > (seenTarget ? 30000 : 60000)) break;
    await sleep(1500);
  }

  for (const client of active.values()) {
    try { await client.evaluate(removeExpression); } catch { /* renderer may have closed */ }
    client.close();
  }
}

if (mode === 'inject') await watch();
else await oneShot();
