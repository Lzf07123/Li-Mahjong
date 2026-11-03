import { useEffect, useState } from 'react';
import { emitRoomAck, api, loadAuth, clearAuth, saveSession, latestSavedRoom, clearSession, type AuthUser, type MeInfo } from '../socket';
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
  // 本地留有进行中战局的会话 → 首页显示「回到战局」
  const [resume, setResume] = useState<{ code: string; status: string; roundNo: number; playerCount: number } | null>(null);

  useEffect(() => {
    api.stats().then((r) => setStats(r.items)).catch(() => setStats([]));
    api.history().then((r) => setRecent(r.items.slice(0, 3))).catch(() => setRecent([]));
  }, []);

  useEffect(() => {
    const c = latestSavedRoom();
    if (!c) return;
    fetch(`/api/room/${c}/alive`)
      .then((r) => r.json())
      .then((j: { alive: boolean; status?: string; roundNo?: number; playerCount?: number }) => {
        if (j.alive) setResume({ code: c, status: j.status ?? 'lobby', roundNo: j.roundNo ?? 0, playerCount: j.playerCount ?? 0 });
        else clearSession(c); // 房间已不存在，顺手清理本地会话
      })
      .catch(() => {});
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
      <div className="relative mb-7 text-center sm:mb-10">
        {/* 两侧漂浮牌簇（装饰） */}
        <div className="pointer-events-none absolute -left-3 top-8 hidden -rotate-[14deg] text-5xl opacity-[0.14] blur-[1px] select-none sm:block">
          <span className="animate-float-slow inline-block">🀄</span>
        </div>
        <div className="pointer-events-none absolute -left-7 top-24 hidden rotate-[9deg] text-3xl opacity-[0.09] select-none sm:block">
          <span className="animate-float-slow inline-block [animation-delay:1.4s]">🀇</span>
        </div>
        <div className="pointer-events-none absolute -right-3 top-9 hidden rotate-[14deg] text-5xl opacity-[0.14] blur-[1px] select-none sm:block">
          <span className="animate-float-slow inline-block [animation-delay:0.7s]">🀅</span>
        </div>
        <div className="pointer-events-none absolute -right-7 top-26 hidden -rotate-[8deg] text-3xl opacity-[0.09] select-none sm:block">
          <span className="animate-float-slow inline-block [animation-delay:2.1s]">🀆</span>
        </div>

        {/* 发光的麻将牌徽章 */}
        <div className="relative mx-auto mb-3 w-fit">
          <div className="absolute -inset-3 rounded-3xl bg-gold/25 blur-xl" />
          <div className="paper-card relative flex h-14 w-11 -rotate-6 items-center justify-center rounded-xl text-3xl shadow-xl">
            <span>🀄</span>
          </div>
        </div>

        <h1 className="text-4xl font-black tracking-wide sm:text-5xl">
          <span className="text-gold-grad">雀记</span>
          <span className="mx-2 text-xl text-white/25 sm:text-2xl">·</span>
          <span className="text-white/95">麻将记分</span>
        </h1>
        <p className="mx-auto mt-3 flex max-w-lg flex-wrap items-center justify-center gap-x-2.5 gap-y-1 text-xs text-white/55 sm:text-sm">
          <span>房间码实时同步记分</span>
          <i className="h-1 w-1 rounded-full bg-gold/70" />
          <span>每局抽整蛊条件卡</span>
          <i className="h-1 w-1 rounded-full bg-gold/70" />
          <span>战局自动归档复盘</span>
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

              {resume && (
                <button
                  className="mb-4 flex w-full items-center gap-3 rounded-2xl border border-gold/50 bg-gold/10 p-3.5 text-left transition hover:bg-gold/15"
                  onClick={() => go({ name: 'room', code: resume.code })}
                >
                  <span className="text-2xl">🀫</span>
                  <span className="min-w-0 flex-1">
                    <b className="block text-sm font-bold text-gold">
                      {resume.status === 'playing' ? `战局进行中 · 第 ${resume.roundNo} 局` : '房间等待开局'}
                    </b>
                    <span className="text-xs text-white/55">
                      房间 {resume.code} · {resume.playerCount} 人在场 · 点击回到战局
                    </span>
                  </span>
                  <span className="shrink-0 text-lg text-gold">›</span>
                </button>
              )}

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
              <h2 className="text-sm font-bold text-white/85">📊 战绩速览</h2>
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
                  {stats.slice(0, 3).map((s, i) => (
                    <div
                      key={s.name}
                      className="card-hover rounded-xl border border-white/10 bg-gradient-to-b from-black/30 to-black/10 p-2.5 text-center"
                    >
                      <div className="truncate text-xs font-semibold">{s.name}</div>
                      <div className={`num mt-1 text-lg font-black ${scoreColor(s.total)}`}>
                        {s.total > 0 ? '+' : ''}
                        {s.total}
                      </div>
                      <div className="text-[10px] text-white/40">{s.games} 场 · 赢 {s.wins}</div>
                      {i === 0 && <div className="mt-1 text-[10px]">👑</div>}
                    </div>
                  ))}
                </div>
                <div className="mt-3 space-y-1.5">
                  {recent.map((h) => (
                    <button
                      key={h.id}
                      onClick={() => go({ name: 'historyDetail', id: h.id })}
                      className="card-hover flex w-full items-center justify-between rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-left text-xs hover:border-gold/30 hover:bg-white/10"
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
              <h2 className="mb-2.5 text-sm font-bold text-white/85">💰 累计盈亏榜</h2>
              <div className="space-y-1">
                {stats.slice(0, 6).map((s, i) => (
                  <div
                    key={s.name}
                    className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${i === 0 ? 'bg-gradient-to-r from-gold/[0.14] to-transparent' : ''}`}
                  >
                    <span
                      className={`num flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[11px] font-black ${
                        i === 0
                          ? 'bg-gradient-to-br from-gold to-amber-600 text-felt-950'
                          : i === 1
                            ? 'bg-white/20 text-white/85'
                            : i === 2
                              ? 'bg-amber-800/60 text-amber-200/90'
                              : 'text-white/35'
                      }`}
                    >
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-semibold">{s.name}</span>
                    <span className="text-[10px] text-white/40">{s.games}场</span>
                    <span className={`num w-16 text-right font-black ${scoreColor(s.total)}`}>
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
