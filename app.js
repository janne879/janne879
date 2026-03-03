/**
 * GSO KI-Chat — WebLLM Chat Interface
 * Powered by @mlc-ai/web-llm (runs entirely in the browser via WebGPU)
 */

import * as webllm from "https://esm.run/@mlc-ai/web-llm";

// ─── State ────────────────────────────────────────────────────────────────────
let engine = null;
let isGenerating = false;
let abortController = null;
let currentChatId = null;
let chats = {}; // { id: { title, messages: [{role, content}] } }
let selectedModel = "Llama-3.2-3B-Instruct-q4f32_1-MLC";
let currentMessages = []; // active conversation history

// ─── DOM Refs ─────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const loadScreen    = $("load-screen");
const chatArea      = $("chat-area");
const inputArea     = $("input-area");
const messagesEl    = $("messages");
const userInput     = $("user-input");
const sendBtn       = $("send-btn");
const stopBtn       = $("stop-btn");
const loadModelBtn  = $("load-model-btn");
const loadProgress  = $("load-progress-wrap");
const progressFill  = $("load-progress-fill");
const progressLabel = $("load-progress-label");
const statusEl      = $("status-indicator");
const statusText    = statusEl.querySelector(".status-text");
const currentTag    = $("current-model-tag");
const historyEl     = $("chat-history");
const webgpuWarn    = $("webgpu-warning");
const deviceInfo    = $("device-info");
const sidebar       = $("sidebar");
const charCount     = $("char-count");

// ─── Init ─────────────────────────────────────────────────────────────────────
(async function init() {
  detectDevice();
  loadHistory();
  renderHistory();
  setupEventListeners();

  // Check WebGPU support
  if (!navigator.gpu) {
    webgpuWarn.style.display = "block";
    loadModelBtn.disabled = true;
    setStatus("error", "Kein WebGPU");
  }
})();

// ─── Device Detection ─────────────────────────────────────────────────────────
function detectDevice() {
  const gpu = navigator.gpu ? "WebGPU ✓" : "Kein WebGPU";
  const mem = navigator.deviceMemory ? `${navigator.deviceMemory}GB RAM` : "";
  const info = [gpu, mem].filter(Boolean).join(" · ");
  deviceInfo.querySelector("span").textContent = info;
}

// ─── Status ───────────────────────────────────────────────────────────────────
function setStatus(state, text) {
  statusEl.className = `status-indicator ${state}`;
  statusText.textContent = text;
}

// ─── Model Loading ────────────────────────────────────────────────────────────
async function loadModel() {
  loadModelBtn.disabled = true;
  loadProgress.style.display = "block";
  setStatus("loading", "Lädt…");

  try {
    engine = await webllm.CreateMLCEngine(selectedModel, {
      initProgressCallback: (progress) => {
        const pct = Math.round((progress.progress || 0) * 100);
        progressFill.style.width = `${pct}%`;
        progressLabel.textContent = progress.text || `Lädt… ${pct}%`;
      }
    });

    // Success — show chat UI
    currentTag.textContent = selectedModel;
    setStatus("ready", "Bereit");
    loadScreen.style.display = "none";
    chatArea.style.display = "flex";
    inputArea.style.display = "block";

    // Start a fresh chat
    newChat();
    userInput.focus();

  } catch (err) {
    console.error("Model load error:", err);
    setStatus("error", "Fehler");
    progressLabel.textContent = `Fehlgeschlagen: ${err.message}`;
    loadModelBtn.disabled = false;
  }
}

// ─── Chat Management ─────────────────────────────────────────────────────────
function newChat() {
  currentChatId = `chat_${Date.now()}`;
  currentMessages = [];
  chats[currentChatId] = { title: "Neuer Chat", messages: [] };
  saveHistory();
  renderHistory();
  renderMessages();
  showWelcome();
}

function loadChat(id) {
  if (!chats[id]) return;
  currentChatId = id;
  currentMessages = [...chats[id].messages];
  renderMessages();
  // Restore messages to DOM
  messagesEl.innerHTML = "";
  for (const msg of currentMessages) {
    appendMessageEl(msg.role, msg.content, false);
  }
  if (currentMessages.length === 0) showWelcome();
  renderHistory();
}

