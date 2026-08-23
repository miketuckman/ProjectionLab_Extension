const NATIVE_HOST_NAME = 'com.miketuckman.projectionlab_bridge';

export function startNativeBridge(handleRequest) {
  let port = null;
  let reconnectTimer = null;
  let reconnectDelayMs = 5_000;

  const scheduleReconnect = () => {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, reconnectDelayMs);
    reconnectDelayMs = Math.min(reconnectDelayMs * 2, 60_000);
  };

  const connect = () => {
    try {
      port = chrome.runtime.connectNative(NATIVE_HOST_NAME);
    } catch (error) {
      console.warn('[ProjectionLab MCP] Native host unavailable:', error.message);
      scheduleReconnect();
      return;
    }

    port.onMessage.addListener(async (message) => {
      if (message?.type !== 'request' || typeof message.id !== 'string') return;
      try {
        const result = await handleRequest(message.action, message.params || {});
        port?.postMessage({ type: 'response', id: message.id, ok: true, result });
      } catch (error) {
        port?.postMessage({
          type: 'response',
          id: message.id,
          ok: false,
          error: error.message || String(error),
        });
      }
    });

    port.onDisconnect.addListener(() => {
      const error = chrome.runtime.lastError;
      if (error) console.warn('[ProjectionLab MCP] Native bridge disconnected:', error.message);
      port = null;
      scheduleReconnect();
    });
    reconnectDelayMs = 5_000;
  };

  connect();
  return () => {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    port?.disconnect();
    port = null;
  };
}
