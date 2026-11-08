# Session findings 2026-11-08: Spitch account, translator, latency — and the streaming stretch goal

This document records a checked account session against Spitch (the speech
vendor this app depends on) and a new stretch goal that came out of a family
conversation the same day. The findings below were verified live on
2026-11-08. The stretch goal is a goal, not a plan and not a commitment:
nothing in it has been built, prototyped, or scheduled.

## The stretch goal (new, 2026-11-08)

**Real-time streaming English → Yorùbá**: speak English, hear Yorùbá back
with conversation-grade latency, instead of the current
type → wait → whole-audio-file flow.

Origin: Daniel discussed the app with his wife Folasade (the app's Yorùbá
reviewer) and a Ugandan friend who is married to a Nigerian. The friend
suggested real-time streaming English-to-Yoruba. Daniel adopted it as the
new stretch goal, with a second strand: **it may soon be time to build our
own translation model and our own voice**, rather than renting both.

Why now, in Daniel's words: the Lambda speak route was a good step, but the
translations still come slow. The latency evidence below supports that —
each vendor call in the current chain costs seconds, and the calls are
sequential.

### What "streaming" would have to mean here

- Streaming English speech in (incremental ASR), incremental translation,
  streaming Yorùbá speech out — partial results at every stage, no
  whole-utterance waits.
- A first-audio target in the ~1 second class. (A target, not a measured
  result; the current pipeline is an order of magnitude off it.)
- Architecture consequence: the current request/response shape — a Vercel
  route for translation and an AWS Lambda (`pigin-speak`, ca-central-1)
  for speech, each returning a finished result — cannot stream. A
  streaming version needs persistent connections (e.g. WebSocket) and a
  long-lived service, not a Lambda invocation per utterance. That is a new
  deployment shape for this project, and it is unscoped.

### What "our own model and voice" would have to mean here

- Translation: **we are not starting from scratch — the data asset
  already exists.** The corpus project (see `corpus/README.md`) banked
  **201,426 English → {Yorùbá, Naija} records** on 2026-10-23: two
  teachers (GPT-6 Astra on Azure, and Muse) × 50,360 source lines each
  (40,000 Tatoeba + 10,360 generated pack lines), generated against the
  Azure trial credit (~$283; Daniel recalls it as ~$200 of free credit —
  the README's estimate stands until Azure's lagged billing replaces
  it), archived hash-verified to Drive, Box, and Dropbox. What has
  **not** happened is the training itself: Stage 4 in the corpus plan —
  one funded RunPod session, full fine-tune of MADLAD-400 7B
  (Apache 2.0), NLLB-200 as evaluation yardstick only, preference pass
  toward Folasade's accepted versions, fallback a distilled 3B / LoRA
  on the home RTX 4060. The challenge is that training-and-serving
  step, not data creation. The licence discipline in
  `docs/yoruba-translation-plan.md` still binds (MENYO-20k CC-BY-NC
  train-only, no MENYO/FLORES test data in training, per-record licence
  fields so an NC-clean subset can be filtered). A self-hosted model
  would additionally remove the per-call latency and the vendor
  dependency below, and is a prerequisite for streaming: a rented,
  ~6 s-per-call, request/response API cannot be the middle of a
  real-time pipeline.
- Voice: no work has started, no approach has been chosen, and unlike
  translation there is no banked asset — this is the genuinely
  from-zero strand. The obvious raw material is recording Folasade
  herself: she is the app's reviewer, a native speaker, and already the
  human quality gate for the text side. Before anything is recorded:
  explicit consent and usage terms for her voice (it is her voice, and
  a trained model of it is a durable artifact, not a session file), a
  licence check on any base model, and a recording protocol (script
  coverage of Yorùbá phonemes and tone contours, quiet-room takes,
  consistent mic) sized from the corpus sentences we already own —
  the Yorùbá side of the corpus doubles as the recording script.
  **Defect that proves the headroom (observed 2026-11-08):** Spitch's
  Sade voice mispronounces the name *Folasade* itself — a hard English
  "Sade" instead of the natural Ṣade ("shade": the Ṣ is /ʃ/). The
  vendor's own flagship-named voice gets the app's central person's
  name wrong. A voice trained on Folasade would, at minimum, say
  Folasade's name the way Folasade says it. First cheap experiment
  before any recording: an A/B of the undiacritized spelling
  ("Folasade") against the fully marked spelling ("Fọláṣade") through
  the current speak route, judged by Folasade — if orthography alone
  fixes it, that is a pipeline fix, not a voice programme; if it does
  not, the case for an own voice is stronger. (The A/B pair was
  generated the same day as this addendum; her verdict is pending.)
  Spitch's Sade remains the quality bar and the benchmark, and Spitch
  remains the fallback while it works — the corpus findings already
  recorded the split: Folasade judged Muse's *translation* more
  accurate and Astra-via-Spitch's *pronunciation* better, which is
  exactly the gap an own voice would have to close.
