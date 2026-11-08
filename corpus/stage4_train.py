#!/usr/bin/env python3
"""Stage 4 — fine-tune MADLAD-400 on the Stage 3 assembled corpus.

Reads corpus/stage4_config.json, formats each Stage 3 record as
    input:  "<2xx> <english sentence>"
    label:  "<translation>"
(MADLAD-400's <2xx> target-language prefix convention), and runs a
Hugging Face Trainer full fine-tune of the base model.

Modes:
  python3 corpus/stage4_train.py --smoke    # 30 steps on a small subset
  python3 corpus/stage4_train.py            # the keeper run

The smoke run exists to fail cheaply: it checks the language prefixes
(<2yo> is native to MADLAD; <2pcm> is NOT — verified 2026-11-08 — and
is added as a new trainable token, see the gate in main()), trains
briefly, and saves to a throwaway dir. Do not skip it on a fresh pod
(see the runbook).

Requires: torch, transformers, datasets, accelerate, sentencepiece,
and bitsandbytes for the default 8-bit optimizer (falls back to
Adafactor if bnb is unavailable — on an 80GB card either fits a 7B
full FT with gradient checkpointing; plain AdamW does not).
"""

import argparse
import json
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)


def load_jsonl(path):
    with open(path, encoding="utf-8") as fh:
        return [json.loads(line) for line in fh if line.strip()]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default=os.path.join(HERE, "stage4_config.json"))
    ap.add_argument("--smoke", action="store_true")
    ap.add_argument("--output-dir", default=None)
    args = ap.parse_args()

    cfg = json.load(open(args.config, encoding="utf-8"))
    tcfg = cfg["training"]
    mode = cfg["data"].get("teacher_mode", "both")

    import torch
    from datasets import Dataset
    from transformers import (
        AutoModelForSeq2SeqLM,
        AutoTokenizer,
        DataCollatorForSeq2Seq,
        Trainer,
        TrainingArguments,
    )

    random.seed(tcfg.get("seed", 42))

    train_path = os.path.join(ROOT, cfg["data"]["train_file"])
    dev_path = os.path.join(ROOT, cfg["data"]["dev_file"])
    train = load_jsonl(train_path)
    dev = load_jsonl(dev_path)
    if mode != "both":
        keep = {"astra": "gpt-6-astra", "claude": "claude"}[mode]
        train = [r for r in train if r["teacher"] == keep]
        dev = [r for r in dev if r["teacher"] == keep]
    print(f"teacher_mode={mode}: train={len(train)} dev={len(dev)}")

    if args.smoke:
        train = train[: cfg["smoke"]["max_examples"]]
        dev = dev[:200]

    base = cfg["base_model"]
    tok = AutoTokenizer.from_pretrained(base)

    # --- language-tag gate (facts verified 2026-11-08, see runbook) ---
    # <2yo> is a native MADLAD tag. <2pcm> does NOT exist in MADLAD-400
    # (493 <2xx> tags, none for Nigerian Pidgin; <2pis> is Tok Pisin, a
    # different language — never substitute it). Strategy per config:
    # add <2pcm> as a new special token and resize the embeddings; the
    # full fine-tune trains it on ~105k Naija examples.
    added_tags = []
    for lang, tag in cfg["data"]["lang_tokens"].items():
        ids = tok(tag, add_special_tokens=False)["input_ids"]
        if len(ids) == 1:
            print(f"tag OK (native): {lang} {tag}")
        elif cfg["data"].get("naija_tag_strategy") == "add_token" and lang == "naija":
            tok.add_tokens([tag], special_tokens=True)
            added_tags.append(tag)
            print(f"tag ADDED (not native to MADLAD): {lang} {tag} — "
                  "embeddings will be resized and the tag trained from scratch")
        else:
            print(f"FATAL: {tag} for {lang} tokenizes to {ids}, not one token, "
                  "and no strategy covers it. Stop.", file=sys.stderr)
            return 1

    lang_token = cfg["data"]["lang_tokens"]

    def to_features(rec):
        src = f"{lang_token[rec['target_lang']]} {rec['en']}"
        enc = tok(src, max_length=tcfg["max_source_length"], truncation=True)
        lab = tok(rec["translation"], max_length=tcfg["max_target_length"],
                  truncation=True)
        enc["labels"] = lab["input_ids"]
        return enc

    train_ds = Dataset.from_list([to_features(r) for r in train])
    dev_ds = Dataset.from_list([to_features(r) for r in dev])

    model = AutoModelForSeq2SeqLM.from_pretrained(
        base, torch_dtype=torch.bfloat16)
    model.config.use_cache = False
    if added_tags:
        model.resize_token_embeddings(len(tok))
        print(f"resized token embeddings to {len(tok)} for {added_tags}")

    optim = tcfg.get("optim", "adamw_bnb_8bit")
    try:
        import bitsandbytes  # noqa: F401
    except ImportError:
        optim = tcfg.get("optim_fallback", "adafactor")
        print(f"bitsandbytes unavailable; optimizer -> {optim}")

    out_dir = args.output_dir or os.path.join(
        ROOT, cfg["output"]["dir"] + ("-smoke" if args.smoke else ""))
    targs = TrainingArguments(
        output_dir=out_dir,
        num_train_epochs=tcfg["epochs"],
        max_steps=cfg["smoke"]["max_steps"] if args.smoke else -1,
        per_device_train_batch_size=tcfg["per_device_train_batch_size"],
        gradient_accumulation_steps=tcfg["gradient_accumulation_steps"],
        learning_rate=tcfg["learning_rate"],
        lr_scheduler_type=tcfg["lr_scheduler_type"],
        warmup_ratio=tcfg["warmup_ratio"],
        bf16=tcfg["bf16"],
        gradient_checkpointing=tcfg["gradient_checkpointing"],
        optim=optim,
        logging_steps=tcfg["logging_steps"],
        save_strategy="no" if args.smoke else tcfg["save_strategy"],
        eval_strategy="no",
        seed=tcfg["seed"],
        report_to=[],
    )
    trainer = Trainer(
        model=model,
        args=targs,
        train_dataset=train_ds,
        eval_dataset=dev_ds,
        data_collator=DataCollatorForSeq2Seq(tok, model=model),
    )
    trainer.train()
    if not args.smoke:
        trainer.save_model(out_dir)
        tok.save_pretrained(out_dir)
    print(f"done. output: {out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
