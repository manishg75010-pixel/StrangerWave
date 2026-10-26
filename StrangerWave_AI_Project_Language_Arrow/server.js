const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));
app.get("/health", (_req, res) => res.json({ ok: true, app: "StrangerWave" }));

let waitingSocketId = null;
const partnerBySocket = new Map();

function sendStatus(socket, message) {
  if (socket && socket.connected) socket.emit("status", message);
}

function unpair(socket, notifyPartner = true) {
  if (waitingSocketId === socket.id) waitingSocketId = null;
  const partnerId = partnerBySocket.get(socket.id);
  if (!partnerId) return;
  partnerBySocket.delete(socket.id);
  partnerBySocket.delete(partnerId);
  const partner = io.sockets.sockets.get(partnerId);
  if (partner) {
    if (notifyPartner) partner.emit("partner-left");
    sendStatus(partner, "Your stranger disconnected.");
  }
}

function findStranger(socket) {
  unpair(socket, true);
  if (waitingSocketId && waitingSocketId !== socket.id) {
    const other = io.sockets.sockets.get(waitingSocketId);
    waitingSocketId = null;
    if (other && other.connected) {
      partnerBySocket.set(socket.id, other.id);
      partnerBySocket.set(other.id, socket.id);
      socket.emit("matched");
      other.emit("matched");
      sendStatus(socket, "Stranger connected. Say hello!");
      sendStatus(other, "Stranger connected. Say hello!");
      return;
    }
  }
  waitingSocketId = socket.id;
  sendStatus(socket, "Searching for a stranger… Keep this page open.");
}

io.on("connection", (socket) => {
  socket.on("find-stranger", () => findStranger(socket));

  socket.on("chat-message", (message) => {
    const partnerId = partnerBySocket.get(socket.id);
    const text = String(message || "").trim().slice(0, 1000);
    if (!partnerId || !text) return;
    const partner = io.sockets.sockets.get(partnerId);
    if (partner && partner.connected) partner.emit("chat-message", text);
  });

  socket.on("next-stranger", () => {
    unpair(socket, true);
    findStranger(socket);
  });

  socket.on("disconnect-stranger", () => {
    unpair(socket, true);
    sendStatus(socket, "Disconnected. Press Find Stranger to start again.");
  });

  socket.on("disconnect", () => unpair(socket, true));
});

server.listen(PORT, () => {
  console.log(`StrangerWave is running at http://localhost:${PORT}`);
});