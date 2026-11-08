#!/usr/bin/env python3
"""Stage 3 — data assembly for the pigin corpus (see corpus/STAGE3.md).

Reads the raw dual-teacher JSONL tranches under corpus/data/<tranche>/,
normalizes every record into the Stage 3 schema, and writes train / dev /
held-out splits under corpus/data/stage3/ plus a MANIFEST.json.

Schema per output record:
  id           source sentence id (tatoeba-* / pack-* / pack2-*)
  en           English source sentence
  target_lang  "yoruba" | "naija"
  translation  teacher translation for that target
  teacher      "gpt-6-astra" | "claude"   (from the input filename)
  model        exact model string from the raw record
  source_text  "tatoeba" | "generated"
  register     "general" | pack type (functional, questions, canadian,
               modern, dialogue, banking, ...)
  licence      licence tag for the source text (translations are original
               to this project); NC-tagged sources can be filtered out of
               a commercial-clean subset at training time
  tranche      input directory name (bulk, tranche2, ...)
  split        "train" | "dev" | "heldout"

Rules:
  * Dedupe on (id, teacher, target_lang); first occurrence wins.
  * Held-out: every record from the pilot tranche is evaluation material
    and never trains; additionally, any record in any tranche whose
    English matches a line in the Yoruba grading packet
    (corpus/grading_packet_yoruba_100.md) is held out — the graded
    sample is the Stage 5 test set. (Verified 2026-11-08: the pilot
    sources are disjoint from the bulk/tranche2 sources, so the packet
    match currently fires only as a safety net.)
  * Dev: deterministic md5 bucket, ~2% of the remaining records.
  * Records with an empty translation or unparseable JSON are dropped
    and counted in the manifest.

MENYO-20k is NOT merged here yet: it is gated on the licence decision
recorded in STAGE3.md. If a MENYO file is later dropped into
corpus/data/menyo/ with the same raw schema, rerunning this script
picks it up like any other tranche.

Usage: python3 corpus/stage3_assemble.py
"""

import glob
import hashlib
import json
import os
import re
import sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
OUT = os.path.join(DATA, "stage3")
PACKET = os.path.join(HERE, "grading_packet_yoruba_100.md")

LICENCES = {
    "tatoeba": "CC BY 2.0 FR (Tatoeba source sentences); translation original to this project",
    "generated": "Project-owned (generated source sentences); translation original to this project",
}


def register_of(rid: str) -> str:
    if rid.startswith("tatoeba-"):
        return "general"
    m = re.match(r"pack2?-([a-z]+)-\d+$", rid)
    return m.group(1) if m else "unknown"


def teacher_of(path: str, rec: dict) -> str:
    name = os.path.basename(path)
    model = (rec.get("model") or "").lower()
    if name.startswith("astra_") or "astra" in name or "astra" in model:
        return "gpt-6-astra"
    if name.startswith("claude_") or "claude" in name or "muse" in name or "claude" in model:
        return "claude"
    if model.startswith("gpt-5.5"):
        return "gpt-5.5"
    return model or "unknown"


def heldout_english() -> set:
    lines = set()
    if not os.path.exists(PACKET):
        return lines
    for line in open(PACKET, encoding="utf-8"):
        m = re.match(r"## \d+\.\s+(.*\S)\s*$", line)
        if m:
            lines.add(m.group(1).strip())
    return lines


def main() -> int:
    inputs = sorted(glob.glob(os.path.join(DATA, "*", "*.jsonl")))
    inputs = [p for p in inputs if os.path.basename(os.path.dirname(p)) != "stage3"]
    if not inputs:
        print("no input tranches under corpus/data/*/ — see STAGE3.md", file=sys.stderr)
        return 1

    held = heldout_english()
    seen = set()
    counts = Counter()
    per = Counter()  # (split, target_lang, teacher) -> n
    writers = {}
    os.makedirs(OUT, exist_ok=True)
    for split in ("train", "dev", "heldout"):
        writers[split] = open(os.path.join(OUT, split + ".jsonl"), "w", encoding="utf-8")

    for path in inputs:
        tranche = os.path.basename(os.path.dirname(path))
        for raw in open(path, encoding="utf-8"):
            raw = raw.strip()
            if not raw:
                continue
            counts["read"] += 1
            try:
                rec = json.loads(raw)
            except json.JSONDecodeError:
                counts["dropped_bad_json"] += 1
                continue
            teacher = teacher_of(path, rec)
            rid, lang = rec.get("id", ""), rec.get("target_lang", "")
            text = (rec.get("translation") or "").strip()
            if not rid or not lang or not text:
                counts["dropped_incomplete"] += 1
                continue
            key = (rid, teacher, lang)
            if key in seen:
                counts["dropped_duplicate"] += 1
                continue
            seen.add(key)
            en = rec.get("en", "")
            if tranche == "pilot" or en.strip() in held:
                # The whole pilot lineage is evaluation material, never
                # training data; the grading-packet match additionally
                # protects any graded source that ever enters a tranche.
                split = "heldout"
                counts["heldout_records"] += 1
            else:
                bucket = int(hashlib.md5(f"{rid}|{lang}|{teacher}".encode()).hexdigest(), 16) % 100
                split = "dev" if bucket < 2 else "train"
            source_text = "tatoeba" if rid.startswith("tatoeba-") else "generated"
            out = {
                "id": rid,
                "en": en,
                "target_lang": lang,
                "translation": text,
                "teacher": teacher,
                "model": rec.get("model", ""),
                "source_text": source_text,
                "register": register_of(rid),
                "licence": LICENCES[source_text],
                "tranche": tranche,
                "split": split,
            }
            writers[split].write(json.dumps(out, ensure_ascii=False) + "\n")
            per[(split, lang, teacher)] += 1
            counts[f"kept_{split}"] += 1

    for fh in writers.values():
        fh.close()

    manifest = {
        "stage": 3,
        "inputs": [os.path.relpath(p, HERE) for p in inputs],
        "heldout_english_lines_in_packet": len(held),
        "counts": dict(counts),
        "per_split_lang_teacher": {f"{s}|{l}|{t}": n for (s, l, t), n in sorted(per.items())},
        "outputs": ["train.jsonl", "dev.jsonl", "heldout.jsonl"],
        "notes": [
            "Both teachers are kept as separate records; choosing or mixing teachers is a Stage 4 training-config decision.",
            "MENYO-20k not merged: gated on the licence decision in STAGE3.md.",
            "Held-out is the pilot lineage (forced), plus a grading-packet English match as a safety net for other tranches.",
        ],
    }
    with open(os.path.join(OUT, "MANIFEST.json"), "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=2, ensure_ascii=False)
    print(json.dumps(manifest, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
