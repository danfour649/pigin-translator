# Pigin

Pigin translates English into Nigerian Pidgin (Naijá) and Yorùbá. Type or dictate the English, pick a language, translate, then play the result.

Translation runs on the server. Microphone audio never goes to Pigin. Listening and speaking use the browser Web Speech API.

## Stack

- Next.js App Router, TypeScript, Tailwind CSS
- [Vercel AI SDK](https://ai-sdk.dev) for translation
- Web Speech API for speech-to-text and text-to-speech

## Run locally

Requires Node.js 20 or newer.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Set **one** server credential in `.env.local`. Pigin tries them in this order:

1. **AI Gateway**, when `AI_GATEWAY_API_KEY` or `VERCEL_OIDC_TOKEN` is present, or when the app is running on Vercel. Free-tier models are tried in order:
   - `google/gemini-2.5-flash-lite`
   - `inclusionai/ling-3.1-flash-free`
   - `poolside/laguna-s-2.1-free`
2. **OpenAI** (`gpt-6-astra`), when `OPENAI_API_KEY` is present.
3. **Anthropic** (`claude-sonnet-5-5`), when `ANTHROPIC_API_KEY` is present.

A free-tier model restriction (HTTP 403, `RestrictedModelsError`, or `no_providers_available`) tries the next model, including a direct provider key after the gateway list is exhausted. An authentication failure (HTTP 401) skips the remaining gateway models and tries a direct key when one is set. Other failures stop, so a working key is not charged by accident.

Do not prefix any of these with `NEXT_PUBLIC_`. They are read only in the server route `app/api/translate/route.ts`.

### AI Gateway without a long-lived key

This is the setup to use on Vercel, and it also works locally:

```bash
npm i -g vercel
vercel link
vercel env pull .env.local
npm run dev
```

`vercel env pull` writes a short-lived `VERCEL_OIDC_TOKEN` (about 12 hours). Pull again when it expires, or run `vercel dev`, which refreshes it. Enable [AI Gateway](https://vercel.com/docs/ai-gateway) for the linked project first.

You can instead create an AI Gateway API key in the Vercel dashboard and set `AI_GATEWAY_API_KEY`. A gateway key takes precedence over OIDC.

Gateway requests use the free-tier models listed above, starting with `google/gemini-2.5-flash-lite`. Direct OpenAI uses `gpt-6-astra`. Direct Anthropic uses `claude-sonnet-5-5`.

## Deploy on Vercel

```bash
vercel
```

Or import the GitHub repository in the Vercel dashboard.

Preferred production setup: enable AI Gateway for the project and **do not** put an API key in the repository or in the Vercel env dashboard. Deployments receive an OIDC token automatically, and Pigin uses it because `VERCEL=1`.

If the project does not use AI Gateway, set one of `AI_GATEWAY_API_KEY`, `OPENAI_API_KEY`, or `ANTHROPIC_API_KEY` in the project’s environment variables. Leave them out of git.

## Browser speech

| Browser | Listen (English) | Speak |
| --- | --- | --- |
| Chrome, Edge | Yes. Recognition is provided by the browser and may use that vendor’s cloud service. Pigin’s server does not receive the audio. | Yes |
| Safari (macOS) | Often unavailable | Yes |
| Firefox | Partial or unavailable, depending on version | Yes, with the installed OS voices |
| iOS browsers | Usually unavailable | Limited |

The microphone listens for English (`en-US`), which is the source language.

When Azure Speech is not configured, playback asks the OS for a matching voice:

- **Naijá** prefers `en-NG` or a voice whose name mentions Nigeria. There is no standard Naijá voice, so a general English voice is the usual fallback. The words are still Naijá; the accent may not be.
- **Yorùbá** prefers a `yo` voice. Almost no desktop browser ships one. Without it, Pigin still speaks, shows a warning, and the tones will be wrong.

Voices load asynchronously. The first Speak click waits briefly for the browser’s voice list.

## Optional cloud voices

Azure Speech is built in. When both `AZURE_SPEECH_KEY` and `AZURE_SPEECH_REGION` are set, Speak uses those neural voices on the server and plays the MP3 with `new Audio()`. The key is never sent to the browser and must not use a `NEXT_PUBLIC_` prefix.

| Language | Locale | Voice |
| --- | --- | --- |
| Naijá | `en-NG` | `en-NG-EzinneNeural` |
| Yorùbá | `yo-NG` | `yo-NG-AdeolaNeural` |

`en-NG-EzinneNeural` is the current female English (Nigeria) neural voice in [Azure’s language and voice list](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support). `en-NG-AbeoNeural` is the male voice in that same table; Pigin uses Ezinne. `yo-NG-AdeolaNeural` is the Yoruba (Nigeria) neural voice for `yo-NG`. That locale is not in the public table snapshot checked with this change, so if a region rejects Adeola the page falls back to the browser voice and shows the existing warning.

Leave both variables unset and Speak stays on the Web Speech API, including that Yorùbá fallback warning.

### Configure Azure

1. In the Azure portal, create a Speech resource. The F0 free tier is enough for this app: about 500,000 neural characters per month.
2. On the resource’s Keys and Endpoint page, copy **Key 1** and the **region** (for example `eastus`).
3. Locally, put them in `.env.local`:

```bash
AZURE_SPEECH_KEY=your-speech-key
AZURE_SPEECH_REGION=eastus
```

4. On Vercel, open the project → Settings → Environment Variables. Add `AZURE_SPEECH_KEY` and `AZURE_SPEECH_REGION` for Production (and Preview, if you want it there). Redeploy. Do not mark them as exposed to the browser.

`GET /api/speak` returns `{ "configured": true }` or `false`, plus the voice names. It does not return the key. `POST /api/speak` with `{ "text", "language" }` returns `audio/mpeg` when Azure is configured and the request is allowed. `language` is `naija` or `yoruba`, and `text` has the same 4000-character cap as translation. No other cloud voice provider is wired up.

`POST /api/speak` only calls Azure for this site, and only inside a small budget. The site check uses the `Origin` header, or `Referer` when `Origin` is absent. Allowed hosts are `pigin-translator.vercel.app`, the deployment’s `VERCEL_URL`, `VERCEL_BRANCH_URL`, and `VERCEL_PROJECT_PRODUCTION_URL`, plus `localhost` / `127.0.0.1` / `::1` when `VERCEL` is unset. That header check is not a lock: a non-browser client can forge it. A request with no `Origin` or `Referer`, or from any other host, gets `403` and does not call Azure.

Allowed requests are then counted in Vercel Runtime Cache (process memory off Vercel). The cache is per region and can evict entries, so the numbers are a cap, not a perfect ledger. One visitor, taken from `x-real-ip` or otherwise `x-forwarded-for`, may make 8 requests per 10 minutes, 30 requests per 24 hours, and 8,000 characters per 24 hours. Everyone sharing that region and deployment environment may make 80 requests and 15,000 characters per 24 hours. Past either cap the route returns `429` and does not call Azure. The page treats `403` and `429` like any other Azure failure and speaks with the browser voice.

## Scripts

```bash
npm run dev    # local dev server
npm run build  # production build
npm run start  # serve the production build
npm run lint   # eslint
```

## API

`POST /api/translate`

```json
{ "text": "Good morning", "language": "naija" }
```

`language` is `naija` or `yoruba`. `text` is required and capped at 4000 characters.

```json
{
  "translation": "Gud mọnin",
  "language": "naija",
  "provider": "ai-gateway",
  "model": "google/gemini-2.5-flash-lite"
}
```

`provider` is `ai-gateway`, `openai`, or `anthropic`.

`GET /api/translate` reports whether a credential is configured. It does not echo secrets.

`POST /api/speak` returns `audio/mpeg` when Azure Speech is configured and the request is within the site and rate limits above, `403` or `429` when it is not, and `503` when Azure is not configured. `GET /api/speak` reports that status without returning the key.
