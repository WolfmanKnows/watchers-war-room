import { COLLECTION, MARKETPLACE } from "./address-book";

/** Keplr only. Do not fall back to cosmos.directory. */
export const LCD_ENDPOINTS = ["https://lcd-cosmoshub.keplr.app"] as const;
export const LCD = LCD_ENDPOINTS[0];
export const LCD_TIMEOUT_MS = 5_000;
export const LCD_USER_AGENT =
  "Mozilla/5.0 (compatible; StargazeDesk/1.0; +https://stargaze.zone)";
export const ATOM_DENOM = "uatom";
export const STARS_DENOM =
  "factory/cosmos1s8qx0zvz8yd6e4x0mqmqf7fr9vvfn6226hkvrq/ustars";
export const MICRO = 1_000_000;

type LcdError = {
  message: string;
};

export class ChainError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ChainError";
  }
}

export async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  return results;
}

let chosenLcd: string | null = null;

function lcdOrder(): string[] {
  if (!chosenLcd) return [...LCD_ENDPOINTS];
  return [chosenLcd, ...LCD_ENDPOINTS.filter((base) => base !== chosenLcd)];
}

async function lcdFetch<T>(path: string, init?: RequestInit): Promise<T> {
  if (path.startsWith("http")) {
    return lcdFetchUrl<T>(path, init);
  }

  let lastError: unknown;
  for (const base of lcdOrder()) {
    try {
      const data = await lcdFetchUrl<T>(`${base}${path}`, init);
      chosenLcd = base;
      return data;
    } catch (error) {
      lastError = error;
      if (chosenLcd === base) chosenLcd = null;
    }
  }

  throw lastError instanceof Error ? lastError : new ChainError(String(lastError));
}

async function lcdFetchUrl<T>(url: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LCD_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": LCD_USER_AGENT,
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
    });
    const text = await res.text();
    if (!res.ok) {
      let message = text.slice(0, 240);
      try {
        const parsed = JSON.parse(text) as LcdError;
        if (parsed.message) message = parsed.message;
      } catch {
        /* keep raw */
      }
      throw new ChainError(`${res.status} ${message}`, res.status);
    }
    return JSON.parse(text) as T;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new ChainError(`LCD timeout ${LCD_TIMEOUT_MS}ms: ${url}`);
    }
    throw error instanceof Error ? error : new ChainError(String(error));
  } finally {
    clearTimeout(timer);
  }
}

function b64Json(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64");
}

export async function wasmQuery<T>(contract: string, query: unknown): Promise<T> {
  const encoded = b64Json(query);
  const body = await lcdFetch<{ data: T }>(
    `/cosmwasm/wasm/v1/contract/${contract}/smart/${encoded}`,
  );
  return body.data;
}

export type BankBalances = {
  balances: { denom: string; amount: string }[];
};

export async function fetchBalances(address: string): Promise<{
  atom: number;
  stars: number;
}> {
  const data = await lcdFetch<BankBalances>(
    `/cosmos/bank/v1beta1/balances/${address}?pagination.limit=200`,
  );
  let atom = 0;
  let stars = 0;
  for (const coin of data.balances ?? []) {
    if (coin.denom === ATOM_DENOM) atom = Number(coin.amount) / MICRO;
    if (coin.denom === STARS_DENOM) stars = Number(coin.amount) / MICRO;
  }
  return { atom, stars };
}

export async function fetchOwnedTokens(owner: string): Promise<string[]> {
  const tokens: string[] = [];
  let startAfter: string | undefined;

  for (let page = 0; page < 8; page++) {
    const query: {
      tokens: { owner: string; limit: number; start_after?: string };
    } = { tokens: { owner, limit: 100 } };
    if (startAfter) query.tokens.start_after = startAfter;
    const data = await wasmQuery<{ tokens: string[] }>(COLLECTION.contract, query);
    const batch = data.tokens ?? [];
    tokens.push(...batch);
    if (batch.length < 100) break;
    startAfter = batch[batch.length - 1];
  }

  return tokens;
}

export type MarketAsk = {
  id: string;
  creator: string;
  collection: string;
  token_id: string;
  details: {
    price: { denom: string; amount: string };
    recipient?: string | null;
    finder?: string | null;
  };
};

export async function fetchAsksByCreator(creator: string): Promise<MarketAsk[]> {
  const data = await wasmQuery<MarketAsk[]>(MARKETPLACE, {
    asks_by_creator_collection: {
      creator,
      collection: COLLECTION.contract,
      query_options: { limit: 100, descending: false },
    },
  });
  return data ?? [];
}

export async function fetchCollectionAsks(limit = 80): Promise<MarketAsk[]> {
  const data = await wasmQuery<MarketAsk[]>(MARKETPLACE, {
    asks_by_collection_denom: {
      collection: COLLECTION.contract,
      denom: ATOM_DENOM,
      query_options: { limit, descending: false },
    },
  });
  return data ?? [];
}

export async function fetchCollectionMeta(): Promise<{
  name: string;
  supply: number;
}> {
  const [info, count] = await Promise.all([
    wasmQuery<{ name: string }>(COLLECTION.contract, {
      get_collection_info_and_extension: {},
    }),
    wasmQuery<{ count: number }>(COLLECTION.contract, { num_tokens: {} }),
  ]);
  return { name: info.name, supply: count.count };
}

export type TxResponse = {
  txhash: string;
  height: string;
  timestamp: string;
  code: number;
  tx?: {
    body?: {
      messages?: Record<string, unknown>[];
    };
  };
  events?: {
    type: string;
    attributes: { key: string; value: string }[];
  }[];
};

type TxSearch = {
  tx_responses?: TxResponse[];
  pagination?: { total?: string };
};

export async function fetchTxs(query: string, limit = 20): Promise<TxResponse[]> {
  const params = new URLSearchParams({
    query,
    order_by: "2",
    "pagination.limit": String(limit),
  });
  const data = await lcdFetch<TxSearch>(`/cosmos/tx/v1beta1/txs?${params}`);
  return (data.tx_responses ?? []).filter((tx) => tx.code === 0);
}

export function microToDisplay(amount: string | number, decimals = 6): number {
  return Number(amount) / 10 ** decimals;
}

export function formatAmount(amount: number, symbol: string): string {
  if (!Number.isFinite(amount)) return `— ${symbol}`;
  const digits = amount >= 100 ? 1 : amount >= 1 ? 2 : 3;
  return `${amount.toLocaleString("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  })} ${symbol}`;
}
