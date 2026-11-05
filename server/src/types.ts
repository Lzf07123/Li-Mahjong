export type Category = 'voice' | 'action' | 'hu' | 'rule' | 'info' | 'global';

export interface CardDef {
  id: string;
  text: string;
  category: Category;
  /** 一晚限一次：抽过后本次战局自动跳过并重摸 */
  once?: boolean;
  /** 提示全员作废重摸（仅前端展示用） */
  resetAll?: boolean;
}

export interface DrawnCard {
  cardId: string;
  text: string;
  category: Category;
  revealed: boolean;
}

export interface Player {
  id: string;
  token: string;
  /** 设备级永久用户 id（localStorage），用于跨战局归档与识别 */
  uid?: string | null;
  /** 登录会话 token：单点登录检测用（在别处重新登录即失效） */
  sessionToken?: string | null;
  name: string;
  seat: string;
  score: number;
  connected: boolean;
  card: DrawnCard | null;
}

export interface PayerSplit {
  name: string;
  amount: number;
}

/** 流水撤销：需付款方与收款方双方确认，全程留痕 */
export interface UndoRequest {
  /** 发起人玩家 id */
  requestedBy: string;
  requestedAt: number;
  /** 已同意的玩家 id（发起人若为付款/收款方则自动计入其一票） */
  confirmed: string[];
}

export interface ScoreEntry {
  id: number;
  roundNo: number;
  payers: PayerSplit[];
  /** 内存态：撤销时按玩家 id 回滚 */
  payerIds: string[];
  toId: string;
  toName: string;
  amountTotal: number;
  note?: string;
  createdBy: string;
  createdAt: number;
  /** 待确认的撤销请求（无请求时为空） */
  undo?: UndoRequest | null;
  /** 已撤销（双方确认后置位，记录保留在流水里） */
  undone?: boolean;
  undoneAt?: number;
}

export interface RoomFeatures {
  /** 记分 */
  score: boolean;
  /** 条件卡 */
  cards: boolean;
}

/** 战局中途离开的玩家：分数保留，最终结算照常归档 */
export interface LeftPlayer {
  name: string;
  seat: string;
  score: number;
  uid: string | null;
  /** 离场时的玩家 id：撤销回滚归档分数用（旧快照无此字段，回退按昵称匹配） */
  pid?: string;
}

/** 观战者：只读进入房间，不占座位、不参与记分与结算 */
export interface Spectator {
  id: string;
  token: string;
  uid: string | null;
  sessionToken: string | null;
  name: string;
  connected: boolean;
  since: number;
}

export interface Room {
  code: string;
  hostId: string;
  status: 'lobby' | 'playing';
  roundNo: number;
  features: RoomFeatures;
  /** 广播序号，每次状态变更 +1（客户端据此丢弃过期快照） */
  rev: number;
  gameId: number | null;
  createdAt: number;
  lastActivity: number;
  players: Player[];
  /** 战局进行中离开的玩家（含最终分数，结算时并入 standings） */
  leftPlayers: LeftPlayer[];
  /** 观战者（不参与结算，随房间存续） */
  spectators: Spectator[];
  entries: ScoreEntry[];
  /** 本次战局已使用的“一晚限一次”卡 */
  usedOnceCardIds: string[];
  /** 房间级题库配置 */
  disabledCardIds: string[];
  disabledCategoryIds: string[];
}

/** 发给客户端的个性化快照（隐藏未亮牌的文本） */
export interface Snapshot {
  code: string;
  status: Room['status'];
  roundNo: number;
  rev: number;
  features: RoomFeatures;
  hostId: string;
  players: {
    id: string;
    uid?: string | null;
    name: string;
    seat: string;
    score: number;
    connected: boolean;
    isHost: boolean;
    hasCard: boolean;
    cardRevealed: boolean;
    cardText: string | null;
    cardCategory: Category | null;
  }[];
  /** 观战者概要（只读名单，无 token 等敏感字段） */
  spectators: { id: string; name: string; connected: boolean }[];
  entries: ScoreEntry[];
  entryCount: number;
  usedOnceCardIds: string[];
  disabledCardIds: string[];
  disabledCategoryIds: string[];
  customCards: CardDef[];
}

export interface HistoryListItem {
  id: number;
  code: string;
  status: string;
  startedAt: number;
  endedAt: number | null;
  players: { name: string; seat: string | null; finalScore: number; uid: string | null }[];
}

export interface HistoryDetail extends HistoryListItem {
  features?: { score: boolean; cards: boolean };
  entries: {
    id: number;
    roundNo: number;
    payers: PayerSplit[];
    toName: string;
    amountTotal: number;
    note: string | null;
    createdAt: number;
    undone?: boolean;
  }[];
  draws: {
    roundNo: number;
    playerName: string;
    cardText: string;
    category: string;
  }[];
}

export interface StatsItem {
  name: string;
  games: number;
  total: number;
  wins: number;
}

/** 个人盈亏趋势的单场数据点（按时间升序） */
export interface TrendPoint {
  gameId: number;
  startedAt: number;
  score: number;
}