function showWelcome() {
  messagesEl.innerHTML = `
    <div class="welcome-msg">
      <h2>GSO KI-Chat</h2>
      <p>Dein Modell ist geladen und bereit.<br>Stell beliebige Fragen – dein Gespräch bleibt vollständig privat.</p>
    </div>`;
}

// ─── Messaging ────────────────────────────────────────────────────────────────
async function sendMessage() {
  const text = userInput.value.trim();
  if (!text || !engine || isGenerating) return;

  // Clear welcome message if present
  if (messagesEl.querySelector(".welcome-msg")) messagesEl.innerHTML = "";

  userInput.value = "";
  autoResize();
  charCount.textContent = "0 / 4000";
  sendBtn.disabled = true;

  // Add user message
  currentMessages.push({ role: "user", content: text });
  appendMessageEl("user", text, true);
  updateChatTitle(text);
  saveHistory();

  // Add assistant placeholder
  const assistantEl = appendMessageEl("assistant", "", false);
  const bubble = assistantEl.querySelector(".bubble");

  isGenerating = true;
  stopBtn.style.display = "flex";
  abortController = new AbortController();

  let fullResponse = "";

  try {
    const stream = await engine.chat.completions.create({
      messages: currentMessages,
      stream: true,
      temperature: 0.7,
      max_tokens: 2048,
    });

    // Show typing cursor
    const cursor = document.createElement("span");
    cursor.className = "typing-cursor";
    bubble.appendChild(cursor);

    for await (const chunk of stream) {
      if (abortController.signal.aborted) break;
      const delta = chunk.choices[0]?.delta?.content || "";
      fullResponse += delta;
      // Remove cursor, update content, re-add cursor
      cursor.remove();
      bubble.innerHTML = formatMarkdown(fullResponse);
      bubble.appendChild(cursor);
      scrollToBottom();
    }

    // Remove cursor, finalize
    cursor.remove();
    bubble.innerHTML = formatMarkdown(fullResponse);
    addCodeCopyButtons(bubble);

  } catch (err) {
    if (!abortController.signal.aborted) {
      bubble.innerHTML = `<span style="color:var(--red)">Fehler: ${err.message}</span>`;
    }
    fullResponse = fullResponse || "[Generierung gestoppt]";
  }

  // Save assistant reply
  currentMessages.push({ role: "assistant", content: fullResponse });
  chats[currentChatId].messages = [...currentMessages];
  saveHistory();

  isGenerating = false;
  stopBtn.style.display = "none";
  sendBtn.disabled = !userInput.value.trim();
  scrollToBottom();
}

function stopGeneration() {
  if (abortController) abortController.abort();
}

// ─── DOM Helpers ──────────────────────────────────────────────────────────────
function appendMessageEl(role, content, animate) {
  const msg = document.createElement("div");
  msg.className = `message ${role}`;
  if (!animate) msg.style.animation = "none";

  const avatarLabel = role === "user" ? "U" : "N";
  const contentHtml = content ? formatMarkdown(content) : "";

  msg.innerHTML = `
    <div class="avatar">${avatarLabel}</div>
    <div class="bubble">${contentHtml}</div>`;

  messagesEl.appendChild(msg);
  scrollToBottom();
  return msg;
}

function scrollToBottom() {
  chatArea.scrollTop = chatArea.scrollHeight;
}

