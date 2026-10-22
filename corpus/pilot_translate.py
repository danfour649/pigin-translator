#!/usr/bin/env python3
"""Pilot corpus generator: English -> Yoruba and English -> Nigerian Pidgin
via an Azure OpenAI (Foundry) chat deployment.

Reads a source JSONL ({"id": ..., "en": ...}), sends sentences in numbered
batches, and writes one JSONL record per sentence per language:
{"id", "en", "target_lang", "translation", "model", "usage_prompt_tokens",
 "usage_completion_tokens", "batch"}

Resumable: ids already present in the output file are skipped.
Stdlib only. Credentials come from the environment:
  AZURE_FOUNDRY_ENDPOINT   e.g. https://<resource>.openai.azure.com
  AZURE_FOUNDRY_API_KEY    the resource key (never commit this)
  AZURE_FOUNDRY_DEPLOYMENT deployment name, e.g. gpt-5.5
"""
import json, os, sys, time, urllib.request, urllib.error

ENDPOINT = os.environ["AZURE_FOUNDRY_ENDPOINT"].rstrip("/")
API_KEY = os.environ["AZURE_FOUNDRY_API_KEY"]
DEPLOYMENT = os.environ["AZURE_FOUNDRY_DEPLOYMENT"]
API_VERSION = os.environ.get("AZURE_FOUNDRY_API_VERSION", "2025-04-01-preview")
BATCH = 20

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


def call_chat(system_prompt, user_text, retries=5):
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
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code == 400:
                print("HTTP 400 body:", e.read().decode("utf-8", "replace")[:800], flush=True)
                raise
            if e.code in (429, 500, 502, 503, 504) and attempt < retries - 1:
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


def main():
    src_path, out_path, lang = sys.argv[1], sys.argv[2], sys.argv[3]
    sources = [json.loads(l) for l in open(src_path, encoding="utf-8") if l.strip()]
    done = set()
    if os.path.exists(out_path):
        for l in open(out_path, encoding="utf-8"):
            if l.strip():
                done.add(json.loads(l)["id"])
    todo = [s for s in sources if s["id"] not in done]
    print(f"{lang}: {len(done)} already done, {len(todo)} to translate", flush=True)
    tot_in = tot_out = 0
    with open(out_path, "a", encoding="utf-8") as out:
        for i in range(0, len(todo), BATCH):
            batch = todo[i:i + BATCH]
            user_text = "\n".join(f"{j+1}. {s['en']}" for j, s in enumerate(batch))
            resp = call_chat(PROMPTS[lang], user_text)
            content = resp["choices"][0]["message"]["content"]
            translations = parse_numbered(content, len(batch))
            usage = resp.get("usage", {})
            pin, pout = usage.get("prompt_tokens", 0), usage.get("completion_tokens", 0)
            tot_in += pin
            tot_out += pout
            for s, t in zip(batch, translations):
                out.write(json.dumps({
                    "id": s["id"], "en": s["en"], "target_lang": lang,
                    "translation": t, "model": resp.get("model", DEPLOYMENT),
                    "usage_prompt_tokens": pin // len(batch),
                    "usage_completion_tokens": pout // len(batch),
                    "batch": i // BATCH,
                }, ensure_ascii=False) + "\n")
            out.flush()
            print(f"{lang}: batch {i//BATCH} ok ({pin} in / {pout} out tokens)", flush=True)
    print(f"{lang}: TOTAL this run {tot_in} prompt + {tot_out} completion tokens")


if __name__ == "__main__":
    main()
