import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from './server.js';
import { logTraffic, logTransport } from './logging.js';

export function createHttpApp() {
  // The SDK helper installs JSON parsing and localhost Host-header protection.
  const app = createMcpExpressApp({ host: '127.0.0.1' });
  let requestNumber = 0;

  app.use('/mcp', (req, res, next) => {
    res.locals.logLabel = `http:${++requestNumber}`;
    logTraffic(res.locals.logLabel, 'HTTP IN', { method: req.method, path: req.originalUrl, body: req.body });
    res.on('finish', () => {
      logTraffic(res.locals.logLabel, 'HTTP OUT', { status: res.statusCode, contentType: res.getHeader('content-type') });
    });
    next();
  });

  app.post('/mcp', async (req, res) => {
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // No persistent HTTP sessions.
    });
    logTransport(transport, res.locals.logLabel);

    // Register cleanup before handling the request, including disconnects.
    res.on('close', () => {
      server.close().catch((error) => console.error('Cleanup failed:', error));
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error('MCP request failed:', error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32603, message: 'Internal server error' },
        });
      } else if (!res.writableEnded) {
        res.end();
      }
    }
  });

  // This stateless example has no standalone event stream or session to delete.
  app.all('/mcp', (_req, res) => {
    res.set('Allow', 'POST').status(405).json({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32000, message: 'Method not allowed; use POST.' },
    });
  });

  return app;
}
