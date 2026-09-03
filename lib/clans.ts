import { FLOORS } from "./address-book";
import { floorNumber } from "./allocation";
import type {
  ClanDefinition,
  ClanId,
  ClanScore,
  ClanSeat,
  ClanWar,
  DeskEvent,
  ExtraClanSlot,
  HateChart,
  HatePair,
  HateRow,
  WalletSnapshot,
} from "./types";

export const CLAN_NOTE =
  "Volume war. Highest filled open-market Watchers count wins. Lists do not score. Desk-to-desk is an incidental cross, not a point. PnL is shown and does not pick the winner. Overpaying outsiders is allowed. View only — this site cannot send, match, or sign.";

export const BOTS_PER_CLAN = 5;
export const CLAN_SEED_ATOM = 10;
export const BUY_WALLETS_PER_CLAN = 3;
export const LIST_WALLETS_PER_CLAN = 2;
export const BUY_SEED_ATOM = 3.2;
export const LIST_SEED_ATOM = 0.2;

export const SEED_NOTE =
  "Fair-start seed: 10 ATOM to enter a clan — 3 buy wallets × 3.2 ATOM and 2 list wallets × 0.2 ATOM. Late clans get the same 10 ATOM seed even if existing clans already spent. View only — say \u201cadd a team\u201d in chat. This board does not mint, fund, or move ATOM.";

type NamedHouse = {
  id: ClanId;
  name: string;
  epithet: string;
  color: string;
  ink: string;
};

export const NAMED_HOUSES: NamedHouse[] = [
  { id: "pale-choir", name: "Pale Choir", epithet: "First breath", color: "#f4efe6", ink: "#1a1612" },
  { id: "ash-veil", name: "Ash Veil", epithet: "Smoke house", color: "#c4b7a6", ink: "#1a1612" },
  { id: "red-orbit", name: "Red Orbit", epithet: "Blood path", color: "#ff4d4d", ink: "#140404" },
  { id: "black-meridian", name: "Black Meridian", epithet: "Night cut", color: "#7b6cff", ink: "#07060f" },
  { id: "void-banner", name: "Void Banner", epithet: "Last flag", color: "#c86bff", ink: "#0c0414" },
];

const EXTRA_COLORS = ["#5ce1e6", "#7dff9a", "#ff9f43", "#4ecdc4", "#ffe66d"];

export function sortFloorIds(ids: readonly string[]): string[] {
  return [...ids].filter((id) => floorNumber(id) != null).sort((a, b) => (floorNumber(a) ?? 0) - (floorNumber(b) ?? 0));
}

type ClanSeatRoleAndSeed = Pick<ClanSeat, "role" | "seedAtom">;

export function seatForIndex(index: number): ClanSeatRoleAndSeed {
  if (index < BUY_WALLETS_PER_CLAN) return { role: "buy", seedAtom: BUY_SEED_ATOM };
  return { role: "list", seedAtom: LIST_SEED_ATOM };
}

function padFloor(n: number): string {
  return String(n).padStart(2, "0");
}

function rangeLabel(floors: string[]): string {
  const nums = floors.map((id) => floorNumber(id)).filter((n): n is number => n != null);
  if (nums.length === 0) return "";
  return `${padFloor(nums[0])}–${padFloor(nums[nums.length - 1])}`;
}

function houseForIndex(index: number): NamedHouse {
  const named = NAMED_HOUSES[index];
  if (named) return named;
  const n = index + 1;
  return {
    id: `clan-${n}`,
    name: `Clan ${n}`,
    epithet: "Unnamed house",
    color: EXTRA_COLORS[(index - NAMED_HOUSES.length) % EXTRA_COLORS.length],
    ink: "#07070c",
  };
}

function seatsFor(floors: string[]): ClanSeat[] {
  return floors.map((floorId, index) => {
    const { role, seedAtom } = seatForIndex(index);
    return { floorId, role, seedAtom };
  });
}

export function clansFromFloorIds(floorIds: readonly string[]): ClanDefinition[] {
  const sorted = sortFloorIds(floorIds);
  const complete = Math.floor(sorted.length / BOTS_PER_CLAN);
  const clans: ClanDefinition[] = [];
  for (let i = 0; i < complete; i += 1) {
    const floors = sorted.slice(i * BOTS_PER_CLAN, (i + 1) * BOTS_PER_CLAN);
    const house = houseForIndex(i);
    clans.push({ ...house, floors, range: rangeLabel(floors), seats: seatsFor(floors), seedTargetAtom: CLAN_SEED_ATOM });
  }
  return clans;
}

