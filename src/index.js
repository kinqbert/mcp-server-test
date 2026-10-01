import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';
import { createHttpApp } from './http.js';
import { logTransport } from './logging.js';

const mode = process.argv[2] ?? 'stdio';

if (mode === 'stdio') {
  const server = createServer();
  await server.connect(logTransport(new StdioServerTransport(), 'stdio'));
  // stdout belongs exclusively to MCP protocol messages.
  console.error('MCP server running over stdio');

  const shutdown = async () => {
    await server.close();
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
} else if (mode === 'http') {
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }

  const listener = createHttpApp().listen(port, '127.0.0.1', () => {
    console.error(`MCP server listening at http://127.0.0.1:${port}/mcp`);
  });
  listener.on('error', (error) => {
    console.error('HTTP server failed:', error.message);
    process.exit(1);
  });

  const shutdown = () => {
    listener.close();
    listener.closeAllConnections();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
} else {
  console.error('Usage: node src/index.js [stdio|http]');
  process.exitCode = 1;
}
