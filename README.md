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

Set **one** server credential in `.env.local`. The app checks them in this order:

1. **AI Gateway**, when `AI_GATEWAY_API_KEY` or `VERCEL_OIDC_TOKEN` is present.
2. **OpenAI**, when `OPENAI_API_KEY` is present.
3. **Anthropic**, when `ANTHROPIC_API_KEY` is present.

If an earlier credential is rejected (HTTP 401 or 403), Pigin tries the next one. Other failures are returned as-is so a working key is not charged by accident.

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

Gateway requests use `openai/gpt-6-astra`. Direct OpenAI uses `gpt-6-astra`. Direct Anthropic uses `claude-sonnet-5-5`.

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

Playback asks the OS for a matching voice:

- **Naijá** prefers `en-NG` or a voice whose name mentions Nigeria. There is no standard Naijá voice, so a general English voice is the usual fallback. The words are still Naijá; the accent may not be.
- **Yorùbá** prefers a `yo` voice. Almost no desktop browser ships one. Without it, Pigin still speaks, shows a warning, and the tones will be wrong.

Voices load asynchronously. The first Speak click waits briefly for the browser’s voice list.

## Optional cloud voices

The default path does not call a cloud text-to-speech API. Add one only if you need a real Yorùbá voice or a Nigerian English voice the browser does not have. Keep that provider’s key on the server and return audio to the page. Do not call the provider from the browser.

A server route can accept `{ text, language }` and respond with `audio/mpeg` (or another audio type). The page would play it with `new Audio(objectUrl)` instead of `speechSynthesis`.

Providers that cover these languages today:

- **Google Cloud Text-to-Speech** has `yo-NG` voices for Yorùbá and `en-NG` voices that suit Naijá.
- **Microsoft Azure Speech** has `yo-NG` and `en-NG` neural voices.
- **OpenAI speech** and **ElevenLabs** can read the text aloud. Treat them as accented English unless the voice is specifically Yorùbá or Nigerian; they are a better fit for Naijá than for tone-marked Yorùbá.

Whichever you choose, follow that provider’s current model and voice names in their docs. The translation route in this repo is separate and does not need a speech key.

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
  "model": "openai/gpt-6-astra"
}
```

`provider` is `ai-gateway`, `openai`, or `anthropic`.

`GET /api/translate` reports whether a credential is configured. It does not echo secrets.
