import book from "./address-book.json";
import type { WalletBookEntry } from "./types";

export const COLLECTION = book.collection;
export const MARKETPLACE = book.marketplace;
export const WALLETS: WalletBookEntry[] = book.wallets as WalletBookEntry[];

export const TREASURY = WALLETS.find((w) => w.role === "treasury")!;
/** Floor wallets only. Complete groups of 5 become clans. Do not invent extras. */
export const FLOORS = WALLETS.filter((w) => w.role === "floor");

const byCosmos = new Map(WALLETS.map((w) => [w.cosmos, w]));
const byStars = new Map(WALLETS.map((w) => [w.stars, w]));

export const DESK_COSMOS = new Set(WALLETS.map((w) => w.cosmos));
export const DESK_STARS = new Set(WALLETS.map((w) => w.stars));

export function lookupWallet(address: string | undefined | null): WalletBookEntry | undefined {
  if (!address) return undefined;
  return byCosmos.get(address) ?? byStars.get(address);
}

export function isDeskAddress(address: string | undefined | null): boolean {
  return Boolean(lookupWallet(address));
}

export function shortAddr(address: string, head = 8, tail = 5): string {
  if (address.length <= head + tail + 1) return address;
  return `${address.slice(0, head)}…${address.slice(-tail)}`;
}
