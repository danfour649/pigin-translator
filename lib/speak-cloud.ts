export type SpeakBackend = "azure" | "spitch";

/**
 * Yorùbá uses Spitch when that key is set, and never Azure.
 * Naijá uses Azure when that key is set, and never Spitch.
 * Null means this language has no cloud voice, so the page uses the browser.
 */
export function chooseSpeakBackend(
  language: "naija" | "yoruba",
  available: { azure: boolean; spitch: boolean },
): SpeakBackend | null {
  if (language === "yoruba") return available.spitch ? "spitch" : null;
  return available.azure ? "azure" : null;
}
