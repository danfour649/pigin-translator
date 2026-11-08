# Stage 4 — Training Runbook (RunPod, MADLAD-400 7B full fine-tune)

Status: **prepped 2026-11-08, not yet run.** Stage 3 is complete
(`STAGE3.md`); this runbook, `stage4_config.json`, `stage4_train.py` and
`stage4_eval.py` are the whole preparation. What is *not* in this
document is authorization: the run starts on Daniel's go, which also
confirms the one open config value (`teacher_mode`, default `both`).

## Shape of the run

- **Base model:** `google/madlad400-7b-mt` (T5, 7.2B, Apache 2.0 —
  commercial-clean, per the 2026-11-08 commercial-first ruling).
- **Data:** Stage 3 outputs — train 305,981 / dev 6,236, both teachers
  unless `teacher_mode` says otherwise. Held-out (4,000) is never in
  the training files by construction; do not merge it in "for volume".
- **Method:** full fine-tune, bf16, gradient checkpointing, 8-bit AdamW
  (plain AdamW's optimizer state does not fit an 80 GB card alongside a
  7B T5; Adafactor is the scripted fallback). Effective batch 64,
  lr 1e-4 cosine, 2 epochs ≈ 9,600 steps.
- **Phases after the base fine-tune** (same pod session if time allows,
  separate sessions if not): the *preference pass* toward Folasade's
  accepted versions, then *corpus reranking* (multi-candidate +
  back-translation agreement). Both need the base checkpoint first;
  neither is scripted yet — they get their own prep once the base
  model's Stage 5 smoke numbers exist.

## Budget and time — estimates, honestly labelled

- H100 80 GB pods have recently listed around **$2–3.5/hr** on RunPod;
  **check the live price when booking** — this figure is a guide, not a
  quote.
- Throughput guess for T5-7B full FT at seq 256 on one H100: ~2–4 s/step
  → **the keeper run is roughly 6–11 hours → roughly $15–40 of compute.**
  The plan's ~$100–200 envelope therefore has generous headroom for the
  smoke runs, a restart, and the preference pass. The config's
  `cap_usd: 200` is a **hard stop**: if spend approaches it, kill the
  pod and reassess — do not top up mid-run on momentum.
- Set a RunPod billing alert *before* the pod starts, and attach the
  network volume (below) so a dead pod never takes the data with it.

## Pre-flight checklist

- [ ] Daniel's go received; `teacher_mode` confirmed in `stage4_config.json`
- [ ] RunPod account funded; billing alert set
- [ ] The open check from `corpus/README.md` noted: Azure OpenAI terms
      on training downstream models from GPT outputs — the corpus's
      Astra half derives from GPT outputs. This was already flagged
      in the plan as a verify-before-commercial-use item; the run
      itself is research, the checkpoint's commercial use is what the
      check gates. Do not lose this thread.
- [ ] Stage 3 manifest (`corpus/stage3-manifest-2026-11-08.json`) matches
      the data on the pod after assembly (record counts equal)

## Pod setup

1. Create a **network volume, 100 GB**, in the same datacenter as the
   pod (data + checkpoints live there, not on the pod's ephemeral disk).
2. Start an **H100 80 GB** pod (SXM preferred), PyTorch template image,
   volume mounted at `/workspace`.
3. On the pod:
   ```bash
   cd /workspace && git clone <pigin-translator repo> && cd pigin-translator
   pip install transformers datasets accelerate sentencepiece sacrebleu bitsandbytes
   ```
   (Repo is private: clone over HTTPS with a GitHub token, or `gh auth login`.)
4. Get the corpus onto the volume, either way:
   - **Preferred:** copy the three Drive tranche folders
     (`pigin-corpus-pilot-2026-10-22`, `pigin-corpus-bulk-2026-10-23`,
     `pigin-corpus-tranche2-2026-10-23`) into `corpus/data/pilot|bulk|tranche2/`
     (rclone with a Drive remote works), then run
     `python3 corpus/stage3_assemble.py` and check the manifest counts.
   - Or copy a locally assembled `corpus/data/stage3/` up directly
     (~126 MB) — simpler, and byte-identical if the manifest matches.

## Execute

```bash
# 1. SMOKE — always first, ~minutes. Fails cheap or not at all.
python3 corpus/stage4_train.py --smoke
python3 corpus/stage4_eval.py --model google/madlad400-7b-mt --limit 50   # base-model reference numbers
python3 corpus/stage4_eval.py --model corpus/data/stage4/checkpoint-smoke --limit 50 || true
```
The smoke gate inside the training script asserts `<2yo>` and `<2pcm>`
each tokenize as **one** special token. Yoruba `<2yo>` is certain;
`<2pcm>` for Naija is the one unverified assumption in this prep — if
the assertion fires, stop and resolve the Naija tag before any real
training. A smoke checkpoint's chrF is meaningless (30 steps); what
matters is that generation runs, is in the right language, and the
pipeline saves/loads.

```bash
# 2. KEEPER RUN — in tmux, logged. ~6-11 h estimated.
tmux new -s stage4
python3 corpus/stage4_train.py 2>&1 | tee stage4-train.log
```
Watch the first ~100 steps: loss should be finite and falling from the
first logging points. NaN or a flat loss = stop early, that's what the
smoke budget is for.

```bash
# 3. FIRST NUMBERS — same pod, before terminating it.
python3 corpus/stage4_eval.py --model corpus/data/stage4/checkpoint --limit 200
```
This prints chrF for the fine-tune and for the GPT-5.5 baseline records
on the same held-out sources and reference — the first read on the
Stage 5 ship criterion (full judgement is Stage 5 proper: full set,
BLEU too, Folasade spot grades).

## After the run

- Download the checkpoint **off the pod**; sha256 it; back it up to
  Drive; only then terminate the pod (keep the network volume).
- Fill in the run log below: dates, pod price actually paid, total
  spend, final loss, eval numbers, checkpoint hash and locations.
- Hand to Stage 5: checkpoint + this log + the held-out set.

## Fallback (if the RunPod run disappoints, or as a free rehearsal)

Distilled/LoRA route on the home RTX 4060 (fola4-1, when it frees up):
base `google/madlad400-3b-mt`, LoRA (peft, r=16) or a light full FT in
8-bit, same Stage 3 files, hour-scale. Not scripted here — the config's
`fallback_model` field marks the intent; write the variant when it's
actually scheduled, not before.

## Run log

_(empty — first run fills this in: go/no-go record, teacher_mode used,
pod + price, wall-clock, spend vs cap, final loss, smoke & keeper eval
chrF (base / fine-tuned / GPT-5.5 baseline), checkpoint sha256 +
locations, anomalies.)_
