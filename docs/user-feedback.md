# User feedback log

Real requests from real users of the live site, recorded as they arrive.
The first external user feedback the project has received.

## 2026-11-08 — Lillian Olule (liolule@gmail.com)

Replying to Daniels share of https://pigin-translator.vercel.app
(Gmail thread 1a1bc10dbf16b476, her reply 16:43 AST):

> "I dont know if you are considering adding the feature to slow
> the speech down such that users can slowly hear how to pronounce
> appropriately? Otherwise the apps really cool!"

**Request: a slow-speech option** so learners can hear pronunciation
at reduced speed.

Feasibility note (2026-11-09): cheap on the current stack. Client-
side playbackRate on the audio element (1x / 0.75x / 0.5x toggle,
preservesPitch on) needs no Spitch parameter and no Lambda change —
it slows the already-generated audio. A native TTS speed, if Spitch
exposes one, would sound better but is not required for v1 of the
feature. Ties directly to the apps learning use case and to the
own-voice strand: slow, clear articulation is also the obvious
training-data register for learner-facing speech.

**SHIPPED 2026-11-09** (commit 8b124c7, Vercel production verified
live the same morning): a "Speech speed" segmented control
(1× / 0.75× / 0.5×) beside the translation model picker. Cloud
playback applies the rate with pitch preserved (re-applied on the
playing event; adjustable mid-playback); the browser-voice fallback
multiplies its base rate by the same speed. Applies to Speak and
Replay. Lillian has not yet been told — a reply is Daniels to send.
