#!/usr/bin/env python3
"""Corpus generator: English -> Yoruba and English -> Nigerian Pidgin
via an Azure OpenAI (Foundry) chat deployment. Bulk-capable: parallel
workers, shared rate-limit backoff, resilient batch splitting.

Reads a source JSONL ({"id": ..., "en": ...}), sends sentences in numbered
batches, and writes one JSONL record per sentence per language:
{"id", "en", "target_lang", "translation", "model", "usage_prompt_tokens",
 "usage_completion_tokens", "batch"}

Usage:
  pilot_translate.py SOURCE_JSONL OUTPUT_JSONL LANG [--workers N] [--alts K]
  pilot_translate.py TARGET_JSONL --backtranslate [--workers N]

  LANG is "yoruba" or "naija". Output is resumable: ids already present in
  the output file are skipped. A batch whose response fails to parse is
  retried at half size, recursively down to single sentences; a sentence
  that still fails is logged to <output>.errors.jsonl and the run continues.

  --alts K: for the first K source ids, request 3 independent translations
  (3 separate calls each) and write them to <output>.alts.jsonl as
  {"id", "en", "target_lang", "alts": [t1, t2, t3], "model"}.

  --backtranslate: read a finished target JSONL (records with "en" and
  "translation"), translate each translation back to English with the same
  model, and write <name>.backtranslated.jsonl adding "en_back" and
  "drift_flag" (true when the token-overlap similarity between "en" and
  "en_back" is below 0.35).

Stdlib only. Credentials come from the environment:
  AZURE_FOUNDRY_ENDPOINT   e.g. https://<resource>.openai.azure.com
  AZURE_FOUNDRY_API_KEY    the resource key (never commit this)
  AZURE_FOUNDRY_DEPLOYMENT deployment name, e.g. gpt-5-5
"""
import argparse, json, os, re, sys, threading, time
import urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed
from email.utils import parsedate_to_datetime

ENDPOINT = os.environ["AZURE_FOUNDRY_ENDPOINT"].rstrip("/")
API_KEY = os.environ["AZURE_FOUNDRY_API_KEY"]
DEPLOYMENT = os.environ["AZURE_FOUNDRY_DEPLOYMENT"]
API_VERSION = os.environ.get("AZURE_FOUNDRY_API_VERSION", "2025-04-01-preview")
BATCH = 20
DRIFT_THRESHOLD = 0.35

PROMPTS = {
    "yoruba": (
        "You are an expert translator from English into Yoruba (Yoruba, Nigeria). "
        "Translate each numbered English sentence into natural, everyday, modern Yoruba "
        "as spoken in Lagos and Ibadan today. Use correct Yoruba orthography: the "
        "underdotted letters e with dot below, o with dot below, and s with dot below, "
        "and tone marks where they are standard in careful writing. Do NOT use archaic "
        "or biblical register. Keep names and numbers unchanged. Output ONLY the numbered "
        "translations, one per line, in the same order and numbering, with no commentary."
    ),
    "naija": (
        "You are an expert translator from English into Nigerian Pidgin (Naija), as "
        "spoken in Lagos and across Nigeria and used by Nigerian broadcasters. Translate "
        "each numbered English sentence into natural, everyday Naija. Keep names and "
        "numbers unchanged. Output ONLY the numbered translations, one per line, in the "
        "same order and numbering, with no commentary."
    ),
}

BACK_PROMPTS = {
    "yoruba": (
        "You are an expert translator from Yoruba into English. Translate each "
        "numbered Yoruba sentence into natural, everyday English. Keep names and "
        "numbers unchanged. Output ONLY the numbered translations, one per line, "
        "in the same order and numbering, with no commentary."
    ),
    "naija": (
        "You are an expert translator from Nigerian Pidgin (Naija) into English. "
        "Translate each numbered Nigerian Pidgin sentence into natural, everyday "
        "English. Keep names and numbers unchanged. Output ONLY the numbered "
        "translations, one per line, in the same order and numbering, with no commentary."
    ),
}


