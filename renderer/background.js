// Escena de Minecraft estilo "shaders" dibujada con canvas (sin imágenes):
// cielo de atardecer, sol cuadrado con brillo y rayos de luz, nubes de bloques,
// colinas en capas con neblina, agua con reflejo del sol, árboles y luciérnagas.
// Se dibuja en baja resolución y se amplía para conservar el aspecto pixelado.
(() => {
  const canvas = document.getElementById("bg");
  if (!canvas) return;
  const W = 480, H = 270;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  const SUN = { x: 336, y: 134 };
  const WATER_Y = 188;
  const BLOCK = 6;

  const rand = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  const noise = (x) => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return rand(i) * (1 - u) + rand(i + 1) * u; };
  const fbm = (x) => noise(x) * 0.55 + noise(x * 2.1 + 10) * 0.3 + noise(x * 4.3 + 20) * 0.15;

  // Colinas de lejos a cerca. "par" = velocidad relativa al desplazarse.
  const LAYERS = [
    { par: 0.10, base: 212, amp: 100, scale: 130, seed: 3,  step: 6, top: "#d77d98", body: "#b5658c" },
    { par: 0.22, base: 214, amp: 84,  scale: 96,  seed: 41, step: 4, top: "#a1619a", body: "#7d4b84" },
    { par: 0.40, base: 216, amp: 66,  scale: 66,  seed: 87, step: 4, top: "#6b5284", body: "#503e72" },
  ];

  const sky = ctx.createLinearGradient(0, 0, 0, WATER_Y);
  [[0, "#12163d"], [0.30, "#3a2a78"], [0.58, "#b24f87"], [0.80, "#ff8f6b"], [1, "#ffd18a"]].forEach(([p, c]) => sky.addColorStop(p, c));

  const water = ctx.createLinearGradient(0, WATER_Y, 0, H);
  [[0, "#ff9f78"], [0.22, "#c45f8c"], [1, "#2a1f50"]].forEach(([p, c]) => water.addColorStop(p, c));

  const stars = Array.from({ length: 70 }, (_, i) => ({ x: rand(i * 3.3) * W, y: rand(i * 5.1) * 105, ph: rand(i * 7.7) * 6.28 }));
  const clouds = Array.from({ length: 9 }, (_, i) => ({ x: rand(i * 9.1) * (W + 160), y: 22 + rand(i * 4.7) * 78, w: 44 + rand(i * 2.9) * 70, s: 1.2 + rand(i * 6.3) * 1.6 }));
  const flies = Array.from({ length: 30 }, (_, i) => ({ x: rand(i * 1.7) * W, y0: rand(i * 8.3) * 160, v: 3 + rand(i * 2.1) * 5, ph: rand(i * 5.9) * 6.28 }));

  const glow = (cx, cy, r, a0) => {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `rgba(255, 196, 120, ${a0})`);
    g.addColorStop(1, "rgba(255, 150, 90, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  };

  function drawHills(layer, scroll) {
    const px = scroll * layer.par;
    const col0 = Math.floor(px / BLOCK);
    const frac = px - col0 * BLOCK;
    for (let i = 0; i <= W / BLOCK + 1; i++) {
      const x = Math.round(i * BLOCK - frac);
      const valley = 1 - 0.75 * Math.exp(-Math.pow((x - SUN.x) / 80, 2)); // hueco para ver el sol
      let y = layer.base - fbm(((col0 + i) * BLOCK) / layer.scale + layer.seed) * layer.amp * valley;
      y = Math.round(y / layer.step) * layer.step;
      ctx.fillStyle = layer.body;
      ctx.fillRect(x, y, BLOCK, H - y);
      ctx.fillStyle = layer.top;
      ctx.fillRect(x, y, BLOCK, 3);
    }
    // neblina entre capas
    const haze = ctx.createLinearGradient(0, WATER_Y - 80, 0, WATER_Y);
    haze.addColorStop(0, "rgba(255, 150, 110, 0)");
    haze.addColorStop(1, "rgba(255, 160, 115, 0.22)");
    ctx.fillStyle = haze;
    ctx.fillRect(0, WATER_Y - 80, W, 80);
  }

  function drawShore(scroll) {
    const par = 0.9;
    const px = scroll * par;
    const col0 = Math.floor(px / BLOCK);
    const frac = px - col0 * BLOCK;
    let lastTree = -10;
    for (let i = 0; i <= W / BLOCK + 1; i++) {
      const ci = col0 + i;
      const x = Math.round(i * BLOCK - frac);
      const y = Math.round((266 - fbm((ci * BLOCK) / 44 + 120) * 30) / 4) * 4;
      ctx.fillStyle = "#150f2b";
      ctx.fillRect(x, y, BLOCK, H - y);
      ctx.fillStyle = "#231a42";
      ctx.fillRect(x, y, BLOCK, 3);
      if (rand(ci * 3.1 + 5) > 0.88 && ci - lastTree > 4) {
        lastTree = ci;
        ctx.fillStyle = "#1c132d";
        ctx.fillRect(x, y - 20, BLOCK, 20);                // tronco
        ctx.fillStyle = "#16142f";
        ctx.fillRect(x - 6, y - 34, BLOCK * 3, 14);        // copa
        ctx.fillRect(x, y - 40, BLOCK, 6);
      }
    }
  }

  function draw(t) {
    const scroll = t * 7;
    ctx.globalCompositeOperation = "source-over";

    // cielo + estrellas
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, WATER_Y);
    for (const s of stars) {
      const a = (1 - s.y / 105) * (0.35 + 0.65 * Math.abs(Math.sin(t * 1.4 + s.ph)));
      ctx.fillStyle = `rgba(255, 245, 230, ${a.toFixed(3)})`;
      ctx.fillRect(Math.round(s.x), Math.round(s.y), 1, 1);
    }

    // brillo del sol + rayos de luz
    ctx.globalCompositeOperation = "lighter";
    glow(SUN.x, SUN.y, 190, 0.55 + 0.05 * Math.sin(t * 1.3));
    for (let i = 0; i < 18; i++) {
      const a = i * (Math.PI * 2 / 18) + t * 0.035;
      const w = 0.07;
      ctx.fillStyle = `rgba(255, 190, 120, ${(0.05 + 0.035 * Math.sin(i * 2.7 + t * 0.9)).toFixed(3)})`;
      ctx.beginPath();
      ctx.moveTo(SUN.x, SUN.y);
      ctx.lineTo(SUN.x + Math.cos(a - w) * 520, SUN.y + Math.sin(a - w) * 520);
      ctx.lineTo(SUN.x + Math.cos(a + w) * 520, SUN.y + Math.sin(a + w) * 520);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";

    // sol cuadrado
    ctx.fillStyle = "#fff1c9";
    ctx.fillRect(SUN.x - 14, SUN.y - 14, 28, 28);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(SUN.x - 9, SUN.y - 9, 18, 18);

    // nubes de bloques
    for (const c of clouds) {
      const x = Math.round(((c.x + t * c.s) % (W + 200)) - 120);
      const y = Math.round(c.y);
      ctx.fillStyle = "rgba(255, 214, 205, 0.80)";
      ctx.fillRect(x, y, c.w, 6);
      ctx.fillRect(x + 10, y - 5, c.w - 24, 5);
      ctx.fillStyle = "rgba(196, 120, 172, 0.75)";
      ctx.fillRect(x + 4, y + 6, c.w - 12, 3);
    }

    // colinas lejanas -> cercanas
    for (const layer of LAYERS) drawHills(layer, scroll);

    // agua + reflejo del sol
    ctx.fillStyle = water;
    ctx.fillRect(0, WATER_Y, W, H - WATER_Y);
    ctx.globalCompositeOperation = "lighter";
    for (let y = WATER_Y; y < H; y += 2) {
      const d = (y - WATER_Y) / (H - WATER_Y);
      const wob = Math.sin(y * 0.9 + t * 2.2) * (2 + d * 10);
      const w = (10 + d * 46) * (0.6 + 0.4 * Math.sin(y * 1.7 - t * 3));
      ctx.fillStyle = `rgba(255, 215, 150, ${((1 - d) * 0.55).toFixed(3)})`;
      ctx.fillRect(Math.round(SUN.x + wob - w / 2), y, Math.max(1, Math.round(w)), 1);
    }
    ctx.globalCompositeOperation = "source-over";

    // orilla con árboles (primer plano)
    drawShore(scroll);

    // luciérnagas
    ctx.globalCompositeOperation = "lighter";
    for (const f of flies) {
      const x = Math.round((f.x + Math.sin(t * 0.5 + f.ph) * 12 + W) % W);
      const y = Math.round(268 - ((f.y0 + t * f.v) % 170));
      const a = 0.5 + 0.5 * Math.sin(t * 2 + f.ph);
      ctx.fillStyle = `rgba(255, 220, 140, ${(a * 0.25).toFixed(3)})`;
      ctx.fillRect(x - 1, y - 1, 4, 4);
      ctx.fillStyle = `rgba(255, 235, 170, ${a.toFixed(3)})`;
      ctx.fillRect(x, y, 2, 2);
    }

    // "bloom" final + viñeta
    glow(SUN.x, SUN.y, 120, 0.22);
    ctx.globalCompositeOperation = "source-over";
    const vig = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.95);
    vig.addColorStop(0, "rgba(0, 0, 0, 0)");
    vig.addColorStop(1, "rgba(0, 0, 0, 0.55)");
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, W, H);
  }

  let paused = false;
  let last = -100;
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function frame(ts) {
    if (!reduce) requestAnimationFrame(frame);
    if (paused || document.hidden) return;
    if (ts - last < 33) return; // ~30 fps
    last = ts;
    draw(ts / 1000);
  }
  requestAnimationFrame(frame);

  // El launcher pausa la animación mientras juegas, para no gastar CPU
  window.setBackgroundPaused = (v) => { paused = !!v; };
})();
