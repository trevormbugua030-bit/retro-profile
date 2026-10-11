/* ============================================================
   RETRO GAMING PROFILE — script.js
   Vanilla JS only, no dependencies, no build step.
   0. Helpers / localStorage
   1. Theme switcher (5 themes, persisted)
   2. Navigation (mobile drawer + scrollspy)
   3. Static Trevor intro
   4. Website time-spent counter
   5. Snake game (canvas)
   6. Settings
   7. Extras (clock, reveal animations, footer)
   ============================================================ */

/* ---------------- 0. Helpers ---------------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const KEYS = {
  theme: "retro:theme",
  best: "retro:best"
};

const store = {
  get(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, String(value)); } catch (e) { /* storage blocked */ }
  }
};

/* ---------------- 1. Theme switcher ---------------- */
const THEME_NAMES = {
  retro: "Retro Pixel",
  cyberpunk: "Cyberpunk",
  terminal: "Terminal",
  anime: "Anime Night",
  forest: "Forest",
  warmretro: "Warm Retro"
};

const THEME_COLORS = {
  retro: "#0a0a18",
  cyberpunk: "#06070f",
  terminal: "#04120a",
  anime: "#0c0a1c",
  forest: "#0a110b",
  warmretro: "#120c08"
};

function applyTheme(name, save = true) {
  if (!Object.prototype.hasOwnProperty.call(THEME_NAMES, name)) name = "retro";
  document.documentElement.setAttribute("data-theme", name);
  if (save) store.set(KEYS.theme, name);

  $$("[data-theme-btn]").forEach((btn) => {
    btn.setAttribute("aria-pressed", String(btn.dataset.themeBtn === name));
  });

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", THEME_COLORS[name] || "#0a0a18");

  window.dispatchEvent(new CustomEvent("themechange", { detail: { theme: name } }));
}

$$("[data-theme-btn]").forEach((btn) => {
  btn.addEventListener("click", () => applyTheme(btn.dataset.themeBtn));
});

applyTheme(store.get(KEYS.theme) || "retro", false);

/* ---------------- 2. Navigation ---------------- */
const NAV_SECTIONS = ["home", "profile", "games", "settings"];

function setActiveNav(id) {
  $$("[data-nav]").forEach((link) => {
    const on = link.getAttribute("href") === "#" + id;
    link.classList.toggle("is-active", on);
    if (on) link.setAttribute("aria-current", "location");
    else link.removeAttribute("aria-current");
  });
}

if ("IntersectionObserver" in window) {
  const spy = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) setActiveNav(entry.target.id);
      });
    },
    { rootMargin: "-35% 0px -55% 0px", threshold: 0 }
  );
  NAV_SECTIONS.forEach((id) => {
    const el = document.getElementById(id);
    if (el) spy.observe(el);
  });
}
setActiveNav("home");

/* ---------------- Pointer pixel bursts ---------------- */
const burstDirections = [
  [-1, -1], [0, -1], [1, -1], [1, 0],
  [1, 1], [0, 1], [-1, 1], [-1, 0],
  [-2, 0], [2, 0], [0, -2], [0, 2]
];

document.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (event.target.closest("#snakeCanvas, #dpad, .game-actions, #overlayBtn, #memoryBoard, #memoryRestart")) return;

  const burst = document.createElement("span");
  burst.className = "click-burst";
  burst.setAttribute("aria-hidden", "true");
  burst.style.left = `${event.clientX}px`;
  burst.style.top = `${event.clientY}px`;

  burstDirections.forEach(([dx, dy], index) => {
    const pixel = document.createElement("i");
    pixel.style.setProperty("--burst-x", `${dx * (14 + Math.random() * 8)}px`);
    pixel.style.setProperty("--burst-y", `${dy * (14 + Math.random() * 8)}px`);
    pixel.style.setProperty("--burst-delay", `${(index % 4) * 18}ms`);
    pixel.style.setProperty("--burst-size", `${4 + Math.floor(Math.random() * 4)}px`);
    pixel.style.setProperty("--burst-color", `var(${["--accent", "--accent-2", "--hot", "--warn"][index % 4]})`);
    burst.appendChild(pixel);
  });

  document.body.appendChild(burst);
  window.setTimeout(() => burst.remove(), 620);
});

