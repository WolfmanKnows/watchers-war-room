import type { ActionKind } from "./types";

export function formatAtom(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  const digits = n >= 100 ? 1 : n >= 1 ? 2 : 3;
  return n.toLocaleString("en-US", { maximumFractionDigits: digits });
}

export function timeAgo(iso: string | undefined, now: number = Date.now()): string {
  if (!iso) return "—";
  const delta = Math.max(0, now - Date.parse(iso));
  const sec = Math.floor(delta / 1000);
  if (sec < 45) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 36) return `${hr}h`;
  const day = Math.floor(hr / 24);
  return `${day}d`;
}

export function kindTone(kind: ActionKind | "cross"): string {
  if (kind === "list") return "text-gold";
  if (kind === "buy") return "text-green";
  if (kind === "move") return "text-cyan";
  if (kind === "cross") return "text-magenta";
  return "text-ink";
}

export function mintscanTx(hash: string): string {
  return `https://www.mintscan.io/cosmos/tx/${hash}`;
}

export function mintscanAccount(addr: string): string {
  return `https://www.mintscan.io/cosmos/address/${addr}`;
}
