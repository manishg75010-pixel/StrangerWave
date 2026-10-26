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
let connectedToStranger = false;

function setStatus(message) { statusEl.textContent = message; }
function addMessage(text, kind) {
  const welcome = messages.querySelector(".welcome");
  if (welcome) welcome.remove();
  const el = document.createElement("div");
  el.className = kind === "system" ? "system-message" : `message ${kind}`;
  el.textContent = text;
  messages.appendChild(el);
  messages.scrollTop = messages.scrollHeight;
}
function resetChat(message) {
  connectedToStranger = false;
  input.disabled = true;
  sendButton.disabled = true;
  input.placeholder = "Find a stranger first…";
  nextButton.disabled = true;
  disconnectButton.disabled = true;
  findButton.disabled = false;
  findButton.textContent = "✦ Find Stranger";
  if (message) addMessage(message, "system");
}
findButton.addEventListener("click", () => {
  messages.innerHTML = "";
  findButton.disabled = true;
  setStatus("Searching for a stranger…");
  socket.emit("find-stranger");
});
nextButton.addEventListener("click", () => {
  messages.innerHTML = "";
  connectedToStranger = false;
  input.disabled = true;
  sendButton.disabled = true;
  nextButton.disabled = true;
  setStatus("Finding someone new…");
  socket.emit("next-stranger");
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
  addMessage(text, "mine");
  socket.emit("chat-message", text);
  input.value = "";
  input.focus();
});
socket.on("status", (message) => {
  setStatus(message);
  if (message.startsWith("Searching")) {
    findButton.disabled = true;
    findButton.textContent = "Searching…";
  }
});
socket.on("matched", () => {
  connectedToStranger = true;
  input.disabled = false;
  sendButton.disabled = false;
  input.placeholder = "Type a message…";
  nextButton.disabled = false;
  disconnectButton.disabled = false;
  findButton.disabled = true;
  findButton.textContent = "✓ Connected";
  addMessage("You're connected. Say hello!", "system");
  input.focus();
});
socket.on("chat-message", (text) => addMessage(text, "theirs"));
socket.on("partner-left", () => {
  resetChat("The stranger disconnected. Press Find Stranger to meet someone else.");
  setStatus("Stranger disconnected");
});
socket.on("connect_error", () => setStatus("Can't connect to the server. Please refresh the page."));
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