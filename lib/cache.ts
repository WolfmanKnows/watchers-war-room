type CacheEntry<T> = {
  value: T;
  expiresAt: number;
  inflight?: Promise<T>;
};

const store = new Map<string, CacheEntry<unknown>>();

export async function cached<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  const existing = store.get(key) as CacheEntry<T> | undefined;
  if (existing && existing.expiresAt > now) return existing.value;
  if (existing?.inflight) return existing.inflight;

  const inflight = loader().then((value) => {
    store.set(key, { value, expiresAt: Date.now() + ttlMs });
    return value;
  });

  store.set(key, {
    value: existing?.value as T,
    expiresAt: existing?.expiresAt ?? 0,
    inflight,
  });

  try {
    return await inflight;
  } catch (error) {
    store.delete(key);
    if (existing && existing.value !== undefined) return existing.value;
    throw error;
  }
}
