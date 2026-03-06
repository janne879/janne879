import * as webllm from "https://esm.run/@mlc-ai/web-llm";

let engine = null;
let isGenerating = false;
let currentChatId = null;
let chats = {};
let selectedModel = "Llama-3.2-3B-Instruct-q4f32_1-MLC";
let currentMessages = [];
let systemPrompt = "Du bist ein hilfreicher Assistent. Antworte immer auf Deutsch.";
let soundEnabled = true;
let audioCtx = null;

const $ = id => document.getElementById(id);
const loadScreen    = $("load-screen");
const chatArea      = $("chat-area");
const inputArea     = $("input-area");
const messagesEl    = $("messages");
const userInput     = $("user-input");
const sendBtn       = $("send-btn");
const loadModelBtn  = $("load-model-btn");
const loadProgress  = $("load-progress-wrap");
const progressFill  = $("load-progress-fill");
const progressLabel = $("load-progress-label");
const statusEl      = $("status-indicator");
const statusText    = statusEl ? statusEl.querySelector(".status-text") : null;
const currentTag    = $("current-model-tag");
const historyEl     = $("chat-history");
const webgpuWarn    = $("webgpu-warning");
const deviceInfo    = $("device-info");
const sidebar       = $("sidebar");
const charCount     = $("char-count");
const tokenStats    = $("token-stats");
const statTokens    = $("stat-tokens");
const statSpeed     = $("stat-speed");
const statTime      = $("stat-time");

(async function init() {
  detectDevice();
  loadSettings();
  loadHistory();
  renderHistory();
  setupEventListeners();
  if (!navigator.gpu) {
    if (webgpuWarn) webgpuWarn.style.display = "block";
    if (loadModelBtn) loadModelBtn.disabled = true;
    setStatus("error", "Kein WebGPU");
  }
})();

function detectDevice() {
  if (!deviceInfo) return;
  const gpu = navigator.gpu ? "WebGPU ✓" : "Kein WebGPU";
  const mem = navigator.deviceMemory ? navigator.deviceMemory + "GB RAM" : "";
  deviceInfo.querySelector("span").textContent = [gpu, mem].filter(Boolean).join(" · ");
}

function loadSettings() {
  try {
    const sp = localStorage.getItem("gso_system_prompt");
    if (sp) systemPrompt = sp;
    const se = localStorage.getItem("gso_sound_enabled");
    if (se !== null) soundEnabled = se === "true";
    updateSoundBtn();
    updateSystemPromptBtn();
  } catch (_) {}
}

function saveSettings() {
  try {
    localStorage.setItem("gso_system_prompt", systemPrompt);
    localStorage.setItem("gso_sound_enabled", String(soundEnabled));
  } catch (_) {}
}

function setStatus(state, text) {
  if (!statusEl) return;
  statusEl.className = "status-indicator " + state;
  if (statusText) statusText.textContent = text;
}

function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

function playTick() {
  if (!soundEnabled) return;
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.frequency.setValueAtTime(600 + Math.random() * 200, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(300, ctx.currentTime + 0.04);
    gain.gain.setValueAtTime(0.06, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.06);
  } catch (_) {}
}

function playSend() {
  if (!soundEnabled) return;
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.setValueAtTime(440, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.18);
  } catch (_) {}
}

function playDone() {
  if (!soundEnabled) return;
  try {
    const ctx = getAudioCtx();
    [0, 0.12, 0.24].forEach(function(delay, i) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      const freqs = [523, 659, 784];
      osc.frequency.setValueAtTime(freqs[i], ctx.currentTime + delay);
      gain.gain.setValueAtTime(0.07, ctx.currentTime + delay);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.18);
      osc.start(ctx.currentTime + delay);
      osc.stop(ctx.currentTime + delay + 0.2);
    });
  } catch (_) {}
}

function updateSoundBtn() {
  const btn = $("sound-btn");
  if (!btn) return;
  if (soundEnabled) {
    btn.classList.add("sound-active");
    btn.title = "Tipp-Geräusche: AN";
    btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>';
  } else {
    btn.classList.remove("sound-active");
    btn.title = "Tipp-Geräusche: AUS";
    btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>';
  }
}

