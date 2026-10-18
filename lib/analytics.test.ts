import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { computeRoute } from "@vercel/analytics";
import { pageViewBeforeSend } from "./analytics.ts";

const PRIVATE = "my husband is vaping every time";
const ORIGIN = "https://pigin-translator.vercel.app";

type SentView = { o: string; dp?: string };

/**
 * What the production script would POST after the Next.js component calls
 * pageview({ route, path }). `beforeSend` can replace `o` or cancel the
 * request. It cannot edit `dp`.
 */
function sentPageView(href: string): SentView | null {
  const locationUrl = new URL(href);
  const path = locationUrl.pathname;
  const route = computeRoute(
    path,
    Object.fromEntries(locationUrl.searchParams.entries()),
  );

  let reportedUrl = href;
  const withPath = new URL(href);
  if (withPath.pathname !== path) {
    withPath.pathname = path;
    withPath.search = "";
    reportedUrl = withPath.href;
  }

  const filtered = pageViewBeforeSend({ type: "pageview", url: reportedUrl });
  if (!filtered) return null;

  return {
    o: filtered.url,
    ...(route ? { dp: route } : {}),
  };
}

function assertNoPrivateText(value: unknown) {
  assert.equal(JSON.stringify(value).includes(PRIVATE), false);
}

test("a normal home page view is kept", () => {
  const sent = sentPageView(`${ORIGIN}/`);
  assert.deepEqual(sent, { o: `${ORIGIN}/`, dp: "/" });
});

test("a query value is stripped and the route stays the home page", () => {
  const href = `${ORIGIN}/?text=${encodeURIComponent(PRIVATE)}`;
  const route = computeRoute("/", { text: PRIVATE });
  assert.equal(route, "/");

  const sent = sentPageView(href);
  assert.deepEqual(sent, { o: `${ORIGIN}/`, dp: "/" });
  assertNoPrivateText(sent);
});

test("a hash is stripped from the page view", () => {
  const sent = sentPageView(`${ORIGIN}/#${encodeURIComponent(PRIVATE)}`);
  assert.deepEqual(sent, { o: `${ORIGIN}/`, dp: "/" });
  assertNoPrivateText(sent);
});

test("an empty query key is not sent because it becomes the route", () => {
  const href = `${ORIGIN}/?${encodeURIComponent(PRIVATE)}`;
  const route = computeRoute(
    "/",
    Object.fromEntries(new URL(href).searchParams.entries()),
  );
  assert.equal(route?.includes(PRIVATE), true);
  assert.equal(sentPageView(href), null);
});

test("a path that carries text is not sent", () => {
  const href = `${ORIGIN}/${encodeURIComponent(PRIVATE)}`;
  const route = computeRoute(new URL(href).pathname, {});
  assert.equal(decodeURIComponent(route ?? "").includes(PRIVATE), true);
  assert.equal(sentPageView(href), null);
});

test("custom events are dropped even when they carry text", () => {
  const dropped = pageViewBeforeSend({
    type: "event",
    url: `${ORIGIN}/`,
    payload: { name: "translate", data: { text: PRIVATE } },
  } as Parameters<typeof pageViewBeforeSend>[0]);
  assert.equal(dropped, null);
});

test("page views do not forward extra fields", () => {
  const event = pageViewBeforeSend({
    type: "pageview",
    url: `${ORIGIN}/?note=${encodeURIComponent(PRIVATE)}#${encodeURIComponent(PRIVATE)}`,
  });
  assert.deepEqual(event, { type: "pageview", url: `${ORIGIN}/` });
});

test("urls that are not http(s) are dropped", () => {
  assert.equal(
    pageViewBeforeSend({ type: "pageview", url: "not a url" }),
    null,
  );
  assert.equal(
    pageViewBeforeSend({
      type: "pageview",
      url: "javascript:alert(1)",
    }),
    null,
  );
});

test("the app records page views only and does not put text in urls", () => {
  const layout = readFileSync("app/layout.tsx", "utf8");
  const widget = readFileSync("components/web-analytics.tsx", "utf8");
  const translator = readFileSync("components/translator.tsx", "utf8");

  assert.match(layout, /<WebAnalytics \/>/);
  assert.match(widget, /@vercel\/analytics\/next/);
  assert.match(widget, /beforeSend=\{pageViewBeforeSend\}/);
  assert.doesNotMatch(widget, /\btrack\(/);

  assert.doesNotMatch(
    translator,
    /useSearchParams|URLSearchParams|useRouter|history\.(push|replace)State|window\.location|document\.location/,
  );
  assert.doesNotMatch(translator, /fetch\(`[^`]*\$\{/);

  const source = sourceText(["app", "components", "lib"]);
  assert.doesNotMatch(source, /from ["']@vercel\/analytics["']/);
  assert.doesNotMatch(source, /from ["']@vercel\/analytics\/server["']/);
  assert.doesNotMatch(source, /\btrack\(/);
});

function sourceText(dirs: string[]): string {
  const files: string[] = [];
  for (const dir of dirs) collect(dir, files);
  return files
    .filter((file) => /\.(ts|tsx)$/.test(file) && !file.endsWith(".test.ts"))
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
}

function collect(dir: string, files: string[]) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) collect(path, files);
    else files.push(path);
  }
}
