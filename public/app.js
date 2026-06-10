// Two-way live voice interpreter.
// - Tap a side, speak; the phone transcribes (Web Speech API), Claude translates
//   (streaming, connotation-aware), and the phone speaks the translation aloud.
// - English <-> French works fully on phones. Malagasy text always works; its
//   speech recognition / voice depends on the device (graceful fallback + typing).
// - Conversations can be saved, categorised, and reopened (stored on the device).

const LANGS = {
  english:  { label: "English",  flag: "🇬🇧", stt: "en-US", tts: "en-US" },
  french:   { label: "French",   flag: "🇫🇷", stt: "fr-FR", tts: "fr-FR" },
  malagasy: { label: "Malagasy", flag: "🇲🇬", stt: "mg-MG", tts: "mg-MG" },
};

const CATEGORIES = ["Medical", "Travel", "Business", "Family & Personal", "Legal / Admin", "Education", "Other"];

const STORE_KEY = "liveTranslate.conversations.v1";

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const TTS = window.speechSynthesis || null;

// ---------- state ----------
let convo = { otherLang: "french", turns: [] };
let recognition = null;
let listening = false;
let activeSide = null;        // 'english' | 'french' | 'malagasy'
let liveBubble = null;        // in-progress bubble while speaking
let sessionFinal = "";        // finalised transcript for the current utterance

// ---------- DOM ----------
const el = {
  conversation: document.getElementById("conversation"),
  status: document.getElementById("status"),
  tagOther: document.getElementById("tag-other"),
  otherName: document.getElementById("other-name"),
  otherFlag: document.getElementById("other-flag"),
  talkEnglish: document.getElementById("talk-english"),
  talkOther: document.getElementById("talk-other"),
  langBtns: Array.from(document.querySelectorAll(".lang-btn")),
  typeRow: document.getElementById("type-row"),
  typeSide: document.getElementById("type-side"),
  typeInput: document.getElementById("type-input"),
  newConv: document.getElementById("new-conv"),
  saveConv: document.getElementById("save-conv"),
  openSaved: document.getElementById("open-saved"),
  // save modal
  saveModal: document.getElementById("save-modal"),
  saveTitle: document.getElementById("save-title"),
  saveCategory: document.getElementById("save-category"),
  saveCancel: document.getElementById("save-cancel"),
  saveConfirm: document.getElementById("save-confirm"),
  // saved modal
  savedModal: document.getElementById("saved-modal"),
  savedClose: document.getElementById("saved-close"),
  savedList: document.getElementById("saved-list"),
  savedFilterCat: document.getElementById("saved-filter-cat"),
};

// ---------- helpers ----------
function setStatus(msg, isError = false) {
  el.status.textContent = msg;
  el.status.classList.toggle("is-error", isError);
}
function clearPlaceholder() {
  el.conversation.querySelector(".placeholder")?.remove();
}
function scrollConvo() {
  el.conversation.scrollTop = el.conversation.scrollHeight;
}
function targetOf(side) {
  return side === "english" ? convo.otherLang : "english";
}

// ---------- text-to-speech ----------
let voices = [];
function loadVoices() { voices = (TTS && TTS.getVoices && TTS.getVoices()) || []; }
loadVoices();
if (TTS) TTS.addEventListener?.("voiceschanged", loadVoices);

function pickVoice(code) {
  const base = code.split("-")[0].toLowerCase();
  const lc = code.toLowerCase();
  return (
    voices.find((v) => v.lang && v.lang.toLowerCase() === lc) ||
    voices.find((v) => v.lang && v.lang.toLowerCase().startsWith(base)) ||
    null
  );
}
function hasVoiceFor(langKey) { return !!pickVoice(LANGS[langKey].tts); }

function speak(text, langKey) {
  if (!TTS || !text) return;
  const code = LANGS[langKey].tts;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = code;
  const v = pickVoice(code);
  if (v) u.voice = v;
  try { TTS.cancel(); TTS.speak(u); } catch (_) {}
}
// iOS requires speech to start inside a user gesture; prime it on first tap.
let primed = false;
function primeTTS() {
  if (!TTS || primed) return;
  try { const u = new SpeechSynthesisUtterance(" "); u.volume = 0; TTS.speak(u); primed = true; } catch (_) {}
}

