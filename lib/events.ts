import { COLLECTION, MARKETPLACE, isDeskAddress, lookupWallet } from "./address-book";
import { clanIdForWallet } from "./clans";
import type { ActionKind, DeskEvent } from "./types";
import { ATOM_DENOM, STARS_DENOM, type TxResponse, microToDisplay } from "./chain";

type WasmMsg = {
  "@type"?: string;
  sender?: string;
  contract?: string;
  msg?: Record<string, unknown>;
  funds?: { denom: string; amount: string }[];
};

type BankMsg = {
  "@type"?: string;
  from_address?: string;
  to_address?: string;
  amount?: { denom: string; amount: string }[];
};

function priceLabel(denom?: string, amount?: string): string | undefined {
  if (!denom || amount == null) return undefined;
  if (denom === ATOM_DENOM) return `${trimNum(microToDisplay(amount))} ATOM`;
  if (denom === STARS_DENOM) return `${trimNum(microToDisplay(amount))} STARS`;
  return `${amount} ${denom}`;
}

function trimNum(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 3 });
}

function eventAttrs(tx: TxResponse, type: string): Record<string, string>[] {
  const groups: Record<string, string>[] = [];
  for (const ev of tx.events ?? []) {
    if (ev.type !== type) continue;
    const current: Record<string, string> = {};
    for (const attr of ev.attributes ?? []) current[attr.key] = attr.value;
    groups.push(current);
  }
  return groups;
}

function walletIdsFor(...addresses: (string | undefined)[]): string[] {
  const ids = new Set<string>();
  for (const addr of addresses) {
    const w = lookupWallet(addr);
    if (w) ids.add(w.id);
  }
  return [...ids];
}

function labelOf(addr?: string): string {
  return lookupWallet(addr)?.label ?? (addr ? `${addr.slice(0, 10)}…` : "unknown");
}

function firstMsgOf(tx: TxResponse): Record<string, unknown>[] {
  return tx.tx?.body?.messages ?? [];
}

function askFields(msg: Record<string, unknown> | undefined) {
  if (!msg) return {};
  const nested =
    (msg.set_ask as Record<string, unknown> | undefined) ??
    (msg.accept_ask as Record<string, unknown> | undefined) ??
    (msg.remove_ask as Record<string, unknown> | undefined) ??
    (msg.update_ask as Record<string, unknown> | undefined) ??
    (msg.buy_specific_nft as Record<string, unknown> | undefined) ??
    (msg.sell_nft as Record<string, unknown> | undefined) ??
    msg;
  const details = (nested.details as Record<string, unknown> | undefined) ?? {};
  const price = details.price as { denom?: string; amount?: string } | undefined;
  return {
    tokenId: String(nested.token_id ?? nested.tokenId ?? ""),
    collection: String(nested.collection ?? ""),
    price,
  };
}

