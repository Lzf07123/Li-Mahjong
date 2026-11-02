import { useEffect, useState } from 'react';
import { api } from '../socket';
import { useApp } from '../App';
import { CategoryChip, SeatBadge, fmtTime, scoreColor } from '../components/common';
import type { HistoryDetailData, HistoryItem } from '../types';

export function HistoryList() {
  const { go, back } = useApp();
  const [items, setItems] = useState<HistoryItem[] | null>(null);

  useEffect(() => {
    api.history().then((r) => setItems(r.items)).catch(() => setItems([]));
  }, []);

  return (
    <div className="flex flex-1 flex-col px-4 pb-10 pt-5">
      <div className="mb-4 flex items-center gap-3">
        <button className="btn-ghost !min-h-[38px] !px-3" onClick={back}>
          ←
        </button>
        <h1 className="text-lg font-black">历史战绩</h1>
      </div>

      {items === null ? (
        <p className="py-16 text-center text-sm text-white/40">加载中…</p>
      ) : items.length === 0 ? (
        <div className="panel mx-auto mt-10 w-full max-w-md p-10 text-center">
          <div className="text-4xl opacity-30">🗂️</div>
          <p className="mt-3 text-sm text-white/50">还没有打完的战局</p>
          <button className="btn-primary mt-4" onClick={back}>
            去开局
          </button>
        </div>
      ) : (
        <div className="mx-auto grid w-full max-w-3xl gap-3 md:grid-cols-2">
          {items.map((h) => {
            const sorted = [...h.players].sort((a, b) => b.finalScore - a.finalScore);
            const winner = sorted[0];
            return (
              <button
                key={h.id}
                onClick={() => go({ name: 'historyDetail', id: h.id })}
                className="panel p-4 text-left transition hover:bg-white/[0.09]"
              >
                <div className="flex items-center justify-between text-[11px] text-white/40">
                  <span>
                    {fmtTime(h.startedAt)} · 房间 {h.code}
                  </span>
                  {h.status !== 'finished' && (
                    <span className="rounded-full bg-amber-500/20 px-2 py-0.5 font-bold text-amber-300">未打完</span>
                  )}
                </div>
                <div className="mt-2.5 flex items-baseline gap-2">
                  <span className="text-lg font-black text-gold">🥇 {winner?.name}</span>
                  <span className={`text-sm font-bold ${scoreColor(winner?.finalScore ?? 0)}`}>
                    {winner && winner.finalScore > 0 ? '+' : ''}
                    {winner?.finalScore ?? 0}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {sorted.slice(1).map((p) => (
                    <span key={p.name} className="rounded-full bg-black/30 px-2 py-0.5 text-[11px]">
                      {p.name} <b className={scoreColor(p.finalScore)}>{p.finalScore > 0 ? '+' : ''}{p.finalScore}</b>
                    </span>
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function HistoryDetail({ id }: { id: number }) {
  const { back, toast } = useApp();
  const [data, setData] = useState<HistoryDetailData | null>(null);

  useEffect(() => {
    api
      .historyDetail(id)
      .then(setData)
      .catch((e) => toast((e as Error).message, 'error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!data) {
    return <p className="flex flex-1 items-center justify-center py-20 text-sm text-white/40">加载中…</p>;
  }

  const sorted = [...data.players].sort((a, b) => b.finalScore - a.finalScore);
  const roundNos = Array.from(new Set(data.draws.map((d) => d.roundNo))).sort((a, b) => a - b);
  const entriesByRound = new Map<number, HistoryDetailData['entries']>();
  for (const e of data.entries) {
    const arr = entriesByRound.get(e.roundNo) ?? [];
    arr.push(e);
    entriesByRound.set(e.roundNo, arr);
  }

  return (
    <div className="flex flex-1 flex-col px-4 pb-10 pt-5">
      <div className="mb-4 flex items-center gap-3">
        <button className="btn-ghost !min-h-[38px] !px-3" onClick={back}>
          ←
        </button>
        <h1 className="text-lg font-black">战局复盘</h1>
        <span className="text-xs text-white/40">
          {fmtTime(data.startedAt)} · 房间 {data.code}
        </span>
      </div>

      <div className="mx-auto w-full max-w-3xl space-y-4">
        {/* 最终排名 */}
        <div className="panel p-4">
          <h2 className="mb-3 text-sm font-bold text-white/85">🏁 最终排名</h2>
          <div className="space-y-1.5">
            {sorted.map((p, i) => (
              <div key={p.name + i} className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-black/20 px-3 py-2.5">
                <span className="w-7 text-center text-lg">{['🥇', '🥈', '🥉'][i] ?? i + 1}</span>
                {p.seat && <SeatBadge seat={p.seat} />}
                <b className="flex-1 truncate">{p.name}</b>
                <span className={`text-lg font-black ${scoreColor(p.finalScore)}`}>
                  {p.finalScore > 0 ? '+' : ''}
                  {p.finalScore}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* 每局回顾 */}
        {data.features && !data.features.cards ? null : roundNos.length === 0 ? (
          <p className="text-center text-xs text-white/35">本局没有条件卡记录</p>
        ) : (
          roundNos.map((rn) => (
            <div key={rn} className="panel p-4">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-white/85">
                <span className="rounded-md bg-felt-600/40 px-2 py-0.5 text-[11px] font-bold text-emerald-200">第 {rn} 局</span>
                条件卡
              </h2>
              <div className="space-y-2">
                {data.draws
                  .filter((d) => d.roundNo === rn)
                  .map((d, i) => (
                    <div key={i} className="flex items-start gap-2.5 rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                      <b className="shrink-0 pt-0.5 text-xs text-white/60">{d.playerName}</b>
                      <div className="min-w-0 flex-1">
                        <CategoryChip category={d.category} />
                        <p className="mt-1 text-[13px] font-semibold leading-snug text-white/85">{d.cardText}</p>
                      </div>
                    </div>
                  ))}
              </div>
              {data.features && !data.features.score ? null : entriesByRound.has(rn) && (
                <>
                  <h3 className="mb-1.5 mt-3 text-xs font-bold text-white/50">记账</h3>
                  <div className="space-y-1">
                    {(entriesByRound.get(rn) ?? []).map((e) => (
                      <div key={e.id} className="flex flex-wrap items-baseline gap-x-1.5 text-[13px]">
                        <span className="font-semibold text-red-200">{e.payers.map((p) => p.name).join('、')}</span>
                        <span className="text-white/40">→</span>
                        <span className="font-semibold text-emerald-200">{e.toName}</span>
                        <b className="text-white">{e.amountTotal}</b>
                        {e.note && <span className="rounded bg-white/10 px-1.5 text-[10px] text-white/60">{e.note}</span>}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
