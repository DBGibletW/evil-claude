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

const CLAUDE_LOGO = "https://i.imgur.com/obAoU6e.png"; // DÜZELTİLDİ
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
}

async function loadChat(chatId) {
  if (isGenerating) return;
  currentChatId = chatId; chat.innerHTML = ""; welcome.classList.add("hidden");
  const msgSnap = await getDocs(collection(db, "chats", chatId, "messages"));
  const msgs = [];
  msgSnap.forEach((d) => msgs.push(d.data()));
  msgs.sort((a, b) => (a.timestamp?.seconds || 0) - (b.timestamp?.seconds || 0));
  msgs.forEach((m) => addMessage(m.role, m.text));
}

async function sendMessage() {
  const text = promptInput.value.trim();
  if (!text || !currentUser || isGenerating) return;

  isGenerating = true; welcome.classList.add("hidden"); promptInput.value = ""; sendBtn.classList.remove("visible");
  addMessage("user", text);

  if (!currentChatId) {
    const docRef = await addDoc(collection(db, "chats"), { uid: currentUser.uid, title: text.slice(0, 40), createdAt: serverTimestamp() });
    currentChatId = docRef.id;
  }

  // Yeni mesajı eklemeden önce geçmişi kronolojik olarak al
  const historySnap = await getDocs(collection(db, "chats", currentChatId, "messages"));
  const history = [];
  historySnap.forEach((d) => history.push(d.data()));
  history.sort((a, b) => (a.timestamp?.seconds || 0) - (b.timestamp?.seconds || 0));

  await addDoc(collection(db, "chats", currentChatId, "messages"), { role: "user", text, timestamp: serverTimestamp() });

  const aiMsgEl = document.createElement("div");
  aiMsgEl.className = "chat__msg chat__msg--ai";
  aiMsgEl.innerHTML = `
    <img src="${CLAUDE_LOGO}" class="chat-logo" alt="Claude">
    <div class="chat__bubble"><div class="row"><div class="body"><span class="shim">Düşünüyor...</span></div></div></div>
  `;
  chat.appendChild(aiMsgEl); scrollToBottom();

  try {
    const response = await fetch("/api/chat", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, history: history })
    });

    if (!response.ok) {
      const errJson = await response.json().catch(() => ({}));
      throw new Error(errJson.error || "Sunucu hatası: " + response.status);
    }

    const reader = response.body.getReader(); const decoder = new TextDecoder();
    let buffer = "", fullText = "";
    const bodyDiv = aiMsgEl.querySelector(".body");
    let answerP = document.createElement("p"); answerP.className = "answer";
    bodyDiv.innerHTML = ""; bodyDiv.appendChild(answerP);

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
              answerP.innerHTML = fullText.replace(/\n/g, "<br>") + '<span class="caret"></span>';
              scrollToBottom();
            }
          } catch (e) {}
        }
      }
    }
    answerP.innerHTML = fullText.replace(/\n/g, "<br>");
    if (fullText.trim()) {
      await addDoc(collection(db, "chats", currentChatId, "messages"), { role: "ai", text: fullText, timestamp: serverTimestamp() });
    }
  } catch (err) {
    aiMsgEl.querySelector(".chat__bubble").innerHTML = `<span style="color:#d97757">HATA: ${err.message}</span>`;
  } finally { isGenerating = false; }
}

function addMessage(role, text) {
  const msg = document.createElement("div");
  msg.className = `chat__msg chat__msg--${role === "user" ? "user" : "ai"}`;
  if (role === "user") { msg.innerHTML = `<div class="chat__bubble">${text}</div>`; }
  else {
    msg.innerHTML = `<img src="${CLAUDE_LOGO}" class="chat-logo" alt="Claude"><div class="chat__bubble"><p class="answer">${text.replace(/\n/g, "<br>")}</p></div>`;
  }
  chat.appendChild(msg); scrollToBottom();
}
