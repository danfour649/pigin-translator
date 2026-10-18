"use client";

import { pageViewBeforeSend } from "@/lib/analytics";
import { Analytics } from "@vercel/analytics/next";

export function WebAnalytics() {
  return <Analytics beforeSend={pageViewBeforeSend} />;
}
