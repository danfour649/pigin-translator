/**
 * Cloud Speak returns audio/mpeg from POST /api/speak. Phones can attach that
 * MP3 from a download or the system share sheet. Browser speech never has
 * bytes, so it must not produce a file.
 */

export const SPOKEN_AUDIO_MIME = "audio/mpeg";

export const CLOUD_AUDIO_MISSING =
  "The cloud voice was not used, so there is no audio file to save.";

const MP3_TYPES = new Set(["audio/mpeg", "audio/mp3"]);

export function spokenAudioFilename(language: "naija" | "yoruba"): string {
  return `pigin-${language}.mp3`;
}

export function audioFileForSpeak(
  source: "cloud" | "browser",
  language: "naija" | "yoruba",
  blob: Blob | null,
  contentType: string,
): File | null {
  if (source !== "cloud" || !blob || blob.size === 0) return null;
  if (!isMp3ContentType(contentType)) return null;
  return new File([blob], spokenAudioFilename(language), {
    type: SPOKEN_AUDIO_MIME,
  });
}

export function isMp3ContentType(contentType: string): boolean {
  const type = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  return MP3_TYPES.has(type);
}

export function canShareAudioFile(file: File): boolean {
  if (typeof navigator === "undefined" || typeof navigator.canShare !== "function") {
    return false;
  }
  try {
    return navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

export function downloadAudioFile(url: string, filename: string): void {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename.endsWith(".mp3") ? filename : `${filename}.mp3`;
  anchor.type = SPOKEN_AUDIO_MIME;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

export async function shareSpokenAudio(
  file: File,
): Promise<"shared" | "cancelled" | "unavailable"> {
  if (!canShareAudioFile(file) || typeof navigator.share !== "function") {
    return "unavailable";
  }
  try {
    await navigator.share({ files: [file] });
    return "shared";
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return "cancelled";
    }
    return "unavailable";
  }
}