/* ---------------- 6. Snake game ---------------- */
function initSnake() {
  const canvas = $("#snakeCanvas");
  const overlay = $("#gameOverlay");
  if (!canvas || !overlay) return;

  const stage = $("#gameStage");
  const overlayTitle = $("#overlayTitle");
  const overlayMsg = $("#overlayMsg");
  const overlayBtn = $("#overlayBtn");
  const scoreValue = $("#scoreValue");
  const bestValue = $("#bestValue");
  const startBtn = $("#startBtn");
  const pauseBtn = $("#pauseBtn");
  const restartBtn = $("#restartBtn");
  const statusEl = $("#gameStatus");
  const dpad = $("#dpad");

  const ctx = canvas.getContext ? canvas.getContext("2d") : null;
  if (!ctx) {
    overlayMsg.textContent = "Canvas is not available in this browser, so Snake can't run here.";
    if (overlayBtn) overlayBtn.hidden = true;
    [startBtn, pauseBtn, restartBtn].forEach((b) => { if (b) b.disabled = true; });
    return;
  }

  const GRID = 21;
  const DIRS = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 }
  };

  const raf = window.requestAnimationFrame
    ? window.requestAnimationFrame.bind(window)
    : (cb) => window.setTimeout(() => cb(Date.now()), 16);
  const caf = window.cancelAnimationFrame
    ? window.cancelAnimationFrame.bind(window)
    : window.clearTimeout;

  const game = {
    mode: "ready", // ready | running | paused | over
    snake: [],
    dir: DIRS.right,
    pending: [],
    food: { x: 14, y: 10 },
    score: 0,
    best: parseInt(store.get(KEYS.best) || "0", 10) || 0,
    newBest: false,
    speed: 150,
    acc: 0,
    last: 0,
    rafId: 0
  };

  let colors = {};
  function readColors() {
    const cs = window.getComputedStyle(document.documentElement);
    const v = (name, fallback) => (cs.getPropertyValue(name) || "").trim() || fallback;
    colors = {
      bg: v("--snake-bg", "#0b0b20"),
      grid: v("--snake-grid", "rgba(255,255,255,0.06)"),
      body: v("--accent", "#9b5cff"),
      head: v("--accent-2", "#3ee0ff"),
      food: v("--hot", "#ff3d68")
    };
  }
  window.addEventListener("themechange", readColors);

  /* --- sizing (responsive, crisp on hidpi) --- */
  let size = 520;
  let cell = size / GRID;
  function resize() {
    const rect = canvas.getBoundingClientRect();
    const w = Math.round(rect.width || canvas.clientWidth || 520);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    size = Math.max(200, w);
    cell = size / GRID;
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    draw();
  }
  window.addEventListener("resize", resize);

  /* --- game logic --- */
  function reset() {
    const mid = Math.floor(GRID / 2);
    game.snake = [{ x: 6, y: mid }, { x: 5, y: mid }, { x: 4, y: mid }];
    game.dir = DIRS.right;
    game.pending = [];
    game.score = 0;
    game.speed = 150;
    game.acc = 0;
    game.newBest = false;
    spawnFood();
    syncUi();
  }

  function spawnFood() {
    const taken = new Set(game.snake.map((s) => s.x + "," + s.y));
    let spot;
    let guard = 0;
    do {
      spot = { x: Math.floor(Math.random() * GRID), y: Math.floor(Math.random() * GRID) };
      guard += 1;
    } while (taken.has(spot.x + "," + spot.y) && guard < 600);
    game.food = spot;
  }

  function queueDir(name) {
    const next = DIRS[name];
    if (!next) return;
    const last = game.pending.length ? game.pending[game.pending.length - 1] : game.dir;
    if (next.x === -last.x && next.y === -last.y) return; // no reversal
    if (next.x === last.x && next.y === last.y) return;   // no duplicate
    if (game.pending.length < 2) game.pending.push(next);
  }

  function step() {
    if (game.pending.length) game.dir = game.pending.shift();
    const head = game.snake[0];
    const nx = head.x + game.dir.x;
    const ny = head.y + game.dir.y;

    const hitWall = nx < 0 || ny < 0 || nx >= GRID || ny >= GRID;
    // ignore the tail cell: it moves away on this step unless we grow
    const body = game.snake.slice(0, -1);
    const hitSelf = body.some((s) => s.x === nx && s.y === ny);

    if (hitWall || hitSelf) {
      gameOver();
      return;
    }

    game.snake.unshift({ x: nx, y: ny });
    if (nx === game.food.x && ny === game.food.y) {
      game.score += 1;
      game.speed = Math.max(70, 150 - Math.floor(game.score / 3) * 9);
      spawnFood();
      syncUi();
    } else {
      game.snake.pop();
    }
  }

  function draw() {
    ctx.fillStyle = colors.bg || "#0b0b20";
    ctx.fillRect(0, 0, size, size);

    // pixel grid
    ctx.fillStyle = colors.grid || "rgba(255,255,255,0.06)";
    for (let i = 1; i < GRID; i++) {
      ctx.fillRect(Math.round(i * cell), 0, 1, size);
      ctx.fillRect(0, Math.round(i * cell), size, 1);
    }

    const pad = Math.max(1, Math.round(cell * 0.16));

    // food
    ctx.fillStyle = colors.food || "#ff3d68";
    ctx.fillRect(
      game.food.x * cell + pad,
      game.food.y * cell + pad,
      cell - pad * 2,
      cell - pad * 2
    );
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.fillRect(
      game.food.x * cell + pad,
      game.food.y * cell + pad,
      Math.max(2, Math.round(cell * 0.2)),
      Math.max(2, Math.round(cell * 0.2))
    );

    // snake
    const seg = Math.ceil(cell);
    game.snake.forEach((s, i) => {
      const x = Math.round(s.x * cell);
      const y = Math.round(s.y * cell);
      ctx.fillStyle = i === 0 ? colors.head || "#3ee0ff" : colors.body || "#9b5cff";
      ctx.fillRect(x + 1, y + 1, seg - 2, seg - 2);
      if (i > 0) {
        ctx.fillStyle = "rgba(0,0,0,0.3)";
        ctx.fillRect(x + 1, y + 1, seg - 2, 1);
      }
    });

    // eyes on the head
    const h = game.snake[0];
    if (h) {
      const px = -game.dir.y;
      const py = game.dir.x;
      const es = Math.max(2, Math.round(cell * 0.2));
      const cx = h.x * cell + cell / 2;
      const cy = h.y * cell + cell / 2;
      ctx.fillStyle = colors.bg || "#0b0b20";
      [1, -1].forEach((s) => {
        const ex = cx + px * s * cell * 0.2 + game.dir.x * cell * 0.16;
        const ey = cy + py * s * cell * 0.2 + game.dir.y * cell * 0.16;
        ctx.fillRect(Math.round(ex - es / 2), Math.round(ey - es / 2), es, es);
      });
    }
  }

  function loop(t) {
    if (game.mode !== "running") return;
    if (!game.last) game.last = t;
    const dt = t - game.last;
    game.last = t;
    game.acc += dt;
    let guard = 0;
    while (game.acc >= game.speed && guard < 6) {
      game.acc -= game.speed;
      guard += 1;
      step();
      if (game.mode !== "running") break;
    }
    draw();
    if (game.mode === "running") game.rafId = raf(loop);
  }

  function cancelLoop() {
    if (game.rafId) {
      caf(game.rafId);
      game.rafId = 0;
    }
  }

  function announce(msg) {
    if (statusEl) statusEl.textContent = msg;
  }

  function syncUi() {
    if (scoreValue) scoreValue.textContent = String(game.score);
    if (bestValue) bestValue.textContent = String(game.best);

    if (pauseBtn) {
      pauseBtn.disabled = game.mode !== "running" && game.mode !== "paused";
      pauseBtn.textContent = game.mode === "paused" ? "Resume" : "Pause";
    }
    if (startBtn) {
      startBtn.disabled = game.mode === "running";
      startBtn.textContent = game.mode === "paused" ? "Resume" : "Start";
    }
    if (stage) stage.classList.toggle("is-playing", game.mode === "running");

    if (game.mode === "running") {
      overlay.hidden = true;
      return;
    }

    overlay.hidden = false;
    if (game.mode === "ready") {
      overlayTitle.textContent = "SNAKE";
      overlayMsg.textContent = "Arrow keys or WASD to steer. Space pauses. Eat, grow, survive.";
      overlayBtn.textContent = "Start Game";
    } else if (game.mode === "paused") {
      overlayTitle.textContent = "PAUSED";
      overlayMsg.textContent = "Your run is waiting. Score " + game.score + " · Best " + game.best + ".";
      overlayBtn.textContent = "Resume";
    } else {
      overlayTitle.textContent = "GAME OVER";
      overlayMsg.textContent = game.newBest
        ? "New best: " + game.best + "! Final score " + game.score + "."
        : "Score " + game.score + " · Best " + game.best + ".";
      overlayBtn.textContent = "Play Again";
    }
  }

  function start() {
    if (game.mode === "running") return;
    if (game.mode === "over") reset();
    game.mode = "running";
    game.last = 0;
    game.acc = 0;
    cancelLoop();
    game.rafId = raf(loop);
    syncUi();
    draw();
    canvas.focus({ preventScroll: true });
    announce("Game started. Score " + game.score + ".");
  }

  function pause(hidden = false) {
    if (game.mode !== "running") return;
    game.mode = "paused";
    cancelLoop();
    draw();
    syncUi();
    if (!hidden) {
      announce("Game paused.");
      if (pauseBtn) pauseBtn.focus({ preventScroll: true });
    }
  }

  function resume() {
    if (game.mode !== "paused") return;
    game.mode = "running";
    game.last = 0;
    cancelLoop();
    game.rafId = raf(loop);
    syncUi();
    announce("Game resumed.");
  }

  function togglePause() {
    if (game.mode === "running") pause();
    else if (game.mode === "paused") resume();
    else start();
  }

  function gameOver() {
    game.mode = "over";
    cancelLoop();
    game.newBest = game.score > game.best;
    if (game.newBest) {
      game.best = game.score;
      store.set(KEYS.best, game.best);
    }
    draw();
    syncUi();
    announce("Game over. Score " + game.score + ". Best score " + game.best + ".");
  }

  function restart() {
    cancelLoop();
    reset();
    game.mode = "ready";
    syncUi();
    start();
  }

  /* --- controls --- */
  if (startBtn) startBtn.addEventListener("click", () => (game.mode === "paused" ? resume() : start()));
  if (pauseBtn) pauseBtn.addEventListener("click", togglePause);
  if (restartBtn) restartBtn.addEventListener("click", restart);
  if (overlayBtn) {
    overlayBtn.addEventListener("click", () => (game.mode === "paused" ? resume() : start()));
  }

  const KEY_DIRS = {
    ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right",
    w: "up", s: "down", a: "left", d: "right",
    W: "up", S: "down", A: "left", D: "right"
  };

  window.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const target = e.target;
    const tag = target && target.tagName;
    if (target instanceof Element && target.closest("#musicWidget")) return;
    if (tag === "INPUT" || tag === "TEXTAREA" || (target && target.isContentEditable)) return;

    const dir = KEY_DIRS[e.key];
    if (dir) {
      // only capture arrows while a run is live, so page scrolling still works
      if (game.mode === "running" || game.mode === "paused") {
        e.preventDefault();
        queueDir(dir);
      }
      return;
    }

    if (e.key === " " || e.key === "Spacebar") {
      if (game.mode === "running" || game.mode === "paused") {
        e.preventDefault();
        togglePause();
      }
      return;
    }

    if (e.key === "Enter" && game.mode !== "running") {
      const ae = document.activeElement;
      const busy = ae && ["BUTTON", "A", "INPUT", "TEXTAREA", "SELECT"].indexOf(ae.tagName) !== -1;
      if (!busy) {
        e.preventDefault();
        start();
      }
    }
  });

  /* touch: d-pad (pointerdown for latency, click for keyboard users) */
  if (dpad) {
    const handlePad = (btn) => {
      if (!btn) return;
      if (btn.dataset.dir) {
        if (game.mode === "ready" || game.mode === "over") start();
        queueDir(btn.dataset.dir);
      } else if (btn.dataset.action === "pause") {
        togglePause();
      }
    };
    dpad.addEventListener("pointerdown", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      e.preventDefault();
      handlePad(btn);
    });
    dpad.addEventListener("click", (e) => {
      if (e.detail !== 0) return; // keyboard activation only (detail === 0)
      handlePad(e.target.closest("button"));
    });
  }

  /* touch: swipe on the board */
  let touchStart = null;
  canvas.addEventListener("touchstart", (e) => {
    if (game.mode !== "running") return;
    const t = e.touches[0];
    touchStart = { x: t.clientX, y: t.clientY };
  }, { passive: true });
  canvas.addEventListener("touchend", (e) => {
    if (!touchStart || game.mode !== "running") { touchStart = null; return; }
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStart.x;
    const dy = t.clientY - touchStart.y;
    touchStart = null;
    if (Math.abs(dx) < 22 && Math.abs(dy) < 22) return;
    if (Math.abs(dx) > Math.abs(dy)) queueDir(dx > 0 ? "right" : "left");
    else queueDir(dy > 0 ? "down" : "up");
  }, { passive: true });

  /* auto-pause when the tab is hidden */
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && game.mode === "running") pause(true);
  });

  /* clear-all in Settings resets the best score too */
  window.addEventListener("retroclear", () => {
    game.best = 0;
    store.set(KEYS.best, 0);
    syncUi();
  });

  readColors();
  reset();
  game.mode = "ready";
  syncUi();
  resize();
}

