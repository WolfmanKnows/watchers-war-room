"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  ALLOCATION_NOTE,
  allocationForId,
  coversLiveFloor,
} from "@/lib/allocation";
import {
  BOTS_PER_CLAN,
  BUY_SEED_ATOM,
  BUY_WALLETS_PER_CLAN,
  CLANS,
  CLAN_SEED_ATOM,
  LIST_SEED_ATOM,
  LIST_WALLETS_PER_CLAN,
  SEED_NOTE,
  clanForWalletId,
  groupFloorsByClan,
  seatForIndex,
} from "@/lib/clans";
import type {
  ActionKind,
  AllocationLane,
  ClanScore,
  DeskEvent,
  DeskSnapshot,
  ExtraClanSlot,
  WalletSnapshot,
} from "@/lib/types";
import { BattleCanvas } from "@/components/battle-canvas";
import { ScaleFit } from "@/components/scale-fit";
import { formatAtom, kindTone, mintscanAccount, mintscanTx, timeAgo } from "@/lib/format";

const DESKTOP_BOARD_W = 1440;
const DESKTOP_BOARD_H = 900;
const POLL_MS = 20_000;
const VIEW_KEY = "stargaze-desk-view";
const FILTER_KEY = "stargaze-desk-filters";

type ViewMode = "mobile" | "desktop";
type Flash = Record<string, ActionKind | "cross" | "score">;
type RoleFilter = "all" | "listed" | "held" | "idle" | "can-buy";
type TimeFilter = "live" | "daily" | "weekly";
type FeedFilter = "fills" | "lists" | "buys" | "all";
type DeskFilters = {
  clan: string;
  role: RoleFilter;
  time: TimeFilter;
  feed: FeedFilter;
  heat: boolean;
  book: boolean;
};

const DEFAULT_FILTERS: DeskFilters = {
  clan: "all",
  role: "all",
  time: "weekly",
  feed: "fills",
  heat: true,
  book: true,
};

function applyView(mode: ViewMode) {
  document.documentElement.dataset.view = mode;
  try {
    window.localStorage.setItem(VIEW_KEY, mode);
  } catch {
    /* private mode */
  }
}

export function DeskApp() {
  const [data, setData] = useState<DeskSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [selected, setSelected] = useState<string | null>("treasury");
  const [flash, setFlash] = useState<Flash>({});
  const [view, setView] = useState<ViewMode>("mobile");
  const [filters, setFilters] = useState<DeskFilters>(DEFAULT_FILTERS);

  useEffect(() => {
    const saved = window.localStorage.getItem(VIEW_KEY);
    const mode: ViewMode = saved === "desktop" ? "desktop" : "mobile";
    setView(mode);
    applyView(mode);
    try {
      const raw = window.localStorage.getItem(FILTER_KEY);
      if (raw) setFilters({ ...DEFAULT_FILTERS, ...JSON.parse(raw) });
    } catch {
      /* ignore */
    }
  }, []);

  function patchFilters(next: Partial<DeskFilters>) {
    setFilters((current) => {
      const merged = { ...current, ...next };
      try {
        window.localStorage.setItem(FILTER_KEY, JSON.stringify(merged));
      } catch {
        /* private mode */
      }
      return merged;
    });
  }

  function chooseView(mode: ViewMode) {
    setView(mode);
    applyView(mode);
  }

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll() {
      const controller = new AbortController();
      const abort = window.setTimeout(() => controller.abort(), 25_000);
      try {
        const res = await fetch("/api/desk", { cache: "no-store", signal: controller.signal });
        const body = (await res.json()) as DeskSnapshot & { error?: string };
        if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
        if (cancelled) return;
        setError(null);
        setData((current) => {
          applyFlashes(current, body, setFlash);
          return body;
        });
      } catch (err) {
        if (!cancelled) {
          const message =
            err instanceof Error && err.name === "AbortError"
              ? "LCD poll timed out — retrying Keplr"
              : err instanceof Error
                ? err.message
                : "poll failed";
          setError(message);
        }
      } finally {
        window.clearTimeout(abort);
        if (!cancelled) timer = setTimeout(poll, POLL_MS);
      }
    }

    void poll();
    const clock = setInterval(() => setNow(Date.now()), 15_000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearInterval(clock);
    };
  }, []);

  const selectedWallet = data?.wallets.find((w) => w.id === selected) ?? data?.wallets[0];
  const floors = data?.wallets.filter((w) => w.role === "floor") ?? [];
  const treasury = data?.wallets.find((w) => w.role === "treasury");
  const c = data?.collection;
  const scoredTicker = (data?.events ?? []).filter((e) => e.scored && !e.incidentalCross);

  const board = data ? (
    <WarBoard
      data={data}
      view={view}
      filters={filters}
      flash={flash}
      now={now}
      selected={selected}
      selectedWallet={selectedWallet}
      floors={floors}
      treasury={treasury}
      scoredTicker={scoredTicker}
      onSelect={setSelected}
      onFilters={patchFilters}
    />
  ) : (
    <LoadingState error={error} />
  );

  const chrome = (
    <header className="desk-header flex items-center justify-between gap-2 border-b-2 border-gold bg-black px-3 py-1.5">
      <div>
        <p className="num war-kicker text-[11px] tracking-[0.22em] text-gold uppercase">
          War room · view only · no keys
        </p>
        <h1 className="war-title text-3xl leading-none font-semibold">WAR ROOM</h1>
        {c ? (
          <p className="num text-[12px] text-ink">
            OUR BAG {c.ourHoldings}
            {c.supply != null ? ` / ${c.supply}` : ""} · listed {c.ourListed} escrow · floor{" "}
            {c.floorAtom == null ? "—" : `${formatAtom(c.floorAtom)} ATOM`}
            {c.ourSharePct != null ? ` · ${c.ourSharePct.toFixed(2)}%` : ""}
          </p>
        ) : null}
      </div>
      <div className="flex items-center gap-3">
        <LiveBadge fetchedAt={data?.fetchedAt} error={error} now={now} loading={!data && !error} />
        <ViewToggle view={view} onChange={chooseView} />
      </div>
    </header>
  );

  return (
    <div className={`war-room ${view === "desktop" ? "desk-desktop-fit" : "desk-mobile-stack"}`}>
      <div className="scanlines" />
      {view === "desktop" ? (
        <ScaleFit width={DESKTOP_BOARD_W} height={DESKTOP_BOARD_H}>
          <div className="desktop-board">
            {chrome}
            {board}
          </div>
        </ScaleFit>
      ) : (
        <div className="mobile-board px-3 pb-4">
          {chrome}
          {c ? <p className="num mt-2 text-sm text-gold">The Watchers · stacked war room</p> : null}
          {board}
        </div>
      )}
    </div>
  );
}