- Evaluation stays human: a held-out set graded by Folasade, per the
  existing plan. Latency gets measured the same way this session measured
  it — off the real service, not off estimates.

### Open questions the stretch goal does not answer

- Does streaming cover Nigerian Pidgin too, or Yorùbá first?
- What latency budget does each stage get (ASR / translate / TTS)?
- Where would a long-lived streaming service run, and at what cost?
- The still-unanswered terms question to Spitch (below) matters more, not
  less, while the app is public and free on a rented API.

## Session findings: Spitch, checked 2026-11-08

### Account and balance

- Sign-in is **Google only** (danfour@gmail.com) — there is no Spitch
  password. Login redirects to the redesigned console at
  `https://spitch.app/api` (Home page, "Personal" workspace).
- **Credit left: $6.85 USD.** Spent this month: $0.59. The balance is
  labelled "CREDIT LEFT" in the top statistics row of the /api Home page.
- Usage shown the same day: 23 requests in Nov 1–8, all text-to-speech;
  0 failed in 24 h. Tier 1 (180 TTS sec/min, 3 concurrent).
- **Latency shown on that page: median 5,782 ms, P95 6,008 ms.** A single
  vendor call costing ~6 s is the factual basis for the "translations come
  slow" complaint: the current flow chains several of these in sequence.

### The redesign

- Spitch replaced its site with a developer console (Home, Playground,
  Files, API keys, Request logs, Usage, Limits, Billing). The old simple
  page — log in, see your key and balance — is gone, and the balance moved
  to the Home statistics row with no pointer to it.
- Their documentation has not caught up: `docs.spitch.app` still describes
  the old site ("after logging in, an API key is automatically generated
  for you… click the refresh button"), last updated 2026-07-27. No public
  announcement or changelog for the redesign was found.
- No balance/credits endpoint is documented in the public API docs, so the
  balance can only be read by logging into the console. (The one short
  translator test below cost < $0.01; the balance still read $6.85 after.)

### Their "translator" is an API playground, not a translator

- There is no Translate page, menu item, or consumer UI anywhere in the
  console. Translation exists only as an endpoint in the developer
  Playground: `https://spitch.app/api/playground?endpoint=translate`
  (Playground → Endpoint dropdown → Text group → "Translation —
  POST /v1/translate").
- Using it means: replace a pre-filled example sentence in a `text` field,
  set `target`, find the source language inside collapsed "Optional
  parameters", click **Run request** (no button says "Translate"), and
  read the result as raw JSON in a Response pane.
- The `tone` parameter is misleadingly named: it selects register
  (neutral / warm / professional / narration), **not** Yorùbá tone marks.
  Diacritics are a separate endpoint ("Diacritize").
- Test run, 2026-11-08, English → Yorùbá, no optional parameters:
  - In: "Good morning, how are you today?"
  - Out (the `text` field of the JSON response, 200 OK in 5,780 ms):
    "Ẹ káàálàá, báwo ni ó ṣe wà lónìí?"
  - Tone marks were present throughout the output.
- The engine is good; the surface is a test bench. This app remains, as of
  this session, the usable human-facing translator of the two.

### Pricing (from docs.spitch.app, as read 2026-11-08)

| Feature | Price |
| --- | --- |
| Speech generation | $0.0014 per second |
| Transcription | $0.00042 per second |
| Translation | $1 per 10,000 words |
| Tone marking | $1 per 10,000 words |

New accounts get $1 free credit.

### The unanswered email

- On 2026-10-31 Daniel emailed admin@spitch.app ("Thank you for Spitch,
  plus a quick terms question"): thanked them, linked this app, offered
  Folasade as a tester for their translation services, and asked whether
  this free, personal-use, rate-limited public page stays within their
  Terms of Service, especially the commercial-use section.
- As of 2026-11-08 there is **no reply** — checked in Gmail: the thread
  contains only the sent message, and no mail from the spitch.app domain
  exists in the mailbox. The terms question is therefore still open, and
  it is the same open question flagged in
  `docs/yoruba-translation-plan.md` from the other side: public use on
  resources whose terms have not been confirmed.

## Bottom line

The dependency works and is cheap ($6.85 of credit, ~$0.59/month of use),
but this session underlined all three of its limits at once: it is slow
(~6 s a call, chained), it is opaque (redesigned console, stale docs, no
balance API), and its terms answer never came. That combination — not any
single failure — is the case for the stretch goal above: stream, and
eventually own the model and the voice.
