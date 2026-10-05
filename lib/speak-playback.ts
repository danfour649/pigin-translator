/**
 * Cloud Speak plays an MP3 in a page audio element. The card may say a cloud
 * voice is speaking only after that element has actually started. A detached
 * player can report success while iOS keeps the ambient audio session, which
 * the ringer switch mutes. "playback" is the session type that stays audible.
 */

export const PLAYBACK_SESSION = "playback";
export const IDLE_SESSION = "auto";

export const SPEAK_WAITING = "Getting the voice…";

export const PLAYBACK_DID_NOT_START =
  "The voice did not start playing, so nothing was spoken. You can still download the recording.";

export const BROWSER_PLAYBACK_FAILED =
  "This browser could not play the translation.";

/** How long to wait for browser speech to fire start before admitting it did not. */
export const BROWSER_SPEECH_START_MS = 3000;

export type AudioSessionLike = { type: string };

export type PlaybackSnapshot = {
  paused: boolean;
  ended: boolean;
  muted: boolean;
  volume: number;
  error: boolean;
};

export type CloudSpeakCard = {
  speaking: boolean;
  voiceNote: string | null;
  audioHint: string | null;
  error: string | null;
  offerFile: boolean;
  useBrowserVoice: boolean;
};

export type BrowserSpeechCard = {
  speaking: boolean;
  voiceNote: string | null;
  error: string | null;
};

export function audioSessionOf(
  nav: object | null | undefined,
): AudioSessionLike | null {
  if (!nav || !("audioSession" in nav)) return null;
  const session = (nav as { audioSession?: unknown }).audioSession;
  if (!session || typeof session !== "object" || !("type" in session)) return null;
  const type = (session as { type?: unknown }).type;
  if (typeof type !== "string") return null;
  return session as AudioSessionLike;
}

export function setAudioSessionType(
  session: AudioSessionLike | null,
  type: typeof PLAYBACK_SESSION | typeof IDLE_SESSION,
): void {
  if (!session) return;
  try {
    session.type = type;
  } catch {
    // The session can be visible but refuse assignment.
  }
}

export function playbackHasStarted(snapshot: PlaybackSnapshot): boolean {
  return (
    !snapshot.error &&
    !snapshot.paused &&
    !snapshot.ended &&
    !snapshot.muted &&
    snapshot.volume > 0
  );
}

export function snapshotSpeaker(audio: {
  paused: boolean;
  ended: boolean;
  muted: boolean;
  volume: number;
  error: { code?: number } | null;
}): PlaybackSnapshot {
  return {
    paused: audio.paused,
    ended: audio.ended,
    muted: audio.muted,
    volume: audio.volume,
    error: audio.error != null,
  };
}

/**
 * Speaking is claimed only once the cloud MP3 is actually playing.
 * A file that arrived but did not start stays downloadable, and the browser
 * voice is not asked to pretend it spoke.
 */
export function cloudSpeakCard(input: {
  receivedAudio: boolean;
  playbackStarted: boolean;
  providerLabel: string;
  voiceName: string;
}): CloudSpeakCard {
  if (input.receivedAudio && input.playbackStarted) {
    return {
      speaking: true,
      voiceNote: `Speaking with ${input.providerLabel} ${input.voiceName}.`,
      audioHint: null,
      error: null,
      offerFile: true,
      useBrowserVoice: false,
    };
  }

  if (input.receivedAudio) {
    return {
      speaking: false,
      voiceNote: null,
      audioHint: null,
      error: PLAYBACK_DID_NOT_START,
      offerFile: true,
      useBrowserVoice: false,
    };
  }

  return {
    speaking: false,
    voiceNote: null,
    // Same sentence as CLOUD_AUDIO_MISSING in spoken-audio.ts.
    audioHint:
      "The cloud voice was not used, so there is no audio file to save.",
    error: null,
    offerFile: false,
    useBrowserVoice: true,
  };
}

export function waitingToSpeakCard(): CloudSpeakCard {
  return {
    speaking: false,
    voiceNote: null,
    audioHint: SPEAK_WAITING,
    error: null,
    offerFile: false,
    useBrowserVoice: false,
  };
}

export type ReplayResult<T> = {
  clip: T | null;
  /** True only when no clip was already in hand, so the provider was asked. */
  fetched: boolean;
  started: boolean;
};

/**
 * Replay a spoken clip. A clip already in hand plays with no provider call.
 * With nothing saved, fetch once; the caller keeps that clip for the next replay.
 * `started` comes from playback, so the caller must not claim speaking earlier.
 */
