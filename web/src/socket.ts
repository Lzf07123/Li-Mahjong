import { io, Socket } from 'socket.io-client';
import type { AckResp } from './types';

export const socket: Socket = io({
  autoConnect: true,
  transports: ['websocket', 'polling'],
});

/** 带确认的 emit，失败时抛出服务端错误信息 */
export function emitAck<T = Record<string, unknown>>(event: string, payload?: unknown): Promise<T & AckResp> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('网络超时，请重试')), 8000);
    socket.timeout(8000).emit(event, payload ?? {}, (err: Error | null, resp: AckResp) => {
      clearTimeout(timer);
      if (err) return reject(new Error('网络超时，请重试'));
      if (!resp || resp.ok !== true) return reject(new Error(resp?.error || '操作失败'));
      resolve(resp as T & AckResp);
    });
  });
}

/** 房间相关 emit 自动携带设备 uid */
export function emitRoomAck<T = Record<string, unknown>>(event: string, payload?: Record<string, unknown>): Promise<T & AckResp> {
  return emitAck<T>(event, { uid: getUid(), ...payload });
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`请求失败(${res.status})`);
  return res.json() as Promise<T>;
}

/** 设备级永久用户 id：跨战局识别同一玩家 */
export function getUid(): string {
  let uid = localStorage.getItem('mj:uid');
  if (!uid) {
    uid =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `u_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem('mj:uid', uid);
  }
  return uid;
}

export interface MeInfo {
  uid: string;
  name: string;
  games: number;
  total: number;
  wins: number;
}

export const api = {
  library: () => getJson<import('./types').LibraryData>('/api/library'),
  history: () => getJson<{ items: import('./types').HistoryItem[] }>('/api/history'),
  historyDetail: (id: number) => getJson<import('./types').HistoryDetailData>(`/api/history/${id}`),
  stats: () => getJson<{ items: import('./types').StatsItem[] }>('/api/stats'),
  me: (uid: string) => getJson<MeInfo>(`/api/me?uid=${encodeURIComponent(uid)}`),
};

// ---------- 管理后台 ----------
export interface AdminOverview {
  users: number;
  gamesFinished: number;
  gamesLive: number;
  liveRooms: number;
  entries: number;
  draws: number;
  daily: { date: string; count: number }[];
  top: import('./types').StatsItem[];
  recentUsers: { uid: string; name: string; lastSeenAt: number }[];
}

export interface AdminUserRow {
  uid: string;
  name: string;
  createdAt: number;
  lastSeenAt: number;
  games: number;
  total: number;
  wins: number;
}

export function getAdminToken(): string {
  return localStorage.getItem('mj:admin') ?? '';
}

export function setAdminToken(t: string): void {
  localStorage.setItem('mj:admin', t);
}

async function adminFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'x-admin-token': getAdminToken(), ...(init?.headers ?? {}) },
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) throw new Error(data?.error || `请求失败(${res.status})`);
  return data;
}

export const adminApi = {
  overview: () => adminFetch<AdminOverview>('/api/admin/overview'),
  users: (query: string) => adminFetch<{ items: AdminUserRow[] }>(`/api/admin/users?query=${encodeURIComponent(query)}`),
  renameUser: (uid: string, name: string) =>
    adminFetch<{ ok: boolean }>(`/api/admin/users/${encodeURIComponent(uid)}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),
  deleteUser: (uid: string) =>
    adminFetch<{ ok: boolean }>(`/api/admin/users/${encodeURIComponent(uid)}`, { method: 'DELETE' }),
};

// ---------- 本地会话 ----------
interface SavedSession {
  playerId: string;
  token: string;
  name: string;
}

export function saveSession(code: string, s: SavedSession): void {
  localStorage.setItem(`mj:${code}`, JSON.stringify(s));
}

export function loadSession(code: string): SavedSession | null {
  try {
    const raw = localStorage.getItem(`mj:${code}`);
    if (!raw) return null;
    const s = JSON.parse(raw) as SavedSession;
    return s.playerId && s.token ? s : null;
  } catch {
    return null;
  }
}

export function clearSession(code: string): void {
  localStorage.removeItem(`mj:${code}`);
}

export function lastName(): string {
  return localStorage.getItem('mj:name') ?? '';
}

export function saveName(name: string): void {
  localStorage.setItem('mj:name', name);
}
