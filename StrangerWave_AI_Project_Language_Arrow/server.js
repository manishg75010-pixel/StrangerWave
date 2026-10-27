const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const SEARCH_TIMEOUT = 30_000;
const BOT_REPLY_DELAY = 600;

app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

const waitingUsers = new Set();
const partners = new Map();
const searchTimers = new Map();
const botTimers = new Map();

let nextUserNumber = 1;

function cleanName(value) {
  if (typeof value !== "string") return "";
  return value.replace(/[<>]/g, "").trim().slice(0, 24);
}

function broadcastOnlineCount() {
  io.emit("online-count", io.engine.clientsCount);
}

function clearSearchTimer(id) {
  const timer = searchTimers.get(id);
  if (timer) clearTimeout(timer);
  searchTimers.delete(id);
}

function clearBotTimer(id) {
  const timer = botTimers.get(id);
  if (timer) clearTimeout(timer);
  botTimers.delete(id);
}

function removeFromWaiting(id) {
  waitingUsers.delete(id);
  clearSearchTimer(id);
}

function endBotChat(socket) {
  clearBotTimer(socket.id);
  socket.data.botMode = false;
  socket.data.botReplyIndex = 0;
}

function disconnectPartner(socket, notifyPartner = true) {
  const partnerId = partners.get(socket.id);
  if (!partnerId) return;

  partners.delete(socket.id);
  partners.delete(partnerId);

  const partner = io.sockets.sockets.get(partnerId);

  if (partner) {
    endBotChat(partner);
    partner.emit("partner-left");
    partner.emit("status", "Stranger disconnected.");
  }

  if (notifyPartner) socket.emit("partner-left");
}

function getBotReply(message, socket) {
  const text = message.toLowerCase().trim();
  const clean = text.replace(/[^\p{L}\p{N}\s]/gu, "");

  if (/\b(hi|hello|hey|hii|namaste|नमस्ते|हेलो)\b/.test(clean))
    return "Hey! 😊 How are you doing today?";

  if (/\bhow are you\b|\bhow r u\b|\bhow about you\b/.test(clean))
    return "I'm doing well, thanks for asking! 😊 What are you up to?";

  if (/\byour name\b|\bwho are you\b|\bare you real\b/.test(clean))
    return "I'm StrangerWave's virtual companion, not a real person. 😊";

  if (/\bwhere are you from\b|\bwhere do you live\b/.test(clean))
    return "I'm a virtual companion, so I don't have a physical hometown. Where are you from?";

  if (/\bwhat do you like\b|\byour hobbies\b|\bhobby\b/.test(clean))
    return "I enjoy friendly conversations! What do you like doing in your free time?";

  if (/\bsad\b|\bupset\b|\blonely\b|\bbad day\b/.test(clean))
    return "I'm sorry you're feeling that way. 💙 Want to tell me a little more about it?";

  if (/\bjoke\b|\bmake me laugh\b/.test(clean))
    return "Why did the computer go to the doctor? It had a virus! 😄";

  if (/\bthank you\b|\bthanks\b/.test(clean))
    return "You're welcome! 😊 What else would you like to talk about?";

  if (/\bbye\b|\bgoodbye\b|\bsee you\b/.test(clean))
    return "It was nice chatting with you! 👋 Press Next Stranger whenever you want to start again.";

  if (/\b(age|old are you)\b/.test(clean))
    return "I don't have a human age because I'm a virtual companion. 😊";

  const replies = [
    "That's interesting! Tell me a little more. 😊",
    "I see! What made you think about that?",
    "Really? I'd like to hear more about it.",
    "Nice! What else is on your mind?",
    "Interesting point. How has your day been so far?"
  ];

  const index = socket.data.botReplyIndex || 0;
  socket.data.botReplyIndex = index + 1;
  return replies[index % replies.length];
}

function startBotChat(socket) {
  if (!socket.connected) return;

  removeFromWaiting(socket.id);

  if (partners.has(socket.id)) disconnectPartner(socket, false);

  socket.data.botMode = true;
  socket.data.botReplyIndex = 0;

  socket.emit("matched");
  socket.emit(
    "status",
    "No stranger found in 30 seconds. Your free virtual companion is ready."
  );
  socket.emit(
    "chat-message",
    {
      id: `bot-welcome-${Date.now()}`,
      text: "Hi! 👋 I'm StrangerWave's free virtual companion, not a real person. What would you like to talk about?",
      senderName: "StrangerWave Bot"
    }
  );
}

