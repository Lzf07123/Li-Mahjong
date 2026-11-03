// 安全测试：未授权 / 越权 / 输入校验 / 滥用路径 / 响应头
// 运行：docker exec mahjong-score-server-1 node /app/test/sec.mjs
// 注意：包含登录限流触发测试，跑完建议重启 server 容器再跑 smoke
import { io } from 'socket.io-client';

const URL = process.env.TEST_URL || 'http://localhost:3000';
const ADMIN = { 'x-admin-token': process.env.ADMIN_TOKEN || 'admin123' };
const BYPASS = { 'content-type': 'application/json', 'x-test-captcha': '1' };
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
// 带 bypass（模拟测试环境跳过验证码）
const post = (path, body, headers = {}) =>
  api(path, { method: 'POST', headers: { ...BYPASS, ...headers }, body: JSON.stringify(body) });
// 不带 bypass（模拟真实浏览器：验证码必须强制校验）
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

  // 7) 登录暴力破解限流（放最后：会锁住该 IP 5 分钟）
  let got429 = false;
  for (let i = 0; i < 18; i++) {
    const lr = await post('/api/auth/login', { loginName: 'sec_user', password: 'wrong-pass9' });
    if (lr.status === 429) {
      got429 = true;
      break;
    }
  }
  assert(got429, '连续登录失败触发限流 → 429');

  console.log(`\n✅ 安全测试全部通过: ${passed} 项`);
  console.log('⚠️ 登录限流已触发，请重启 server 容器后再运行 smoke 测试');
  process.exit(0);
}

main().catch((e) => {
  console.error(`\n❌ 安全测试失败: ${e.message}`);
  process.exit(1);
});
