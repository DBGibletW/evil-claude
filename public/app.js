import { auth, db } from "./firebase.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { collection, addDoc, getDocs, query, where, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const chat = document.getElementById("chat");
const welcome = document.getElementById("welcome");
const welcomeTitle = document.getElementById("welcomeTitle");
const promptInput = document.getElementById("promptInput");
const sendBtn = document.getElementById("sendBtn");
const sidebar = document.getElementById("sidebar");
const menuBtn = document.getElementById("menuBtn");
const sidebarClose = document.getElementById("sidebarClose");
const newChatBtn = document.getElementById("newChatBtn");
const logoutBtn = document.getElementById("logoutBtn");
const chatList = document.getElementById("chatList");
const userName = document.getElementById("userName");
const main = document.querySelector(".main");

const CLAUDE_LOGO = "https://i.imgur.com/obAoU6e.png";
let currentUser = null, currentChatId = null, isGenerating = false;

function scrollToBottom() { main.scrollTop = main.scrollHeight; }

onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "/login"; return; }
  currentUser = user;
  userName.textContent = user.displayName || user.email.split("@")[0];
  welcomeTitle.textContent = `İyi günler, ${user.displayName || "Duck"}`;
  await loadChats();
});

menuBtn.addEventListener("click", () => sidebar.classList.add("open"));
sidebarClose.addEventListener("click", () => sidebar.classList.remove("open"));
logoutBtn.addEventListener("click", async () => { await signOut(auth); window.location.href = "/login"; });

newChatBtn.addEventListener("click", () => {
  if (isGenerating) return;
  currentChatId = null; chat.innerHTML = ""; welcome.classList.remove("hidden");
  promptInput.value = ""; loadChats();
});

promptInput.addEventListener("input", () => sendBtn.classList.toggle("visible", promptInput.value.trim().length > 0));
promptInput.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if(!isGenerating) sendMessage(); } });
sendBtn.addEventListener("click", () => { if(!isGenerating) sendMessage(); });

async function loadChats() {
  chatList.innerHTML = "";
  try {
    const q = query(collection(db, "chats"), where("uid", "==", currentUser.uid));
    const snap = await getDocs(q);
    snap.forEach((d) => {
      const c = d.data();
      const item = document.createElement("div");
      item.className = "sidebar__recent-item";
      item.innerHTML = `<span>${c.title || "Yeni sohbet"}</span>`;
      item.addEventListener("click", () => loadChat(d.id));
      chatList.appendChild(item);
    });
  } catch(e) {}
}

async function loadChat(chatId) {
  if (isGenerating) return;
  currentChatId = chatId; chat.innerHTML = ""; welcome.classList.add("hidden");
  try {
    const msgSnap = await getDocs(collection(db, "chats", chatId, "messages"));
    const msgs = [];
    msgSnap.forEach((d) => msgs.push(d.data()));
    msgs.sort((a, b) => (a.timestamp?.seconds || 0) - (b.timestamp?.seconds || 0));
    msgs.forEach((m) => addMessage(m.role, m.text));
  } catch(e) {}
}

async function sendMessage() {
  const text = promptInput.value.trim();
  if (!text || !currentUser || isGenerating) return;

  isGenerating = true; welcome.classList.add("hidden"); promptInput.value = ""; sendBtn.classList.remove("visible");
  addMessage("user", text);

  try {
    if (!currentChatId) {
      const docRef = await addDoc(collection(db, "chats"), { uid: currentUser.uid, title: text.slice(0, 40), createdAt: serverTimestamp() });
      currentChatId = docRef.id;
    }
  } catch (dbErr) {}

  const aiMsgEl = document.createElement("div");
  aiMsgEl.className = "chat__msg chat__msg--ai";
  aiMsgEl.innerHTML = `
    <img src="${CLAUDE_LOGO}" class="chat-logo" alt="Claude">
    <div class="chat__bubble"><div class="row"><div class="body"><span class="shim">Düşünüyor...</span></div></div></div>
  `;
  chat.appendChild(aiMsgEl); scrollToBottom();

  try {
    const history = [];
    if (currentChatId) {
      try {
        const historySnap = await getDocs(collection(db, "chats", currentChatId, "messages"));
        historySnap.forEach((d) => history.push(d.data()));
        history.sort((a, b) => (a.timestamp?.seconds || 0) - (b.timestamp?.seconds || 0));
        await addDoc(collection(db, "chats", currentChatId, "messages"), { role: "user", text, timestamp: serverTimestamp() });
      } catch (dbErr) {}
    }

    const response = await fetch("/api/chat", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, history: history })
    });

    if (!response.ok) throw new Error("Sunucu hatası");

    const reader = response.body.getReader(); const decoder = new TextDecoder();
    let buffer = "", fullText = "";
    const bodyDiv = aiMsgEl.querySelector(".body");
    let answerDiv = document.createElement("div"); answerDiv.className = "answer";
    bodyDiv.innerHTML = ""; bodyDiv.appendChild(answerDiv);

    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n"); buffer = lines.pop();
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6).trim(); if (data === "[DONE]") continue;
          try {
            const parsed = JSON.parse(data);
            if (parsed.text) {
              fullText += parsed.text;
              answerDiv.innerHTML = formatText(fullText) + '<span class="caret"></span>';
              scrollToBottom();
            }
          } catch (e) {}
        }
      }
    }
    answerDiv.innerHTML = formatText(fullText);
    
    if (fullText.trim() && currentChatId) {
      await addDoc(collection(db, "chats", currentChatId, "messages"), { role: "ai", text: fullText, timestamp: serverTimestamp() }).catch(() => {});
    }
    
  } catch (err) {
    aiMsgEl.querySelector(".chat__bubble").innerHTML = `<span style="color:#d97757">HATA: ${err.message}</span>`;
  } finally { isGenerating = false; }
}

