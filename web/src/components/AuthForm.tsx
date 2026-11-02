import { useCallback, useEffect, useState } from 'react';
import { api, saveAuth, type AuthUser, type Captcha } from '../socket';
import { useApp } from '../App';

/** 登录 / 注册表单（含图形验证码；密码 ≥8 位且含字母和数字；改密可自助或联系管理员） */
export function AuthForm({
  onAuthed,
  note,
}: {
  onAuthed: (user: AuthUser) => void;
  note?: string;
}) {
  const { toast } = useApp();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [loginName, setLoginName] = useState('');
  const [name, setName] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [captchaText, setCaptchaText] = useState('');
  const [captcha, setCaptcha] = useState<Captcha | null>(null);
  const [busy, setBusy] = useState(false);

  const loadCaptcha = useCallback(() => {
    api
      .captcha()
      .then(setCaptcha)
      .catch(() => {});
    setCaptchaText('');
  }, []);

  useEffect(() => {
    loadCaptcha();
  }, [loadCaptcha, mode]);

  const submit = async () => {
    const ln = loginName.trim();
    if (!ln) return toast('请输入登录名', 'error');
    if (!captchaText.trim()) return toast('请输入验证码', 'error');
    if (mode === 'register') {
      if (!name.trim()) return toast('请输入昵称', 'error');
      if (pw !== pw2) return toast('两次输入的密码不一致', 'error');
    }
    setBusy(true);
    try {
      const r =
        mode === 'login'
          ? await api.login(ln, pw, captcha!.id, captchaText)
          : await api.register(ln, name.trim(), pw, captcha!.id, captchaText);
      saveAuth(r.token, r.user);
      onAuthed(r.user);
    } catch (e) {
      toast((e as Error).message, 'error');
      loadCaptcha(); // 失败换一张
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="mb-4 grid grid-cols-2 gap-2 rounded-xl bg-black/30 p-1">
        {(['login', 'register'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`min-h-[40px] rounded-lg text-sm font-bold transition ${
              mode === m ? 'bg-felt-600 text-white shadow' : 'text-white/60 hover:text-white'
            }`}
          >
            {m === 'login' ? '登录' : '注册'}
          </button>
        ))}
      </div>
      {note && <p className="mb-3 rounded-xl border border-gold/25 bg-gold/[0.06] px-3 py-2 text-xs text-gold">{note}</p>}

      <label className="mb-1.5 block text-xs font-semibold text-white/60">
        登录名 {mode === 'register' && <span className="font-normal text-white/35">（3-16 位字母/数字/下划线，注册后不可改）</span>}
      </label>
      <input
        className="input font-mono"
        placeholder={mode === 'register' ? '如 zhang_san' : '登录名'}
        maxLength={16}
        autoComplete="username"
        value={loginName}
        onChange={(e) => setLoginName(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
      />

      {mode === 'register' && (
        <>
          <label className="mb-1.5 mt-4 block text-xs font-semibold text-white/60">
            昵称 <span className="font-normal text-white/35">（牌桌显示名，2-12 位，可随时改）</span>
          </label>
          <input
            className="input"
            placeholder="牌桌上的外号"
            maxLength={12}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        </>
      )}

      <label className="mb-1.5 mt-4 block text-xs font-semibold text-white/60">
        密码 {mode === 'register' && <span className="font-normal text-white/35">（至少 8 位，需含字母和数字）</span>}
      </label>
      <input
        className="input"
        type="password"
        placeholder={mode === 'register' ? '至少 8 位，含字母和数字' : '密码'}
        maxLength={64}
        autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
        value={pw}
        onChange={(e) => setPw(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && mode === 'login' && submit()}
      />

      {mode === 'register' && (
        <>
          <label className="mb-1.5 mt-4 block text-xs font-semibold text-white/60">确认密码</label>
          <input
            className="input"
            type="password"
            placeholder="再输一遍"
            maxLength={64}
            autoComplete="new-password"
            value={pw2}
            onChange={(e) => setPw2(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        </>
      )}

      <label className="mb-1.5 mt-4 block text-xs font-semibold text-white/60">验证码</label>
      <div className="flex items-stretch gap-2">
        <input
          className="input flex-1 text-center text-lg font-black uppercase tracking-[0.3em]"
          placeholder="XXXX"
          maxLength={4}
          value={captchaText}
          onChange={(e) => setCaptchaText(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        <button
          type="button"
          onClick={loadCaptcha}
          title="点击刷新验证码"
          className="shrink-0 overflow-hidden rounded-xl border border-white/15 transition hover:border-gold/60"
          dangerouslySetInnerHTML={{ __html: captcha?.svg ?? '' }}
        />
      </div>
      <p className="mt-1.5 text-[11px] text-white/35">看不清？点击图片刷新</p>

      <button className="btn-primary mt-5 w-full !min-h-[48px] text-base" disabled={busy || !captcha} onClick={submit}>
        {busy ? '请稍候…' : mode === 'login' ? '登录' : '注册并进入'}
      </button>
    </div>
  );
}
