import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  CardDef,
  Category,
  HistoryDetail,
  HistoryListItem,
  PayerSplit,
  StatsItem,
} from './types.js';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), '.data');
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(path.join(DATA_DIR, 'mahjong.db'));
db.pragma('journal_mode = WAL');
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
`);

// 旧库迁移：games.features / game_players.uid
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

export function meInfo(uid: string): MeInfo {
  const u = db.prepare('SELECT uid, name FROM users WHERE uid = ?').get(uid) as
    | { uid: string; name: string }
    | undefined;
  if (!u) return { uid, name: '', games: 0, total: 0, wins: 0 };
  const agg = db
    .prepare(
      `SELECT COUNT(*) AS games, COALESCE(SUM(final_score), 0) AS total,
              COALESCE(SUM(CASE WHEN final_score = (
                    SELECT MAX(final_score) FROM game_players WHERE game_id = gp.game_id
                  ) THEN 1 ELSE 0 END), 0) AS wins
       FROM game_players gp JOIN games g ON g.id = gp.game_id AND g.status = 'finished'
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
  const stmt = db.prepare(
    'INSERT INTO score_entries (game_id, round_no, payers, to_name, amount_total, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  const info = stmt.run(
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

export function deleteScoreEntry(id: number): void {
  db.prepare('DELETE FROM score_entries WHERE id = ?').run(id);
}

export function addConditionDraw(
  gameId: number,
  roundNo: number,
  playerName: string,
  cardText: string,
  category: string,
): void {
  db.prepare(
    'INSERT INTO condition_draws (game_id, round_no, player_name, card_text, category, drawn_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(gameId, roundNo, playerName, cardText, category, Date.now());
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
  db.prepare(
    `INSERT INTO live_rooms (code, state, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(code) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`,
  ).run(code, JSON.stringify(state), Date.now());
}

export function deleteLiveRoom(code: string): void {
  db.prepare('DELETE FROM live_rooms WHERE code = ?').run(code);
}

export function loadLiveRooms(): { code: string; state: string; updatedAt: number }[] {
  return db
    .prepare('SELECT code, state, updated_at FROM live_rooms')
    .all() as { code: string; state: string; updatedAt: number }[];
}

// ---------- 自定义题库 ----------
export function listCustomCards(): CardDef[] {
  const rows = db
    .prepare('SELECT id, text, category FROM library_cards WHERE enabled = 1 ORDER BY created_at DESC')
    .all() as { id: string; text: string; category: Category }[];
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
  const gp = db.prepare('SELECT name, seat, final_score, uid FROM game_players WHERE game_id = ?');
  return games.map((g) => ({
    id: g.id,
    code: g.code,
    status: g.status,
    startedAt: g.started_at,
    endedAt: g.ended_at,
    players: (gp.all(g.id) as { name: string; seat: string; final_score: number; uid: string | null }[]).map((p) => ({
      name: p.name,
      seat: p.seat,
      finalScore: p.final_score,
      uid: p.uid,
    })),
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
    db.prepare('SELECT id, round_no, payers, to_name, amount_total, note, created_at FROM score_entries WHERE game_id = ? ORDER BY id').all(id) as {
      id: number;
      round_no: number;
      payers: string;
      to_name: string;
      amount_total: number;
      note: string | null;
      created_at: number;
    }[]
  ).map((e) => ({
    id: e.id,
    roundNo: e.round_no,
    payers: JSON.parse(e.payers) as PayerSplit[],
    toName: e.to_name,
    amountTotal: e.amount_total,
    note: e.note,
    createdAt: e.created_at,
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
              SUM(CASE WHEN gp.final_score = (
                    SELECT MAX(final_score) FROM game_players WHERE game_id = gp.game_id
                  ) THEN 1 ELSE 0 END) AS wins
       FROM game_players gp
       JOIN games g ON g.id = gp.game_id AND g.status = 'finished'
       GROUP BY key
       ORDER BY total DESC`,
    )
    .all() as { name: string; games: number; total: number; wins: number }[];
  return rows.map((r) => ({ name: r.name, games: r.games, total: r.total, wins: r.wins }));
}