function updateSystemPromptBtn() {
  const btn = $("systemprompt-btn");
  if (!btn) return;
  const isCustom = systemPrompt !== "Du bist ein hilfreicher Assistent. Antworte immer auf Deutsch.";
  if (isCustom) {
    btn.classList.add("system-prompt-active");
    btn.title = "System-Prompt aktiv ✓";
  } else {
    btn.classList.remove("system-prompt-active");
    btn.title = "System-Prompt bearbeiten";
  }
}

function showStats(tokenCount, tokensPerSec, elapsedSec) {
  if (!tokenStats) return;
  tokenStats.style.display = "flex";
  statTokens.textContent = tokenCount + " Tokens";
  statSpeed.textContent = tokensPerSec.toFixed(1) + " tok/s";
  const elapsed = elapsedSec >= 60
    ? Math.floor(elapsedSec / 60) + "m " + Math.round(elapsedSec % 60) + "s"
    : elapsedSec.toFixed(1) + "s";
  statTime.textContent = elapsed;
}

async function loadModel() {
  loadModelBtn.disabled = true;
  loadProgress.style.display = "block";
  setStatus("loading", "Lädt…");
  try {
    engine = await webllm.CreateMLCEngine(selectedModel, {
      initProgressCallback: function(progress) {
        const pct = Math.round((progress.progress || 0) * 100);
        progressFill.style.width = pct + "%";
        progressLabel.textContent = progress.text || ("Lädt… " + pct + "%");
      }
    });
    currentTag.textContent = selectedModel;
    setStatus("ready", "Bereit");
    loadScreen.style.display = "none";
    chatArea.style.display = "flex";
    inputArea.style.display = "block";
    if (tokenStats) tokenStats.style.display = "none";
    newChat();
    userInput.focus();
  } catch (err) {
    console.error("Modellfehler:", err);
    setStatus("error", "Fehler");
    progressLabel.textContent = "Fehlgeschlagen: " + err.message;
    loadModelBtn.disabled = false;
  }
}

function newChat() {
  currentChatId = "chat_" + Date.now();
  currentMessages = [];
  chats[currentChatId] = { title: "Neuer Chat", messages: [] };
  saveHistory();
  renderHistory();
  messagesEl.innerHTML = "";
  showWelcome();
}

function loadChat(id) {
  if (!chats[id]) return;
  currentChatId = id;
  currentMessages = chats[id].messages.slice();
  messagesEl.innerHTML = "";
  for (const msg of currentMessages) appendMessageEl(msg.role, msg.content, false);
  if (currentMessages.length === 0) showWelcome();
  renderHistory();
}

function showWelcome() {
  const preview = systemPrompt.length > 60 ? systemPrompt.slice(0, 60) + "…" : systemPrompt;
  messagesEl.innerHTML = '<div class="welcome-msg"><h2>GSO KI-Chat</h2><p>Dein Modell ist geladen und bereit.<br>Stell beliebige Fragen – dein Gespräch bleibt vollständig privat.</p><div class="welcome-prompt-tag"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/></svg><span>' + escapeHtml(preview) + '</span></div></div>';
}

