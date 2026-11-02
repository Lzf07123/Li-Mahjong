import { useState } from 'react';
import { api, type MeInfo } from '../socket';
import { useApp } from '../App';
import { Sheet } from './common';

/** 登录后自助修改昵称与密码（需已知当前密码） */
export function ProfileSheet({
  open,
  onClose,
  me,
  onUpdated,
}: {
  open: boolean;
  onClose: () => void;
  me: MeInfo;
  onUpdated: () => void;
}) {
  const { toast } = useApp();
  const [name, setName] = useState(me.name);
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [newPw2, setNewPw2] = useState('');
  const [busy, setBusy] = useState(false);

  const saveName = async () => {
    if (!name.trim() || name.trim() === me.name) return;
    setBusy(true);
    try {
      await api.changeName(name.trim());
      toast('✓ 昵称已更新', 'success');
      onUpdated();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const savePw = async () => {
    if (newPw !== newPw2) return toast('两次输入的新密码不一致', 'error');
    setBusy(true);
    try {
      await api.changePassword(oldPw, newPw);
      setOldPw('');
      setNewPw('');
      setNewPw2('');
      toast('✓ 密码已修改', 'success');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="🪪 账号设置">
      <div className="space-y-5">
        <div>
          <p className="mb-2 text-xs font-semibold text-white/55">
            登录名 <span className="font-normal text-white/35">（不可修改）：{me.username ?? me.name}</span>
          </p>
          <label className="mb-1.5 block text-xs font-semibold text-white/55">昵称（牌桌显示名）</label>
          <div className="flex gap-2">
            <input
              className="input flex-1"
              maxLength={12}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <button className="btn-jade shrink-0 !px-4 text-xs" disabled={busy} onClick={saveName}>
              保存
            </button>
          </div>
        </div>

        <div className="border-t border-white/10 pt-4">
          <label className="mb-2 block text-xs font-semibold text-white/55">修改密码（需验证当前密码）</label>
          <input
            className="input mb-2"
            type="password"
            placeholder="当前密码"
            autoComplete="current-password"
            value={oldPw}
            onChange={(e) => setOldPw(e.target.value)}
          />
          <input
            className="input mb-2"
            type="password"
            placeholder="新密码（至少 8 位，含字母和数字）"
            autoComplete="new-password"
            value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
          />
          <input
            className="input mb-3"
            type="password"
            placeholder="确认新密码"
            autoComplete="new-password"
            value={newPw2}
            onChange={(e) => setNewPw2(e.target.value)}
          />
          <button className="btn-primary w-full" disabled={busy || !oldPw || !newPw} onClick={savePw}>
            确认修改密码
          </button>
          <p className="mt-2 text-[11px] text-white/35">忘记当前密码？请联系管理员在后台重置。</p>
        </div>
      </div>
    </Sheet>
  );
}
