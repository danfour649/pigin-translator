export type SpeakBackend = "azure" | "spitch";

/**
 * Yorùbá uses Spitch when that key is set, and never Azure.
 * Naijá prefers Spitch (its Pidgin voices are a native fit, and the Azure
 * subscription behind the old path is disabled), then Azure when only that
 * key is set. Null means this language has no cloud voice, so the page
 * uses the browser.
 */
export function chooseSpeakBackend(
  language: "naija" | "yoruba",
  available: { azure: boolean; spitch: boolean },
): SpeakBackend | null {
  if (language === "yoruba") return available.spitch ? "spitch" : null;
  if (available.spitch) return "spitch";
  return available.azure ? "azure" : null;
}
