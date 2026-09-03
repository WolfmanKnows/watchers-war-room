"use client";

import { useEffect, useRef } from "react";
import type { ClanScore, DeskEvent, DeskSnapshot, WalletSnapshot } from "@/lib/types";

type Props = {
  data: DeskSnapshot;
  focusClan: string;
  compact?: boolean;
  onSelect: (id: string) => void;
};

type Unit = {
  id: string;
  clanId: string;
  color: string;
  homeX: number;
  homeY: number;
  x: number;
  y: number;
  phase: number;
  listed: boolean;
  tokenId?: string;
  price?: number;
  size: number;
};

type Chip = {
  x: number;
  y: number;
  vy: number;
  life: number;
  text: string;
  color: string;
};

const CAMPS = [
  { x: 0.16, y: 0.2 },
  { x: 0.84, y: 0.2 },
  { x: 0.12, y: 0.58 },
  { x: 0.88, y: 0.58 },
  { x: 0.3, y: 0.86 },
];

const BOOK = { x: 0.5, y: 0.42 };
const VAULT = { x: 0.5, y: 0.58 };
const THRONE = { x: 0.78, y: 0.86 };

export function BattleCanvas({ data, focusClan, compact, onSelect }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const unitsRef = useRef<Unit[]>([]);
  const chipsRef = useRef<Chip[]>([]);
  const clickRef = useRef(onSelect);
  clickRef.current = onSelect;

  useEffect(() => {
    const floors = data.wallets.filter((wallet) => wallet.role === "floor");
    unitsRef.current = buildUnits(floors, data.war.clans);
    const seen = new Set<string>();
    chipsRef.current = data.events
      .filter((event) => event.scored && !event.incidentalCross)
      .slice(0, 8)
      .map((event, i) => chipFromFill(event, data.war.clans, i, seen));
  }, [data]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let last = performance.now();
    const hit: { id: string; x: number; y: number; r: number }[] = [];

    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(320, Math.floor(rect.width * dpr));
      canvas.height = Math.max(180, Math.floor(rect.height * dpr));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      stepUnits(unitsRef.current, dt, now / 1000);
      stepChips(chipsRef.current, dt);
      maybeReplayFills(chipsRef.current, data.events, data.war.clans, now);
      drawField(ctx, canvas, unitsRef.current, chipsRef.current, data, focusClan, hit);
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);

    const onClick = (event: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width) * canvas.width;
      const y = ((event.clientY - rect.top) / rect.height) * canvas.height;
      const hitUnit = [...hit].reverse().find((u) => Math.hypot(u.x - x, u.y - y) <= u.r);
      if (hitUnit) clickRef.current(hitUnit.id);
    };
    canvas.addEventListener("click", onClick);

    return () => {
      window.cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("click", onClick);
    };
  }, [data, focusClan]);

  return (
    <div ref={wrapRef} className={`battle-stage ${compact ? "battle-stage-mobile" : "battle-stage-desktop"}`}>
      <canvas ref={canvasRef} className="battle-canvas" />
    </div>
  );
}

function buildUnits(floors: WalletSnapshot[], clans: ClanScore[]): Unit[] {
  const units: Unit[] = [];
  clans.forEach((clan, clanIndex) => {
    const camp = CAMPS[clanIndex] ?? CAMPS[clanIndex % CAMPS.length];
    const members = floors.filter((wallet) => wallet.clanId === clan.id);
    const hate = clan.weeklyFills + (clan.dailyFills ?? 0);
    members.forEach((wallet, i) => {
      const ring = 0.034 + (i % 5) * 0.004;
      const angle = (i / Math.max(1, members.length)) * Math.PI * 2;
      const homeX = camp.x + Math.cos(angle) * ring;
      const homeY = camp.y + Math.sin(angle) * ring * 0.72;
      const ask = wallet.listedAsks[0];
      units.push({
        id: wallet.id,
        clanId: clan.id,
        color: clan.color,
        homeX,
        homeY,
        x: homeX,
        y: homeY,
        phase: i * 0.9 + clanIndex,
        listed: (wallet.listed ?? 0) > 0 || wallet.listedAsks.length > 0,
        tokenId: ask?.tokenId,
        price: ask?.priceAtom,
        size: 5 + Math.min(4, hate),
      });
    });
  });
  return units;
}

