import { useState } from 'react';
import type { Snapshot } from '../types';
import { emitAck } from '../socket';
import { useApp } from '../App';
import { ConfirmButton, SeatBadge, Sheet } from './common';
import { LibrarySheet } from './LibrarySheet';

export function ManageSheet({
  open,
  onClose,
  snap,
}: {
  open: boolean;
  onClose: () => void;
  snap: Snapshot;
}) {
  const { toast } = useApp();
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const scoreOn = snap.features.score;
  const cardsOn = snap.features.cards;

  const act = async (event: string, payload?: unknown, successMsg?: string) => {
    setBusy(true);
    try {
      await emitAck(event, payload);
      if (successMsg) toast(successMsg, 'success');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const toggleFeature = async (key: 'score' | 'cards') => {
    const next = { ...snap.features, [key]: !snap.features[key] };
    if (!next.score && !next.cards) {
      toast('记分与条件卡至少开启一项', 'error');
      return;
    }
    await act('room:setFeatures', next);
  };

  return (
    <>
      <Sheet open={open && !libraryOpen} onClose={onClose} title="⚙️ 房主管理">
        <div className="space-y-2.5">
          <button className="btn-primary w-full" disabled={busy} onClick={() => act('game:nextRound', undefined, cardsOn ? '🀄 新一局已发牌' : '已进入下一局')}>
            🎲 下一局{cardsOn ? '（重新发牌）' : ''}
          </button>

          <div className="rounded-xl border border-white/10 bg-black/20 p-3">
            <p className="mb-2 text-xs font-semibold text-white/55">本局玩法（至少一项）</p>
            <div className="flex gap-2">
              <button
                disabled={busy}
                onClick={() => toggleFeature('score')}
                className={`min-h-[40px] flex-1 rounded-full border px-3 text-sm font-bold transition ${
                  scoreOn
                    ? 'border-emerald-400/50 bg-emerald-500/20 text-emerald-100'
                    : 'border-white/15 bg-black/30 text-white/35 line-through'
                }`}
              >
                💰 记分
              </button>
              <button
                disabled={busy}
                onClick={() => toggleFeature('cards')}
                className={`min-h-[40px] flex-1 rounded-full border px-3 text-sm font-bold transition ${
                  cardsOn
                    ? 'border-emerald-400/50 bg-emerald-500/20 text-emerald-100'
                    : 'border-white/15 bg-black/30 text-white/35 line-through'
                }`}
              >
                🀫 条件卡
              </button>
            </div>
          </div>

          {cardsOn && (
            <button className="btn-jade w-full" disabled={busy} onClick={() => act('game:redrawAll', undefined, '全员已重摸')}>
              🔄 全员重摸（纸条作废）
            </button>
          )}

          {cardsOn && (
            <div className="rounded-xl border border-white/10 bg-black/20 p-3">
              <p className="mb-2 text-xs font-semibold text-white/55">逐个处理</p>
            <div className="space-y-2">
              {snap.players.map((p) => (
                <div key={p.id} className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-2.5 py-2">
                  <SeatBadge seat={p.seat} />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                    {p.name}
                    {p.hasCard && <span className="ml-1.5 text-[10px] font-normal text-white/45">{p.cardRevealed ? '已亮' : '未亮'}</span>}
                  </span>
                  <button
                    className="min-h-[34px] rounded-lg border border-white/15 px-2.5 text-xs font-semibold text-white/75 hover:bg-white/10"
                    disabled={busy}
                    onClick={() => act('game:redrawOne', { playerId: p.id }, `${p.name} 已重摸`)}
                  >
                    重摸
                  </button>
                  <button
                    className="min-h-[34px] rounded-lg border border-white/15 px-2.5 text-xs font-semibold text-white/75 hover:bg-white/10"
                    disabled={busy}
                    onClick={() => act('game:clearCard', { playerId: p.id }, `${p.name} 条件已作废`)}
                  >
                    作废
                  </button>
                </div>
              ))}
              </div>
            </div>
          )}

          <button className="btn-ghost w-full" onClick={() => setLibraryOpen(true)}>
            📚 题库管理（启停 / 自定义条件）
          </button>

          <div className="grid grid-cols-2 gap-2 pt-1">
            {scoreOn && (
              <ConfirmButton
                className="btn-ghost w-full !text-amber-200"
                onConfirm={() => act('score:reset', undefined, '分数已重置')}
              >
                🔁 重置分数
              </ConfirmButton>
            )}
            <ConfirmButton
              className={`btn-primary w-full ${scoreOn ? '' : 'col-span-2'}`}
              onConfirm={() => act('game:end')}
            >
              🏁 结束战局
            </ConfirmButton>
          </div>
          <ConfirmButton className="btn-danger w-full" confirmText="解散后数据不可恢复，确认？" onConfirm={() => act('room:dissolve')}>
            💥 解散房间
          </ConfirmButton>
          <p className="pt-1 text-center text-[11px] leading-relaxed text-white/35">
            结束战局会归档成绩到「历史战绩」；解散房间则不保留本局
          </p>
        </div>
      </Sheet>
      <LibrarySheet open={libraryOpen} onClose={() => setLibraryOpen(false)} snap={snap} />
    </>
  );
}
