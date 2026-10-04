import { createHash } from "node:crypto";
import { getCache } from "@vercel/functions";

/**
 * Origin and Referer are a browser courtesy, not a lock: a non-browser
 * client can send either header. Missing headers, or a host that is not
 * this site, never reach Azure. The counters below still apply when the
 * headers are spoofed.
 *
 * Counters live in Vercel Runtime Cache under the namespace pigin-speak.
 * That cache is per region, shared by every Hobby project on the team, and
 * evictable, so this is a cap rather than a global ledger. Off Vercel the
 * same API falls back to process memory. Updates are read-modify-write, so
 * parallel requests can overshoot by a few. A write that does not read back
 * is denied, because a dropped cache write must not fail open onto Azure.
 *
 * On Vercel, x-real-ip and x-forwarded-for are replaced with the connecting
 * client. Off Vercel those headers are caller-controlled.
 */
export const PRODUCTION_SPEAK_HOST = "pigin-translator.vercel.app";

export const SPEAK_LIMITS = {
  burstRequests: 8,
  burstWindowMs: 10 * 60 * 1000,
  visitorDailyRequests: 30,
  visitorDailyCharacters: 8_000,
  globalDailyRequests: 80,
  globalDailyCharacters: 15_000,
  dailyWindowMs: 24 * 60 * 60 * 1000,
} as const;

const DAY_TTL_SECONDS = SPEAK_LIMITS.dailyWindowMs / 1000;
const GLOBAL_KEY = "global";

export type SpeakCounterStore = {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown, ttlSeconds: number): Promise<void>;
};

export type SpeakAccess =
  | { ok: true }
  | { ok: false; status: 403 | 429; message: string };

type Bucket = { start: number; count: number; chars: number };

type VisitorUsage = { burst: Bucket; day: Bucket };

type GlobalUsage = { day: Bucket };

type SpeakEnv = Record<string, string | undefined>;

const SITE_DENIED: SpeakAccess = {
  ok: false,
  status: 403,
  message: "Cloud speech is only available on this site.",
};

const LIMITED: SpeakAccess = {
  ok: false,
  status: 429,
  message: "Cloud speech is limited right now.",
};

let sharedStore: SpeakCounterStore | undefined;

export function speakCounterStore(): SpeakCounterStore {
  if (!sharedStore) {
    const cache = getCache({ namespace: "pigin-speak" });
    sharedStore = {
      get: (key) => cache.get(key),
      set: (key, value, ttlSeconds) =>
        cache.set(key, value, {
          ttl: ttlSeconds,
          name: key === GLOBAL_KEY ? "pigin-speak-global" : "pigin-speak-visitor",
        }),
    };
  }
  return sharedStore;
}

export function createMemorySpeakStore(
  now: () => number = Date.now,
): SpeakCounterStore {
  const entries = new Map<string, { raw: string; expiresAt: number }>();
  return {
    async get(key) {
      const entry = entries.get(key);
      if (!entry) return null;
      if (entry.expiresAt <= now()) {
        entries.delete(key);
        return null;
      }
      return JSON.parse(entry.raw) as unknown;
    },
    async set(key, value, ttlSeconds) {
      entries.set(key, {
        raw: JSON.stringify(value),
        expiresAt: now() + ttlSeconds * 1000,
      });
    },
  };
}

export function clientAddress(headers: Headers): string {
  return (
    firstAddress(headers.get("x-real-ip")) ??
    firstAddress(headers.get("x-forwarded-for")) ??
    "unknown"
  );
}

export async function decideSpeakAccess(input: {
  origin: string | null;
  referer: string | null;
  ip: string;
  textLength: number;
  now: number;
  env: SpeakEnv;
  store: SpeakCounterStore;
}): Promise<SpeakAccess> {
  const host = requestHost(input.origin, input.referer);
  if (!host || !hostAllowed(host, input.env)) return SITE_DENIED;

  try {
    const visitorKey = `v:${visitorHash(input.ip)}`;
    const visitor = visitorUsage(await input.store.get(visitorKey), input.now);
    const global = globalUsage(await input.store.get(GLOBAL_KEY), input.now);
    const length = Math.max(0, Math.floor(input.textLength));

    if (
      visitor.burst.count + 1 > SPEAK_LIMITS.burstRequests ||
      visitor.day.count + 1 > SPEAK_LIMITS.visitorDailyRequests ||
      visitor.day.chars + length > SPEAK_LIMITS.visitorDailyCharacters ||
      global.day.count + 1 > SPEAK_LIMITS.globalDailyRequests ||
      global.day.chars + length > SPEAK_LIMITS.globalDailyCharacters
    ) {
      return LIMITED;
    }

    const nextVisitor: VisitorUsage = {
      burst: add(visitor.burst, 1, 0),
      day: add(visitor.day, 1, length),
    };
    const nextGlobal: GlobalUsage = { day: add(global.day, 1, length) };

    await input.store.set(visitorKey, nextVisitor, DAY_TTL_SECONDS);
    await input.store.set(GLOBAL_KEY, nextGlobal, DAY_TTL_SECONDS);

    const seenVisitor = await input.store.get(visitorKey);
    const seenGlobal = await input.store.get(GLOBAL_KEY);
    if (!visitorStuck(seenVisitor, nextVisitor) || !globalStuck(seenGlobal, nextGlobal)) {
      return LIMITED;
    }

    return { ok: true };
  } catch {
    return LIMITED;
  }
}

