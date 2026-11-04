import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, randomBytes, scrypt as _scrypt, scryptSync, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { ScryptOptions } from 'node:crypto';
import type {
  CardDef,
  Category,
  HistoryDetail,
  HistoryListItem,
  PayerSplit,
  StatsItem,
  TrendPoint,
} from './types.js';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), '.data');
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(path.join(DATA_DIR, 'mahjong.db'));
db.pragma('journal_mode = WAL');
// WAL 下 NORMAL 安全：断电最多丢最近一次提交，不会损坏库；每次 commit 不再强制 fsync
db.pragma('synchronous = NORMAL');
db.pragma('busy_timeout = 5000');

db.exec(`
CREATE TABLE IF NOT EXISTS games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'live',
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  features TEXT
);
CREATE TABLE IF NOT EXISTS game_players (
  game_id INTEGER NOT NULL REFERENCES games(id),
  name TEXT NOT NULL,
  seat TEXT,
  final_score INTEGER NOT NULL DEFAULT 0,
  is_host INTEGER NOT NULL DEFAULT 0,
  uid TEXT
);
CREATE INDEX IF NOT EXISTS idx_gp_game ON game_players(game_id);
CREATE TABLE IF NOT EXISTS score_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL,
  round_no INTEGER NOT NULL,
  payers TEXT NOT NULL,
  to_name TEXT NOT NULL,
  amount_total INTEGER NOT NULL,
  note TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_se_game ON score_entries(game_id);
CREATE TABLE IF NOT EXISTS condition_draws (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL,
  round_no INTEGER NOT NULL,
  player_name TEXT NOT NULL,
  card_text TEXT NOT NULL,
  category TEXT,
  drawn_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cd_game ON condition_draws(game_id);
CREATE TABLE IF NOT EXISTS live_rooms (
  code TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS library_cards (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  category TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  uid TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  uid TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

// 旧库迁移：games.features / game_players.uid / users 登录列
try {
  db.exec("ALTER TABLE games ADD COLUMN features TEXT");
} catch {
  /* 列已存在 */
}
try {
  db.exec("ALTER TABLE game_players ADD COLUMN uid TEXT");
} catch {
  /* 列已存在 */
}
try {
  db.exec("ALTER TABLE users ADD COLUMN username TEXT");
} catch {
  /* 列已存在 */
}
try {
  db.exec("ALTER TABLE users ADD COLUMN pass TEXT");
} catch {
  /* 列已存在 */
}
try {
  db.exec("ALTER TABLE score_entries ADD COLUMN undone INTEGER NOT NULL DEFAULT 0");
} catch {
  /* 列已存在 */
}
try {
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username) WHERE username IS NOT NULL");
} catch {
  /* 索引已存在 */
}

// 高频查询索引：登录会话清理、战绩列表排序、管理大盘近 7 日、按账号聚合统计
db.exec(`
CREATE INDEX IF NOT EXISTS idx_sessions_uid ON sessions(uid);
CREATE INDEX IF NOT EXISTS idx_games_started ON games(started_at);
CREATE INDEX IF NOT EXISTS idx_games_status ON games(status);
CREATE INDEX IF NOT EXISTS idx_users_last_seen ON users(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_gp_uid ON game_players(uid);
`);

// ---------- 高频 prepared statements（better-sqlite3 不缓存语句，热路径复用避免重复编译） ----------
const stmtUserBySession = db.prepare(
  'SELECT u.uid, u.name, u.username FROM sessions s JOIN users u ON u.uid = s.uid WHERE s.token = ? AND s.expires_at > ?',
);
const stmtSessionDeleteExpired = db.prepare('DELETE FROM sessions WHERE token = ? AND expires_at < ?');
const stmtSaveLiveRoom = db.prepare(
  `INSERT INTO live_rooms (code, state, updated_at) VALUES (?, ?, ?)
   ON CONFLICT(code) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`,
);
const stmtDeleteLiveRoom = db.prepare('DELETE FROM live_rooms WHERE code = ?');
const stmtListEnabledCards = db.prepare(
  'SELECT id, text, category FROM library_cards WHERE enabled = 1 ORDER BY created_at DESC',
);
const stmtAddScoreEntry = db.prepare(
  'INSERT INTO score_entries (game_id, round_no, payers, to_name, amount_total, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
);
const stmtAddConditionDraw = db.prepare(
  'INSERT INTO condition_draws (game_id, round_no, player_name, card_text, category, drawn_at) VALUES (?, ?, ?, ?, ?, ?)',
);

// ---------- 账号认证 ----------
// scrypt 参数显式声明并随哈希一起存储（格式 scrypt$N$r$p$salt$hash），后续升级参数可平滑迁移。
// N=2^15, r=8, p=1：每次约 32MiB 内存、几十毫秒，交互式登录场景的稳妥取值（默认仅 N=2^14）。
// 注意 Node 默认 maxmem 仅 32MB，会拒绝 N=2^15 的参数，必须显式放宽。
const SCRYPT_N = 1 << 15;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_MAXMEM = 128 * 1024 * 1024;
const scrypt = promisify(_scrypt) as (
  pw: string,
  salt: string,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

/** 异步哈希密码（不阻塞事件循环）；salt 16 字节 */
export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const hash = (
    await scrypt(pw, salt, 32, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: SCRYPT_MAXMEM })
  ).toString('hex');
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt}$${hash}`;
}

/** 校验密码；兼容旧格式 salt:hash（scryptSync 默认参数的历史数据） */
export async function verifyPassword(pw: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  if (!stored.startsWith('scrypt$')) {
    const [salt, h] = stored.split(':');
    if (!salt || !h) return false;
    const calc = scryptSync(pw, salt, 32).toString('hex');
    return calc.length === h.length && timingSafeEqual(Buffer.from(calc), Buffer.from(h));
  }
  const [, n, r, p, salt, h] = stored.split('$');
  if (!n || !r || !p || !salt || !h) return false;
  const calc = (
    await scrypt(pw, salt, 32, { N: Number(n), r: Number(r), p: Number(p), maxmem: SCRYPT_MAXMEM })
  ).toString('hex');
  return calc.length === h.length && timingSafeEqual(Buffer.from(calc), Buffer.from(h));
}

/** 是否为旧格式哈希（登录成功后应无感升级为新格式） */
export function needsRehash(stored: string | null): boolean {
  return !!stored && !stored.startsWith('scrypt$');
}

export interface UserRow {
  uid: string;
  name: string;
  username: string | null;
}

/** username = 登录名（唯一、不可改）；name = 昵称（可自行修改） */
export async function createUserWithPass(loginName: string, name: string, password: string): Promise<UserRow | null> {
  try {
    const uid = randomUUID();
    db.prepare(
      'INSERT INTO users (uid, name, username, pass, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(uid, name, loginName, await hashPassword(password), Date.now(), Date.now());
    return { uid, name, username: loginName };
  } catch {
    return null; // 登录名冲突
  }
}

/** 更新显示昵称（自助 & 管理共用） */
export function updateNameByUid(uid: string, name: string): boolean {
  const info = db.prepare('UPDATE users SET name = ? WHERE uid = ?').run(name, uid);
  return info.changes > 0;
}

export function findUserByUsername(username: string): (UserRow & { pass: string | null }) | undefined {
  return db.prepare('SELECT uid, name, username, pass FROM users WHERE username = ?').get(username) as
    | (UserRow & { pass: string | null })
    | undefined;
}

export function getUserByUid(uid: string): UserRow | undefined {
  return db.prepare('SELECT uid, name, username FROM users WHERE uid = ?').get(uid) as UserRow | undefined;
}

export async function setPasswordByUid(uid: string, password: string): Promise<boolean> {
  const info = db.prepare('UPDATE users SET pass = ? WHERE uid = ?').run(await hashPassword(password), uid);
  return info.changes > 0;
}

export function createSession(uid: string, days = 30): string {
  // 单点登录：同一账号同一时间仅保留最新一处会话
  db.prepare('DELETE FROM sessions WHERE uid = ?').run(uid);
  const token = randomUUID() + randomUUID().replace(/-/g, '');
  db.prepare('INSERT INTO sessions (token, uid, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    token,
    uid,
    Date.now(),
    Date.now() + days * 86400e3,
  );
  return token;
}

export function deleteSession(token: string): void {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function userBySession(token: string): UserRow | undefined {
  if (!token) return undefined;
  // 单查询联表返回用户；未命中且会话已过期时顺手清掉该行
  const u = stmtUserBySession.get(token, Date.now()) as UserRow | undefined;
  if (u) return u;
  stmtSessionDeleteExpired.run(token, Date.now());
  return undefined;
}

/** 清理已过期的会话记录（定时调用，防止表无限增长） */
export function purgeExpiredSessions(): number {
  const info = db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  return info.changes;
}

// ---------- 站点设置（页脚等） ----------
export function setSetting(key: string, value: string): void {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, value);
}

export function getSetting(key: string): string {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? '';
}

export function allSettings(): { github: string; text: string } {
  return { github: getSetting('footer_github'), text: getSetting('footer_text') };
}

// ---------- 用户档案 ----------
export function upsertUser(uid: string, name: string): void {
  db.prepare(
    `INSERT INTO users (uid, name, created_at, last_seen_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(uid) DO UPDATE SET name = excluded.name, last_seen_at = excluded.last_seen_at`,
  ).run(uid, name, Date.now(), Date.now());
}

export interface MeInfo {
  uid: string;
  name: string;
  games: number;
  total: number;
  wins: number;
}

/** 胜场判定公共片段：每局最高分（并列都算胜）；避免逐行相关子查询 */
const WIN_JOIN = `JOIN (SELECT game_id, MAX(final_score) AS max_score FROM game_players GROUP BY game_id) w ON w.game_id = gp.game_id`;
const WIN_SUM = `COALESCE(SUM(CASE WHEN gp.final_score = w.max_score THEN 1 ELSE 0 END), 0) AS wins`;

export function meInfo(uid: string): MeInfo {
  const u = db.prepare('SELECT uid, name FROM users WHERE uid = ?').get(uid) as
    | { uid: string; name: string }
    | undefined;
  if (!u) return { uid, name: '', games: 0, total: 0, wins: 0 };
  const agg = db
    .prepare(
      `SELECT COUNT(*) AS games, COALESCE(SUM(gp.final_score), 0) AS total, ${WIN_SUM}
       FROM game_players gp
       JOIN games g ON g.id = gp.game_id AND g.status = 'finished'
       ${WIN_JOIN}
       WHERE gp.uid = ?`,
    )
    .get(uid) as { games: number; total: number; wins: number };
  return { uid, name: u.name, games: agg.games, total: agg.total, wins: agg.wins };
}

// ---------- 战局 ----------
export function createGame(code: string, features?: { score: boolean; cards: boolean }): number {
  const stmt = db.prepare('INSERT INTO games (code, status, started_at, features) VALUES (?, ?, ?, ?)');
  const info = stmt.run(code, 'live', Date.now(), features ? JSON.stringify(features) : null);
  return Number(info.lastInsertRowid);
}

export function addScoreEntry(
  gameId: number,
  roundNo: number,
  payers: PayerSplit[],
  toName: string,
  amountTotal: number,
  note?: string,
): number {
  const info = stmtAddScoreEntry.run(
    gameId,
    roundNo,
    JSON.stringify(payers),
    toName,
    amountTotal,
    note ?? null,
    Date.now(),
  );
  return Number(info.lastInsertRowid);
}

/** 撤销留痕：不删行，只打标 */
export function markScoreEntryUndone(id: number): void {
  db.prepare('UPDATE score_entries SET undone = 1 WHERE id = ?').run(id);
}

export function addConditionDraw(
  gameId: number,
  roundNo: number,
  playerName: string,
  cardText: string,
  category: string,
): void {
  stmtAddConditionDraw.run(gameId, roundNo, playerName, cardText, category, Date.now());
}

/** 整局发牌批量入账（单事务，一次刷盘） */
export function addConditionDraws(
  rows: { gameId: number; roundNo: number; playerName: string; cardText: string; category: string }[],
): void {
  const tx = db.transaction(() => {
    for (const r of rows) addConditionDraw(r.gameId, r.roundNo, r.playerName, r.cardText, r.category);
  });
  tx();
}

export function finalizeGame(
  gameId: number,
  status: 'finished' | 'abandoned',
  players: { name: string; seat: string; score: number; isHost: boolean; uid?: string | null }[],
): void {
  const tx = db.transaction(() => {
    db.prepare("UPDATE games SET status = ?, ended_at = ? WHERE id = ?").run(
      status,
      Date.now(),
      gameId,
    );
    db.prepare('DELETE FROM game_players WHERE game_id = ?').run(gameId);
    const ins = db.prepare(
      'INSERT INTO game_players (game_id, name, seat, final_score, is_host, uid) VALUES (?, ?, ?, ?, ?, ?)',
    );
    for (const p of players) ins.run(gameId, p.name, p.seat, p.score, p.isHost ? 1 : 0, p.uid ?? null);
  });
  tx();
}

// ---------- 进行中房间快照 ----------
export function saveLiveRoom(code: string, state: unknown): void {
  stmtSaveLiveRoom.run(code, JSON.stringify(state), Date.now());
}

export function deleteLiveRoom(code: string): void {
  stmtDeleteLiveRoom.run(code);
}

export function loadLiveRooms(): { code: string; state: string; updatedAt: number }[] {
  return db
    .prepare('SELECT code, state, updated_at FROM live_rooms')
    .all() as { code: string; state: string; updatedAt: number }[];
}

// ---------- 自定义题库 ----------
export function listCustomCards(): CardDef[] {
  const rows = stmtListEnabledCards.all() as { id: string; text: string; category: Category }[];
  return rows.map((r) => ({ id: r.id, text: r.text, category: r.category }));
}

export function listAllCustomCards(): (CardDef & { enabled: boolean })[] {
  const rows = db
    .prepare('SELECT id, text, category, enabled FROM library_cards ORDER BY created_at DESC')
    .all() as { id: string; text: string; category: Category; enabled: number }[];
  return rows.map((r) => ({ id: r.id, text: r.text, category: r.category, enabled: !!r.enabled }));
}

export function addCustomCard(text: string, category: Category): CardDef {
  const id = `c_${randomUUID().slice(0, 8)}`;
  db.prepare(
    'INSERT INTO library_cards (id, text, category, enabled, created_at) VALUES (?, ?, ?, 1, ?)',
  ).run(id, text, category, Date.now());
  return { id, text, category };
}

export function updateCustomCard(id: string, text: string, category: Category, enabled: boolean): void {
  db.prepare('UPDATE library_cards SET text = ?, category = ?, enabled = ? WHERE id = ?').run(
    text,
    category,
    enabled ? 1 : 0,
    id,
  );
}

export function deleteCustomCard(id: string): void {
  db.prepare('DELETE FROM library_cards WHERE id = ?').run(id);
}

// ---------- 历史战绩 ----------
export function historyList(limit = 50): HistoryListItem[] {
  const games = db
    .prepare("SELECT id, code, status, started_at, ended_at FROM games WHERE status != 'live' ORDER BY started_at DESC LIMIT ?")
    .all(limit) as { id: number; code: string; status: string; started_at: number; ended_at: number | null }[];
  if (games.length === 0) return [];
  // 一次性取回全部玩家，避免每场游戏一条查询的 N+1
  const ids = games.map((g) => g.id);
  const placeholders = ids.map(() => '?').join(',');
  const rows = db
    .prepare(`SELECT game_id, name, seat, final_score, uid FROM game_players WHERE game_id IN (${placeholders}) ORDER BY rowid`)
    .all(...ids) as { game_id: number; name: string; seat: string; final_score: number; uid: string | null }[];
  const byGame = new Map<number, { name: string; seat: string; finalScore: number; uid: string | null }[]>();
  for (const p of rows) {
    let list = byGame.get(p.game_id);
    if (!list) byGame.set(p.game_id, (list = []));
    list.push({ name: p.name, seat: p.seat, finalScore: p.final_score, uid: p.uid });
  }
  return games.map((g) => ({
    id: g.id,
    code: g.code,
    status: g.status,
    startedAt: g.started_at,
    endedAt: g.ended_at,
    players: byGame.get(g.id) ?? [],
  }));
}

export function historyDetail(id: number): HistoryDetail | null {
  const g = db
    .prepare('SELECT id, code, status, started_at, ended_at, features FROM games WHERE id = ?')
    .get(id) as { id: number; code: string; status: string; started_at: number; ended_at: number | null; features: string | null } | undefined;
  if (!g) return null;
  const features = g.features ? (JSON.parse(g.features) as { score: boolean; cards: boolean }) : undefined;
  const players = (
    db.prepare('SELECT name, seat, final_score, is_host, uid FROM game_players WHERE game_id = ?').all(id) as {
      name: string;
      seat: string;
      final_score: number;
      is_host: number;
      uid: string | null;
    }[]
  ).map((p) => ({ name: p.name, seat: p.seat, finalScore: p.final_score, isHost: !!p.is_host, uid: p.uid }));
  const entries = (
    db.prepare('SELECT id, round_no, payers, to_name, amount_total, note, created_at, undone FROM score_entries WHERE game_id = ? ORDER BY id').all(id) as {
      id: number;
      round_no: number;
      payers: string;
      to_name: string;
      amount_total: number;
      note: string | null;
      created_at: number;
      undone: number;
    }[]
  ).map((e) => ({
    id: e.id,
    roundNo: e.round_no,
    payers: JSON.parse(e.payers) as PayerSplit[],
    toName: e.to_name,
    amountTotal: e.amount_total,
    note: e.note,
    createdAt: e.created_at,
    undone: !!e.undone,
  }));
  const draws = (
    db.prepare('SELECT round_no, player_name, card_text, category FROM condition_draws WHERE game_id = ? ORDER BY id').all(id) as {
      round_no: number;
      player_name: string;
      card_text: string;
      category: string;
    }[]
  ).map((d) => ({ roundNo: d.round_no, playerName: d.player_name, cardText: d.card_text, category: d.category }));
  return {
    id: g.id,
    code: g.code,
    status: g.status,
    startedAt: g.started_at,
    endedAt: g.ended_at,
    features,
    players,
    entries,
    draws,
  };
}

export function stats(): StatsItem[] {
  const rows = db
    .prepare(
      `SELECT COALESCE(NULLIF(gp.uid, ''), gp.name) AS key,
              MAX(gp.name) AS name,
              COUNT(*) AS games, SUM(gp.final_score) AS total,
              ${WIN_SUM}
       FROM game_players gp
       JOIN games g ON g.id = gp.game_id AND g.status = 'finished'
       ${WIN_JOIN}
       GROUP BY key
       ORDER BY total DESC`,
    )
    .all() as { name: string; games: number; total: number; wins: number }[];
  return rows.map((r) => ({ name: r.name, games: r.games, total: r.total, wins: r.wins }));
}

/** 个人盈亏趋势：按账号 uid 聚合（uid 为空的旧数据按昵称匹配），时间升序 */
export function playerTrend(uid: string | null, name: string, limit = 60): TrendPoint[] {
  const where = uid ? 'gp.uid = ?' : "(IFNULL(gp.uid, '') = '' AND gp.name = ?)";
  const key = uid ?? name;
  const rows = db
    .prepare(
      `SELECT g.id AS gameId, g.started_at AS startedAt, gp.final_score AS score
       FROM game_players gp
       JOIN games g ON g.id = gp.game_id AND g.status = 'finished'
       WHERE ${where}
       ORDER BY g.started_at DESC
       LIMIT ?`,
    )
    .all(key, limit) as { gameId: number; startedAt: number; score: number }[];
  return rows.reverse();
}

// ---------- 管理后台 ----------
export interface AdminOverview {
  users: number;
  gamesFinished: number;
  gamesLive: number;
  liveRooms: number;
  entries: number;
  draws: number;
  daily: { date: string; count: number }[];
  top: StatsItem[];
  recentUsers: { uid: string; name: string; lastSeenAt: number }[];
}

export function adminOverview(): AdminOverview {
  const count = (sql: string): number =>
    (db.prepare(sql).get() as { c: number }).c;
  const users = count('SELECT COUNT(*) AS c FROM users');
  const gamesFinished = count("SELECT COUNT(*) AS c FROM games WHERE status = 'finished'");
  const gamesLive = count("SELECT COUNT(*) AS c FROM games WHERE status = 'live'");
  const liveRooms = count('SELECT COUNT(*) AS c FROM live_rooms');
  const entries = count('SELECT COUNT(*) AS c FROM score_entries');
  const draws = count('SELECT COUNT(*) AS c FROM condition_draws');

  // 近 7 日完整战局（按 UTC+8 自然日聚合）
  const since = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const rows = db
    .prepare("SELECT started_at FROM games WHERE status = 'finished' AND started_at >= ?")
    .all(since) as { started_at: number }[];
  const dayKey = (ts: number) => new Date(ts + 8 * 3600 * 1000).toISOString().slice(0, 10);
  const buckets = new Map<string, number>();
  for (let i = 6; i >= 0; i--) {
    const d = dayKey(Date.now() - i * 24 * 60 * 60 * 1000);
    buckets.set(d, 0);
  }
  for (const r of rows) {
    const k = dayKey(r.started_at);
    if (buckets.has(k)) buckets.set(k, (buckets.get(k) ?? 0) + 1);
  }
  const daily = [...buckets.entries()].map(([date, c]) => ({ date, count: c }));

  const recentUsers = (
    db.prepare('SELECT uid, name, last_seen_at FROM users ORDER BY last_seen_at DESC LIMIT 6').all() as {
      uid: string;
      name: string;
      last_seen_at: number;
    }[]
  ).map((u) => ({ uid: u.uid, name: u.name, lastSeenAt: u.last_seen_at }));

  return {
    users,
    gamesFinished,
    gamesLive,
    liveRooms,
    entries,
    draws,
    daily,
    top: stats().slice(0, 8),
    recentUsers,
  };
}

export interface AdminUserRow {
  uid: string;
  name: string;
  username: string | null;
  createdAt: number;
  lastSeenAt: number;
  games: number;
  total: number;
  wins: number;
}

export function adminUsers(query: string): AdminUserRow[] {
  const like = `%${query}%`;
  const rows = db
    .prepare(
      `SELECT u.uid, u.name, u.username, u.created_at, u.last_seen_at,
              COALESCE(s.games, 0) AS games, COALESCE(s.total, 0) AS total, COALESCE(s.wins, 0) AS wins
       FROM users u
       LEFT JOIN (
         SELECT gp.uid AS uid,
                COUNT(*) AS games,
                SUM(gp.final_score) AS total,
                SUM(CASE WHEN gp.final_score = w.max_score THEN 1 ELSE 0 END) AS wins
         FROM game_players gp
         JOIN games g ON g.id = gp.game_id AND g.status = 'finished'
         JOIN (SELECT game_id, MAX(final_score) AS max_score FROM game_players GROUP BY game_id) w ON w.game_id = gp.game_id
         WHERE gp.uid IS NOT NULL AND gp.uid != ''
         GROUP BY gp.uid
       ) s ON s.uid = u.uid
       WHERE u.name LIKE ? OR u.uid LIKE ? OR IFNULL(u.username, '') LIKE ?
       ORDER BY u.last_seen_at DESC
       LIMIT 200`,
    )
    .all(like, like, like) as {
    uid: string;
    name: string;
    username: string | null;
    created_at: number;
    last_seen_at: number;
    games: number;
    total: number;
    wins: number;
  }[];
  return rows.map((r) => ({
    uid: r.uid,
    name: r.name,
    username: r.username,
    createdAt: r.created_at,
    lastSeenAt: r.last_seen_at,
    games: r.games,
    total: r.total,
    wins: r.wins,
  }));
}

export function adminRenameUser(uid: string, name: string): boolean {
  return updateNameByUid(uid, name);
}

export function adminDeleteUser(uid: string): boolean {
  const tx = db.transaction(() => {
    const info = db.prepare('DELETE FROM users WHERE uid = ?').run(uid);
    // 历史战绩保留，仅切断身份关联
    db.prepare("UPDATE game_players SET uid = '' WHERE uid = ?").run(uid);
    return info.changes > 0;
  });
  return tx();
}
