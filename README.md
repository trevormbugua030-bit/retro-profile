# Retro Profile

Trevor Mbugua — Retro Gaming Profile

- **Listening port:** `3000`
- **Dev server URL:** `http://localhost:3000`

## Start the dev server

```bash
npm install
npm run serve
```

The site is then available on your computer at `http://localhost:3000`.

## Open it on your phone

1. Connect your phone and computer to the same Wi-Fi network.
2. Start the server with `npm run serve`.
3. On the computer, run `hostname -I` and find its Wi-Fi/LAN address (often starts with `192.168.` or `10.`).
4. On your phone, open `http://COMPUTER-IP:3000`, replacing `COMPUTER-IP` with that address. For example: `http://192.168.1.25:3000`.

The server listens on the computer's network interfaces so other devices on the same network can connect. If the page does not load, allow Node.js through the computer's firewall for private networks.

To choose a different port (for example, if port 3000 is already in use):

```bash
PORT=3001 npm run serve
```

When the server starts, it prints the phone-ready LAN URL. Open that URL on a phone connected to the same Wi-Fi. Add `/__health` to the URL to confirm it reaches this project; it should show `{"ok":true,"app":"retro-profile"}`.

## Project structure

- `index.html` — page markup
- `styles.css` — styles
- `script.js` — vanilla JS (no build step)
- `server.js` — small static file server that binds to port 3000
- `package.json` — project metadata and npm scripts

## Notes

This is a static frontend. There is no backend API yet. The Friends panel currently uses demo data defined in `script.js`; see the `fetchFriends()` function if you later want to point it at a real API.
