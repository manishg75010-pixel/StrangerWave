STRANGERWAVE — QUICK START (WINDOWS 11)

Included:
- public/: website interface, styles and browser code
- data/: placeholder for future app data (no user chat logs are stored here)
- server.js: Express + Socket.IO server
- package.json and package-lock.json: Node dependencies
- .env.example: example environment configuration
- render.yaml: basic Render deployment configuration

Run locally:
1. Install Node.js LTS (18 or newer) from https://nodejs.org/
2. Extract this ZIP to a normal folder (do not run inside ZIP preview).
3. Open the extracted folder in File Explorer.
4. Click the address bar, type cmd, press Enter.
5. Run these commands one at a time:
   npm install
   npm start
6. Open http://localhost:3000 in your browser.

If npm is not recognized:
- Install Node.js LTS and ensure "Add to PATH" is enabled.
- Close and reopen Command Prompt.
- Check with: node -v
- Check with: npm -v
- Then run npm install and npm start in the project folder.

NOTES:
- The starter matches two browsers connected to the same running server.
- To let public internet users chat, deploy the server to a hosting provider.
- The language selector changes its label only; automatic translation is not included.
- AI companion/OpenAI replies are not included in this starter.
- Do not commit your real .env file or API keys.