initSnake();

/* ---------------- Random pixel platformer ---------------- */
function initPlatformer() {
  const canvas = $("#platformerCanvas");
  const stage = $("#platformerStage");
  const overlay = $("#platformerOverlay");
  const startButton = $("#platformerStart");
  if (!canvas || !stage || !overlay || !startButton) return;

  const ctx = canvas.getContext?.("2d");
  const scoreLabel = $("#platformerScore");
  const levelLabel = $("#platformerLevel");
  const byteLabel = $("#platformerBytes");
  const comboLabel = $("#platformerCombo");
  const message = $("#platformerMessage");
  const status = $("#platformerStatus");
  const controls = $$("[data-platformer-control]");
  if (!ctx) {
    if (message) message.textContent = "Canvas is unavailable in this browser.";
    startButton.disabled = true;
    return;
  }

  let W = 800;
  let H = 440;
  const BASE_W = 800;
  const BASE_H = 440;
  const player = { x: 90, y: 0, w: 26, h: 34, vx: 0, vy: 0, grounded: false };
  const game = { mode: "ready", score: 0, bytes: 0, combo: 0, level: 1, camera: 0, platforms: [], enemies: [], rewards: [], last: 0, raf: 0, spawnAt: 700, keys: new Set() };
  let palette = {};
  function readPalette() {
    const css = getComputedStyle(document.documentElement);
    const color = (key, fallback) => css.getPropertyValue(key).trim() || fallback;
    palette = {
      bg: color("--snake-bg", "#0b0b20"), grid: color("--snake-grid", "rgba(155,92,255,.15)"),
      platform: color("--accent", "#9b5cff"), highlight: color("--accent-2", "#3ee0ff"),
      enemy: color("--hot", "#ff3d68"), text: color("--muted", "#a49cd6")
    };
  }
  window.addEventListener("themechange", readPalette);

  function addPlatform(x, y, width) { game.platforms.push({ x, y, w: width, h: 12 }); }
  function addBotsOnPlatform(x, y, width, level = game.level) {
    const count = Math.random() < Math.min(.9, .35 + level * .035) ? (Math.random() < .45 ? 2 : 1) : 0;
    for (let i = 0; i < count; i++) {
      const span = Math.max(18, width - 32);
      const min = x + 4 + (count === 2 ? i * span * .48 : 0);
      const max = count === 2 ? min + span * .48 : x + width - 26;
      game.enemies.push({ x: min + Math.random() * Math.max(2, max - min), y: y - 22, w: 22, h: 22, vx: (38 + Math.random() * 35 + level * 3) * (Math.random() < .5 ? -1 : 1), min, max, alive: true });
    }
  }
  function addByteLine(x, y, width) {
    if (Math.random() > .82) return;
    const count = 2 + Math.floor(Math.random() * 4);
    const span = Math.max(30, width - 30);
    for (let i = 0; i < count; i++) game.rewards.push({ x: x + 15 + span * i / Math.max(1, count - 1), y: y - 35 - (i % 2) * 11, r: 6, taken: false });
  }
  function generateWorld() {
    game.platforms = [];
    game.enemies = [];
    game.rewards = [];
    game.camera = 0;
    game.score = 0;
    game.bytes = 0;
    game.combo = 0;
    game.level = 1;
    game.spawnAt = 700;
    addPlatform(20, 380, 270);
    let x = 330;
    let y = 345;
    while (x < 1900) {
      const gap = 52 + Math.random() * 58;
      y = Math.max(205, Math.min(368, y + (Math.random() - .5) * 90));
      x += gap;
      const width = 100 + Math.random() * 90;
      addPlatform(x, y, width);
      addBotsOnPlatform(x, y, width);
      addByteLine(x, y, width);
      x += width;
    }
    player.x = 90;
    player.y = 330;
    player.vx = player.vy = 0;
    player.grounded = false;
    game.keys.clear();
    if (scoreLabel) scoreLabel.textContent = "0";
    syncRewardUi();
  }

  function syncRewardUi() {
    if (levelLabel) levelLabel.textContent = String(game.level);
    if (byteLabel) byteLabel.textContent = String(game.bytes);
    if (comboLabel) comboLabel.textContent = `×${game.combo}`;
  }

  function draw() {
    const cam = game.camera;
    ctx.fillStyle = palette.bg;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = palette.grid;
    for (let x = -((cam * .18) % 40); x < W; x += 40) ctx.fillRect(x, 0, 1, H);
    for (let y = 20; y < H; y += 40) ctx.fillRect(0, y, W, 1);
    // Soft retro skyline for a little depth.
    ctx.fillStyle = "rgba(120,100,180,.09)";
    for (let i = 0; i < 13; i++) {
      const bx = ((i * 97 - cam * .32) % (W + 100) + W + 100) % (W + 100) - 50;
      const bh = 45 + (i * 31 % 95);
      ctx.fillRect(bx, H - bh, 36, bh);
    }
    game.platforms.forEach((p) => {
      const sx = p.x - cam;
      if (sx > W || sx + p.w < 0) return;
      ctx.fillStyle = palette.platform;
      ctx.fillRect(sx, p.y, p.w, p.h);
      ctx.fillStyle = palette.highlight;
      ctx.fillRect(sx, p.y, p.w, 3);
      ctx.fillStyle = "rgba(0,0,0,.22)";
      for (let bx = sx + 8; bx < sx + p.w - 4; bx += 22) ctx.fillRect(bx, p.y + 6, 10, 2);
    });
    game.enemies.forEach((e) => {
      if (!e.alive) return;
      const sx = e.x - cam;
      if (sx < -e.w || sx > W) return;
      ctx.fillStyle = palette.enemy;
      ctx.fillRect(sx, e.y + 4, e.w, e.h - 4);
      ctx.fillRect(sx + 4, e.y, e.w - 8, 6);
      ctx.fillStyle = palette.bg;
      ctx.fillRect(sx + 5, e.y + 9, 4, 4);
      ctx.fillRect(sx + 14, e.y + 9, 4, 4);
      ctx.fillRect(sx + 4, e.y + e.h, 5, 4);
      ctx.fillRect(sx + 14, e.y + e.h, 5, 4);
    });
    game.rewards.forEach((reward) => {
      if (reward.taken) return;
      const sx = reward.x - cam;
      if (sx < -20 || sx > W + 20) return;
      ctx.fillStyle = palette.highlight;
      ctx.fillRect(sx - reward.r, reward.y - reward.r, reward.r * 2, reward.r * 2);
      ctx.fillStyle = palette.bg;
      ctx.fillRect(sx - 2, reward.y - 2, 4, 4);
    });
    const px = player.x - cam;
    ctx.fillStyle = palette.highlight;
    ctx.fillRect(px + 3, player.y, player.w - 6, 8);
    ctx.fillStyle = palette.platform;
    ctx.fillRect(px, player.y + 7, player.w, player.h - 13);
    ctx.fillStyle = palette.bg;
    ctx.fillRect(px + 6, player.y + 12, 4, 4);
    ctx.fillRect(px + 16, player.y + 12, 4, 4);
    ctx.fillStyle = palette.highlight;
    ctx.fillRect(px + 3, player.y + player.h - 5, 8, 5);
    ctx.fillRect(px + 15, player.y + player.h - 5, 8, 5);
    if (game.mode !== "running") return;
  }

  function endRun(text) {
    game.mode = "over";
    cancelAnimationFrame(game.raf);
    game.raf = 0;
    overlay.hidden = false;
    if (message) message.textContent = `${text} Distance score: ${game.score}.`;
    startButton.textContent = "Run Again";
    if (status) status.textContent = `${text} Final score ${game.score}.`;
    draw();
  }

  function update(dt) {
    const left = game.keys.has("ArrowLeft") || game.keys.has("a") || game.keys.has("A") || game.keys.has("left");
    const right = game.keys.has("ArrowRight") || game.keys.has("d") || game.keys.has("D") || game.keys.has("right");
    const direction = Number(right) - Number(left);
    player.vx += (direction * 260 - player.vx) * Math.min(1, dt * 12);
    player.x += player.vx * dt;
    player.x = Math.max(0, player.x);
    const wasGrounded = player.grounded;
    player.grounded = false;
    player.vy = Math.min(600, player.vy + 1100 * dt);
    const previousBottom = player.y + player.h;
    player.y += player.vy * dt;
    if (player.vy >= 0) {
      for (const p of game.platforms) {
        if (player.x + player.w > p.x && player.x < p.x + p.w && previousBottom <= p.y + 5 && player.y + player.h >= p.y) {
          player.y = p.y - player.h;
          player.vy = 0;
          player.grounded = true;
          break;
        }
      }
    }
    if (wasGrounded && (game.keys.has("jump") || game.keys.has(" ") || game.keys.has("ArrowUp") || game.keys.has("w") || game.keys.has("W"))) {
      player.vy = -450;
      player.grounded = false;
      game.keys.delete("jump");
      game.keys.delete(" ");
      game.keys.delete("ArrowUp");
      game.keys.delete("w");
      game.keys.delete("W");
    }

    const targetCamera = Math.max(0, player.x - 225);
    game.camera += (targetCamera - game.camera) * Math.min(1, dt * 5);
    const nextLevel = 1 + Math.floor(player.x / 900);
    if (nextLevel > game.level) {
      game.level = nextLevel;
      game.score += 50;
      syncRewardUi();
      if (status) status.textContent = `Level ${game.level}! Level-up bonus: 50 points.`;
    }
    game.score = Math.max(game.score, Math.floor(player.x / 20) + game.bytes * 10);
    if (scoreLabel) scoreLabel.textContent = String(game.score);

    game.rewards.forEach((reward) => {
      if (reward.taken) return;
      const dx = player.x + player.w / 2 - reward.x;
      const dy = player.y + player.h / 2 - reward.y;
      if (dx * dx + dy * dy < 24 * 24) {
        reward.taken = true;
        game.bytes += 1;
        game.combo += 1;
        game.score += 10 + Math.min(game.combo, 10) * 2;
        syncRewardUi();
        if (scoreLabel) scoreLabel.textContent = String(game.score);
      }
    });

    game.enemies.forEach((e) => {
      if (!e.alive) return;
      e.x += e.vx * dt;
      if (e.x < e.min) { e.x = e.min; e.vx = Math.abs(e.vx); }
      if (e.x + e.w > e.max) { e.x = e.max - e.w; e.vx = -Math.abs(e.vx); }
      const intersects = player.x < e.x + e.w && player.x + player.w > e.x && player.y < e.y + e.h && player.y + player.h > e.y;
      if (intersects) {
        const wasAbove = previousBottom <= e.y + 8 && player.vy > 0;
        if (wasAbove) {
          e.alive = false;
          player.vy = -270;
          game.combo += 1;
          game.score += 25 + Math.min(game.combo, 10) * 5;
          syncRewardUi();
          if (scoreLabel) scoreLabel.textContent = String(game.score);
        } else endRun("A bot caught you!");
      }
    });

    while (game.spawnAt < player.x + W + 300) {
      const last = game.platforms[game.platforms.length - 1];
      const gap = 52 + Math.random() * 60;
      const x = last.x + last.w + gap;
      const y = Math.max(205, Math.min(368, last.y + (Math.random() - .5) * 92));
      const width = 100 + Math.random() * 90;
      addPlatform(x, y, width);
      addBotsOnPlatform(x, y, width);
      addByteLine(x, y, width);
      game.spawnAt = x + width;
    }
    game.platforms = game.platforms.filter((p) => p.x + p.w > game.camera - 200);
    game.enemies = game.enemies.filter((e) => e.x + e.w > game.camera - 200 && (e.alive || e.x > game.camera - 250));
    game.rewards = game.rewards.filter((reward) => reward.x > game.camera - 200 && !reward.taken);
    if (player.y > H + 80) endRun("You missed a platform!");
  }

  function frame(now) {
    if (game.mode !== "running") return;
    const dt = Math.min(.04, (now - (game.last || now)) / 1000);
    game.last = now;
    update(dt);
    draw();
    if (game.mode === "running") game.raf = requestAnimationFrame(frame);
  }

  function run() {
    cancelAnimationFrame(game.raf);
    game.mode = "running";
    game.last = 0;
    generateWorld();
    overlay.hidden = true;
    canvas.focus({ preventScroll: true });
    if (status) status.textContent = "Run started. Use left and right to move and jump to dodge bots.";
    game.raf = requestAnimationFrame(frame);
  }

  function pause() {
    if (game.mode === "running") {
      game.mode = "paused";
      cancelAnimationFrame(game.raf);
      overlay.hidden = false;
      if (message) message.textContent = `Paused · distance score ${game.score}.`;
      startButton.textContent = "Resume";
    } else if (game.mode === "paused") {
      game.mode = "running";
      game.last = 0;
      overlay.hidden = true;
      game.raf = requestAnimationFrame(frame);
    }
  }

  function resize() {
    const mobile = window.matchMedia("(max-width: 700px)").matches;
    W = mobile ? 600 : BASE_W;
    H = BASE_H;
    stage.style.aspectRatio = `${W} / ${H}`;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }
  window.addEventListener("resize", resize);
  window.addEventListener("themechange", draw);
  startButton.addEventListener("click", () => game.mode === "paused" ? pause() : run());
  controls.forEach((button) => {
    const action = button.dataset.platformerControl;
    const press = (event) => {
      event.preventDefault();
      if (event.pointerId != null) button.setPointerCapture?.(event.pointerId);
      if (action === "pause") { pause(); return; }
      if (game.mode !== "running") return;
      if (action === "jump") game.keys.add("jump");
      else game.keys.add(action);
    };
    const release = () => { if (action === "left" || action === "right") game.keys.delete(action); };
    button.addEventListener("pointerdown", press);
    ["pointerup", "pointercancel", "lostpointercapture"].forEach((event) => button.addEventListener(event, release));
    button.addEventListener("click", (event) => { if (event.detail === 0) press(event); });
  });
  window.addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey || event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable='true'], #musicWidget")) return;
    const key = event.key;
    if (["ArrowLeft", "ArrowRight", "ArrowUp", " "].includes(key) && game.mode === "running") event.preventDefault();
    if (["ArrowLeft", "ArrowRight", "ArrowUp", " ", "a", "A", "d", "D", "w", "W"].includes(key)) game.keys.add(key);
    if (["p", "P", "Escape"].includes(key) && game.mode !== "ready" && game.mode !== "over") pause();
    if (["Enter"].includes(key) && game.mode !== "running" && document.activeElement === canvas) game.mode === "paused" ? pause() : run();
  });
  window.addEventListener("keyup", (event) => game.keys.delete(event.key));
  window.addEventListener("blur", () => game.keys.clear());
  document.addEventListener("visibilitychange", () => { if (document.hidden && game.mode === "running") pause(); });
  readPalette();
  generateWorld();
  resize();
}

