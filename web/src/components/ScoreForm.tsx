import { useState } from 'react';
import type { Snapshot } from '../types';
import { emitAck } from '../socket';
import { useApp } from '../App';
import { SeatBadge } from './common';

const QUICK = [5, 10, 20, 50, 100];

export function ScoreForm({ snap }: { snap: Snapshot }) {
  const { toast } = useApp();
  const [fromIds, setFromIds] = useState<string[]>([]);
  const [toId, setToId] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const togglePayer = (id: string) => {
    setFromIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
    if (toId === id) setToId(null);
  };

  const pickReceiver = (id: string) => {
    setToId(id);
    setFromIds((cur) => cur.filter((x) => x !== id));
  };

  const submit = async () => {
    const total = parseInt(amount, 10);
    if (fromIds.length === 0) return toast('选择谁付钱（可多选）', 'error');
    if (!toId) return toast('选择谁收钱', 'error');
    if (!Number.isInteger(total) || total <= 0) return toast('分数需为正整数', 'error');
    setBusy(true);
    try {
      await emitAck('score:add', { fromIds, toId, amountTotal: total, note: note.trim() });
      setAmount('');
      setNote('');
      toast('✓ 记账成功', 'success');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const perPayer = fromIds.length > 0 && /^\d+$/.test(amount) && parseInt(amount, 10) > 0
    ? Math.floor(parseInt(amount, 10) / fromIds.length)
    : null;

  return (
    <div className="panel p-4">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-white/85">
        <span>✍️</span> 记一笔
      </h3>

      <p className="mb-1.5 text-xs font-semibold text-white/55">谁付钱？（可多选，自动均分）</p>
      <div className="flex flex-wrap gap-2">
        {snap.players.map((p) => (
          <button
            key={p.id}
            onClick={() => togglePayer(p.id)}
            className={`flex min-h-[40px] items-center gap-1.5 rounded-full border px-3 text-sm font-semibold transition ${
              fromIds.includes(p.id)
                ? 'border-red-400/60 bg-red-500/25 text-red-100'
                : 'border-white/15 bg-black/25 text-white/75 hover:bg-white/10'
            }`}
          >
            <SeatBadge seat={p.seat} />
            {p.name}
          </button>
        ))}
      </div>

      <p className="mb-1.5 mt-4 text-xs font-semibold text-white/55">谁收钱？</p>
      <div className="flex flex-wrap gap-2">
        {snap.players.map((p) => (
          <button
            key={p.id}
            onClick={() => pickReceiver(p.id)}
            className={`flex min-h-[40px] items-center gap-1.5 rounded-full border px-3 text-sm font-semibold transition ${
              toId === p.id
                ? 'border-emerald-400/60 bg-emerald-500/25 text-emerald-100'
                : 'border-white/15 bg-black/25 text-white/75 hover:bg-white/10'
            }`}
          >
            <SeatBadge seat={p.seat} />
            {p.name}
          </button>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-2">
        <input
          className="input flex-1 text-lg font-bold"
          type="number"
          inputMode="numeric"
          min={1}
          placeholder="分数"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ''))}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        <span className="text-sm text-white/50">分</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {QUICK.map((q) => (
          <button
            key={q}
            onClick={() => setAmount(String(q))}
            className="min-h-[34px] rounded-lg border border-white/15 bg-black/25 px-3 text-xs font-bold text-white/70 hover:bg-white/10"
          >
            {q}
          </button>
        ))}
      </div>
      {perPayer !== null && fromIds.length > 1 && (
        <p className="mt-2 text-xs text-gold">
          每人付 {perPayer} 分{parseInt(amount, 10) % fromIds.length !== 0 ? '（首位多付零头）' : ''}
        </p>
      )}

      <input
        className="input mt-3"
        placeholder="备注（自摸 / 点炮 / 杠…）"
        maxLength={30}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
      />

      <button className="btn-primary mt-4 w-full" disabled={busy} onClick={submit}>
        {busy ? '记录中…' : '💰 确认记账'}
      </button>
    </div>
  );
}
