import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { socket, clearAuth, loadSession, clearSession, markRoomLeft, emitAck } from './socket';
import type { Snapshot } from './types';
import Home from './views/Home';
import Room from './views/Room';
import { HistoryList, HistoryDetail } from './views/History';
import Admin from './views/Admin';

export type View =
  | { name: 'home' }
  | { name: 'room'; code: string }
  | { name: 'history' }
  | { name: 'historyDetail'; id: number }
  | { name: 'admin' };

export interface Toast {
  id: number;
  msg: string;
  type: 'info' | 'error' | 'success';
}

interface AppCtxValue {
  snap: Snapshot | null;
  setSnap: (s: Snapshot | null) => void;
  myId: string | null;
  setMyId: (id: string | null) => void;
  conn: 'connecting' | 'connected' | 'disconnected';
  toast: (msg: string, type?: Toast['type']) => void;
  go: (v: View) => void;
  back: () => void;
}

export const AppCtx = createContext<AppCtxValue>(null!);

export function useApp(): AppCtxValue {
  return useContext(AppCtx);
}

function viewFromLocation(): View {
  if (location.pathname === '/admin') return { name: 'admin' };
  const params = new URLSearchParams(location.search);
  const room = params.get('room');
  if (room && /^[A-Z2-9]{4}$/i.test(room)) return { name: 'room', code: room.toUpperCase() };
  return { name: 'home' };
}

export default function App() {
  const [view, setView] = useState<View>(viewFromLocation);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [myId, setMyId] = useState<string | null>(null);
  const [conn, setConn] = useState<AppCtxValue['conn']>('connecting');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastSeq = useRef(1);
  const viewRef = useRef(view);
  viewRef.current = view;

  const toast = useCallback((msg: string, type: Toast['type'] = 'info') => {
    const id = toastSeq.current++;
    setToasts((t) => [...t.slice(-3), { id, msg, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2600);
  }, []);

  const go = useCallback((v: View) => {
    setView(v);
    if (v.name === 'room') {
      history.pushState({ view: v }, '', `?room=${v.code}`);
    } else if (v.name === 'admin') {
      history.pushState({ view: v }, '', '/admin');
    } else {
      history.pushState({ view: v }, '', location.pathname);
    }
  }, []);

  const back = useCallback(() => {
    history.back();
  }, []);

  useEffect(() => {
    const onPop = () => setView(viewFromLocation());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    const onConnect = () => {
      setConn('connected');
      // 断线重连后服务端 socket 状态已丢失：若在房间视图，用本地会话重新入房恢复推送
      const v = viewRef.current;
      if (v.name === 'room') {
        const saved = loadSession(v.code);
        if (saved) {
          emitAck('room:rejoin', { code: v.code, token: saved.token })
            .then((r) => setMyId(r.playerId as string))
            .catch(() => {
              // 恢复失败（房间已结束/会话失效）：清掉本地会话与身份，让房间页回门禁重新加入，
              // 否则会永远停留在不再更新的冻结快照上（顶栏还显示“已同步”）
              clearSession(v.code);
              setMyId(null);
              toast('房间会话已失效，请重新加入', 'error');
            });
        }
      }
    };
    const onDisconnect = () => setConn('disconnected');
    const onState = (s: Snapshot) => {
      setSnap((prev) => (prev && prev.code === s.code && prev.rev >= s.rev ? prev : s));
      const iAmIn =
        s.players.some((p) => p.id === myId) || s.spectators?.some((x) => x.id === myId) || !myId;
      if (iAmIn) setConn('connected');
    };
    const onGameEnded = (payload: { standings: { name: string; score: number }[] }) => {
      const winner = [...payload.standings].sort((a, b) => b.score - a.score)[0];
      setSnap(null);
      setMyId(null);
      if (viewRef.current.name === 'room') setView({ name: 'home' });
      toast(`🏁 战局结束！赢家：${winner?.name ?? '？'}`, 'success');
    };
    const onRoomClosed = (payload: { reason: string }) => {
      setSnap(null);
      setMyId(null);
      const v = viewRef.current;
      if (v.name === 'room') {
        clearSession(v.code); // 房间会话已失效，避免下次误 rejoin
        // 主动离开/被踢：打标记，刷新房间链接时不再自动加入
        if (payload.reason === 'left' || payload.reason === 'kicked') markRoomLeft(v.code);
        setView({ name: 'home' });
      }
      if (payload.reason === 'sessionReplaced') {
        clearAuth(); // 会话已被新登录顶掉，回到未登录态
        toast('该账号已在其他设备登录，此处已下线', 'error');
        return;
      }
      if (payload.reason === 'left') {
        toast('👋 已退出战局', 'success');
        return;
      }
      toast(
        payload.reason === 'kicked' ? '你已被移出房间' : payload.reason === 'expired' ? '房间已过期' : '房间已解散',
        'error',
      );
    };
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('state', onState);
    socket.on('gameEnded', onGameEnded);
    socket.on('roomClosed', onRoomClosed);
    if (socket.connected) setConn('connected');
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('state', onState);
      socket.off('gameEnded', onGameEnded);
      socket.off('roomClosed', onRoomClosed);
    };
  }, [myId, toast]);

  const ctx: AppCtxValue = { snap, setSnap, myId, setMyId, conn, toast, go, back };

  return (
    <AppCtx.Provider value={ctx}>
      <BackdropTiles />
      <div className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col">
        {view.name === 'home' && <Home />}
        {view.name === 'room' && <Room code={view.code} />}
        {view.name === 'history' && <HistoryList />}
        {view.name === 'historyDetail' && <HistoryDetail id={view.id} />}
        {view.name === 'admin' && <Admin />}
      </div>
      <ToastViewport toasts={toasts} />
    </AppCtx.Provider>
  );
}

function BackdropTiles() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 select-none overflow-hidden">
      <span className="animate-float-slow absolute -left-4 top-[14%] text-8xl opacity-[0.05]">🀄</span>
      <span className="animate-float-slow absolute right-[3%] top-[34%] text-7xl opacity-[0.04] [animation-delay:1.2s]">🀅</span>
      <span className="animate-float-slow absolute bottom-[20%] left-[7%] text-7xl opacity-[0.04] [animation-delay:2.1s]">🀆</span>
      <span className="animate-float-slow absolute bottom-[5%] right-[10%] text-8xl opacity-[0.05] [animation-delay:3s]">🀇</span>
    </div>
  );
}

function ToastViewport({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[100] flex flex-col items-center gap-2 px-4">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`animate-pop max-w-full rounded-2xl border px-4 py-2 text-center text-sm font-medium shadow-xl backdrop-blur-md ${
            t.type === 'error'
              ? 'border-red-400/40 bg-red-950/80 text-red-100'
              : t.type === 'success'
                ? 'border-emerald-400/40 bg-emerald-950/80 text-emerald-100'
                : 'border-white/20 bg-black/70 text-white'
          }`}
        >
          {t.msg}
        </div>
      ))}
    </div>
  );
}