initPlatformer();

/* ---------------- Memory Match ---------------- */
function initMemoryMatch() {
  const board = $("#memoryBoard");
  const movesLabel = $("#memoryMoves");
  const restartBtn = $("#memoryRestart");
  const playAgainBtn = $("#memoryPlayAgain");
  const winScreen = $("#memoryWin");
  const winMessage = $("#memoryWinMessage");
  const fireworksCanvas = $("#memoryFireworks");
  const status = $("#memoryStatus");
  if (!board || !movesLabel || !restartBtn) return;

  const symbols = ["✦", "♥", "☾", "♫", "★", "◆", "☯", "⚡"];
  let cards = [];
  let open = [];
  let moves = 0;
  let locked = false;
  let mismatchTimer = 0;
  let fireworksFrame = 0;
  let fireworksStopTimer = 0;
  let particles = [];

  function stopFireworks() {
    window.cancelAnimationFrame(fireworksFrame);
    window.clearTimeout(fireworksStopTimer);
    fireworksFrame = 0;
    particles = [];
    const context = fireworksCanvas?.getContext("2d");
    if (context) context.clearRect(0, 0, fireworksCanvas.width, fireworksCanvas.height);
  }

  function launchFireworks() {
    if (!fireworksCanvas || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    stopFireworks();
    const context = fireworksCanvas.getContext("2d");
    if (!context) return;

    const rect = fireworksCanvas.getBoundingClientRect();
    const scale = window.devicePixelRatio || 1;
    fireworksCanvas.width = Math.max(1, Math.round(rect.width * scale));
    fireworksCanvas.height = Math.max(1, Math.round(rect.height * scale));
    context.setTransform(scale, 0, 0, scale, 0, 0);
    const colors = ["#ff4fc8", "#38e8ff", "#ffe45c", "#9d72ff", "#75ff9c"];
    const bursts = [
      { x: rect.width * 0.2, y: rect.height * 0.28 },
      { x: rect.width * 0.78, y: rect.height * 0.24 },
      { x: rect.width * 0.5, y: rect.height * 0.16 }
    ];
    bursts.forEach((burst, burstIndex) => {
      for (let i = 0; i < 34; i += 1) {
        const angle = (Math.PI * 2 * i) / 34;
        const speed = 1.1 + Math.random() * 2.2;
        particles.push({
          x: burst.x, y: burst.y,
          vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
          life: 42 + Math.random() * 24, maxLife: 66,
          color: colors[(i + burstIndex * 2) % colors.length], size: 1.5 + Math.random() * 2
        });
      }
    });

    function animate() {
      context.clearRect(0, 0, rect.width, rect.height);
      particles = particles.filter((particle) => particle.life > 0);
      particles.forEach((particle) => {
        particle.x += particle.vx;
        particle.y += particle.vy;
        particle.vy += 0.025;
        particle.vx *= 0.985;
        particle.life -= 1;
        context.globalAlpha = Math.min(1, particle.life / 18);
        context.fillStyle = particle.color;
        context.fillRect(particle.x, particle.y, particle.size, particle.size);
      });
      context.globalAlpha = 1;
      if (particles.length) fireworksFrame = window.requestAnimationFrame(animate);
    }
    fireworksFrame = window.requestAnimationFrame(animate);
    fireworksStopTimer = window.setTimeout(stopFireworks, 2600);
  }

  function shuffle(items) {
    for (let i = items.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }

  function render() {
    board.innerHTML = cards.map((card, index) => {
      const revealed = card.revealed || card.matched;
      const classes = ["memory-card"];
      if (card.revealed) classes.push("is-revealed");
      if (card.matched) classes.push("is-matched");
      const label = card.matched ? `Matched ${card.symbol}` : revealed ? `Revealed ${card.symbol}` : `Hidden card ${index + 1}`;
      return `<button type="button" class="${classes.join(" ")}" data-card="${index}" aria-label="${label}"${card.matched ? " disabled" : ""}>${revealed ? card.symbol : "?"}</button>`;
    }).join("");
    movesLabel.textContent = String(moves);
  }

  function reset() {
    window.clearTimeout(mismatchTimer);
    stopFireworks();
    cards = shuffle([...symbols, ...symbols].map((symbol) => ({ symbol, revealed: false, matched: false })));
    open = [];
    moves = 0;
    locked = false;
    if (status) status.textContent = "New game. Find all matching pairs.";
    if (winScreen) winScreen.hidden = true;
    render();
  }

  board.addEventListener("click", (event) => {
    const button = event.target.closest("[data-card]");
    if (!button || locked) return;
    const index = Number(button.dataset.card);
    const card = cards[index];
    if (!card || card.matched || card.revealed) return;

    card.revealed = true;
    open.push(index);
    if (open.length === 2) {
      moves += 1;
      const [first, second] = open.map((i) => cards[i]);
      if (first.symbol === second.symbol) {
        first.matched = true;
        second.matched = true;
        open = [];
        const pairs = cards.filter((item) => item.matched).length / 2;
        if (pairs === symbols.length) {
          const message = `You matched all eight pairs in ${moves} ${moves === 1 ? "move" : "moves"}!`;
          if (status) status.textContent = message;
          if (winMessage) winMessage.textContent = message;
          if (winScreen) winScreen.hidden = false;
          launchFireworks();
          playAgainBtn?.focus({ preventScroll: true });
        }
      } else {
        locked = true;
        mismatchTimer = window.setTimeout(() => {
          open.forEach((i) => { cards[i].revealed = false; });
          open = [];
          locked = false;
          render();
        }, 750);
      }
    }
    render();
  });

  restartBtn.addEventListener("click", reset);
  playAgainBtn?.addEventListener("click", () => {
    reset();
    board.querySelector(".memory-card")?.focus({ preventScroll: true });
  });
  reset();
}

initMemoryMatch();

/* ---------------- 8. Extras ---------------- */
/* Live clock */
const clockEl = $("#clock");
function tickClock() {
  const now = new Date();
  const text =
    String(now.getHours()).padStart(2, "0") + ":" +
    String(now.getMinutes()).padStart(2, "0");
  if (clockEl) clockEl.textContent = text;
}
tickClock();
window.setInterval(tickClock, 15000);

/* Footer year */
const yearEl = $("#year");
if (yearEl) yearEl.textContent = String(new Date().getFullYear());

/* Reveal on scroll */
const revealEls = $$(".reveal");
if ("IntersectionObserver" in window) {
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("visible");
          io.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.1, rootMargin: "0px 0px -40px 0px" }
  );
  revealEls.forEach((el) => io.observe(el));
} else {
  revealEls.forEach((el) => el.classList.add("visible"));
}