class RateGate:
    """Shared rate-limit gate: when any worker hits HTTP 429, all workers
    pause. The pause honors the server's Retry-After when present and
    otherwise grows exponentially with consecutive 429 strikes."""

    def __init__(self):
        self._lock = threading.Lock()
        self._pause_until = 0.0
        self._strikes = 0

    def wait(self):
        while True:
            with self._lock:
                remaining = self._pause_until - time.monotonic()
            if remaining <= 0:
                return
            time.sleep(min(remaining, 1.0))

    def hit(self, retry_after=None):
        with self._lock:
            self._strikes += 1
            if retry_after is not None:
                delay = retry_after
            else:
                delay = min(120.0, 2.0 * (2 ** self._strikes))
            self._pause_until = max(self._pause_until, time.monotonic() + delay)
            print(f"rate limited (strike {self._strikes}); all workers pause {delay:.0f}s",
                  flush=True)

    def ok(self):
        with self._lock:
            self._strikes = 0


GATE = RateGate()


def _retry_after_seconds(err):
    headers = getattr(err, "headers", None) or getattr(err, "hdrs", None)
    if headers is None:
        return None
    ms = headers.get("retry-after-ms") or headers.get("Retry-After-Ms")
    if ms:
        try:
            return max(0.0, float(ms) / 1000.0)
        except ValueError:
            pass
    raw = headers.get("Retry-After") or headers.get("retry-after")
    if raw:
        try:
            return max(0.0, float(raw))
        except ValueError:
            try:
                dt = parsedate_to_datetime(raw)
                return max(0.0, dt.timestamp() - time.time())
            except Exception:
                return None
    return None


def call_chat(system_prompt, user_text, retries=6):
    url = (f"{ENDPOINT}/openai/deployments/{DEPLOYMENT}/chat/completions"
           f"?api-version={API_VERSION}")
    payload = {
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_text},
        ],
    }
    # GPT-5-class reasoning deployments reject a non-default temperature;
    # only send one when explicitly requested.
    if os.environ.get("PILOT_TEMPERATURE"):
        payload["temperature"] = float(os.environ["PILOT_TEMPERATURE"])
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="POST", headers={
        "Content-Type": "application/json",
        "api-key": API_KEY,
    })
    for attempt in range(retries):
        GATE.wait()
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                GATE.ok()
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code == 400:
                print("HTTP 400 body:", e.read().decode("utf-8", "replace")[:800], flush=True)
                raise
            if e.code == 429 and attempt < retries - 1:
                GATE.hit(_retry_after_seconds(e))
                continue
            if e.code in (500, 502, 503, 504) and attempt < retries - 1:
                time.sleep(min(60, 5 * (2 ** attempt)))
                continue
            raise
        except urllib.error.URLError:
            if attempt < retries - 1:
                time.sleep(min(60, 5 * (2 ** attempt)))
                continue
            raise


def parse_numbered(text, expected):
    out = {}
    for line in text.strip().splitlines():
        line = line.strip()
        if not line:
            continue
        num, sep, rest = line.partition(".")
        if sep and num.strip().isdigit():
            out[int(num.strip())] = rest.strip()
    if len(out) != expected:
        raise ValueError(f"expected {expected} numbered lines, got {len(out)}")
    return [out[i] for i in range(1, expected + 1)]


class LockedWriter:
    """Append-only JSONL writer safe to share across worker threads.
    Each record is written and flushed under a lock."""

    def __init__(self, path):
        self._fh = open(path, "a", encoding="utf-8")
        self._lock = threading.Lock()

    def write(self, record):
        line = json.dumps(record, ensure_ascii=False) + "\n"
        with self._lock:
            self._fh.write(line)
            self._fh.flush()

    def close(self):
        with self._lock:
            self._fh.close()


def sibling_path(path, suffix):
    base = path[:-len(".jsonl")] if path.endswith(".jsonl") else path
    return base + suffix


def read_ids(path):
    ids = set()
    if os.path.exists(path):
        for l in open(path, encoding="utf-8"):
            if l.strip():
                ids.add(json.loads(l)["id"])
    return ids