function stepUnits(units: Unit[], dt: number, t: number) {
  for (const unit of units) {
    if (unit.listed) {
      const pulse = (Math.sin(t * 1.35 + unit.phase) + 1) / 2;
      const charge = 0.18 + pulse * 0.62;
      unit.x = unit.homeX + (BOOK.x - unit.homeX) * charge;
      unit.y = unit.homeY + (BOOK.y - unit.homeY) * charge;
    } else {
      unit.x = unit.homeX + Math.sin(t * 2.1 + unit.phase) * 0.012;
      unit.y = unit.homeY + Math.cos(t * 1.7 + unit.phase) * 0.01;
    }
    void dt;
  }
}

function stepChips(chips: Chip[], dt: number) {
  for (const chip of chips) {
    chip.y += chip.vy * dt;
    chip.life -= dt;
  }
  for (let i = chips.length - 1; i >= 0; i -= 1) {
    if (chips[i].life <= 0) chips.splice(i, 1);
  }
}

function maybeReplayFills(chips: Chip[], events: DeskEvent[], clans: ClanScore[], now: number) {
  const fills = events.filter((event) => event.scored && !event.incidentalCross);
  if (fills.length === 0 || chips.length > 10) return;
  if (Math.floor(now / 2200) === Math.floor((now - 16) / 2200)) return;
  const event = fills[Math.floor(now / 2200) % fills.length];
  chips.push(chipFromFill(event, clans, chips.length, new Set()));
}

function chipFromFill(event: DeskEvent, clans: ClanScore[], i: number, seen: Set<string>): Chip {
  const clan = clans.find((row) => row.id === event.clanId);
  const camp = CAMPS[Math.max(0, clans.findIndex((row) => row.id === event.clanId))] ?? CAMPS[0];
  seen.add(event.id);
  return {
    x: camp.x + (BOOK.x - camp.x) * 0.55,
    y: camp.y + (BOOK.y - camp.y) * 0.55 - i * 0.02,
    vy: -0.08,
    life: 3.2,
    text: `${event.priceAtom != null ? event.priceAtom.toFixed(2) : "fill"} ATOM`,
    color: clan?.color ?? "#ffd166",
  };
}

