// 安全测试：未授权 / 越权 / 输入校验 / 滥用路径 / 响应头
// 运行：docker compose -f docker-compose.dev.yml run --rm server node test/sec.mjs
// 常规请求携带 x-test-ratelimit 头（需服务端 ALLOW_TEST_CAPTCHA=1）跳过限流；
// 仅最后的限流测试用 postRaw 不带该头真实触发 429，跑完无需重启容器即可运行 smoke
import { io } from 'socket.io-client';

const URL = process.env.TEST_URL || 'http://server:3000';
const ADMIN = { 'x-admin-token': process.env.ADMIN_TOKEN || 'admin123' };
const BYPASS = { 'content-type': 'application/json', 'x-test-captcha': '1', 'x-test-ratelimit': '1' };
// 开发库预置的演示账号（小张/小李），供凑满 4 人房间等场景复用
const MJ_DEMO = [
  '089025fa-5957-40b9-b9b0-895ec64a06d9348709b057254740aaf874a2988f4eba',
  '5ed28825-4968-464b-8c1b-83e8e1d16870b490d24d45ad4f9db2a107e9889420f5',
];
let passed = 0;

function assert(cond, msg) {
  if (!cond) throw new Error(`安全断言失败: ${msg}`);
  passed++;
  console.log(`  ✓ ${msg}`);
}

async function api(path, opts = {}) {
  const res = await fetch(`${URL}${path}`, opts);
  const data = await res.json().catch(() => ({}));
  return { status: res.status, headers: res.headers, data };
}
// 带 bypass（模拟测试环境跳过验证码与限流）
const post = (path, body, headers = {}) =>
  api(path, { method: 'POST', headers: { ...BYPASS, ...headers }, body: JSON.stringify(body) });
// 不带 bypass（模拟真实浏览器：验证码必须强制校验、限流真实生效）
const postRaw = (path, body) =>
  api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

function emit(s, ev, payload) {
  return new Promise((res) => s.emit(ev, payload ?? {}, (r) => res(r)));
}
function connect() {
  const s = io(URL, { transports: ['websocket'], reconnection: false });
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('连接超时')), 8000);
    s.on('connect', () => { clearTimeout(t); resolve(s); });
    s.on('connect_error', (e) => { clearTimeout(t); reject(e); });
  });
}

/** 等待满足条件的 state 广播（服务端先回 ack 再广播，内容过滤可避开竞态） */
function waitState(s, pred, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      s.off('state', h);
      reject(new Error('未等到期望状态'));
    }, timeoutMs);
    const h = (st) => {
      if (pred(st)) {
        clearTimeout(t);
        s.off('state', h);
        resolve(st);
      }
    };
    s.on('state', h);
  });
}

