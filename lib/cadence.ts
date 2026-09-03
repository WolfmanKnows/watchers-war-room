import { FLOORS } from "./address-book";
import type { CadenceReminder } from "./types";

function utcDayOfYear(date: Date): number {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  return Math.floor((date.getTime() - start) / 86_400_000);
}

function takeFloors(start: number, count: number): string[] {
  const labels: string[] = [];
  for (let i = 0; i < count; i++) {
    const floor = FLOORS[(start + i) % FLOORS.length];
    labels.push(floor.label);
  }
  return labels;
}

export function cadenceFor(date: Date = new Date()): CadenceReminder {
  const hour = date.getUTCHours();
  const session: "AM" | "PM" = hour < 12 ? "AM" : "PM";
  const seed = utcDayOfYear(date) * 5;
  const sessionOffset = session === "AM" ? 0 : 10;
  const listStart = (seed + sessionOffset) % FLOORS.length;
  const buyStart = (seed + sessionOffset + 5) % FLOORS.length;

  return {
    title: "Cadence reminder",
    rule: "5 list / 5 buy, twice a day, rotated",
    session,
    window: session === "AM" ? "00:00–12:00 UTC" : "12:00–24:00 UTC",
    listFloors: takeFloors(listStart, 5),
    buyFloors: takeFloors(buyStart, 5),
    note: "Display only. This site cannot list, buy, or sign. Do not treat the rotation as an order to cross the book.",
  };
}