function findStranger(socket, profile = {}) {
  removeFromWaiting(socket.id);
  clearBotTimer(socket.id);
  disconnectPartner(socket);
  endBotChat(socket);

  socket.data.profile = {
    ageRange: String(profile.ageRange || ""),
    gender: String(profile.gender || "")
  };

  for (const waitingId of waitingUsers) {
    const waitingSocket = io.sockets.sockets.get(waitingId);

    if (!waitingSocket || waitingId === socket.id) {
      removeFromWaiting(waitingId);
      continue;
    }

    if (partners.has(waitingId) || waitingSocket.data.botMode) {
      removeFromWaiting(waitingId);
      continue;
    }

    removeFromWaiting(waitingId);

    partners.set(socket.id, waitingId);
    partners.set(waitingId, socket.id);

    socket.data.botMode = false;
    waitingSocket.data.botMode = false;

    socket.emit("matched", { partnerName: waitingSocket.data.displayName });
    waitingSocket.emit("matched", { partnerName: socket.data.displayName });

    socket.emit("status", "Connected to a stranger!");
    waitingSocket.emit("status", "Connected to a stranger!");
    return;
  }

  waitingUsers.add(socket.id);
  socket.emit("status", "Searching for a stranger…");

  const timer = setTimeout(() => {
    searchTimers.delete(socket.id);
    if (waitingUsers.has(socket.id)) startBotChat(socket);
  }, SEARCH_TIMEOUT);

  searchTimers.set(socket.id, timer);
}

io.on("connection", (socket) => {
  socket.data.botMode = false;
  socket.data.botReplyIndex = 0;
  socket.data.displayName = `User ${nextUserNumber++}`;

  socket.emit("your-name", socket.data.displayName);
  socket.emit("status", "Ready to chat. Press Find Stranger.");
  broadcastOnlineCount();

  socket.on("set-name", (value, callback) => {
    const name = cleanName(value);
    if (!name) {
      if (typeof callback === "function")
        callback({ ok: false, error: "Please enter a valid name." });
      return;
    }

    socket.data.displayName = name;

    if (typeof callback === "function") callback({ ok: true, name });
  });

  socket.on("find-stranger", (profile) => {
    findStranger(socket, profile || {});
  });

  socket.on("next-stranger", (profile) => {
    findStranger(socket, profile || {});
  });

  socket.on("chat-message", (message) => {
    if (!message || typeof message !== "object") return;

    const id = String(message.id || "").slice(0, 100);
    const text = typeof message.text === "string" ? message.text.trim() : "";

    if (!id || !text || text.length > 1000) return;

    if (socket.data.botMode) {
      socket.emit("message-status", { id, status: "sent" });

      clearBotTimer(socket.id);

      const timer = setTimeout(() => {
        botTimers.delete(socket.id);

        if (socket.connected && socket.data.botMode) {
          socket.emit("chat-message", {
            id: `bot-${Date.now()}`,
            text: getBotReply(text, socket),
            senderName: "StrangerWave Bot"
          });
        }
      }, BOT_REPLY_DELAY);

      botTimers.set(socket.id, timer);
      return;
    }

    const partnerId = partners.get(socket.id);
    if (!partnerId) {
      socket.emit("message-status", { id, status: "failed" });
      return;
    }

    const partner = io.sockets.sockets.get(partnerId);

    if (!partner || !partner.connected) {
      disconnectPartner(socket, false);
      socket.emit("message-status", { id, status: "failed" });
      socket.emit("partner-left");
      socket.emit("status", "Stranger disconnected. Find someone new.");
      return;
    }

    partner.emit("chat-message", {
      id,
      text,
      senderName: socket.data.displayName,
      senderId: socket.id
    });

    socket.emit("message-status", { id, status: "sent" });
  });

  socket.on("message-seen", (messageId) => {
    if (typeof messageId !== "string") return;

    const partnerId = partners.get(socket.id);
    if (!partnerId) return;

    const partner = io.sockets.sockets.get(partnerId);
    if (partner && partner.connected) {
      partner.emit("message-status", {
        id: messageId.slice(0, 100),
        status: "seen"
      });
    }
  });

  socket.on("disconnect-stranger", () => {
    removeFromWaiting(socket.id);
    clearBotTimer(socket.id);
    disconnectPartner(socket);
    endBotChat(socket);
    socket.emit("status", "Disconnected. Press Find Stranger to chat again.");
  });

  socket.on("disconnect", () => {
    removeFromWaiting(socket.id);
    clearBotTimer(socket.id);
    disconnectPartner(socket);
    endBotChat(socket);
    broadcastOnlineCount();
  });
});

server.listen(PORT, () => {
  console.log(`StrangerWave server running on port ${PORT}`);
});
