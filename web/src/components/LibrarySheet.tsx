import { useEffect, useState } from 'react';
import type { LibraryData, Snapshot } from '../types';
import { api, emitAck } from '../socket';
import { useApp } from '../App';
import { Sheet } from './common';

export function LibrarySheet({ open, onClose, snap }: { open: boolean; onClose: () => void; snap: Snapshot }) {
  const { toast } = useApp();
  const [data, setData] = useState<LibraryData | null>(null);
  const [newText, setNewText] = useState('');
  const [newCat, setNewCat] = useState('global');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  useEffect(() => {
    if (open) {
      api
        .library()
        .then(setData)
        .catch((e) => toast((e as Error).message, 'error'));
    }
  }, [open]);

  const disabledCats = new Set(snap.disabledCategoryIds);
  const disabledCards = new Set(snap.disabledCardIds);

  const persist = async (patch: { disabledCardIds?: string[]; disabledCategoryIds?: string[] }) => {
    try {
      await emitAck('library:setEnabled', {
        disabledCardIds: patch.disabledCardIds ?? [...disabledCards],
        disabledCategoryIds: patch.disabledCategoryIds ?? [...disabledCats],
      });
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const toggleCategory = (id: string) => {
    const next = new Set(disabledCats);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    persist({ disabledCategoryIds: [...next] });
  };

  const toggleCard = (id: string) => {
    const next = new Set(disabledCards);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    persist({ disabledCardIds: [...next] });
  };

  if (!open) return null;

  return (
    <Sheet open={open} onClose={onClose} title="📚 题库管理" wide>
      {!data ? (
        <p className="py-10 text-center text-sm text-white/40">加载中…</p>
      ) : (
        <div className="space-y-4">
          <p className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs leading-relaxed text-white/50">
            关闭的分类或单卡不会出现在抽卡池中；「自定义条件」对所有房间共享。
          </p>

          {data.categories.map((cat) => {
            const cards = data.builtin.filter((c) => c.category === cat.id);
            if (cards.length === 0) return null;
            const catOff = disabledCats.has(cat.id);
            return (
              <div key={cat.id} className="overflow-hidden rounded-xl border border-white/10">
                <button
                  onClick={() => toggleCategory(cat.id)}
                  className={`flex min-h-[46px] w-full items-center gap-2 px-3 py-2 text-left transition ${
                    catOff ? 'bg-black/40 opacity-60' : 'bg-felt-700/40 hover:bg-felt-700/60'
                  }`}
                >
                  <span className="text-lg">{cat.emoji}</span>
                  <b className="flex-1 text-sm">{cat.name}</b>
                  <span className="text-[10px] text-white/45">{cards.length} 张</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                      catOff ? 'bg-white/10 text-white/50' : 'bg-emerald-500/25 text-emerald-200'
                    }`}
                  >
                    {catOff ? '已停用' : '启用中'}
                  </span>
                </button>
                {!catOff && (
                  <div className="divide-y divide-white/5 bg-black/20">
                    {cards.map((c) => {
                      const off = disabledCards.has(c.id);
                      return (
                        <div key={c.id} className={`flex items-start gap-2 px-3 py-2 ${off ? 'opacity-45' : ''}`}>
                          <p className="flex-1 text-[13px] leading-snug text-white/85">{c.text}</p>
                          <Switch on={!off} onChange={() => toggleCard(c.id)} />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

          {/* 自定义 */}
          <div className="rounded-xl border border-gold/25 bg-gold/[0.04] p-3">
            <p className="mb-2 flex items-center gap-2 text-sm font-bold text-gold">✍️ 自定义条件</p>
            <div className="space-y-2">
              {data.custom.map((c) => (
                <div key={c.id} className="rounded-lg border border-white/10 bg-black/25 px-3 py-2">
                  {editingId === c.id ? (
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <input
                        className="input flex-1 !min-h-[38px] text-sm"
                        value={editText}
                        maxLength={100}
                        onChange={(e) => setEditText(e.target.value)}
                      />
                      <div className="flex gap-2">
                        <button
                          className="btn-jade !min-h-[38px] flex-1 px-3 text-xs"
                          onClick={async () => {
                            try {
                              await emitAck('library:updateCustom', { id: c.id, text: editText, category: c.category, enabled: c.enabled });
                              setEditingId(null);
                              const d = await api.library();
                              setData(d);
                            } catch (e) {
                              toast((e as Error).message, 'error');
                            }
                          }}
                        >
                          保存
                        </button>
                        <button className="btn-ghost !min-h-[38px] flex-1 px-3 text-xs" onClick={() => setEditingId(null)}>
                          取消
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-2">
                      <p className={`flex-1 text-[13px] leading-snug ${c.enabled ? 'text-white/85' : 'text-white/35 line-through'}`}>
                        {c.text}
                      </p>
                      <button
                        className="text-[11px] font-semibold text-white/50 hover:text-white"
                        onClick={() => {
                          setEditingId(c.id);
                          setEditText(c.text);
                        }}
                      >
                        改
                      </button>
                      <button
                        className="text-[11px] font-semibold text-white/50 hover:text-red-300"
                        onClick={async () => {
                          try {
                            await emitAck('library:deleteCustom', { id: c.id });
                            const d = await api.library();
                            setData(d);
                          } catch (e) {
                            toast((e as Error).message, 'error');
                          }
                        }}
                      >
                        删
                      </button>
                      <Switch
                        on={c.enabled}
                        onChange={async () => {
                          try {
                            await emitAck('library:updateCustom', { id: c.id, text: c.text, category: c.category, enabled: !c.enabled });
                            const d = await api.library();
                            setData(d);
                          } catch (e) {
                            toast((e as Error).message, 'error');
                          }
                        }}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input
                className="input flex-1"
                placeholder="输入自定义条件，如：本局胡牌必须唱歌"
                maxLength={100}
                value={newText}
                onChange={(e) => setNewText(e.target.value)}
              />
              <select className="input sm:w-32" value={newCat} onChange={(e) => setNewCat(e.target.value)}>
                {data.categories.map((c) => (
                  <option key={c.id} value={c.id} className="bg-felt-950">
                    {c.emoji} {c.name}
                  </option>
                ))}
              </select>
              <button
                className="btn-primary shrink-0 sm:w-24"
                onClick={async () => {
                  if (!newText.trim()) return toast('先写条件内容', 'error');
                  try {
                    await emitAck('library:addCustom', { text: newText.trim(), category: newCat });
                    setNewText('');
                    const d = await api.library();
                    setData(d);
                    toast('✓ 已加入题库', 'success');
                  } catch (e) {
                    toast((e as Error).message, 'error');
                  }
                }}
              >
                添加
              </button>
            </div>
          </div>
        </div>
      )}
    </Sheet>
  );
}

function Switch({ on, onChange }: { on: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      className={`relative h-6 w-11 shrink-0 rounded-full transition ${on ? 'bg-emerald-500' : 'bg-white/20'}`}
      role="switch"
      aria-checked={on}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? 'left-[22px]' : 'left-0.5'}`}
      />
    </button>
  );
}