def translate_items(items, lang, batch_no, err_writer, text_key="en",
                    prompt=None, make_record=None):
    """Translate a list of items with call_chat + parse_numbered.

    On any failure (unparseable response, API error) the list is split in
    half and retried recursively; a single item that still fails is logged
    to err_writer and skipped. Returns (records, prompt_tokens,
    completion_tokens)."""
    if not items:
        return [], 0, 0
    user_text = "\n".join(f"{j+1}. {s[text_key]}" for j, s in enumerate(items))
    try:
        resp = call_chat(prompt or PROMPTS[lang], user_text)
        content = resp["choices"][0]["message"]["content"]
        translations = parse_numbered(content, len(items))
    except Exception as e:
        if len(items) == 1:
            err_writer.write({
                "id": items[0]["id"], "en": items[0].get("en", ""),
                "target_lang": lang,
                "error": f"{type(e).__name__}: {e}",
            })
            return [], 0, 0
        mid = len(items) // 2
        recs_a, pin_a, pout_a = translate_items(items[:mid], lang, batch_no,
                                                err_writer, text_key, prompt,
                                                make_record)
        recs_b, pin_b, pout_b = translate_items(items[mid:], lang, batch_no,
                                                err_writer, text_key, prompt,
                                                make_record)
        return recs_a + recs_b, pin_a + pin_b, pout_a + pout_b
    usage = resp.get("usage", {})
    pin, pout = usage.get("prompt_tokens", 0), usage.get("completion_tokens", 0)
    records = []
    for s, t in zip(items, translations):
        if make_record is not None:
            records.append(make_record(s, t, resp, pin // len(items),
                                       pout // len(items), batch_no))
        else:
            records.append({
                "id": s["id"], "en": s["en"], "target_lang": lang,
                "translation": t, "model": resp.get("model", DEPLOYMENT),
                "usage_prompt_tokens": pin // len(items),
                "usage_completion_tokens": pout // len(items),
                "batch": batch_no,
            })
    return records, pin, pout


def run_batched(todo, batch_size, workers, job):
    """Run job(batch, batch_no) -> (records, pin, pout) over todo in
    parallel batches. Returns (total_prompt_tokens, total_completion_tokens,
    records_written)."""
    batches = [(todo[i:i + batch_size], i // batch_size)
               for i in range(0, len(todo), batch_size)]
    tot_in = tot_out = written = 0
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futures = {ex.submit(job, batch, batch_no): batch_no
                   for batch, batch_no in batches}
        for fut in as_completed(futures):
            records, pin, pout = fut.result()
            tot_in += pin
            tot_out += pout
            written += len(records)
    return tot_in, tot_out, written


def do_translate(src_path, out_path, lang, workers, alts_k):
    sources = [json.loads(l) for l in open(src_path, encoding="utf-8") if l.strip()]
    done = read_ids(out_path)
    todo = [s for s in sources if s["id"] not in done]
    print(f"{lang}: {len(done)} already done, {len(todo)} to translate "
          f"({workers} workers)", flush=True)
    writer = LockedWriter(out_path)
    err_writer = LockedWriter(sibling_path(out_path, ".errors.jsonl"))

    def job(batch, batch_no):
        records, pin, pout = translate_items(batch, lang, batch_no, err_writer)
        for r in records:
            writer.write(r)
        print(f"{lang}: batch {batch_no} ok ({len(records)}/{len(batch)} records, "
              f"{pin} in / {pout} out tokens)", flush=True)
        return records, pin, pout

    tot_in, tot_out, written = run_batched(todo, BATCH, workers, job)
    writer.close()
    err_writer.close()
    print(f"{lang}: wrote {written} records; TOTAL this run {tot_in} prompt + "
          f"{tot_out} completion tokens")
    if alts_k > 0:
        do_alts(sources, out_path, lang, workers, alts_k)


def do_alts(sources, out_path, lang, workers, k):
    alts_path = sibling_path(out_path, ".alts.jsonl")
    err_writer = LockedWriter(sibling_path(out_path, ".errors.jsonl"))
    writer = LockedWriter(alts_path)
    done = read_ids(alts_path)
    targets = [s for s in sources[:k] if s["id"] not in done]
    print(f"{lang}: alts for first {k} ids; {len(targets)} to do", flush=True)

    def one(s):
        try:
            alts, model = [], DEPLOYMENT
            for _ in range(3):
                resp = call_chat(PROMPTS[lang], f"1. {s['en']}")
                content = resp["choices"][0]["message"]["content"]
                alts.append(parse_numbered(content, 1)[0])
                model = resp.get("model", DEPLOYMENT)
            writer.write({"id": s["id"], "en": s["en"], "target_lang": lang,
                          "alts": alts, "model": model})
            return 1
        except Exception as e:
            err_writer.write({"id": s["id"], "en": s["en"], "target_lang": lang,
                              "error": f"alts: {type(e).__name__}: {e}"})
            return 0

    written = 0
    with ThreadPoolExecutor(max_workers=workers) as ex:
        for fut in as_completed([ex.submit(one, s) for s in targets]):
            written += fut.result()
    writer.close()
    err_writer.close()
    print(f"{lang}: wrote {written} alts records to {alts_path}")


def token_similarity(a, b):
    ta = set(re.findall(r"[a-z0-9]+", a.lower()))
    tb = set(re.findall(r"[a-z0-9]+", b.lower()))
    if not ta and not tb:
        return 1.0
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)


def do_backtranslate(target_path, lang, workers):
    out_path = sibling_path(target_path, ".backtranslated.jsonl")
    records_in = [json.loads(l) for l in open(target_path, encoding="utf-8")
                  if l.strip()]
    if not records_in:
        print("backtranslate: no records in input")
        return
    lang = lang or records_in[0].get("target_lang")
    if lang not in BACK_PROMPTS:
        print(f"backtranslate: unknown target_lang {lang!r}; pass LANG explicitly")
        sys.exit(2)
    done = read_ids(out_path)
    todo = [r for r in records_in if r["id"] not in done]
    print(f"backtranslate ({lang}): {len(done)} already done, {len(todo)} to do "
          f"({workers} workers)", flush=True)
    writer = LockedWriter(out_path)
    err_writer = LockedWriter(sibling_path(target_path, ".errors.jsonl"))

    def make_record(s, t, resp, pin_share, pout_share, batch_no):
        rec = dict(s)
        rec["en_back"] = t
        rec["drift_flag"] = token_similarity(s.get("en", ""), t) < DRIFT_THRESHOLD
        rec["back_usage_prompt_tokens"] = pin_share
        rec["back_usage_completion_tokens"] = pout_share
        return rec

    def job(batch, batch_no):
        records, pin, pout = translate_items(
            batch, lang, batch_no, err_writer, text_key="translation",
            prompt=BACK_PROMPTS[lang], make_record=make_record)
        for r in records:
            writer.write(r)
        print(f"backtranslate: batch {batch_no} ok ({len(records)}/{len(batch)} "
              f"records, {pin} in / {pout} out tokens)", flush=True)
        return records, pin, pout

    tot_in, tot_out, written = run_batched(todo, BATCH, workers, job)
    writer.close()
    err_writer.close()
    print(f"backtranslate: wrote {written} records to {out_path}; TOTAL this run "
          f"{tot_in} prompt + {tot_out} completion tokens")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("src", help="source JSONL (translate) or finished target "
                                "JSONL (--backtranslate)")
    ap.add_argument("out", nargs="?", help="output JSONL (translate mode)")
    ap.add_argument("lang", nargs="?", help="'yoruba' or 'naija'")
    ap.add_argument("--workers", type=int, default=4,
                    help="parallel batch workers (default 4)")
    ap.add_argument("--alts", type=int, default=0, metavar="K",
                    help="also write 3 alternative translations for the "
                         "first K source ids to <output>.alts.jsonl")
    ap.add_argument("--backtranslate", action="store_true",
                    help="translate a finished target JSONL back to English, "
                         "adding en_back and drift_flag")
    args = ap.parse_args()

    if args.backtranslate:
        do_backtranslate(args.src, args.lang, args.workers)
        return
    if not args.out or not args.lang:
        ap.error("translate mode needs SOURCE, OUTPUT and LANG")
    if args.lang not in PROMPTS:
        ap.error(f"unknown lang {args.lang!r} (expected 'yoruba' or 'naija')")
    do_translate(args.src, args.out, args.lang, args.workers, args.alts)


if __name__ == "__main__":
    main()
