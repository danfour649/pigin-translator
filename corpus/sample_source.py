#!/usr/bin/env python3
"""Sample everyday English sentences from the Tatoeba export (CC BY 2.0 FR).

Reads corpus/data/eng_sentences.tsv.bz2, keeps short everyday sentences,
dedupes, and writes a fixed-seed sample as JSONL: {"id": "tatoeba-<id>", "en": "..."}
Attribution: sentences are from Tatoeba (https://tatoeba.org), CC BY 2.0 FR;
the original sentence IDs are preserved in each record.
"""
import bz2, json, random, re, sys

N = int(sys.argv[1]) if len(sys.argv) > 1 else 1000
random.seed(20261022)
rows = []
with bz2.open("corpus/data/eng_sentences.tsv.bz2", "rt", encoding="utf-8") as f:
    for line in f:
        parts = line.rstrip("\n").split("\t")
        if len(parts) < 3:
            continue
        sid, lang, text = parts[0], parts[1], parts[2]
        if lang != "eng":
            continue
        words = text.split()
        if not (5 <= len(words) <= 18):
            continue
        if not text[0].isupper():
            continue
        if text[-1] not in ".?!":
            continue
        if re.search(r"http|www\.|@|\d{3,}|[^\x00-\x7F]", text):
            continue
        rows.append((sid, text))
random.shuffle(rows)
seen, picked = set(), []
for sid, text in rows:
    key = text.lower()
    if key in seen:
        continue
    seen.add(key)
    picked.append({"id": f"tatoeba-{sid}", "en": text})
    if len(picked) == N:
        break
with open("corpus/pilot_source_1000.jsonl", "w", encoding="utf-8") as out:
    for p in picked:
        out.write(json.dumps(p, ensure_ascii=False) + "\n")
print("picked", len(picked))
