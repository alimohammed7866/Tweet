// Live speech translation front-end.
// - Web Speech API streams interim (unfinished) English transcripts.
// - Each in-progress phrase is translated live via the streaming /api/translate endpoint.
// - When a phrase is finalised, it locks in and a fresh line begins.

const LANG_LABELS = { french: "French", malagasy: "Malagasy" };

const els = {
  mic: document.getElementById("mic"),
  micLabel: document.getElementById("mic-label"),
  status: document.getElementById("status"),
  en: document.getElementById("en"),
  tr: document.getElementById("tr"),
  trLang: document.getElementById("tr-lang"),
  clear: document.getElementById("clear"),
  langBtns: Array.from(document.querySelectorAll(".lang-btn")),
};

let target = "french";
let recognition = null;
let recording = false;
let committedCount = 0; // number of final speech results already locked in

// Live (in-progress) DOM lines + the controller for the live translation request.
let liveEnLine = null;
let liveTrLine = null;
let liveController = null;
let liveDebounce = null;
let lastLiveText = "";

// ---------- helpers ----------

function setStatus(msg, isError = false) {
  els.status.textContent = msg;
  els.status.classList.toggle("is-error", isError);
}

function clearPlaceholders() {
  els.en.querySelector(".placeholder")?.remove();
  els.tr.querySelector(".placeholder")?.remove();
}

function newLine(container, cls) {
  const p = document.createElement("p");
  p.className = "line " + cls;
  container.appendChild(p);
  container.scrollTop = container.scrollHeight;
  return p;
}