function drawField(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  units: Unit[],
  chips: Chip[],
  data: DeskSnapshot,
  focusClan: string,
  hit: { id: string; x: number; y: number; r: number }[],
) {
  const w = canvas.width;
  const h = canvas.height;
  hit.length = 0;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#07080d";
  ctx.fillRect(0, 0, w, h);

  const cell = Math.max(8, Math.floor(w / 48));
  ctx.fillStyle = "rgba(255, 209, 102, 0.05)";
  for (let x = 0; x < w; x += cell) ctx.fillRect(x, 0, 1, h);
  for (let y = 0; y < h; y += cell) ctx.fillRect(0, y, w, 1);

  const px = (n: number) => n * w;
  const py = (n: number) => n * h;

  data.war.clans.forEach((clan, i) => {
    const camp = CAMPS[i] ?? CAMPS[i % CAMPS.length];
    const dim = focusClan !== "all" && focusClan !== clan.id;
    ctx.globalAlpha = dim ? 0.28 : 1;
    ctx.strokeStyle = clan.color;
    ctx.lineWidth = 3;
    const cw = w * 0.11;
    const ch = h * 0.14;
    ctx.fillStyle = `${clan.color}33`;
    ctx.fillRect(px(camp.x) - cw / 2, py(camp.y) - ch / 2, cw, ch);
    ctx.strokeRect(px(camp.x) - cw / 2, py(camp.y) - ch / 2, cw, ch);
    ctx.fillStyle = clan.color;
    ctx.font = `${Math.max(10, Math.floor(w / 90))}px ui-monospace, monospace`;
    ctx.textAlign = "center";
    ctx.fillText(clan.name.toUpperCase(), px(camp.x), py(camp.y) - ch / 2 - 6);
    ctx.globalAlpha = 1;
  });

  ctx.globalAlpha = 0.55;
  ctx.strokeStyle = "#5a5346";
  ctx.setLineDash([4, 4]);
  ctx.strokeRect(px(THRONE.x) - w * 0.05, py(THRONE.y) - h * 0.06, w * 0.1, h * 0.12);
  ctx.setLineDash([]);
  ctx.fillStyle = "#9a9384";
  ctx.font = `${Math.max(9, Math.floor(w / 100))}px ui-monospace, monospace`;
  ctx.textAlign = "center";
  ctx.fillText("EMPTY THRONE", px(THRONE.x), py(THRONE.y) + h * 0.08);
  ctx.globalAlpha = 1;

  ctx.fillStyle = "rgba(255, 209, 102, 0.16)";
  ctx.fillRect(px(BOOK.x) - w * 0.07, py(BOOK.y) - h * 0.05, w * 0.14, h * 0.1);
  ctx.strokeStyle = "#ffd166";
  ctx.lineWidth = 3;
  ctx.strokeRect(px(BOOK.x) - w * 0.07, py(BOOK.y) - h * 0.05, w * 0.14, h * 0.1);
  ctx.fillStyle = "#ffd166";
  ctx.fillText("OPEN BOOK", px(BOOK.x), py(BOOK.y) - 4);
  ctx.fillText(data.book.floorAtom == null ? "—" : `${data.book.floorAtom.toFixed(2)} ATOM`, px(BOOK.x), py(BOOK.y) + 12);

  const treasury = data.wallets.find((wallet) => wallet.role === "treasury");
  ctx.fillStyle = "rgba(255, 209, 102, 0.22)";
  ctx.fillRect(px(VAULT.x) - w * 0.045, py(VAULT.y) - h * 0.04, w * 0.09, h * 0.08);
  ctx.strokeStyle = "#ffd166";
  ctx.strokeRect(px(VAULT.x) - w * 0.045, py(VAULT.y) - h * 0.04, w * 0.09, h * 0.08);
  ctx.fillStyle = "#fff3c4";
  ctx.fillText("VAULT", px(VAULT.x), py(VAULT.y) - 2);
  ctx.fillText(treasury?.atom == null ? "—" : `${treasury.atom.toFixed(1)}`, px(VAULT.x), py(VAULT.y) + 12);

  for (const unit of units) {
    const dim = focusClan !== "all" && focusClan !== unit.clanId;
    ctx.globalAlpha = dim ? 0.25 : 1;
    const x = px(unit.x);
    const y = py(unit.y);
    const s = unit.size * (w / 520);
    if (unit.listed) {
      ctx.strokeStyle = "#ffd166";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(px(BOOK.x), py(BOOK.y));
      ctx.stroke();
    }
    ctx.fillStyle = "#000";
    ctx.fillRect(x - s / 2 + 2, y - s / 2 + 2, s, s);
    ctx.fillStyle = unit.color;
    ctx.fillRect(x - s / 2, y - s / 2, s, s);
    if (unit.listed) {
      ctx.strokeStyle = "#ffd166";
      ctx.strokeRect(x - s / 2 - 1, y - s / 2 - 1, s + 2, s + 2);
    }
    hit.push({ id: unit.id, x, y, r: s + 6 });
    ctx.globalAlpha = 1;
  }

  ctx.textAlign = "center";
  ctx.font = `bold ${Math.max(11, Math.floor(w / 70))}px ui-monospace, monospace`;
  for (const chip of chips) {
    ctx.globalAlpha = Math.max(0, Math.min(1, chip.life / 1.4));
    ctx.fillStyle = chip.color;
    ctx.fillText(chip.text, px(chip.x), py(chip.y));
  }
  ctx.globalAlpha = 1;
}
