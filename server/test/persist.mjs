// 持久化验证：注册→开局→记账→重启容器→rejoin 恢复 + 历史完整
// 运行：docker exec mahjong-score-server-1 node /app/test/persist.mjs setup|verify <code> <roomToken>
import { io } from 'socket.io-client';

const URL = process.env.TEST_URL || 'http://localhost:3000';
const emit = (s, ev, payload) =>
  new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('ack timeout: ' + ev)), 6000);
    s.emit(ev, payload ?? {}, (r) => { clearTimeout(t); res(r); });
  });
const waitRev = (s, min) =>
  new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('state timeout')), 6000);
    const h = (snap) => { if (snap.rev >= min) { clearTimeout(t); s.off('state', h); res(snap); } };
    s.on('state', h);
  });

async function register(loginName) {
  const reg = await fetch(`${URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-test-captcha': '1' },
    body: JSON.stringify({ loginName, name: loginName, password: 'persist1234' }),
  });
  const j = await reg.json();
  if (j.token) return j.token;
  // 已存在则登录
  const login = await fetch(`${URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-test-captcha': '1' },
    body: JSON.stringify({ loginName, password: 'persist1234' }),
  });
  const lj = await login.json();
  if (!lj.token) throw new Error('无法获得会话: ' + (lj.error || ''));
  return lj.token;
}

async function main() {
  const phase = process.argv[2];
  if (phase === 'setup') {
    const s = io(URL, { transports: ['websocket'] });
    const s2 = io(URL, { transports: ['websocket'] });
    await new Promise((r) => s.on('connect', r));
    await new Promise((r) => s2.on('connect', r));
    const token = await register('persist_a');
    const token2 = await register('persist_b');
    const snap1P = waitRev(s, 1);
    const c = await emit(s, 'room:create', { token });
    const snap1 = await snap1P;
    const joinP = waitRev(s, snap1.rev + 1);
    await emit(s2, 'room:join', { code: c.code, token: token2 });
    await joinP;
    const startP = waitRev(s, snap1.rev + 2);
    await emit(s, 'game:start');
    const playing = await startP;
    const ids = playing.players.map((p) => p.id);
    const addP = waitRev(s, snap1.rev + 3);
    await emit(s, 'score:add', { fromIds: [ids[1]], toId: ids[0], amountTotal: 66, note: '重启前记的账' });
    const after = await addP;
    const host = after.players.find((p) => p.id === ids[0]);
    // 等待服务端防抖落盘（400ms）完成，避免立刻重启丢快照
    await new Promise((r) => setTimeout(r, 1200));
    console.log(JSON.stringify({ code: c.code, roomToken: c.token, rev: after.rev, hostScore: host.score }));
    process.exit(0);
  }
  if (phase === 'verify') {
    const [code, roomToken] = process.argv.slice(3);
    const before = await fetch(`${URL}/api/history`).then((r) => r.json());
    const s = io(URL, { transports: ['websocket'] });
    await new Promise((r) => s.on('connect', r));
    const snapP = new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('no state')), 6000);
      s.once('state', (x) => { clearTimeout(t); res(x); });
    });
    const r = await emit(s, 'room:rejoin', { code, token: roomToken });
    if (!r.ok) throw new Error('rejoin 失败: ' + r.error);
    const snap = await snapP;
    const okPlay = snap.status === 'playing' && snap.roundNo === 1;
    const host = snap.players.find((p) => p.id === r.playerId);
    console.log(JSON.stringify({
      rejoinOk: r.ok,
      playing: okPlay,
      hostScore: host?.score,
      entries: snap.entries.length,
      hasCard: !!host?.cardText,
      historyCount: before.items.length,
    }));
    process.exit(okPlay && host?.score === 66 && snap.entries.length === 1 && !!host?.cardText ? 0 : 1);
  }
  console.error('usage: node persist.mjs setup|verify <code> <roomToken>');
  process.exit(2);
}

main().catch((e) => { console.error('❌', e.message); process.exit(1); });
