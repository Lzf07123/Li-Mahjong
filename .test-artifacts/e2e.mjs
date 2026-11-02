// E2E 可视化验证：两台"手机"+ 桌面三档视口
// 运行：docker exec mahjong-score-web-1 sh -c "cd /out && NODE_PATH=/pptr/node_modules node e2e.mjs"
import puppeteer from 'puppeteer-core';

const BASE = 'http://localhost:5173';
const OUT = '/out';
let step = 0;
const shot = async (page, name) => {
  step++;
  const id = String(step).padStart(2, '0');
  await page.screenshot({ path: `${OUT}/${id}-${name}.png` });
  console.log(`  📸 ${id}-${name}.png`);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 在页面里点击包含指定文本的按钮/可点元素（React 合成事件可接收 DOM click）
const clickBtn = (page, text, index = 0) =>
  page.evaluate(
    (t, i) => {
      const els = Array.from(document.querySelectorAll('button, p')).filter((b) => (b.textContent || '').includes(t));
      if (!els[i]) throw new Error(`element not found: ${t} (#${i})`);
      els[i].click();
      return els.map((b) => (b.textContent || '').slice(0, 12));
    },
    text,
    index,
  );

const bodyHas = (page, text) =>
  page.waitForFunction((t) => document.body.innerText.includes(t), { timeout: 8000 }, text);

async function newPage(browser, width, height) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 200)));
  await page.setViewport({ width, height, deviceScaleFactor: 2 });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await sleep(600);
  return page;
}

async function typeOrDie(page, selector, text, label) {
  try {
    await page.waitForSelector(selector, { timeout: 10000 });
    await page.type(selector, text);
  } catch (e) {
    const inputs = await page.evaluate(() => Array.from(document.querySelectorAll('input')).map((i) => i.placeholder));
    const body = await page.evaluate(() => document.body.innerText.slice(0, 250));
    throw new Error(`[${label}] selector 失败: ${selector}\n  inputs=${JSON.stringify(inputs)}\n  body=${body}`);
  }
}

