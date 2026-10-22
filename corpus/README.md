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
