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

/** 房间相关 emit 自动携带登录 token */
export function emitRoomAck<T = Record<string, unknown>>(event: string, payload?: Record<string, unknown>): Promise<T & AckResp> {
  return emitAck<T>(event, { token: getAuthToken(), ...payload });
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

// ---------- 登录态 ----------
export interface AuthUser {
  uid: string;
  name: string;
}

export interface MeInfo extends AuthUser {
  username: string | null;
  games: number;
  total: number;
  wins: number;
}

// getUid 已由账号体系取代，保留清理入口
export function purgeLegacyUid(): void {
  localStorage.removeItem('mj:uid');
}

export function saveAuth(token: string, user: AuthUser): void {
  localStorage.setItem('mj:auth', JSON.stringify({ token, user }));
}

export function loadAuth(): { token: string; user: AuthUser } | null {
  try {
    const raw = localStorage.getItem('mj:auth');
    if (!raw) return null;
    const a = JSON.parse(raw) as { token: string; user: AuthUser };
    return a.token && a.user?.uid ? a : null;
  } catch {
    return null;
  }
}

export function clearAuth(): void {
  localStorage.removeItem('mj:auth');
}

export function getAuthToken(): string {
  return loadAuth()?.token ?? '';
}

async function authedJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { authorization: `Bearer ${getAuthToken()}` } });
  if (res.status === 401) {
    const err = new Error('请先登录后再查看战绩') as Error & { status?: number };
    err.status = 401;
    throw err;
  }
  if (!res.ok) throw new Error(`请求失败(${res.status})`);
  return res.json() as Promise<T>;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) throw new Error(data?.error || `请求失败(${res.status})`);
  return data;
}

async function authedPost<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${getAuthToken()}` },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) throw new Error(data?.error || `请求失败(${res.status})`);
  return data;
}

export interface Captcha {
  id: string;
  svg: string;
}

export const api = {
  library: () => getJson<import('./types').LibraryData>('/api/library'),
  // 战绩/统计需要登录：未登录时抛出带 status=401 的错误
  history: () => authedJson<{ items: import('./types').HistoryItem[] }>('/api/history'),
  historyDetail: (id: number) => authedJson<import('./types').HistoryDetailData>(`/api/history/${id}`),
  historyCsv: async (id: number): Promise<Blob> => {
    const res = await fetch(`/api/history/${id}/csv`, { headers: { authorization: `Bearer ${getAuthToken()}` } });
    if (!res.ok) throw new Error(`导出失败(${res.status})`);
    return res.blob();
  },
  stats: () => authedJson<{ items: import('./types').StatsItem[] }>('/api/stats'),
  trend: (opts: { uid?: string | null; name?: string }) => {
    const q = new URLSearchParams();
    if (opts.uid) q.set('uid', opts.uid);
    else if (opts.name) q.set('name', opts.name);
    return authedJson<{ items: import('./types').TrendPoint[] }>(`/api/stats/trend?${q.toString()}`);
  },
  settings: () => getJson<{ github: string; text: string }>('/api/settings'),
  captcha: () => getJson<Captcha>('/api/captcha'),
  me: () => authedJson<MeInfo>('/api/me'),
  register: (loginName: string, name: string, password: string, captchaId: string, captchaText: string) =>
    postJson<{ token: string; user: AuthUser }>('/api/auth/register', {
      loginName,
      name,
      password,
      captchaId,
      captchaText,
    }),
  login: (loginName: string, password: string, captchaId: string, captchaText: string) =>
    postJson<{ token: string; user: AuthUser }>('/api/auth/login', {
      loginName,
      password,
      captchaId,
      captchaText,
    }),
  logout: () => postJson<{ ok: boolean }>('/api/auth/logout', {}),
  changeName: (name: string) =>
    authedPost<{ ok: boolean; user: AuthUser }>('/api/auth/change-name', { name }),
  changePassword: (oldPassword: string, newPassword: string) =>
    authedPost<{ ok: boolean }>('/api/auth/change-password', { oldPassword, newPassword }),
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
  username: string | null;
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
    headers: {
      'x-admin-token': getAdminToken(),
      // JSON body 必须显式声明类型，否则浏览器默认 text/plain，express.json() 不解析会导致存入空值
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
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
  resetPassword: (uid: string, password: string) =>
    adminFetch<{ ok: boolean }>(`/api/admin/users/${encodeURIComponent(uid)}/password`, {
      method: 'PUT',
      body: JSON.stringify({ password }),
    }),
  setFooter: (github: string, text: string) =>
    adminFetch<{ ok: boolean; settings: { github: string; text: string } }>('/api/admin/settings', {
      method: 'PUT',
      body: JSON.stringify({ github, text }),
    }),
};

// ---------- 本地会话 ----------
interface SavedSession {
  playerId: string;
  token: string;
  name: string;
  savedAt?: number;
}

export function saveSession(code: string, s: SavedSession): void {
  localStorage.setItem(`mj:${code}`, JSON.stringify({ ...s, savedAt: Date.now() }));
}

/** 最近一场未清理的本地房间会话（首页「回到战局」用） */
export function latestSavedRoom(): string | null {
  let best: { code: string; at: number } | null = null;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      const m = key ? /^mj:([A-Z2-9]{4})$/.exec(key) : null;
      if (!m) continue;
      const s = loadSession(m[1]);
      if (!s) continue;
      const at = s.savedAt ?? 0;
      if (!best || at > best.at) best = { code: m[1], at };
    }
  } catch {
    /* localStorage 不可用时忽略 */
  }
  return best?.code ?? null;
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

// ---------- 离开标记：主动离开/被踢后，刷新房间链接不再自动加入 ----------
export function markRoomLeft(code: string): void {
  try {
    localStorage.setItem(`mj:left:${code}`, String(Date.now()));
  } catch {
    /* ignore */
  }
}

export function wasRoomLeft(code: string): boolean {
  try {
    return !!localStorage.getItem(`mj:left:${code}`);
  } catch {
    return false;
  }
}

export function clearLeftMark(code: string): void {
  try {
    localStorage.removeItem(`mj:left:${code}`);
  } catch {
    /* ignore */
  }
}

export function lastName(): string {
  return localStorage.getItem('mj:name') ?? '';
}

export function saveName(name: string): void {
  localStorage.setItem('mj:name', name);
}
