import assert from "node:assert/strict";
import test from "node:test";
import { CLOUD_AUDIO_MISSING } from "./spoken-audio.ts";
import {
  BROWSER_PLAYBACK_FAILED,
  PLAYBACK_DID_NOT_START,
  PLAYBACK_SESSION,
  SPEAK_WAITING,
  browserSpeechCard,
  cloudSpeakCard,
  playbackHasStarted,
  replayClip,
  setAudioSessionType,
  silentUnlockSrc,
  waitingToSpeakCard,
} from "./speak-playback.ts";

test("the card claims a cloud voice only after playback has started", () => {
  const speaking = cloudSpeakCard({
    receivedAudio: true,
    playbackStarted: true,
    providerLabel: "Azure",
    voiceName: "en-NG-EzinneNeural",
  });
  assert.equal(speaking.speaking, true);
  assert.equal(speaking.voiceNote, "Speaking with Azure en-NG-EzinneNeural.");
  assert.equal(speaking.error, null);
  assert.equal(speaking.audioHint, null);
  assert.equal(speaking.offerFile, true);
  assert.equal(speaking.useBrowserVoice, false);

  const spitch = cloudSpeakCard({
    receivedAudio: true,
    playbackStarted: true,
    providerLabel: "Spitch",
    voiceName: "sade",
  });
  assert.equal(spitch.voiceNote, "Speaking with Spitch sade.");
  assert.equal(spitch.offerFile, true);
});

test("a cloud MP3 that never starts is not described as speaking", () => {
  const card = cloudSpeakCard({
    receivedAudio: true,
    playbackStarted: false,
    providerLabel: "Azure",
    voiceName: "en-NG-EzinneNeural",
  });
  assert.equal(card.speaking, false);
  assert.equal(card.voiceNote, null);
  assert.equal(card.error, PLAYBACK_DID_NOT_START);
  assert.equal(card.offerFile, true);
  assert.equal(card.useBrowserVoice, false);
  assert.doesNotMatch(card.error ?? "", /speaking with/i);
  assert.doesNotMatch(card.error ?? "", /browser/i);
  assert.doesNotMatch(card.error ?? "", /azure|spitch/i);
  assert.match(card.error ?? "", /did not start playing/i);
  assert.match(card.error ?? "", /download/i);
});

test("without a cloud MP3 the file stays hidden and the browser may try", () => {
  const card = cloudSpeakCard({
    receivedAudio: false,
    playbackStarted: false,
    providerLabel: "Spitch",
    voiceName: "sade",
  });
  assert.equal(card.speaking, false);
  assert.equal(card.voiceNote, null);
  assert.equal(card.offerFile, false);
  assert.equal(card.useBrowserVoice, true);
  assert.equal(card.audioHint, CLOUD_AUDIO_MISSING);
  assert.match(card.audioHint ?? "", /cloud voice was not used/i);
});

test("waiting for audio does not claim that a voice is speaking", () => {
  const card = waitingToSpeakCard();
  assert.equal(card.speaking, false);
  assert.equal(card.voiceNote, null);
  assert.equal(card.offerFile, false);
  assert.equal(card.useBrowserVoice, false);
  assert.equal(card.audioHint, SPEAK_WAITING);
  assert.doesNotMatch(card.audioHint ?? "", /speaking with/i);
});

test("playback has started only when the element is actually outputting", () => {
  const playing = {
    paused: false,
    ended: false,
    muted: false,
    volume: 1,
    error: false,
  };
  assert.equal(playbackHasStarted(playing), true);
  assert.equal(playbackHasStarted({ ...playing, paused: true }), false);
  assert.equal(playbackHasStarted({ ...playing, ended: true }), false);
  assert.equal(playbackHasStarted({ ...playing, muted: true }), false);
  assert.equal(playbackHasStarted({ ...playing, volume: 0 }), false);
  assert.equal(playbackHasStarted({ ...playing, error: true }), false);
});

test("the playback session is requested, and a refusal does not throw", () => {
  const session = { type: "auto" };
  setAudioSessionType(session, PLAYBACK_SESSION);
  assert.equal(session.type, "playback");
  setAudioSessionType(session, "auto");
  assert.equal(session.type, "auto");
  setAudioSessionType(null, PLAYBACK_SESSION);

  const blocked: { type: string } = { type: "ambient" };
  Object.defineProperty(blocked, "type", {
    configurable: true,
    get: () => "ambient",
    set: () => {
      throw new DOMException("Not allowed");
    },
  });
  assert.doesNotThrow(() => setAudioSessionType(blocked, PLAYBACK_SESSION));
  assert.equal(blocked.type, "ambient");
});