async function main() {
  console.log('▶ E2E 可视化验证开始');
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium',
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-color-profile=srgb'],
  });

  // ============ A. 房主（手机 390x844）============
  const host = await newPage(browser, 390, 844);
  await shot(host, 'home-mobile');

  await host.type('input[placeholder="牌桌上的外号"]', '老张');
  await clickBtn(host, '🎲 创建房间');
  await host.waitForFunction(() => /room=/.test(location.href), { timeout: 8000 });
  const url = new URL(await host.url());
  const code = url.searchParams.get('room');
  console.log(`  房间码: ${code}`);
  await sleep(800);
  await shot(host, 'lobby-mobile');

  // ============ B. 玩家加入（第二台手机）============
  const p2 = await newPage(browser, 390, 844);
  await p2.goto(`${BASE}/?room=${code}`, { waitUntil: 'domcontentloaded' });
  await sleep(600);
  await typeOrDie(p2, 'input[placeholder="你的昵称"]', '老王', 'p2-join');
  await clickBtn(p2, '进入房间');
  await sleep(800);
  await shot(p2, 'lobby-player2');
  await bodyHas(host, '老王');
  console.log('  ✓ 房主端实时看到玩家加入');

  // 第三、四位玩家用接口直接加入（减少脚本时长）
  for (const name of ['小李', '阿美']) {
    const p = await newPage(browser, 390, 844);
    await p.goto(`${BASE}/?room=${code}`, { waitUntil: 'domcontentloaded' });
    await sleep(500);
    try {
      await typeOrDie(p, 'input[placeholder="你的昵称"]', name, name);
      await clickBtn(p, '进入房间');
      await sleep(700);
      const body = await p.evaluate(() => document.body.innerText.slice(0, 120).replace(/\n/g, '|'));
      console.log(`  [${name}] 页面状态: ${body}`);
      await p.close();
    } catch (e) {
      const body = await p.evaluate(() => document.body.innerText.slice(0, 250).replace(/\n/g, '|'));
      await p.close();
      throw new Error(`[${name}] 加入失败: ${e.message}\n  body=${body}`);
    }
  }
  try {
    await bodyHas(host, '阿美');
  } catch (e) {
    const diag = await host.evaluate(() => ({
      url: location.href,
      body: document.body.innerText.slice(0, 300).replace(/\n/g, '|'),
      socketState: (window.__sock && window.__sock.connected) ?? 'n/a',
    }));
    throw new Error(`房主端未收到阿美加入\n  ${JSON.stringify(diag)}`);
  }

  // ============ C. 开局发牌 ============
  await clickBtn(host, '开局！发条件卡');
  await bodyHas(host, '抽到条件卡');
  await sleep(900);
  await shot(host, 'draw-overlay'); // 翻卡动画后
  await clickBtn(host, '点击任意处关闭');
  await sleep(500);
  await shot(host, 'game-mobile-score-tab');
  await clickBtn(host, '我的卡');
  await sleep(400);
  await clickBtn(host, '记分');
  await clickBtn(p2, '点击任意处关闭');
  console.log('  ✓ 双端同时弹出条件卡');

  // ============ D. 记分 ============
  await clickBtn(p2, '我的卡');
  await sleep(300);
  await clickBtn(p2, '亮牌给全场');
  await bodyHas(host, '已亮牌');
  console.log('  ✓ 玩家2亮牌，房主端同步');

  await clickBtn(p2, '记分');
  await sleep(400);
  await clickBtn(p2, '老张'); // 付款方
  await clickBtn(p2, '小李', 1); // 收款方（第2处：收款行）
  await p2.type('input[type="number"]', '50');
  await p2.type('input[placeholder="备注（自摸 / 点炮 / 杠…）"]', '自摸');
  await shot(p2, 'score-form-filled');
  await clickBtn(p2, '确认记账');
  await bodyHas(p2, '记账成功');
  await bodyHas(host, '+50');
  console.log('  ✓ 记账实时同步到房主端');
  await clickBtn(p2, '流水');
  await sleep(400);
  await shot(p2, 'ledger-mobile');

  // 撤销
  await clickBtn(p2, '撤销');
  await bodyHas(p2, '已撤销');
  console.log('  ✓ 撤销成功');

  // ============ E. 房主管理 ============
  await clickBtn(host, '⚙️ 管理');
  await sleep(500);
  await shot(host, 'manage-sheet');
  await clickBtn(host, '题库管理');
  await sleep(800);
  await shot(host, 'library-sheet');
  // 关闭题库（题库打开时管理面板已卸载，页面上只有题库的"关闭"按钮）
  await clickBtn(host, '关闭');
  await sleep(400);
  // 全员重摸
  await clickBtn(host, '🔄 全员重摸');
  await bodyHas(host, '全员已重摸');
  await clickBtn(host, '点击任意处关闭');
  await sleep(400);
  try {
    await clickBtn(host, '关闭'); // 关闭管理面板（若已关闭则忽略）
  } catch {
    /* 已关闭 */
  }
  console.log('  ✓ 题库管理 + 全员重摸完成');

  // ============ F. 响应式三档 ============
  // 平板 768
  await host.setViewport({ width: 768, height: 1024, deviceScaleFactor: 2 });
  await sleep(700);
  await shot(host, 'game-tablet-768');
  // 桌面 1440
  await host.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  await sleep(900);
  await shot(host, 'game-desktop-1440');

  // 桌面首页
  const p3 = await newPage(browser, 1440, 900);
  await shot(p3, 'home-desktop');
  await p3.close();

  // 平板回手机验证手机三栏滚动正常
  await host.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await clickBtn(host, '流水');
  await sleep(400);

  // ============ G. 结束战局 → 战绩 ============
  await clickBtn(host, '⚙️ 管理');
  await sleep(400);
  await clickBtn(host, '🏁 结束战局');
  await sleep(300);
  await clickBtn(host, '再点一次确认');
  await bodyHas(host, '战局结束');
  console.log('  ✓ 战局结束并归档');
  await sleep(800);
  await shot(host, 'home-after-end');
  await clickBtn(host, '全部战绩');
  await sleep(800);
  await shot(host, 'history-list');
  await clickBtn(host, '🥇');
  await sleep(900);
  await shot(host, 'history-detail');

  await browser.close();
  console.log('\n✅ E2E 可视化验证完成');
}

main().catch((e) => {
  console.error('\n❌ E2E 失败:', e.stack || e.message);
  process.exit(1);
});
