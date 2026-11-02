// 第三轮验证：管理后台 / 欢迎回来 / 四方位
import puppeteer from 'puppeteer-core';

const BASE = 'http://localhost:5173';
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
    return { ok: document.documentElement.scrollWidth <= vw + 1 && bad === 0, vw, sw: document.documentElement.scrollWidth };
  });
  console.log(`  ${r.ok ? '✓' : '✗'} [${label}] vw=${r.vw} scrollW=${r.sw}`);
  return r.ok;
}

async function main() {
  console.log('▶ 第三轮可视化验证');
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium',
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-color-profile=srgb'],
  });
  let allOk = true;

  // A. 管理后台：登录 + 大盘 + 用户管理（手机 + 桌面）
  const ctx = await browser.createBrowserContext();
  const admin = await ctx.newPage();
  await admin.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await admin.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
  await sleep(600);
  await admin.type('input[placeholder="管理口令"]', 'admin123');
  await clickBtn(admin, '进入后台');
  await admin.waitForFunction(() => document.body.innerText.includes('数据') || document.body.innerText.includes('注册用户'), { timeout: 8000 });
  await sleep(800);
  await shot(admin, 'admin-mobile');
  allOk &= (await scanOverflow(admin, 'admin-390'));
  await admin.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await sleep(300);
  await shot(admin, 'admin-users');
  await admin.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  await sleep(600);
  await shot(admin, 'admin-desktop');
  allOk &= (await scanOverflow(admin, 'admin-1440'));

  // B. 首页欢迎回来（复用冒烟测试 uid）
  const ctx2 = await browser.createBrowserContext();
  const home = await ctx2.newPage();
  await home.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await home.evaluateOnNewDocument(() => localStorage.setItem('mj:uid', 'smoke-uid-host-0001'));
  await home.goto(BASE, { waitUntil: 'domcontentloaded' });
  await sleep(900);
  const hasChip = await home.evaluate(() => document.body.innerText.includes('本设备已记住你'));
  console.log(`  ${hasChip ? '✓' : '✗'} 首页"欢迎回来"档案条`);
  allOk &= hasChip;
  await shot(home, 'home-welcome');

  // C. 四方位选座
  await home.type('input[placeholder="牌桌上的外号"]', '老张');
  await clickBtn(home, '🎲 创建房间');
  await home.waitForFunction(() => /room=/.test(location.href), { timeout: 8000 });
  await sleep(700);
  await clickBtn(home, '换方位');
  await sleep(600);
  const seatInfo = await home.evaluate(() => {
    const t = document.body.innerText;
    return { four: ['东', '南', '西', '北'].every((s) => t.includes(s)), noZhong: !document.body.innerText.includes('中\n可选') };
  });
  console.log(`  ${seatInfo.four && seatInfo.noZhong ? '✓' : '✗'} 选座面板只有东南西北`);
  allOk &= seatInfo.four && seatInfo.noZhong;
  await shot(home, 'seat-picker-4');
  allOk &= (await scanOverflow(home, 'lobby-390'));
  await clickBtn(home, '关闭');

  await browser.close();
  console.log(allOk ? '\n✅ 第三轮验证通过' : '\n⚠️ 有问题，见日志');
  process.exit(allOk ? 0 : 1);
}

main().catch((e) => {
  console.error('\n❌ 验证失败:', e.message);
  process.exit(1);
});
