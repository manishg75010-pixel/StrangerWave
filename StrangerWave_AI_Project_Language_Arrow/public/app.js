const socket = io();

const statusEl = document.getElementById("status");
const messages = document.getElementById("messages");
const input = document.getElementById("messageInput");
const form = document.getElementById("messageForm");
const sendButton = document.getElementById("sendButton");
const findButton = document.getElementById("findButton");
const termsCheckbox = document.getElementById("termsCheckbox");
findButton.disabled = !termsCheckbox.checked;

termsCheckbox.addEventListener("change", () => {
  findButton.disabled = !termsCheckbox.checked;
});
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
  findButton.disabled = !termsCheckbox.checked;
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
  if (!termsCheckbox.checked) {
    setStatus("Please accept the Terms & Conditions first.");
    termsCheckbox.focus();
    return;
  }

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
    findButton.disabled = !termsCheckbox.checked;
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

/* Direct chat, online users and seven-day message history */
const chatListEl = document.getElementById("chatList");
const chatListCountEl = document.getElementById("chatListCount");
const onlineUsersEl = document.getElementById("onlineUsers");
const directTitleEl = document.getElementById("directChatTitle");
const directMessagesEl = document.getElementById("directMessages");
const directForm = document.getElementById("directMessageForm");
const directInput = document.getElementById("directMessageInput");
const directSendButton = document.getElementById("directSendButton");
const removeContactButton = document.getElementById("removeContactButton");
const imageButton = document.getElementById("imageButton");
const imageInput = document.getElementById("imageInput");
const directStatusEl = document.getElementById("directStatus");
let selectedContactId = "";
let selectedContactName = "";
let savedContacts = [];
let currentOnlineUsers = [];

function getBrowserSessionId() {
  const token = sessionStorage.getItem("strangerwave_session_token") || "";
  return token.split(".")[0] || "";
}

function registerBrowserSession() {
  const sessionToken = sessionStorage.getItem("strangerwave_session_token") || "";
  const displayName = (displayNameInput?.value || "").trim();
  socket.emit("register-session", { sessionToken, displayName }, result => {
    if (!result?.ok) {
      if (directStatusEl) directStatusEl.textContent = result?.error || "Could not start private chat.";
      return;
    }
    if (displayNameInput && !displayNameInput.value) displayNameInput.value = result.name;
  });
}

socket.on("session-token", token => sessionStorage.setItem("strangerwave_session_token", token));
socket.on("connect", registerBrowserSession);

function showEmptyDirectMessage(message) {
  if (!directMessagesEl) return;
  directMessagesEl.innerHTML = "";
  const p = document.createElement("p");
  p.className = "small";
  p.textContent = message;
  directMessagesEl.appendChild(p);
}

function renderDirectMessage(message) {
  if (!directMessagesEl || !message) return;
  const empty = directMessagesEl.querySelector("p.small");
  if (empty) empty.remove();
  const item = document.createElement("div");
  item.className = `direct-message${message.mine || message.senderId === getBrowserSessionId() ? " mine" : ""}`;
  if (message.type === "image" && message.imageUrl) {
    const img = document.createElement("img");
    img.src = message.imageUrl;
    img.alt = "Shared image";
    img.loading = "lazy";
    item.appendChild(img);
  } else {
    item.textContent = message.text || "";
  }
  if (message.createdAt) {
    const time = document.createElement("small");
    const date = new Date(message.createdAt);
    time.textContent = Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
    item.appendChild(time);
  }
  directMessagesEl.appendChild(item);
  directMessagesEl.scrollTop = directMessagesEl.scrollHeight;
}

function openDirectChat(contactId, name) {
  if (!contactId) return;
  selectedContactId = contactId;
  selectedContactName = name || "Stranger";
  directTitleEl.textContent = selectedContactName;
  directInput.disabled = false;
  directSendButton.disabled = false;
  imageButton.disabled = false;
  removeContactButton.disabled = !savedContacts.some(item => item.contactId === contactId);
  directInput.placeholder = `Message ${selectedContactName}…`;
  showEmptyDirectMessage("Loading recent messages…");
  socket.emit("get-chat-history", contactId);
  renderPeopleLists();
  directInput.focus();
}

function renderPeopleLists() {
  if (!chatListEl || !onlineUsersEl) return;
  chatListEl.innerHTML = "";
  if (chatListCountEl) chatListCountEl.textContent = `${savedContacts.length}/100`;
  if (!savedContacts.length) {
    const empty = document.createElement("p"); empty.className = "small";
    empty.textContent = "No saved chats yet. Start a direct chat with someone online.";
    chatListEl.appendChild(empty);
  }
  savedContacts.forEach(person => {
    const row = document.createElement("button"); row.type = "button";
    row.className = `person-row${selectedContactId === person.contactId ? " active" : ""}`;
    const name = document.createElement("span"); name.className = "person-name"; name.textContent = person.name;
    const state = document.createElement("span"); state.className = "person-state"; state.textContent = person.isOnline ? "● Online" : "Offline";
    row.append(name, state);
    row.addEventListener("click", () => openDirectChat(person.contactId, person.name));
    chatListEl.appendChild(row);
  });
  onlineUsersEl.innerHTML = "";
  const visibleUsers = currentOnlineUsers.filter(person => person.userId !== getBrowserSessionId());
  if (!visibleUsers.length) {
    const empty = document.createElement("p"); empty.className = "small"; empty.textContent = "No other users online right now.";
    onlineUsersEl.appendChild(empty);
  }
  visibleUsers.forEach(person => {
    const row = document.createElement("button"); row.type = "button"; row.className = "person-row";
    const name = document.createElement("span"); name.className = "person-name"; name.textContent = person.name;
    const action = document.createElement("span"); action.className = "person-state"; action.textContent = "● Chat";
    row.append(name, action);
    row.addEventListener("click", () => openDirectChat(person.userId, person.name));
    onlineUsersEl.appendChild(row);
  });
}

