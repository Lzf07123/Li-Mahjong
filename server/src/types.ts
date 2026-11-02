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
}

export interface RoomFeatures {
  /** 记分 */
  score: boolean;
  /** 条件卡 */
  cards: boolean;
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