function WarBoard(props: {
  data: DeskSnapshot;
  view: ViewMode;
  filters: DeskFilters;
  flash: Flash;
  now: number;
  selected: string | null;
  selectedWallet?: WalletSnapshot;
  floors: WalletSnapshot[];
  treasury?: WalletSnapshot;
  scoredTicker: DeskEvent[];
  onSelect: (id: string) => void;
  onFilters: (next: Partial<DeskFilters>) => void;
}) {
  const { data, view, filters, flash, now, selected, selectedWallet, floors, treasury, scoredTicker, onSelect, onFilters } = props;
  return (
    <div className={view === "desktop" ? "desktop-spread" : "space-y-3"}>
      <div className="spread-ticker"><FillTicker events={scoredTicker} now={now} /></div>
      <div className="spread-map">
        <BattleCanvas data={data} focusClan={filters.clan} compact={view === "mobile"} onSelect={onSelect} />
      </div>
      <div className="spread-filters">
        <FilterBar filters={filters} onChange={onFilters} clans={data.war.clans} />
      </div>
      <div className="spread-clans min-h-0 overflow-auto">
        <ClanScoreboard data={data} now={now} view={view} filters={filters} onSelect={onSelect} />
        {filters.book ? <OpenBook data={data} filters={filters} /> : null}
        <NodeBoard treasury={treasury} floors={floors} selected={selected} flash={flash} now={now} floorAtom={data.collection.floorAtom} war={data.war} filters={filters} onSelect={onSelect} />
        {view === "mobile" && selectedWallet ? <WalletDetail wallet={selectedWallet} now={now} floorAtom={data.collection.floorAtom} /> : null}
        {view === "mobile" ? <AllocationCard floorAtom={data.collection.floorAtom} /> : null}
        {view === "mobile" ? <CadenceCard data={data} /> : null}
      </div>
      <div className="spread-feed min-h-0">
        <ActivityFeed events={data.events} now={now} feed={filters.feed} clan={filters.clan} onSelect={onSelect} />
      </div>
    </div>
  );
}

function ViewToggle({ view, onChange }: { view: ViewMode; onChange: (mode: ViewMode) => void }) {
  return (
    <nav aria-label="Layout" className="view-toggle shrink-0">
      <div className="flex overflow-hidden rounded-lg border-2 border-gold">
        <button type="button" onClick={() => onChange("mobile")} aria-pressed={view === "mobile"} className={`num min-h-12 min-w-[5.5rem] px-3 text-sm tracking-[0.12em] uppercase sm:text-base ${view === "mobile" ? "bg-gold text-black" : "bg-black text-gold"}`}>Mobile</button>
        <button type="button" onClick={() => onChange("desktop")} aria-pressed={view === "desktop"} className={`num min-h-12 min-w-[5.5rem] border-l-2 border-gold px-3 text-sm tracking-[0.12em] uppercase sm:text-base ${view === "desktop" ? "bg-gold text-black" : "bg-black text-gold"}`}>Desktop</button>
      </div>
    </nav>
  );
}

function applyFlashes(previous: DeskSnapshot | null, next: DeskSnapshot, setFlash: (value: Flash | ((f: Flash) => Flash)) => void) {
  const flashes: Flash = {};
  const seen = new Set(previous?.events.map((e) => e.id) ?? []);
  for (const event of next.events) {
    if (seen.has(event.id)) continue;
    const kind = event.incidentalCross ? "cross" : event.scored ? "score" : event.kind;
    for (const id of event.walletIds) flashes[id] = kind;
  }
  if (previous) {
    const before = new Map(previous.wallets.map((w) => [w.id, w]));
    for (const wallet of next.wallets) {
      const old = before.get(wallet.id);
      if (!old) continue;
      if ((wallet.listed ?? 0) > (old.listed ?? 0)) flashes[wallet.id] = flashes[wallet.id] ?? "list";
      if ((wallet.watchers ?? 0) > (old.watchers ?? 0)) flashes[wallet.id] = flashes[wallet.id] ?? "buy";
      if (old.tokenIds.join(",") !== wallet.tokenIds.join(",") && (wallet.watchers ?? 0) !== (old.watchers ?? 0)) {
        flashes[wallet.id] = flashes[wallet.id] ?? "move";
      }
    }
  }
  if (Object.keys(flashes).length === 0) return;
  setFlash((cur) => ({ ...cur, ...flashes }));
  window.setTimeout(() => {
    setFlash((cur) => {
      const copy = { ...cur };
      for (const id of Object.keys(flashes)) delete copy[id];
      return copy;
    });
  }, 3600);
}

