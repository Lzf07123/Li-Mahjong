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

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`请求失败(${res.status})`);
  return res.json() as Promise<T>;
}

export const api = {
  library: () => getJson<import('./types').LibraryData>('/api/library'),
  history: () => getJson<{ items: import('./types').HistoryItem[] }>('/api/history'),
  historyDetail: (id: number) => getJson<import('./types').HistoryDetailData>(`/api/history/${id}`),
  stats: () => getJson<{ items: import('./types').StatsItem[] }>('/api/stats'),
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