// ---------- translation stream ----------
async function streamTranslation(text, from, to, signal, onDelta) {
  const res = await fetch("/api/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, from, to }),
    signal,
  });
  if (!res.ok || !res.body) {
    let why = `HTTP ${res.status}`;
    try { const j = await res.json(); if (j.error) why = j.error; } catch (_) {}
    throw new Error(why);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const evt of events) {
      const line = evt.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") return;
      try {
        const data = JSON.parse(payload);
        if (data.error) throw new Error(data.message || data.error);
        if (data.t) onDelta(data.t);
      } catch (e) {
        if (e instanceof SyntaxError) continue; // keepalive / partial
        throw e;
      }
    }
  }
}

// ---------- conversation bubbles ----------
function addBubble(side, original, translation) {
  clearPlaceholder();
  const to = targetOf(side);

  const root = document.createElement("div");
  root.className = "bubble bubble--" + (side === "english" ? "english" : "other");

  const meta = document.createElement("div");
  meta.className = "bubble-meta";
  meta.textContent = `${LANGS[side].flag} ${LANGS[side].label}`;

  const orig = document.createElement("div");
  orig.className = "bubble-original";
  orig.textContent = original;

  const trans = document.createElement("div");
  trans.className = "bubble-translation";
  trans.textContent = translation;

  const replay = document.createElement("button");
  replay.className = "replay";
  replay.type = "button";
  replay.textContent = "🔊";
  replay.title = `Hear ${LANGS[to].label}`;
  replay.addEventListener("click", () => speak(trans.textContent, to));

  root.append(meta, orig, trans, replay);
  el.conversation.appendChild(root);
  scrollConvo();

  return {
    side, to, root,
    setOriginal: (t) => { orig.textContent = t; },
    setTranslation: (t) => { trans.textContent = t; },
    markPending: (on) => root.classList.toggle("bubble--pending", on),
  };
}

// Translate a finalised phrase, stream it into its bubble, then speak it aloud.
async function translateInto(bubble, text) {
  bubble.setOriginal(text);
  bubble.setTranslation("…");
  let out = "";
  try {
    await streamTranslation(text, bubble.side, bubble.to, undefined, (d) => {
      out += d;
      bubble.setTranslation(out);
      scrollConvo();
    });
  } catch (e) {
    out = out || `⚠️ ${e.message}`;
    bubble.setTranslation(out);
    setStatus(`Translation problem: ${e.message}`, true);
  }
  convo.turns.push({
    side: bubble.side, from: bubble.side, to: bubble.to,
    original: text, translation: out, ts: Date.now(),
  });
  if (!out.startsWith("⚠️")) speak(out, bubble.to);
}

async function processTyped(text, side) {
  const bubble = addBubble(side, text, "…");
  await translateInto(bubble, text.trim());
  setStatus("Ready.");
}

// ---------- speech recognition (one tap = one turn) ----------
function buildRecognition(side) {
  if (!SR) return null;
  const r = new SR();
  r.lang = LANGS[side].stt;
  r.continuous = true;
  r.interimResults = true;
  return r;
}

function setTalkUI(side, on) {
  el.talkEnglish.classList.toggle("is-recording", on && side === "english");
  el.talkOther.classList.toggle("is-recording", on && side !== "english");
  el.talkEnglish.querySelector(".talk-sub").textContent =
    on && side === "english" ? "listening — tap to stop" : "tap & talk";
  el.talkOther.querySelector(".talk-sub").textContent =
    on && side !== "english" ? "listening — tap to stop" : "tap & talk";
}

