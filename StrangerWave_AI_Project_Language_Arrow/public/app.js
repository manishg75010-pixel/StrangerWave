const socket = io();

const statusEl = document.getElementById("status");
const messages = document.getElementById("messages");
const input = document.getElementById("messageInput");
const form = document.getElementById("messageForm");
const sendButton = document.getElementById("sendButton");
const findButton = document.getElementById("findButton");
const nextButton = document.getElementById("nextButton");
const disconnectButton = document.getElementById("disconnectButton");
const languageButton = document.getElementById("languageButton");
const languageMenu = document.getElementById("languageMenu");
const languageSelect = document.getElementById("languageSelect");

const onlineCountEl = document.getElementById("onlineCount");
const displayNameInput = document.getElementById("displayName");
const saveNameButton = document.getElementById("saveNameButton");
const nameStatusEl = document.getElementById("nameStatus");

let connectedToStranger = false;
let currentPartnerName = "";
const messageElements = new Map();
const seenMessages = new Set();

function setStatus(message) {
  statusEl.textContent = message;
}

function addMessage(text, kind, options = {}) {
  const welcome = messages.querySelector(".welcome");
  if (welcome) welcome.remove();

  const wrapper = document.createElement("div");
  wrapper.className = kind === "system"
    ? "system-message"
    : `message ${kind}`;

  if (options.id) wrapper.dataset.messageId = options.id;

  if (options.senderName && kind === "theirs") {
    const name = document.createElement("div");
    name.className = "message-sender";
    name.textContent = options.senderName;
    wrapper.appendChild(name);
  }

  const body = document.createElement("div");
  body.className = "message-text";
  body.textContent = text;
  wrapper.appendChild(body);

  if (kind === "mine" && options.id) {
    const receipt = document.createElement("div");
    receipt.className = "message-receipt";
    receipt.textContent = "Sending…";
    receipt.dataset.receiptId = options.id;
    wrapper.appendChild(receipt);
  }

  messages.appendChild(wrapper);
  messages.scrollTop = messages.scrollHeight;

  if (options.id) messageElements.set(options.id, wrapper);

  return wrapper;
}

function updateMessageStatus(id, status) {
  const wrapper = messageElements.get(id);
  if (!wrapper) return;

  const receipt = wrapper.querySelector(".message-receipt");
  if (!receipt) return;

  const labels = {
    sent: "Sent ✓",
    seen: "Seen ✓✓",
    failed: "Not sent"
  };

  receipt.textContent = labels[status] || "Sending…";
  receipt.classList.toggle("is-seen", status === "seen");
  receipt.classList.toggle("is-failed", status === "failed");
}

function resetChat(message) {
  connectedToStranger = false;
  currentPartnerName = "";
  input.disabled = true;
  sendButton.disabled = true;
  input.placeholder = "Find a stranger first…";
  nextButton.disabled = true;
  disconnectButton.disabled = true;
  findButton.disabled = false;
  findButton.textContent = "✦ Find Stranger";

  if (message) addMessage(message, "system");
}

function getProfileOptions() {
  return {
    ageRange: document.getElementById("ageRange").value,
    gender: document.getElementById("gender").value
  };
}

findButton.addEventListener("click", () => {
  messages.innerHTML = "";
  messageElements.clear();
  seenMessages.clear();
  findButton.disabled = true;
  setStatus("Searching for a stranger…");
  socket.emit("find-stranger", getProfileOptions());
});

nextButton.addEventListener("click", () => {
  messages.innerHTML = "";
  messageElements.clear();
  seenMessages.clear();
  connectedToStranger = false;
  input.disabled = true;
  sendButton.disabled = true;
  nextButton.disabled = true;
  disconnectButton.disabled = true;
  setStatus("Finding someone new…");
  socket.emit("next-stranger", getProfileOptions());
});

disconnectButton.addEventListener("click", () => {
  socket.emit("disconnect-stranger");
  resetChat("You disconnected.");
  setStatus("Disconnected");
});

form.addEventListener("submit", (event) => {
  event.preventDefault();

  const text = input.value.trim();
  if (!text || !connectedToStranger) return;

  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  addMessage(text, "mine", { id });
  socket.emit("chat-message", { id, text });

  input.value = "";
  input.focus();
});

saveNameButton?.addEventListener("click", () => {
  const name = displayNameInput.value.trim();

  if (!name) {
    nameStatusEl.textContent = "Please enter a name.";
    return;
  }

  socket.emit("set-name", name, (result) => {
    if (result?.ok) {
      displayNameInput.value = result.name;
      nameStatusEl.textContent = `Your name is saved as ${result.name}.`;
    } else {
      nameStatusEl.textContent = result?.error || "Could not save your name.";
    }
  });
});

socket.on("your-name", (name) => {
  if (displayNameInput && !displayNameInput.value) {
    displayNameInput.value = name;
  }
});

socket.on("online-count", (count) => {
  if (onlineCountEl) onlineCountEl.textContent = `Online: ${count}`;
});

socket.on("status", (message) => {
  setStatus(message);

  if (message.startsWith("Searching")) {
    findButton.disabled = true;
    findButton.textContent = "Searching…";
  } else if (!connectedToStranger) {
    findButton.disabled = false;
    findButton.textContent = "✦ Find Stranger";
  }
});

socket.on("matched", (data) => {
  connectedToStranger = true;
  currentPartnerName = data?.partnerName || "";

  input.disabled = false;
  sendButton.disabled = false;
  input.placeholder = "Type a message…";
  nextButton.disabled = false;
  disconnectButton.disabled = false;
  findButton.disabled = true;
  findButton.textContent = "✓ Connected";

  addMessage(
    currentPartnerName
      ? `You're connected to ${currentPartnerName}. Say hello!`
      : "You're connected. Say hello!",
    "system"
  );

  input.focus();
});

socket.on("chat-message", (message) => {
  // Supports object messages from the updated server.
  // A string fallback keeps older server messages readable.
  if (typeof message === "string") {
    addMessage(message, "theirs");
    return;
  }

  if (!message || typeof message.text !== "string") return;

  addMessage(message.text, "theirs", {
    id: message.id,
    senderName: message.senderName
  });

  // Send a read receipt only for messages from a real partner.
  if (message.senderId && message.id && !seenMessages.has(message.id)) {
    seenMessages.add(message.id);
    socket.emit("message-seen", message.id);
  }
});

socket.on("message-status", (data) => {
  if (!data || !data.id || !data.status) return;
  updateMessageStatus(data.id, data.status);
});

socket.on("partner-left", () => {
  resetChat("The stranger disconnected. Press Find Stranger to meet someone else.");
  setStatus("Stranger disconnected");
});

socket.on("connect_error", () => {
  setStatus("Can't connect to the server. Please refresh the page.");
});

languageButton.addEventListener("click", () => {
  const hidden = languageMenu.classList.toggle("hidden");
  languageButton.setAttribute("aria-expanded", String(!hidden));
});

document.addEventListener("click", (event) => {
  if (!event.target.closest(".language-wrap")) {
    languageMenu.classList.add("hidden");
    languageButton.setAttribute("aria-expanded", "false");
  }
});

languageSelect.addEventListener("change", () => {
  languageButton.textContent = `↗ ${languageSelect.value}`;
});
