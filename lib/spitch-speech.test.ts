import assert from "node:assert/strict";
import test from "node:test";
import { chooseSpeakBackend } from "./speak-cloud.ts";
import {
  SPITCH_NAIJA_VOICE,
  SPITCH_SPEECH_CONFIG,
  SPITCH_SPEECH_URL,
  SPITCH_YORUBA_VOICE,
  SpitchSpeechError,
  synthesizeSpitchSpeech,
} from "./spitch-speech.ts";

const KEY = "spitch-test-key-not-real";

test("yoruba uses spitch only and naija prefers spitch over azure", () => {
  assert.equal(
    chooseSpeakBackend("yoruba", { azure: true, spitch: true }),
    "spitch",
  );
  assert.equal(
    chooseSpeakBackend("yoruba", { azure: true, spitch: false }),
    null,
  );
  assert.equal(
    chooseSpeakBackend("yoruba", { azure: false, spitch: false }),
    null,
  );
  assert.equal(
    chooseSpeakBackend("naija", { azure: true, spitch: true }),
    "spitch",
  );
  assert.equal(
    chooseSpeakBackend("naija", { azure: false, spitch: true }),
    "spitch",
  );
  assert.equal(
    chooseSpeakBackend("naija", { azure: true, spitch: false }),
    "azure",
  );
  assert.equal(
    chooseSpeakBackend("naija", { azure: false, spitch: false }),
    null,
  );
});

test("spitch config pairs yoruba with yo/sade and naija with pcm/boma", () => {
  assert.deepEqual(SPITCH_SPEECH_CONFIG.yoruba, {
    language: "yo",
    voice: SPITCH_YORUBA_VOICE,
  });
  assert.equal(SPITCH_SPEECH_CONFIG.yoruba.voice, "sade");
  assert.deepEqual(SPITCH_SPEECH_CONFIG.naija, {
    language: "pcm",
    voice: SPITCH_NAIJA_VOICE,
  });
  assert.equal(SPITCH_SPEECH_CONFIG.naija.voice, "boma");
});

test("spitch request for naija is pcm/boma/mp3 and returns audio bytes", async () => {
  const previous = process.env.SPITCH_API_KEY;
  process.env.SPITCH_API_KEY = KEY;
  try {
    let seenBody = "";
    const audio = await synthesizeSpitchSpeech(
      "I dey miss you well well.",
      async (_url, init) => {
        seenBody = String(init?.body ?? "");
        return new Response(Uint8Array.from([0xff, 0xfb, 0x90, 0x64]), {
          status: 200,
          headers: { "content-type": "audio/mpeg" },
        });
      },
      "naija",
    );
    assert.deepEqual(JSON.parse(seenBody), {
      language: "pcm",
      voice: SPITCH_NAIJA_VOICE,
      format: "mp3",
      text: "I dey miss you well well.",
    });
    assert.equal(audio.byteLength, 4);
  } finally {
    restoreKey(previous);
  }
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

test("naija retries once without the language field after a failed attempt", async () => {
  const previous = process.env.SPITCH_API_KEY;
  process.env.SPITCH_API_KEY = KEY;
  try {
    const bodies: Record<string, unknown>[] = [];
    const audio = await synthesizeSpitchSpeech(
      "I dey miss you well well.",
      async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body ?? "")));
        if (bodies.length === 1) {
          return new Response(
            JSON.stringify({ error: "language not supported" }),
            { status: 422, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(Uint8Array.from([0xff, 0xfb, 0x90, 0x64]), {
          status: 200,
          headers: { "content-type": "audio/mpeg" },
        });
      },
      "naija",
    );
    assert.equal(bodies.length, 2);
    assert.deepEqual(bodies[0], {
      language: "pcm",
      voice: "boma",
      format: "mp3",
      text: "I dey miss you well well.",
    });
    assert.deepEqual(bodies[1], {
      voice: "boma",
      format: "mp3",
      text: "I dey miss you well well.",
    });
    assert.equal(audio.byteLength, 4);
  } finally {
    restoreKey(previous);
  }
});

test("naija does not retry after a 401", async () => {
  const previous = process.env.SPITCH_API_KEY;
  process.env.SPITCH_API_KEY = KEY;
  try {
    let calls = 0;
    await assert.rejects(
      () =>
        synthesizeSpitchSpeech(
          "I dey miss you well well.",
          async () => {
            calls += 1;
            return new Response("unauthorized", { status: 401 });
          },
          "naija",
        ),
      (error: unknown) => {
        assert.ok(error instanceof SpitchSpeechError);
        assert.equal(error.status, 401);
        return true;
      },
    );
    assert.equal(calls, 1);
  } finally {
    restoreKey(previous);
  }
});

test("yoruba does not retry after a failure", async () => {
  const previous = process.env.SPITCH_API_KEY;
  process.env.SPITCH_API_KEY = KEY;
  try {
    let calls = 0;
    await assert.rejects(
      () =>
        synthesizeSpitchSpeech("Báwo ni?", async () => {
          calls += 1;
          return new Response("server error", { status: 500 });
        }),
      (error: unknown) => {
        assert.ok(error instanceof SpitchSpeechError);
        assert.equal(error.status, 502);
        return true;
      },
    );
    assert.equal(calls, 1);
  } finally {
    restoreKey(previous);
  }
});

function restoreKey(previous: string | undefined) {
  if (previous === undefined) delete process.env.SPITCH_API_KEY;
  else process.env.SPITCH_API_KEY = previous;
}
