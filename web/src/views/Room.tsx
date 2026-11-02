import { useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { useApp } from '../App';
import { clearSession, emitAck, loadSession, saveSession, saveName } from '../socket';
import type { PlayerView } from '../types';
import { Avatar, ConfirmButton, SeatBadge, SEATS, Sheet } from '../components/common';
import { CardWall, DrawOverlay, MyCard } from '../components/Cards';
import { PlayerStrip, Scoreboard } from '../components/Scoreboard';
import { ScoreForm } from '../components/ScoreForm';
import { Ledger } from '../components/Ledger';
import { ManageSheet } from '../components/ManageSheet';
import type { Snapshot } from '../types';

type Tab = 'score' | 'card' | 'ledger' | 'manage';

export default function Room({ code }: { code: string }) {
  const { snap, myId, setMyId, go, toast } = useApp();
  const [phase, setPhase] = useState<'init' | 'gate' | 'ready'>('init');
  const [gateName, setGateName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // 已在本房间会话中（如刚创建）直接就绪
    if (snap?.code === code && myId) {
      setPhase('ready');
      return;
    }
    const saved = loadSession(code);
    if (saved) {
      emitAck('room:rejoin', { code, token: saved.token })
        .then((r) => {
          setMyId(r.playerId as string);
          setPhase('ready');
        })
        .catch(() => {
          clearSession(code);
          setPhase('gate');
        });
    } else {
      setPhase('gate');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  const join = async () => {
    const n = gateName.trim();
    if (!n) return toast('先填昵称', 'error');
    saveName(n);
    setBusy(true);
    try {
      const r = await emitAck('room:join', { code, name: n });
      saveSession(code, { playerId: r.playerId as string, token: r.token as string, name: n });
      setMyId(r.playerId as string);
      setPhase('ready');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  if (phase !== 'ready') {
    return (
      <div className="flex flex-1 items-center justify-center px-4">
        <div className="panel w-full max-w-sm p-6">
          <div className="mb-1 text-center text-4xl">🀄</div>
          <h1 className="text-center text-lg font-black">加入房间</h1>
          <p className="mt-1 text-center text-sm text-gold">房间码 {code}</p>
          {phase === 'gate' ? (
            <>
              <input
                className="input mt-5 text-center"
                placeholder="你的昵称"
                maxLength={12}
                value={gateName}
                onChange={(e) => setGateName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && join()}
              />
              <button className="btn-primary mt-4 w-full" disabled={busy} onClick={join}>
                {busy ? '进入中…' : '进入房间'}
              </button>
              <button className="btn-ghost mt-2 w-full" onClick={() => go({ name: 'home' })}>
                返回首页
              </button>
            </>
          ) : (
            <p className="py-8 text-center text-sm text-white/50">正在恢复会话…</p>
          )}
        </div>
      </div>
    );
  }

  if (!snap || snap.code !== code) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="animate-pulse text-sm text-white/50">连接牌桌中…</p>
      </div>
    );
  }

  const me = snap.players.find((p) => p.id === myId);
  if (!me) {
    // 已被移出或掉线后 session 失效
    clearSession(code);
    setPhase('gate');
    return null;
  }

  return snap.status === 'lobby' ? (
    <Lobby snap={snap} me={me} />
  ) : (
    <GameShell snap={snap} me={me} myId={myId} />
  );
}

// ================= 大厅 =================
function Lobby({ snap, me }: { snap: Snapshot; me: PlayerView }) {
  const { toast, setMyId, setSnap, go } = useApp();
  const [showQR, setShowQR] = useState(false);
  const [seatOpen, setSeatOpen] = useState(false);
  const isHost = me.id === snap.hostId;
  const joinUrl = `${location.origin}/?room=${snap.code}`;
  const { score: scoreOn, cards: cardsOn } = snap.features;

  const toggleFeature = async (key: 'score' | 'cards') => {
    const next = { ...snap.features, [key]: !snap.features[key] };
    if (!next.score && !next.cards) {
      toast('记分与条件卡至少开启一项', 'error');
      return;
    }
    try {
      await emitAck('room:setFeatures', next);
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(joinUrl);
      toast('邀请链接已复制', 'success');
    } catch {
      toast('复制失败，请手动复制', 'error');
    }
  };

  const leave = async () => {
    try {
      await emitAck('room:leave');
    } catch {
      /* 忽略 */
    }
    clearSession(snap.code);
    setSnap(null);
    setMyId(null);
    go({ name: 'home' });
  };

  const start = async () => {
    try {
      await emitAck('game:start');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  return (
    <div className="flex flex-1 flex-col px-4 pb-8 pt-6">
      <div className="panel mx-auto w-full max-w-2xl p-5 text-center sm:p-6">
        <p className="text-xs font-semibold tracking-widest text-white/50">房 间 码</p>
        <div className="mt-2 text-5xl font-black tracking-[0.35em] text-gold sm:text-6xl">{snap.code}</div>

        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <button className="btn-ghost" onClick={copy}>
            📋 复制邀请链接
          </button>
          <button className="btn-ghost" onClick={() => setShowQR((v) => !v)}>
            {showQR ? '收起二维码' : '📱 出示二维码'}
          </button>
        </div>
        {showQR && (
          <div className="mx-auto mt-4 w-fit animate-pop rounded-2xl bg-white p-3 shadow-xl">
            <QRCodeSVG value={joinUrl} size={168} />
            <p className="mt-1.5 text-center text-[10px] font-semibold text-stone-500">扫码直接加入</p>
          </div>
        )}
      </div>

      {/* 玩法开关 */}
      <div className="panel mx-auto mt-4 w-full max-w-2xl p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="shrink-0 text-sm font-bold text-white/85">本局玩法</h2>
          <div className="flex gap-2">
            <FeatureToggle on={scoreOn} label="💰 记分" onClick={() => toggleFeature('score')} disabled={!isHost} />
            <FeatureToggle on={cardsOn} label="🀫 条件卡" onClick={() => toggleFeature('cards')} disabled={!isHost} />
          </div>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-white/40">
          两项至少开启一项{isHost ? '，点击可切换' : '（由房主设置）'}；进入下一局随时可点，无需先记账。
        </p>
      </div>

      <div className="panel mx-auto mt-4 w-full max-w-2xl p-4 sm:p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-bold text-white/85">
            玩家 <span className="text-gold">{snap.players.length}</span> / 8
          </h2>
          <span className="text-[11px] text-white/40">坐等开台…</span>
        </div>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {snap.players.map((p) => (
            <div
              key={p.id}
              className={`relative rounded-2xl border p-3 text-center ${
                p.id === me.id ? 'border-gold/50 bg-gold/[0.07]' : 'border-white/10 bg-black/25'
              } ${p.connected ? '' : 'opacity-45'}`}
            >
              {isHost && p.id !== me.id && (
                <button
                  className="absolute right-1.5 top-1.5 z-10 rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] text-white/60 hover:bg-red-500/30"
                  title="移出房间"
                  onClick={() => emitAck('room:kick', { playerId: p.id }).catch((e) => toast((e as Error).message, 'error'))}
                >
                  ✕
                </button>
              )}
              <button
                className={`mx-auto flex flex-col items-center ${p.id === me.id ? 'cursor-pointer' : 'cursor-default'}`}
                onClick={() => p.id === me.id && setSeatOpen(true)}
                title={p.id === me.id ? '点击选择方位' : undefined}
              >
                <div className="flex">
                  <Avatar p={p} me={p.id === me.id} />
                </div>
                <div className="mt-2 max-w-[8em] truncate text-sm font-bold">{p.name}</div>
                <div className="mt-0.5 text-[10px] text-white/40">{p.connected ? '在线' : '离线'}</div>
                {p.id === me.id && (
                  <span className="mt-1 rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/60">换方位 ›</span>
                )}
              </button>
            </div>
          ))}
        </div>

        <div className="mt-5 flex gap-2">
          {isHost ? (
            <button className="btn-primary flex-1 !min-h-[50px] text-base" disabled={snap.players.length < 2} onClick={start}>
              🎲 {snap.players.length < 2 ? '等待更多玩家加入' : '开局！发条件卡'}
            </button>
          ) : (
            <div className="flex-1 rounded-xl border border-white/10 bg-black/25 py-3.5 text-center text-sm font-semibold text-white/50">
              等待房主开局…
            </div>
          )}
        </div>
        <div className="mt-2 text-center">
          <ConfirmButton className="text-xs font-semibold text-white/40 hover:text-red-300" confirmText="确定退出房间？" onConfirm={leave}>
            退出房间
          </ConfirmButton>
        </div>
      </div>

      <SeatPicker open={seatOpen} onClose={() => setSeatOpen(false)} snap={snap} meId={me.id} />
    </div>
  );
}

// ---------- 玩法开关 chip ----------
function FeatureToggle({
  on,
  label,
  onClick,
  disabled,
}: {
  on: boolean;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`min-h-[40px] rounded-full border px-3.5 text-sm font-bold transition ${
        on
          ? 'border-emerald-400/50 bg-emerald-500/20 text-emerald-100'
          : 'border-white/15 bg-black/30 text-white/35 line-through'
      } ${disabled ? 'opacity-60' : 'hover:bg-white/10'}`}
    >
      {label}
    </button>
  );
}

// ---------- 方位自选 ----------
function SeatPicker({ open, onClose, snap, meId }: { open: boolean; onClose: () => void; snap: Snapshot; meId: string | null }) {
  const { toast } = useApp();
  const pick = async (seat: string) => {
    try {
      await emitAck('room:setSeat', { seat });
      onClose();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title="🧭 选择我的方位">
      <div className="grid grid-cols-4 gap-2.5">
        {SEATS.map((seat) => {
          const occupant = snap.players.find((p) => p.seat === seat);
          const mine = occupant?.id === meId;
          const taken = !!occupant && !mine;
          return (
            <button
              key={seat}
              disabled={taken}
              onClick={() => pick(seat)}
              className={`flex min-h-[76px] flex-col items-center justify-center gap-1 rounded-2xl border p-2 transition ${
                mine
                  ? 'border-gold/60 bg-gold/10'
                  : taken
                    ? 'cursor-not-allowed border-white/5 bg-black/40 opacity-40'
                    : 'border-white/15 bg-black/25 hover:border-emerald-400/40 hover:bg-emerald-500/10'
              }`}
            >
              <SeatBadge seat={seat} size="lg" />
              <span className="max-w-full truncate text-[10px] font-semibold text-white/60">
                {mine ? '我的' : occupant ? occupant.name : '可选'}
              </span>
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-center text-[11px] text-white/40">灰色方位已被其他玩家选择</p>
    </Sheet>
  );
}

// ================= 对局 =================
function GameShell({ snap, me, myId }: { snap: Snapshot; me: PlayerView; myId: string | null }) {
  const { conn } = useApp();
  const isHost = me.id === snap.hostId;
  const scoreOn = snap.features.score;
  const cardsOn = snap.features.cards;
  const [tab, setTab] = useState<Tab>(scoreOn ? 'score' : 'card');
  const [manageOpen, setManageOpen] = useState(false);
  const [overlay, setOverlay] = useState<{ text: string; category: string | null; roundNo: number } | null>(null);
  const seenRef = useRef('');

  const myCardKey = `${snap.roundNo}:${me.cardText ?? ''}`;
  useEffect(() => {
    if (cardsOn && me.cardText && seenRef.current !== myCardKey) {
      seenRef.current = myCardKey;
      setOverlay({ text: me.cardText, category: me.cardCategory, roundNo: snap.roundNo });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myCardKey, cardsOn]);

  const tabs: { id: Tab; label: string; icon: string }[] = [
    ...(scoreOn ? [{ id: 'score' as Tab, label: '记分', icon: '💰' }] : []),
    ...(cardsOn ? [{ id: 'card' as Tab, label: '我的卡', icon: '🀫' }] : []),
    ...(scoreOn ? [{ id: 'ledger' as Tab, label: '流水', icon: '📜' }] : []),
    ...(isHost ? [{ id: 'manage' as Tab, label: '管理', icon: '⚙️' }] : []),
  ];

  // 功能开关变化后，当前 tab 可能失效
  useEffect(() => {
    if (!tabs.some((t) => t.id === tab)) setTab(tabs[0]?.id ?? 'score');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoreOn, cardsOn, isHost]);

  return (
    <div className="flex flex-1 flex-col pb-[76px] lg:pb-4">
      {/* 顶栏 */}
      <header className="sticky top-0 z-30 border-b border-white/10 bg-felt-950/85 px-4 py-2.5 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center gap-2 sm:gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 rounded-lg bg-gold/15 px-2 py-1 text-sm font-black tracking-[0.15em] text-gold sm:px-2.5 sm:tracking-[0.2em]">{snap.code}</span>
            <span className="shrink-0 rounded-lg bg-felt-600/40 px-2 py-1 text-xs font-bold text-emerald-100">第 {snap.roundNo} 局</span>
          </div>
          <div className="min-w-4 flex-1" />
          <ConnDot conn={conn} />
          {isHost && (
            <button className="btn-ghost !min-h-[38px] shrink-0 !px-3 text-xs" onClick={() => setManageOpen(true)}>
              ⚙️ 管理
            </button>
          )}
        </div>
      </header>

      {/* 手机端吸顶分数条 */}
      <div className="sticky top-[53px] z-20 border-b border-white/10 bg-felt-950/70 py-2 pt-2 backdrop-blur-md lg:hidden">
        <PlayerStrip snap={snap} myId={myId} showScore={scoreOn} />
      </div>

      {/* 主体 */}
      <div className="mx-auto w-full max-w-6xl px-4 pt-4">
        {/* 手机 / 平板 */}
        <div className="lg:hidden">
          {tab === 'score' && scoreOn && (
            <div className="space-y-4">
              <Scoreboard snap={snap} myId={myId} showScore={scoreOn} />
              <ScoreForm snap={snap} />
            </div>
          )}
          {tab === 'card' && cardsOn && (
            <div className="space-y-4">
              <MyCard me={me} isHost={isHost} />
              <PlayerCardsList snap={snap} myId={myId} />
            </div>
          )}
          {tab === 'ledger' && scoreOn && <Ledger snap={snap} myId={myId} isHost={isHost} />}
          {tab === 'manage' && isHost && <ManageInline snap={snap} onOpenSheet={() => setManageOpen(true)} />}
        </div>

        {/* 桌面中控台 */}
        <div
          className={`hidden gap-4 lg:grid ${
            scoreOn ? 'lg:grid-cols-[280px_minmax(0,1fr)_360px]' : 'lg:grid-cols-[280px_minmax(0,1fr)]'
          }`}
        >
          <div className="space-y-3">
            <h3 className="px-1 text-xs font-bold tracking-widest text-white/45">总分榜</h3>
            <Scoreboard snap={snap} myId={myId} vertical showScore={scoreOn} />
          </div>
          <div className="space-y-4">
            {cardsOn ? (
              <>
                <h3 className="px-1 text-xs font-bold tracking-widest text-white/45">条件卡墙</h3>
                <CardWall snap={snap} myId={myId} />
                <h3 className="px-1 pt-2 text-xs font-bold tracking-widest text-white/45">我的条件卡</h3>
                <MyCard me={me} isHost={isHost} />
              </>
            ) : (
              <CardsOffPlaceholder />
            )}
          </div>
          {scoreOn && (
            <div className="space-y-4">
              <ScoreForm snap={snap} />
              <Ledger snap={snap} myId={myId} isHost={isHost} />
            </div>
          )}
        </div>
      </div>

      {/* 手机底部标签栏 */}
      <nav className="tabbar-safe fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-felt-950/95 backdrop-blur-md lg:hidden">
        <div className="mx-auto grid max-w-lg grid-cols-4">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex min-h-[58px] flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition ${
                tab === t.id ? 'text-gold' : 'text-white/45'
              }`}
            >
              <span className="text-lg leading-none">{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>
      </nav>

      <ManageSheet open={manageOpen} onClose={() => setManageOpen(false)} snap={snap} />
      {overlay && (
        <DrawOverlay
          cardText={overlay.text}
          category={overlay.category}
          roundNo={overlay.roundNo}
          onClose={() => setOverlay(null)}
        />
      )}
      {conn === 'disconnected' && (
        <div className="fixed inset-x-0 top-0 z-[90] bg-amber-600/90 py-1.5 text-center text-xs font-bold text-white">
          连接断开，正在重连…（恢复后数据自动同步）
        </div>
      )}
    </div>
  );
}

/** 条件卡未启用时的占位 */
function CardsOffPlaceholder() {
  return (
    <div className="panel flex min-h-[200px] flex-col items-center justify-center p-8 text-center">
      <span className="text-4xl opacity-25">🀫</span>
      <p className="mt-3 text-sm font-bold text-white/60">本局未启用条件卡</p>
      <p className="mt-1 text-xs text-white/35">房主可在管理菜单中随时开启</p>
    </div>
  );
}

function ConnDot({ conn }: { conn: 'connecting' | 'connected' | 'disconnected' }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[11px] font-semibold ${
        conn === 'connected' ? 'text-emerald-300' : 'text-amber-300'
      }`}
    >
      <span
        className={`h-2 w-2 rounded-full ${conn === 'connected' ? 'bg-emerald-400' : 'animate-pulse bg-amber-400'}`}
      />
      {conn === 'connected' ? '已同步' : '重连中'}
    </span>
  );
}

/** 手机「我的卡」tab 下的全员卡列表 */
function PlayerCardsList({ snap, myId }: { snap: Snapshot; myId: string | null }) {
  return (
    <div className="space-y-2">
      <h3 className="px-1 text-xs font-bold tracking-widest text-white/45">全场亮牌</h3>
      {snap.players
        .filter((p) => p.id !== myId)
        .map((p) => (
          <div key={p.id} className="panel flex items-start gap-3 p-3.5">
            <div className="flex shrink-0 flex-col items-center gap-1 pt-0.5">
              <SeatBadge seat={p.seat} />
              <span className="max-w-[5em] truncate text-[11px] font-semibold">{p.name}</span>
            </div>
            {p.cardText ? (
              <p className="flex-1 text-[13px] font-bold leading-relaxed text-white/90">{p.cardText}</p>
            ) : (
              <p className="flex-1 py-2 text-xs text-white/35">{p.hasCard ? '🀫 尚未亮牌' : '暂无条件卡'}</p>
            )}
          </div>
        ))}
    </div>
  );
}

/** 手机管理 tab（快捷入口，完整操作在弹出面板） */
function ManageInline({ snap, onOpenSheet }: { snap: Snapshot; onOpenSheet: () => void }) {
  const { toast } = useApp();
  const cardsOn = snap.features.cards;
  const act = async (event: string, msg: string) => {
    try {
      await emitAck(event);
      toast(msg, 'success');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  return (
    <div className="space-y-3">
      <button className="btn-primary w-full" onClick={() => act('game:nextRound', cardsOn ? '🀄 新一局已发牌' : '已进入下一局')}>
        🎲 下一局{cardsOn ? '（重新发牌）' : ''}
      </button>
      {cardsOn && (
        <>
          <button className="btn-jade w-full" onClick={() => act('game:redrawAll', '全员已重摸')}>
            🔄 全员重摸（纸条作废）
          </button>
          <div className="panel p-3">
            {snap.players.map((p) => (
              <div key={p.id} className="flex items-center gap-2 border-b border-white/5 py-2 last:border-0">
                <SeatBadge seat={p.seat} />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{p.name}</span>
                <button
                  className="min-h-[34px] shrink-0 rounded-lg border border-white/15 px-2.5 text-xs font-semibold text-white/75"
                  onClick={() => emitAck('game:redrawOne', { playerId: p.id }).catch((e) => toast((e as Error).message, 'error'))}
                >
                  重摸
                </button>
                <button
                  className="min-h-[34px] shrink-0 rounded-lg border border-white/15 px-2.5 text-xs font-semibold text-white/75"
                  onClick={() => emitAck('game:clearCard', { playerId: p.id }).catch((e) => toast((e as Error).message, 'error'))}
                >
                  作废
                </button>
              </div>
            ))}
          </div>
        </>
      )}
      <button className="btn-ghost w-full" onClick={onOpenSheet}>
        ⚙️ 完整管理（玩法开关 / 题库 / 结束战局）
      </button>
    </div>
  );
}