async function main() {
  console.log(`▶ 安全测试目标: ${URL}\n`);

  // 1) 认证边界
  let r = await api('/api/me');
  assert(r.status === 401, '未登录访问 /api/me → 401');
  r = await api('/api/me', { headers: { authorization: 'Bearer forged-token-123' } });
  assert(r.status === 401, '伪造会话 token → 401');
  r = await api('/api/admin/overview');
  assert(r.status === 401, '无口令访问管理 API → 401');
  r = await api('/api/admin/overview', { headers: { 'x-admin-token': 'admin124' } });
  assert(r.status === 401, '错误口令访问管理 API → 401');
  r = await api('/api/admin/users/whatever', { method: 'DELETE', headers: ADMIN });
  assert(r.status === 404, '删除不存在用户 → 404（需口令）');
  r = await api('/api/history');
  assert(r.status === 401, '未登录访问历史战绩 → 401');
  r = await api('/api/history/1');
  assert(r.status === 401, '未登录访问战局详情 → 401');
  r = await api('/api/history/1/csv');
  assert(r.status === 401, '未登录导出 CSV → 401');
  r = await api('/api/stats');
  assert(r.status === 401, '未登录访问统计 → 401');
  r = await api('/api/stats/trend?uid=x');
  assert(r.status === 401, '未登录访问个人趋势 → 401');
  r = await api('/api/history', { headers: { authorization: 'Bearer forged-token-123' } });
  assert(r.status === 401, '伪造会话访问历史战绩 → 401');

  // 2) 验证码强制 + 输入校验
  r = await postRaw('/api/auth/register', { loginName: 'sec_test1', name: '安全测试', password: 'pass1234' });
  assert(r.status === 400, '无验证码注册 → 400');
  r = await postRaw('/api/auth/register', {
    loginName: 'sec_test1', name: '安全测试', password: 'pass1234', captchaId: 'fake', captchaText: 'AAAA',
  });
  assert(r.status === 400, '假验证码注册 → 400');
  r = await post('/api/auth/register', {
    loginName: 'sec_test2', name: '安全测试', password: 'short12', captchaId: 'x', captchaText: 'x',
  });
  assert(r.status === 400, '7 位密码 → 400');
  r = await post('/api/auth/register', {
    loginName: 'sec_test3', name: '安全测试', password: 'allletters', captchaId: 'x', captchaText: 'x',
  });
  assert(r.status === 400, '纯字母密码 → 400');
  r = await post('/api/auth/register', {
    loginName: '中文登录名', name: '安全测试', password: 'pass1234', captchaId: 'x', captchaText: 'x',
  });
  assert(r.status === 400, '中文登录名 → 400');
  r = await post('/api/auth/register', {
    loginName: "'; DROP TABLE users;--", name: '安全测试', password: 'pass1234', captchaId: 'x', captchaText: 'x',
  });
  assert(r.status === 400, 'SQL 注入形态登录名 → 400（参数化查询）');
  const ensure = async (loginName, name) => {
    const reg = await post('/api/auth/register', { loginName, name, password: 'pass1234', captchaId: 'x', captchaText: 'x' });
    if (reg.status === 200) return reg.data;
    const l = await post('/api/auth/login', { loginName, password: 'pass1234' });
    if (l.status !== 200) throw new Error(`ensure 失败 ${loginName}`);
    // 历史测试可能改过昵称（改名联动用例中断未恢复）：归位，保证后续用例按昵称查找玩家
    if (l.data.user.name !== name) {
      await api('/api/auth/change-name', {
        method: 'POST',
        headers: { ...BYPASS, authorization: `Bearer ${l.data.token}` },
        body: JSON.stringify({ name }),
      });
      l.data.user.name = name;
    }
    return l.data;
  };
  const me = await ensure('sec_user', '安全测试');
  r = await post('/api/auth/register', {
    loginName: 'sec_user', name: '安全测试', password: 'pass1234', captchaId: 'x', captchaText: 'x',
  });
  assert(r.status === 409, '重复登录名 → 409');

  // 3) 越权：两用户房间内操作
  const s1 = await connect();
  const s2 = await connect();
  const c = await emit(s1, 'room:create', { token: me.token });
  assert(c.ok, '建房成功');
  const u2 = await ensure('sec_user2', '安全对手');
  await emit(s2, 'room:join', { code: c.code, token: u2.token });
  r = await emit(s2, 'room:kick', { playerId: 'x' });
  assert(!r.ok, '非房主踢人 → 拒绝');
  r = await emit(s2, 'game:start');
  assert(!r.ok, '非房主开局 → 拒绝');
  r = await emit(s2, 'room:setFeatures', { score: true, cards: false });
  assert(!r.ok, '非房主改玩法开关 → 拒绝');
  r = await emit(s2, 'library:addCustom', { text: 'x', category: 'global' });
  assert(!r.ok, '非房主改题库 → 拒绝');
  const stP = new Promise((res) => s2.once('state', res));
  await emit(s1, 'game:start');
  const st = await stP;
  const ids = st.players.map((p) => p.id);
  r = await emit(s2, 'score:add', { fromIds: [ids[0]], toId: ids[1], amountTotal: 2000000 });
  assert(!r.ok, '单笔分数超上限 → 拒绝');
  r = await emit(s2, 'score:add', { fromIds: [ids[1]], toId: ids[1], amountTotal: 10 });
  assert(!r.ok, '自己付给自己 → 拒绝');
  const entryP = new Promise((res) => s1.once('state', res));
  const add = await emit(s1, 'score:add', { fromIds: [ids[0]], toId: ids[1], amountTotal: 10, note: 'x' });
  assert(add.ok, '房主正常记账');
  const st2 = await entryP;
  // 伪造付款方：即使请求里带上别人的 fromIds，付款方也强制为记账人本人
  const fakeP = new Promise((res) => s1.once('state', res));
  r = await emit(s2, 'score:add', { fromIds: [ids[0]], toId: ids[0], amountTotal: 7 });
  assert(r.ok, '试图替他人付分 → 请求受理但付款方为本人');
  const fakeSt = await fakeP;
  const hostScore = fakeSt.players.find((p) => p.id === ids[0]).score;
  const selfScore = fakeSt.players.find((p) => p.id === ids[1]).score;
  assert(hostScore === -3 && selfScore === 3, '伪造 fromIds 被忽略：房主只收不付，本人扣自己的分');
  // 撤销需双方确认：收款方可发起请求（分数不动），付款方确认后才回滚并留痕
  r = await emit(s2, 'score:undo', { entryId: st2.entries[0].id });
  assert(r.ok, '收款方发起撤销请求 → 受理');
  r = await emit(s2, 'score:undo', { entryId: st2.entries[0].id });
  assert(r.ok, '发起人再次点击 → 取消请求');
  await emit(s2, 'score:undo', { entryId: st2.entries[0].id }); // 重新发起
  // 广播与 ack 存在竞态，轮询等待撤销生效的状态
  const undoSt = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('未等到撤销生效状态')), 6000);
    const handler = (st) => {
      const e = (st.entries ?? []).find((x) => x.id === st2.entries[0].id);
      if (e?.undone) {
        clearTimeout(timer);
        s1.off('state', handler);
        resolve(st);
      }
    };
    s1.on('state', handler);
    emit(s1, 'score:undo', { entryId: st2.entries[0].id })
      .then((rr) => assert(rr.ok, '付款方确认 → 撤销执行'))
      .catch((e) => { clearTimeout(timer); reject(e); });
  });
  const undoneEntry = undoSt.entries.find((x) => x.id === st2.entries[0].id);
  assert(undoneEntry?.undone === true, '撤销留痕：记录标记已撤销');
  const hs2 = undoSt.players.find((p) => p.id === ids[0]).score;
  const ss2 = undoSt.players.find((p) => p.id === ids[1]).score;
  assert(hs2 === 7 && ss2 === -7, '双方同意后分数回滚（+7/-7）');
  r = await emit(s2, 'game:redrawOne', { playerId: ids[0] });
  assert(!r.ok, '非房主重摸他人 → 拒绝');
  s1.disconnect();
  s2.disconnect();

  // 3.4b) 健壮性：重复开局拒绝 + 付款方离场后撤销仍守恒
  {
    const sA = await connect();
    const sB = await connect();
    const cRb = await emit(sA, 'room:create', { token: me.token });
    assert(cRb.ok, '守恒测试：建房成功');
    const uRb = await ensure('sec_user2', '安全对手');
    await emit(sB, 'room:join', { code: cRb.code, token: uRb.token });
    // 注意：服务端先回 ack 再广播，等待必须按内容过滤（once 会捕获到旧广播）
    const stRbP = waitState(sA, (st) => st.status === 'playing');
    await emit(sA, 'game:start');
    const stRb = await stRbP;
    const ov0 = await api('/api/admin/overview', { headers: ADMIN });
    r = await emit(sA, 'game:start'); // playing 状态重复开局
    assert(!r.ok, 'playing 状态重复开局 → 拒绝');
    const ov1 = await api('/api/admin/overview', { headers: ADMIN });
    assert(ov1.data.gamesLive === ov0.data.gamesLive, '重复开局不再产生僵尸 live 游戏');
    // 记账 10 分：房主(付款方) → 安全对手(收款方)
    const idPayer = stRb.players.find((p) => p.name === '安全测试').id;
    const idReceiver = stRb.players.find((p) => p.name === '安全对手').id;
    const st2RbP = waitState(sA, (st) => st.entries.some((e) => !e.undone));
    await emit(sA, 'score:add', { toId: idReceiver, amountTotal: 10, note: '' });
    const st2Rb = await st2RbP;
    const entryRb = st2Rb.entries.find((e) => !e.undone);
    // 付款方发起撤销（自动计票）→ 随即离场 → 收款方单方确认也应执行
    await emit(sA, 'score:undo', { entryId: entryRb.id });
    await emit(sA, 'room:leave');
    const rUndo = await emit(sB, 'score:undo', { entryId: entryRb.id });
    assert(rUndo.ok && rUndo.state === 'undone', '付款方离场后收款方确认 → 撤销执行');
    // 结束战局（房主已转移给收款方）→ 归档分数之和必须守恒
    await emit(sB, 'game:end');
    const hist = await api('/api/history', { headers: { authorization: `Bearer ${me.token}` } });
    const game = hist.data.items.find((x) => x.code === cRb.code);
    const detail = await api(`/api/history/${game.id}`, { headers: { authorization: `Bearer ${me.token}` } });
    const scores = detail.data.players.map((p) => p.finalScore);
    assert(
      scores.reduce((a, b) => a + b, 0) === 0,
      `离场撤销账目守恒：归档分数之和 = ${scores.reduce((a, b) => a + b, 0)}（[${scores.join(', ')}]）`,
    );
    sA.disconnect();
    sB.disconnect();
  }

  // 3.4c) 健壮性：小题库发牌不重复 / 多标签在线状态 / 改名联动房间
  // 注意 room:create 按账号限流 3 次/分钟：本段 3 次建房分摊到 sec_user(1) 与 sec_user2(2)
  {
    // —— P3-3：题库池 2 张 < 4 名玩家 → 只有 2 人有卡，绝不两人同卡 ——
    const sA = await connect();
    const sB = await connect();
    const sX = await connect();
    const sY = await connect();
    const cD = await emit(sA, 'room:create', { token: me.token });
    assert(cD.ok, '发牌测试：建房成功');
    const uRb2 = await ensure('sec_user2', '安全对手');
    await emit(sB, 'room:join', { code: cD.code, token: uRb2.token });
    await emit(sX, 'room:join', { code: cD.code, token: MJ_DEMO[0] });
    await emit(sY, 'room:join', { code: cD.code, token: MJ_DEMO[1] });
    // 停用 5 个分类 + 停用 5 张全局卡 → 池恰好剩 2 张
    await emit(sA, 'library:setEnabled', {
      disabledCategoryIds: ['voice', 'action', 'hu', 'rule', 'info'],
      disabledCardIds: ['g03', 'g04', 'g05', 'g06', 'g07'],
    });
    const stD1P = waitState(sA, (st) => st.status === 'playing' && st.roundNo === 1);
    await emit(sA, 'game:start');
    const stD1 = await stD1P;
    const withCard = stD1.players.filter((p) => p.hasCard).length;
    assert(withCard === 2, `题库池 2 张、4 名玩家 → 仅 ${withCard} 人发到卡（其余为空，不重复发牌）`);
    await emit(sA, 'room:dissolve');
    sA.disconnect();
    sB.disconnect();
    sX.disconnect();
    sY.disconnect();

    // —— P3-4：同一账号多标签共用凭证；最后一根连接断开才离线 ——
    const sM1 = await connect();
    const sM2 = await connect();
    const sObs = await connect();
    const cM = await emit(sM1, 'room:create', { token: uRb2.token }); // sec_user2 建房（1/3）
    assert(cM.ok, '多标签测试：建房成功');
    const jM2 = await emit(sM2, 'room:join', { code: cM.code, token: uRb2.token }); // 第二连接（模拟多标签）
    assert(jM2.ok && jM2.rebound && jM2.token === cM.token, '同账号第二连接回合同房且拿到相同凭证（不轮换 token）');
    await emit(sObs, 'room:join', { code: cM.code, token: me.token }); // 观察者
    // 等广播安静下来，用 rev 递增过滤旧广播：断开后必然有一条新广播（在线与否即断言点）
    await new Promise((r) => setTimeout(r, 400));
    let obsRev = -1;
    sObs.on('state', (st) => {
      obsRev = Math.max(obsRev, st.rev);
    });
    const rev1 = obsRev;
    sM2.disconnect();
    const stM1b2 = await waitState(sObs, (st) => st.rev > rev1);
    assert(stM1b2.players.find((p) => p.name === '安全对手')?.connected === true, '断开其一连接 → 仍显示在线（多标签）');
    const rev2 = obsRev;
    sM1.disconnect();
    const stM2b = await waitState(sObs, (st) => st.rev > rev2);
    assert(stM2b.players.find((p) => p.name === '安全对手')?.connected === false, '最后一根连接断开 → 离线')
    sObs.disconnect()

    // —— P3-5：自助改名联动进行中房间；房内重名时跳过 ——
    const sN1 = await connect();
    const sN2 = await connect();
    const cN = await emit(sN1, 'room:create', { token: uRb2.token }); // sec_user2 建房（2/3）
    assert(cN.ok, '改名测试：建房成功');
    await emit(sN2, 'room:join', { code: cN.code, token: me.token });
    // 广播随改名请求处理即发出：监听必须先于 HTTP 请求注册
    const stNP = waitState(sN2, (st) => st.players.some((p) => p.name === '安全对手二号'));
    const cn = await api('/api/auth/change-name', {
      method: 'POST',
      headers: { ...BYPASS, authorization: `Bearer ${uRb2.token}` },
      body: JSON.stringify({ name: '安全对手二号' }),
    });
    assert(cn.status === 200 && !cn.data.warn, '改名成功且无重名冲突');
    const stN = await stNP;
    assert(stN.players.some((p) => p.name === '安全对手二号'), '改名实时联动进行中房间');
    // 改成与观察者重名 → 返回 warn 且房间不广播（保留原名）；用 game:start 的广播验证
    const cn2 = await api('/api/auth/change-name', {
      method: 'POST',
      headers: { ...BYPASS, authorization: `Bearer ${uRb2.token}` },
      body: JSON.stringify({ name: '安全测试' }),
    });
    assert(cn2.status === 200 && !!cn2.data.warn, '改成房内已有昵称 → 提示冲突');
    const stStartP = waitState(sN2, (st) => st.status === 'playing');
    await emit(sN1, 'game:start');
    const stStart = await stStartP;
    assert(
      stStart.players.find((p) => p.uid === uRb2.user.uid)?.name === '安全对手二号',
      '房内重名冲突 → 该房间保留原昵称',
    );
    // 恢复昵称，避免影响后续测试
    const stRestoreP = waitState(sN2, (st) =>
      st.players.some((p) => p.name === '安全对手' && p.uid === uRb2.user.uid),
    );
    await api('/api/auth/change-name', {
      method: 'POST',
      headers: { ...BYPASS, authorization: `Bearer ${uRb2.token}` },
      body: JSON.stringify({ name: '安全对手' }),
    });
    await stRestoreP;
    sN1.disconnect();
    sN2.disconnect();
  }

  // 3.5) 单点登录：同一时间同个账号只允许一处登录
  const solo = await ensure('sec_solo', '单点甲');
  const sSolo = await connect();
  const cSolo = await emit(sSolo, 'room:create', { token: solo.token });
  assert(cSolo.ok, '单点测试：建房成功');
  // 先挂监听再重新登录：请离事件在登录请求处理期间就会发出
  const closedSoloP = new Promise((res) => sSolo.once('roomClosed', res));
  const soloAgain = await ensure('sec_solo', '单点甲'); // 同账号再次登录（新会话）
  r = await api('/api/me', { headers: { authorization: `Bearer ${solo.token}` } });
  assert(r.status === 401, '旧会话被新登录顶掉 → 401');
  r = await api('/api/me', { headers: { authorization: `Bearer ${soloAgain.token}` } });
  assert(r.status === 200, '最新会话可用');
  const closedSolo = await Promise.race([
    closedSoloP,
    new Promise((res) => setTimeout(() => res(null), 6000)),
  ]);
  assert(closedSolo?.reason === 'sessionReplaced', '旧设备在房间内被请离（sessionReplaced）');
  // 旧会话的 socket 也无法再加入房间
  r = await emit(sSolo, 'room:join', { code: cSolo.code, token: solo.token });
  assert(!r.ok, '旧会话加入房间 → 拒绝（请先登录）');
  sSolo.disconnect();

  // 4) 设置注入：页脚 javascript: URL 被清洗
  await api('/api/admin/settings', {
    method: 'PUT',
    headers: { ...ADMIN, 'content-type': 'application/json' },
    body: JSON.stringify({ github: 'javascript:alert(1)', text: 'ok-text' }),
  });
  r = await api('/api/settings');
  assert(r.data.github === '' && r.data.text === 'ok-text', 'javascript: 协议页脚链接被清洗');

  // 5) 安全响应头 + CORS 关闭
  const raw = await fetch(`${URL}/api/health`);
  assert(raw.headers.get('x-content-type-options') === 'nosniff', 'X-Content-Type-Options: nosniff');
  assert(raw.headers.get('x-frame-options') === 'DENY', 'X-Frame-Options: DENY');
  const corsProbe = await fetch(`${URL}/api/health`, { headers: { origin: 'https://evil.example' } });
  assert(!corsProbe.headers.get('access-control-allow-origin'), '不返回跨域许可头');

  // 6) 超大请求体被拒
  const big = await api('/api/auth/login', {
    method: 'POST',
    headers: BYPASS,
    body: JSON.stringify({ loginName: 'a'.repeat(20000), password: 'x' }),
  });
  assert(big.status === 413, '超大请求体 → 413');

  // 7) 登录暴力破解限流（放最后：postRaw 不带 x-test-ratelimit 头，真实触发限流）
  let got429 = false;
  for (let i = 0; i < 18; i++) {
    const lr = await postRaw('/api/auth/login', { loginName: 'sec_user', password: 'wrong-pass9' });
    if (lr.status === 429) {
      got429 = true;
      break;
    }
  }
  assert(got429, '连续登录失败触发限流 → 429');

  console.log(`\n✅ 安全测试全部通过: ${passed} 项`);
  console.log('ℹ️ 限流仅影响本容器 IP 的裸请求；带测试头的 smoke 可直接连续运行');
  process.exit(0);
}

main().catch((e) => {
  console.error(`\n❌ 安全测试失败: ${e.message}`);
  if (e.stack) console.error(e.stack.split('\n').slice(1, 4).join('\n'));
  process.exit(1);
});
