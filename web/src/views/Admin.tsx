import { useCallback, useEffect, useState } from 'react';
import {
  adminApi,
  api,
  getAdminToken,
  setAdminToken,
  type AdminOverview,
  type AdminUserRow,
} from '../socket';
import { useApp } from '../App';
import { ConfirmButton, fmtRel, scoreColor } from '../components/common';
import { Footer } from '../components/Footer';

export default function Admin() {
  const { back, toast } = useApp();
  const [authed, setAuthed] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [authError, setAuthError] = useState('');
  const [ov, setOv] = useState<AdminOverview | null>(null);
  const [users, setUsers] = useState<AdminUserRow[] | null>(null);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<{ uid: string; name: string } | null>(null);
  const [pwEdit, setPwEdit] = useState<{ uid: string; pw: string } | null>(null);
  const [footer, setFooter] = useState<{ github: string; text: string }>({ github: '', text: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (q: string) => {
    const [o, u, s] = await Promise.all([adminApi.overview(), adminApi.users(q), api.settings()]);
    setOv(o);
    setUsers(u.items);
    setFooter(s);
  }, []);

  // 有存档口令时自动尝试登录
  useEffect(() => {
    if (!getAdminToken()) return;
    load('')
      .then(() => setAuthed(true))
      .catch(() => setAuthed(false));
  }, [load]);

  // 搜索防抖自动刷新
  useEffect(() => {
    if (!authed) return;
    const t = setTimeout(() => {
      adminApi
        .users(query.trim())
        .then((u) => setUsers(u.items))
        .catch(() => {});
    }, 350);
    return () => clearTimeout(t);
  }, [query, authed]);

  const login = async () => {
    setAdminToken(tokenInput.trim());
    setAuthError('');
    try {
      await load('');
      setAuthed(true);
    } catch (e) {
      setAuthed(false);
      setAuthError((e as Error).message);
    }
  };

  const refresh = async () => {
    try {
      await load(query.trim());
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const rename = async (uid: string, name: string) => {
    if (!name.trim()) return toast('昵称不能为空', 'error');
    setBusy(true);
    try {
      await adminApi.renameUser(uid, name.trim());
      setEditing(null);
      await refresh();
      toast('✓ 已改名', 'success');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (uid: string) => {
    setBusy(true);
    try {
      await adminApi.deleteUser(uid);
      await refresh();
      toast('已删除用户（历史战绩保留）', 'success');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const resetPw = async (uid: string, pw: string) => {
    if (pw.length < 4) return toast('新密码至少 4 位', 'error');
    setBusy(true);
    try {
      await adminApi.resetPassword(uid, pw);
      setPwEdit(null);
      toast('✓ 密码已重置，请告知该用户', 'success');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const saveFooter = async () => {
    setBusy(true);
    try {
      const r = await adminApi.setFooter(footer.github.trim(), footer.text.trim());
      setFooter(r.settings);
      toast('✓ 页脚已更新', 'success');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col px-4 pb-10 pt-5">
      <div className="mb-4 flex items-center gap-3">
        <button className="btn-ghost !min-h-[38px] !px-3" onClick={back}>
          ←
        </button>
        <h1 className="text-lg font-black">⚙️ 管理后台</h1>
        {authed && (
          <button className="btn-ghost ml-auto !min-h-[36px] !px-3 text-xs" onClick={refresh}>
            🔄 刷新
          </button>
        )}
      </div>

      {!authed ? (
        <div className="panel mx-auto w-full max-w-sm p-6">
          <div className="mb-1 text-center text-3xl">🔐</div>
          <h2 className="text-center text-base font-bold">管理口令</h2>
          <p className="mt-1 text-center text-xs text-white/40">
            服务端环境变量 ADMIN_TOKEN（开发默认 admin123）
          </p>
          <input
            className="input mt-4 text-center"
            type="password"
            placeholder="管理口令"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && login()}
          />
          {authError && <p className="mt-2 text-center text-xs text-red-300">{authError}</p>}
          <button className="btn-primary mt-4 w-full" onClick={login}>
            进入后台
          </button>
        </div>
      ) : !ov || users === null ? (
        <p className="py-16 text-center text-sm text-white/40">加载中…</p>
      ) : (
        <div className="mx-auto w-full max-w-4xl space-y-4">
          {/* 数据大盘 */}
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
            {[
              { label: '注册用户', value: ov.users, icon: '👥', tint: 'from-sky-500/25 to-transparent' },
              { label: '完整战局', value: ov.gamesFinished, icon: '🏁', tint: 'from-emerald-500/25 to-transparent' },
              { label: '进行中战局', value: ov.gamesLive, icon: '🎲', tint: 'from-amber-500/25 to-transparent' },
              { label: '存活房间', value: ov.liveRooms, icon: '🏠', tint: 'from-violet-500/25 to-transparent' },
              { label: '记账笔数', value: ov.entries, icon: '💰', tint: 'from-rose-500/25 to-transparent' },
              { label: '条件卡记录', value: ov.draws, icon: '🀫', tint: 'from-teal-500/25 to-transparent' },
            ].map((c) => (
              <div key={c.label} className={`panel bg-gradient-to-br p-3.5 text-center ${c.tint}`}>
                <div className="text-lg">{c.icon}</div>
                <div className="mt-1 text-2xl font-black text-gold">{c.value}</div>
                <div className="mt-0.5 text-[11px] text-white/50">{c.label}</div>
              </div>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
            {/* 近 7 日战局 */}
            <div className="panel p-4">
              <h2 className="mb-3 text-sm font-bold text-white/85">📈 近 7 日完整战局</h2>
              <div className="flex h-36 items-end gap-2">
                {ov.daily.map((d) => {
                  const max = Math.max(...ov.daily.map((x) => x.count), 1);
                  return (
                    <div key={d.date} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1 self-stretch">
                      <span className="text-[11px] font-bold text-white/70">{d.count || ''}</span>
                      <div
                        className="w-full rounded-t-lg bg-gradient-to-t from-felt-700 to-emerald-400/80 transition-all"
                        style={{ height: `${Math.max(Math.round((d.count / max) * 88), 4)}px` }}
                        title={`${d.date}: ${d.count}`}
                      />
                      <span className="text-[10px] text-white/40">{d.date.slice(5)}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 玩家榜 */}
            <div className="panel p-4">
              <h2 className="mb-2 text-sm font-bold text-white/85">🏆 玩家盈亏榜</h2>
              {ov.top.length === 0 ? (
                <p className="py-6 text-center text-xs text-white/40">暂无数据</p>
              ) : (
                <div className="space-y-1.5">
                  {ov.top.map((s, i) => (
                    <div key={s.name} className="flex items-center gap-2 text-[13px]">
                      <span className="w-4 text-center text-[11px] text-white/40">{i + 1}</span>
                      <span className="min-w-0 flex-1 truncate font-semibold">{s.name}</span>
                      <span className="text-[10px] text-white/40">{s.games}场</span>
                      <span className={`w-14 text-right font-black ${scoreColor(s.total)}`}>
                        {s.total > 0 ? '+' : ''}
                        {s.total}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 用户管理 */}
          <div className="panel p-4">
            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              <h2 className="text-sm font-bold text-white/85">👥 用户管理</h2>
              <div className="flex gap-2 sm:ml-auto sm:w-72">
                <input
                  className="input !min-h-[40px] min-w-0 flex-1 text-sm"
                  placeholder="搜索昵称 / 登录名"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && refresh()}
                />
                <button className="btn-jade !min-h-[40px] shrink-0 !px-4 text-xs" onClick={refresh}>
                  搜索
                </button>
              </div>
            </div>

            {users.length === 0 ? (
              <p className="py-8 text-center text-xs text-white/40">没有匹配的用户</p>
            ) : (
              <div className="space-y-2">
                {users.map((u) => (
                  <div key={u.uid} className="space-y-2">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2.5">
                      <div className="min-w-0 flex-1 basis-52">
                        {editing?.uid === u.uid ? (
                          <div className="flex items-center gap-1.5">
                            <input
                              className="input !min-h-[34px] max-w-[10em] text-sm"
                              value={editing.name}
                              maxLength={12}
                              autoFocus
                              onChange={(e) => setEditing({ uid: u.uid, name: e.target.value })}
                              onKeyDown={(e) => e.key === 'Enter' && rename(u.uid, editing.name)}
                            />
                            <button
                              className="btn-jade !min-h-[32px] !px-2.5 text-[11px]"
                              disabled={busy}
                              onClick={() => rename(u.uid, editing.name)}
                            >
                              保存
                            </button>
                            <button
                              className="btn-ghost !min-h-[32px] !px-2.5 text-[11px]"
                              onClick={() => setEditing(null)}
                            >
                              取消
                            </button>
                          </div>
                        ) : (
                          <>
                            <b className="text-sm">{u.name}</b>
                            {u.username && (
                              <span className="ml-2 rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-white/50">
                                {u.username}
                              </span>
                            )}
                            <span className="ml-2 font-mono text-[10px] text-white/30">{u.uid.slice(0, 8)}</span>
                          </>
                        )}
                        <div className="mt-0.5 text-[10px] text-white/40">
                          最近活跃 {fmtRel(u.lastSeenAt)} · 注册于 {fmtRel(u.createdAt)}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 text-[12px]">
                        <span className="text-white/50">{u.games} 场</span>
                        <span className={`font-black ${scoreColor(u.total)}`}>
                          {u.total > 0 ? '+' : ''}
                          {u.total}
                        </span>
                        <span className="text-[10px] text-white/40">赢{u.wins}</span>
                      </div>
                      <div className="flex flex-1 items-center justify-end gap-1.5 basis-40">
                        <button
                          className="min-h-[36px] rounded-lg border border-white/15 px-3 text-[11px] font-semibold text-white/70 hover:bg-white/10"
                          onClick={() => setEditing({ uid: u.uid, name: u.name })}
                        >
                          改名
                        </button>
                        <button
                          className="min-h-[36px] rounded-lg border border-white/15 px-3 text-[11px] font-semibold text-amber-200 hover:bg-white/10"
                          onClick={() => setPwEdit(pwEdit?.uid === u.uid ? null : { uid: u.uid, pw: '' })}
                        >
                          重置密码
                        </button>
                        <ConfirmButton
                          className="min-h-[36px] rounded-lg border border-red-400/30 px-3 text-[11px] font-semibold text-red-300 hover:bg-red-500/15"
                          confirmText="确认删除？"
                          onConfirm={() => remove(u.uid)}
                        >
                          删除
                        </ConfirmButton>
                      </div>
                    </div>
                    {pwEdit?.uid === u.uid && (
                      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-400/30 bg-amber-500/[0.06] px-3 py-2.5">
                        <span className="text-xs font-semibold text-amber-200">新密码</span>
                        <input
                          className="input !min-h-[34px] max-w-[14em] text-sm"
                          type="text"
                          placeholder="至少 4 位，设置后告知用户"
                          maxLength={64}
                          value={pwEdit.pw}
                          autoFocus
                          onChange={(e) => setPwEdit({ uid: u.uid, pw: e.target.value })}
                          onKeyDown={(e) => e.key === 'Enter' && resetPw(u.uid, pwEdit.pw)}
                        />
                        <button
                          className="btn-jade !min-h-[32px] !px-2.5 text-[11px]"
                          disabled={busy}
                          onClick={() => resetPw(u.uid, pwEdit.pw)}
                        >
                          确认重置
                        </button>
                        <button
                          className="btn-ghost !min-h-[32px] !px-2.5 text-[11px]"
                          onClick={() => setPwEdit(null)}
                        >
                          取消
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            <p className="mt-3 text-[11px] leading-relaxed text-white/35">
              删除用户仅切断身份与历史战绩的关联（战绩数字保留）；改名只改显示昵称，登录名不可改；忘记密码在此重置后告知用户。
            </p>
          </div>

          {/* 页脚设置 */}
          <div className="panel p-4">
            <h2 className="mb-1 text-sm font-bold text-white/85">🦶 页脚设置</h2>
            <p className="mb-3 text-[11px] text-white/40">显示在首页等页面底部，留空则隐藏对应项。</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-white/55">GitHub 链接</label>
                <input
                  className="input text-sm"
                  placeholder="https://github.com/your/repo"
                  value={footer.github}
                  onChange={(e) => setFooter({ ...footer, github: e.target.value })}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-white/55">页脚文字</label>
                <input
                  className="input text-sm"
                  placeholder="如：牌友快乐屋 · 请理性游戏"
                  maxLength={200}
                  value={footer.text}
                  onChange={(e) => setFooter({ ...footer, text: e.target.value })}
                />
              </div>
            </div>
            <button className="btn-jade mt-3 w-full sm:w-32" disabled={busy} onClick={saveFooter}>
              保存页脚
            </button>
            <div className="mt-4 rounded-xl border border-white/10 bg-black/30 px-4 py-3">
              <p className="mb-1.5 text-[10px] font-bold tracking-widest text-white/35">预览</p>
              <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs">
                {footer.github && <span className="font-semibold text-white/60">🐙 GitHub</span>}
                {footer.text && <span className="text-white/45">{footer.text}</span>}
                <span className="text-white/30">⚙️ 管理后台</span>
              </div>
            </div>
          </div>
        </div>
      )}
      <Footer />
    </div>
  );
}
