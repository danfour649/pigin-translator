import assert from "node:assert/strict";
import test from "node:test";
import {
  SPEAK_LIMITS,
  clientAddress,
  createMemorySpeakStore,
  decideSpeakAccess,
  type SpeakCounterStore,
} from "./speak-guard.ts";

const NOW = 1_700_000_000_000;
const PREVIEW = "pigin-translator-git-main-danfour.vercel.app";

const previewEnv = {
  VERCEL: "1",
  VERCEL_URL: PREVIEW,
  VERCEL_BRANCH_URL: PREVIEW,
  VERCEL_PROJECT_PRODUCTION_URL: "pigin-translator.vercel.app",
};

async function allow(
  store: SpeakCounterStore,
  overrides: Partial<Parameters<typeof decideSpeakAccess>[0]> = {},
) {
  return decideSpeakAccess({
    origin: "https://pigin-translator.vercel.app",
    referer: null,
    ip: "203.0.113.10",
    textLength: 20,
    now: NOW,
    env: previewEnv,
    store,
    ...overrides,
  });
}

test("header-less and cross-site callers are denied without counting", async () => {
  const store = createMemorySpeakStore();
  const sets: string[] = [];
  const watching: SpeakCounterStore = {
    get: (key) => store.get(key),
    set: async (key, value, ttl) => {
      sets.push(key);
      await store.set(key, value, ttl);
    },
  };

  assert.deepEqual(
    await allow(watching, { origin: null, referer: null }),
    {
      ok: false,
      status: 403,
      message: "Cloud speech is only available on this site.",
    },
  );
  assert.equal((await allow(watching, { origin: "https://evil.example" })).ok, false);
  assert.equal(
    (
      await allow(watching, {
        origin: "https://evil.example",
        referer: "https://pigin-translator.vercel.app/translate",
      })
    ).status,
    403,
  );
  assert.equal((await allow(watching, { origin: "null" })).status, 403);
  assert.equal(sets.length, 0);
});

test("production and this deployment's preview hosts are allowed", async () => {
  const store = createMemorySpeakStore();
  assert.equal((await allow(store)).ok, true);
  assert.equal(
    (await allow(store, { origin: `https://${PREVIEW}/`, ip: "203.0.113.11" })).ok,
    true,
  );
  assert.equal(
    (
      await allow(store, {
        origin: null,
        referer: "https://pigin-translator.vercel.app/path",
        ip: "203.0.113.12",
      })
    ).ok,
    true,
  );
  assert.equal(
    (await allow(store, { origin: "https://other-project.vercel.app" })).status,
    403,
  );
});

test("localhost is allowed only off Vercel", async () => {
  const store = createMemorySpeakStore();
  assert.equal(
    (
      await allow(store, {
        origin: "http://localhost:3000",
        env: {},
        ip: "127.0.0.1",
      })
    ).ok,
    true,
  );
  assert.equal(
    (
      await allow(store, {
        origin: "http://[::1]:3000",
        env: {},
        ip: "::1",
      })
    ).ok,
    true,
  );
  assert.equal(
    (await allow(store, { origin: "http://localhost:3000" })).status,
    403,
  );
});

test("a burst from one visitor stops before Azure would be called again", async () => {
  const store = createMemorySpeakStore();
  for (let i = 0; i < SPEAK_LIMITS.burstRequests; i += 1) {
    assert.equal((await allow(store, { now: NOW + i })).ok, true);
  }
  const blocked = await allow(store, { now: NOW + SPEAK_LIMITS.burstRequests });
  assert.equal(blocked.status, 429);
  assert.equal(
    (await allow(store, { now: NOW + SPEAK_LIMITS.burstWindowMs, ip: "203.0.113.10" }))
      .ok,
    true,
  );
});

test("daily character and shared budgets stop a longer run", async () => {
  const store = createMemorySpeakStore();
  const length = 4_000;
  assert.equal((await allow(store, { textLength: length, ip: "203.0.113.20" })).ok, true);
  assert.equal((await allow(store, { textLength: length, ip: "203.0.113.20" })).ok, true);
  assert.equal(
    (await allow(store, { textLength: length, ip: "203.0.113.20" })).status,
    429,
  );

  const shared = createMemorySpeakStore();
  let used = 0;
  let visitors = 0;
  while (used + 1_000 <= SPEAK_LIMITS.globalDailyCharacters) {
    const decision = await allow(shared, {
      ip: `203.0.113.${visitors}`,
      textLength: 1_000,
      now: NOW + visitors,
    });
    assert.equal(decision.ok, true);
    used += 1_000;
    visitors += 1;
  }
  assert.equal(
    (await allow(shared, { ip: "198.51.100.9", textLength: 1_000 })).status,
    429,
  );
});

test("a cache that forgets writes does not allow the call", async () => {
  const store: SpeakCounterStore = {
    async get() {
      return null;
    },
    async set() {},
  };
  assert.equal((await allow(store)).status, 429);
});

test("client address prefers x-real-ip", () => {
  const headers = new Headers({
    "x-real-ip": "203.0.113.5",
    "x-forwarded-for": "198.51.100.8, 203.0.113.5",
  });
  assert.equal(clientAddress(headers), "203.0.113.5");
  assert.equal(
    clientAddress(new Headers({ "x-forwarded-for": "198.51.100.8, 10.0.0.1" })),
    "198.51.100.8",
  );
  assert.equal(clientAddress(new Headers()), "unknown");
});
