
const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (_req, res) => {
  res.json({ ok: true, app: "StrangerWave" });
});

const waitingUsers = [];
const partnerBySocket = new Map();

const AGE_RANGES = ["18-24", "25-34", "35-44", "45-54", "55+"];

const GENDERS = [
  "man",
  "woman",
  "non-binary",
  "prefer-not-to-say"
];

function cleanPreferences(options = {}) {
  const ageRange = AGE_RANGES.includes(options.ageRange)
    ? options.ageRange
    : "18-24";

  const gender = GENDERS.includes(options.gender)
    ? options.gender
    : "prefer-not-to-say";

  const preferredAgeRange =
    options.preferredAgeRange === "any" ||
    AGE_RANGES.includes(options.preferredAgeRange)
      ? options.preferredAgeRange
      : "any";

  const preferredGender = [
    "any",
    ...GENDERS
  ].includes(options.preferredGender)
    ? options.preferredGender
    : "any";

  return {
    ageRange,
    gender,
    preferredAgeRange,
    preferredGender
  };
}

function acceptsPreference(preferences, other) {
  const ageMatches =
    preferences.preferredAgeRange === "any" ||
    preferences.preferredAgeRange === other.ageRange;

  const genderMatches =
    preferences.preferredGender === "any" ||
    preferences.preferredGender === other.gender;

  return ageMatches && genderMatches;
}

function canMatch(userA, userB) {
  return (
    acceptsPreference(userA, userB) &&
    acceptsPreference(userB, userA)
  );
}

function sendStatus(socket, message) {
  if (socket && socket.connected) {
    socket.emit("status", message);
  }
}

function removeFromWaiting(socketId) {
  const index = waitingUsers.indexOf(socketId);

  if (index !== -1) {
    waitingUsers.splice(index, 1);
  }
}

function unpair(socket, notifyPartner = true) {
  removeFromWaiting(socket.id);

  const partnerId = partnerBySocket.get(socket.id);
  if (!partnerId) return;

  partnerBySocket.delete(socket.id);
  partnerBySocket.delete(partnerId);

  const partner = io.sockets.sockets.get(partnerId);

  if (partner && partner.connected) {
    if (notifyPartner) {
      partner.emit("partner-left");
      sendStatus(partner, "Your stranger disconnected.");
    }
  }
}

function findStranger(socket, options = {}) {
  unpair(socket, true);
  removeFromWaiting(socket.id);

  socket.data.preferences = cleanPreferences(options);

  for (let i = 0; i < waitingUsers.length; i++) {
    const otherId = waitingUsers[i];
    const other = io.sockets.sockets.get(otherId);

    if (!other || !other.connected) {
      waitingUsers.splice(i, 1);
      i--;
      continue;
    }

    if (other.id === socket.id) continue;

    const myPreferences = socket.data.preferences;
    const theirPreferences =
      other.data.preferences || cleanPreferences();

    if (!canMatch(myPreferences, theirPreferences)) {
      continue;
    }

    waitingUsers.splice(i, 1);

    partnerBySocket.set(socket.id, other.id);
    partnerBySocket.set(other.id, socket.id);

    socket.emit("matched");
    other.emit("matched");

    sendStatus(socket, "Stranger connected. Say hello!");
    sendStatus(other, "Stranger connected. Say hello!");

    return;
  }

  waitingUsers.push(socket.id);

  sendStatus(
    socket,
    "Searching for a compatible stranger… Keep this page open."
  );
}

io.on("connection", (socket) => {
  socket.on("find-stranger", (options) => {
    findStranger(socket, options || {});
  });

  socket.on("chat-message", (message) => {
    const partnerId = partnerBySocket.get(socket.id);
    const text = String(message || "").trim().slice(0, 1000);

    if (!partnerId || !text) return;

    const partner = io.sockets.sockets.get(partnerId);

    if (partner && partner.connected) {
      partner.emit("chat-message", text);
    }
  });

  socket.on("next-stranger", (options) => {
    unpair(socket, true);
    findStranger(socket, options || socket.data.preferences || {});
  });

  socket.on("disconnect-stranger", () => {
    unpair(socket, true);

    sendStatus(
      socket,
      "Disconnected. Press Find Stranger to start again."
    );
  });

  socket.on("disconnect", () => {
    unpair(socket, true);
  });
});

server.listen(PORT, () => {
  console.log(`StrangerWave is running on port ${PORT}`);
});
