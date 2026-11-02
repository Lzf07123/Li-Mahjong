import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RoomManager } from './rooms.js';
import * as dbi from './db.js';
import { readFileSync } from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const STATIC_DIR = process.env.STATIC_DIR || '';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: true, credentials: true },
  maxHttpBufferSize: 1e6,
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

app.get('/api/library', (_req, res) => {
  const file = path.join(here, '..', 'data', 'builtin-conditions.json');
  const data = JSON.parse(readFileSync(file, 'utf-8'));
  res.json({ categories: data.categories, builtin: data.cards, custom: dbi.listAllCustomCards() });
});

app.get('/api/history', (_req, res) => {
  res.json({ items: dbi.historyList(100) });
});

app.get('/api/history/:id', (req, res) => {
  const id = Number(req.params.id);
  const detail = Number.isInteger(id) ? dbi.historyDetail(id) : null;
  if (!detail) return res.status(404).json({ error: '战局不存在' });
  res.json(detail);
});

app.get('/api/stats', (_req, res) => {
  res.json({ items: dbi.stats() });
});

const rm = new RoomManager(io);
io.on('connection', (socket) => rm.register(socket));

if (STATIC_DIR) {
  app.use(express.static(STATIC_DIR));
  app.get(/^(?!\/api|\/socket\.io).*/, (_req, res) => {
    res.sendFile(path.join(STATIC_DIR, 'index.html'));
  });
}

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`[mahjong] server listening on :${PORT} (DATA_DIR=${process.env.DATA_DIR ?? '.data'})`);
});
