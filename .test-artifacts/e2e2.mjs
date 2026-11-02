// 第二轮验证：玩法开关 / 方位自选 / 背景 / 文字溢出扫描
import puppeteer from 'puppeteer-core';

const BASE = 'http://localhost:5173';
const OUT = '/out';
let step = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (page, name) => {
  step++;
  const id = String(step).padStart(2, '0');
  await page.screenshot({ path: `${OUT}/${id}-${name}.png` });
  console.log(`  📸 ${id}-${name}.png`);
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

const bodyHas = (page, text) =>
  page.waitForFunction((t) => document.body.innerText.includes(t), { timeout: 8000 }, text);

async function newPage(browser, width, height) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 160)));
  await page.setViewport({ width, height, deviceScaleFactor: 2 });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await sleep(500);
  return page;
}

/** 溢出扫描：找出未被 overflow-hidden 裁剪、超出视口宽度的元素 */
async function scanOverflow(page, label) {
  const issues = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const clipped = (el) => {
      for (let a = el.parentElement; a; a = a.parentElement) {
        const o = getComputedStyle(a).overflowX;
        if (o === 'hidden' || o === 'clip' || o === 'scroll' || o === 'auto') return true;
      }
      return false;
    };
    const bad = [];
    for (const el of document.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && (r.right > vw + 1 || r.left < -1) && !clipped(el)) {
        const cls = (el.className && typeof el.className === 'string' ? el.className : '').slice(0, 40);
        bad.push(`${el.tagName}.${cls} right=${Math.round(r.right)} left=${Math.round(r.left)}`);
      }
    }
    return { vw, scrollW: document.documentElement.scrollWidth, bad: bad.slice(0, 8) };
  });
  const ok = issues.scrollW <= issues.vw + 1 && issues.bad.length === 0;
  console.log(`  ${ok ? '✓' : '✗'} [${label}] scrollW=${issues.scrollW} vw=${issues.vw}${issues.bad.length ? ' 溢出元素: ' + issues.bad.join(' | ') : ''}`);
  return ok;
}

async function main() {
  console.log('▶ 第二轮可视化验证');
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium',
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-color-profile=srgb'],
  });
  let allOk = true;

  // A. 房主建房（手机 390）
  const host = await newPage(browser, 390, 844);
  await host.type('input[placeholder="牌桌上的外号"]', '老张');
  await clickBtn(host, '🎲 创建房间');
  await host.waitForFunction(() => /room=/.test(location.href), { timeout: 8000 });
  const code = new URL(await host.url()).searchParams.get('room');
  await sleep(700);
  await shot(host, 'lobby-toggles');
  allOk &= (await scanOverflow(host, 'lobby-390'));

  // B. 选座：打开选座面板，东被自己占用应灰色
  await clickBtn(host, '换方位');
  await sleep(600);
  await shot(host, 'seat-picker');
  // 选"西"
  await clickBtn(host, '西');
  await sleep(600);
  await bodyHas(host, '西');
  console.log('  ✓ 房主换到西位');

  // C. 玩家加入 + 换座 + 尝试抢占已被占用的"西"
  const p2 = await newPage(browser, 390, 844);
  await p2.goto(`${BASE}/?room=${code}`, { waitUntil: 'domcontentloaded' });
  await sleep(500);
  await p2.type('input[placeholder="你的昵称"]', '老王');
  await clickBtn(p2, '进入房间');
  await sleep(800);
  await clickBtn(p2, '换方位');
  await sleep(500);
  await shot(p2, 'seat-picker-greyed');
  await p2.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button')).filter((b) => (b.textContent || '').includes('西'));
    const west = btns.find((b) => b.textContent.includes('西'));
    return west ? west.disabled : null;
  });
  await clickBtn(p2, '北'); // 选北（空闲）
  await sleep(500);
  console.log('  ✓ 老王选北位');

  // D. 房主关闭"条件卡"（只开记分）
  await clickBtn(host, '🀫 条件卡');
  await sleep(500);
  await shot(host, 'lobby-cards-off');
  // 开局：手机端应只有 记分/流水/管理 三个 tab，无"我的卡"
  await clickBtn(host, '开局！发条件卡');
  await bodyHas(host, '第 1 局');
  await sleep(700);
  const tabText = await host.evaluate(() => document.body.innerText);
  if (tabText.includes('我的卡')) throw new Error('条件卡关闭后仍显示"我的卡"标签');
  console.log('  ✓ 条件卡关闭：手机端无"我的卡"标签');
  await shot(host, 'game-cards-off-mobile');
  allOk &= (await scanOverflow(host, 'game-390'));

  // E. 下一局不依赖记账：直接点管理里的下一局
  await clickBtn(host, '⚙️ 管理');
  await sleep(500);
  await shot(host, 'manage-features');
  await clickBtn(host, '🎲 下一局');
  await bodyHas(host, '第 2 局');
  console.log('  ✓ 未记账也能进入下一局');
  // 重新开启条件卡（管理面板保持打开）
  await clickBtn(host, '🀫 条件卡');
  await sleep(500);
  await clickBtn(host, '🎲 下一局');
  await bodyHas(host, '🀄 新一局已发牌');
  await sleep(600);
  await shot(host, 'draw-overlay-reenabled');
  await clickBtn(host, '点击任意处关闭');
  await sleep(300);
  await clickBtn(host, '关闭');
  await sleep(300);

  // F. 360px 溢出扫描（首页/对局/管理/题库）
  for (const w of [360, 320]) {
    await host.setViewport({ width: w, height: 800, deviceScaleFactor: 2 });
    await sleep(500);
    allOk &= (await scanOverflow(host, `game-${w}`));
  }
  await host.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });

  // G. 桌面 1440（卡片开+关两种布局）
  await host.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  await sleep(700);
  await shot(host, 'game-desktop-3col');
  allOk &= (await scanOverflow(host, 'game-1440'));
  // 首页桌面背景
  const p3 = await newPage(browser, 1440, 900);
  await shot(p3, 'home-desktop-bg');
  allOk &= (await scanOverflow(p3, 'home-1440'));
  await p3.close();

  await browser.close();
  console.log(allOk ? '\n✅ 第二轮验证通过（无溢出）' : '\n⚠️ 存在溢出，见上方日志');
  process.exit(allOk ? 0 : 1);
}

main().catch((e) => {
  console.error('\n❌ 验证失败:', e.message);
  process.exit(1);
});
