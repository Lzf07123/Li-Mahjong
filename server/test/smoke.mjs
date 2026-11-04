// 冒烟测试：注册/登录 → 4人完整一场 → 用户档案/管理后台 → 观战模式
// 运行：docker compose -f docker-compose.dev.yml run --rm server node test/smoke.mjs
// 说明：请求携带 x-test-ratelimit 头（需服务端 ALLOW_TEST_CAPTCHA=1），不触发限流，可与 sec.mjs 连续运行
import { io } from 'socket.io-client';

const URL = process.env.TEST_URL || 'http://server:3000';
const ADMIN = { 'x-admin-token': process.env.ADMIN_TOKEN || 'admin123' };
const BYPASS = { 'x-test-captcha': '1', 'x-test-ratelimit': '1', 'content-type': 'application/json' };
let passed = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

const lastSnap = new Map();
function track(socket) {
  socket.on('state', (s) => lastSnap.set(socket, s));
  socket.on('gameEnded', () => lastSnap.delete(socket));
}
function revOf(socket) {
  return lastSnap.get(socket)?.rev ?? 0;
}
function waitRev(socket, minRev, timeout = 8000) {
  const cur = lastSnap.get(socket);
  if (cur && cur.rev >= minRev) return Promise.resolve(cur);
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { socket.off('state', h); reject(new Error('等待 state 超时')); }, timeout);
    const h = (snap) => {
      if (snap.rev < minRev) return;
      clearTimeout(t);
      socket.off('state', h);
      resolve(snap);
    };
    socket.on('state', h);
  });
}
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
async function allRev(clients, baseRev) {
  return Promise.all(clients.map((c) => waitRev(c, baseRev + 1)));
}

