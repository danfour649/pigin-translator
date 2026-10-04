# Pigin

Pigin translates English into Nigerian Pidgin (Naijá) and Yorùbá at the same time. Type or dictate the English once, then play either result. There is no language switch.

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

Set an AI Gateway credential in `.env.local`: `AI_GATEWAY_API_KEY` or `VERCEL_OIDC_TOKEN`. On Vercel the deployment’s OIDC token is enough.

The page has a model selector. Both Naijá and Yorùbá use the model you pick, and Pigin calls only that model. If the gateway rejects it, the page shows that failure and does not try a different model.

- **Gemini 2.5 Flash Lite** (`google/gemini-2.5-flash-lite`) — the free model this site already uses. This is the default.
- **Gemini 3.1 Flash Lite** (`google/gemini-3.1-flash-lite`)
- **GPT-5.4** (`openai/gpt-5.4`) — paid. It spends AI Gateway credits.

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

Gateway requests use the model selected on the page. The default is `google/gemini-2.5-flash-lite`.

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

Speak can use a cloud voice per language. The browser plays the MP3 with `new Audio()`. Keys stay on the server and must not use a `NEXT_PUBLIC_` prefix.

| Language | Provider | Voice | Env |
| --- | --- | --- | --- |
| Naijá | Azure Speech | `en-NG-EzinneNeural` | `AZURE_SPEECH_KEY` and `AZURE_SPEECH_REGION` |
| Yorùbá | [Spitch](https://docs.spitch.app/features/speech) | `sade` | `SPITCH_API_KEY` |

`en-NG-EzinneNeural` is the current female English (Nigeria) neural voice in [Azure’s language and voice list](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support). Yorùbá does not call Azure. Spitch’s Yoruba voices are `sade` and `funmi` (feminine) and `segun` and `femi` (masculine); Pigin uses `sade`. If that language’s provider is unset or returns an error, Speak uses the browser voice and the existing warning. No new error is shown.

### Configure Azure

1. In the Azure portal, create a Speech resource. The F0 free tier is enough for this app: about 500,000 neural characters per month.
2. On the resource’s Keys and Endpoint page, copy **Key 1** and the **region** (for example `eastus`).
3. Locally, put them in `.env.local`:

```bash
AZURE_SPEECH_KEY=your-speech-key
AZURE_SPEECH_REGION=eastus
```

4. On Vercel, open the project → Settings → Environment Variables. Add `AZURE_SPEECH_KEY` and `AZURE_SPEECH_REGION` for Production (and Preview, if you want it there). Redeploy. Do not mark them as exposed to the browser.

### Configure Spitch

Yorùbá Speak calls `POST https://api.spitch.app/v1/speech` with `language` `yo`, `voice` `sade`, and `format` `mp3`. Set `SPITCH_API_KEY` in `.env.local` or as a sensitive Vercel env for Production, Preview, and Development. Do not expose it to the browser.

`GET /api/speak` returns `{ "configured": true }` or `false`, which providers are set (`providers.naija` is `azure` or `null`, `providers.yoruba` is `spitch` or `null`), and the voice names. It does not return either key. `POST /api/speak` with `{ "text", "language" }` returns `audio/mpeg` when that language’s provider is configured and the request is allowed. `language` is `naija` or `yoruba`, and `text` has the same 4000-character cap as translation.

`POST /api/speak` only calls Spitch or Azure for this site, and only inside a small budget. The site check uses the `Origin` header, or `Referer` when `Origin` is absent. Allowed hosts are `pigin-translator.vercel.app`, the deployment’s `VERCEL_URL`, `VERCEL_BRANCH_URL`, and `VERCEL_PROJECT_PRODUCTION_URL`, plus `localhost` / `127.0.0.1` / `::1` when `VERCEL` is unset. That header check is not a lock: a non-browser client can forge it. A request with no `Origin` or `Referer`, or from any other host, gets `403` and does not call Spitch or Azure.

Allowed requests are then counted in Vercel Runtime Cache (process memory off Vercel) before either provider is called. Spitch text counts against the same character budget as Azure. The cache is per region and can evict entries, so the numbers are a cap, not a perfect ledger. One visitor, taken from `x-real-ip` or otherwise `x-forwarded-for`, may make 8 requests per 10 minutes, 30 requests per 24 hours, and 8,000 characters per 24 hours. Everyone sharing that region and deployment environment may make 80 requests and 15,000 characters per 24 hours. Past either cap the route returns `429` and does not call either provider. The page treats `403`, `429`, and a provider error like any other cloud-voice failure and speaks with the browser voice.

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
{ "text": "Good morning", "language": "naija", "model": "google/gemini-2.5-flash-lite" }
```

`language` is `naija` or `yoruba`. `model` is one of `google/gemini-2.5-flash-lite`, `google/gemini-3.1-flash-lite`, or `openai/gpt-5.4`. If `model` is omitted, the free model is used. `text` is required and capped at 4000 characters. The page sends two of these requests, one for each language, so both translations appear together. A gateway rejection is returned as `error` and shown on the page.

Bookmarks and corrections are stored in the browser’s `localStorage`. They stay after a refresh and are not included in the translation request or the model prompt.

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

`POST /api/speak` returns `audio/mpeg` when that language’s cloud voice is configured and the request is within the site and rate limits above, `403` or `429` when it is not, and `503` when that language has no cloud voice. Yorùbá audio is Spitch; Naijá audio is Azure. `GET /api/speak` reports which providers are configured without returning either key.