/* ---------------- 9. Ambient music ---------------- */
const musicToggle = $("#musicToggle");
const musicToggleStatus = $("#musicToggleStatus");
const musicPopover = $("#musicPopover");
const musicClose = $("#musicClose");
const musicPlay = $("#musicPlay");
const musicPlayLabel = $("#musicPlayLabel");
const musicVolume = $("#musicVolume");
const musicVolumeValue = $("#musicVolumeValue");
const musicStatus = $("#musicStatus");
const ambientAudio = $("#ambientAudio");
const quickMusicPlay = $("#quickMusicPlay");
const quickMusicPlayLabel = $("#quickMusicPlayLabel");
const quickMusicStatus = $("#quickMusicStatus");
const quickMusicVolume = $("#quickMusicVolume");
const quickMusicVolumeValue = $("#quickMusicVolumeValue");

function setMusicPopover(open) {
  if (!musicToggle || !musicPopover) return;
  musicPopover.hidden = !open;
  if (open) musicClose?.focus();
}

musicToggle?.addEventListener("click", () => {
  toggleMusicPlayback();
});
musicClose?.addEventListener("click", () => {
  setMusicPopover(false);
  musicToggle?.focus();
});
document.addEventListener("click", (event) => {
  const target = event.target;
  if (musicPopover && !musicPopover.hidden && !(target instanceof Element && target.closest("#musicWidget"))) {
    setMusicPopover(false);
  }
});
document.addEventListener("keydown", (event) => {
  const target = event.target;
  const isMusicControl = target instanceof Element && target.closest("#musicWidget");
  const isInteractiveTarget = target instanceof Element && target.closest("button, a, input, textarea, select, [contenteditable='true']");

  // Enter opens the Music player from non-interactive page content while
  // preserving native keyboard activation for buttons and other controls.
  if (event.key === "Enter" && !isInteractiveTarget && musicPopover?.hidden) {
    setMusicPopover(true);
    return;
  }

  if (event.key === "Escape" && musicPopover && !musicPopover.hidden) {
    setMusicPopover(false);
    musicToggle?.focus();
  }
});

