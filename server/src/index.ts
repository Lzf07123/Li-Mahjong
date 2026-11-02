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
// 管理后台口令：生产部署务必通过环境变量覆盖
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'admin123';

function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (req.header('x-admin-token') !== ADMIN_TOKEN) {
    return res.status(401).json({ error: '管理口令错误' });
  }
  next();
}

const app = express();
app.use(express.json());
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: true, credentials: true },
  maxHttpBufferSize: 1e6,
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

app.get('/api/me', (req, res) => {
  const uid = String(req.query.uid ?? '').trim();
  if (!uid) return res.json({ uid: '', name: '', games: 0, total: 0, wins: 0 });
  res.json(dbi.meInfo(uid));
});

app.get('/api/library', (_req, res) => {
  const file = path.join(here, '..', 'data', 'builtin-conditions.json');
  const data = JSON.parse(readFileSync(file, 'utf-8'));
  res.json({ categories: data.categories, builtin: data.cards, custom: dbi.listAllCustomCards() });
});

// ---------- 管理后台 ----------
app.get('/api/admin/overview', requireAdmin, (_req, res) => {
  res.json(dbi.adminOverview());
});

app.get('/api/admin/users', requireAdmin, (req, res) => {
  const query = String(req.query.query ?? '').trim().slice(0, 64);
  res.json({ items: dbi.adminUsers(query) });
});

app.patch('/api/admin/users/:uid', requireAdmin, (req, res) => {
  const name = String(req.body?.name ?? '').trim().slice(0, 12);
  if (!name) return res.status(400).json({ error: '昵称不能为空' });
  if (!dbi.adminRenameUser(String(req.params.uid), name))
    return res.status(404).json({ error: '用户不存在' });
  res.json({ ok: true });
});

app.delete('/api/admin/users/:uid', requireAdmin, (req, res) => {
  if (!dbi.adminDeleteUser(String(req.params.uid)))
    return res.status(404).json({ error: '用户不存在' });
  res.json({ ok: true });
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
