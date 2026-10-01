import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

// Each connection gets its own server; tool definitions stay in one place.
export function createServer() {
  const server = new McpServer({
    name: 'simple-test-mcp-server',
    version: '1.0.0',
  });

  server.registerTool(
    'echo',
    {
      description: 'Return the supplied message unchanged.',
      inputSchema: { message: z.string() },
    },
    async ({ message }) => ({
      content: [{ type: 'text', text: message }],
    }),
  );

  server.registerTool(
    'add',
    {
      description: 'Add two numbers.',
      inputSchema: { a: z.number(), b: z.number() },
    },
    async ({ a, b }) => ({
      content: [{ type: 'text', text: String(a + b) }],
    }),
  );

  return server;
}