async function apiJson(path, opts = {}) {
  const res = await fetch(`${URL}${path}`, opts);
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function main() {
  console.log(`▶ 冒烟测试目标: ${URL}\n`);

  console.log('0) 注册与登录（登录名/昵称分离 + 图形验证码）');
  const cap = await apiJson('/api/captcha');
  assert(cap.status === 200 && cap.data.id && cap.data.svg.includes('<svg'), '验证码接口返回 SVG');
  const reg = async (loginName, name = loginName) => {
    for (const pw of ['pass1234', 'newpass88']) {
      const r = await apiJson('/api/auth/register', {
        method: 'POST',
        headers: { ...BYPASS },
        body: JSON.stringify({ loginName, name, password: 'pass1234' }),
      });
      if (r.status === 200) return r.data;
      const l = await apiJson('/api/auth/login', {
        method: 'POST',
        headers: { ...BYPASS },
        body: JSON.stringify({ loginName, password: pw }),
      });
      if (l.status === 200) return l.data;
    }
    throw new Error(`注册/登录失败 ${loginName}`);
  };
  const badCaptcha = await apiJson('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ loginName: 'test_nocap', name: '测试', password: 'pass1234', captchaId: 'x', captchaText: 'XXXX' }),
  });
  assert(badCaptcha.status === 400, `无验证码注册被拒（${badCaptcha.data.error}）`);
  const weakPw = await apiJson('/api/auth/register', {
    method: 'POST',
    headers: { ...BYPASS },
    body: JSON.stringify({ loginName: 'test_weakpw', name: '测试', password: 'abc123', captchaId: 'x', captchaText: 'X' }),
  });
  assert(weakPw.status === 400, `弱密码被拒（${weakPw.data.error}）`);
  const ming = await reg('xiaoming', '小明');
  assert(!!ming.token, '注册/登录 小明（登录名 xiaoming）');
  const badLogin = await apiJson('/api/auth/login', {
    method: 'POST',
    headers: { ...BYPASS },
    body: JSON.stringify({ loginName: 'xiaoming', password: 'wrong-wrong' }),
  });
  assert(badLogin.status === 401, '错误密码登录被拒');
  const players = [
    { name: '小明', token: ming.token, uid: ming.user.uid },
    { name: '玩家2', token: (await reg('wan2', '玩家2')).token, uid: null },
    { name: '玩家3', token: (await reg('san3', '玩家3')).token, uid: null },
    { name: '玩家4', token: (await reg('wan4', '玩家4')).token, uid: null },
  ];
  players[1].uid = (await apiJson('/api/me', { headers: { authorization: `Bearer ${players[1].token}` } })).data.uid;
  players[2].uid = (await apiJson('/api/me', { headers: { authorization: `Bearer ${players[2].token}` } })).data.uid;
  players[3].uid = (await apiJson('/api/me', { headers: { authorization: `Bearer ${players[3].token}` } })).data.uid;

  const clients = await Promise.all([connect(), connect(), connect(), connect()]);
  clients.forEach(track);
  console.log('1) 建房与加入');

  const createResp = await emit(clients[0], 'room:create', { token: players[0].token });
  assert(createResp.ok && /^[A-Z2-9]{4}$/.test(createResp.code), `创建房间 code=${createResp.code}`);
  const code = createResp.code;
  const aliveNow = await fetch(`${URL}/api/room/${code}/alive`).then((r) => r.json());
  assert(aliveNow.alive === true && aliveNow.status === 'lobby', '建房后房间存活查询（lobby）');
  const myIds = [createResp.playerId];
  await waitRev(clients[0], 1);
  assert(lastSnap.get(clients[0]).players.length === 1, '房主进入大厅');

  // 无 token 建房被拒
  const cNoAuth = new io(URL, { transports: ['websocket'], reconnection: false });
  await new Promise((r) => cNoAuth.on('connect', r));
  const noAuthResp = await emit(cNoAuth, 'room:create', {});
  assert(!noAuthResp.ok, `未登录建房被拒（${noAuthResp.error}）`);

  // 同账号再次加入 → 回合同一玩家
  const reb2 = await emit(cNoAuth, 'room:join', { code, token: players[0].token });
  assert(reb2.ok && reb2.playerId === createResp.playerId && reb2.rebound === true, '同账号加入回合同一玩家');
  await waitPred(clients[0], (s) => s.players.length === 1);
  cNoAuth.disconnect();
  await sleep(400); // 等 disconnect 在服务端生效
  // 断开测试连接后，用回合签发的新房间 token 恢复房主在线状态
  const rj = await emit(clients[0], 'room:rejoin', { code, token: reb2.token });
  if (!rj.ok) throw new Error('rejoin 失败: ' + rj.error);
  await waitPred(clients[0], (s) => s.players.find((p) => p.id === myIds[0])?.connected === true);

  for (let i = 1; i < 4; i++) {
    const r = await emit(clients[i], 'room:join', { code, token: players[i].token });
    assert(r.ok, `玩家${i + 1} 加入`);
    myIds.push(r.playerId);
    await waitPred(clients[0], (s) => s.players.length === i + 1);
  }
  assert(lastSnap.get(clients[0]).players.length === 4, '房间共 4 人');

  // 满员后第五人加入被拒
  const c5 = await connect();
  const t5 = (await reg('luren', '路人甲')).token;
  const full = await emit(c5, 'room:join', { code, token: t5 });
  assert(!full.ok, `满员加入被拒（${full.error}）`);
  c5.disconnect();

  console.log('2) 开局与发牌');
  const startP = Promise.all(clients.map((c) => waitPred(c, (s) => s.status === 'playing' && s.roundNo === 1)));
  const startResp = await emit(clients[0], 'game:start');
  assert(startResp.ok, '房主开局成功');
  const playingStates = await startP;
  for (let i = 0; i < 4; i++) {
    const mine = playingStates[i].players.find((p) => p.id === myIds[i]);
    assert(mine && mine.cardText && mine.cardText.length > 3, `玩家${i + 1} 可见自己的条件卡`);
    const others = playingStates[i].players.filter((p) => p.id !== myIds[i]);
    assert(others.every((p) => p.cardText === null), `玩家${i + 1} 看不到他人未亮牌`);
  }

  console.log('3) 记分与撤销');
  const addP = allRev(clients, Math.max(...clients.map(revOf)));
  const addResp = await emit(clients[1], 'score:add', { toId: myIds[2], amountTotal: 30, note: '点炮' });
  assert(addResp.ok, '记一笔：玩家2 付 30 给玩家3');
  const addStates = await addP;
  const sc = (states, i) => states[0].players.find((p) => p.id === myIds[i]).score;
  assert(sc(addStates, 1) === -30 && sc(addStates, 2) === 30, '总分实时同步（-30/+30）');

  // 撤销需双方确认且留痕：发起 → 分数冻结 → 对方确认 → 回滚并标记已撤销
  const reqP = allRev(clients, Math.max(...clients.map(revOf)));
  const reqResp = await emit(clients[1], 'score:undo', { entryId: addStates[0].entries[0].id });
  assert(reqResp.ok, '付款方发起撤销请求');
  const reqStates = await reqP;
  assert(!!reqStates[0].entries[0].undo && !reqStates[0].entries[0].undone, '流水留痕：撤销待确认');
  assert(sc(reqStates, 1) === -30 && sc(reqStates, 2) === 30, '请求阶段分数不变');

  const deny = await emit(clients[3], 'score:undo', { entryId: addStates[0].entries[0].id });
  assert(!deny.ok, '无关玩家不能发起或确认撤销');

  const okP = allRev(clients, Math.max(...clients.map(revOf)));
  const okResp = await emit(clients[2], 'score:undo', { entryId: addStates[0].entries[0].id });
  assert(okResp.ok, '收款方确认 → 撤销执行');
  const okStates = await okP;
  assert(okStates[0].entries[0].undone === true, '已撤销记录保留在流水');
  assert(okStates[0].players.every((p) => p.score === 0), '双方同意后分数归零');

  console.log('4) 亮牌 / 重摸 / 玩法开关 / 方位');
  const base1 = Math.max(...clients.map(revOf));
  const revP = waitRev(clients[0], base1 + 1);
  const revResp = await emit(clients[1], 'game:reveal');
  assert(revResp.ok, '玩家2亮牌');
  const revState = await revP;
  assert(revState.players.find((p) => p.id === myIds[1]).cardRevealed === true, '房主可见亮出的牌');

  const conflict = await emit(clients[1], 'room:setSeat', { seat: '东' });
  assert(!conflict.ok, '已被占用的方位被拒绝');
  const ownSeat = await emit(clients[1], 'room:setSeat', { seat: '南' });
  assert(ownSeat.ok, '重选自己当前方位允许');
  const invalidSeat = await emit(clients[1], 'room:setSeat', { seat: '中' });
  assert(!invalidSeat.ok, '超出东南西北的方位被拒绝');

  await emit(clients[0], 'library:setEnabled', { disabledCategoryIds: ['voice'] });
  const redrawP = allRev(clients, Math.max(...clients.map(revOf)));
  const rr = await emit(clients[0], 'game:redrawAll');
  assert(rr.ok, '房主触发全员重摸');
  await redrawP;

  console.log('5) 玩法开关');
  const bothOff = await emit(clients[0], 'room:setFeatures', { score: false, cards: false });
  assert(!bothOff.ok, '记分与条件卡同时关闭被拒绝');
  await emit(clients[0], 'room:setFeatures', { score: true, cards: false });
  const nr3P = Promise.all(clients.map((c) => waitPred(c, (s) => s.roundNo === 2 && s.features.cards === false)));
  const nrResp = await emit(clients[0], 'game:nextRound');
  assert(nrResp.ok, '进入下一局（无条件卡）');
  const nr3 = await nr3P;
  assert(nr3.every((s) => s.players.every((p) => !p.hasCard)), '条件卡关闭后不再发牌');
  const addOk = await emit(clients[0], 'score:add', { toId: myIds[1], amountTotal: 10 });
  assert(addOk.ok, '条件卡关闭时记分仍可用');
  await emit(clients[0], 'room:setFeatures', { score: false, cards: true });
  const scOff = await emit(clients[0], 'score:add', { toId: myIds[1], amountTotal: 5 });
  assert(!scOff.ok, '记分关闭后记账被拒');
  await emit(clients[0], 'room:setFeatures', { score: true, cards: true });
  const rdP = Promise.all(clients.map((c) => waitPred(c, (s) => !!s.players.find((p) => p.id === myIds[2])?.hasCard)));
  const rd = await emit(clients[0], 'game:redrawAll');
  assert(rd.ok, '重新启用条件卡后全员重摸');
  await rdP;

  console.log('6) 战局中离场与结束');
  // 玩家4 战局中途离开：分数照常归档，最终结算仍含此人
  const leaveP = allRev(clients.slice(0, 3), Math.max(...clients.slice(0, 3).map(revOf)));
  const leaveResp = await emit(clients[3], 'room:leave');
  assert(leaveResp.ok, '战局中玩家4 主动离开');
  const leaveStates = await leaveP;
  assert(leaveStates[0].players.length === 3, '离场后剩余 3 人');
  await emit(clients[0], 'score:add', { toId: myIds[2], amountTotal: 88, note: '点炮' });
  const endP = Promise.all(clients.slice(0, 3).map((c) => new Promise((resolve) => c.once('gameEnded', resolve))));
  const endResp = await emit(clients[0], 'game:end');
  assert(endResp.ok, '房主结束战局');
  const ended = await endP;
  assert(ended.length === 3 && ended[0].standings.length === 4, '在场玩家收到结算（含离场者 4 人名单）');

  console.log('6.5) 观战模式');
  const create2 = await emit(clients[0], 'room:create', { token: players[0].token });
  assert(create2.ok, '观战测试：房主再建一房');
  const code2 = create2.code;
  const specSock = await connect();
  track(specSock);
  const specJoin = await emit(specSock, 'room:join', { code: code2, token: t5, asSpectator: true });
  assert(specJoin.ok && specJoin.spectator === true, '观战者以旁观身份加入');
  await waitPred(clients[0], (s) => s.spectators.length === 1);
  assert(lastSnap.get(clients[0]).spectators[0].name === '路人甲', '房主可见观战名单');
  const specSnap = await waitPred(specSock, (s) => s.spectators.length === 1);
  assert(specSnap.players.length === 1, '观战快照包含玩家列表');
  const specAdd = await emit(specSock, 'score:add', { toId: 'x', amountTotal: 10 });
  assert(!specAdd.ok, '观战者不能记分');
  const specStart = await emit(specSock, 'game:start');
  assert(!specStart.ok, '观战者不能开局');
  const specKick = await emit(specSock, 'room:kick', { spectatorId: 'zzz' });
  assert(!specKick.ok, '观战者不能踢人');
  // 同账号重复观战 → 回合同一观战者
  const specSock2 = await connect();
  track(specSock2);
  const reSpec = await emit(specSock2, 'room:join', { code: code2, token: t5, asSpectator: true });
  assert(reSpec.ok && reSpec.spectator === true && reSpec.rebound === true, '同账号观战回合（rebound）');
  specSock2.disconnect();
  await waitPred(clients[0], (s) => s.spectators.length === 1 && s.spectators[0].connected === false);
  const specLeave = await emit(specSock, 'room:leave');
  assert(specLeave.ok, '观战者退出');
  await waitPred(clients[0], (s) => s.spectators.length === 0);
  specSock.disconnect();

  console.log('7) 历史战绩 REST（登录可见）');
  const anonHist = await fetch(`${URL}/api/history`);
  assert(anonHist.status === 401, '未登录访问历史列表被拒（401）');
  const anonStats = await fetch(`${URL}/api/stats`);
  assert(anonStats.status === 401, '未登录访问统计被拒（401）');
  const authB = { headers: { authorization: `Bearer ${players[0].token}` } };
  const hist = await fetch(`${URL}/api/history`, authB).then((r) => r.json());
  assert(hist.items.length >= 1, `历史列表 ${hist.items.length} 条`);
  const latest = hist.items[0];
  assert(latest.status === 'finished' && latest.players.length === 4, '最新战局已归档（finished, 4人）');
  const anonDetail = await fetch(`${URL}/api/history/${latest.id}`);
  assert(anonDetail.status === 401, '未登录访问战局详情被拒');
  const detail = await fetch(`${URL}/api/history/${latest.id}`, authB).then((r) => r.json());
  assert(detail.entries.length === 3, `历史流水共 3 笔（含撤销留痕，实际 ${detail.entries.length}）`);
  assert(detail.entries.some((e) => e.amountTotal === 88), '历史流水含 88 分记账');
  assert(detail.entries.some((e) => e.undone), '历史流水含已撤销留痕');
  assert(detail.players.some((p) => p.uid === players[0].uid), '归档玩家携带 uid');
  assert(detail.players.some((p) => p.seat === '北' && p.finalScore === 0), '战局中离场的玩家（北位）照常归档');
  const anonCsv = await fetch(`${URL}/api/history/${latest.id}/csv`);
  assert(anonCsv.status === 401, '未登录导出 CSV 被拒');
  const csv = await fetch(`${URL}/api/history/${latest.id}/csv`, authB);
  const csvText = await csv.text();
  assert(
    csv.status === 200 && (csv.headers.get('content-type') ?? '').includes('text/csv') && csvText.includes('88'),
    '登录后 CSV 导出成功且含流水',
  );
  const trend = await fetch(`${URL}/api/stats/trend?uid=${players[0].uid}`, authB).then((r) => r.json());
  assert(Array.isArray(trend.items) && trend.items.length >= 1, `个人盈亏趋势 ${trend.items.length} 场`);
  const aliveAfter = await fetch(`${URL}/api/room/${code}/alive`).then((r) => r.json());
  assert(aliveAfter.alive === false, '战局结束后房间存活查询 → false');

  console.log('8) 账号自助 / 管理后台 / 页脚设置');
  const auth0 = { ...BYPASS, authorization: `Bearer ${players[0].token}` };
  const me = await apiJson('/api/me', { headers: { authorization: `Bearer ${players[0].token}` } });
  assert(
    me.status === 200 && !!me.data.name && me.data.username === 'xiaoming' && me.data.games >= 1,
    `api/me 档案（昵称 ${me.data.name} / 登录名 ${me.data.username} / ${me.data.games} 场）`,
  );
  const noMe = await apiJson('/api/me');
  assert(noMe.status === 401, '未登录访问 /api/me 被拒');

  // 自助改昵称
  const cn = await apiJson('/api/auth/change-name', {
    method: 'POST',
    headers: auth0,
    body: JSON.stringify({ name: '小明哥' }),
  });
  assert(cn.status === 200, '自助修改昵称');
  const me2 = await apiJson('/api/me', { headers: { authorization: `Bearer ${players[0].token}` } });
  assert(me2.data.name === '小明哥' || me2.data.name === '小明', '昵称接口与登录名分离');

  // 自助改密码：旧密码错误被拒 → 正确改密 → 新密码可登录
  const badCp = await apiJson('/api/auth/change-password', {
    method: 'POST',
    headers: auth0,
    body: JSON.stringify({ oldPassword: 'wrong-pass1', newPassword: 'newpass99' }),
  });
  assert(badCp.status === 400, '旧密码错误时改密被拒');
  const cp = await apiJson('/api/auth/change-password', {
    method: 'POST',
    headers: auth0,
    body: JSON.stringify({ oldPassword: 'pass1234', newPassword: 'newpass99' }),
  });
  assert(cp.status === 200, '自助修改密码成功');
  const loginNew = await apiJson('/api/auth/login', {
    method: 'POST',
    headers: BYPASS,
    body: JSON.stringify({ loginName: 'xiaoming', password: 'newpass99' }),
  });
  assert(loginNew.status === 200, '新密码可登录');
  const loginOld = await apiJson('/api/auth/login', {
    method: 'POST',
    headers: BYPASS,
    body: JSON.stringify({ loginName: 'xiaoming', password: 'pass1234' }),
  });
  assert(loginOld.status === 401, '旧密码已失效');
  const cpBack = await apiJson('/api/auth/change-password', {
    method: 'POST',
    headers: { ...BYPASS, authorization: `Bearer ${loginNew.data.token}` },
    body: JSON.stringify({ oldPassword: 'newpass99', newPassword: 'pass1234' }),
  });
  assert(cpBack.status === 200, '改回原密码');

  const noAdmin = await apiJson('/api/admin/overview');
  assert(noAdmin.status === 401, '无口令访问管理 API 被拒');
  const ov = await apiJson('/api/admin/overview', { headers: ADMIN });
  assert(ov.status === 200 && ov.data.users >= 5 && ov.data.daily.length === 7, `管理大盘（${ov.data.users} 用户 / 7日曲线）`);
  const ul = await apiJson('/api/admin/users?query=wan4', { headers: ADMIN });
  const u4 = ul.data.items.find((u) => u.username === 'wan4');
  assert(!!u4, '管理后台按登录名搜索到用户');

  const rn = await apiJson(`/api/admin/users/${u4.uid}`, {
    method: 'PATCH',
    headers: { ...ADMIN, 'content-type': 'application/json' },
    body: JSON.stringify({ name: '玩家四儿' }),
  });
  assert(rn.status === 200, '管理后台改昵称成功');

  const reset = await apiJson(`/api/admin/users/${u4.uid}/password`, {
    method: 'PUT',
    headers: { ...ADMIN, 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'newpass88' }),
  });
  assert(reset.status === 200, '管理后台重置密码');
  const oldPw = await apiJson('/api/auth/login', {
    method: 'POST',
    headers: BYPASS,
    body: JSON.stringify({ loginName: 'wan4', password: 'pass1234' }),
  });
  assert(oldPw.status === 401, '重置后旧密码失效');
  const newPw = await apiJson('/api/auth/login', {
    method: 'POST',
    headers: BYPASS,
    body: JSON.stringify({ loginName: 'wan4', password: 'newpass88' }),
  });
  assert(newPw.status === 200, '新密码可登录');

  const sf = await apiJson('/api/admin/settings', {
    method: 'PUT',
    headers: { ...ADMIN, 'content-type': 'application/json' },
    body: JSON.stringify({ github: 'https://github.com/example/mahjong-score', text: '牌友快乐屋 · 请理性游戏' }),
  });
  assert(sf.status === 200 && sf.data.settings.github.includes('github.com'), '管理后台保存页脚');
  const gf = await fetch(`${URL}/api/settings`).then((r) => r.json());
  assert(gf.github.includes('github.com') && gf.text.includes('牌友快乐屋'), '公开 settings 返回页脚内容');

  clients.forEach((c) => c.disconnect());
  console.log(`\n✅ 全部通过: ${passed} 项断言`);
  process.exit(0);
}

main().catch((e) => {
  console.error(`\n❌ 冒烟测试失败: ${e.message}`);
  process.exit(1);
});
