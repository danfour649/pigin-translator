#!/usr/bin/env python3
"""Stage 4/5 bridge — quick chrF check on the held-out pilot set.

Generates translations from a checkpoint (or the base model) for
held-out Yoruba sources and scores them with corpus chrF against the
GPT-6 Astra held-out record for the same source (the locked teacher
as reference). It also scores the held-out GPT-5.5 records the same
way, which puts the Stage 5 baseline ("matches or beats GPT-5.5") on
the same scale in the same run.

This is a smoke-level instrument, not the Stage 5 evaluation: that
one adds BLEU, the full 1,000-line set, and Folasade's spot grades.

Usage:
  python3 corpus/stage4_eval.py --model google/madlad400-7b-mt --limit 50
  python3 corpus/stage4_eval.py --model corpus/data/stage4/checkpoint --limit 200

Requires: torch, transformers, sentencepiece, sacrebleu.
"""

import argparse
import json
import os
import sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--limit", type=int, default=50)
    ap.add_argument("--heldout", default=os.path.join(
        ROOT, "corpus/data/stage3/heldout.jsonl"))
    ap.add_argument("--config", default=os.path.join(HERE, "stage4_config.json"))
    args = ap.parse_args()

    try:
        import sacrebleu
    except ImportError:
        print("sacrebleu is required: pip install sacrebleu", file=sys.stderr)
        return 1
    import torch
    from transformers import AutoModelForSeq2SeqLM, AutoTokenizer

    cfg = json.load(open(args.config, encoding="utf-8"))
    tag = cfg["data"]["lang_tokens"]["yoruba"]

    by_id = defaultdict(dict)  # id -> {teacher: (en, translation)}
    for line in open(args.heldout, encoding="utf-8"):
        r = json.loads(line)
        if r["target_lang"] == "yoruba":
            by_id[r["id"]][r["teacher"]] = (r["en"], r["translation"])
    rows = [(i, d) for i, d in by_id.items()
            if "gpt-6-astra" in d and "gpt-5.5" in d][: args.limit]
    if not rows:
        print("no held-out Yoruba ids with both Astra and GPT-5.5 records",
              file=sys.stderr)
        return 1
    print(f"scoring on {len(rows)} held-out Yoruba sources")

    tok = AutoTokenizer.from_pretrained(args.model)
    model = AutoModelForSeq2SeqLM.from_pretrained(
        args.model, torch_dtype=torch.bfloat16).cuda().eval()

    refs, hyp_model, hyp_55 = [], [], []
    for _id, d in rows:
        en, ref = d["gpt-6-astra"]
        refs.append(ref)
        hyp_55.append(d["gpt-5.5"][1])
        enc = tok(f"{tag} {en}", return_tensors="pt").to("cuda")
        with torch.no_grad():
            out = model.generate(**enc, max_new_tokens=128, num_beams=4)
        hyp_model.append(tok.decode(out[0], skip_special_tokens=True))

    for name, hyps in ((f"model:{args.model}", hyp_model),
                       ("baseline:gpt-5.5-records", hyp_55)):
        score = sacrebleu.corpus_chrf(hyps, [refs])
        print(f"{name}: chrF = {score.score:.2f}")
    print("reference: gpt-6-astra held-out records. Stage 5 ship "
          "criterion is judged on the full set + Folasade grades, "
          "not this smoke number.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
