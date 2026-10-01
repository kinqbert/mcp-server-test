// Diagnostic output must never go to stdout: stdio uses it for MCP messages.
export function logTraffic(label, direction, data) {
  if (process.env.MCP_DEBUG !== '1') return;
  console.error(`[${new Date().toISOString()}] [${label}] ${direction}\n${JSON.stringify(data, null, 2)}`);
}

// Install before server.connect(): the SDK preserves the incoming callback.
export function logTransport(transport, label) {
  if (process.env.MCP_DEBUG !== '1') return transport;

  const onmessage = transport.onmessage;
  transport.onmessage = (message, extra) => {
    logTraffic(label, 'IN', message);
    onmessage?.(message, extra);
  };

  const send = transport.send.bind(transport);
  transport.send = async (message, options) => {
    logTraffic(label, 'OUT', message);
    return send(message, options);
  };

  return transport;
}
