import { useEffect, useState } from 'react';
import type { PlayerView, Snapshot } from '../types';
import { CategoryChip, SeatBadge } from './common';
import { emitAck } from '../socket';

// ---------- 我的条件卡 ----------
export function MyCard({ me, isHost }: { me: PlayerView | undefined; isHost: boolean }) {
  if (!me?.cardText) {
    return (
      <div className="paper-card flex min-h-[180px] flex-col items-center justify-center rounded-2xl p-6 text-center">
        <span className="text-4xl opacity-30">🀫</span>
        <p className="mt-2 text-sm font-bold text-stone-500">等待发牌…</p>
        <p className="mt-1 text-xs text-stone-400">新一局开始后这里会出现你的条件卡</p>
      </div>
    );
  }
  return (
    <div className="relative">
      <div className="paper-card animate-pop relative overflow-hidden rounded-2xl p-5 text-stone-900">
        <div className="absolute right-3 top-3 rotate-12 text-4xl opacity-10">🀄</div>
        <div className="flex items-center justify-between">
          <span className="rounded-full bg-stone-900/10 px-2.5 py-1 text-[11px] font-bold text-stone-600">
            本局条件卡
          </span>
          {me.cardRevealed ? (
            <span className="rounded-full bg-emerald-600/15 px-2.5 py-1 text-[11px] font-bold text-emerald-700">
              已亮牌
            </span>
          ) : (
            <span className="rounded-full bg-amber-600/15 px-2.5 py-1 text-[11px] font-bold text-amber-700">
              仅自己可见
            </span>
          )}
        </div>
        <div className="mt-3">
          <CategoryChip category={me.cardCategory} />
        </div>
        <p className="mt-3 break-words text-lg font-black leading-relaxed sm:text-xl">{me.cardText}</p>
        <div className="mt-4 flex justify-end">
          {!me.cardRevealed && (
            <button
              className="btn bg-stone-900/85 text-white hover:bg-stone-900"
              onClick={() => emitAck('game:reveal').catch(() => {})}
            >
              📣 亮牌给全场
            </button>
          )}
        </div>
      </div>
      {isHost && (
        <p className="mt-2 text-center text-[11px] text-white/40">
          提示：管理菜单里可对任意玩家「重摸 / 作废」条件卡
        </p>
      )}
    </div>
  );
}

function CategoryChipDark({ category }: { category: string | null }) {
  if (!category) return null;
  return <CategoryChip category={category} />;
}

// ---------- 桌面条件卡墙 ----------
export function CardWall({ snap, myId }: { snap: Snapshot; myId: string | null }) {
  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      {snap.players.map((p) => {
        const mine = p.id === myId;
        const visible = p.cardText !== null;
        return (
          <div
            key={p.id}
            className={`paper-card relative min-h-[150px] rounded-xl p-3.5 text-stone-900 transition ${
              mine ? 'ring-2 ring-gold' : ''
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <SeatBadge seat={p.seat} />
                <b className="max-w-[7em] truncate text-xs">{p.name}</b>
                {mine && <span className="text-[10px] font-bold text-amber-700">（我）</span>}
              </span>
              {p.cardRevealed && <span className="text-[10px] font-bold text-emerald-700">已亮</span>}
            </div>
            {visible ? (
              <p className="mt-2.5 break-words text-[13px] font-bold leading-snug">{p.cardText}</p>
            ) : p.hasCard ? (
              <div className="mt-2.5 flex h-[72px] flex-col items-center justify-center rounded-lg border border-dashed border-stone-400/50 text-stone-400">
                <span className="text-2xl opacity-40">🀫</span>
                <span className="mt-1 text-[11px] font-semibold">未亮牌</span>
              </div>
            ) : (
              <p className="mt-4 text-center text-[11px] text-stone-400">暂无</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------- 抽卡动画 ----------
export function DrawOverlay({ cardText, category, roundNo, onClose }: { cardText: string; category: string | null; roundNo: number; onClose: () => void }) {
  const [flipping, setFlipping] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setFlipping(false), 950);
    return () => clearTimeout(t);
  }, [cardText]);

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/75 p-6 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-sm text-center">
        <p className="mb-4 text-sm font-bold tracking-widest text-gold">第 {roundNo} 局 · 抽到条件卡</p>
        <div className="[perspective:1000px]">
          <div className={`paper-card mx-auto max-w-sm rounded-3xl p-7 text-stone-900 ${flipping ? 'animate-flip' : 'animate-pop'}`}>
            <div className="text-4xl">🀫</div>
            <CategoryChipDark category={category} />
            <p className="mt-4 break-words text-xl font-black leading-relaxed">{cardText}</p>
            <p className="mt-4 text-xs font-semibold text-stone-500">本局生效 · 抽到什么照做什么</p>
          </div>
        </div>
        <p className="mt-5 animate-pulse text-xs text-white/60">点击任意处关闭</p>
      </div>
    </div>
  );
}
