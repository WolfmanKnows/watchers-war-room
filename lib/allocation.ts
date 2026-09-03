import type { Allocation, AllocationLane, WalletSnapshot } from "./types";

const FLOOR_ID = /^floor-(\d+)$/;

export const ALLOCATION_NOTE =
  "Display only. Floor is under 3 ATOM, so not every wallet can buy. This site cannot send, list, buy, or match.";

const ABOVE: Allocation = {
  lane: "above",
  title: "Bigger buy",
  short: "ABOVE",
  targetAtom: 4,
  purpose: "Above floor, leftover gas",
};

const FLOOR: Allocation = {
  lane: "floor",
  title: "Floor take",
  short: "FLOOR",
  targetAtom: 3.2,
  purpose: "Can take floor + leftover gas",
};

const GAS: Allocation = {
  lane: "gas",
  title: "Gas only",
  short: "GAS",
  targetAtom: 0.15,
  purpose: "List / later",
};

const RESERVE: Allocation = {
  lane: "reserve",
  title: "Top-up reserve",
  short: "TOP-UP",
  targetAtom: null,
  purpose: "Keeps remainder for top-ups",
};

export const ALLOCATION_LANES: Allocation[] = [ABOVE, FLOOR, GAS, RESERVE];

export function floorNumber(id: string): number | null {
  const match = id.match(FLOOR_ID);
  if (!match) return null;
  return Number(match[1]);
}

export function allocationForId(id: string): Allocation {
  if (id === "treasury") return RESERVE;
  const n = floorNumber(id);
  if (n != null && n >= 1 && n <= 5) return ABOVE;
  if (n != null && n >= 6 && n <= 8) return FLOOR;
  return GAS;
}

export function groupFloorsByLane(floors: WalletSnapshot[]): {
  lane: AllocationLane;
  title: string;
  hint: string;
  wallets: WalletSnapshot[];
}[] {
  const above = floors.filter((w) => w.allocation.lane === "above");
  const floor = floors.filter((w) => w.allocation.lane === "floor");
  const gas = floors.filter((w) => w.allocation.lane === "gas");
  return [
    {
      lane: "above",
      title: "01–05 · bigger buy",
      hint: "~4 ATOM each",
      wallets: above,
    },
    {
      lane: "floor",
      title: "06–08 · floor take",
      hint: "~3.2 ATOM + gas",
      wallets: floor,
    },
    {
      lane: "gas",
      title: "09–25 · gas only",
      hint: "~0.15 ATOM · list / later",
      wallets: gas,
    },
  ];
}

export function coversLiveFloor(
  atom: number | null | undefined,
  floorAtom: number | null | undefined,
  lane: AllocationLane,
): "covers" | "short" | "gas" | "reserve" | "unknown" {
  if (lane === "reserve") return "reserve";
  if (lane === "gas") return "gas";
  if (atom == null || floorAtom == null || Number.isNaN(atom) || Number.isNaN(floorAtom)) {
    return "unknown";
  }
  return atom + 1e-9 >= floorAtom ? "covers" : "short";
}
