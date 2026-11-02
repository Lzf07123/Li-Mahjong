// 第四轮验证：注册登录体系 / 页脚设置 / 账号设置（注册走 API + 注入会话，规避图形验证码）
import puppeteer from 'puppeteer-core';

const BASE = 'http://localhost:5173';
const API = 'http://server:3000';
const OUT = '/out';
let step = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (page, name) => {
  step++;
  await page.screenshot({ path: `${OUT}/${String(step).padStart(2, '0')}-${name}.png` });
  console.log(`  📸 ${String(step).padStart(2, '0')}-${name}.png`);
};
const clickBtn = (page, text, index = 0) =>
  page.evaluate(
    (t, i) => {
      const els = Array.from(document.querySelectorAll('button, p')).filter((b) => (b.textContent || '').includes(t));
      if (!els[i]) throw new Error(`element not found: ${t} (#${i})`);
      els[i].click();
    },
    text,
    index,
  );

async function ensureUser(loginName, name) {
  const reg = await fetch(`${API}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-test-captcha': '1' },
    body: JSON.stringify({ loginName, name, password: 'pass1234' }),
  });
  const j = await reg.json();
  if (j.token) return j;
  const login = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-test-captcha': '1' },
    body: JSON.stringify({ loginName, password: 'pass1234' }),
  });
  const lj = await login.json();
  if (!lj.token) throw new Error(`无法获得会话 ${loginName}: ${lj.error}`);
  return lj;
}

function injectAuth(user, token) {
  return `localStorage.setItem('mj:auth', JSON.stringify({ token: ${JSON.stringify(token)}, user: ${JSON.stringify(user)} }))`;
}

async function scanOverflow(page, label) {
  const r = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const clipped = (el) => {
      for (let a = el.parentElement; a; a = a.parentElement) {
        const o = getComputedStyle(a).overflowX;
        if (o !== 'visible') return true;
      }
      return false;
    };
    let bad = 0;
    for (const el of document.querySelectorAll('*')) {
      const b = el.getBoundingClientRect();
      if (b.width > 0 && (b.right > vw + 1 || b.left < -1) && !clipped(el)) bad++;
    }
    return { ok: document.documentElement.scrollWidth <= vw + 1 && bad === 0 };
  });
  console.log(`  ${r.ok ? '✓' : '✗'} [${label}] 无溢出`);
  return r.ok;
}

async function main() {
  console.log('▶ 第四轮可视化验证');
  // 预置页脚 + 两个账号
  const put = await fetch(`${API}/api/admin/settings`, {
    method: 'PUT',
    headers: { 'x-admin-token': 'admin123', 'content-type': 'application/json' },
    body: JSON.stringify({ github: 'https://github.com/example/mahjong-score', text: '牌友快乐屋 · 小赌怡情' }),
  });
  console.log(`  ${put.ok ? '✓' : '✗'} 管理 API 预置页脚内容`);
  const a = await ensureUser('user_a', '用户甲');
  const b = await ensureUser('user_b', '用户乙');

  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium',
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-color-profile=srgb'],
  });
  let allOk = true;

  // A. 未登录首页：登录表单 + 图形验证码
  const ctx0 = await browser.createBrowserContext();
  const anon = await ctx0.newPage();
  await anon.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await anon.goto(BASE, { waitUntil: 'domcontentloaded' });
  await sleep(700);
  const hasCaptcha = await anon.evaluate(() => !!document.querySelector('svg'));
  console.log(`  ${hasCaptcha ? '✓' : '✗'} 登录表单含图形验证码`);
  allOk &= hasCaptcha;
  await shot(anon, 'home-login-captcha');

  // B. 已登录首页 + 页脚 + 创建房间
  const ctxA = await browser.createBrowserContext();
  const host = await ctxA.newPage();
  await host.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await host.evaluateOnNewDocument(injectAuth(a.user, a.token));
  await host.goto(BASE, { waitUntil: 'domcontentloaded' });
  await sleep(800);
  const loggedIn = await host.evaluate(() => document.body.innerText.includes('退出登录'));
  console.log(`  ${loggedIn ? '✓' : '✗'} 注入会话后为登录态`);
  allOk &= loggedIn;
  const footerOk = await host.evaluate(() => {
    const t = document.body.innerText;
    return t.includes('GitHub') && t.includes('牌友快乐屋');
  });
  console.log(`  ${footerOk ? '✓' : '✗'} 页脚显示 GitHub 链接与自定义文字`);
  allOk &= footerOk;
  await shot(host, 'home-loggedin-footer');
  allOk &= (await scanOverflow(host, 'home-390'));

  // 账号设置面板
  await clickBtn(host, '账号设置');
  await sleep(600);
  const profOk = await host.evaluate(() => document.body.innerText.includes('登录名') && document.body.innerText.includes('修改密码'));
  console.log(`  ${profOk ? '✓' : '✗'} 账号设置面板（昵称/改密）`);
  allOk &= profOk;
  await shot(host, 'profile-sheet');
  await clickBtn(host, '关闭');
  await sleep(300);

  await clickBtn(host, '🎲 创建房间');
  await host.waitForFunction(() => /room=/.test(location.href), { timeout: 8000 });
  const code = new URL(await host.url()).searchParams.get('room');
  await sleep(600);
  await shot(host, 'lobby-authed');

  // C. 玩家扫码 → 已注入会话自动加入
  const ctxB = await browser.createBrowserContext();
  const p2 = await ctxB.newPage();
  await p2.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await p2.evaluateOnNewDocument(injectAuth(b.user, b.token));
  await p2.goto(`${BASE}/?room=${code}`, { waitUntil: 'domcontentloaded' });
  await p2.waitForFunction(() => document.body.innerText.includes('用户甲') && document.body.innerText.includes('用户乙'), { timeout: 10000 });
  await sleep(500);
  console.log('  ✓ 已登录玩家扫码自动加入');
  await shot(p2, 'lobby-two-players');
  allOk &= (await scanOverflow(p2, 'lobby-390'));

  // D. 管理后台：页脚设置 + 重置密码按钮
  const ctxC = await browser.createBrowserContext();
  const admin = await ctxC.newPage();
  await admin.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await admin.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
  await sleep(500);
  await admin.type('input[placeholder="管理口令"]', 'admin123');
  await clickBtn(admin, '进入后台');
  await admin.waitForFunction(() => document.body.innerText.includes('页脚设置'), { timeout: 8000 });
  await admin.evaluate(() => {
    const el = Array.from(document.querySelectorAll('h2')).find((h) => h.textContent.includes('页脚设置'));
    el?.scrollIntoView({ block: 'center' });
  });
  await sleep(400);
  await shot(admin, 'admin-footer-settings');
  const hasResetBtn = await admin.evaluate(() => document.body.innerText.includes('重置密码'));
  console.log(`  ${hasResetBtn ? '✓' : '✗'} 用户行含「重置密码」`);
  allOk &= hasResetBtn;
  allOk &= (await scanOverflow(admin, 'admin-390'));

  await browser.close();
  console.log(allOk ? '\n✅ 第四轮验证通过' : '\n⚠️ 有问题，见日志');
  process.exit(allOk ? 0 : 1);
}

main().catch((e) => {
  console.error('\n❌ 验证失败:', e.message);
  process.exit(1);
});
