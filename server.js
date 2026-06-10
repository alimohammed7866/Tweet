import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import Anthropic from "@anthropic-ai/sdk";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 3000;
const MODEL = process.env.TRANSLATE_MODEL || "claude-opus-4-8";

// Reads ANTHROPIC_API_KEY from the environment. Constructed lazily so the
// server still boots (and serves the UI) when the key isn't set yet.
let _client = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!_client) _client = new Anthropic();
  return _client;
}

const app = express();
app.use(express.json({ limit: "256kb" }));
app.use(express.static(path.join(__dirname, "public")));

// Languages the interpreter can translate between, with locale-specific guidance.
const LANGS = {
  english: {
    label: "English",
    locale: "a native English speaker",
    guidance:
      "Use natural, idiomatic English. Match the speaker's tone and register " +
      "(casual stays casual, formal stays formal).",
  },
  french: {
    label: "French",
    locale: "France",
    guidance:
      "Use standard metropolitan French as spoken in France. Match the speaker's register " +
      "(informal 'tu' for casual/friendly speech, formal 'vous' for professional or respectful " +
      "speech). Render idioms and humor with their natural French equivalents rather than literal calques.",
  },
  malagasy: {
    label: "Malagasy",
    locale: "Madagascar",
    guidance:
      "Use standard official Malagasy (the Merina-based written standard) as understood across " +
      "Madagascar. Respect Malagasy norms of politeness and indirectness, and adapt idioms, proverbs, " +
      "and culturally specific references to their closest natural Malagasy equivalent rather than " +
      "translating word for word. Keep loanwords only where genuinely common in everyday speech.",
  },
};

function buildSystemPrompt(from, to) {
  return [
    `You are a live interpreter in a two-way spoken conversation. Translate the ${from.label} below into ${to.label}.`,
    `The input is a live speech-to-text transcript and may be informal or an unfinished sentence.`,
    ``,
    `How to translate:`,
    `- ${to.guidance}`,
    `- Convey the speaker's intended meaning, tone, and register — not a word-for-word gloss.`,
    `- Pay close attention to local connotation: choose the phrasing ${to.locale} would actually use.`,
    `- If the input is an incomplete sentence, translate as far as it is meaningful. Do not invent an ending.`,
    `- Keep it concise and immediate, suitable for being spoken aloud.`,
    ``,
    `Output rules (strict):`,
    `- Output ONLY the ${to.label} translation.`,
    `- No quotation marks, no transliteration, no notes, no explanation, no preamble.`,
    `- Return the translation text and nothing else.`,
  ].join("\n");
}

app.post("/api/translate", async (req, res) => {
  const { text, from, to } = req.body || {};
  const src = LANGS[from];
  const dst = LANGS[to];

  if (typeof text !== "string" || !text.trim()) {
    return res.status(400).json({ error: "Missing 'text'." });
  }
  if (!src || !dst) {
    return res.status(400).json({ error: "Unknown 'from'/'to'. Use english, french, or malagasy." });
  }
  if (from === to) {
    return res.status(400).json({ error: "'from' and 'to' must differ." });
  }

  const client = getClient();
  if (!client) {
    return res.status(500).json({ error: "Server is missing ANTHROPIC_API_KEY." });
  }

  // Server-Sent Events so the translation appears token-by-token.
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
  res.flushHeaders?.();

  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 512,
    // No thinking + low effort keeps latency down for live captioning.
    output_config: { effort: "low" },
    system: buildSystemPrompt(src, dst),
    messages: [{ role: "user", content: text.trim() }],
  });

  // Abort only on a real client disconnect. Listen on the response (not the
  // request): a small POST body makes `req` emit "close" as soon as the body
  // is read, which would abort every translation immediately.
  const onClose = () => {
    if (!res.writableEnded) stream.abort();
  };
  res.on("close", onClose);

  try {
    stream.on("text", (delta) => {
      res.write(`data: ${JSON.stringify({ t: delta })}\n\n`);
    });
    await stream.finalMessage();
    res.write("data: [DONE]\n\n");
  } catch (err) {
    if (err?.name !== "AbortError") {
      console.error("translate error:", err?.status, err?.type || err?.name, err?.message || err);
      const detail = {
        error: "translation_failed",
        status: err?.status ?? null,
        type: err?.type ?? err?.name ?? null,
        message: err?.message ?? String(err),
      };
      res.write(`data: ${JSON.stringify(detail)}\n\n`);
    }
  } finally {
    res.off("close", onClose);
    res.end();
  }
});

app.get("/api/health", (_req, res) => res.json({ ok: true, model: MODEL }));

app.listen(PORT, () => {
  console.log(`Live translate running at http://localhost:${PORT}`);
});