function LiveBadge({ fetchedAt, error, now, loading }: { fetchedAt?: string; error: string | null; now: number; loading: boolean }) {
  return (
    <div className="panel rounded-2xl px-4 py-3 text-right">
      <div className="flex items-center justify-end gap-2">
        <span className={`inline-block h-2.5 w-2.5 rounded-full ${error ? "bg-magenta" : "bg-green ring"}`} />
        <span className="num text-sm tracking-[0.2em] uppercase">{loading ? "SYNC" : error ? "HOLD" : "LIVE"}</span>
      </div>
      <p className="num mt-1 text-xs text-muted">{error ? error : fetchedAt ? `polled ${timeAgo(fetchedAt, now)} · keplr LCD` : "first poll…"}</p>
    </div>
  );
}

function formatPnl(n: number): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${formatAtom(n)}`;
}

function LoadingState({ error }: { error: string | null }) {
  return (
    <section className="panel rounded-2xl p-8">
      <p className="num text-sm tracking-[0.2em] text-gold uppercase">{error ? "Poll failed" : "Opening the war room"}</p>
      <p className="mt-2 text-2xl">{error ?? "Reading lcd-cosmoshub.keplr.app — no demo fills."}</p>
    </section>
  );
}

function houseOf(clanId?: string | null) {
  if (!clanId) return undefined;
  return CLANS.find((clan) => clan.id === clanId);
}

function shortAddr(addr: string): string {
  if (addr.length <= 16) return addr;
  return `${addr.slice(0, 10)}…${addr.slice(-4)}`;
}

function roleMatch(wallet: WalletSnapshot, role: RoleFilter, floorAtom: number | null): boolean {
  if (role === "all") return true;
  if (role === "listed") return (wallet.listed ?? 0) > 0;
  if (role === "held") return (wallet.held ?? 0) > 0;
  if (role === "idle") return wallet.status === "idle";
  if (role === "can-buy") return coversLiveFloor(wallet.atom, floorAtom, wallet.allocation.lane) === "covers";
  return true;
}

function clanTone(color: string): CSSProperties {
  return { "--clan": color } as CSSProperties;
}

function seedLabel(cashAtom: number | null, target: number): string {
  if (cashAtom == null) return `— / ${target} ATOM`;
  return `${formatAtom(cashAtom)} / ${target} ATOM`;
}

function formatHate(n: number): string {
  const rounded = Number(n.toFixed(1));
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function HateBar({ pct, color }: { pct: number; color?: string }) {
  return (
    <div className="mt-1 h-2 overflow-hidden rounded-full bg-black/60">
      <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(pct === 0 ? 0 : 2, pct))}%`, background: color ?? "var(--magenta)" }} />
    </div>
  );
}

function Mini({ k, v, large }: { k: string; v: string; large?: boolean }) {
  return (
    <div>
      <p className="num text-[10px] tracking-[0.16em] text-muted uppercase">{k}</p>
      <p className={`num leading-tight ${large ? "text-2xl" : "text-base sm:text-lg"}`}>{v}</p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="num text-[10px] tracking-[0.18em] text-muted uppercase">{label}</p>
      <p className="num text-xl leading-tight sm:text-2xl">{value}</p>
    </div>
  );
}

function LaneStat({ lane, label, title, value, detail }: { lane: AllocationLane; label: string; title: string; value: string; detail: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/30 px-3 py-2">
      <p className={`num text-[10px] tracking-[0.18em] uppercase lane-${lane}`}>{label}</p>
      <p className="text-sm font-medium">{title}</p>
      <p className={`num text-xl leading-tight sm:text-2xl lane-${lane}`}>{value}</p>
      <p className="mt-0.5 text-xs text-muted">{detail}</p>
    </div>
  );
}

function FilterChip({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (id: string) => void }) {
  return (
    <button type="button" onClick={() => onChange(id)} className={`num rounded-full border px-2.5 py-1 text-[10px] tracking-[0.14em] uppercase ${value === id ? "border-gold bg-gold text-black" : "border-white/10 bg-black text-muted hover:border-gold/40 hover:text-ink"}`}>
      {label}
    </button>
  );
}

function FilterRow({ label, value, onChange, options }: { label: string; value: string; onChange: (id: string) => void; options: { id: string; label: string }[] }) {
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      <span className="num w-12 shrink-0 text-[9px] tracking-[0.2em] text-muted uppercase">{label}</span>
      {options.map((opt) => <FilterChip key={opt.id} id={opt.id} label={opt.label} value={value} onChange={onChange} />)}
    </div>
  );
}

function ToggleChip({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} className={`num rounded-full border px-3 py-1 text-[10px] tracking-[0.16em] uppercase ${on ? "border-gold/60 bg-gold/10 text-gold" : "border-white/10 bg-black text-muted"}`}>
      {label}{on ? "" : " off"}
    </button>
  );
}

