# Corpus project: English -> Yoruba and English -> Nigerian Pidgin

Goal: bank a durable, openly licensed parallel corpus for future translation
work, generated with the Azure trial credit on the `aoclean-foundry-ce`
Foundry resource (subscription under aoclean@aoclean.ca) **before that credit
expires on 2026-11-02**. Credit that is not spent by then is gone; a corpus
on disk is an asset that stays.

## Why synthetic

Open English-Yoruba bitext is mostly news, talks, and religion, and the best
historical Yoruba translations are copyrighted Bible editions (see
`docs/yoruba-translation-plan.md` for the license analysis: MENYO-20k is
CC BY-NC, JW300 is off-limits, the Bible Society of Nigeria editions must not
be scraped). What is missing is everyday, modern-register pairs. This project
generates them with the Foundry GPT deployment from openly licensed English
source sentences, then validates a sample with a native speaker.

## Licensing of inputs and outputs

- Source sentences: Tatoeba (https://tatoeba.org), CC BY 2.0 FR. Sentence
  IDs are preserved in every record for attribution and traceability.
- Translations are machine-generated from those sentences by our own prompts.
  The corpus files carry the Tatoeba attribution; the generated side is our
  work product in this MIT-licensed repository.

## Pilot (2026-10-22)

- 1,000 source sentences sampled by `corpus/sample_source.py` (5-18 words,
  everyday filter, fixed seed) into `corpus/pilot_source_1000.jsonl`.
- `corpus/pilot_translate.py` translates them into Yoruba and Nigerian
  Pidgin in numbered batches of 20, metering token usage per batch so the
  true per-pair cost on this deployment is measured, not estimated.
- Raw pilot output is archived to Google Drive, Box, and Dropbox (the three
  connected storage services) as well as kept here.

## Quality gate

Token cost is not the constraint; quality is. Before any bulk run:

1. A native Yoruba speaker (Folasade) grades a random sample of the Yoruba
   output: acceptable / wrong tone marks or diacritics / wrong meaning.
2. The Pidgin output is checked for naturalness against broadcaster usage.
3. Bulk scale-up only proceeds on the measured defect rates, and a held-out
   graded set is kept for scoring future models. Do not train on MENYO's
   test split or on FLORES.

## What the credit should NOT be spent on

- Hosted fine-tuned deployments in Azure (hourly hosting burns credit while
  idle). Training belongs on the home GPU host later, against this corpus.
- Runtime translation traffic for the website (that is the app's normal
  operating cost, not corpus building).

## Design notes: one corpus, layered registers (2026-10-22)

Direction (Daniel): the corpus should be able to serve the romantic and
sexy registers well, but in the long run stay generic. Resolution: one base
corpus with tagged register layers on top — not one blended dataset, and
not two unrelated projects.

### Layering

- The **generic base** (everyday sentences, the pilot's register) is the
  foundation and the bulk of any credit spend. It is also the openly
  publishable asset: it ships under this repo's MIT license without a
  second thought.
- **Adult layers** (playful, suggestive; explicit deferred) live in
  separate files with their own register tags, so the adult dataset can
  have its own license, reviewer arrangement, and distribution decision
  without contaminating the shareable base.
- Register tags on every record regardless of layer, so any mix can be
  filtered or trained on separately later.

### Adult tiers are dialogues, not sentences

Flirting and sexy talk live in exchanges — escalation, teasing callbacks,
checking in, reading the temperature — not in isolated lines. Sentence
pairs would teach suggestive vocabulary deployed like a phrasebook:
grammatically fine, socially dead, sometimes creepy. So adult-tier units
are short dialogues (roughly 4–10 turns) with pair structure inside the
conversation, and every adult-tier record carries scenario metadata:

- relationship stage (first conversation, dating, established, married)
- setting and medium (in person, texting, voice notes)
- register (playful, suggestive, explicit)

Appropriateness is context-dependent — a line that is charming in one
scenario is a red flag in another — and the corpus has to keep that signal.

### Generator bias and the explicit tier

Azure's filters (this resource: DefaultV2) block explicit sexual content
at medium severity and above, and the generator model self-sanitizes even
below the hard blocks: it writes about desire in euphemism rather than
writing desire. Consequences:

- The playful/suggestive tiers can be generated on Azure, expecting the
  output to skew tame and some calls to be filtered.
- An explicit tier, if built at all, is end-to-end local: generation and
  translation on our own GPU host with a model that is not flinching,
  because filtering would hit both stages on Azure. That tier also needs
  the most human review, since an unfiltered model produces fluent lines
  that are wrong in ways only a native speaker catches.
- Applying to Microsoft to loosen filters will not land before the
  2026-11-02 credit expiry; do not plan around it.

### Density over volume

Sexy-talk competence is dense: a few thousand well-built dialogues teach
more than tens of thousands of loose suggestive sentences. The adult
layers therefore need only a modest slice of the generation budget; the
generic base keeps the bulk of it (see the sizing rule in the post-pilot
plan: size the bulk run from the pilot's measured token counts).

### Grading differs by tier

- Generic: a native speaker grades correctness (the pilot gate).
- Adult tiers: correctness is half the grade; the rest is whether a real
  person would say this, to this person, at this scenario's stage.
  Reviewer consent is tier-specific: agreeing to grade everyday sentences
  does not imply agreeing to grade flirty or sexual material, and each
  tier goes only to a reviewer who has agreed to that material.

### Guardrails carried into generation prompts

- Adults only, everywhere: no age or school references in any scenario.
- Consent-positive escalation is a data-quality feature, not just a rule:
  good sexy talk models enthusiasm, checking in, and graceful backing
  off. No pressure, no persistence past a refusal.
- Before training the adult layers on any hosted service, check its terms
  allow adult romantic content; many do not. Local training has no such
  constraint.

## The endgame: knocking this translator out of the park

Folasade's early verdict on pilot samples (2026-10-22): the GPT-5.5 Yoruba
is "generally excellent". The goal is therefore not a bigger generator —
it is a translator we own that matches or beats GPT-5.5 on the everyday
register (and serves registers Azure refuses), at zero marginal cost per
translation. The plan runs in stages; each stage gates the next.

### Stage 0 — Pilot (running)
1,000 Tatoeba sentences per language on the Foundry gpt-5-5 deployment,
metered. Output: measured per-pair token cost and a gradable sample.
Everything after this is sized from those numbers, not estimates.

### Stage 1 — Human quality gate (target Oct 26–27)
- Folasade grades ~100 Yoruba pairs: correctness, tone marks, naturalness.
  Her defect rate is the go/no-go for the bulk spend.
- Capture her fixes as structured accepted/rejected pairs, not just a
  score — that correction data is the most valuable training signal in
  the whole project (used in Stage 4's preference pass).
- Sanity-check the Naija output the same way (speaker TBD).
- Error taxonomy to track explicitly (from docs/yoruba-translation-plan.md):
  kinship terms, dropped/wrong tone marks, statement flipped to question,
  register slips.

### Stage 2 — Bulk generation on the expiring credit (Oct 27–30)
- Spend $180–190 of the trial credit by Oct 31 (it expires Nov 2 and
  Azure's cost reporting lags 8–24h, so the last day is not usable).
- Everyday corpus at Tatoeba scale for both languages; Batch API (half
  price, separate deployment) for the bulk of it.
- **Source packs** (named generation jobs; sizes indicative, finalized
  from the pilot's measured per-pair cost). Tatoeba skews generic and
  declarative; these packs target what it misses. Generated English
  sources are owned outright; seeds below are the topic lists:
  - `pack-functional` (~4K lines): health & pharmacy; money & banking;
    school & kids; work & shifts; home & repairs; transit & driving;
    appointments & services; emergencies.
  - `pack-questions` (~2K lines): wh- and yes/no questions, polite
    requests phrased as questions, follow-ups — aimed directly at the
    statement-flipped-to-question error class.
  - `pack-canadian` (~2K lines): winter life (snow clearing, wind
    chill, block heaters, black ice); settlement & services (SIN,
    health card, CRA, EI, Service Canada, PR card); hockey & small
    talk; Canadian places and weather talk; Canadian spellings.
    canada.ca is mined for topics and plain-language phrasing only —
    Crown copyright, no wholesale copying of its sentences.
  - `pack-modern` (~1.5K lines): phones, apps, passwords and Wi-Fi;
    texting style and abbreviations; delivery and gig work; video
    calls; social media.
  - `pack-dialogue-everyday` (~1K short exchanges): greetings,
    shopping, neighbours, phone calls — everyday dialogue units,
    bridging to the dialogue format the adult layers use.
  - Source-side pull, not generation: Mozilla Common Voice sentences
    (CC0 — no strings), filtered with the pilot sampler's rules, as
    bulk conversational filler beside Tatoeba.
- Back-translation pass on everything; drift-flagged pairs get reviewed
  or dropped, never silently trained on.
- Three-way alternative translations on a subset — feedstock for the
  Stage 4 reranker and preference training.
- Adult playful/suggestive dialogues per the layered-register design
  notes: separate files, scenario metadata, generated English sources.
  (Design is approved as plan text; generating that tier starts only on
  Daniel's explicit go.)
- Archive raw output to Google Drive, Box, and Dropbox; verify each copy.
  Text shards (~25K pairs/file) also live in this repo — measured
  279 bytes/pair, so even 200K pairs is ~56 MB.

### Stage 3 — Data assembly
- Merge synthetic pairs with licensed human gold: MENYO-20k TRAIN split
  (CC BY-NC 4.0 — training only, never its test split), OPUS/CC-BY
  sources per the existing plan doc. Never FLORES or MENYO test data.
- Every record carries source, license, and register fields, so a
  commercial-clean subset (no NC-tainted records) can be filtered at any
  time.
- The graded sample from Stage 1 becomes the held-out test set. It is
  never trained on.

### Stage 4 — RunPod training session (Daniel funds it; ~$100–200)
One deliberate session on an H100-class pod, after Stages 1–3 land:
- **Keeper model:** full fine-tune of MADLAD-400 7B (Apache 2.0) on the
  assembled corpus. Full FT, not the LoRA the home 4060 would be limited
  to. NLLB-200 (CC BY-NC weights) is the evaluation yardstick only —
  nothing shipped derives from it.
- **Preference pass:** train toward Folasade's accepted versions and
  away from her rejected ones.
- **Corpus reranking:** multi-candidate generation + back-translation
  agreement scoring; keep the best candidate per source line.
- **Unfiltered tier (only if green-lit):** open-model generation and
  translation of the explicit register that Azure's filters block —
  adults-only guardrails from the design notes apply unchanged.
- Fallback if the big run disappoints: distilled MADLAD 3B / LoRA on the
  home RTX 4060 — an hour-scale run, free.

### Stage 5 — Evaluation before anything ships
- Held-out graded test set: chrF/BLEU against the GPT-5.5 baseline AND
  human spot grades; re-run the Stage 1 error taxonomy.
- Ship criterion: matches or beats GPT-5.5 on the everyday register.
  If it doesn't, the corpus still stands as the asset and the model
  iteration repeats — the data is the durable part.

### Stage 6 — Serve and publish
- Quantized checkpoint served from fola4.1 (RTX 4060) as a small API;
  pigin-translator calls our own model instead of renting GPT per
  translation, with GPT as fallback for out-of-scope input.
- Publish the generic corpus (and the permissively licensed model)
  openly from this repo; the adult layers get their own separate
  license and distribution decision.

### Open checks
- Azure OpenAI terms on training downstream models from GPT outputs —
  verify before any commercial use of the synthetic data.
- Per-record license tracking (Stage 3) is what keeps the NC question
  answerable later; do not merge sources without it.

## Findings log

- [2026-10-22 — pilot results + live model spot tests](FINDINGS-2026-10-22.md): measured pilot costs, GPT-6 availability/pricing on the Foundry account, diacritic-consistency results across three spot-test rounds, and the Azure DefaultV2 filter blocking an adult marital message at prompt level while both GPT-6 models translated it via the gateway.
