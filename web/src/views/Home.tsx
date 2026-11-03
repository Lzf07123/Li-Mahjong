import { useEffect, useState } from 'react';
import { emitRoomAck, api, loadAuth, clearAuth, saveSession, type AuthUser, type MeInfo } from '../socket';
import { useApp } from '../App';
import { fmtTime, scoreColor } from '../components/common';
import { AuthForm } from '../components/AuthForm';
import { Footer } from '../components/Footer';
import { ProfileSheet } from '../components/ProfileSheet';
import type { HistoryItem, StatsItem } from '../types';

export default function Home() {
  const { go, toast, setMyId } = useApp();
  const [auth, setAuth] = useState<{ token: string; user: AuthUser } | null>(() => loadAuth());
  const [profileOpen, setProfileOpen] = useState(false);
  const [mode, setMode] = useState<'create' | 'join'>('create');
  const [code, setCode] = useState(() => {
    const p = new URLSearchParams(location.search).get('room') ?? '';
    return p.toUpperCase();
  });
  const [busy, setBusy] = useState(false);
  const [stats, setStats] = useState<StatsItem[] | null>(null);
  const [recent, setRecent] = useState<HistoryItem[] | null>(null);
  const [me, setMe] = useState<MeInfo | null>(null);

  useEffect(() => {
    api.stats().then((r) => setStats(r.items)).catch(() => setStats([]));
    api.history().then((r) => setRecent(r.items.slice(0, 3))).catch(() => setRecent([]));
  }, []);

  useEffect(() => {
    if (!auth) return;
    api
      .me()
      .then(setMe)
      .catch(() => setMe(null));
  }, [auth]);

  const logout = async () => {
    try {
      await api.logout();
    } catch {
      /* 忽略 */
    }
    clearAuth();
    setAuth(null);
    setMe(null);
    toast('已退出登录', 'success');
  };

  const enter = async () => {
    if (!auth) return;
    setBusy(true);
    try {
      if (mode === 'create') {
        const r = await emitRoomAck('room:create');
        saveSession(r.code as string, { playerId: r.playerId as string, token: r.token as string, name: auth.user.name });
        setMyId(r.playerId as string);
        go({ name: 'room', code: r.code as string });
      } else {
        const c = code.trim().toUpperCase();
        if (!/^[A-Z2-9]{4}$/.test(c)) return toast('房间码是 4 位字母数字', 'error');
        const r = await emitRoomAck('room:join', { code: c });
        saveSession(c, { playerId: r.playerId as string, token: r.token as string, name: auth.user.name });
        setMyId(r.playerId as string);
        go({ name: 'room', code: c });
      }
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col px-4 pb-10 pt-6 sm:pt-10">
      {/* Hero */}
      <div className="relative mb-6 text-center sm:mb-10">
        <div className="pointer-events-none absolute inset-x-0 -top-4 mx-auto flex max-w-md justify-between opacity-20 select-none">
          <span className="animate-float-slow text-4xl">🀄</span>
          <span className="animate-float-slow text-3xl [animation-delay:0.8s]">🀅</span>
          <span className="animate-float-slow text-4xl [animation-delay:1.6s]">🀆</span>
          <span className="animate-float-slow text-3xl [animation-delay:2.4s]">🀇</span>
        </div>
        <div className="text-5xl">🀄</div>
        <h1 className="mt-2 text-3xl font-black tracking-wide sm:text-4xl">
          雀记 <span className="text-gold">·</span> 麻将记分
        </h1>
        <p className="mt-1.5 text-sm text-white/60">
          房间码实时同步记分 · 每局抽整蛊条件卡 · 战局自动归档复盘
        </p>
      </div>

      <div className="grid flex-1 items-start gap-4 lg:grid-cols-[1fr_360px]">
        {/* 左：登录 / 创建 / 加入 */}
        <div className="panel mx-auto w-full max-w-md p-4 sm:p-5 lg:mx-0 lg:max-w-none">
          {!auth ? (
            <>
              <div className="mb-4 text-center text-sm font-bold text-white/80">登录后开始打牌</div>
              <AuthForm onAuthed={() => setAuth(loadAuth())} />
            </>
          ) : (
            <>
              <div className="mb-4 flex items-center gap-3 rounded-xl border border-gold/25 bg-gradient-to-r from-gold/[0.09] to-transparent px-3.5 py-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-gold to-amber-600 text-lg font-black text-felt-950 shadow-lg shadow-gold/20">
                  {auth.user.name.slice(0, 1)}
                </span>
                <div className="min-w-0 flex-1 leading-tight">
                  <div className="flex items-center gap-1.5">
                    <b className="truncate text-sm text-gold">{auth.user.name}</b>
                    {me && me.games > 0 && (
                      <span className="text-[11px] text-white/50">
                        {me.games} 场 ·{' '}
                        <b className={scoreColor(me.total)}>
                          {me.total > 0 ? '+' : ''}
                          {me.total}
                        </b>
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-white/35">已登录 · 忘记密码请联系管理员</div>
                </div>
                <button
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-sm transition hover:bg-white/20"
                  title="账号设置"
                  onClick={() => setProfileOpen(true)}
                >
                  ⚙️
                </button>
                <button
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-sm transition hover:bg-red-500/30"
                  title="退出登录"
                  onClick={logout}
                >
                  ⎋
                </button>
              </div>

              <div className="mb-4 grid grid-cols-2 gap-2 rounded-xl bg-black/30 p-1">
                {(['create', 'join'] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className={`min-h-[40px] rounded-lg text-sm font-bold transition ${
                      mode === m ? 'bg-felt-600 text-white shadow' : 'text-white/60 hover:text-white'
                    }`}
                  >
                    {m === 'create' ? '创建房间' : '加入房间'}
                  </button>
                ))}
              </div>

              {mode === 'join' && (
                <>
                  <label className="mb-1.5 block text-xs font-semibold text-white/60">房间码</label>
                  <input
                    className="input text-center text-2xl font-black uppercase tracking-[0.4em]"
                    placeholder="ABCD"
                    maxLength={4}
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z2-9]/g, ''))}
                    onKeyDown={(e) => e.key === 'Enter' && enter()}
                  />
                  <p className="mt-1.5 text-xs text-white/40">也可直接扫房主分享的二维码进入</p>
                </>
              )}

              <button className="btn-primary mt-5 w-full !min-h-[52px] text-base" disabled={busy} onClick={enter}>
                {busy ? '请稍候…' : mode === 'create' ? '🎲 创建房间' : '🀄 加入房间'}
              </button>

              <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3 text-xs leading-relaxed text-white/50">
                <b className="text-white/70">玩法：</b>房主创建房间 → 其他人扫码或输房间码加入 → 每局开始自动发整蛊条件卡，
                抽到什么照做什么 → 记分实时同步，输赢一目了然。忘记密码请联系管理员重置。
              </div>
            </>
          )}
        </div>

        {/* 右：战绩速览 */}
        <div className="flex flex-col gap-4">
          <div className="panel p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-bold text-white/80">📊 战绩速览</h2>
              <button className="text-xs font-semibold text-gold hover:underline" onClick={() => go({ name: 'history' })}>
                全部战绩 →
              </button>
            </div>
            {stats === null || recent === null ? (
              <p className="py-6 text-center text-xs text-white/40">加载中…</p>
            ) : stats.length === 0 ? (
              <p className="py-6 text-center text-xs text-white/40">还没有打完的战局，来一局？</p>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-2">
                  {stats.slice(0, 3).map((s) => (
                    <div key={s.name} className="rounded-xl border border-white/10 bg-black/20 p-2.5 text-center">
                      <div className="truncate text-xs font-semibold">{s.name}</div>
                      <div className={`mt-1 text-lg font-black ${scoreColor(s.total)}`}>
                        {s.total > 0 ? '+' : ''}
                        {s.total}
                      </div>
                      <div className="text-[10px] text-white/40">{s.games} 场 · 赢 {s.wins}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-3 space-y-1.5">
                  {recent.map((h) => (
                    <button
                      key={h.id}
                      onClick={() => go({ name: 'historyDetail', id: h.id })}
                      className="flex w-full items-center justify-between rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-left text-xs hover:bg-white/10"
                    >
                      <span className="text-white/50">{fmtTime(h.endedAt ?? h.startedAt)}</span>
                      <span className="truncate px-2 text-white/70">
                        {h.players.map((p) => p.name).join(' · ')}
                      </span>
                      <span className="text-gold">›</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {stats && stats.length > 0 && (
            <div className="panel p-4">
              <h2 className="mb-2 text-sm font-bold text-white/80">💰 累计盈亏榜</h2>
              <div className="space-y-1.5">
                {stats.slice(0, 6).map((s, i) => (
                  <div key={s.name} className="flex items-center gap-2 text-sm">
                    <span className="w-5 text-center text-xs text-white/40">{i + 1}</span>
                    <span className="flex-1 truncate font-semibold">{s.name}</span>
                    <span className="text-[10px] text-white/40">{s.games}场</span>
                    <span className={`w-16 text-right font-black ${scoreColor(s.total)}`}>
                      {s.total > 0 ? '+' : ''}
                      {s.total}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <Footer />
      {me && (
        <ProfileSheet
          open={profileOpen}
          onClose={() => setProfileOpen(false)}
          me={me}
          onUpdated={() => {
            api
              .me()
              .then(setMe)
              .catch(() => {});
            setAuth(loadAuth());
          }}
        />
      )}
    </div>
  );
}