function startListening(side) {
  const rec = buildRecognition(side);
  if (!rec) {
    setStatus("Speech recognition isn't supported here — type your phrase below.", true);
    return;
  }
  recognition = rec;
  activeSide = side;
  listening = true;
  sessionFinal = "";
  liveBubble = addBubble(side, "", "");
  liveBubble.markPending(true);
  setTalkUI(side, true);
  setStatus(`Listening in ${LANGS[side].label}…`);
  primeTTS();
  if (TTS) { try { TTS.cancel(); } catch (_) {} } // don't talk over the mic

  rec.onresult = (event) => {
    let interim = "", finalT = "";
    for (let i = 0; i < event.results.length; i++) {
      const t = event.results[i][0].transcript;
      if (event.results[i].isFinal) finalT += t; else interim += t;
    }
    sessionFinal = finalT.trim();
    liveBubble.setOriginal((finalT + interim).trim());
    scrollConvo();
  };

  rec.onerror = (e) => {
    if (e.error === "language-not-supported") {
      setStatus(`${LANGS[side].label} speech isn't supported on this device — type it below instead.`, true);
    } else if (e.error === "not-allowed" || e.error === "service-not-allowed") {
      setStatus("Microphone blocked. Allow mic access in your browser and retry.", true);
    } else if (e.error !== "aborted" && e.error !== "no-speech") {
      setStatus(`Speech error: ${e.error}`, true);
    }
  };

  rec.onend = () => finishListening();
  try { rec.start(); } catch (_) {}
}

function finishListening() {
  if (!liveBubble) return;
  listening = false;
  setTalkUI(null, false);
  const bubble = liveBubble;
  liveBubble = null;
  recognition = null;
  const text = sessionFinal.trim();
  if (text) {
    bubble.markPending(false);
    translateInto(bubble, text).then(() => setStatus("Ready — tap to reply."));
  } else {
    bubble.root.remove();
    if (!el.conversation.children.length) {
      el.conversation.innerHTML = '<p class="placeholder">Your bilingual conversation will appear here…</p>';
    }
    setStatus("Didn't catch anything — try again, or type below.");
  }
}

function stopListening() {
  if (!listening || !recognition) return;
  try { recognition.stop(); } catch (_) { finishListening(); }
}

function onTalkTap(side) {
  if (listening) { stopListening(); return; }
  startListening(side);
}

// ---------- saved conversations (device storage) ----------
function loadStore() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; } catch (_) { return []; }
}
function writeStore(arr) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(arr)); } catch (_) {}
}

function openSaveModal() {
  if (!convo.turns.length) { setStatus("Nothing to save yet — have a conversation first.", true); return; }
  const firstEn = convo.turns.find((t) => t.from === "english");
  const suggested = (firstEn ? firstEn.original : convo.turns[0].original).slice(0, 40);
  el.saveTitle.value = suggested;
  el.saveModal.classList.remove("hidden");
  el.saveTitle.focus();
  el.saveTitle.select();
}

function saveConversation() {
  const title = el.saveTitle.value.trim() || "Untitled";
  const category = el.saveCategory.value;
  const rec = {
    id: Date.now().toString(36),
    title, category,
    otherLang: convo.otherLang,
    createdAt: Date.now(),
    turns: convo.turns.map((t) => ({ ...t })),
  };
  const all = loadStore();
  all.unshift(rec);
  writeStore(all);
  el.saveModal.classList.add("hidden");
  setStatus(`Saved “${title}” under ${category}.`);
}

function renderSavedList() {
  const all = loadStore();
  const filter = el.savedFilterCat.value;
  const items = filter === "__all" ? all : all.filter((r) => r.category === filter);

  if (!all.length) {
    el.savedList.innerHTML = '<p class="placeholder">No saved conversations yet.</p>';
    return;
  }
  if (!items.length) {
    el.savedList.innerHTML = '<p class="placeholder">Nothing in this category.</p>';
    return;
  }

  el.savedList.innerHTML = "";
  for (const r of items) {
    const card = document.createElement("div");
    card.className = "saved-item";

    const info = document.createElement("div");
    info.className = "saved-info";
    const date = new Date(r.createdAt).toLocaleString();
    info.innerHTML =
      `<div class="saved-title">${escapeHtml(r.title)}</div>` +
      `<div class="saved-sub"><span class="badge">${escapeHtml(r.category)}</span> ` +
      `<span class="badge badge--lang">EN ⇄ ${escapeHtml(LANGS[r.otherLang]?.label || r.otherLang)}</span> ` +
      `· ${r.turns.length} turns · ${date}</div>`;

    const actions = document.createElement("div");
    actions.className = "saved-actions";
    const openBtn = document.createElement("button");
    openBtn.className = "primary-btn";
    openBtn.type = "button";
    openBtn.textContent = "Open";
    openBtn.addEventListener("click", () => openConversation(r.id));
    const delBtn = document.createElement("button");
    delBtn.className = "ghost-btn";
    delBtn.type = "button";
    delBtn.textContent = "Delete";
    delBtn.addEventListener("click", () => { deleteConversation(r.id); });
    actions.append(openBtn, delBtn);

    card.append(info, actions);
    el.savedList.appendChild(card);
  }
}

