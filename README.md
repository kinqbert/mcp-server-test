# Simple test MCP server

A small JavaScript MCP server exposing the same two tools over **stdio** and
**Streamable HTTP**. Requires Node.js 22 or newer. No build step, API keys, or
external services are needed.

## Run it

```sh
npm install
npm run start:http
```

The MCP endpoint is `http://127.0.0.1:3000/mcp`. To choose another port:

```sh
PORT=4000 npm run start:http
```

For stdio:

```sh
node src/index.js stdio
```

It waits for MCP messages on stdin. Normally your MCP client launches this
command itself. `npm start` also defaults to stdio, but configure clients to
launch `node` directly so npm's startup output cannot pollute the protocol.
Stop either mode with Ctrl+C. Run both commands in separate processes if you
want both transports available at once.

## Connect a client

For a client accepting the common `mcpServers` configuration format:

```json
{
  "mcpServers": {
    "simple-test": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-server-test/src/index.js", "stdio"]
    }
  }
}
```

Replace the path with your actual checkout path. For HTTP, start the server and
configure your client with transport **Streamable HTTP** and URL
`http://127.0.0.1:3000/mcp`; configuration syntax varies by client.

Available tools:

| Tool | Arguments | Result text |
| --- | --- | --- |
| `echo` | `{ "message": "hello" }` | `hello` |
| `add` | `{ "a": 2, "b": 3 }` | `5` |

Run the integration tests with `npm test`. They use real SDK clients, spawn the
stdio process, and start HTTP on an automatically allocated local port.

## Code walkthrough

### Explore with MCP Inspector and traffic logs

From this folder, start HTTP with logging:

```sh
MCP_DEBUG=1 npm run start:http
```

In another terminal, open the Inspector web interface:

```sh
npx @modelcontextprotocol/inspector --transport http --server-url http://127.0.0.1:3000/mcp
```

Open the URL printed by Inspector, connect to the server, and explore its tools.
Call `echo` with a message or `add` with two numbers. The server terminal shows
incoming/outgoing JSON-RPC messages, timestamps, HTTP request numbers, and HTTP
response statuses. Inspector can also show the requests and results on its side.
If the UI asks for a protocol era, use the default `legacy` for this SDK server.

For stdio, Inspector launches the process itself (no separate server needed):

```sh
npx @modelcontextprotocol/inspector node src/index.js stdio -e MCP_DEBUG=1
```

The server's debug output goes to stderr, captured by Inspector. Inspect its
server stderr/log output; the precise panel name depends on Inspector version.
HTTP mode is convenient when you want the server logs in a separate terminal.

For command-line checks without the web UI:

```sh
npx @modelcontextprotocol/inspector --cli node src/index.js stdio --method tools/list
npx @modelcontextprotocol/inspector --cli --transport http --server-url http://127.0.0.1:3000/mcp --method tools/call --tool-name add --tool-arg a=2 --tool-arg b=3
```

For a raw HTTP request while the HTTP server is running:

```sh
curl -i -N http://127.0.0.1:3000/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"add","arguments":{"a":2,"b":3}}}'
```

This stateless server accepts the isolated call; normal MCP clients perform
initialization first. The result's text should be `5` inside an SSE `data:` line.
A browser address-bar visit sends GET and therefore returns 405, as intended.

To save HTTP logs to a file and watch them separately:

```sh
MCP_DEBUG=1 node src/index.js http 2>mcp.log
# In another terminal:
tail -f mcp.log
```

Omit `MCP_DEBUG=1` to disable traffic logging. Debug logs include complete tool
arguments and results. These are local diagnostics, not MCP logging notifications.
`src/logging.js` observes the transport's incoming callback and outgoing `send()`;
it logs outgoing messages before sending, not proof of delivery. It does not dump
raw HTTP bytes or headers. HTTP responses rejected inside the SDK can appear only
as status lines, and malformed JSON rejected by the JSON parser never reaches
the traffic logger.