// MARKDOWN FORMATLAYICI
function formatText(text) {
  let html = text;

  // Kod Blokları ve Kopyalama Butonu
  html = html.replace(/```([\s\S]*?)```/g, (match, code) => {
    const cleanCode = code.replace(/^[a-zA-Z0-9]+\n/, '');
    const escapedCode = escapeHtml(cleanCode.trim());
    return `
      <div class="code-block-wrapper">
        <div class="code-block-header">
          <span>Kod</span>
          <button class="copy-code-btn" onclick="copyCode(this)"><i class='bx bx-copy'></i> Kopyala</button>
        </div>
        <pre><code>${escapedCode}</code></pre>
      </div>
    `;
  });

  // Tablolar
  html = html.replace(/((?:^\|.+\|\s*$\n?)+)/gm, (tableBlock) => {
    const lines = tableBlock.trim().split("\n").filter(l => l.trim());
    if (lines.length < 2) return tableBlock;
    const headerLine = lines[0];
    const separatorLine = lines[1];
    if (!/^\|[\s\-:|]+\|$/.test(separatorLine.trim())) return tableBlock;

    const headers = headerLine.split("|").slice(1, -1).map(h => h.trim());
    const rows = lines.slice(2).map(l => l.split("|").slice(1, -1).map(c => c.trim()));

    let table = "<table><thead><tr>";
    headers.forEach(h => table += `<th>${h}</th>`);
    table += "</tr></thead><tbody>";
    rows.forEach(row => {
      table += "<tr>";
      row.forEach(c => table += `<td>${c}</td>`);
      table += "</tr>";
    });
    table += "</tbody></table>";
    return table;
  });

  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<em>$1</em>");
  html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
  html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
  html = html.replace(/^\s*[-*] (.+)$/gm, "<li>$1</li>");
  html = html.replace(/(<li>.*<\/li>)/s, "<ul>$1</ul>");
  html = html.replace(/^\s*\d+\. (.+)$/gm, "<li>$1</li>");

  html = html.replace(/\n/g, "<br>");
  html = html.replace(/<\/table><br>/g, "</table>");
  html = html.replace(/<br><table>/g, "<table>");
  html = html.replace(/<\/pre><br>/g, "</pre>");
  html = html.replace(/<br><pre>/g, "<pre>");
  html = html.replace(/<\/div><br>/g, "</div>");
  html = html.replace(/<br><div class="code-block-wrapper">/g, '<div class="code-block-wrapper">');

  return html;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// Global Kopyalama Fonksiyonu
window.copyCode = function(btn) {
  let code = btn.closest('.code-block-wrapper').querySelector('code').innerText;
  code = code.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  navigator.clipboard.writeText(code).then(() => {
    btn.innerHTML = `<i class='bx bx-check'></i> Kopyalandı`;
    setTimeout(() => { btn.innerHTML = `<i class='bx bx-copy'></i> Kopyala`; }, 2000);
  });
};

function addMessage(role, text) {
  const msg = document.createElement("div");
  msg.className = `chat__msg chat__msg--${role === "user" ? "user" : "ai"}`;
  if (role === "user") { msg.innerHTML = `<div class="chat__bubble">${text}</div>`; }
  else {
    msg.innerHTML = `<img src="${CLAUDE_LOGO}" class="chat-logo" alt="Claude"><div class="chat__bubble"><div class="answer">${formatText(text)}</div></div>`;
  }
  chat.appendChild(msg); scrollToBottom();
}