export function leftoverFloorIds(floorIds: readonly string[]): string[] {
  const sorted = sortFloorIds(floorIds);
  const complete = Math.floor(sorted.length / BOTS_PER_CLAN) * BOTS_PER_CLAN;
  return sorted.slice(complete);
}

export function bookFloorIds(): string[] {
  return FLOORS.map((wallet) => wallet.id);
}

export const CLANS = clansFromFloorIds(bookFloorIds());

export function nextClanSlot(floorIds: readonly string[] = bookFloorIds()): ExtraClanSlot {
  const leftover = leftoverFloorIds(floorIds);
  return {
    title: "Next clan",
    neededBots: BOTS_PER_CLAN,
    haveBots: leftover.length,
    leftoverFloorIds: leftover,
    seedTargetAtom: CLAN_SEED_ATOM,
    buyWallets: BUY_WALLETS_PER_CLAN,
    listWallets: LIST_WALLETS_PER_CLAN,
    buySeedAtom: BUY_SEED_ATOM,
    listSeedAtom: LIST_SEED_ATOM,
    note: SEED_NOTE,
  };
}

const byFloor = new Map<string, ClanDefinition>();
for (const clan of CLANS) {
  for (const id of clan.floors) byFloor.set(id, clan);
}

export function clanForWalletId(id: string | undefined | null): ClanDefinition | undefined {
  if (!id) return undefined;
  return byFloor.get(id);
}

export function clanForFloorNumber(n: number | null): ClanDefinition | undefined {
  if (n == null) return undefined;
  return CLANS.find((clan) => clan.floors.some((id) => floorNumber(id) === n));
}

export function groupFloorsByClan(floors: WalletSnapshot[]): { clan: ClanDefinition; wallets: WalletSnapshot[] }[] {
  return CLANS.map((clan) => ({
    clan,
    wallets: floors.filter((w) => w.clanId === clan.id),
  })).filter((group) => group.wallets.length > 0);
}

export function clanIdForWallet(id: string): ClanId | null {
  if (id === "treasury") return null;
  return clanForWalletId(id)?.id ?? null;
}

export function utcDayBounds(date = new Date()): { start: number; end: number } {
  const start = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return { start, end: start + 86_400_000 };
}

export function utcWeekBounds(date = new Date()): { start: number; end: number } {
  const day = date.getUTCDay();
  const daysFromMonday = (day + 6) % 7;
  const start = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - daysFromMonday * 86_400_000;
  return { start, end: start + 7 * 86_400_000 };
}

function cashForClan(clan: ClanDefinition, wallets: WalletSnapshot[]): { cashAtom: number | null; seats: ClanScore["seats"] } {
  const byId = new Map(wallets.map((wallet) => [wallet.id, wallet]));
  let cash = 0;
  let known = 0;
  const seats = clan.seats.map((seat) => {
    const atom = byId.get(seat.floorId)?.atom ?? null;
    if (atom != null) {
      cash += atom;
      known += 1;
    }
    return {
      ...seat,
      atom,
      seedGapAtom: atom == null ? null : Math.max(0, Number((seat.seedAtom - atom).toFixed(3))),
    };
  });
  return {
    cashAtom: known === 0 ? null : Number(cash.toFixed(3)),
    seats,
  };
}

function emptyScore(clan: ClanDefinition, wallets: WalletSnapshot[]): ClanScore {
  const { cashAtom, seats } = cashForClan(clan, wallets);
  return {
    id: clan.id,
    name: clan.name,
    epithet: clan.epithet,
    range: clan.range,
    floors: clan.floors,
    color: clan.color,
    dailyFills: 0,
    weeklyFills: 0,
    dailyPnlAtom: 0,
    weeklyPnlAtom: 0,
    dailyWinner: false,
    weeklyWinner: false,
    cashAtom,
    seedTargetAtom: clan.seedTargetAtom,
    seedGapAtom: cashAtom == null ? null : Math.max(0, Number((clan.seedTargetAtom - cashAtom).toFixed(3))),
    seats,
  };
}

function inRange(at: string, start: number, end: number): boolean {
  const t = Date.parse(at);
  return Number.isFinite(t) && t >= start && t < end;
}

type HateInput = { id: string; name: string; color: string; fills: number };

