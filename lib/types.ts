export type WalletRole = "treasury" | "floor";

export type ClanId = string;

export type ClanSeatRole = "buy" | "list";

export type ClanSeat = {
  floorId: string;
  role: ClanSeatRole;
  seedAtom: number;
};

export type ClanDefinition = {
  id: ClanId;
  name: string;
  epithet: string;
  floors: string[];
  range: string;
  color: string;
  ink: string;
  seats: ClanSeat[];
  seedTargetAtom: number;
};

export type ClanSeatScore = ClanSeat & {
  atom: number | null;
  seedGapAtom: number | null;
};

export type ClanScore = {
  id: ClanId;
  name: string;
  epithet: string;
  range: string;
  floors: string[];
  color: string;
  dailyFills: number;
  weeklyFills: number;
  dailyPnlAtom: number;
  weeklyPnlAtom: number;
  dailyWinner: boolean;
  weeklyWinner: boolean;
  cashAtom: number | null;
  seedTargetAtom: number;
  seedGapAtom: number | null;
  seats: ClanSeatScore[];
};

export type ClanWindow = {
  label: string;
  start: string;
  end: string;
  winnerIds: ClanId[];
};

export type HatePair = {
  a: ClanId;
  b: ClanId;
  aName: string;
  bName: string;
  pct: number;
};

export type HateRival = {
  clanId: ClanId;
  name: string;
  color: string;
  fills: number;
  hatePct: number;
};

export type HateRow = {
  clanId: ClanId;
  name: string;
  color: string;
  fills: number;
  totalHatePct: number;
  rivals: HateRival[];
};

export type HateChart = {
  window: "daily" | "weekly";
  label: string;
  scoredFills: number;
  rows: HateRow[];
};

export type ExtraClanSlot = {
  title: string;
  neededBots: number;
  haveBots: number;
  leftoverFloorIds: string[];
  seedTargetAtom: number;
  buyWallets: number;
  listWallets: number;
  buySeedAtom: number;
  listSeedAtom: number;
  note: string;
};

export type ClanWar = {
  note: string;
  daily: ClanWindow;
  weekly: ClanWindow;
  clans: ClanScore[];
  scoredFills: number;
  hatePairs: HatePair[];
  totalHatePct: number;
  hate: HateChart;
  hateDaily: HateChart;
  extra: ExtraClanSlot;
};

export type ActionKind = "list" | "buy" | "move" | "fund" | "other";

export type AllocationLane = "above" | "floor" | "gas" | "reserve";

export type Allocation = {
  lane: AllocationLane;
  title: string;
  short: string;
  targetAtom: number | null;
  purpose: string;
};

export type WalletBookEntry = {
  id: string;
  label: string;
  role: WalletRole;
  stars: string;
  cosmos: string;
};

export type LastAction = {
  kind: ActionKind;
  at: string;
  summary: string;
} | null;

export type FloorAsk = {
  tokenId: string;
  priceAtom: number;
  creator: string;
  creatorLabel?: string;
  ourAsk: boolean;
  clanId?: ClanId;
};

export type WalletSnapshot = {
  id: string;
  label: string;
  role: WalletRole;
  cosmos: string;
  stars: string;
  atom: number | null;
  starsAmount: number | null;
  watchers: number | null;
  listed: number | null;
  held: number | null;
  lastAction: LastAction;
  status: "active" | "idle" | "error";
  error?: string;
  tokenIds: string[];
  listedAsks: FloorAsk[];
  allocation: Allocation;
  clanId: ClanId | null;
};

export type DeskEvent = {
  id: string;
  at: string;
  kind: ActionKind;
  summary: string;
  walletIds: string[];
  tokenId?: string;
  priceLabel?: string;
  txhash: string;
  incidentalCross: boolean;
  counterpartyLabel?: string;
  scored: boolean;
  side?: "buy" | "sell";
  priceAtom?: number;
  pnlAtom?: number;
  clanId?: ClanId;
  outsider?: string;
};

export type CollectionSnapshot = {
  name: string;
  fullName: string;
  contract: string;
  url: string;
  supply: number | null;
  floorAtom: number | null;
  listedCount: number | null;
  listedCapped: boolean;
  ourHoldings: number;
  ourListed: number;
  ourHeld: number;
  ourSharePct: number | null;
  ourAsksAreNotBuyTargets: true;
};

export type OpenBook = {
  asks: FloorAsk[];
  floorAtom: number | null;
  ourFloorTokenId: string | null;
};

export type CadenceReminder = {
  title: string;
  rule: string;
  session: "AM" | "PM";
  window: string;
  listFloors: string[];
  buyFloors: string[];
  note: string;
};

export type DeskSnapshot = {
  fetchedAt: string;
  pollSeconds: number;
  viewOnly: true;
  collection: CollectionSnapshot;
  wallets: WalletSnapshot[];
  events: DeskEvent[];
  book: OpenBook;
  cadence: CadenceReminder;
  war: ClanWar;
  sources: string[];
  warnings: string[];
};