async function sendMessage() {
  const text = userInput.value.trim();
  if (!text || !engine || isGenerating) return;

  if (messagesEl.querySelector(".welcome-msg")) messagesEl.innerHTML = "";

  userInput.value = "";
  autoResize();
  charCount.textContent = "0 / 4000";
  sendBtn.disabled = true;
  playSend();

  currentMessages.push({ role: "user", content: text });
  appendMessageEl("user", text, true);
  updateChatTitle(text);
  saveHistory();

  const assistantEl = appendMessageEl("assistant", "", false);
  const bubble = assistantEl.querySelector(".bubble");
  isGenerating = true;

  let fullResponse = "";
  let tokenCount = 0;
  let lastTickTime = 0;
  const startTime = performance.now();

  try {
    const messagesWithSystem = [{ role: "system", content: systemPrompt }].concat(currentMessages);
    const stream = await engine.chat.completions.create({
      messages: messagesWithSystem,
      stream: true,
      temperature: 0.7,
      max_tokens: 2048,
    });

    const cursor = document.createElement("span");
    cursor.className = "typing-cursor";
    bubble.appendChild(cursor);

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content || "";
      if (delta) {
        fullResponse += delta;
        tokenCount++;

        const now = performance.now();
        if (now - lastTickTime > 80) {
          playTick();
          lastTickTime = now;
        }

        const elapsed = (performance.now() - startTime) / 1000;
        const tps = elapsed > 0 ? tokenCount / elapsed : 0;
        showStats(tokenCount, tps, elapsed);

        cursor.remove();
        bubble.innerHTML = formatMarkdown(fullResponse);
        bubble.appendChild(cursor);
        scrollToBottom();
      }
    }

    cursor.remove();
    bubble.innerHTML = formatMarkdown(fullResponse);
    addCodeCopyButtons(bubble);

    const elapsed = (performance.now() - startTime) / 1000;
    showStats(tokenCount, tokenCount / elapsed, elapsed);
    playDone();

  } catch (err) {
    bubble.innerHTML = '<span style="color:var(--red)">Fehler: ' + err.message + '</span>';
    fullResponse = fullResponse || "[Fehler bei der Generierung]";
  }

  currentMessages.push({ role: "assistant", content: fullResponse });
  chats[currentChatId].messages = currentMessages.slice();
  saveHistory();

  isGenerating = false;
  sendBtn.disabled = !userInput.value.trim();
  scrollToBottom();
}

function appendMessageEl(role, content, animate) {
  const msg = document.createElement("div");
  msg.className = "message " + role;
  if (!animate) msg.style.animation = "none";
  const label = role === "user" ? "Du" : "GSO";
  msg.innerHTML = '<div class="avatar">' + label + '</div><div class="bubble">' + (content ? formatMarkdown(content) : "") + '</div>';
  messagesEl.appendChild(msg);
  scrollToBottom();
  return msg;
}

function scrollToBottom() {
  chatArea.scrollTop = chatArea.scrollHeight;
}

