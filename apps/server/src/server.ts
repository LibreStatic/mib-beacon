/**
 * MIB Beacon — LAN server. Runs the engine on this host and serves the
 * react-native-web UI + a WebSocket engine bridge to any browser/phone on the
 * network. No authentication (LAN-only, non-confidential by design).
 *
 * SNMP is sent FROM this host, so it must sit on the management network.
 */
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { WebSocketServer, type WebSocket } from 'ws';
import { createNodeTransport } from '@mibbeacon/transport/node';
import { createEngine } from '@mibbeacon/core';
import { dispatchEngineCall, ENGINE_EVENT_CHANNELS } from '@mibbeacon/core/bridge';
import { createServerSecretStore, verifyServerSecretStore } from './secrets';

const PORT = Number(process.env.MIB_BEACON_SERVER_PORT ?? 8899);
const HOST = process.env.MIB_BEACON_SERVER_HOST ?? '0.0.0.0';
const WEB_DIR = path.resolve(import.meta.dirname, '../dist/web');
const DATA_DIR = process.env.MIB_BEACON_SERVER_DATA ?? path.join(os.homedir(), '.mibbeacon', 'server');

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

async function main() {
  await mkdir(DATA_DIR, { recursive: true });
  const secretStoreOptions = {
    filePath: path.join(DATA_DIR, 'credentials.json'),
    key: process.env.MIB_BEACON_SERVER_SECRET_KEY,
  };
  await verifyServerSecretStore(secretStoreOptions);
  const secrets = createServerSecretStore(secretStoreOptions);
  const engine = createEngine(createNodeTransport({ dataDir: DATA_DIR, secrets }), {
    dbPath: path.join(DATA_DIR, 'mibbeacon.db'),
  });

  const server = http.createServer((req, res) => void serveStatic(req, res));

  // --- WebSocket engine bridge ---
  // A validated 50 MiB text batch grows when JSON encoded over the bridge.
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 * 1024 });
  const clients = new Set<WebSocket>();

  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.on('message', async (raw) => {
      let msg: { type?: string; id?: number; method?: string; args?: unknown[] };
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.type === 'call' && msg.method) {
        const result = await dispatchEngineCall(engine, msg.method, msg.args ?? []);
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'result', id: msg.id, result }));
      }
    });
    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));
  });

  // Broadcast engine events to every connected client.
  for (const channel of ENGINE_EVENT_CHANNELS) {
    engine.events.subscribe(channel, (event) => {
      const payload = JSON.stringify({ type: 'event', event });
      for (const ws of clients) if (ws.readyState === ws.OPEN) ws.send(payload);
    });
  }

  server.listen(PORT, HOST, () => {
    const info = engine.system.info();
    void info; // engine ready
    console.log(`\nMIB Beacon server listening on ${HOST}:${PORT}`);
    console.log('Open in a browser on this network:');
    console.log(`  http://localhost:${PORT}`);
    for (const url of lanUrls(PORT)) console.log(`  ${url}`);
    console.log('\n(No authentication — LAN use. SNMP is sent from this host.)\n');
  });
}

async function serveStatic(req: http.IncomingMessage, res: http.ServerResponse) {
  let urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]!);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(WEB_DIR, urlPath);
  if (!filePath.startsWith(WEB_DIR)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  try {
    const data = await readFile(filePath);
    res.writeHead(200, { 'content-type': CONTENT_TYPES[path.extname(filePath)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    // SPA fallback
    try {
      const html = await readFile(path.join(WEB_DIR, 'index.html'));
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(html);
    } catch {
      res.writeHead(404).end(
        'Web bundle not built. Run: pnpm --filter @mibbeacon/server build:web',
      );
    }
  }
}

function lanUrls(port: number): string[] {
  const out: string[] = [];
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) out.push(`http://${a.address}:${port}`);
    }
  }
  return out;
}

main().catch((e) => {
  console.error('server failed to start:', e);
  process.exit(1);
});