function trimPct(n: number): number {
  return Number(n.toFixed(3));
}

export function computeHateChart(clans: HateInput[]): HateRow[] {
  const total = clans.reduce((sum, clan) => sum + clan.fills, 0);
  return clans.map((a) => {
    const others = clans.filter((b) => b.id !== a.id);
    const othersSum = others.reduce((sum, b) => sum + b.fills, 0);
    return {
      clanId: a.id,
      name: a.name,
      color: a.color,
      fills: a.fills,
      totalHatePct: trimPct(100 - (100 * a.fills) / Math.max(total, 1)),
      rivals: others.map((b) => ({
        clanId: b.id,
        name: b.name,
        color: b.color,
        fills: b.fills,
        hatePct: others.length === 0 ? 0 : othersSum === 0 ? trimPct(100 / others.length) : trimPct((100 * b.fills) / othersSum),
      })),
    };
  });
}

function hateChartFromScores(clans: ClanScore[], window: "daily" | "weekly", label: string): HateChart {
  const fillsOf = (clan: ClanScore) => (window === "daily" ? clan.dailyFills : clan.weeklyFills);
  const rows = computeHateChart(clans.map((clan) => ({ id: clan.id, name: clan.name, color: clan.color, fills: fillsOf(clan) })));
  return { window, label, scoredFills: clans.reduce((sum, clan) => sum + fillsOf(clan), 0), rows };
}

function hatePairsFromChart(chart: HateChart): { pairs: HatePair[]; total: number } {
  const pairs: HatePair[] = [];
  for (const row of chart.rows) {
    for (const rival of row.rivals) {
      if (row.clanId < rival.clanId) {
        pairs.push({ a: row.clanId, b: rival.clanId, aName: row.name, bName: rival.name, pct: rival.hatePct });
      }
    }
  }
  const total = chart.rows.length === 0 ? 0 : trimPct(chart.rows.reduce((sum, row) => sum + row.totalHatePct, 0) / chart.rows.length);
  return { pairs, total };
}

export function scoreClanWar(
  events: DeskEvent[],
  now = new Date(),
  wallets: WalletSnapshot[] = [],
  floorIds: readonly string[] = bookFloorIds(),
): ClanWar {
  const clansDef = clansFromFloorIds(floorIds);
  const day = utcDayBounds(now);
  const week = utcWeekBounds(now);
  const scores = new Map(clansDef.map((c) => [c.id, emptyScore(c, wallets)]));
  const scored = events.filter((e) => e.scored && e.clanId);
  for (const event of scored) {
    const row = scores.get(event.clanId!);
    if (!row) continue;
    const pnl = event.pnlAtom ?? 0;
    if (inRange(event.at, week.start, week.end)) {
      row.weeklyFills += 1;
      row.weeklyPnlAtom += pnl;
    }
    if (inRange(event.at, day.start, day.end)) {
      row.dailyFills += 1;
      row.dailyPnlAtom += pnl;
    }
  }
  const clans = clansDef.map((c) => scores.get(c.id)!);
  const dailyMax = Math.max(0, ...clans.map((c) => c.dailyFills));
  const weeklyMax = Math.max(0, ...clans.map((c) => c.weeklyFills));
  for (const clan of clans) {
    clan.dailyWinner = dailyMax > 0 && clan.dailyFills === dailyMax;
    clan.weeklyWinner = weeklyMax > 0 && clan.weeklyFills === weeklyMax;
  }
  const hate = hateChartFromScores(clans, "weekly", "UTC week scored fills");
  const hateDaily = hateChartFromScores(clans, "daily", "UTC day scored fills");
  const pairs = hatePairsFromChart(hate);
  return {
    note: CLAN_NOTE,
    daily: {
      label: "UTC day",
      start: new Date(day.start).toISOString(),
      end: new Date(day.end).toISOString(),
      winnerIds: clans.filter((c) => c.dailyWinner).map((c) => c.id),
    },
    weekly: {
      label: "UTC week (Mon–Sun)",
      start: new Date(week.start).toISOString(),
      end: new Date(week.end).toISOString(),
      winnerIds: clans.filter((c) => c.weeklyWinner).map((c) => c.id),
    },
    clans,
    scoredFills: scored.length,
    hatePairs: pairs.pairs,
    totalHatePct: pairs.total,
    hate,
    hateDaily,
    extra: nextClanSlot(floorIds),
  };
}