function FilterBar({ filters, onChange, clans }: { filters: DeskFilters; onChange: (next: Partial<DeskFilters>) => void; clans: { id: string; name: string }[] }) {
  return (
    <section className="panel rounded-2xl px-3 py-3 sm:px-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="num text-[11px] tracking-[0.28em] text-gold uppercase">Command filters</h2>
        <p className="num text-[10px] tracking-[0.16em] text-muted uppercase">Sticks on this phone</p>
      </div>
      <FilterRow label="Clan" value={filters.clan} onChange={(clan) => onChange({ clan })} options={[{ id: "all", label: "All houses" }, ...clans.map((c) => ({ id: c.id, label: c.name }))]} />
      <FilterRow label="Role" value={filters.role} onChange={(role) => onChange({ role: role as RoleFilter })} options={[{ id: "all", label: "All" }, { id: "listed", label: "Listed" }, { id: "held", label: "Held" }, { id: "idle", label: "Idle" }, { id: "can-buy", label: "Can buy" }]} />
      <FilterRow label="Time" value={filters.time} onChange={(time) => onChange({ time: time as TimeFilter })} options={[{ id: "live", label: "Live" }, { id: "daily", label: "Daily" }, { id: "weekly", label: "Weekly" }]} />
      <FilterRow label="Feed" value={filters.feed} onChange={(feed) => onChange({ feed: feed as FeedFilter })} options={[{ id: "fills", label: "Fills" }, { id: "lists", label: "Lists" }, { id: "buys", label: "Buys" }, { id: "all", label: "All" }]} />
      <div className="mt-2 flex flex-wrap gap-2">
        <ToggleChip on={filters.heat} onClick={() => onChange({ heat: !filters.heat })} label="Hate heat" />
        <ToggleChip on={filters.book} onClick={() => onChange({ book: !filters.book })} label="Open book" />
      </div>
    </section>
  );
}

function FillTicker({ events, now }: { events: DeskEvent[]; now: number }) {
  if (events.length === 0) {
    return (
      <section className="mb-3 overflow-hidden rounded-xl border border-white/10 bg-black/70 px-3 py-2">
        <p className="num text-[10px] tracking-[0.22em] text-muted uppercase">Live ticker · no public scored fills yet · desk crosses not scored</p>
      </section>
    );
  }
  const loop = [...events, ...events];
  return (
    <section className="mb-3 overflow-hidden rounded-xl border border-gold/25 bg-black/80">
      <div className="flex items-center gap-3 border-b border-white/10 px-3 py-1.5">
        <span className="num text-[10px] tracking-[0.22em] text-gold uppercase">Live ticker</span>
        <span className="num text-[10px] tracking-[0.16em] text-muted uppercase">Public fills only · desk crosses not scored</span>
      </div>
      <div className="ticker-track flex gap-8 whitespace-nowrap px-3 py-2">
        {loop.map((event, i) => {
          const house = houseOf(event.clanId);
          return (
            <span key={`${event.id}-${i}`} className="inline-flex items-center gap-2 text-sm">
              <span className="num text-[11px] tracking-[0.16em] uppercase" style={{ color: house?.color ?? "var(--gold)" }}>{house?.name ?? "House"}</span>
              <span className="num text-ink">{event.tokenId ? `#${event.tokenId}` : event.summary}</span>
              <span className="num text-muted">{event.priceAtom != null ? `${formatAtom(event.priceAtom)} ATOM` : event.priceLabel}</span>
              <span className="num text-[10px] tracking-[0.14em] text-muted uppercase">{timeAgo(event.at, now)}</span>
            </span>
          );
        })}
      </div>
    </section>
  );
}