export async function replayClip<T extends { url: string }>(input: {
  saved: T | null;
  fetchClip: () => Promise<T | null>;
  play: (clip: T) => Promise<boolean>;
}): Promise<ReplayResult<T>> {
  if (input.saved?.url) {
    const started = await input.play(input.saved);
    return { clip: input.saved, fetched: false, started };
  }

  const clip = await input.fetchClip();
  if (!clip?.url) return { clip: null, fetched: true, started: false };
  const started = await input.play(clip);
  return { clip, fetched: true, started };
}

/** Browser speech is claimed only from its start event, never from the click. */
export function browserSpeechCard(
  event: "start" | "end" | "error" | "timeout",
  note: string,
): BrowserSpeechCard {
  if (event === "start") {
    return { speaking: true, voiceNote: note, error: null };
  }
  if (event === "end") {
    return { speaking: false, voiceNote: note, error: null };
  }
  return { speaking: false, voiceNote: null, error: BROWSER_PLAYBACK_FAILED };
}

let cachedSilentSrc: string | null = null;

/** Short silent WAV used to unlock the page element inside the Speak click. */
export function silentUnlockSrc(): string {
  if (cachedSilentSrc) return cachedSilentSrc;
  cachedSilentSrc = buildSilentWavDataUri();
  return cachedSilentSrc;
}

export function armSpeaker(audio: HTMLAudioElement, parent: ParentNode): void {
  setAudioSessionType(audioSessionOf(navigator), PLAYBACK_SESSION);
  placeSpeaker(audio, parent);
  audio.muted = false;
  audio.volume = 1;
  audio.loop = true;
  const unlock = silentUnlockSrc();
  if (audio.src !== unlock) audio.src = unlock;
  const pending = audio.play();
  void pending?.catch(() => {});
}

export function stopSpeaker(audio: HTMLAudioElement | null): void {
  if (!audio) return;
  audio.loop = false;
  audio.onended = null;
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
}

/**
 * Play a cloud MP3 on the element that was armed in the click.
 * Resolves true only after the element is actually playing.
 */
export function playCloudMp3(
  audio: HTMLAudioElement,
  url: string,
  timeoutMs = 4000,
): Promise<boolean> {
  setAudioSessionType(audioSessionOf(navigator), PLAYBACK_SESSION);
  audio.loop = false;
  audio.muted = false;
  audio.volume = 1;
  audio.pause();
  audio.src = url;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("error", onError);
      resolve(value);
    };
    const onPlaying = () => {
      if (playbackHasStarted(snapshotSpeaker(audio))) finish(true);
    };
    const onError = () => finish(false);
    const timer = window.setTimeout(() => finish(false), timeoutMs);
    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("error", onError);
    audio.play().then(
      () => {
        if (playbackHasStarted(snapshotSpeaker(audio))) finish(true);
      },
      () => finish(false),
    );
  });
}

function placeSpeaker(audio: HTMLAudioElement, parent: ParentNode): void {
  audio.preload = "auto";
  // Chrome hides audio:not([controls]) with display:none, and iOS will not
  // treat that as media playback. Keep controls and park the element off-screen.
  audio.controls = true;
  audio.setAttribute("playsinline", "true");
  audio.setAttribute("webkit-playsinline", "true");
  audio.dataset.piginSpeaker = "true";
  audio.tabIndex = -1;
  audio.setAttribute("aria-hidden", "true");
  audio.style.setProperty("display", "block", "important");
  audio.style.position = "fixed";
  audio.style.left = "0";
  audio.style.bottom = "0";
  audio.style.width = "2px";
  audio.style.height = "2px";
  audio.style.opacity = "0.02";
  audio.style.pointerEvents = "none";
  if (audio.parentNode !== parent) parent.append(audio);
}

function buildSilentWavDataUri(): string {
  const samples = 400;
  const bytes = new Uint8Array(44 + samples);
  const view = new DataView(bytes.buffer);
  writeAscii(bytes, 0, "RIFF");
  view.setUint32(4, 36 + samples, true);
  writeAscii(bytes, 8, "WAVE");
  writeAscii(bytes, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true);
  view.setUint32(28, 8000, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  writeAscii(bytes, 36, "data");
  view.setUint32(40, samples, true);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:audio/wav;base64,${btoa(binary)}`;
}

function writeAscii(bytes: Uint8Array, offset: number, text: string) {
  for (let index = 0; index < text.length; index += 1) {
    bytes[offset + index] = text.charCodeAt(index);
  }
}
