import assert from 'node:assert/strict';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createHttpApp } from '../src/http.js';

async function checkTools(client) {
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((tool) => tool.name).sort(), ['add', 'echo']);

  const echo = await client.callTool({ name: 'echo', arguments: { message: 'Hello, MCP! 👋' } });
  assert.deepEqual(echo.content, [{ type: 'text', text: 'Hello, MCP! 👋' }]);

  const sum = await client.callTool({ name: 'add', arguments: { a: -2, b: 5.5 } });
  assert.deepEqual(sum.content, [{ type: 'text', text: '3.5' }]);

  const invalid = await client.callTool({ name: 'add', arguments: { a: 'two', b: 3 } });
  assert.equal(invalid.isError, true);
}

test('stdio: initialize, discover tools, call tools, validate input', { timeout: 10000 }, async (t) => {
  const client = new Client({ name: 'stdio-test', version: '1.0.0' });
  t.after(() => client.close());
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL('../src/index.js', import.meta.url)), 'stdio'],
    env: { MCP_DEBUG: '1' },
    stderr: 'pipe',
  });
  let logs = '';
  transport.stderr.on('data', (chunk) => { logs += chunk.toString(); });
  await client.connect(transport);
  await checkTools(client);
  await client.close();
  assert.match(logs, /\[stdio\] IN/);
  assert.match(logs, /\[stdio\] OUT/);
  assert.match(logs, /"method": "tools\/call"/);
  assert.match(logs, /"text": "3.5"/);
});

test('HTTP: tools work across stateless requests and concurrent clients', { timeout: 10000 }, async (t) => {
  const previousDebug = process.env.MCP_DEBUG;
  process.env.MCP_DEBUG = '1';
  t.after(() => {
    if (previousDebug === undefined) delete process.env.MCP_DEBUG;
    else process.env.MCP_DEBUG = previousDebug;
  });
  const log = t.mock.method(console, 'error', () => {});
  const listener = createHttpApp().listen(0, '127.0.0.1');
  t.after(() => new Promise((resolve, reject) => {
    listener.close((error) => error ? reject(error) : resolve());
    listener.closeAllConnections();
  }));
  await once(listener, 'listening');
  const url = new URL(`http://127.0.0.1:${listener.address().port}/mcp`);

  await Promise.all([1, 2].map(async (number) => {
    const client = new Client({ name: `http-test-${number}`, version: '1.0.0' });
    try {
      await client.connect(new StreamableHTTPClientTransport(url));
      await checkTools(client);
    } finally {
      await client.close();
    }
  }));

  for (const method of ['GET', 'DELETE']) {
    const response = await fetch(url, { method });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), 'POST');
    await response.arrayBuffer();
  }

  // Verify that POST responses actually use SSE within Streamable HTTP.
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/event-stream/);
  assert.equal(response.headers.get('mcp-session-id'), null);
  assert.match(await response.text(), /"echo"/);
  const logs = log.mock.calls.map((call) => call.arguments[0]).join('\n');
  assert.match(logs, /\[http:\d+\] IN/);
  assert.match(logs, /\[http:\d+\] OUT/);
  assert.match(logs, /"text": "3.5"/);
  assert.match(logs, /"status": 405/);
});