if (ambientAudio) {
  ambientAudio.volume = Number(musicVolume?.value || 35) / 100;
  const initialVolume = musicVolume?.value || 35;
  if (musicVolumeValue) musicVolumeValue.textContent = `${initialVolume}%`;
  if (quickMusicVolume) quickMusicVolume.value = initialVolume;
  if (quickMusicVolumeValue) quickMusicVolumeValue.textContent = `${initialVolume}%`;
}

musicVolume?.addEventListener("input", () => {
  if (ambientAudio) ambientAudio.volume = Number(musicVolume.value) / 100;
  musicVolumeValue.textContent = `${musicVolume.value}%`;
  if (quickMusicVolume) quickMusicVolume.value = musicVolume.value;
  if (quickMusicVolumeValue) quickMusicVolumeValue.textContent = `${musicVolume.value}%`;
});
quickMusicVolume?.addEventListener("input", () => {
  if (ambientAudio) ambientAudio.volume = Number(quickMusicVolume.value) / 100;
  if (musicVolume) musicVolume.value = quickMusicVolume.value;
  quickMusicVolumeValue.textContent = `${quickMusicVolume.value}%`;
  if (musicVolumeValue) musicVolumeValue.textContent = `${quickMusicVolume.value}%`;
});

async function toggleMusicPlayback() {
  if (!ambientAudio) return;
  if (!ambientAudio.paused) {
    ambientAudio.pause();
    return;
  }
  if (musicStatus) musicStatus.textContent = "Connecting to the live stream…";
  if (quickMusicStatus) quickMusicStatus.textContent = "Connecting to the live stream…";
  try {
    await ambientAudio.play();
  } catch {
    const message = "Could not start the stream. Check your connection or try again later.";
    if (musicStatus) musicStatus.textContent = message;
    if (quickMusicStatus) quickMusicStatus.textContent = message;
  }
}
musicPlay?.addEventListener("click", toggleMusicPlayback);
quickMusicPlay?.addEventListener("click", toggleMusicPlayback);

