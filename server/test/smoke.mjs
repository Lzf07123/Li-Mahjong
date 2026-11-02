// 冒烟测试：模拟 4 个客户端完整打一场，验证核心链路
// 运行：docker compose -f docker-compose.dev.yml run --rm server node test/smoke.mjs
import { io } from 'socket.io-client';

const URL = process.env.TEST_URL || 'http://server:3000';
let passed = 0;

function assert(cond, msg) {
  if (!cond) throw new Error(`断言失败: ${msg}`);
  passed++;
  console.log(`  ✓ ${msg}`);
}

function connect() {
  const s = io(URL, { transports: ['websocket'], reconnection: false });
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('连接超时')), 8000);
    s.on('connect', () => { clearTimeout(t); resolve(s); });
    s.on('connect_error', (e) => { clearTimeout(t); reject(e); });
  });
}

function emit(socket, event, payload) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`ack 超时: ${event}`)), 6000);
    socket.emit(event, payload ?? {}, (resp) => { clearTimeout(t); resolve(resp); });
  });
}

// 每个客户端常驻监听 state，记录最新快照
const lastSnap = new Map();
function track(socket) {
  socket.on('state', (s) => lastSnap.set(socket, s));
  socket.on('gameEnded', () => lastSnap.delete(socket));
}
function revOf(socket) {
  return lastSnap.get(socket)?.rev ?? 0;
}
/** 等待某客户端收到 rev >= minRev 的快照 */
function waitRev(socket, minRev, timeout = 8000) {
  const cur = lastSnap.get(socket);
  if (cur && cur.rev >= minRev) return Promise.resolve(cur);
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { socket.off('state', h); reject(new Error('等待 state 超时')); }, timeout);
    const h = (snap) => {
      if (snap.rev < minRev) return; // 丢弃过期状态
      clearTimeout(t);
      socket.off('state', h);
      resolve(snap);
    };
    socket.on('state', h);
  });
}
/** 所有客户端推进到新状态 */
async function allRev(clients, baseRev) {
  return Promise.all(clients.map((c) => waitRev(c, baseRev + 1)));
}
/** 等待客户端收到满足条件的快照 */
function waitPred(socket, pred, timeout = 8000) {
  const cur = lastSnap.get(socket);
  if (cur && pred(cur)) return Promise.resolve(cur);
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { socket.off('state', h); reject(new Error('等待 state 超时')); }, timeout);
    const h = (snap) => {
      if (!pred(snap)) return;
      clearTimeout(t);
      socket.off('state', h);
      resolve(snap);
    };
    socket.on('state', h);
  });
}

