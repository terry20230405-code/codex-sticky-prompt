import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

test('injector registers reload hook and evaluates overlay on Codex target', async () => {
  const methods = [];
  let port;
  const server = createServer((request, response) => {
    if (request.url !== '/json/list') { response.writeHead(404).end(); return; }
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify([{
      id: 'codex-shell', type: 'page', title: 'Codex', url: 'app://-/index.html',
      webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/codex-shell`,
    }]));
  });
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws));
  });
  wss.on('connection', (ws) => {
    ws.on('message', (data) => {
      const message = JSON.parse(String(data));
      methods.push(message.method);
      ws.send(JSON.stringify({ id: message.id, result: {
        result: { type: 'boolean', value: true },
      } }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-sticky-test-'));
  const readyFile = path.join(temporary, 'ready.json');

  const child = spawn(process.execPath, [fileURLToPath(new URL('../injector.mjs', import.meta.url)), '--port', String(port), '--ready-file', readyFile], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (data) => { output += data; });
  child.stderr.on('data', (data) => { output += data; });
  try {
    const deadline = Date.now() + 5000;
    while (!methods.includes('Page.addScriptToEvaluateOnNewDocument') ||
           methods.filter((method) => method === 'Runtime.evaluate').length < 1 ||
           !output.includes('Injected into Codex renderer')) {
      if (Date.now() > deadline) throw new Error(`Injector did not finish: ${output}`);
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    assert.ok(methods.includes('Page.enable'));
    assert.ok(output.includes('Injected into Codex renderer'));
    const ready = JSON.parse(await fs.readFile(readyFile, 'utf8'));
    assert.equal(ready.target, 'codex-shell');
  } finally {
    if (child.exitCode === null) {
      child.kill();
      await new Promise((resolve) => child.once('exit', resolve));
    }
    wss.close();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(temporary, { recursive: true, force: true });
  }
});
