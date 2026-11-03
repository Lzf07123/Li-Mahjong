import { Server as IOServer, Socket } from 'socket.io';
import { randomUUID, randomInt } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CardDef, Category, Player, Room, ScoreEntry, Snapshot } from './types.js';
import * as dbi from './db.js';

const SEATS = ['东', '南', '西', '北'];
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_TTL_MS = 24 * 60 * 60 * 1000;

interface BuiltinData {
  cards: CardDef[];
}

function loadBuiltin(): CardDef[] {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const file = path.join(here, '..', 'data', 'builtin-conditions.json');
  const data = JSON.parse(readFileSync(file, 'utf-8')) as BuiltinData;
  return data.cards;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export interface Ack {
  (resp: { ok: boolean; error?: string; [k: string]: unknown }): void;
}

export class RoomManager {
  private io: IOServer;
  private rooms = new Map<string, Room>();
  private builtin: CardDef[];
  private saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private sweepTimer: ReturnType<typeof setInterval>;
  /** 单点登录兜底清扫：会话过期的在场玩家定期请离 */
  private sessionTimer: ReturnType<typeof setInterval>;
  /** socket 级操作节流：key -> 时间戳数组 */
  private throttleMap = new Map<string, number[]>();

  /** 简单滑动窗口节流；超频返回 false */
  private throttled(socket: Socket, key: string, limit: number, windowMs: number): boolean {
    const now = Date.now();
    const k = `${socket.id}:${key}`;
    const arr = (this.throttleMap.get(k) ?? []).filter((t) => now - t < windowMs);
    arr.push(now);
    this.throttleMap.set(k, arr);
    if (this.throttleMap.size > 5000) this.throttleMap.clear();
    return arr.length > limit;
  }

  constructor(io: IOServer) {
    this.io = io;
    this.builtin = loadBuiltin();
    this.restore();
    this.sweepTimer = setInterval(() => this.sweep(), 10 * 60 * 1000);
    this.sessionTimer = setInterval(() => this.sweepSessions(), 30 * 1000);
  }

  get categoriesMeta() {
    // 与前端题库管理共用（由 REST 提供），这里仅返回内置卡
    return this.builtin;
  }

  // ---------- 生命周期 ----------
  private restore(): void {
    for (const row of dbi.loadLiveRooms()) {
      try {
        const room = JSON.parse(row.state) as Room;
        // 兼容旧快照：补默认字段
        room.features ??= { score: true, cards: true };
        room.usedOnceCardIds ??= [];
        room.disabledCardIds ??= [];
        room.disabledCategoryIds ??= [];
        room.entries ??= [];
        room.leftPlayers ??= [];
        if (Date.now() - room.lastActivity > ROOM_TTL_MS) {
          this.expire(room);
          continue;
        }
        for (const p of room.players) {
          p.connected = false;
          p.uid ??= null;
        }
        this.rooms.set(room.code, room);
      } catch {
        dbi.deleteLiveRoom(row.code);
      }
    }
  }

  private sweep(): void {
    for (const room of this.rooms.values()) {
      if (Date.now() - room.lastActivity > ROOM_TTL_MS) this.expire(room);
    }
  }

  /** 单点登录兜底：会话已失效（被顶掉/过期）的在场玩家定期请离 */
  private sweepSessions(): void {
    for (const room of this.rooms.values()) {
      for (const p of [...room.players]) {
        if (!p.sessionToken) continue;
        if (dbi.userBySession(p.sessionToken)) continue;
        this.removePlayer(room, p.id, 'sessionReplaced');
        this.broadcastRoom(room);
      }
    }
  }

  /** 单点登录：该账号在别处重新登录，立即请离其在所有房间中的旧会话玩家 */
  evictUid(uid: string | null | undefined): void {
    if (!uid) return;
    for (const room of this.rooms.values()) {
      const p = room.players.find((x) => x.uid === uid);
      if (!p) continue;
      this.removePlayer(room, p.id, 'sessionReplaced');
      this.broadcastRoom(room);
    }
  }

  /** 结算名单：在场玩家 + 战局中离场者 */
  private standingsOf(room: Room) {
    return [
      ...room.players.map((p) => ({ name: p.name, seat: p.seat, score: p.score, isHost: p.id === room.hostId, uid: p.uid ?? null })),
      ...room.leftPlayers.map((lp) => ({ name: lp.name, seat: lp.seat, score: lp.score, isHost: false, uid: lp.uid })),
    ];
  }

  private expire(room: Room): void {
    if (room.gameId) {
      dbi.finalizeGame(room.gameId, 'abandoned', this.standingsOf(room));
    }
    dbi.deleteLiveRoom(room.code);
    this.rooms.delete(room.code);
    this.io.in(room.code).emit('roomClosed', { reason: 'expired' });
    this.io.in(room.code).socketsLeave(room.code);
  }

  private touch(room: Room): void {
    room.lastActivity = Date.now();
    const t = this.saveTimers.get(room.code);
    if (t) clearTimeout(t);
    this.saveTimers.set(
      room.code,
      setTimeout(() => {
        this.saveTimers.delete(room.code);
        dbi.saveLiveRoom(room.code, room);
      }, 400),
    );
  }

  /** 房间存活概要（内存实时态，供 REST「回到战局」查询）；不存在返回 null */
  peek(code: string): { status: string; roundNo: number; playerCount: number } | null {
    const room = this.rooms.get(code);
    if (!room) return null;
    return { status: room.status, roundNo: room.roundNo, playerCount: room.players.length };
  }

  private roomByCode(code: string): Room | undefined {
    return this.rooms.get(code);
  }

  private genCode(): string {
    for (let tries = 0; tries < 200; tries++) {
      let code = '';
      for (let i = 0; i < 4; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
      if (!this.rooms.has(code)) return code;
    }
    throw new Error('房间号生成失败');
  }

  // ---------- 快照 ----------
  snapshotFor(room: Room, playerId: string | null): Snapshot {
    return {
      code: room.code,
      status: room.status,
      roundNo: room.roundNo,
      rev: room.rev,
      features: room.features,
      hostId: room.hostId,
      players: room.players.map((p) => ({
        id: p.id,
        uid: p.uid ?? null,
        name: p.name,
        seat: p.seat,
        score: p.score,
        connected: p.connected,
        isHost: p.id === room.hostId,
        hasCard: !!p.card,
        cardRevealed: p.card?.revealed ?? false,
        cardText: p.card && (p.card.revealed || p.id === playerId) ? p.card.text : null,
        cardCategory: p.card && (p.card.revealed || p.id === playerId) ? p.card.category : null,
      })),
      entries: room.entries.slice(-60).reverse(),
      entryCount: room.entries.length,
      usedOnceCardIds: room.usedOnceCardIds,
      disabledCardIds: room.disabledCardIds,
      disabledCategoryIds: room.disabledCategoryIds,
      customCards: [],
    };
  }

  private broadcast(room: Room): void {
    const sockets = this.io.sockets.adapter.rooms.get(room.code);
    if (!sockets) return;
    for (const sid of sockets) {
      const s = this.io.sockets.sockets.get(sid);
      if (s) s.emit('state', this.snapshotFor(room, s.data.playerId ?? null));
    }
  }

  private broadcastRoom(room: Room): void {
    room.rev = (room.rev ?? 0) + 1;
    this.touch(room);
    this.broadcast(room);
  }

  // ---------- 题库 ----------
  availableCards(room: Room): CardDef[] {
    const custom = dbi.listCustomCards();
    const all = [...this.builtin, ...custom];
    return all.filter(
      (c) =>
        !room.disabledCardIds.includes(c.id) &&
        !room.disabledCategoryIds.includes(c.category),
    );
  }

  // ---------- 发牌 ----------
  private deal(room: Room): void {
    if (!room.features.cards) {
      // 条件卡关闭：作废所有已发卡
      room.players.forEach((p) => (p.card = null));
      return;
    }
    const pool = this.availableCards(room).filter((c) => !room.usedOnceCardIds.includes(c.id));
    if (pool.length === 0) return;
    const shuffled = shuffle(pool);
    room.players.forEach((p, i) => {
      // 若“一晚限一次”卡被抽到，自动跳过换下一张（在洗好的队列里向后找）
      let idx = i % shuffled.length;
      let card = shuffled[idx];
      let guard = 0;
      while (card.once && room.usedOnceCardIds.includes(card.id) && guard < shuffled.length * 2) {
        idx = (idx + 1) % shuffled.length;
        card = shuffled[idx];
        guard++;
      }
      p.card = { cardId: card.id, text: card.text, category: card.category, revealed: false };
      if (card.once && !room.usedOnceCardIds.includes(card.id)) room.usedOnceCardIds.push(card.id);
      if (room.gameId) {
        dbi.addConditionDraw(room.gameId, room.roundNo, p.name, card.text, card.category);
      }
    });
  }

  // ---------- 连接处理 ----------
  register(socket: Socket): void {
    socket.on('room:create', (payload: { token?: string }, ack?: Ack) => {
      if (this.throttled(socket, 'create', 3, 60e3)) return ack?.({ ok: false, error: '操作太快啦，歇一下' });
      const sessionToken = String(payload?.token ?? '').trim();
      const user = dbi.userBySession(sessionToken);
      if (!user) return ack?.({ ok: false, error: '请先登录' });
      const code = this.genCode();
      const host: Player = {
        id: randomUUID(),
        token: randomUUID(),
        uid: user.uid,
        sessionToken,
        name: user.name,
        seat: SEATS[0],
        score: 0,
        connected: true,
        card: null,
      };
      const room: Room = {
        code,
        hostId: host.id,
        status: 'lobby',
        roundNo: 0,
        rev: 0,
        features: { score: true, cards: true },
        gameId: null,
        createdAt: Date.now(),
        lastActivity: Date.now(),
        players: [host],
        leftPlayers: [],
        entries: [],
        usedOnceCardIds: [],
        disabledCardIds: [],
        disabledCategoryIds: [],
      };
      this.rooms.set(code, room);
      socket.data.playerId = host.id;
      socket.data.code = code;
      socket.join(code);
      ack?.({ ok: true, code, playerId: host.id, token: host.token });
      this.broadcastRoom(room);
    });

    socket.on('room:join', (payload: { code?: string; token?: string }, ack?: Ack) => {
      const code = String(payload?.code ?? '').trim().toUpperCase();
      const sessionToken = String(payload?.token ?? '').trim();
      const user = dbi.userBySession(sessionToken);
      if (!user) return ack?.({ ok: false, error: '请先登录' });
      const room = this.roomByCode(code);
      if (!room) return ack?.({ ok: false, error: '房间不存在，可能已结束或已过期' });
      // 同一账号已在房间中（如换了浏览器标签/清了会话）：直接回合，不再新增玩家
      const existing = room.players.find((p) => p.uid === user.uid);
      if (existing) {
        existing.name = user.name;
        existing.token = randomUUID();
        existing.sessionToken = sessionToken;
        existing.connected = true;
        socket.data.playerId = existing.id;
        socket.data.code = code;
        socket.join(code);
        ack?.({ ok: true, code, playerId: existing.id, token: existing.token, rebound: true });
        this.broadcastRoom(room);
        return;
      }
      if (room.players.length >= SEATS.length) return ack?.({ ok: false, error: '房间已满（4人）' });
      if (room.players.some((p) => p.name === user.name))
        return ack?.({ ok: false, error: '房间里已有同名玩家' });
      const used = new Set(room.players.map((p) => p.seat));
      const seat = SEATS.find((s) => !used.has(s)) ?? SEATS[0];
      const player: Player = {
        id: randomUUID(),
        token: randomUUID(),
        uid: user.uid,
        sessionToken,
        name: user.name,
        seat,
        score: 0,
        connected: true,
        card: null,
      };
      room.players.push(player);
      socket.data.playerId = player.id;
      socket.data.code = code;
      socket.join(code);
      ack?.({ ok: true, code, playerId: player.id, token: player.token });
      this.broadcastRoom(room);
    });

    socket.on('room:rejoin', (payload: { code?: string; token?: string }, ack?: Ack) => {
      const code = String(payload?.code ?? '').trim().toUpperCase();
      const token = String(payload?.token ?? '');
      const room = this.roomByCode(code);
      const player = room?.players.find((p) => p.token === token);
      if (!room || !player) return ack?.({ ok: false, error: '无法恢复会话，房间可能已结束' });
      player.connected = true;
      socket.data.playerId = player.id;
      socket.data.code = code;
      socket.join(code);
      ack?.({ ok: true, playerId: player.id });
      this.broadcastRoom(room);
    });

    socket.on('room:leave', (_payload: unknown, ack?: Ack) => {
      const { room, player } = this.ctx(socket);
      if (!room || !player) return ack?.({ ok: false, error: '不在房间中' });
      // 战局进行中离开：分数与最终名单照常归档
      if (room.status === 'playing') {
        room.leftPlayers.push({ name: player.name, seat: player.seat, score: player.score, uid: player.uid ?? null });
      }
      this.removePlayer(room, player.id, 'left');
      socket.leave(room.code);
      ack?.({ ok: true });
      // 最后一人离开：房间自然解散
      if (room.players.length === 0) {
        if (room.gameId) dbi.finalizeGame(room.gameId, 'abandoned', this.standingsOf(room));
        dbi.deleteLiveRoom(room.code);
        this.rooms.delete(room.code);
        return;
      }
      this.broadcastRoom(room);
    });

    socket.on('room:setFeatures', (payload: { score?: boolean; cards?: boolean }, ack?: Ack) => {
      const { room, player } = this.ctx(socket);
      if (!room || !player) return ack?.({ ok: false, error: '不在房间中' });
      if (room.hostId !== player.id) return ack?.({ ok: false, error: '仅房主可设置' });
      const score = payload.score !== undefined ? !!payload.score : room.features.score;
      const cards = payload.cards !== undefined ? !!payload.cards : room.features.cards;
      if (!score && !cards) return ack?.({ ok: false, error: '记分与条件卡至少开启一项' });
      room.features = { score, cards };
      ack?.({ ok: true });
      this.broadcastRoom(room);
    });

    socket.on('room:setSeat', (payload: { seat?: string }, ack?: Ack) => {
      const { room, player } = this.ctx(socket);
      if (!room || !player) return ack?.({ ok: false, error: '不在房间中' });
      const seat = String(payload.seat ?? '');
      if (!SEATS.includes(seat)) return ack?.({ ok: false, error: '方位无效' });
      const taken = room.players.find((p) => p.seat === seat && p.id !== player.id);
      if (taken) return ack?.({ ok: false, error: `${seat} 位已被 ${taken.name} 选择` });
      player.seat = seat;
      ack?.({ ok: true });
      this.broadcastRoom(room);
    });

    socket.on('room:kick', (payload: { playerId?: string }, ack?: Ack) => {
      const { room, player } = this.ctx(socket);
      if (!room || !player) return ack?.({ ok: false, error: '不在房间中' });
      if (room.hostId !== player.id) return ack?.({ ok: false, error: '仅房主可操作' });
      if (payload.playerId === player.id) return ack?.({ ok: false, error: '不能移除自己' });
      this.removePlayer(room, String(payload.playerId));
      ack?.({ ok: true });
      this.broadcastRoom(room);
    });

    socket.on('game:start', (_p: unknown, ack?: Ack) => {
      const { room, player } = this.ctx(socket);
      if (!room || !player) return ack?.({ ok: false, error: '不在房间中' });
      if (room.hostId !== player.id) return ack?.({ ok: false, error: '仅房主可开局' });
      if (room.players.length < 2) return ack?.({ ok: false, error: '至少需要 2 名玩家' });
      room.status = 'playing';
      room.roundNo = 1;
      room.gameId = dbi.createGame(room.code, room.features);
      room.entries = [];
      room.usedOnceCardIds = [];
      room.players.forEach((p) => (p.card = null));
      this.deal(room);
      ack?.({ ok: true });
      this.broadcastRoom(room);
    });

    socket.on('game:nextRound', (_p: unknown, ack?: Ack) => {
      const { room, player } = this.ctx(socket);
      if (!room || !player || room.hostId !== player.id) return ack?.({ ok: false, error: '仅房主可操作' });
      room.roundNo += 1;
      this.deal(room);
      ack?.({ ok: true });
      this.broadcastRoom(room);
    });

    socket.on('game:reveal', (_p: unknown, ack?: Ack) => {
      const { room, player } = this.ctx(socket);
      if (!room || !player?.card) return ack?.({ ok: false, error: '没有可亮牌的条件卡' });
      player.card.revealed = true;
      ack?.({ ok: true });
      this.broadcastRoom(room);
    });

    socket.on('game:redrawAll', (_p: unknown, ack?: Ack) => {
      const { room, player } = this.ctx(socket);
      if (!room || !player || room.hostId !== player.id) return ack?.({ ok: false, error: '仅房主可操作' });
      if (!room.features.cards) return ack?.({ ok: false, error: '本局未启用条件卡' });
      this.deal(room);
      ack?.({ ok: true });
      this.broadcastRoom(room);
    });

    socket.on('game:redrawOne', (payload: { playerId?: string }, ack?: Ack) => {
      const { room, player } = this.ctx(socket);
      if (!room || !player || room.hostId !== player.id) return ack?.({ ok: false, error: '仅房主可操作' });
      if (!room.features.cards) return ack?.({ ok: false, error: '本局未启用条件卡' });
      const target = room.players.find((p) => p.id === payload.playerId);
      if (!target) return ack?.({ ok: false, error: '玩家不存在' });
      const taken = new Set(room.players.filter((p) => p.id !== target.id).map((p) => p.card?.cardId));
      const pool = shuffle(
        this.availableCards(room).filter(
          (c) => !room.usedOnceCardIds.includes(c.id) && !taken.has(c.id) && c.id !== target.card?.cardId,
        ),
      );
      const card = pool[0];
      if (!card) return ack?.({ ok: false, error: '题库已空，无法重摸' });
      target.card = { cardId: card.id, text: card.text, category: card.category, revealed: false };
      if (card.once && !room.usedOnceCardIds.includes(card.id)) room.usedOnceCardIds.push(card.id);
      if (room.gameId) dbi.addConditionDraw(room.gameId, room.roundNo, target.name, card.text, card.category);
      ack?.({ ok: true });
      this.broadcastRoom(room);
    });

    socket.on('game:clearCard', (payload: { playerId?: string }, ack?: Ack) => {
      const { room, player } = this.ctx(socket);
      if (!room || !player || room.hostId !== player.id) return ack?.({ ok: false, error: '仅房主可操作' });
      if (!room.features.cards) return ack?.({ ok: false, error: '本局未启用条件卡' });
      const target = room.players.find((p) => p.id === payload.playerId);
      if (!target) return ack?.({ ok: false, error: '玩家不存在' });
      target.card = null;
      ack?.({ ok: true });
      this.broadcastRoom(room);
    });

    // ---------- 记分 ----------
    socket.on('score:add', (payload: { toId?: string; amountTotal?: number; note?: string }, ack?: Ack) => {
      const { room, player } = this.ctx(socket);
      if (!room || !player) return ack?.({ ok: false, error: '不在房间中' });
      if (room.status !== 'playing') return ack?.({ ok: false, error: '战局尚未开始' });
      if (!room.features.score) return ack?.({ ok: false, error: '本局未启用记分' });
      if (this.throttled(socket, 'score', 20, 10e3)) return ack?.({ ok: false, error: '操作太快啦' });
      // 付款方固定为记账人本人：任何人只能从自己的分数给出，不能替别人扣分
      const toId = String(payload.toId ?? '');
      const amountTotal = Math.floor(Number(payload.amountTotal));
      if (!toId) return ack?.({ ok: false, error: '请选择收款方' });
      if (toId === player.id) return ack?.({ ok: false, error: '不能给自己记分' });
      if (!Number.isFinite(amountTotal) || amountTotal <= 0)
        return ack?.({ ok: false, error: '金额需为正整数' });
      if (amountTotal > 1_000_000) return ack?.({ ok: false, error: '单笔分数上限 1,000,000' });
      const to = room.players.find((p) => p.id === toId);
      if (!to) return ack?.({ ok: false, error: '玩家不存在' });
      // 更新分数
      player.score -= amountTotal;
      to.score += amountTotal;
      const note = String(payload.note ?? '').trim().slice(0, 30) || undefined;
      const split = { name: player.name, amount: amountTotal };
      let entryId = 0;
      if (room.gameId) {
        entryId = dbi.addScoreEntry(room.gameId, room.roundNo, [split], to.name, amountTotal, note);
      } else {
        entryId = -(Date.now());
      }
      const entry: ScoreEntry = {
        id: entryId,
        roundNo: room.roundNo,
        payers: [split],
        payerIds: [player.id],
        toId,
        toName: to.name,
        amountTotal,
        note,
        createdBy: player.id,
        createdAt: Date.now(),
      };
      room.entries.push(entry);
      ack?.({ ok: true });
      this.broadcastRoom(room);
    });

    // 撤销需付款方与收款方双方确认：先挂请求（分数不动），双方都同意才回滚，记录永久留痕
    socket.on('score:undo', (payload: { entryId?: number; reject?: boolean }, ack?: Ack) => {
      const { room, player } = this.ctx(socket);
      if (!room || !player) return ack?.({ ok: false, error: '不在房间中' });
      if (this.throttled(socket, 'undo', 10, 10e3)) return ack?.({ ok: false, error: '操作太快啦' });
      const idx = room.entries.findIndex((e) => e.id === payload.entryId);
      const entry = idx >= 0 ? room.entries[idx] : undefined;
      if (!entry) return ack?.({ ok: false, error: '记录不存在' });
      if (entry.undone) return ack?.({ ok: false, error: '该笔已撤销' });
      const isPayer = entry.createdBy === player.id;
      const isReceiver = entry.toId === player.id;
      const isHost = room.hostId === player.id;
      if (!isPayer && !isReceiver && !isHost)
        return ack?.({ ok: false, error: '仅付款方、收款方或房主可操作' });
      // 双方 = 付款方（记账人）与收款方
      const parties = Array.from(new Set([entry.createdBy, entry.toId]));

      const executeUndo = () => {
        entry.payerIds.forEach((pid, i) => {
          const p = room.players.find((x) => x.id === pid);
          if (p) p.score += entry.payers[i]?.amount ?? 0;
        });
        const to = room.players.find((x) => x.id === entry.toId);
        if (to) to.score -= entry.amountTotal;
        entry.undone = true;
        entry.undoneAt = Date.now();
        entry.undo = null;
        if (entry.id > 0) dbi.markScoreEntryUndone(entry.id);
      };

      if (entry.undo) {
        // 已有待确认的撤销请求
        if (entry.undo.requestedBy === player.id) {
          entry.undo = null;
          ack?.({ ok: true, state: 'cancelled' });
          this.broadcastRoom(room);
          return;
        }
        if (parties.includes(player.id) && payload.reject) {
          // 另一方拒绝 → 请求作废
          entry.undo = null;
          ack?.({ ok: true, state: 'rejected' });
          this.broadcastRoom(room);
          return;
        }
        if (parties.includes(player.id)) {
          if (entry.undo.confirmed.includes(player.id))
            return ack?.({ ok: false, error: '你已同意，等待另一方确认' });
          entry.undo.confirmed.push(player.id);
          if (parties.every((pid) => entry.undo!.confirmed.includes(pid))) {
            executeUndo();
            ack?.({ ok: true, state: 'undone' });
          } else {
            ack?.({ ok: true, state: 'awaiting' });
          }
          this.broadcastRoom(room);
          return;
        }
        // 房主重复点击非自己发起的请求：无操作
        return ack?.({ ok: false, error: '等待双方玩家确认' });
      }

      // 新建撤销请求；发起人若为付款/收款方则自动计入其同意票
      entry.undo = {
        requestedBy: player.id,
        requestedAt: Date.now(),
        confirmed: isPayer || isReceiver ? [player.id] : [],
      };
      ack?.({ ok: true, state: 'requested' });
      this.broadcastRoom(room);
    });

    socket.on('score:reset', (_p: unknown, ack?: Ack) => {
      const { room, player } = this.ctx(socket);
      if (!room || !player || room.hostId !== player.id) return ack?.({ ok: false, error: '仅房主可操作' });
      room.players.forEach((p) => (p.score = 0));
      room.entries = [];
      ack?.({ ok: true });
      this.broadcastRoom(room);
    });

    // ---------- 结束 ----------
    socket.on('game:end', (_p: unknown, ack?: Ack) => {
      const { room, player } = this.ctx(socket);
      if (!room || !player || room.hostId !== player.id) return ack?.({ ok: false, error: '仅房主可操作' });
      const standings = this.standingsOf(room);
      if (room.gameId) dbi.finalizeGame(room.gameId, 'finished', standings);
      dbi.deleteLiveRoom(room.code);
      this.rooms.delete(room.code);
      this.io.in(room.code).emit('gameEnded', { standings });
      this.io.in(room.code).socketsLeave(room.code);
      ack?.({ ok: true });
    });

    socket.on('room:dissolve', (_p: unknown, ack?: Ack) => {
      const { room, player } = this.ctx(socket);
      if (!room || !player || room.hostId !== player.id) return ack?.({ ok: false, error: '仅房主可操作' });
      if (room.gameId) {
        dbi.finalizeGame(room.gameId, 'abandoned', this.standingsOf(room));
      }
      dbi.deleteLiveRoom(room.code);
      this.rooms.delete(room.code);
      this.io.in(room.code).emit('roomClosed', { reason: 'dissolved' });
      this.io.in(room.code).socketsLeave(room.code);
      ack?.({ ok: true });
    });

    // ---------- 题库配置 ----------
    socket.on(
      'library:setEnabled',
      (payload: { disabledCardIds?: string[]; disabledCategoryIds?: string[] }, ack?: Ack) => {
        const { room, player } = this.ctx(socket);
        if (!room || !player || room.hostId !== player.id) return ack?.({ ok: false, error: '仅房主可操作' });
        room.disabledCardIds = (payload.disabledCardIds ?? []).map(String);
        room.disabledCategoryIds = (payload.disabledCategoryIds ?? []).map(String);
        ack?.({ ok: true });
        this.broadcastRoom(room);
      },
    );

    socket.on('library:addCustom', (payload: { text?: string; category?: Category }, ack?: Ack) => {
      const { room, player } = this.ctx(socket);
      if (!room || !player || room.hostId !== player.id) return ack?.({ ok: false, error: '仅房主可操作' });
      const text = String(payload.text ?? '').trim().slice(0, 100);
      const category = String(payload.category ?? 'global') as Category;
      if (!text) return ack?.({ ok: false, error: '请填写条件内容' });
      dbi.addCustomCard(text, category);
      ack?.({ ok: true });
      this.broadcastRoom(room);
    });

    socket.on(
      'library:updateCustom',
      (payload: { id?: string; text?: string; category?: Category; enabled?: boolean }, ack?: Ack) => {
        const { room, player } = this.ctx(socket);
        if (!room || !player || room.hostId !== player.id) return ack?.({ ok: false, error: '仅房主可操作' });
        const text = String(payload.text ?? '').trim().slice(0, 100);
        if (!text) return ack?.({ ok: false, error: '请填写条件内容' });
        dbi.updateCustomCard(String(payload.id), text, String(payload.category ?? 'global') as Category, !!payload.enabled);
        ack?.({ ok: true });
        this.broadcastRoom(room);
      },
    );

    socket.on('library:deleteCustom', (payload: { id?: string }, ack?: Ack) => {
      const { room, player } = this.ctx(socket);
      if (!room || !player || room.hostId !== player.id) return ack?.({ ok: false, error: '仅房主可操作' });
      dbi.deleteCustomCard(String(payload.id));
      ack?.({ ok: true });
      this.broadcastRoom(room);
    });

    socket.on('disconnect', () => {
      const { room, player } = this.ctx(socket);
      if (!room || !player) return;
      player.connected = false;
      this.broadcastRoom(room);
    });
  }

  private ctx(socket: Socket): { room?: Room; player?: Player } {
    const code: string | undefined = socket.data.code;
    const playerId: string | undefined = socket.data.playerId;
    if (!code || !playerId) return {};
    const room = this.rooms.get(code);
    const player = room?.players.find((p) => p.id === playerId);
    return { room, player };
  }

  private removePlayer(
    room: Room,
    playerId: string,
    reason: 'kicked' | 'sessionReplaced' | 'left' = 'kicked',
  ): void {
    const idx = room.players.findIndex((p) => p.id === playerId);
    if (idx < 0) return;
    const [removed] = room.players.splice(idx, 1);
    if (room.hostId === playerId && room.players.length > 0) {
      room.hostId = room.players[0].id; // 房主转移给最早加入者
    }
    // 踢掉该玩家的所有连接
    const sockets = this.io.sockets.adapter.rooms.get(room.code);
    if (sockets) {
      for (const sid of sockets) {
        const s = this.io.sockets.sockets.get(sid);
        if (s && s.data.playerId === playerId) {
          s.emit('roomClosed', { reason });
          s.leave(room.code);
        }
      }
    }
    void removed;
  }

  destroy(): void {
    clearInterval(this.sweepTimer);
    clearInterval(this.sessionTimer);
  }
}
