import assert from "node:assert/strict";
import test from "node:test";
import { chooseSpeakBackend } from "./speak-cloud.ts";
import {
  SPITCH_SPEECH_URL,
  SPITCH_YORUBA_VOICE,
  SpitchSpeechError,
  synthesizeSpitchSpeech,
} from "./spitch-speech.ts";

const KEY = "spitch-test-key-not-real";

test("yoruba uses spitch and naija uses azure", () => {
  assert.equal(
    chooseSpeakBackend("yoruba", { azure: true, spitch: true }),
    "spitch",
  );
  assert.equal(
    chooseSpeakBackend("naija", { azure: true, spitch: true }),
    "azure",
  );
  assert.equal(
    chooseSpeakBackend("yoruba", { azure: true, spitch: false }),
    null,
  );
  assert.equal(
    chooseSpeakBackend("naija", { azure: false, spitch: true }),
    null,
  );
});

test("spitch request is yo/sade/mp3 and returns audio bytes", async () => {
  const previous = process.env.SPITCH_API_KEY;
  process.env.SPITCH_API_KEY = KEY;
  try {
    let seenUrl = "";
    let seenBody = "";
    let seenAuth = "";
    const audio = await synthesizeSpitchSpeech("Báwo ni?", async (url, init) => {
      seenUrl = String(url);
      seenBody = String(init?.body ?? "");
      const headers = new Headers(init?.headers);
      seenAuth = headers.get("authorization") ?? "";
      return new Response(Uint8Array.from([0xff, 0xfb, 0x90, 0x64]), {
        status: 200,
        headers: { "content-type": "audio/mpeg" },
      });
    });
    assert.equal(seenUrl, SPITCH_SPEECH_URL);
    assert.equal(seenAuth, `Bearer ${KEY}`);
    assert.deepEqual(JSON.parse(seenBody), {
      language: "yo",
      voice: SPITCH_YORUBA_VOICE,
      format: "mp3",
      text: "Báwo ni?",
    });
    assert.equal(audio.byteLength, 4);
    assert.equal(new Uint8Array(audio)[0], 0xff);
  } finally {
    restoreKey(previous);
  }
});

test("spitch errors log the status without the key or the spoken text", async () => {
  const previous = process.env.SPITCH_API_KEY;
  process.env.SPITCH_API_KEY = KEY;
  const spoken = "Báwo ni?";
  const logs: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };
  try {
    await assert.rejects(
      () =>
        synthesizeSpitchSpeech(spoken, async () => {
          return new Response(`unauthorized ${KEY} ${spoken}`, { status: 401 });
        }),
      (error: unknown) => {
        assert.ok(error instanceof SpitchSpeechError);
        assert.equal(error.status, 401);
        assert.equal(error.message.includes(KEY), false);
        assert.equal(error.message.includes(spoken), false);
        return true;
      },
    );
    const logged = logs.join("\n");
    assert.equal(logged.includes(KEY), false);
    assert.equal(logged.includes(spoken), false);
    assert.match(logged, /Spitch speech failed \(401\)/);
  } finally {
    console.error = original;
    restoreKey(previous);
  }
});

function restoreKey(previous: string | undefined) {
  if (previous === undefined) delete process.env.SPITCH_API_KEY;
  else process.env.SPITCH_API_KEY = previous;
}
