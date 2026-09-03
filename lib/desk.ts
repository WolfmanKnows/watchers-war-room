import { allocationForId } from "./allocation";
import {
  COLLECTION,
  MARKETPLACE,
  WALLETS,
  lookupWallet,
} from "./address-book";
import { cadenceFor } from "./cadence";
import { clanIdForWallet, scoreClanWar } from "./clans";
import {
  fetchAsksByCreator,
  fetchBalances,
  fetchCollectionAsks,
  fetchCollectionMeta,
  fetchOwnedTokens,
  fetchTxs,
  mapPool,
  type MarketAsk,
} from "./chain";
import { ACTIVE_MS, latestActionFor, parseDeskEvents } from "./events";
import type {
  CollectionSnapshot,
  DeskSnapshot,
  FloorAsk,
  WalletSnapshot,
} from "./types";

const POLL_SECONDS = 20;
const CONCURRENCY = 7;

function askToFloor(ask: MarketAsk): FloorAsk {
  const wallet = lookupWallet(ask.creator);
  return {
    tokenId: ask.token_id,
    priceAtom: Number(ask.details.price.amount) / 1_000_000,
    creator: ask.creator,
    creatorLabel: wallet?.label,
    ourAsk: Boolean(wallet && wallet.role === "floor"),
    clanId: wallet ? clanIdForWallet(wallet.id) ?? undefined : undefined,
  };
}

export async function loadDeskSnapshot(): Promise<DeskSnapshot> {
  const warnings: string[] = [];
  const now = Date.now();

  const [metaResult, asksResult, collectionTxs, fillTxs, walletTxBundles, senderTxBundles, walletRows] =
    await Promise.all([
      fetchCollectionMeta()
        .then((v) => ({ ok: true as const, value: v }))
        .catch((e: Error) => {
          warnings.push(`Collection meta: ${e.message}`);
          return { ok: false as const };
        }),
      fetchCollectionAsks(80)
        .then((v) => ({ ok: true as const, value: v }))
        .catch((e: Error) => {
          warnings.push(`Listings: ${e.message}`);
          return { ok: false as const };
        }),
      fetchTxs(`wasm._contract_address='${COLLECTION.contract}'`, 40).catch((e: Error) => {
        warnings.push(`Collection txs: ${e.message}`);
        return [];
      }),
      fetchTxs(`wasm-finalize-sale.collection='${COLLECTION.contract}'`, 80).catch((e: Error) => {
        warnings.push(`Fills: ${e.message}`);
        return [];
      }),
      mapPool(WALLETS, CONCURRENCY, async (wallet) => {
        return fetchTxs(`transfer.recipient='${wallet.cosmos}'`, 5).catch(() => []);
      }),
      mapPool(WALLETS, CONCURRENCY, async (wallet) => {
        return fetchTxs(`message.sender='${wallet.cosmos}'`, 8).catch(() => []);
      }),
      mapPool(WALLETS, CONCURRENCY, async (wallet) => {
        try {
          const [balances, tokens, asks] = await Promise.all([
            fetchBalances(wallet.cosmos),
            fetchOwnedTokens(wallet.cosmos),
            fetchAsksByCreator(wallet.cosmos),
          ]);
          const listedIds = asks.map((a) => a.token_id);
          const tokenIds = [...new Set([...tokens, ...listedIds])];
          const listed = listedIds.length;
          return {
            wallet,
            atom: balances.atom,
            starsAmount: balances.stars,
            tokenIds,
            listed,
            error: undefined as string | undefined,
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          warnings.push(`${wallet.label}: ${message}`);
          return {
            wallet,
            atom: null as number | null,
            starsAmount: null as number | null,
            tokenIds: [] as string[],
            listed: null as number | null,
            error: message,
          };
        }
      }),
    ]);

  const txs = [
    ...collectionTxs,
    ...fillTxs,
    ...walletTxBundles.flat(),
    ...senderTxBundles.flat(),
  ].filter((tx, i, all) => all.findIndex((t) => t.txhash === tx.txhash) === i);

  const events = parseDeskEvents(txs).filter((event) => event.walletIds.length > 0);

  const wallets: WalletSnapshot[] = walletRows.map((row) => {
    const lastAction = latestActionFor(row.wallet.id, events);
    const watchers = row.error ? null : row.tokenIds.length;
    const listed = row.listed;
    const held =
      watchers == null || listed == null ? null : Math.max(0, watchers - listed);
    const active = lastAction
      ? now - Date.parse(lastAction.at) < ACTIVE_MS
      : false;

    return {
      id: row.wallet.id,
      label: row.wallet.label,
      role: row.wallet.role,
      cosmos: row.wallet.cosmos,
      stars: row.wallet.stars,
      atom: row.atom,
      starsAmount: row.starsAmount,
      watchers,
      listed,
      held,
      lastAction,
      status: row.error ? "error" : active ? "active" : "idle",
      error: row.error,
      tokenIds: row.tokenIds,
      listedAsks: [] as FloorAsk[],
      allocation: allocationForId(row.wallet.id),
      clanId: clanIdForWallet(row.wallet.id),
    };
  });

  const ourHoldings = wallets.reduce((sum, w) => sum + (w.watchers ?? 0), 0);
  const ourListed = wallets.reduce((sum, w) => sum + (w.listed ?? 0), 0);
  const ourHeld = wallets.reduce((sum, w) => sum + (w.held ?? 0), 0);

  const asks = asksResult.ok ? asksResult.value : [];
  const floors = asks.map(askToFloor);
  for (const wallet of wallets) {
    wallet.listedAsks = floors.filter(
      (ask) => ask.ourAsk && (ask.creator === wallet.cosmos || ask.creatorLabel === wallet.label),
    );
  }
  const supply = metaResult.ok ? metaResult.value.supply : null;

  const collection: CollectionSnapshot = {
    name: COLLECTION.name,
    fullName: COLLECTION.fullName,
    contract: COLLECTION.contract,
    url: COLLECTION.url,
    supply,
    floorAtom: floors[0]?.priceAtom ?? null,
    listedCount: asksResult.ok ? asks.length : null,
    listedCapped: asksResult.ok && asks.length >= 80,
    ourHoldings,
    ourListed,
    ourHeld,
    ourSharePct: supply ? (ourHoldings / supply) * 100 : null,
    ourAsksAreNotBuyTargets: true,
  };

  return {
    fetchedAt: new Date().toISOString(),
    pollSeconds: POLL_SECONDS,
    viewOnly: true,
    collection,
    wallets,
    events: events.slice(0, 80),
    book: {
      asks: floors,
      floorAtom: floors[0]?.priceAtom ?? null,
      ourFloorTokenId: floors.find((ask) => ask.ourAsk)?.tokenId ?? null,
    },
    cadence: cadenceFor(),
    war: scoreClanWar(events, new Date(), wallets),
    sources: [
      "https://lcd-cosmoshub.keplr.app (only LCD, 5s timeout)",
      `Watchers CW721 ${COLLECTION.contract}`,
      `Stargaze Marketplace v2 ${MARKETPLACE}`,
      "wasm-finalize-sale on Watchers (filled open-market only)",
    ],
    warnings,
  };
}
