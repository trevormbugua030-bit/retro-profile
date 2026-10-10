#!/usr/bin/env node
/**
 * Retro profile static server
 * Listening port: 3000
 *
 * Start with: node server.js
 *            or: npm run serve
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT || 3000);
const ROOT = path.dirname(fileURLToPath(import.meta.url));

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".gif": "image/gif",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ico": "image/x-icon",
};

const server = http.createServer((req, res) => {
  // Simple SPA-like fallback: navigation URLs serve index.html so anchor
  // links keep working when the page is refreshed.
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (url.pathname === "/__health") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ ok: true, app: "retro-profile" }));
    return;
  }
  // Normalize: strip a leading "/" so path.resolve builds paths under ROOT.
  // "/" becomes "." (the project root), "/styles.css" becomes "styles.css", etc.
  let cleanPath =
    url.pathname === "/"
      ? "."
      : url.pathname.startsWith("/")
        ? url.pathname.slice(1)
        : url.pathname;
  let filePath = path.resolve(ROOT, cleanPath);

  // Security: keep requests inside the project root.
  const rootPrefix = ROOT + path.sep;
  if (filePath !== ROOT && !filePath.startsWith(rootPrefix)) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    res.end("403 forbidden\n");
    return;
  }

  const isDir = fs.existsSync(filePath) && fs.statSync(filePath).isDirectory();
  if (isDir) {
    filePath = path.join(filePath, "index.html");
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME[ext] || "application/octet-stream";

  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === "ENOENT") {
        // Fallback for navigation routes: serve the app shell.
        const fallback = path.join(ROOT, "index.html");
        fs.readFile(fallback, (fbErr, fbData) => {
          if (fbErr) {
            res.writeHead(404, { "Content-Type": "text/plain" });
            res.end("404 not found\n");
            return;
          }
          res.writeHead(200, { "Content-Type": MIME[".html"] });
          res.end(fbData);
        });
        return;
      }

      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("500 internal server error\n");
      return;
    }

    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": ext === ".html" ? "no-store, no-cache, must-revalidate, max-age=0" : "public, max-age=31536000, immutable",
    });
    res.end(data);
  });
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Start this site on another port with: PORT=3001 npm run serve`);
  } else {
    console.error("Could not start the Retro Profile server:", error.message);
  }
  process.exitCode = 1;
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Retro Profile server listening on port ${PORT}.`);
  console.log(`On this computer: http://localhost:${PORT}`);

  const interfaces = os.networkInterfaces();
  const ipv4 = Object.entries(interfaces).flatMap(([name, addresses]) =>
    (addresses || [])
      .filter((address) => address.family === "IPv4" && !address.internal)
      .map((address) => ({ name, address: address.address }))
  );
  const preferred = ipv4.filter(({ name }) => /^(wl|wlan|en|eth)/i.test(name));
  const lanAddresses = preferred.length ? preferred : ipv4;
  if (lanAddresses.length) {
    console.log("On your phone (same Wi-Fi), open:");
    lanAddresses.forEach(({ address }) => console.log(`  http://${address}:${PORT}`));
  } else {
    console.log("No LAN IPv4 address found. Check that Wi-Fi is connected.");
  }
  console.log(`Connection check: http://localhost:${PORT}/__health`);
});