socket.on("chat-list", list => {
  savedContacts = Array.isArray(list) ? list : [];
  renderPeopleLists();
  if (selectedContactId) {
    const current = savedContacts.find(item => item.contactId === selectedContactId);
    if (current) {
      selectedContactName = current.name;
      directTitleEl.textContent = current.name;
      removeContactButton.disabled = false;
    } else {
      selectedContactId = "";
      directTitleEl.textContent = "Select someone to chat";
      directInput.disabled = true; directSendButton.disabled = true; imageButton.disabled = true; removeContactButton.disabled = true;
      showEmptyDirectMessage("This contact is no longer in your Chat List.");
    }
  }
});
socket.on("online-users", users => { currentOnlineUsers = Array.isArray(users) ? users : []; renderPeopleLists(); });
socket.on("chat-history", data => {
  if (!data || data.contactId !== selectedContactId) return;
  directMessagesEl.innerHTML = "";
  if (!data.messages?.length) { showEmptyDirectMessage("No messages yet. Say hello!"); return; }
  let lastDay = "";
  data.messages.forEach(message => {
    const date = new Date(message.createdAt);
    const dayKey = Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString();
    if (dayKey && dayKey !== lastDay) {
      const divider = document.createElement("div");
      divider.className = "direct-day-divider";
      divider.textContent = dayKey;
      directMessagesEl.appendChild(divider);
      lastDay = dayKey;
    }
    renderDirectMessage({ ...message, mine: message.senderId === getBrowserSessionId() });
  });
});
socket.on("private-message", message => {
  if (!message) return;
  if (message.contactId === selectedContactId) renderDirectMessage(message);
  if (directStatusEl) directStatusEl.textContent = "Message sent. Recent history is saved for 7 days.";
});
socket.on("contact-removed", contactId => {
  savedContacts = savedContacts.filter(item => item.contactId !== contactId);
  if (selectedContactId === contactId) {
    selectedContactId = ""; selectedContactName = "";
    directTitleEl.textContent = "Select someone to chat";
    directInput.disabled = true; directSendButton.disabled = true; imageButton.disabled = true; removeContactButton.disabled = true;
    showEmptyDirectMessage("Contact and shared chat history removed.");
  }
  renderPeopleLists();
});
socket.on("feature-error", message => { if (directStatusEl) directStatusEl.textContent = message; });

if (directForm) directForm.addEventListener("submit", event => {
  event.preventDefault();
  const text = directInput.value.trim();
  if (!selectedContactId || !text) return;
  socket.emit("private-message", { contactId: selectedContactId, text, id: `${Date.now()}-${Math.random().toString(36).slice(2)}` });
  directInput.value = "";
  if (directStatusEl) directStatusEl.textContent = "Sending…";
});

removeContactButton?.addEventListener("click", () => {
  if (!selectedContactId) return;
  if (window.confirm("Remove this contact and delete this conversation and its shared images for both people?")) {
    socket.emit("remove-contact", selectedContactId);
  }
});

async function compressImage(file) {
  if (!file || !/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error("Choose a JPG, PNG or WebP image.");
  const image = await new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not read this image.")); };
    img.src = url;
  });
  const canvas = document.createElement("canvas");
  let width = image.naturalWidth, height = image.naturalHeight;
  const maxSide = 1280;
  if (Math.max(width, height) > maxSide) {
    const scale = maxSide / Math.max(width, height);
    width = Math.round(width * scale); height = Math.round(height * scale);
  }
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0, width, height);
  let quality = 0.82;
  let blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", quality));
  while (blob && blob.size > 200 * 1024 && quality > 0.35) {
    quality -= 0.08;
    blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", quality));
  }
  if (!blob || blob.size > 200 * 1024) throw new Error("This image cannot be compressed below 200 KB. Choose a smaller image.");
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not prepare image."));
    reader.readAsDataURL(blob);
  });
}

imageButton?.addEventListener("click", () => imageInput.click());
imageInput?.addEventListener("change", async () => {
  const file = imageInput.files?.[0];
  if (!file || !selectedContactId) return;
  try {
    directStatusEl.textContent = "Compressing image…";
    const dataUrl = await compressImage(file);
    socket.emit("private-image", { contactId: selectedContactId, dataUrl });
    directStatusEl.textContent = "Sending image…";
  } catch (error) { directStatusEl.textContent = error.message; }
  imageInput.value = "";
});

saveNameButton?.addEventListener("click", () => {
  setTimeout(() => {
    const sessionToken = sessionStorage.getItem("strangerwave_session_token") || "";
    socket.emit("register-session", { sessionToken, displayName: displayNameInput.value.trim() });
  }, 100);
});