function OpenBook({ data, filters }: { data: DeskSnapshot; filters: DeskFilters }) {
  const asks = data.book.asks;
  const shown = asks.slice(0, 14);
  return (
    <section className="panel rounded-2xl p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="num text-[11px] tracking-[0.28em] text-gold uppercase">Undercut ladder</p>
          <h2 className="text-2xl font-semibold">Open book</h2>
          <p className="mt-1 text-sm text-muted">Our asks marked. Not buy targets for desk wallets.{data.book.ourFloorTokenId ? ` Floor is our #${data.book.ourFloorTokenId}.` : ""}</p>
        </div>
        <p className="num text-sm text-ink">{asks.length} ask{asks.length === 1 ? "" : "s"}{data.book.floorAtom != null ? ` · floor ${formatAtom(data.book.floorAtom)} ATOM` : ""}</p>
      </div>
      {shown.length === 0 ? <p className="text-sm text-muted">Book is empty on this poll. Empty is empty.</p> : (
        <ol className="flex flex-col gap-1">
          {shown.map((ask, i) => {
            const house = houseOf(ask.clanId);
            return (
              <li key={`${ask.tokenId}-${ask.creator}`} className={`grid grid-cols-[1.6rem_5rem_1fr_6.2rem] items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${ask.ourAsk ? "border border-gold/35 bg-gold/10" : "border border-transparent bg-black/40"}`} style={filters.clan !== "all" && ask.clanId !== filters.clan ? { opacity: 0.35 } : undefined}>
                <span className="num text-muted">{i + 1}</span>
                <span className="num text-ink">#{ask.tokenId}</span>
                <span className="num truncate text-[10px] tracking-[0.14em] uppercase" style={{ color: ask.ourAsk ? house?.color ?? "var(--gold)" : "var(--muted)" }}>
                  {ask.ourAsk ? `${house?.name ?? "Desk"} · ${ask.creatorLabel ?? "ours"}` : ask.creatorLabel ?? shortAddr(ask.creator)}
                </span>
                <span className="num text-right text-ink">{formatAtom(ask.priceAtom)}<span className="ml-1 text-[10px] text-muted">ATOM</span></span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function ClanScoreboard({ data, now, view, filters, onSelect }: { data: DeskSnapshot; now: number; view: ViewMode; filters: DeskFilters; onSelect: (id: string) => void }) {
  const war = data.war;
  const periodMax = Math.max(1, ...war.clans.map((c) => (filters.time === "daily" ? c.dailyFills : c.weeklyFills)));
  const latestFill = data.events.find((e) => e.scored && !e.incidentalCross);
  const shownClans = filters.clan === "all" ? war.clans : war.clans.filter((clan) => clan.id === filters.clan);
  return (
    <section className="panel relative overflow-hidden rounded-2xl p-4 sm:p-5">
      <div className="relative flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="num text-[11px] tracking-[0.28em] text-gold uppercase">Houses at war · {war.clans.length} of {BOTS_PER_CLAN} · they hate each other</p>
          <h2 className="war-title text-3xl font-semibold tracking-tight sm:text-5xl">VOLUME WAR</h2>
          <p className="mt-1 max-w-xl text-sm text-muted">Highest filled open-market Watchers count wins. Lists do not score. Fair-start seed is {CLAN_SEED_ATOM} ATOM per clan.</p>
        </div>
        <div className="text-right">
          <p className="num text-[11px] tracking-[0.2em] text-muted uppercase">Live floor</p>
          <p className="war-floor num text-5xl leading-none text-gold sm:text-6xl">{data.collection.floorAtom == null ? "—" : formatAtom(data.collection.floorAtom)}</p>
          <p className="num text-sm text-muted">ATOM</p>
        </div>
      </div>
      <div className="desk-clans relative mt-4 grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(168px,1fr))]">
        {shownClans.map((clan) => <ClanCard key={clan.id} clan={clan} periodMax={periodMax} time={filters.time} onSelect={onSelect} />)}
        {filters.clan === "all" ? <NextClanCard slot={war.extra} /> : null}
      </div>
      <div className="relative mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <p>Day {war.daily.label} · Week {war.weekly.label} · {war.scoredFills} scored fills{latestFill ? ` · last ${latestFill.summary} (${timeAgo(latestFill.at, now)})` : " · no scored fills yet"}</p>
        <p>PnL shown. Does not pick the winner.</p>
      </div>
      {filters.heat ? <LiveHateChart war={war} view={view} time={filters.time} /> : null}
      <p className="relative mt-2 text-xs text-muted">{war.note}</p>
    </section>
  );
}

function LiveHateChart({ war, view, time }: { war: DeskSnapshot["war"]; view: ViewMode; time: TimeFilter }) {
  const chart = (time === "daily" ? war.hateDaily : war.hate) ?? { window: "weekly" as const, label: "UTC week scored fills", scoredFills: 0, rows: [] };
  const [openId, setOpenId] = useState<string | null>(chart.rows[0]?.clanId ?? null);
  return (
    <div className="relative mt-4 space-y-3">
      <p className="num text-[11px] tracking-[0.2em] text-magenta uppercase">Live hate · {chart.label} · {chart.scoredFills} scored fills</p>
      {view === "desktop" ? (
        <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]">
          {chart.rows.map((row) => (
            <div key={row.clanId} className="rounded-xl border border-white/10 bg-black/40 p-3" style={clanTone(row.color)}>
              <div className="flex items-baseline justify-between gap-2">
                <p className="font-bold" style={{ color: row.color }}>{row.name}</p>
                <p className="num text-3xl leading-none text-magenta">{formatHate(row.totalHatePct)}%</p>
              </div>
              <HateBar pct={row.totalHatePct} />
              {row.rivals.map((rival) => (
                <div key={rival.clanId} className="mt-1">
                  <div className="flex justify-between text-xs"><span style={{ color: rival.color }}>{rival.name}</span><span className="num text-muted">{formatHate(rival.hatePct)}%</span></div>
                  <HateBar pct={rival.hatePct} color={rival.color} />
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {chart.rows.map((row) => {
            const open = openId === row.clanId;
            return (
              <button key={row.clanId} type="button" onClick={() => setOpenId(open ? null : row.clanId)} className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-left" style={clanTone(row.color)}>
                <div className="flex items-baseline justify-between gap-2">
                  <p className="font-bold" style={{ color: row.color }}>{row.name}</p>
                  <p className="num text-2xl leading-none text-magenta">{formatHate(row.totalHatePct)}%</p>
                </div>
                <HateBar pct={row.totalHatePct} />
                {open ? row.rivals.map((rival) => (
                  <div key={rival.clanId} className="mt-1">
                    <div className="flex justify-between text-xs"><span style={{ color: rival.color }}>{rival.name}</span><span className="num text-muted">{formatHate(rival.hatePct)}%</span></div>
                    <HateBar pct={rival.hatePct} color={rival.color} />
                  </div>
                )) : null}
              </button>
            );
          })}
        </div>
      )}
      <div className="rounded-xl border border-gold/30 bg-black/40 px-3 py-2">
        <p className="num text-[11px] tracking-[0.18em] text-gold uppercase">Seed rule · {CLAN_SEED_ATOM} ATOM fair start</p>
        <p className="text-sm">{BUY_WALLETS_PER_CLAN} buy × {BUY_SEED_ATOM} ATOM · {LIST_WALLETS_PER_CLAN} list × {LIST_SEED_ATOM} ATOM.</p>
      </div>
    </div>
  );
}

function ClanCard({ clan, periodMax, time, onSelect }: { clan: ClanScore; periodMax: number; time: TimeFilter; onSelect: (id: string) => void }) {
  const fills = time === "daily" ? clan.dailyFills : clan.weeklyFills;
  const crowned = time === "daily" ? clan.dailyWinner : clan.weeklyWinner;
  const seedPct = clan.cashAtom == null ? 0 : Math.min(100, (clan.cashAtom / clan.seedTargetAtom) * 100);
  const seeded = clan.seedGapAtom === 0;
  return (
    <div className={`war-card ${CLANS.some((c) => c.id === clan.id && c.color === clan.color) ? `clan-${clan.id}` : "clan-extra"} rounded-2xl p-3 ${crowned ? "war-card-win" : ""}`} style={clanTone(clan.color)}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="num text-[10px] tracking-[0.18em] uppercase text-muted">{clan.range} · {BOTS_PER_CLAN} bots</p>
          <h3 className="text-2xl font-bold leading-tight text-ink">{clan.name}</h3>
          <p className="text-xs text-muted">{clan.epithet}</p>
        </div>
        {crowned ? <span className="crown text-2xl" title="Winner" aria-label="winner crown">♛</span> : null}
      </div>
      <p className="num mt-2 text-4xl leading-none sm:text-5xl" style={{ color: clan.color }}>{fills}</p>
      <p className="num text-[11px] tracking-[0.16em] text-muted uppercase">{time === "daily" ? "Day" : "Week"} fills {crowned ? "· crown" : ""}</p>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-black/50"><div className="war-bar" style={{ width: `${Math.max(fills === 0 ? 0 : 8, (fills / periodMax) * 100)}%` }} /></div>
      <p className="num mt-2 text-sm">Day {clan.dailyFills}{clan.dailyWinner ? " ♛" : ""} · Week {clan.weeklyFills}{clan.weeklyWinner ? " ♛" : ""}<span className="text-muted"> · pnl {formatPnl(clan.dailyPnlAtom)} / {formatPnl(clan.weeklyPnlAtom)}</span></p>
      <div className="mt-3 rounded-lg border border-white/10 bg-black/30 px-2 py-1.5">
        <p className="num text-[10px] tracking-[0.16em] uppercase text-muted">Fair-start seed</p>
        <p className={`num text-lg leading-tight ${seeded ? "text-green" : "text-gold"}`}>{seedLabel(clan.cashAtom, clan.seedTargetAtom)}</p>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-black/60"><div className="h-full rounded-full bg-gold" style={{ width: `${Math.max(seedPct === 0 ? 0 : 6, seedPct)}%` }} /></div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {clan.seats.map((seat) => (
          <button key={seat.floorId} type="button" onClick={() => onSelect(seat.floorId)} className="num rounded-full border border-white/10 px-1.5 py-0.5 text-[10px] text-muted">{seat.floorId.replace("floor-", "")} <span className="text-muted/80">{seat.role === "buy" ? "B" : "L"}</span></button>
        ))}
      </div>
    </div>
  );
}

function NextClanCard({ slot }: { slot: ExtraClanSlot }) {
  const missing = slot.neededBots - slot.haveBots;
  return (
    <div className="war-card war-card-empty throne clan-next rounded-2xl p-3">
      <p className="num text-[10px] tracking-[0.18em] uppercase text-gold">Empty throne · next clan</p>
      <h3 className="text-2xl font-bold leading-tight text-ink">Unclaimed</h3>
      <p className="text-xs text-muted">{slot.haveBots}/{slot.neededBots} bots on book</p>
      <p className="num mt-2 text-4xl leading-none text-gold">{slot.seedTargetAtom}</p>
      <p className="num text-[11px] tracking-[0.16em] text-muted uppercase">ATOM fair-start seed</p>
      <p className="mt-2 text-[11px] text-muted">{missing > 0 ? `Needs ${missing} more bots. Say “add a team” in chat.` : "Say “add a team” in chat."} View only.</p>
    </div>
  );
}

function AllocationCard({ floorAtom }: { floorAtom: number | null }) {
  return (
    <section className="panel rounded-2xl p-4 sm:p-5">
      <p className="num text-[11px] tracking-[0.24em] text-gold uppercase">Allocation · view only</p>
      <p className="text-sm text-muted">Live floor {floorAtom == null ? "—" : `${formatAtom(floorAtom)} ATOM`}</p>
      <div className="desk-lanes mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <LaneStat lane="above" label="Pale Choir 01–05" title="Bigger buy" value="~4 ATOM" detail="Above floor, leftover gas" />
        <LaneStat lane="floor" label="Ash Veil 06–08" title="Floor take" value="~3.2 ATOM" detail="Can take floor + leftover gas" />
        <LaneStat lane="gas" label="Orbit / Meridian / Void 09–25" title="Gas only" value="~0.15 ATOM" detail="List / later" />
        <LaneStat lane="reserve" label="Treasury" title="Top-up reserve" value="remainder" detail="Holds leftover for top-ups" />
      </div>
      <p className="mt-3 text-xs text-muted">{ALLOCATION_NOTE}</p>
      <p className="mt-1 text-xs text-muted">{SEED_NOTE}</p>
    </section>
  );
}

function CadenceCard({ data }: { data: DeskSnapshot }) {
  const c = data.cadence;
  return (
    <section className="panel rounded-2xl p-4 sm:px-5">
      <p className="num text-[11px] tracking-[0.24em] text-gold uppercase">{c.title} · {c.session} {c.window}</p>
      <p className="text-sm font-medium text-ink">{c.rule}</p>
      <div className="desk-cadence mt-2 grid gap-2 sm:grid-cols-2">
        <p className="text-sm"><span className="text-muted">List </span><span className="num text-gold">{c.listFloors.join(" · ")}</span></p>
        <p className="text-sm"><span className="text-muted">Buy </span>{c.buyFloors.map((label, i) => {
          const gasOnly = allocationForId(label).lane === "gas";
          return <span key={label} className={`num ${gasOnly ? "text-muted" : "text-green"}`}>{i > 0 ? " · " : ""}{label}{gasOnly ? " (gas)" : ""}</span>;
        })}</p>
      </div>
      <p className="mt-2 text-xs text-muted">{c.note}</p>
    </section>
  );
}

function NodeBoard({ treasury, floors, selected, flash, now, floorAtom, war, filters, onSelect }: { treasury?: WalletSnapshot; floors: WalletSnapshot[]; selected: string | null; flash: Flash; now: number; floorAtom: number | null; war: DeskSnapshot["war"]; filters: DeskFilters; onSelect: (id: string) => void }) {
  const houses = groupFloorsByClan(floors).filter((house) => filters.clan === "all" || house.clan.id === filters.clan);
  const leftover = floors.filter((wallet) => !clanForWalletId(wallet.id));
  const emptySeats = Math.max(0, BOTS_PER_CLAN - leftover.length);
  const visibleFloors = (list: WalletSnapshot[]) => list.filter((wallet) => roleMatch(wallet, filters.role, floorAtom));
  return (
    <section className="panel relative overflow-hidden rounded-2xl p-3 sm:p-5">
      <p className="num mb-3 text-[11px] tracking-[0.24em] text-gold uppercase">Operators · {floors.length} nodes + treasury vault</p>
      {treasury && filters.role === "all" ? (
        <div className="mb-3">
          <WalletNode wallet={treasury} selected={selected === treasury.id} flash={flash[treasury.id]} now={now} floorAtom={floorAtom} large onSelect={onSelect} />
        </div>
      ) : null}
      <div className="space-y-4">
        {houses.map(({ clan, wallets }) => {
          const score = war.clans.find((c) => c.id === clan.id);
          return (
            <div key={clan.id} className={`clan-${clan.id}`} style={clanTone(clan.color)}>
              <p className="mb-2 text-xl font-bold" style={{ color: clan.color }}>{score?.dailyWinner || score?.weeklyWinner ? "♛ " : ""}{clan.name}</p>
              <div className="desk-floors grid grid-cols-3 gap-2 sm:grid-cols-5">
                {visibleFloors(wallets).map((wallet) => <WalletNode key={wallet.id} wallet={wallet} selected={selected === wallet.id} flash={flash[wallet.id]} now={now} floorAtom={floorAtom} onSelect={onSelect} />)}
              </div>
            </div>
          );
        })}
        <div className="clan-next">
          <p className="mb-2 text-xl font-bold text-gold">Empty throne</p>
          <div className="desk-floors grid grid-cols-3 gap-2 sm:grid-cols-5">
            {visibleFloors(leftover).map((wallet) => <WalletNode key={wallet.id} wallet={wallet} selected={selected === wallet.id} flash={flash[wallet.id]} now={now} floorAtom={floorAtom} onSelect={onSelect} />)}
            {Array.from({ length: emptySeats }, (_, i) => {
              const seat = seatForIndex(leftover.length + i);
              return <div key={`next-empty-${i}`} className="empty-seat flex min-h-[132px] flex-col justify-center rounded-xl px-2 py-2"><p className="num text-[13px] text-gold uppercase">Empty</p><p className="num text-[10px] text-muted">{seat.role} · {seat.seedAtom} ATOM</p></div>;
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

function WalletNode({ wallet, selected, flash, now, floorAtom, large, onSelect }: { wallet: WalletSnapshot; selected: boolean; flash?: ActionKind | "cross" | "score"; now: number; floorAtom: number | null; large?: boolean; onSelect: (id: string) => void }) {
  const flashClass = flash === "list" ? "flash-list" : flash === "score" ? "flash-score" : flash === "buy" ? "flash-buy" : flash === "move" ? "flash-move" : flash === "cross" ? "flash-cross" : "";
  const clan = clanForWalletId(wallet.id);
  const seat = clan?.seats.find((s) => s.floorId === wallet.id);
  const roleClass = wallet.role === "treasury" ? "node-treasury" : wallet.status === "error" ? "node-error" : clan ? `node-clan clan-${clan.id}${wallet.status === "active" ? " node-active" : ""}` : wallet.status === "active" ? "node-active" : "node-idle";
  return (
    <button type="button" onClick={() => onSelect(wallet.id)} className={`node ${roleClass} ${flashClass} ${large ? "w-full px-4 py-3 text-left" : "min-h-[132px] px-2 py-2 text-left"} relative rounded-xl bg-black/40 ${selected ? "ring-2 ring-gold" : ""}`} style={clan ? clanTone(clan.color) : undefined}>
      <span className={`num ${large ? "text-lg" : "text-[13px]"} tracking-wide uppercase`}>{wallet.label}</span>
      <p className={`font-semibold ${large ? "text-sm" : "text-xs"} text-ink`}>{clan ? clan.name : wallet.role === "treasury" ? "Treasury" : "Waiting"}</p>
      <p className={`num ${large ? "text-xs" : "text-[10px]"} uppercase text-muted`}>{seat ? `${seat.role} seed ${seat.seedAtom}` : wallet.allocation.short}</p>
      <div className={`mt-1 grid grid-cols-2 ${large ? "gap-3" : "gap-1"}`}>
        <Mini k="ATOM" v={formatAtom(wallet.atom)} large={large} />
        <Mini k="STARS" v={formatAtom(wallet.starsAmount)} large={large} />
        <Mini k="NFT" v={wallet.watchers == null ? "—" : String(wallet.watchers)} large={large} />
        <Mini k="L/H" v={wallet.listed == null || wallet.held == null ? "—" : `${wallet.listed}/${wallet.held}`} large={large} />
      </div>
      <p className={`mt-1 truncate ${large ? "text-sm" : "text-[11px]"} ${wallet.listedAsks.length > 0 ? "text-gold" : "text-muted"}`}>
        {wallet.listedAsks.length > 0 ? wallet.listedAsks.map((ask) => `#${ask.tokenId} @ ${formatAtom(ask.priceAtom)}`).join(" · ") : wallet.lastAction ? `${wallet.lastAction.kind} · ${timeAgo(wallet.lastAction.at, now)}` : "idle"}
      </p>
    </button>
  );
}

function WalletDetail({ wallet, now, floorAtom }: { wallet: WalletSnapshot; now: number; floorAtom: number | null }) {
  const clan = clanForWalletId(wallet.id);
  const seat = clan?.seats.find((s) => s.floorId === wallet.id);
  const cover = coversLiveFloor(wallet.atom, floorAtom, wallet.allocation.lane);
  return (
    <section className="panel rounded-2xl p-4 sm:p-5">
      <p className="text-lg font-bold" style={clan ? { color: clan.color } : undefined}>{clan?.name ?? (wallet.role === "treasury" ? "Treasury" : "Waiting")}</p>
      <h3 className="text-2xl font-semibold">{wallet.label}</h3>
      <p className="mt-1 text-sm text-muted">{wallet.allocation.purpose}{seat ? ` · ${seat.role} seed ${seat.seedAtom}` : ""}</p>
      <p className="mt-1 text-sm text-muted">{cover === "covers" ? "ATOM covers live floor." : cover === "gas" ? "Gas only." : cover === "reserve" ? "Remainder for top-ups." : wallet.allocation.purpose}</p>
      <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="ATOM" value={formatAtom(wallet.atom)} />
        <Stat label="STARS" value={formatAtom(wallet.starsAmount)} />
        <Stat label="Watchers" value={wallet.watchers == null ? "—" : String(wallet.watchers)} />
        <Stat label="Listed / held" value={wallet.listed == null || wallet.held == null ? "—" : `${wallet.listed} / ${wallet.held}`} />
        <Stat label="Last" value={wallet.lastAction ? timeAgo(wallet.lastAction.at, now) : "none"} />
      </dl>
      <a className="num mt-3 inline-block rounded-full border border-gold/30 px-3 py-1 text-xs text-gold" href={mintscanAccount(wallet.cosmos)} target="_blank" rel="noreferrer">cosmos</a>
    </section>
  );
}

function ActivityFeed({ events, now, feed, clan, onSelect }: { events: DeskEvent[]; now: number; feed: FeedFilter; clan: string; onSelect: (id: string) => void }) {
  const visible = useMemo(() => events.filter((event) => {
    if (feed === "fills" && !event.scored) return false;
    if (feed === "lists" && event.kind !== "list") return false;
    if (feed === "buys" && event.kind !== "buy") return false;
    if (clan !== "all" && event.clanId !== clan) return false;
    return true;
  }), [events, feed, clan]);
  return (
    <aside className="desk-feed panel flex min-h-0 flex-col overflow-hidden rounded-2xl p-4">
      <h2 className="num mb-3 text-[11px] tracking-[0.24em] text-gold uppercase">Desk activity</h2>
      {visible.length === 0 ? <p className="text-base text-muted">No on-chain desk events yet. Empty is empty.</p> : (
        <ol className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
          {visible.map((event) => {
            const house = clanForWalletId(event.walletIds[0]) ?? CLANS.find((c) => c.id === event.clanId);
            return (
              <li key={event.id} className={`rounded-xl border px-3 py-2 ${event.incidentalCross ? "border-magenta/50 bg-magenta/10" : event.scored ? "border-green/40 bg-green/5" : "border-white/10 bg-black/30"}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className={`num text-[11px] tracking-[0.16em] uppercase ${kindTone(event.incidentalCross ? "cross" : event.kind)}`}>
                    {event.incidentalCross ? "incidental cross" : event.scored ? `scored ${event.side ?? "fill"}` : event.kind}{house ? ` · ${house.name}` : ""}
                  </span>
                  <span className="num text-[11px] text-muted">{timeAgo(event.at, now)}</span>
                </div>
                <p className="mt-1 text-sm leading-snug">{event.summary}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {event.walletIds.map((id) => <button key={id} type="button" onClick={() => onSelect(id)} className="num rounded-full border border-gold/20 px-2 py-0.5 text-[11px] text-gold">{id}</button>)}
                  <a href={mintscanTx(event.txhash)} target="_blank" rel="noreferrer" className="num text-[11px] text-muted underline">tx</a>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </aside>
  );
}
