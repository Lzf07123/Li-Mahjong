import type { Snapshot } from '../types';
import { emitAck } from '../socket';
import { useApp } from '../App';
import { ConfirmButton, fmtTime } from './common';

export function Ledger({ snap, myId, isHost }: { snap: Snapshot; myId: string | null; isHost: boolean }) {
  const { toast } = useApp();
  const entries = snap.entries;

  const undo = async (entryId: number) => {
    try {
      await emitAck('score:undo', { entryId });
      toast('已撤销该笔记录', 'success');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  if (entries.length === 0) {
    return (
      <div className="panel p-4">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-white/85">
          <span>📜</span> 记分流水
        </h3>
        <p className="py-6 text-center text-xs text-white/40">还没有记账 · 用记分表单记第一笔</p>
      </div>
    );
  }

  // 按局分组（entries 已按时间倒序）
  const groups: { roundNo: number; items: typeof entries }[] = [];
  for (const e of entries) {
    let g = groups.find((x) => x.roundNo === e.roundNo);
    if (!g) {
      g = { roundNo: e.roundNo, items: [] };
      groups.push(g);
    }
    g.items.push(e);
  }

  return (
    <div className="panel p-4">
      <h3 className="mb-3 flex items-center justify-between text-sm font-bold text-white/85">
        <span className="flex items-center gap-2">
          <span>📜</span> 记分流水
        </span>
        <span className="text-[11px] font-normal text-white/40">共 {snap.entryCount} 笔</span>
      </h3>
      <div className="space-y-3">
        {groups.map((g) => (
          <div key={g.roundNo}>
            <div className="mb-1.5 flex items-center gap-2">
              <span className="rounded-md bg-felt-600/40 px-2 py-0.5 text-[11px] font-bold text-emerald-200">
                第 {g.roundNo} 局
              </span>
              <span className="h-px flex-1 bg-white/10" />
            </div>
            <div className="space-y-1.5">
              {g.items.map((e) => {
                const canUndo = isHost || e.createdBy === myId;
                return (
                  <div key={e.id} className="group flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-1.5 text-[13px]">
                        <span className="font-semibold text-red-200">{e.payers.map((p) => p.name).join('、')}</span>
                        <span className="text-white/40">→</span>
                        <span className="font-semibold text-emerald-200">{e.toName}</span>
                        <span className="ml-1 text-base font-black text-white">
                          {e.amountTotal}
                          {e.payers.length > 1 && (
                            <span className="ml-1 text-[10px] font-normal text-white/45">
                              （{e.payers.map((p) => `-${p.amount}`).join(' / ')}）
                            </span>
                          )}
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-[10px] text-white/35">
                        {e.note && <span className="rounded bg-white/10 px-1.5 py-0.5 font-semibold text-white/60">{e.note}</span>}
                        <span>{fmtTime(e.createdAt)}</span>
                      </div>
                    </div>
                    {canUndo && (
                      <ConfirmButton
                        className="shrink-0 rounded-lg border border-white/15 px-2.5 py-1.5 text-[11px] font-semibold text-white/60 hover:bg-white/10"
                        confirmText="确认撤销？"
                        onConfirm={() => undo(e.id)}
                      >
                        撤销
                      </ConfirmButton>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
