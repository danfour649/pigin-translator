import assert from "node:assert/strict";
import test from "node:test";
import {
  CLOUD_AUDIO_MISSING,
  audioFileForSpeak,
  canShareAudioFile,
  isMp3ContentType,
  spokenAudioFilename,
} from "./spoken-audio.ts";

const BYTES = new Uint8Array([0xff, 0xfb, 0x90, 0x64, 0x00, 0x00, 0x00, 0x00]);

test("cloud mp3 can be saved per language and browser speech cannot", async () => {
  const blob = new Blob([BYTES], { type: "audio/mpeg" });

  const naija = audioFileForSpeak("cloud", "naija", blob, "audio/mpeg");
  assert.ok(naija);
  assert.equal(naija.name, "pigin-naija.mp3");
  assert.equal(naija.type, "audio/mpeg");
  assert.equal(naija.size, BYTES.byteLength);
  assert.deepEqual(new Uint8Array(await naija.arrayBuffer()), BYTES);

  const yoruba = audioFileForSpeak(
    "cloud",
    "yoruba",
    blob,
    "audio/mpeg; charset=binary",
  );
  assert.equal(yoruba?.name, "pigin-yoruba.mp3");
  assert.equal(yoruba?.type, "audio/mpeg");

  assert.equal(audioFileForSpeak("browser", "naija", blob, "audio/mpeg"), null);
  assert.equal(audioFileForSpeak("browser", "yoruba", blob, "audio/mpeg"), null);
  assert.equal(
    audioFileForSpeak("cloud", "naija", new Blob([]), "audio/mpeg"),
    null,
  );
  assert.equal(audioFileForSpeak("cloud", "yoruba", null, "audio/mpeg"), null);
  assert.equal(audioFileForSpeak("cloud", "naija", blob, "application/json"), null);
  assert.equal(audioFileForSpeak("cloud", "yoruba", blob, "audio/ogg"), null);
});

test("filenames are mp3 and the missing-cloud note does not invent a file", () => {
  assert.equal(spokenAudioFilename("naija"), "pigin-naija.mp3");
  assert.equal(spokenAudioFilename("yoruba"), "pigin-yoruba.mp3");
  assert.match(spokenAudioFilename("naija"), /\.mp3$/);
  assert.equal(isMp3ContentType("audio/mpeg"), true);
  assert.equal(isMp3ContentType("audio/mp3"), true);
  assert.equal(isMp3ContentType("audio/ogg"), false);
  assert.match(CLOUD_AUDIO_MISSING, /cloud voice was not used/i);
  assert.doesNotMatch(CLOUD_AUDIO_MISSING, /https?:\/\//);
});

test("share is unavailable when the browser cannot share files", () => {
  const file = audioFileForSpeak(
    "cloud",
    "naija",
    new Blob([BYTES], { type: "audio/mpeg" }),
    "audio/mpeg",
  );
  assert.ok(file);
  const previous = globalThis.navigator;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {},
  });
  try {
    assert.equal(canShareAudioFile(file), false);
  } finally {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: previous,
    });
  }
});