function requestHost(origin: string | null, referer: string | null): string | null {
  const originValue = origin?.trim() ?? "";
  if (originValue) return headerHost(originValue);
  return headerHost(referer?.trim() ?? "");
}

function headerHost(value: string): string | null {
  if (!value || value === "null") return null;
  try {
    return normalizeHost(new URL(value).hostname);
  } catch {
    return null;
  }
}

function hostAllowed(host: string, env: SpeakEnv): boolean {
  if (host === PRODUCTION_SPEAK_HOST) return true;
  for (const key of [
    "VERCEL_URL",
    "VERCEL_BRANCH_URL",
    "VERCEL_PROJECT_PRODUCTION_URL",
  ]) {
    const allowed = envHost(env[key]);
    if (allowed && allowed === host) return true;
  }
  if (!env.VERCEL) {
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  }
  return false;
}

function normalizeHost(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
}

function envHost(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const withProtocol = trimmed.includes("://") ? trimmed : `https://${trimmed}`;
    return normalizeHost(new URL(withProtocol).hostname);
  } catch {
    return null;
  }
}

function firstAddress(value: string | null): string | null {
  const first = value?.split(",")[0]?.trim().toLowerCase() ?? "";
  if (!first || first.length > 64) return null;
  if (!/^[0-9a-f:.]+$/.test(first)) return null;
  return first;
}

function visitorHash(ip: string): string {
  return createHash("sha256").update(`pigin-speak:${ip}`).digest("hex").slice(0, 32);
}

function emptyBucket(now: number): Bucket {
  return { start: now, count: 0, chars: 0 };
}

function roll(value: unknown, now: number, windowMs: number): Bucket {
  if (!value || typeof value !== "object") return emptyBucket(now);
  const record = value as Record<string, unknown>;
  const start = record.start;
  const count = record.count;
  const chars = record.chars;
  if (typeof start !== "number" || now < start || now - start >= windowMs) {
    return emptyBucket(now);
  }
  return {
    start,
    count: whole(count),
    chars: whole(chars),
  };
}

function visitorUsage(value: unknown, now: number): VisitorUsage {
  const record =
    value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    burst: roll(record.burst, now, SPEAK_LIMITS.burstWindowMs),
    day: roll(record.day, now, SPEAK_LIMITS.dailyWindowMs),
  };
}

function globalUsage(value: unknown, now: number): GlobalUsage {
  const record =
    value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return { day: roll(record.day, now, SPEAK_LIMITS.dailyWindowMs) };
}

function whole(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

function add(bucket: Bucket, count: number, chars: number): Bucket {
  return {
    start: bucket.start,
    count: bucket.count + count,
    chars: bucket.chars + chars,
  };
}

function bucketStuck(seen: unknown, expected: Bucket): boolean {
  if (!seen || typeof seen !== "object") return false;
  const record = seen as Record<string, unknown>;
  return (
    record.start === expected.start &&
    typeof record.count === "number" &&
    typeof record.chars === "number" &&
    record.count >= expected.count &&
    record.chars >= expected.chars
  );
}

function visitorStuck(seen: unknown, expected: VisitorUsage): boolean {
  if (!seen || typeof seen !== "object") return false;
  const record = seen as Record<string, unknown>;
  return bucketStuck(record.burst, expected.burst) && bucketStuck(record.day, expected.day);
}

function globalStuck(seen: unknown, expected: GlobalUsage): boolean {
  if (!seen || typeof seen !== "object") return false;
  const record = seen as Record<string, unknown>;
  return bucketStuck(record.day, expected.day);
}
