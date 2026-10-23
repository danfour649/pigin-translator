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