function openConversation(id) {
  const rec = loadStore().find((r) => r.id === id);
  if (!rec) return;
  setOtherLang(rec.otherLang);
  convo = { otherLang: rec.otherLang, turns: rec.turns.map((t) => ({ ...t })) };
  renderConversation();
  el.savedModal.classList.add("hidden");
  setStatus(`Opened “${rec.title}”. You can continue or replay any line.`);
}

function deleteConversation(id) {
  writeStore(loadStore().filter((r) => r.id !== id));
  renderSavedList();
}

function renderConversation() {
  el.conversation.innerHTML = "";
  if (!convo.turns.length) {
    el.conversation.innerHTML = '<p class="placeholder">Your bilingual conversation will appear here…</p>';
    return;
  }
  for (const t of convo.turns) {
    const b = addBubble(t.side, t.original, t.translation);
    b.markPending(false);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------- language selection ----------
function setOtherLang(lang) {
  convo.otherLang = lang;
  el.langBtns.forEach((b) => b.classList.toggle("is-active", b.dataset.target === lang));
  el.otherName.textContent = LANGS[lang].label;
  el.otherFlag.textContent = LANGS[lang].flag;
  el.tagOther.textContent = LANGS[lang].label;
  el.typeSide.options[1].textContent = `${LANGS[lang].flag} ${lang === "malagasy" ? "MG" : "FR"}`;
  // Device-support hint for Malagasy.
  if (lang === "malagasy" && (!hasVoiceFor("malagasy"))) {
    setStatus("Heads up: this device has no Malagasy voice, so Malagasy audio may not play. Text translation still works, and you can type Malagasy below.");
  } else {
    setStatus("Ready — tap a button and speak.");
  }
}

// ---------- wiring ----------
el.talkEnglish.addEventListener("click", () => onTalkTap("english"));
el.talkOther.addEventListener("click", () => onTalkTap(convo.otherLang));

el.langBtns.forEach((btn) =>
  btn.addEventListener("click", () => setOtherLang(btn.dataset.target))
);

el.typeRow.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = el.typeInput.value.trim();
  if (!text) return;
  const side = el.typeSide.value === "english" ? "english" : convo.otherLang;
  primeTTS();
  el.typeInput.value = "";
  processTyped(text, side);
});

el.newConv.addEventListener("click", () => {
  if (listening) stopListening();
  convo = { otherLang: convo.otherLang, turns: [] };
  renderConversation();
  setStatus("New conversation started.");
});

el.saveConv.addEventListener("click", openSaveModal);
el.saveCancel.addEventListener("click", () => el.saveModal.classList.add("hidden"));
el.saveConfirm.addEventListener("click", saveConversation);

el.openSaved.addEventListener("click", () => {
  renderSavedList();
  el.savedModal.classList.remove("hidden");
});
el.savedClose.addEventListener("click", () => el.savedModal.classList.add("hidden"));
el.savedFilterCat.addEventListener("change", renderSavedList);

// Close modals when tapping the dim backdrop.
[el.saveModal, el.savedModal].forEach((m) =>
  m.addEventListener("click", (e) => { if (e.target === m) m.classList.add("hidden"); })
);

// ---------- init ----------
function populateCategories() {
  el.saveCategory.innerHTML = CATEGORIES.map((c) => `<option>${c}</option>`).join("");
  el.savedFilterCat.innerHTML =
    `<option value="__all">All categories</option>` +
    CATEGORIES.map((c) => `<option value="${c}">${c}</option>`).join("");
}
populateCategories();
setOtherLang("french");

if (!SR) {
  setStatus("This browser has no live speech recognition (use Chrome or Edge). You can still type phrases below to translate and hear them.", true);
}
