# Stage 3 — Data Assembly (status: synthetic assembly DONE 2026-11-08; MENYO merge gated)

Stage 3 per `corpus/README.md`: merge the synthetic pairs with licensed
human gold, keep per-record source/licence/register fields, and lock the
graded sample away as the held-out test set. This document records what
was actually assembled, what was found on the way, and the one decision
still open.

## The assembler

`corpus/stage3_assemble.py` — run it with the tranche files in place
under `corpus/data/<tranche>/` (gitignored; canonical copies live in the
cloud archives below). It normalizes the raw dual-teacher JSONL into the
Stage 3 schema (`id, en, target_lang, translation, teacher, model,
source_text, register, licence, tranche, split`), dedupes on
(id, teacher, target_lang), forces the whole pilot lineage to held-out,
additionally holds out any record whose English matches the Yoruba
grading packet, assigns a deterministic ~2% dev split, and writes
`train.jsonl` / `dev.jsonl` / `heldout.jsonl` + `MANIFEST.json` under
`corpus/data/stage3/`. Both teachers are kept as separate records;
choosing or mixing teachers is a Stage 4 training-config decision.

## Inputs, located and verified (2026-11-08)

All inputs were pulled from Google Drive (the archives named in
`corpus/README.md`):

| Tranche | Drive folder | Files | Records |
| --- | --- | --- | --- |
| pilot | `pigin-corpus-pilot-2026-10-22` | 4 of its files used (see below) | 4,000 |
| bulk | `pigin-corpus-bulk-2026-10-23` | 8 (astra/claude × yoruba/naija × general/packs) | 201,426 |
| tranche2 | `pigin-corpus-tranche2-2026-10-23` | 4 (astra/claude × naija × general2/packs2) | 110,782 |

Pilot files used: `pilot_yoruba.jsonl` and `pilot_naija.jsonl`
(GPT-5.5), `pilot_yoruba_astra.jsonl` (GPT-6 Astra),
`pilot_yoruba_muse1000.jsonl` (Muse) — the attributed versions behind
the grading packet's blinded A/B lines.

## Findings that change the ledger

1. **The corpus is bigger than the README says.** `tranche2` is an
   entire second run the README never recorded: 55,391 *new* Naija
   sources (another ~40k Tatoeba plus 15,400 `pack2-*` lines in new
   pack types, e.g. banking), translated by both teachers — **110,782
   records, zero overlap with bulk.** True corpus size is **312,208
   bulk+tranche2 records** (316,208 including the pilot lineage), not
   201,426. Naija is now the larger target: ~105,750 sources vs
   Yoruba's ~50,360.
2. **The graded sample was already disjoint from training data.**
   Verified by id and by exact/normalized English match: **none** of
   the pilot's 1,000 Tatoeba sources, including all 100 graded lines,
   appear in bulk or tranche2 — the bulk general run sampled a
   different Tatoeba subset. The packet-match rule in the assembler is
   therefore a safety net, not the mechanism; the mechanism is
   construction. Post-assembly checks: 0 graded lines leak into
   train/dev; all 100 are present in held-out with attributed
   GPT-5.5 / Astra / Muse Yoruba records.
3. The repo's `corpus/pilot_yoruba.jsonl` placeholder is 0 bytes; the
   real pilot outputs live only in the Drive pilot folder (and the
   fola4-1 mirror noted in the README).

## Assembled output (2026-11-08 run)

Manifest committed as `corpus/stage3-manifest-2026-11-08.json`:

- **train: 305,981** — Yoruba 98,732 (49,369 Claude / 49,363 Astra);
  Naija 207,249 (103,636 Claude / 103,613 Astra)
- **dev: 6,236**
- **heldout: 4,000** — the complete pilot lineage (1,000 sources ×
  GPT-5.5 × both targets, plus Astra and Muse Yoruba), reserved for
  Stage 5 evaluation, never trained on
- 0 bad JSON, 0 incomplete, 0 duplicates dropped on this run

Outputs are ~126 MB under `corpus/data/stage3/` on the machine that ran
the assembly; they are reproducible from the archives + this script.
When fola4-1 frees up, its `~/pigin-corpus-archive/` mirror is the
natural durable home for a copy.

## Still open

1. **MENYO-20k merge — gated on Daniel's licence call.** The plan says
   to check first whether the public pigin site can use a CC BY-NC
   resource, because the call decides whether MENYO records need
   NC-tagging and exclusion from any commercial-clean subset (the
   assembler already tags every record's licence, so MENYO records
   would carry `CC BY-NC 4.0` and stay filterable). MENYO train split
   only; its test split and FLORES dev/test are never training data.
   Nothing about the synthetic assembly above waits on this.
2. **Teacher choice/mixing for Stage 4** (Astra-only, Claude-only, or
   both as multi-reference) — a training-config decision, deliberately
   not baked into the data.
3. **README totals** in `corpus/README.md` predate tranche2; updating
   them is a small follow-up edit.
