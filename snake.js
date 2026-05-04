(() => {
  const canvas = document.getElementById("board");
  const ctx = canvas.getContext("2d");
  const scoreEl = document.getElementById("score");
  const bestEl = document.getElementById("best");
  const overlay = document.getElementById("overlay");
  const overlayTitle = document.getElementById("overlay-title");
  const overlayText = document.getElementById("overlay-text");
  const startBtn = document.getElementById("start-btn");

  const GRID = 20;
  const CELL = canvas.width / GRID;
  const TICK_MS = 110;

  const STATE = { READY: "ready", PLAYING: "playing", PAUSED: "paused", OVER: "over" };

  let snake, dir, nextDir, food, score, best, state, timer;

  best = Number(localStorage.getItem("snake-best") || 0);
  bestEl.textContent = best;

  function reset() {
    const mid = Math.floor(GRID / 2);
    snake = [
      { x: mid - 1, y: mid },
      { x: mid - 2, y: mid },
      { x: mid - 3, y: mid },
    ];
    dir = { x: 1, y: 0 };
    nextDir = dir;
    score = 0;
    scoreEl.textContent = score;
    placeFood();
    draw();
  }

  function placeFood() {
    while (true) {
      const f = {
        x: Math.floor(Math.random() * GRID),
        y: Math.floor(Math.random() * GRID),
      };
      if (!snake.some((s) => s.x === f.x && s.y === f.y)) {
        food = f;
        return;
      }
    }
  }

  function step() {
    dir = nextDir;
    const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };

    if (
      head.x < 0 ||
      head.x >= GRID ||
      head.y < 0 ||
      head.y >= GRID ||
      snake.some((s) => s.x === head.x && s.y === head.y)
    ) {
      gameOver();
      return;
    }

    snake.unshift(head);

    if (head.x === food.x && head.y === food.y) {
      score += 1;
      scoreEl.textContent = score;
      if (score > best) {
        best = score;
        bestEl.textContent = best;
        localStorage.setItem("snake-best", String(best));
      }
      placeFood();
    } else {
      snake.pop();
    }

    draw();
  }

  function draw() {
    ctx.fillStyle = getColor("--grid");
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = getColor("--food");
    drawCell(food.x, food.y, 0.85);

    snake.forEach((seg, i) => {
      ctx.fillStyle = i === 0 ? getColor("--snake-head") : getColor("--snake");
      drawCell(seg.x, seg.y, i === 0 ? 0.95 : 0.88);
    });
  }

  function drawCell(x, y, scale) {
    const size = CELL * scale;
    const offset = (CELL - size) / 2;
    const radius = size * 0.2;
    const px = x * CELL + offset;
    const py = y * CELL + offset;
    ctx.beginPath();
    ctx.roundRect(px, py, size, size, radius);
    ctx.fill();
  }

  function getColor(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function start() {
    if (state === STATE.OVER || state === STATE.READY) reset();
    state = STATE.PLAYING;
    overlay.classList.add("hidden");
    clearInterval(timer);
    timer = setInterval(step, TICK_MS);
  }

  function pause() {
    if (state !== STATE.PLAYING) return;
    state = STATE.PAUSED;
    clearInterval(timer);
    showOverlay("Paused", "Press Space to resume.");
  }

  function gameOver() {
    state = STATE.OVER;
    clearInterval(timer);
    showOverlay("Game Over", `Score: ${score}. Press Space or R to play again.`);
  }

  function showOverlay(title, text) {
    overlayTitle.textContent = title;
    overlayText.textContent = text;
    overlay.classList.remove("hidden");
  }

  function setDirection(nx, ny) {
    if (snake.length > 1 && nx === -dir.x && ny === -dir.y) return;
    nextDir = { x: nx, y: ny };
  }

  document.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    if (k === "arrowup" || k === "w") {
      setDirection(0, -1);
      e.preventDefault();
    } else if (k === "arrowdown" || k === "s") {
      setDirection(0, 1);
      e.preventDefault();
    } else if (k === "arrowleft" || k === "a") {
      setDirection(-1, 0);
      e.preventDefault();
    } else if (k === "arrowright" || k === "d") {
      setDirection(1, 0);
      e.preventDefault();
    } else if (k === " ") {
      if (state === STATE.PLAYING) pause();
      else start();
      e.preventDefault();
    } else if (k === "r") {
      reset();
      start();
    }
  });

  startBtn.addEventListener("click", start);

  state = STATE.READY;
  reset();
  showOverlay("Ready?", "Use arrow keys or WASD to move. Press Space to start.");
})();
