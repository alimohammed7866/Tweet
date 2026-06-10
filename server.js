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

// Supported target languages with locale-specific guidance for the model.
const TARGETS = {
  french: {
    label: "French",
    locale: "France",
    guidance:
      "Use standard metropolitan French as spoken in France. Match the speaker's register " +
      "(use informal 'tu' for casual/friendly speech, formal 'vous' for professional or " +
      "respectful speech). Render idioms and humor with their natural French equivalents " +
      "rather than literal calques.",
  },
  malagasy: {
    label: "Malagasy",
    locale: "Madagascar",
    guidance:
      "Use standard official Malagasy (the Merina-based written standard) as understood across " +
      "Madagascar. Respect Malagasy norms of politeness and indirectness, and adapt idioms, " +
      "proverbs, and culturally specific references to their closest natural Malagasy equivalent " +
      "rather than translating word for word. Keep loanwords only where they are genuinely common " +
      "in everyday Malagasy speech.",
  },
};

function buildSystemPrompt(target) {
  return [
    `You are a real-time interpreter rendering live spoken English into ${target.label}.`,
    `The input is a live speech-to-text transcript and is often a partial, unfinished sentence.`,
    ``,
    `How to translate:`,
    `- ${target.guidance}`,
    `- Convey the speaker's intended meaning, tone, and register, not a word-for-word gloss.`,
    `- Pay close attention to local connotation: choose the phrasing a native speaker in ${target.locale} would actually use.`,
    `- If the input is an incomplete sentence, translate as far as it is meaningful. Do not invent an ending.`,
    `- Keep it concise and immediate, suitable for live captions.`,
    ``,
    `Output rules (strict):`,
    `- Output ONLY the ${target.label} translation.`,
    `- No quotation marks, no transliteration, no English, no notes, no explanation, no preamble.`,
    `- Do not describe what you are doing. Return the translation text and nothing else.`,
  ].join("\n");
}

app.post("/api/translate", async (req, res) => {
  const { text, target } = req.body || {};
  const cfg = TARGETS[target];

  if (typeof text !== "string" || !text.trim()) {
    return res.status(400).json({ error: "Missing 'text'." });
  }
  if (!cfg) {
    return res.status(400).json({ error: "Unknown 'target'. Use 'french' or 'malagasy'." });
  }

  const client = getClient();
  if (!client) {
    return res.status(500).json({ error: "Server is missing ANTHROPIC_API_KEY." });
  }

  // Server-Sent Events stream so the translation appears token-by-token.
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
    system: buildSystemPrompt(cfg),
    messages: [{ role: "user", content: text.trim() }],
  });

  // If the client navigates away or sends a newer request, stop generating.
  const onClose = () => stream.abort();
  req.on("close", onClose);

  try {
    stream.on("text", (delta) => {
      res.write(`data: ${JSON.stringify({ t: delta })}\n\n`);
    });
    await stream.finalMessage();
    res.write("data: [DONE]\n\n");
  } catch (err) {
    // AbortError just means a newer request superseded this one.
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
    req.off("close", onClose);
    res.end();
  }
});

app.get("/api/health", (_req, res) => res.json({ ok: true, model: MODEL }));

app.listen(PORT, () => {
  console.log(`Live translate running at http://localhost:${PORT}`);
});
