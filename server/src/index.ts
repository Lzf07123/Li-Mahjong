import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { RoomManager } from './rooms.js';
import * as dbi from './db.js';
import { readFileSync } from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const STATIC_DIR = process.env.STATIC_DIR || '';
// 管理后台口令：生产部署务必通过环境变量覆盖
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'admin123';
if (!process.env.ADMIN_TOKEN) {
  console.warn('[mahjong] ⚠️ 未设置 ADMIN_TOKEN，正在使用默认口令，生产环境请务必通过环境变量覆盖');
}

function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  const given = String(req.header('x-admin-token') ?? '');
  const a = Buffer.from(given);
  const b = Buffer.from(ADMIN_TOKEN);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return res.status(401).json({ error: '管理口令错误' });
  }
  next();
}

// ---------- 轻量内存限流 ----------
const buckets = new Map<string, { count: number; reset: number }>();
function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < now) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  b.count += 1;
  return b.count <= limit;
}
function clientIp(req: express.Request): string {
  const fwd = req.header('x-forwarded-for');
  return (fwd ? fwd.split(',')[0].trim() : '') || req.socket.remoteAddress || 'unknown';
}

const app = express();
app.use(express.json({ limit: '16kb' }));
// 基础安全响应头
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});
const httpServer = createServer(app);
// 不开放跨域：浏览器仅允许同源访问（node 客户端不受 CORS 约束）
const io = new Server(httpServer, {
  cors: { origin: false },
  maxHttpBufferSize: 1e6,
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

const bearer = (req: express.Request): string =>
  String(req.header('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();

// ---------- 图形验证码 ----------
const CAPTCHA_CHARS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const CAPTCHA_TTL = 5 * 60 * 1000;
const captchas = new Map<string, { text: string; expires: number }>();
const ALLOW_TEST_CAPTCHA = process.env.ALLOW_TEST_CAPTCHA === '1';

function issueCaptcha(): { id: string; text: string } {
  const id = randomUUID();
  const text = Array.from({ length: 4 }, () => CAPTCHA_CHARS[Math.floor(Math.random() * CAPTCHA_CHARS.length)]).join('');
  captchas.set(id, { text, expires: Date.now() + CAPTCHA_TTL });
  // 硬容量上限：防刷导致内存无限增长（超限时淘汰最早的）
  while (captchas.size > 3000) {
    const oldest = captchas.keys().next().value;
    if (oldest === undefined) break;
    captchas.delete(oldest);
  }
  return { id, text };
}

function renderCaptchaSvg(text: string): string {
  const W = 132;
  const H = 46;
  const colors = ['#7ee2b8', '#f2c94c', '#f2994a', '#9bd0f0', '#f2a3c0'];
  const parts: string[] = ['<rect width="100%" height="100%" fill="#0d3d2e" rx="8"/>'];
  for (let i = 0; i < text.length; i++) {
    const x = 16 + i * 29 + Math.random() * 6;
    const y = 33 + (Math.random() * 8 - 4);
    const rot = Math.round(Math.random() * 44 - 22);
    const c = colors[Math.floor(Math.random() * colors.length)];
    const fs = 24 + Math.round(Math.random() * 6);
    parts.push(
      `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" fill="${c}" font-size="${fs}" font-family="Georgia, serif" font-weight="bold" transform="rotate(${rot} ${x.toFixed(1)} ${y.toFixed(1)})">${text[i]}</text>`,
    );
  }
  for (let i = 0; i < 4; i++) {
    parts.push(
      `<line x1="${(Math.random() * W).toFixed(0)}" y1="${(Math.random() * H).toFixed(0)}" x2="${(Math.random() * W).toFixed(0)}" y2="${(Math.random() * H).toFixed(0)}" stroke="${colors[i % colors.length]}" stroke-width="1.5" stroke-opacity="0.55"/>`,
    );
  }
  for (let i = 0; i < 12; i++) {
    parts.push(
      `<circle cx="${(Math.random() * W).toFixed(0)}" cy="${(Math.random() * H).toFixed(0)}" r="1.2" fill="#ffffff" fill-opacity="0.22"/>`,
    );
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join('')}</svg>`;
}

/** 校验图形验证码；通过返回 null，否则返回错误文案 */
function checkCaptcha(req: express.Request): string | null {
  if (ALLOW_TEST_CAPTCHA && req.header('x-test-captcha') === '1') return null;
  const id = String(req.body?.captchaId ?? '');
  const text = String(req.body?.captchaText ?? '').trim().toUpperCase();
  const rec = id ? captchas.get(id) : undefined;
  captchas.delete(id); // 一次性
  if (!rec || rec.expires < Date.now()) return '验证码已过期，请刷新后重试';
  if (text !== rec.text) return '验证码错误';
  return null;
}

app.get('/api/captcha', (req, res) => {
  if (!rateLimit(`cap:${clientIp(req)}`, 60, 5 * 60e3)) {
    return res.status(429).json({ error: '请求过于频繁，请稍后再试' });
  }
  const { id, text } = issueCaptcha();
  res.json({ id, svg: renderCaptchaSvg(text) });
});

// ---------- 注册 / 登录 ----------
const LOGIN_NAME_RE = /^[a-zA-Z0-9_]{3,16}$/;
const NAME_RE = /^[\w\u4e00-\u9fa5]{2,12}$/u;
const checkPassword = (pw: string): string | null => {
  if (typeof pw !== 'string' || pw.length < 8 || pw.length > 64) return '密码长度 8-64 位';
  if (!/[a-zA-Z]/.test(pw) || !/\d/.test(pw)) return '密码需同时包含字母和数字';
  return null;
};

app.post('/api/auth/register', (req, res) => {
  if (!rateLimit(`reg:${clientIp(req)}`, 10, 10 * 60e3)) {
    return res.status(429).json({ error: '注册过于频繁，请稍后再试' });
  }
  const captchaErr = checkCaptcha(req);
  if (captchaErr) return res.status(400).json({ error: captchaErr });
  const loginName = String(req.body?.loginName ?? '').trim();
  const name = String(req.body?.name ?? '').trim();
  const password = String(req.body?.password ?? '');
  if (!LOGIN_NAME_RE.test(loginName))
    return res.status(400).json({ error: '登录名 3-16 位，仅字母、数字、下划线' });
  if (!NAME_RE.test(name))
    return res.status(400).json({ error: '昵称 2-12 位，可含中文、字母、数字、下划线' });
  const pwErr = checkPassword(password);
  if (pwErr) return res.status(400).json({ error: pwErr });
  const created = dbi.createUserWithPass(loginName, name, password);
  if (!created) return res.status(409).json({ error: '登录名已被注册，换个试试' });
  const token = dbi.createSession(created.uid);
  res.json({ token, user: { uid: created.uid, name: created.name } });
});

app.post('/api/auth/login', (req, res) => {
  if (!rateLimit(`login:${clientIp(req)}`, 15, 5 * 60e3)) {
    return res.status(429).json({ error: '尝试过于频繁，请 5 分钟后再试' });
  }
  const captchaErr = checkCaptcha(req);
  if (captchaErr) return res.status(400).json({ error: captchaErr });
  const loginName = String(req.body?.loginName ?? '').trim();
  const password = String(req.body?.password ?? '');
  const user = dbi.findUserByUsername(loginName);
  if (!user || !dbi.verifyPassword(password, user.pass))
    return res.status(401).json({ error: '登录名或密码错误' });
  const token = dbi.createSession(user.uid);
  res.json({ token, user: { uid: user.uid, name: user.name } });
});

app.post('/api/auth/logout', (req, res) => {
  dbi.deleteSession(bearer(req));
  res.json({ ok: true });
});

// 登录后自助修改昵称
app.post('/api/auth/change-name', (req, res) => {
  const user = dbi.userBySession(bearer(req));
  if (!user) return res.status(401).json({ error: '未登录' });
  const name = String(req.body?.name ?? '').trim();
  if (!NAME_RE.test(name)) return res.status(400).json({ error: '昵称 2-12 位，可含中文、字母、数字、下划线' });
  dbi.updateNameByUid(user.uid, name);
  res.json({ ok: true, user: { uid: user.uid, name } });
});

// 登录后自助修改密码（需验证旧密码）
app.post('/api/auth/change-password', (req, res) => {
  const user = dbi.userBySession(bearer(req));
  if (!user) return res.status(401).json({ error: '未登录' });
  const oldPassword = String(req.body?.oldPassword ?? '');
  const newPassword = String(req.body?.newPassword ?? '');
  const full = dbi.findUserByUsername(user.username ?? '');
  if (!full || !dbi.verifyPassword(oldPassword, full.pass))
    return res.status(400).json({ error: '当前密码错误' });
  const pwErr = checkPassword(newPassword);
  if (pwErr) return res.status(400).json({ error: pwErr });
  dbi.setPasswordByUid(user.uid, newPassword);
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  const user = dbi.userBySession(bearer(req));
  if (!user) return res.status(401).json({ error: '未登录' });
  const info = dbi.meInfo(user.uid);
  res.json({ ...info, name: user.name, username: user.username });
});

// ---------- 站点设置（页脚） ----------
app.get('/api/settings', (_req, res) => {
  res.json(dbi.allSettings());
});

app.put('/api/admin/settings', requireAdmin, (req, res) => {
  const github = String(req.body?.github ?? '').trim().slice(0, 300);
  const text = String(req.body?.text ?? '').trim().slice(0, 200);
  dbi.setSetting('footer_github', /^https?:\/\/.+/i.test(github) ? github : '');
  dbi.setSetting('footer_text', text);
  res.json({ ok: true, settings: dbi.allSettings() });
});

app.put('/api/admin/users/:uid/password', requireAdmin, (req, res) => {
  const password = String(req.body?.password ?? '');
  const pwErr = checkPassword(password);
  if (pwErr) return res.status(400).json({ error: pwErr });
  if (!dbi.setPasswordByUid(String(req.params.uid), password))
    return res.status(404).json({ error: '用户不存在' });
  res.json({ ok: true });
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
