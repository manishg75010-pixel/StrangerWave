const express = require("express");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const sdk = require("node-appwrite");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 2e6 });
const PORT = process.env.PORT || 3000;
const SEARCH_TIMEOUT = 30_000;
const BOT_REPLY_DELAY = 600;
const SESSION_CLEANUP_DELAY = 120_000;
const HISTORY_DAYS = 7;
const MAX_CONTACTS = 100;
const SESSION_SECRET = process.env.SESSION_SECRET || process.env.APPWRITE_API_KEY || "strangerwave-development-session-secret";

app.use(express.static(path.join(__dirname, "public")));
app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.get("/chat-image/:fileId", async (req, res) => {
  try {
    if (!storage || !/^[a-zA-Z0-9._-]{1,36}$/.test(req.params.fileId)) return res.sendStatus(404);
    const file = await storage.getFileView({ bucketId: process.env.APPWRITE_BUCKET_ID, fileId: req.params.fileId });
    res.set("Cache-Control", "private, max-age=300");
    res.type("image/jpeg").send(Buffer.from(file));
  } catch (_error) { res.sendStatus(404); }
});

const appwriteReady = Boolean(
  process.env.APPWRITE_ENDPOINT && process.env.APPWRITE_PROJECT_ID &&
  process.env.APPWRITE_API_KEY && process.env.APPWRITE_DATABASE_ID &&
  process.env.APPWRITE_USERS_TABLE_ID && process.env.APPWRITE_CHAT_LIST_TABLE_ID &&
  process.env.APPWRITE_MESSAGES_TABLE_ID && process.env.APPWRITE_BUCKET_ID
);
let tablesDB = null;
let storage = null;
if (appwriteReady) {
  const client = new sdk.Client()
    .setEndpoint(process.env.APPWRITE_ENDPOINT)
    .setProject(process.env.APPWRITE_PROJECT_ID)
    .setKey(process.env.APPWRITE_API_KEY);
  tablesDB = new sdk.TablesDB(client);
  storage = new sdk.Storage(client);
} else {
  console.warn("Appwrite is not configured. Persistent chats are disabled.");
}

const DB = process.env.APPWRITE_DATABASE_ID;
const USERS = process.env.APPWRITE_USERS_TABLE_ID;
const CONTACTS = process.env.APPWRITE_CHAT_LIST_TABLE_ID;
const MESSAGES = process.env.APPWRITE_MESSAGES_TABLE_ID;
const BUCKET = process.env.APPWRITE_BUCKET_ID;
const waitingUsers = new Set();
const partners = new Map();
const searchTimers = new Map();
const botTimers = new Map();
const cleanupTimers = new Map();
const sessions = new Map();
const socketUsers = new Map();
let nextUserNumber = 1;