ambientAudio?.addEventListener("play", () => {
  musicPlay.setAttribute("aria-pressed", "true");
  musicPlayLabel.textContent = "Pause music";
  musicStatus.textContent = "Streaming now · FluxFM Chillhop";
  if (musicToggleStatus) musicToggleStatus.textContent = "Lo-fi music is playing.";
  musicToggle?.classList.add("is-playing");
  musicToggle?.setAttribute("aria-pressed", "true");
  musicToggle?.setAttribute("aria-label", "Pause lo-fi music");
  const toggleLabel = musicToggle?.querySelector(".music-toggle-label");
  if (toggleLabel) toggleLabel.textContent = "PAUSE";
  if (quickMusicPlayLabel) quickMusicPlayLabel.textContent = "Pause music";
  if (quickMusicStatus) quickMusicStatus.textContent = "Streaming now · FluxFM Chillhop";
});
ambientAudio?.addEventListener("pause", () => {
  musicPlay.setAttribute("aria-pressed", "false");
  musicPlayLabel.textContent = "Play music";
  musicStatus.textContent = "Music is off";
  if (musicToggleStatus) musicToggleStatus.textContent = "Lo-fi music paused.";
  musicToggle?.classList.remove("is-playing");
  musicToggle?.setAttribute("aria-pressed", "false");
  musicToggle?.setAttribute("aria-label", "Play lo-fi music");
  const toggleLabel = musicToggle?.querySelector(".music-toggle-label");
  if (toggleLabel) toggleLabel.textContent = "LO-FI";
  if (quickMusicPlayLabel) quickMusicPlayLabel.textContent = "Play music";
  if (quickMusicStatus) quickMusicStatus.textContent = "Music is off";
});
ambientAudio?.addEventListener("error", () => {
  const message = "Stream unavailable. Check your connection or try again later.";
  if (musicStatus) musicStatus.textContent = message;
  if (musicToggleStatus) musicToggleStatus.textContent = "Lo-fi stream unavailable. Check your connection and try again.";
  if (quickMusicStatus) quickMusicStatus.textContent = message;
});

/* ---------------- Top-bar quick settings menu ---------------- */
const quickMenu = $("#quickMenu");
const quickMenuToggle = $("#quickMenuToggle");
const quickMenuPanel = $("#quickMenuPanel");
function setQuickMenu(open) {
  if (!quickMenuToggle || !quickMenuPanel) return;
  quickMenuPanel.hidden = !open;
  quickMenuToggle.setAttribute("aria-expanded", String(open));
  if (open) quickMenuPanel.querySelector("[data-theme-btn][aria-pressed='true']")?.focus();
}
quickMenuToggle?.addEventListener("click", () => setQuickMenu(quickMenuPanel.hidden));
quickMenuPanel?.addEventListener("click", (event) => {
  if (event.target.closest("[data-theme-btn]")) setQuickMenu(false);
  if (event.target.closest("a")) setQuickMenu(false);
});
document.addEventListener("click", (event) => {
  if (quickMenu && !quickMenu.contains(event.target)) setQuickMenu(false);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && quickMenuPanel && !quickMenuPanel.hidden) {
    setQuickMenu(false);
    quickMenuToggle?.focus();
  }
});
