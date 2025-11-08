import { wss } from './index.js';

export function broadcastStatus(data) {
  if (!wss) return;

  const message = JSON.stringify({
    timestamp: new Date().toISOString(),
    ...data,
  });

  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(message);
    }
  });
}