function parseFinalizeSales(tx: TxResponse): DeskEvent[] {
  const sales: DeskEvent[] = [];
  for (const sale of eventAttrs(tx, "wasm-finalize-sale")) {
    if (sale.collection && sale.collection !== COLLECTION.contract) continue;
    const buyer = sale.nft_recipient;
    const seller = sale.seller_recipient;
    if (!buyer && !seller) continue;
    const tokenId = sale.token_id;
    const price = sale.price && sale.denom ? { amount: sale.price, denom: sale.denom } : undefined;
    const priceBit = priceLabel(price?.denom, price?.amount);
    const priceAtom =
      price?.denom === ATOM_DENOM && price.amount != null
        ? microToDisplay(price.amount)
        : undefined;
    const buyerDesk = isDeskAddress(buyer);
    const sellerDesk = isDeskAddress(seller);
    const bothDesk = buyerDesk && sellerDesk;
    if (!buyerDesk && !sellerDesk) continue;
    const deskId = buyerDesk ? lookupWallet(buyer)?.id : lookupWallet(seller)?.id;
    const outsider = buyerDesk ? seller : buyer;
    const outsiderDesk = isDeskAddress(outsider);
    const clanId = deskId ? clanIdForWallet(deskId) : null;
    const side: "buy" | "sell" = buyerDesk ? "buy" : "sell";
    const scored = Boolean(clanId && !bothDesk && !outsiderDesk);
    const pnlAtom = priceAtom == null ? undefined : side === "buy" ? -priceAtom : priceAtom;
    const who = buyerDesk ? labelOf(buyer) : labelOf(seller);
    const verb = side === "buy" ? "bought" : "sold";
    const tokenBit = tokenId ? ` Watcher #${tokenId}` : "";
    const vs = outsider ? ` vs ${labelOf(outsider)}` : "";
    sales.push({
      id: `${tx.txhash}:sale:${tokenId}:${buyer}:${seller}`,
      at: tx.timestamp,
      kind: "buy",
      summary: `${who} ${verb}${tokenBit}${priceBit ? ` @ ${priceBit}` : ""}${vs}`,
      walletIds: walletIdsFor(buyer, seller),
      tokenId: tokenId || undefined,
      priceLabel: priceBit,
      txhash: tx.txhash,
      incidentalCross: bothDesk,
      counterpartyLabel: bothDesk ? `${labelOf(seller)} → ${labelOf(buyer)}` : labelOf(outsider),
      scored,
      side,
      priceAtom,
      pnlAtom: scored ? pnlAtom : undefined,
      clanId: clanId ?? undefined,
      outsider: outsider && !outsiderDesk ? outsider : undefined,
    });
  }
  return sales;
}