Inspector commands follow the [official server configuration guide](https://github.com/modelcontextprotocol/inspector/blob/main/docs/mcp-server-configuration.md).

### 1. `package.json`: runtime and dependencies

`"type": "module"` enables JavaScript `import`/`export` and top-level `await`.
The MCP SDK implements the protocol and transports. Zod describes and validates
tool arguments. The HTTP app uses the Express helper shipped with the SDK.
The npm scripts are shortcuts for the entry point and Node's built-in test runner.
`package-lock.json` records the exact installed dependency versions.

### 2. `src/server.js`: define what the server can do

`createServer()` creates an `McpServer` with a name and version that clients see
during initialization. It then registers `echo` and `add` and returns the server.
This function knows nothing about HTTP or stdin: it defines behavior shared by
both transports.

Each `registerTool()` call has three parts:

1. A unique tool name used in `tools/call` requests.
2. Metadata: a description and `inputSchema`. `z.string()` requires a string;
   `z.number()` requires a number. The SDK advertises the schema to clients and
   checks arguments before invoking the handler.
3. An async handler receiving validated arguments and returning an MCP result.

Results contain a `content` array. Our tools each return one text block, so the
addition result is converted to a string. For example, adding 2 and 3 returns
`{ "content": [{ "type": "text", "text": "5" }] }`.

The SDK supplies the initialization handshake, tool discovery (`tools/list`),
tool dispatch (`tools/call`), and protocol error handling. There is no LLM in this
server: a client or its model decides whether to call a tool, and this process
executes the requested handler.

### 3. `src/index.js`: select the transport

`process.argv[2]` reads the first command-line argument after the script path.
If absent, `?? 'stdio'` selects stdio. An unsupported mode prints usage and exits
with a failure status.

In stdio mode, `createServer()` constructs the tool server and
`StdioServerTransport` attaches it to stdin/stdout. `server.connect()` wires up
the transport and starts receiving protocol messages. The client writes
newline-delimited JSON-RPC messages to stdin and reads responses from stdout.
Diagnostics go to `console.error()` (stderr), because ordinary text on stdout
would corrupt that protocol channel. SIGINT and SIGTERM close the connection.

In HTTP mode, the entry point validates `PORT`, creates the HTTP app, and listens
only on `127.0.0.1`. Startup errors such as an occupied port are reported on
stderr. On shutdown, the listener stops accepting requests and active HTTP
connections are closed. This small example does not drain long-running work.

### 4. `src/http.js`: carry MCP over HTTP

`createMcpExpressApp()` provides an Express app with JSON body parsing and
localhost Host-header protection. `POST /mcp` is the protocol endpoint.

Every POST gets a fresh MCP server and `StreamableHTTPServerTransport`.
`sessionIdGenerator: undefined` chooses **stateless mode**: there is no session
ID, session map, or conversation data retained between HTTP requests. Separate
server instances keep concurrent requests isolated.

`server.connect(transport)` links tool handling to HTTP communication.
`transport.handleRequest(req, res, req.body)` hands the parsed JSON-RPC message
to the SDK. The SDK negotiates protocol details, dispatches the request, and
writes the HTTP response. Its default response mode uses Server-Sent Events
(SSE) for requests; a one-result tool still uses that response framing.
Accepted notifications can receive HTTP 202 without a response body.

The response's `close` event cleans up that request's server and its transport.
The error handler logs unexpected failures and sends a generic JSON-RPC error
if response headers have not already been sent.

GET and DELETE return 405: this example offers neither a standalone GET event
stream nor persistent sessions to delete. This is Streamable HTTP using SSE in
POST responses, not the older separate HTTP+SSE transport. It does not support
resuming streams or unsolicited notifications between requests.

### 5. A request from start to finish

For a typical SDK client:

1. The client connects and sends `initialize` with its capabilities and protocol
   version; the SDK replies with the server's identity and capabilities.
2. The client sends `notifications/initialized` to finish initialization.
3. `tools/list` returns the two tools and their argument schemas.
4. The client sends `tools/call` with a tool name and arguments.
5. The SDK validates the arguments, runs the handler, and returns its content.

These are JSON-RPC messages on both transports. HTTP stateless mode accepts
subsequent requests on fresh server instances; it does not retain the initial
handshake as a server-side session.

### 6. `test/server.test.js`: verify both paths

The shared `checkTools()` helper discovers tools, echoes Unicode text, adds a
negative number and a decimal, and checks that a string passed as a numeric
argument produces a tool error.

The stdio test launches the actual entry point as a child process. The HTTP
test exercises two concurrent clients over real local sockets, checks the 405
responses, and verifies the SSE content type and absence of a session ID.
Cleanup closes clients and the listener after the tests.

## Scope

This is a local test server with no authentication or persistent storage. It
only provides tools; resources and prompt templates are separate optional MCP
features. `add` uses ordinary JavaScript floating-point arithmetic.

References: [official SDK server guide](https://ts.sdk.modelcontextprotocol.io/server)
and [MCP transport specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports).
