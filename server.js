import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.post("/api/chat", async (req, res) => {
  console.log("1. İstek geldi");
  const { message, history } = req.body;
  if (!message) return res.status(400).json({ error: "Mesaj yok" });

  const messages = [
    { role: "system", content: "You are a helpful AI assistant." }
  ];

  if (history && Array.isArray(history)) {
    history.forEach((m) => messages.push({ role: m.role === "user" ? "user" : "assistant", content: m.text }));
  }
  messages.push({ role: "user", content: message });

  try {
    console.log("2. OpenRouter'a istek atılıyor (openrouter/free)...");
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "HTTP-Referer": "https://evil-claude.onrender.com",
        "X-Title": "Evil Claude"
      },
      body: JSON.stringify({
        model: "openrouter/free", // Otomatik model seçici
        messages: messages,
        stream: true
      }),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errData = await response.text();
      console.log("OPENROUTER HATASI:", errData);
      return res.status(response.status).json({ error: "API Hatası: " + errData });
    }

    console.log("3. Bağlantı başarılı, stream başlıyor...");
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6).trim();
          if (data === "[DONE]") {
            res.write("data: [DONE]\n\n");
            continue;
          }
          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              res.write(`data: ${JSON.stringify({ text: delta })}\n\n`);
            }
          } catch (e) {}
        }
      }
    }
    console.log("4. Stream tamamlandı");
    res.end();
  } catch (err) {
    console.log("KRİTİK HATA:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/login", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.get("/app", (req, res) => res.sendFile(path.join(__dirname, "public", "app.html")));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.listen(PORT, () => console.log(`Sunucu çalışıyor: ${PORT}`));
