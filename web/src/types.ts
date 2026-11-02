export type Category = 'voice' | 'action' | 'hu' | 'rule' | 'info' | 'global';

export interface PlayerView {
  id: string;
  name: string;
  seat: string;
  score: number;
  connected: boolean;
  isHost: boolean;
  hasCard: boolean;
  cardRevealed: boolean;
  cardText: string | null;
  cardCategory: Category | null;
}

export interface PayerSplit {
  name: string;
  amount: number;
}

export interface ScoreEntryView {
  id: number;
  roundNo: number;
  payers: PayerSplit[];
  toName: string;
  amountTotal: number;
  note?: string;
  createdBy: string;
  createdAt: number;
}

export interface RoomFeatures {
  score: boolean;
  cards: boolean;
}

export interface Snapshot {
  code: string;
  status: 'lobby' | 'playing';
  roundNo: number;
  rev: number;
  features: RoomFeatures;
  hostId: string;
  players: PlayerView[];
  entries: ScoreEntryView[];
  entryCount: number;
  usedOnceCardIds: string[];
  disabledCardIds: string[];
  disabledCategoryIds: string[];
  customCards: CardDef[];
}

export interface CardDef {
  id: string;
  text: string;
  category: Category;
  enabled?: boolean;
}

export interface CategoryMeta {
  id: Category;
  name: string;
  emoji: string;
}

export interface LibraryData {
  categories: CategoryMeta[];
  builtin: CardDef[];
  custom: (CardDef & { enabled: boolean })[];
}

export interface Standing {
  name: string;
  seat: string;
  score: number;
  isHost?: boolean;
}

export interface HistoryItem {
  id: number;
  code: string;
  status: string;
  startedAt: number;
  endedAt: number | null;
  players: { name: string; seat: string | null; finalScore: number }[];
}

export interface HistoryDetailData extends HistoryItem {
  features?: RoomFeatures;
  players: { name: string; seat: string | null; finalScore: number; isHost?: boolean }[];
  entries: {
    id: number;
    roundNo: number;
    payers: PayerSplit[];
    toName: string;
    amountTotal: number;
    note: string | null;
    createdAt: number;
  }[];
  draws: { roundNo: number; playerName: string; cardText: string; category: string }[];
}

export interface StatsItem {
  name: string;
  games: number;
  total: number;
  wins: number;
}

export type AckResp = { ok: boolean; error?: string } & Record<string, unknown>;