// Read a Server-Sent-Events stream from POST /api/translate, calling onDelta per token.
async function streamTranslation(text, signal, onDelta) {
  const res = await fetch("/api/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, target }),
    signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`translate ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const events = buffer.split("\n\n");
    buffer = events.pop() ?? ""; // keep the trailing partial event

    for (const evt of events) {
      const line = evt.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") return;
      try {
        const data = JSON.parse(payload);
        if (data.error) throw new Error(data.error);
        if (data.t) onDelta(data.t);
      } catch (e) {
        if (e.message === "translation_failed") throw e;
        // ignore non-JSON keepalive lines
      }
    }
  }
}

// ---------- live (interim) translation ----------

function ensureLiveLines() {
  clearPlaceholders();
  if (!liveEnLine) liveEnLine = newLine(els.en, "line--live");
  if (!liveTrLine) liveTrLine = newLine(els.tr, "line--live caret");
}

function scheduleLiveTranslate(text) {
  ensureLiveLines();
  liveEnLine.textContent = text;
  els.en.scrollTop = els.en.scrollHeight;

  if (text === lastLiveText) return;
  lastLiveText = text;

  clearTimeout(liveDebounce);
  liveDebounce = setTimeout(() => runLiveTranslate(text), 280);
}

async function runLiveTranslate(text) {
  liveController?.abort();
  liveController = new AbortController();
  const myLine = liveTrLine;

  try {
    let out = "";
    await streamTranslation(text, liveController.signal, (delta) => {
      out += delta;
      myLine.textContent = out;
      els.tr.scrollTop = els.tr.scrollHeight;
    });
  } catch (e) {
    if (e.name !== "AbortError") setStatus("Translation issue — still listening…", true);
  }
}

function clearLive() {
  clearTimeout(liveDebounce);
  liveController?.abort();
  liveController = null;
  liveEnLine = null;
  liveTrLine = null;
  lastLiveText = "";
}

// ---------- committing a finished phrase ----------

function commitPhrase(englishText) {
  const text = englishText.trim();

  // Reuse the live lines as the locked-in lines (they already hold this phrase).
  clearTimeout(liveDebounce);
  liveController?.abort();
  liveController = null;
  lastLiveText = "";

  clearPlaceholders();
  const enLine = liveEnLine || newLine(els.en, "");
  const trLine = liveTrLine || newLine(els.tr, "");
  liveEnLine = null;
  liveTrLine = null;

  enLine.className = "line";
  trLine.className = "line caret";
  enLine.textContent = text;

  // Run a fresh, full translation of the finalised phrase for the best quality.
  const controller = new AbortController();
  let out = "";
  streamTranslation(text, controller.signal, (delta) => {
    out += delta;
    trLine.textContent = out;
    els.tr.scrollTop = els.tr.scrollHeight;
  })
    .then(() => trLine.classList.remove("caret"))
    .catch((e) => {
      if (e.name !== "AbortError") trLine.textContent = out || "—";
      trLine.classList.remove("caret");
    });
}

// ---------- speech recognition ----------

function buildRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;

  const rec = new SR();
  rec.lang = "en-US";
  rec.continuous = true;
  rec.interimResults = true;

  rec.onresult = (event) => {
    let interim = "";
    for (let i = 0; i < event.results.length; i++) {
      const result = event.results[i];
      const transcript = result[0].transcript;
      if (result.isFinal) {
        if (i >= committedCount) {
          committedCount = i + 1;
          if (transcript.trim()) commitPhrase(transcript);
        }
      } else {
        interim += transcript;
      }
    }
    interim = interim.trim();
    if (interim) scheduleLiveTranslate(interim);
    else clearLive();
  };

  rec.onerror = (e) => {
    if (e.error === "no-speech" || e.error === "aborted") return;
    if (e.error === "not-allowed") {
      setStatus("Microphone permission denied. Allow mic access and try again.", true);
      stopRecording();
    } else {
      setStatus(`Speech error: ${e.error}`, true);
    }
  };

  // Auto-restart while the user still wants to record (recognition stops on pauses).
  rec.onend = () => {
    if (recording) {
      try { rec.start(); } catch (_) { /* already starting */ }
    }
  };

  return rec;
}

function startRecording() {
  if (!recognition) recognition = buildRecognition();
  if (!recognition) {
    setStatus("Live speech needs the Web Speech API. Use Chrome or Edge on desktop/Android.", true);
    return;
  }
  recording = true;
  committedCount = 0;
  try {
    recognition.start();
  } catch (_) { /* start() throws if already running */ }
  els.mic.classList.add("is-recording");
  els.mic.setAttribute("aria-pressed", "true");
  els.micLabel.textContent = "Stop";
  setStatus("Listening… start talking.");
}

function stopRecording() {
  recording = false;
  recognition?.stop();
  clearLive();
  els.mic.classList.remove("is-recording");
  els.mic.setAttribute("aria-pressed", "false");
  els.micLabel.textContent = "Start speaking";
  setStatus("Stopped. Press “Start speaking” to go again.");
}

// ---------- wiring ----------

els.mic.addEventListener("click", () => {
  if (recording) stopRecording();
  else startRecording();
});

els.langBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    target = btn.dataset.target;
    els.langBtns.forEach((b) => b.classList.toggle("is-active", b === btn));
    els.trLang.textContent = LANG_LABELS[target];
    // Re-translate the in-progress phrase into the new language right away.
    if (lastLiveText) {
      const t = lastLiveText;
      lastLiveText = "";
      scheduleLiveTranslate(t);
    }
  });
});

els.clear.addEventListener("click", () => {
  clearLive();
  committedCount = recording ? 0 : committedCount;
  if (recognition && recording) {
    // Reset the recogniser so indices restart cleanly.
    recognition.stop();
  }
  committedCount = 0;
  els.en.innerHTML = '<p class="placeholder">Your words will appear here…</p>';
  els.tr.innerHTML = '<p class="placeholder">La traduction apparaîtra ici…</p>';
});

// Feature check on load.
if (!(window.SpeechRecognition || window.webkitSpeechRecognition)) {
  setStatus("This browser has no live speech recognition. Use Chrome or Edge.", true);
  els.mic.disabled = true;
}