test("browser speech is claimed only after it starts", () => {
  const note = "Speaking with Samantha.";
  const waiting = browserSpeechCard("timeout", note);
  assert.equal(waiting.speaking, false);
  assert.equal(waiting.voiceNote, null);
  assert.equal(waiting.error, BROWSER_PLAYBACK_FAILED);
  assert.doesNotMatch(waiting.error ?? "", /speaking with/i);

  const started = browserSpeechCard("start", note);
  assert.equal(started.speaking, true);
  assert.equal(started.voiceNote, note);
  assert.equal(started.error, null);

  const ended = browserSpeechCard("end", note);
  assert.equal(ended.speaking, false);
  assert.equal(ended.voiceNote, note);

  const failed = browserSpeechCard("error", note);
  assert.equal(failed.speaking, false);
  assert.equal(failed.voiceNote, null);
  assert.equal(failed.error, BROWSER_PLAYBACK_FAILED);
});

test("replay plays a saved clip without asking the provider again", async () => {
  let fetches = 0;
  const saved = { url: "blob:held" };
  const first = await replayClip({
    saved,
    fetchClip: async () => {
      fetches += 1;
      return { url: "blob:new" };
    },
    play: async () => true,
  });
  assert.equal(fetches, 0);
  assert.equal(first.fetched, false);
  assert.equal(first.clip?.url, "blob:held");
  assert.equal(first.started, true);

  const again = await replayClip({
    saved: first.clip,
    fetchClip: async () => {
      fetches += 1;
      return { url: "blob:again" };
    },
    play: async () => false,
  });
  assert.equal(fetches, 0);
  assert.equal(again.fetched, false);
  assert.equal(again.started, false);
  assert.equal(again.clip?.url, "blob:held");

  const speaking = cloudSpeakCard({
    receivedAudio: first.clip != null,
    playbackStarted: first.started,
    providerLabel: "Azure",
    voiceName: "en-NG-EzinneNeural",
  });
  const quiet = cloudSpeakCard({
    receivedAudio: again.clip != null,
    playbackStarted: again.started,
    providerLabel: "Azure",
    voiceName: "en-NG-EzinneNeural",
  });
  assert.equal(speaking.speaking, true);
  assert.equal(speaking.offerFile, true);
  assert.equal(quiet.speaking, false);
  assert.equal(quiet.offerFile, true);
  assert.equal(quiet.error, PLAYBACK_DID_NOT_START);
});

test("replay fetches a missing clip once, then later replays use it", async () => {
  let fetches = 0;
  let plays = 0;
  const first = await replayClip({
    saved: null,
    fetchClip: async () => {
      fetches += 1;
      return { url: "blob:once" };
    },
    play: async (clip) => {
      plays += 1;
      return clip.url === "blob:once";
    },
  });
  assert.equal(fetches, 1);
  assert.equal(first.fetched, true);
  assert.equal(first.started, true);

  const second = await replayClip({
    saved: first.clip,
    fetchClip: async () => {
      fetches += 1;
      return { url: "blob:twice" };
    },
    play: async () => {
      plays += 1;
      return true;
    },
  });
  assert.equal(fetches, 1);
  assert.equal(plays, 2);
  assert.equal(second.fetched, false);
  assert.equal(second.clip?.url, "blob:once");

  let missedPlays = 0;
  const missed = await replayClip({
    saved: null,
    fetchClip: async () => null,
    play: async () => {
      missedPlays += 1;
      return true;
    },
  });
  assert.equal(missed.clip, null);
  assert.equal(missed.fetched, true);
  assert.equal(missed.started, false);
  assert.equal(missedPlays, 0);
});

test("the unlock clip is a silent wav, not an empty src", () => {
  const src = silentUnlockSrc();
  assert.match(src, /^data:audio\/wav;base64,/);
  const bytes = Buffer.from(src.slice("data:audio/wav;base64,".length), "base64");
  assert.equal(bytes.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(bytes.subarray(8, 12).toString("ascii"), "WAVE");
  assert.ok(bytes.byteLength > 44);
});