function formatMarkdown(text) {
  let out = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  out = out.replace(/```(\w*)\n?([\s\S]*?)```/g, function(_, lang, code) {
    return '<pre><code class="lang-' + lang + '">' + code.trim() + '</code></pre>';
  });
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  out = out.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  out = out.replace(/^## (.+)$/gm, "<h2>$1</h2>");
  out = out.replace(/^# (.+)$/gm, "<h1>$1</h1>");
  out = out.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  out = out.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/\*(.+?)\*/g, "<em>$1</em>");
  out = out.replace(/^> (.+)$/gm, "<blockquote>$1</blockquote>");
  out = out.replace(/^---$/gm, "<hr />");
  out = out.replace(/^[\*\-] (.+)$/gm, "<li>$1</li>");
  out = out.replace(/(<li>[\s\S]+?<\/li>)/g, "<ul>$1</ul>");
  out = out.replace(/^\d+\. (.+)$/gm, "<li>$1</li>");
  out = out.split(/\n\n+/).map(function(para) {
    para = para.trim();
    if (!para) return "";
    if (/^<(h[123]|ul|ol|pre|blockquote|hr)/.test(para)) return para;
    return "<p>" + para.replace(/\n/g, "<br/>") + "</p>";
  }).join("\n");
  return out;
}

function addCodeCopyButtons(container) {
  container.querySelectorAll("pre").forEach(function(pre) {
    if (pre.querySelector(".copy-code-btn")) return;
    const btn = document.createElement("button");
    btn.className = "copy-code-btn";
    btn.textContent = "kopieren";
    btn.onclick = function() {
      navigator.clipboard.writeText(pre.querySelector("code")?.textContent || "");
      btn.textContent = "kopiert!";
      setTimeout(function() { btn.textContent = "kopieren"; }, 2000);
    };
    pre.style.position = "relative";
    pre.appendChild(btn);
  });
}

function saveHistory() {
  try {
    localStorage.setItem("gso_chats", JSON.stringify(chats));
    localStorage.setItem("gso_current", currentChatId);
  } catch (_) {}
}

function loadHistory() {
  try {
    const saved = localStorage.getItem("gso_chats");
    if (saved) chats = JSON.parse(saved);
    const last = localStorage.getItem("gso_current");
    if (last && chats[last]) currentChatId = last;
  } catch (_) {}
}

function renderHistory() {
  const entries = Object.entries(chats).reverse();
  if (entries.length === 0) {
    historyEl.innerHTML = '<div class="history-empty">Noch keine Chats</div>';
    return;
  }
  historyEl.innerHTML = entries.map(function(e) {
    return '<div class="history-item ' + (e[0] === currentChatId ? "active" : "") + '" data-id="' + e[0] + '">' + escapeHtml(e[1].title) + '</div>';
  }).join("");
  historyEl.querySelectorAll(".history-item").forEach(function(el) {
    el.addEventListener("click", function() { if (engine) loadChat(el.dataset.id); });
  });
}

function updateChatTitle(text) {
  if (!chats[currentChatId]) return;
  chats[currentChatId].title = text.length > 38 ? text.slice(0, 38) + "…" : text;
  renderHistory();
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

$("model-selector").querySelectorAll(".model-option").forEach(function(opt) {
  opt.addEventListener("click", function() {
    if (engine) return;
    $("model-selector").querySelectorAll(".model-option").forEach(function(o) { o.classList.remove("active"); });
    opt.classList.add("active");
    selectedModel = opt.dataset.model;
  });
});

function autoResize() {
  userInput.style.height = "auto";
  userInput.style.height = Math.min(userInput.scrollHeight, 200) + "px";
}

function openModal() {
  const overlay = $("modal-overlay");
  const input = $("system-prompt-input");
  if (!overlay || !input) return;
  input.value = systemPrompt;
  overlay.style.display = "grid";
}

function closeModal() {
  const overlay = $("modal-overlay");
  if (overlay) overlay.style.display = "none";
}

function setupEventListeners() {
  loadModelBtn.addEventListener("click", loadModel);

  userInput.addEventListener("keydown", function(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!sendBtn.disabled) sendMessage();
    }
  });

  userInput.addEventListener("input", function() {
    autoResize();
    charCount.textContent = userInput.value.length + " / 4000";
    sendBtn.disabled = !userInput.value.trim() || isGenerating;
  });

  sendBtn.addEventListener("click", sendMessage);

  $("new-chat-btn").addEventListener("click", function() { if (engine) newChat(); });

  $("clear-btn").addEventListener("click", function() {
    if (!engine) return;
    currentMessages = [];
    if (chats[currentChatId]) chats[currentChatId].messages = [];
    saveHistory();
    messagesEl.innerHTML = "";
    showWelcome();
  });

  $("sidebar-toggle").addEventListener("click", function() {
    sidebar.classList.toggle("collapsed");
    sidebar.classList.toggle("open");
  });

  $("sound-btn").addEventListener("click", function() {
    soundEnabled = !soundEnabled;
    updateSoundBtn();
    saveSettings();
    if (soundEnabled) playSend();
  });

  $("systemprompt-btn").addEventListener("click", openModal);
  $("modal-close").addEventListener("click", closeModal);
  $("modal-overlay").addEventListener("click", function(e) {
    if (e.target === $("modal-overlay")) closeModal();
  });

  $("modal-save").addEventListener("click", function() {
    const val = $("system-prompt-input").value.trim();
    systemPrompt = val || "Du bist ein hilfreicher Assistent. Antworte immer auf Deutsch.";
    saveSettings();
    updateSystemPromptBtn();
    closeModal();
    if (engine) showWelcome();
  });

  $("modal-reset").addEventListener("click", function() {
    systemPrompt = "Du bist ein hilfreicher Assistent. Antworte immer auf Deutsch.";
    $("system-prompt-input").value = systemPrompt;
    saveSettings();
    updateSystemPromptBtn();
  });

  document.querySelectorAll(".preset-btn").forEach(function(btn) {
    btn.addEventListener("click", function() {
      $("system-prompt-input").value = btn.dataset.prompt;
    });
  });
}