async function main() {
  console.log(`▶ 冒烟测试目标: ${URL}\n`);

  const clients = await Promise.all([connect(), connect(), connect(), connect()]);
  clients.forEach(track);
  console.log('1) 建房与加入');

  const createResp = await emit(clients[0], 'room:create', { name: '小明' });
  assert(createResp.ok && /^[A-Z2-9]{4}$/.test(createResp.code), `创建房间 code=${createResp.code}`);
  const code = createResp.code;
  const myIds = [createResp.playerId];
  await waitRev(clients[0], 1);
  assert(lastSnap.get(clients[0]).players.length === 1, '房主进入大厅');

  for (let i = 1; i < 4; i++) {
    const base = revOf(clients[0]);
    const r = await emit(clients[i], 'room:join', { code, name: '玩家' + (i + 1) });
    assert(r.ok, `玩家${i + 1} 加入`);
    myIds.push(r.playerId);
    await waitRev(clients[0], base + 1);
  }
  assert(lastSnap.get(clients[0]).players.length === 4, '房间共 4 人');

  console.log('2) 开局与发牌');
  let base = Math.max(...clients.map(revOf));
  const startP = allRev(clients, base);
  const startResp = await emit(clients[0], 'game:start');
  assert(startResp.ok, '房主开局成功');
  const playingStates = await startP;
  assert(playingStates.every((s) => s.status === 'playing' && s.roundNo === 1), '进入第 1 局');
  for (let i = 0; i < 4; i++) {
    const mine = playingStates[i].players.find((p) => p.id === myIds[i]);
    assert(mine && mine.cardText && mine.cardText.length > 3, `玩家${i + 1} 可见自己的条件卡`);
    const others = playingStates[i].players.filter((p) => p.id !== myIds[i]);
    assert(others.every((p) => p.cardText === null), `玩家${i + 1} 看不到他人未亮牌`);
  }

  console.log('3) 记分与撤销');
  base = Math.max(...clients.map(revOf));
  const addP = allRev(clients, base);
  const addResp = await emit(clients[1], 'score:add', {
    fromIds: [myIds[2], myIds[3]],
    toId: myIds[1],
    amountTotal: 30,
    note: '自摸',
  });
  assert(addResp.ok, '记一笔：玩家3、玩家4 各付 15 给玩家2');
  const addStates = await addP;
  const sc = (states, i) => states[0].players.find((p) => p.id === myIds[i]).score;
  assert(sc(addStates, 1) === 30 && sc(addStates, 2) === -15 && sc(addStates, 3) === -15, '总分实时同步（+30/-15/-15）');
  assert(addStates[0].entries.length === 1 && addStates[0].entries[0].payers.length === 2, '流水含均分明细');

  base = Math.max(...clients.map(revOf));
  const undoP = allRev(clients, base);
  const undoResp = await emit(clients[1], 'score:undo', { entryId: addStates[0].entries[0].id });
  assert(undoResp.ok, '记账人撤销成功');
  const undoStates = await undoP;
  assert(undoStates[0].players.every((p) => p.score === 0), '撤销后分数归零');

  console.log('4) 亮牌 / 重摸 / 题库开关');
  base = Math.max(...clients.map(revOf));
  const revP = waitRev(clients[0], base + 1);
  const revResp = await emit(clients[1], 'game:reveal');
  assert(revResp.ok, '玩家2亮牌');
  const revState = await revP;
  const revealed = revState.players.find((p) => p.id === myIds[1]);
  assert(revealed.cardRevealed === true && revealed.cardText !== null, '房主可见亮出的牌');

  await emit(clients[0], 'library:setEnabled', { disabledCategoryIds: ['voice'] });
  base = Math.max(...clients.map(revOf));
  const redrawP = allRev(clients, base);
  const rr = await emit(clients[0], 'game:redrawAll');
  assert(rr.ok, '房主触发全员重摸');
  const redrawStates = await redrawP;
  assert(redrawStates[0].roundNo === 1, '全员重摸仍在当前局');

  console.log('5) 下一局');
  const nrP = Promise.all(clients.map((c) => waitPred(c, (s) => s.roundNo === 2)));
  const nrResp = await emit(clients[0], 'game:nextRound');
  assert(nrResp.ok, '进入下一局');
  const nrStates = await nrP;
  assert(nrStates.every((s) => s.roundNo === 2), '局数推进到 2');

  console.log('6) 方位自选与玩法开关');
  const conflict = await emit(clients[1], 'room:setSeat', { seat: '东' }); // 房主在东
  assert(!conflict.ok, '已被占用的方位被拒绝');
  const seatP = waitPred(clients[0], (s) => s.players.find((p) => p.id === myIds[1])?.seat === '白');
  const seatResp = await emit(clients[1], 'room:setSeat', { seat: '白' });
  assert(seatResp.ok, '空闲方位可选');
  await seatP;
  const bothOff = await emit(clients[0], 'room:setFeatures', { score: false, cards: false });
  assert(!bothOff.ok, '记分与条件卡同时关闭被拒绝');
  await emit(clients[0], 'room:setFeatures', { score: true, cards: false });
  const nr3P = Promise.all(clients.map((c) => waitPred(c, (s) => s.roundNo === 3 && s.features.cards === false)));
  await emit(clients[0], 'game:nextRound');
  const nr3 = await nr3P;
  assert(nr3.every((s) => s.players.every((p) => !p.hasCard)), '条件卡关闭后不再发牌');
  const addOk = await emit(clients[0], 'score:add', { fromIds: [myIds[1]], toId: myIds[0], amountTotal: 10 });
  assert(addOk.ok, '条件卡关闭时记分仍可用');
  await emit(clients[0], 'room:setFeatures', { score: false, cards: true });
  const scOff = await emit(clients[0], 'score:add', { fromIds: [myIds[1]], toId: myIds[0], amountTotal: 5 });
  assert(!scOff.ok, '记分关闭后记账被拒绝');
  await emit(clients[0], 'room:setFeatures', { score: true, cards: true });
  const rdP = Promise.all(clients.map((c) => waitPred(c, (s) => !!s.players.find((p) => p.id === myIds[2])?.hasCard)));
  const rd = await emit(clients[0], 'game:redrawAll');
  assert(rd.ok, '重新启用条件卡后全员重摸');
  await rdP;

  console.log('7) 记一笔记账后结束战局');
  base = Math.max(...clients.map(revOf));
  await emit(clients[0], 'score:add', { fromIds: [myIds[0]], toId: myIds[2], amountTotal: 88, note: '点炮' });
  await Promise.all(clients.map((c) => waitRev(c, base + 1))).catch(() => {});
  const endP = Promise.all(clients.map((c) => new Promise((resolve) => c.once('gameEnded', resolve))));
  const endResp = await emit(clients[0], 'game:end');
  assert(endResp.ok, '房主结束战局');
  const ended = await endP;
  assert(ended.length === 4 && ended[0].standings.length === 4, '全员收到结算 standings');

  console.log('8) 历史战绩 REST');
  const hist = await fetch(`${URL}/api/history`).then((r) => r.json());
  assert(hist.items.length >= 1, `历史列表 ${hist.items.length} 条`);
  const latest = hist.items[0];
  assert(latest.status === 'finished' && latest.players.length === 4, '最新战局已归档（finished, 4人）');
  const detail = await fetch(`${URL}/api/history/${latest.id}`).then((r) => r.json());
  assert(detail.entries.length === 2, `历史流水共 2 笔（10 分 + 88 分，实际 ${detail.entries.length}）`);
  assert(detail.entries.some((e) => e.amountTotal === 88), '历史流水含 88 分记账');
  const round1Draws = detail.draws.filter((d) => d.roundNo === 1);
  assert(round1Draws.length === 8, `第 1 局共 8 条抽卡记录（开局4 + 全员重摸4，实际 ${round1Draws.length}）`);
  const lastDeal = round1Draws.slice(-4);
  const uniq = new Set(lastDeal.map((d) => d.cardText));
  const uniqPlayers = new Set(lastDeal.map((d) => d.playerName));
  assert(uniq.size === 4 && uniqPlayers.size === 4, '重摸后 4 张条件卡互不重复、每人一张');
  const st = await fetch(`${URL}/api/stats`).then((r) => r.json());
  const sumAll = st.items.reduce((a, i) => a + i.total, 0);
  assert(sumAll === 0, `统计：所有人累计盈亏总和为 0（实际 ${sumAll}）`);
  const xm = st.items.find((i) => i.name === '小明');
  const p3 = st.items.find((i) => i.name === '玩家3');
  assert(xm && xm.total < 0 && p3 && p3.total > 0, `统计方向正确（小明 ${xm?.total} / 玩家3 ${p3?.total}，多轮累计）`);
  assert(xm.games === st.items.find((i) => i.name === '玩家2')?.games, '统计场次一致');

  clients.forEach((c) => c.disconnect());
  console.log(`\n✅ 全部通过: ${passed} 项断言`);
  process.exit(0);
}

main().catch((e) => {
  console.error(`\n❌ 冒烟测试失败: ${e.message}`);
  process.exit(1);
});