export function parseDeskEvents(txs: TxResponse[]): DeskEvent[] {
  const events: DeskEvent[] = [];
  for (const tx of txs) {
    const sales = parseFinalizeSales(tx);
    events.push(...sales);
    const saleHashes = new Set(sales.map((s) => s.txhash));
    const messages = firstMsgOf(tx);
    for (const raw of messages) {
      const type = String(raw["@type"] ?? "");
      if (type === "/cosmos.bank.v1beta1.MsgSend") {
        const msg = raw as BankMsg;
        const fromDesk = isDeskAddress(msg.from_address);
        const toDesk = isDeskAddress(msg.to_address);
        if (!fromDesk && !toDesk) continue;
        const coin = (msg.amount ?? [])[0];
        const summary = `${labelOf(msg.from_address)} → ${labelOf(msg.to_address)} ${priceLabel(coin?.denom, coin?.amount) ?? "transfer"}`;
        events.push({
          id: `${tx.txhash}:send:${msg.from_address}:${msg.to_address}`,
          at: tx.timestamp,
          kind: "fund",
          summary,
          walletIds: walletIdsFor(msg.from_address, msg.to_address),
          priceLabel: priceLabel(coin?.denom, coin?.amount),
          txhash: tx.txhash,
          incidentalCross: false,
          counterpartyLabel: fromDesk && toDesk ? `${labelOf(msg.from_address)} → ${labelOf(msg.to_address)}` : undefined,
          scored: false,
        });
        continue;
      }
      if (type !== "/cosmwasm.wasm.v1.MsgExecuteContract") continue;
      const wasm = raw as WasmMsg;
      const contract = wasm.contract ?? "";
      const sender = wasm.sender ?? "";
      const inner = wasm.msg ?? {};
      const action = Object.keys(inner)[0] ?? "execute";
      if (contract === MARKETPLACE) {
        const fields = askFields(inner);
        const isWatchers = !fields.collection || fields.collection === COLLECTION.contract;
        if (!isWatchers) continue;
        const wasmEvents = eventAttrs(tx, "wasm");
        const creator = wasmEvents.find((e) => e.creator)?.creator;
        const buyer = sender;
        const seller = creator;
        const bothDesk = isDeskAddress(buyer) && isDeskAddress(seller);
        if (!isDeskAddress(buyer) && !isDeskAddress(seller)) continue;
        let kind: ActionKind = "other";
        if (action === "set_ask" || action === "update_ask" || action === "sell_nft") kind = "list";
        else if (action === "accept_ask" || action === "buy_specific_nft" || action === "buy_collection_nft" || action === "accept_bid" || action === "accept_collection_bid") {
          if (saleHashes.has(tx.txhash)) continue;
          kind = "buy";
        }
        const tokenId = fields.tokenId || wasmEvents.find((e) => e.token_id)?.token_id;
        const price = fields.price ?? (wasmEvents.find((e) => e.price)?.price ? splitCoin(wasmEvents.find((e) => e.price)!.price) : undefined);
        const who = kind === "buy" ? labelOf(buyer) : labelOf(seller || buyer);
        const verb = kind === "list" ? "listed" : kind === "buy" ? "bought" : action.replaceAll("_", " ");
        const tokenBit = tokenId ? ` Watcher #${tokenId}` : "";
        const priceBit = priceLabel(price?.denom, price?.amount);
        events.push({
          id: `${tx.txhash}:${action}:${tokenId}:${sender}`,
          at: tx.timestamp,
          kind,
          summary: `${who} ${verb}${tokenBit}${priceBit ? ` @ ${priceBit}` : ""}`,
          walletIds: walletIdsFor(buyer, seller),
          tokenId: tokenId || undefined,
          priceLabel: priceBit,
          txhash: tx.txhash,
          incidentalCross: Boolean(bothDesk && kind === "buy"),
          counterpartyLabel: bothDesk ? `${labelOf(seller)} → ${labelOf(buyer)}` : undefined,
          scored: false,
        });
        continue;
      }
      if (contract === COLLECTION.contract) {
        const transfer = inner.transfer_nft as { recipient?: string; token_id?: string } | undefined;
        const send = inner.send_nft as { contract?: string; token_id?: string } | undefined;
        if (transfer) {
          const fromDesk = isDeskAddress(sender);
          const toDesk = isDeskAddress(transfer.recipient);
          if (!fromDesk && !toDesk) continue;
          events.push({
            id: `${tx.txhash}:move:${transfer.token_id}`,
            at: tx.timestamp,
            kind: "move",
            summary: `${labelOf(sender)} moved Watcher #${transfer.token_id} → ${labelOf(transfer.recipient)}`,
            walletIds: walletIdsFor(sender, transfer.recipient),
            tokenId: transfer.token_id,
            txhash: tx.txhash,
            incidentalCross: false,
            counterpartyLabel: fromDesk && toDesk ? `${labelOf(sender)} → ${labelOf(transfer.recipient)}` : undefined,
            scored: false,
          });
        } else if (send && isDeskAddress(sender)) {
          events.push({
            id: `${tx.txhash}:sendnft:${send.token_id}`,
            at: tx.timestamp,
            kind: "move",
            summary: `${labelOf(sender)} sent Watcher #${send.token_id} to contract`,
            walletIds: walletIdsFor(sender),
            tokenId: send.token_id,
            txhash: tx.txhash,
            incidentalCross: false,
            scored: false,
          });
        } else if (isDeskAddress(sender) && action !== "approve") {
          events.push({
            id: `${tx.txhash}:${action}:${sender}`,
            at: tx.timestamp,
            kind: "other",
            summary: `${labelOf(sender)} ${action.replaceAll("_", " ")} on Watchers`,
            walletIds: walletIdsFor(sender),
            txhash: tx.txhash,
            incidentalCross: false,
            scored: false,
          });
        }
      }
    }
  }
  const seen = new Set<string>();
  return events.filter((e) => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  }).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

function splitCoin(raw: string): { denom: string; amount: string } | undefined {
  const match = raw.match(/^(\d+)(.+)$/);
  if (!match) return undefined;
  return { amount: match[1], denom: match[2] };
}

export function latestActionFor(walletId: string, events: DeskEvent[]): { kind: ActionKind; at: string; summary: string } | null {
  const hit = events.find((e) => e.walletIds.includes(walletId));
  if (!hit) return null;
  return { kind: hit.kind, at: hit.at, summary: hit.summary };
}

export const ACTIVE_MS = 30 * 60 * 1000;