// ─── Markdown Formatter ───────────────────────────────────────────────────────
function formatMarkdown(text) {
  // Escape HTML
  let out = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Code blocks (```)
  out = out.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    return `<pre><code class="lang-${lang}">${code.trim()}</code></pre>`;
  });

  // Inline code
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Headings
  out = out.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  out = out.replace(/^## (.+)$/gm, "<h2>$1</h2>");
  out = out.replace(/^# (.+)$/gm, "<h1>$1</h1>");

  // Bold & italic
  out = out.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  out = out.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/\*(.+?)\*/g, "<em>$1</em>");

  // Blockquotes
  out = out.replace(/^> (.+)$/gm, "<blockquote>$1</blockquote>");

  // Horizontal rule
  out = out.replace(/^---$/gm, "<hr />");

  // Unordered lists
  out = out.replace(/^[\*\-] (.+)$/gm, "<li>$1</li>");
  out = out.replace(/(<li>[\s\S]+?<\/li>)/g, "<ul>$1</ul>");

  // Ordered lists
  out = out.replace(/^\d+\. (.+)$/gm, "<li>$1</li>");

  // Paragraphs (double newlines)
  out = out.split(/\n\n+/).map(para => {
    para = para.trim();
    if (!para) return "";
    if (/^<(h[123]|ul|ol|pre|blockquote|hr)/.test(para)) return para;
    return `<p>${para.replace(/\n/g, "<br/>")}</p>`;
  }).join("\n");

  return out;
}

function addCodeCopyButtons(container) {
  container.querySelectorAll("pre").forEach(pre => {
    if (pre.querySelector(".kopieren-code-btn")) return;
    const btn = document.createElement("button");
    btn.className = "kopieren-code-btn";
    btn.textContent = "kopieren";
    btn.onclick = () => {
      navigator.clipboard.writeText(pre.querySelector("code")?.textContent || "");
      btn.textContent = "kopiert!";
      setTimeout(() => btn.textContent = "kopieren", 2000);
    };
    pre.style.position = "relative";
    pre.appendChild(btn);
  });
}

// ─── History Persistence ──────────────────────────────────────────────────────
function saveHistory() {
  try {
    localStorage.setItem("neuron_chats", JSON.stringify(chats));
    localStorage.setItem("neuron_current", currentChatId);
  } catch (_) {}
}

function loadHistory() {
  try {
    const saved = localStorage.getItem("neuron_chats");
    if (saved) chats = JSON.parse(saved);
    const last = localStorage.getItem("neuron_current");
    if (last && chats[last]) currentChatId = last;
  } catch (_) {}
}

function renderHistory() {
  const entries = Object.entries(chats).reverse();
  if (entries.length === 0) {
    historyEl.innerHTML = `<div class="history-empty">Noch keine Chats</div>`;
    return;
  }
  historyEl.innerHTML = entries.map(([id, chat]) => `
    <div class="history-item ${id === currentChatId ? "active" : ""}" data-id="${id}">
      ${escapeHtml(chat.title)}
    </div>`).join("");

  historyEl.querySelectorAll(".history-item").forEach(el => {
    el.addEventListener("click", () => {
      if (engine) loadChat(el.dataset.id);
    });
  });
}

function updateChatTitle(text) {
  if (!chats[currentChatId]) return;
  const title = text.length > 38 ? text.slice(0, 38) + "…" : text;
  chats[currentChatId].title = title;
  renderHistory();
}

function escapeHtml(str) {
  return str.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

// ─── Model Selection ──────────────────────────────────────────────────────────
function renderMessages() {
  messagesEl.innerHTML = "";
}

$("model-selector").querySelectorAll(".model-option").forEach(opt => {
  opt.addEventListener("click", () => {
    if (engine) return; // model already loaded — don't allow switch mid-session
    $("model-selector").querySelectorAll(".model-option").forEach(o => o.classList.remove("active"));
    opt.classList.add("active");
    selectedModel = opt.dataset.model;
  });
});

// ─── Auto-resize textarea ─────────────────────────────────────────────────────
function autoResize() {
  userInput.style.height = "auto";
  userInput.style.height = Math.min(userInput.scrollHeight, 200) + "px";
}

// ─── Event Listeners ──────────────────────────────────────────────────────────
function setupEventListeners() {
  // Load button
  loadModelBtn.addEventListener("click", loadModel);

  // Send on Enter (Shift+Enter = newline)
  userInput.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!sendBtn.disabled) sendMessage();
    }
  });

  userInput.addEventListener("input", () => {
    autoResize();
    const len = userInput.value.length;
    charCount.textContent = `${len} / 4000`;
    sendBtn.disabled = !userInput.value.trim() || isGenerating;
  });

  // Send button
  sendBtn.addEventListener("click", sendMessage);

  // Stop
  stopBtn.addEventListener("click", stopGeneration);

  // New chat
  $("new-chat-btn").addEventListener("click", () => {
    if (engine) newChat();
  });

  // Clear button
  $("clear-btn").addEventListener("click", () => {
    if (!engine) return;
    currentMessages = [];
    if (chats[currentChatId]) chats[currentChatId].messages = [];
    saveHistory();
    messagesEl.innerHTML = "";
    showWelcome();
  });

  // Sidebar toggle
  $("sidebar-toggle").addEventListener("click", () => {
    sidebar.classList.toggle("collapsed");
    sidebar.classList.toggle("open");
  });
}