const uniqueId = () => sdk.ID.unique();
function makeSessionToken(userId) {
  const signature = crypto.createHmac("sha256", SESSION_SECRET).update(userId).digest("hex");
  return `${userId}.${signature}`;
}
function readSessionToken(token) {
  if (typeof token !== "string") return "";
  const parts = token.split(".");
  if (parts.length !== 2 || !/^[a-f0-9-]{20,50}$/i.test(parts[0]) || !/^[a-f0-9]{64}$/i.test(parts[1])) return "";
  const expected = crypto.createHmac("sha256", SESSION_SECRET).update(parts[0]).digest("hex");
  const a = Buffer.from(parts[1], "hex"), b = Buffer.from(expected, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? parts[0] : "";
}
const nowISO = () => new Date().toISOString();
const cleanName = (value) => typeof value === "string" ? value.replace(/[<>]/g, "").trim().slice(0, 24) : "";
const safeText = (value, max = 1000) => typeof value === "string" ? value.trim().slice(0, max) : "";
function createConversationId(userA, userB) {
  return crypto.createHash("sha256").update([userA, userB].sort().join(":" )).digest("hex").slice(0, 36);
}
function tableCall(method, args) {
  if (!appwriteReady) return Promise.reject(new Error("Appwrite is not configured"));
  return tablesDB[method](args);
}
async function listAllRows(tableId, queries = []) {
  const rows = [];
  let offset = 0;
  while (true) {
    const result = await tableCall("listRows", { databaseId: DB, tableId, queries: [...queries, sdk.Query.limit(100), sdk.Query.offset(offset)] });
    rows.push(...(result.rows || []));
    if (!result.rows || result.rows.length < 100) break;
    offset += 100;
  }
  return rows;
}
async function findRows(tableId, field, value) {
  return listAllRows(tableId, [sdk.Query.equal(field, [value])]);
}
async function deleteRowSafe(tableId, rowId) {
  try { await tableCall("deleteRow", { databaseId: DB, tableId, rowId }); } catch (error) {
    if (error.code !== 404) console.error(`Could not delete ${tableId} row`, error.message);
  }
}
async function saveMessage({ conversationId, senderId, receiverId, type = "text", text = "", fileId = "" }) {
  if (!appwriteReady) return null;
  const result = await tableCall("createRow", {
    databaseId: DB, tableId: MESSAGES, rowId: uniqueId(),
    data: { conversation_id: conversationId, sender_id: senderId, receiver_id: receiverId,
      message_type: type, message_text: text, image_file_id: fileId, created_at: nowISO() }
  });
  return result;
}
async function getUser(userId) {
  const rows = await findRows(USERS, "user_id", userId);
  return rows[0] || null;
}
async function ensureUser(userId, displayName, sessionId) {
  if (!appwriteReady) return;
  const old = await getUser(userId);
  const data = { user_id: userId, display_name: displayName, is_online: true,
    last_seen: nowISO(), session_id: sessionId, updated_at: nowISO() };
  if (old) await tableCall("updateRow", { databaseId: DB, tableId: USERS, rowId: old.$id, data });
  else await tableCall("createRow", { databaseId: DB, tableId: USERS, rowId: uniqueId(), data: { ...data, created_at: nowISO() } });
}
async function markUserOffline(userId) {
  if (!appwriteReady) return;
  const rows = await findRows(USERS, "user_id", userId);
  for (const row of rows) await tableCall("updateRow", { databaseId: DB, tableId: USERS, rowId: row.$id,
    data: { is_online: false, last_seen: nowISO(), updated_at: nowISO() } });
}
async function upsertContact(ownerId, contactId, contactName, conversationId, lastMessage = "") {
  if (!appwriteReady || ownerId === contactId) return;
  const rows = await findRows(CONTACTS, "owner_id", ownerId);
  const existing = rows.find(row => row.contact_id === contactId);
  const data = { owner_id: ownerId, contact_id: contactId, contact_name: cleanName(contactName) || "Stranger",
    conversation_id: conversationId, last_message: safeText(lastMessage, 300), last_message_at: nowISO(),
    is_online: Boolean(sessions.get(contactId)?.socket?.connected), updated_at: nowISO() };
  if (existing) await tableCall("updateRow", { databaseId: DB, tableId: CONTACTS, rowId: existing.$id, data });
  else {
    if (rows.length >= MAX_CONTACTS) throw new Error("Your Chat List is full (100 contacts maximum).");
    await tableCall("createRow", { databaseId: DB, tableId: CONTACTS, rowId: uniqueId(), data: { ...data, created_at: nowISO() } });
  }
}
async function addContactPair(userA, userB, nameA, nameB, lastMessage = "") {
  const conversationId = createConversationId(userA, userB);
  if (appwriteReady) {
    const [rowsA, rowsB] = await Promise.all([findRows(CONTACTS, "owner_id", userA), findRows(CONTACTS, "owner_id", userB)]);
    if (!rowsA.some(row => row.contact_id === userB) && rowsA.length >= MAX_CONTACTS) throw new Error("Your Chat List is full (100 contacts maximum).");
    if (!rowsB.some(row => row.contact_id === userA) && rowsB.length >= MAX_CONTACTS) throw new Error("The other user's Chat List is full.");
  }
  await Promise.all([
    upsertContact(userA, userB, nameB, conversationId, lastMessage),
    upsertContact(userB, userA, nameA, conversationId, lastMessage)
  ]);
  return conversationId;
}
async function getChatList(userId) {
  if (!appwriteReady) return [];
  const rows = await findRows(CONTACTS, "owner_id", userId);
  return rows.sort((a, b) => new Date(b.last_message_at || b.created_at) - new Date(a.last_message_at || a.created_at))
    .map(row => ({ contactId: row.contact_id, name: row.contact_name, lastMessage: row.last_message || "",
      lastMessageAt: row.last_message_at || row.created_at, isOnline: Boolean(sessions.get(row.contact_id)?.socket?.connected), conversationId: row.conversation_id }));
}
async function sendChatList(userId) {
  const session = sessions.get(userId);
  if (session?.socket?.connected) session.socket.emit("chat-list", await getChatList(userId));
}
async function getHistory(conversationId) {
  if (!appwriteReady) return [];
  const cutoff = new Date(Date.now() - HISTORY_DAYS * 86400000).toISOString();
  const rows = await listAllRows(MESSAGES, [sdk.Query.equal("conversation_id", [conversationId]), sdk.Query.greaterThanEqual("created_at", cutoff)]);
  return rows.sort((a, b) => new Date(a.created_at) - new Date(b.created_at)).map(row => ({
    id: row.$id, senderId: row.sender_id, type: row.message_type, text: row.message_text || "",
    imageUrl: row.image_file_id ? `/chat-image/${row.image_file_id}` : "",
    createdAt: row.created_at
  }));
}
async function deleteConversation(userA, userB) {
  if (!appwriteReady) return;
  const conversationId = createConversationId(userA, userB);
  const rows = await findRows(MESSAGES, "conversation_id", conversationId);
  for (const row of rows) {
    if (row.image_file_id) {
      try { await storage.deleteFile({ bucketId: BUCKET, fileId: row.image_file_id }); } catch (error) { console.error("Image cleanup failed", error.message); }
    }
    await deleteRowSafe(MESSAGES, row.$id);
  }
}
async function removeContactPair(userId, contactId) {
  if (!appwriteReady) throw new Error("Chat storage is not configured yet.");
  await deleteConversation(userId, contactId);
  const [mine, theirs] = await Promise.all([findRows(CONTACTS, "owner_id", userId), findRows(CONTACTS, "owner_id", contactId)]);
  await Promise.all([
    ...mine.filter(row => row.contact_id === contactId).map(row => deleteRowSafe(CONTACTS, row.$id)),
    ...theirs.filter(row => row.contact_id === userId).map(row => deleteRowSafe(CONTACTS, row.$id))
  ]);
  await Promise.all([sendChatList(userId), sendChatList(contactId)]);
}
async function cleanupUser(userId) {
  if (!appwriteReady) return;
  const ownContacts = await findRows(CONTACTS, "owner_id", userId);
  const contactIds = [...new Set(ownContacts.map(row => row.contact_id))];
  for (const contactId of contactIds) {
    await deleteConversation(userId, contactId);
    const otherRows = await findRows(CONTACTS, "owner_id", contactId);
    await Promise.all(otherRows.filter(row => row.contact_id === userId).map(row => deleteRowSafe(CONTACTS, row.$id)));
    await sendChatList(contactId);
  }
  await Promise.all(ownContacts.map(row => deleteRowSafe(CONTACTS, row.$id)));
  const userRows = await findRows(USERS, "user_id", userId);
  await Promise.all(userRows.map(row => deleteRowSafe(USERS, row.$id)));
}
async function pruneOldMessages() {
  if (!appwriteReady) return;
  const cutoff = new Date(Date.now() - HISTORY_DAYS * 86400000).toISOString();
  const oldRows = await listAllRows(MESSAGES, [sdk.Query.lessThan("created_at", cutoff)]);
  for (const row of oldRows) {
    if (row.image_file_id) {
      try { await storage.deleteFile({ bucketId: BUCKET, fileId: row.image_file_id }); } catch (error) { console.error("Old image cleanup failed", error.message); }
    }
    await deleteRowSafe(MESSAGES, row.$id);
  }
}

function broadcastOnlineCount() { io.emit("online-count", io.engine.clientsCount); }
function clearTimer(map, id) { const timer = map.get(id); if (timer) clearTimeout(timer); map.delete(id); }
function removeFromWaiting(id) { waitingUsers.delete(id); clearTimer(searchTimers, id); }
function endBotChat(socket) { clearTimer(botTimers, socket.id); socket.data.botMode = false; socket.data.botReplyIndex = 0; }
function disconnectPartner(socket, notifyPartner = true) {
  const partnerId = partners.get(socket.id);
  if (!partnerId) return;
  partners.delete(socket.id); partners.delete(partnerId);
  const partner = io.sockets.sockets.get(partnerId);
  if (partner) { endBotChat(partner); partner.emit("partner-left"); partner.emit("status", "Stranger disconnected."); }
  if (notifyPartner) socket.emit("partner-left");
}
function getBotReply(message, socket) {
  const text = message.toLowerCase().trim();
  if (/\b(hi|hello|hey|hii|namaste)\b|नमस्ते|हेलो/.test(text)) return "Hey! 😊 How are you doing today?";
  if (/how are you|how r u/.test(text)) return "I'm doing well, thanks for asking! 😊 What are you up to?";
  if (/your name|who are you|are you real/.test(text)) return "I'm StrangerWave's virtual companion, not a real person. 😊";
  if (/where are you from|where do you live/.test(text)) return "I'm a virtual companion, so I don't have a physical hometown. Where are you from?";
  if (/sad|upset|lonely|bad day/.test(text)) return "I'm sorry you're feeling that way. 💙 Want to tell me a little more about it?";
  if (/joke|make me laugh/.test(text)) return "Why did the computer go to the doctor? It had a virus! 😄";
  if (/thank you|thanks/.test(text)) return "You're welcome! 😊 What else would you like to talk about?";
  if (/bye|goodbye|see you/.test(text)) return "It was nice chatting with you! 👋 Press Next Stranger whenever you want to start again.";
  const replies = ["That's interesting! Tell me a little more. 😊", "I see! What made you think about that?", "Really? I'd like to hear more about it.", "Nice! What else is on your mind?"];
  const index = socket.data.botReplyIndex || 0; socket.data.botReplyIndex = index + 1; return replies[index % replies.length];
}
function startBotChat(socket) {
  if (!socket.connected) return;
  removeFromWaiting(socket.id); if (partners.has(socket.id)) disconnectPartner(socket, false);
  socket.data.botMode = true; socket.data.botReplyIndex = 0; socket.emit("matched");
  socket.emit("status", "No stranger found in 30 seconds. Your free virtual companion is ready.");
  socket.emit("chat-message", { id: `bot-welcome-${Date.now()}`, text: "Hi! 👋 I'm StrangerWave's free virtual companion, not a real person. What would you like to talk about?", senderName: "StrangerWave Bot" });
}
function findStranger(socket, profile = {}) {
  removeFromWaiting(socket.id); clearTimer(botTimers, socket.id); disconnectPartner(socket); endBotChat(socket);
  socket.data.profile = { ageRange: String(profile.ageRange || ""), gender: String(profile.gender || "") };
  for (const waitingId of waitingUsers) {
    const waitingSocket = io.sockets.sockets.get(waitingId);
    if (!waitingSocket || partners.has(waitingId) || waitingSocket.data.botMode) { removeFromWaiting(waitingId); continue; }
    removeFromWaiting(waitingId); partners.set(socket.id, waitingId); partners.set(waitingId, socket.id);
    socket.emit("matched", { partnerName: waitingSocket.data.displayName }); waitingSocket.emit("matched", { partnerName: socket.data.displayName });
    socket.emit("status", "Connected to a stranger!"); waitingSocket.emit("status", "Connected to a stranger!"); return;
  }
  waitingUsers.add(socket.id); socket.emit("status", "Searching for a stranger…");
  searchTimers.set(socket.id, setTimeout(() => { searchTimers.delete(socket.id); if (waitingUsers.has(socket.id)) startBotChat(socket); }, SEARCH_TIMEOUT));
}
function onlineUsers(excludeId) {
  return [...sessions.entries()].filter(([id, item]) => id !== excludeId && item.socket?.connected)
    .map(([userId, item]) => ({ userId, name: item.displayName || "Stranger" }));
}

io.on("connection", socket => {
  socket.data.botMode = false; socket.data.botReplyIndex = 0;
  socket.data.displayName = `User ${nextUserNumber++}`;
  socket.emit("your-name", socket.data.displayName); socket.emit("status", "Ready to chat. Press Find Stranger."); broadcastOnlineCount();

  socket.on("register-session", async ({ sessionToken, displayName } = {}, callback) => {
    try {
      let userId = readSessionToken(sessionToken);
      if (!userId) userId = crypto.randomUUID();
      const name = cleanName(displayName) || socket.data.displayName;
      const priorTimer = cleanupTimers.get(userId); if (priorTimer) clearTimeout(priorTimer); cleanupTimers.delete(userId);
      socket.data.userId = userId; socket.data.displayName = name; socketUsers.set(socket.id, userId);
      const old = sessions.get(userId); if (old?.socket && old.socket.id !== socket.id) old.socket.disconnect(true);
      sessions.set(userId, { socket, displayName: name });
      socket.emit("session-token", makeSessionToken(userId));
      if (appwriteReady) await ensureUser(userId, name, userId);
      socket.emit("chat-list", await getChatList(userId)); socket.emit("online-users", onlineUsers(userId));
      if (callback) callback({ ok: true, name });
      for (const item of sessions.values()) if (item.socket?.connected) item.socket.emit("online-users", onlineUsers(item.socket.data.userId));
    } catch (error) { if (callback) callback({ ok: false, error: error.message || "Could not start session." }); }
  });

  socket.on("set-name", async (value, callback) => {
    const name = cleanName(value); if (!name) return callback?.({ ok: false, error: "Please enter a valid name." });
    socket.data.displayName = name;
    const userId = socket.data.userId;
    if (userId && sessions.has(userId)) { sessions.get(userId).displayName = name; try { if (appwriteReady) await ensureUser(userId, name, userId); } catch (e) { console.error(e.message); } }
    callback?.({ ok: true, name });
    if (userId && appwriteReady) { const rows = await findRows(CONTACTS, "contact_id", userId); for (const row of rows) await tableCall("updateRow", { databaseId: DB, tableId: CONTACTS, rowId: row.$id, data: { contact_name: name, updated_at: nowISO() } }); }
  });
  socket.on("find-stranger", profile => findStranger(socket, profile || {}));
  socket.on("next-stranger", profile => findStranger(socket, profile || {}));
  socket.on("chat-message", async message => {
    if (!message || typeof message !== "object") return;
    const id = safeText(message.id, 100), text = safeText(message.text, 1000); if (!id || !text) return;
    if (socket.data.botMode) {
      socket.emit("message-status", { id, status: "sent" }); clearTimer(botTimers, socket.id);
      botTimers.set(socket.id, setTimeout(() => { botTimers.delete(socket.id); if (socket.connected && socket.data.botMode) socket.emit("chat-message", { id: `bot-${Date.now()}`, text: getBotReply(text, socket), senderName: "StrangerWave Bot" }); }, BOT_REPLY_DELAY)); return;
    }
    const partnerId = partners.get(socket.id); const partner = partnerId && io.sockets.sockets.get(partnerId);
    if (!partner?.connected) { socket.emit("message-status", { id, status: "failed" }); return; }
    partner.emit("chat-message", { id, text, senderName: socket.data.displayName, senderId: socket.id });
    socket.emit("message-status", { id, status: "sent" });
  });
  socket.on("message-seen", messageId => { const partner = io.sockets.sockets.get(partners.get(socket.id)); if (partner?.connected) partner.emit("message-status", { id: safeText(messageId, 100), status: "seen" }); });
  socket.on("disconnect-stranger", () => { removeFromWaiting(socket.id); clearTimer(botTimers, socket.id); disconnectPartner(socket); endBotChat(socket); socket.emit("status", "Disconnected. Press Find Stranger to chat again."); });

  socket.on("get-chat-history", async contactId => {
    try { const userId = socket.data.userId; if (!userId || typeof contactId !== "string") return;
      const mine = await findRows(CONTACTS, "owner_id", userId);
      if (!mine.some(row => row.contact_id === contactId)) { socket.emit("chat-history", { contactId, messages: [] }); return; }
      socket.emit("chat-history", { contactId, messages: await getHistory(createConversationId(userId, contactId)) });
    } catch (error) { socket.emit("feature-error", error.message || "Could not load chat history."); }
  });
  socket.on("private-message", async payload => {
    try {
      const userId = socket.data.userId, contactId = safeText(payload?.contactId, 60), text = safeText(payload?.text, 1000), id = safeText(payload?.id, 100);
      if (!appwriteReady || !userId || !contactId || !id || !text || !sessions.has(contactId)) throw new Error("This user is not online or chat storage is unavailable.");
      const [userRows, contactRows] = await Promise.all([findRows(CONTACTS, "owner_id", userId), findRows(CONTACTS, "owner_id", contactId)]);
      if (!userRows.some(row => row.contact_id === contactId) && userRows.length >= MAX_CONTACTS) throw new Error("Your Chat List is full (100 contacts maximum).");
      const other = sessions.get(contactId); const conversationId = await addContactPair(userId, contactId, socket.data.displayName, other.displayName, text);
      const saved = await saveMessage({ conversationId, senderId: userId, receiverId: contactId, text });
      const packet = { id: saved?.$id || id, senderId: userId, senderName: socket.data.displayName, text, type: "text", createdAt: nowISO() };
      socket.emit("private-message", { ...packet, mine: true, contactId }); other.socket.emit("private-message", { ...packet, mine: false, contactId: userId });
      await Promise.all([sendChatList(userId), sendChatList(contactId)]);
    } catch (error) { socket.emit("feature-error", error.message || "Message could not be sent."); }
  });
  socket.on("private-image", async payload => {
    try {
      const userId = socket.data.userId, contactId = safeText(payload?.contactId, 60);
      if (!appwriteReady || !userId || !sessions.has(contactId)) throw new Error("User is offline or image storage is unavailable.");
      const dataUrl = String(payload?.dataUrl || ""); const match = dataUrl.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
      if (!match) throw new Error("Only JPG, PNG or WebP images are allowed.");
      const buffer = Buffer.from(match[2], "base64"); if (!buffer.length || buffer.length > 200 * 1024) throw new Error("Image must be 200 KB or smaller.");
      const other = sessions.get(contactId); const conversationId = await addContactPair(userId, contactId, socket.data.displayName, other.displayName, "[Image]");
      const file = await storage.createFile({ bucketId: BUCKET, fileId: uniqueId(), file: sdk.InputFile.fromBuffer(buffer, `chat-${Date.now()}.${match[1]}`) });
      const saved = await saveMessage({ conversationId, senderId: userId, receiverId: contactId, type: "image", fileId: file.$id });
      const imageUrl = `/chat-image/${file.$id}`;
      const packet = { id: saved?.$id, senderId: userId, senderName: socket.data.displayName, type: "image", imageUrl, createdAt: nowISO() };
      socket.emit("private-message", { ...packet, mine: true, contactId }); other.socket.emit("private-message", { ...packet, mine: false, contactId: userId });
      await Promise.all([sendChatList(userId), sendChatList(contactId)]);
    } catch (error) { socket.emit("feature-error", error.message || "Image could not be sent."); }
  });
  socket.on("remove-contact", async contactId => {
    try { await removeContactPair(socket.data.userId, safeText(contactId, 60)); socket.emit("contact-removed", contactId); }
    catch (error) { socket.emit("feature-error", error.message || "Could not remove contact."); }
  });
  socket.on("get-online-users", () => socket.emit("online-users", onlineUsers(socket.data.userId)));

  socket.on("disconnect", () => {
    removeFromWaiting(socket.id); clearTimer(botTimers, socket.id); disconnectPartner(socket); endBotChat(socket); broadcastOnlineCount();
    const userId = socketUsers.get(socket.id); socketUsers.delete(socket.id);
    if (userId && sessions.get(userId)?.socket.id === socket.id) {
      sessions.delete(userId);
      if (appwriteReady) {
        markUserOffline(userId).catch(error => console.error("Presence cleanup failed", error.message));
        findRows(CONTACTS, "contact_id", userId).then(rows => Promise.all([...new Set(rows.map(row => row.owner_id))].map(ownerId => sendChatList(ownerId))))
          .catch(error => console.error("Contact presence update failed", error.message));
      }
      const timer = setTimeout(() => { cleanupTimers.delete(userId); cleanupUser(userId).catch(error => console.error("Session cleanup failed", error.message)); }, SESSION_CLEANUP_DELAY);
      cleanupTimers.set(userId, timer);
    }
    for (const item of sessions.values()) if (item.socket?.connected) item.socket.emit("online-users", onlineUsers(item.socket.data.userId));
  });
});

if (appwriteReady) {
  pruneOldMessages().catch(error => console.error("Initial history cleanup failed", error.message));
  setInterval(() => pruneOldMessages().catch(error => console.error("History cleanup failed", error.message)), 60 * 60 * 1000).unref();
}
server.listen(PORT, () => console.log(`StrangerWave server running on port ${PORT}`));
