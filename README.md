# Live Translate 🎙️ → 🇫🇷 / 🇲🇬

Speak in **English** and watch it translate **live** into **French** or **Malagasy** — without
waiting for you to finish the sentence, and with attention to local connotations rather than a
word-for-word gloss.

## How it works

| Layer | What it does |
| --- | --- |
| **Browser** | The Web Speech API streams *interim* (unfinished) English transcripts as you talk. |
| **Live translation** | Each in-progress phrase is sent to the backend and translated as you speak. When the phrase finalises, it locks in and a new line begins. |
| **Backend** (`server.js`) | A small Express server proxies to the Claude API and **streams** the translation back token-by-token over Server-Sent Events. |
| **Model** | Claude **Opus 4.8**, prompted to act as a real-time interpreter: preserve tone and register, adapt idioms/humour, and pick the phrasing a native speaker in France / Madagascar would actually use. |

The API key lives only on the server — it is never shipped to the browser.

## Run it

```bash
npm install
cp .env.example .env        # then put your ANTHROPIC_API_KEY in .env
export $(grep -v '^#' .env | xargs)   # or use any dotenv loader / your shell
npm start
```

Open <http://localhost:3000>, pick **French** or **Malagasy**, press **Start speaking**, and talk.

> Setting the key inline also works: `ANTHROPIC_API_KEY=sk-ant-... npm start`

## Put it on your phone's Home Screen

The app is a PWA, so you can install it as a one-tap, full-screen app. It needs a public
**https://** URL (see *Deploy* below) — `http://localhost` won't work for phone access or the mic.

- **iPhone (Safari):** open the URL → **Share** → **Add to Home Screen**.
- **Android (Chrome):** open the URL → menu **⋮** → **Install app** / **Add to Home Screen**.

Tap the new icon and it opens full-screen like a native app, ready over Wi-Fi or cellular.

## Deploy (get a public HTTPS URL)

**Render (free):** push this repo to GitHub, then in [Render](https://render.com) create a
**Web Service** from the repo. `render.yaml` sets the build/start commands; in the dashboard add an
environment variable **`ANTHROPIC_API_KEY`** with your key. Render gives you an `https://…` URL.

**Docker (any host):**

```bash
docker build -t live-translate .
docker run -p 3000:3000 -e ANTHROPIC_API_KEY=sk-ant-... live-translate
```

The key is supplied to the server as an environment variable on the host — it never ships to the browser.

## Notes & limitations

- **Live speech recognition** requires the Web Speech API — use **Chrome** or **Edge** (desktop or
  Android). Safari/Firefox support is limited. Microphone access must be allowed.
- **Connotation-aware:** the model is instructed to translate meaning, tone, and register, and to
  adapt idioms and culturally specific references to their natural equivalent in the target locale.
- **Partial sentences:** interim phrases are translated as far as they are meaningful; the model is
  told not to invent an ending. Finalised phrases get a fresh, full-quality translation.
- Switching language mid-phrase immediately re-translates the current line.
- This environment is sandboxed and ephemeral — outbound calls to `api.anthropic.com` require the
  session's network policy to allow them, and any work you want to keep must be committed and pushed.

## Project layout

```
server.js            Express + Claude streaming translation endpoint (/api/translate)
public/index.html    UI
public/app.js         Speech capture + live, streaming translation rendering
public/styles.css     Styles
```
