import type { BeforeSendEvent } from "@vercel/analytics/next";

const HOME_PATH = "/";

/**
 * Keep page views of `/` and nothing else.
 *
 * The Web Analytics script reports `location.href`, so a query or hash would
 * be stored with the page view. It also sends a route (`dp`) that
 * `beforeSend` cannot change. `@vercel/analytics` builds that route from
 * search params when the page has no dynamic segments, and an empty query
 * value is copied in as the parameter name. Returning null drops the whole
 * event, including that route. Any other query is removed from the URL.
 * Custom events are dropped so text never rides along as event data.
 */
export function pageViewBeforeSend(
  event: BeforeSendEvent,
): BeforeSendEvent | null {
  if (event.type !== "pageview") return null;

  let url: URL;
  try {
    url = new URL(event.url);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.pathname !== HOME_PATH) return null;

  for (const value of url.searchParams.values()) {
    if (value.length === 0) return null;
  }

  url.search = "";
  url.hash = "";
  url.username = "";
  url.password = "";

  return { type: "pageview", url: url.toString() };
}
