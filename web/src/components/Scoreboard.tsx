import type { Snapshot } from '../types';
import { Avatar, scoreColor } from './common';

export function Scoreboard({
  snap,
  myId,
  vertical,
  showScore = true,
}: {
  snap: Snapshot;
  myId: string | null;
  vertical?: boolean;
  showScore?: boolean;
}) {
  const topScore = Math.max(...snap.players.map((p) => p.score), 0);

  if (vertical) {
    return (
      <div className="flex flex-col gap-2.5">
        {[...snap.players].map((p) => (
          <PlayerTile key={p.id} p={p} myId={myId} topScore={topScore} big showScore={showScore} />
        ))}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:hidden xl:grid-cols-2">
      {[...snap.players].map((p) => (
        <PlayerTile key={p.id} p={p} myId={myId} topScore={topScore} showScore={showScore} />
      ))}
    </div>
  );
}

export function PlayerStrip({ snap, myId, showScore = true }: { snap: Snapshot; myId: string | null; showScore?: boolean }) {
  // 手机端吸顶横滑条
  const topScore = Math.max(...snap.players.map((p) => p.score), 0);
  return (
    <div className="flex gap-2 overflow-x-auto px-4 pb-1 lg:hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {snap.players.map((p) => (
        <div
          key={p.id}
          className={`flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 ${
            p.id === myId ? 'border-gold/60 bg-gold/10' : 'border-white/10 bg-black/25'
          }`}
        >
          <Avatar p={p} me={p.id === myId} />
          <span className="max-w-[6em] truncate text-xs font-bold">{p.name}</span>
          {showScore && (
            <span className={`text-sm font-black ${scoreColor(p.score)}`}>
              {p.score > 0 ? '+' : ''}
              {p.score}
            </span>
          )}
          {showScore && p.score === topScore && snap.players.length > 1 && p.score !== 0 && (
            <span className="text-[10px]">👑</span>
          )}
        </div>
      ))}
    </div>
  );
}

function PlayerTile({
  p,
  myId,
  topScore,
  big,
  showScore = true,
}: {
  p: Snapshot['players'][number];
  myId: string | null;
  topScore: number;
  big?: boolean;
  showScore?: boolean;
}) {
  const isTop = showScore && p.score === topScore && p.score !== 0;
  return (
    <div
      className={`relative rounded-2xl border p-3 transition ${
        p.id === myId
          ? 'border-gold/50 bg-gradient-to-br from-gold/[0.12] to-transparent'
          : 'border-white/10 bg-gradient-to-br from-white/[0.07] to-white/[0.02]'
      } ${p.connected ? '' : 'opacity-45'}`}
    >
      <div className="flex items-center gap-2">
        <Avatar p={p} me={p.id === myId} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <b className={`truncate ${big ? 'text-sm' : 'text-[13px]'}`}>{p.name}</b>
            {!p.connected && <span className="shrink-0 text-[9px] text-white/40">离线</span>}
          </div>
          <div className="mt-0.5 flex items-center gap-1 text-[10px] text-white/45">
            {p.hasCard ? (p.cardRevealed ? '🀄 已亮牌' : '🀫 有条件卡') : cardsOffHint()}
          </div>
        </div>
        {showScore && (
          <div className="shrink-0 text-right">
            <div className={`num text-xl font-black leading-none ${scoreColor(p.score)}`}>
              {p.score > 0 ? '+' : ''}
              {p.score}
            </div>
            {isTop && <div className="mt-0.5 text-[9px] font-bold text-gold-grad">领先 👑</div>}
          </div>
        )}
      </div>
    </div>
  );
}

function cardsOffHint(): string {
  return '·';
}
