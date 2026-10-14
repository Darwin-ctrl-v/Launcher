const $ = (id) => document.getElementById(id);
let currentUser = null;
let currentView = "play";

/* ---------- utilidades ---------- */
function readableOn(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return "#06140d";
  const n = parseInt(m[1], 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.6 ? "#0b0d10" : "#ffffff";
}
const fmtGB = (mb) => (mb / 1024).toFixed(mb % 1024 ? 1 : 0) + " GB";

/* ---------- fondo: si existe assets/background.jpg se usa esa imagen ---------- */
const probe = new Image();
probe.onload = () => document.body.classList.add("has-image");
probe.src = "assets/background.jpg";
$("logo").addEventListener("error", (e) => e.target.remove());

/* ---------- navegación de la barra lateral ---------- */
function showView(name) {
  currentView = name;
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === "view-" + name));
  document.querySelectorAll(".navbtn").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
  if (name === "mods") loadMods();
  if (name === "options") loadOptions();
  if (name === "skin") openSkinView();
  if (name === "log") $("log").scrollTop = $("log").scrollHeight;
}
document.querySelectorAll(".navbtn").forEach((b) => b.addEventListener("click", () => showView(b.dataset.view)));

/* ---------- menú hamburguesa (iniciar/cerrar sesión y registro) ---------- */
const closeMenu = () => {
  $("menu").hidden = true;
  $("menuBtn").classList.remove("open");
};
$("menuBtn").addEventListener("click", (e) => {
  e.stopPropagation();
  const willOpen = $("menu").hidden;
  $("menu").hidden = !willOpen;
  $("menuBtn").classList.toggle("open", willOpen);
});
document.addEventListener("click", (e) => { if (!$("menu").hidden && !$("menu").contains(e.target)) closeMenu(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenu(); });
$("menuLog").onclick = () => { closeMenu(); showView("log"); };
$("menuAuth").onclick = () => { closeMenu(); toggleAuth(); };

async function toggleAuth() {
  $("menuAuth").disabled = true;
  if (currentUser) {
    await window.api.logout();
    setUser(null);
    if (currentView === "skin") showView("play");
  } else {
    const r = await window.api.login();
    if (r.ok) setUser(r.name);
  }
  $("menuAuth").disabled = false;
}

/* ---------- usuario ---------- */
function setUser(name) {
  const same = name && name === currentUser && look;
  currentUser = name || null;
  $("userName").textContent = name || "Sin sesión";
  $("menuAuth").textContent = name ? "Cerrar sesión" : "Iniciar sesión";
  if (same) return;

  look = null;
  $("skinBox").classList.add("empty");
  destroySkinViewer("side");
  if (name) loadLook();
}

/* =====================================================================
   SKIN 3D CON SKINVIEW3D
   ===================================================================== */
let look = null;               // { name, variant, skin, cape, capes[] } de tu cuenta
let pending = null;            // skin elegida pero aún no aplicada: { dataUrl, name }
let chosenVariant = "classic"; // modelo para la skin que vas a subir

// Instancias de skinview3d
let sideViewer = null;  // barra lateral (pequeño)
let bigViewer = null;   // panel de skin (grande)

function destroySkinViewer(which) {
  if (which === "side" && sideViewer) {
    sideViewer.dispose();
    sideViewer = null;
    const container = $("skinViewerContainer");
    if (container) container.innerHTML = "";
  }
  if (which === "big" && bigViewer) {
    bigViewer.dispose();
    bigViewer = null;
    const container = $("bigViewerContainer");
    if (container) container.innerHTML = "";
  }
}

function createSkinViewer(container, opts = {}) {
  const rect = container.getBoundingClientRect();
  const w = Math.max(rect.width, 100);
  const h = Math.max(rect.height, 100);

  const viewer = new skinview3d.SkinViewer({
    canvas: document.createElement("canvas"),
    width: w,
    height: h,
    ...opts,
  });

  // Fondo transparente
  viewer.background = null;
  viewer.renderer.setClearColor(0x000000, 0);

  container.innerHTML = "";
  container.appendChild(viewer.canvas);

  return viewer;
}

function setSkinMsg(text, bad) {
  $("skinMsg").textContent = text || "";
  $("skinMsg").classList.toggle("bad", !!bad);
}

async function paintSide() {
  if (!look || !look.skin) return;
  try {
    const container = $("skinViewerContainer");
    if (!container) return;

    destroySkinViewer("side");
    sideViewer = createSkinViewer(container);

    await sideViewer.loadSkin(look.skin, { model: look.variant === "SLIM" ? "slim" : "default" });
    if (look.cape) {
      await sideViewer.loadCape(look.cape);
    }

    // Configurar vista: busto fijo (sin giro continuo) en diagonal
    sideViewer.autoRotate = false;
    sideViewer.animation = new skinview3d.IdleAnimation();
    sideViewer.animation.speed = 0.5;
    sideViewer.playerObject.rotation.y = 0.45;
    sideViewer.zoom = 0.85;
    sideViewer.globalLight.intensity = 3.0;
    sideViewer.cameraLight.intensity = 0.2;

    $("skinBox").classList.remove("empty");
  } catch (err) {
    console.error("Error rendering skin (side):", err);
  }
}

async function paintBig() {
  if (!look) return;
  const skin = pending ? pending.dataUrl : look.skin;
  if (!skin) return;
  const slim = pending ? chosenVariant === "slim" : look.variant === "SLIM";

  try {
    const container = $("bigViewerContainer");
    if (!container) return;

    destroySkinViewer("big");
    bigViewer = createSkinViewer(container);

    await bigViewer.loadSkin(skin, { model: slim ? "slim" : "default" });
    if (look.cape) {
      await bigViewer.loadCape(look.cape);
    }

    // Posición de caminar en diagonal (walking animation)
    bigViewer.autoRotate = false;
    bigViewer.animation = new skinview3d.WalkingAnimation();
    bigViewer.animation.speed = 0.6;
    bigViewer.playerObject.rotation.y = 0.55;
    bigViewer.zoom = 0.9;
    bigViewer.globalLight.intensity = 3.0;
    bigViewer.cameraLight.intensity = 0.2;

    // Controles de rotación con mouse
    bigViewer.controls.enableRotate = true;
    bigViewer.controls.enableZoom = true;
    bigViewer.controls.enablePan = false;
  } catch (err) {
    console.error("Error rendering skin (big):", err);
  }
}

async function loadLook() {
  if (!currentUser) return;
  const r = await window.api.getProfile();
  if (!r.ok) { setSkinMsg("No se pudo cargar tu perfil: " + r.error, true); return; }
  look = r;
  if (!pending) chosenVariant = r.variant === "SLIM" ? "slim" : "classic";
  paintSide();
  paintBig();
  renderCapes();
  syncButtons();
}

function openSkinView() {
  if (!look) loadLook();
  // Espera un frame para que el container esté visible y tenga dimensiones
  requestAnimationFrame(() => paintBig());
  syncButtons();
}

function syncButtons() {
  $("varClassic").classList.toggle("active", chosenVariant === "classic");
  $("varSlim").classList.toggle("active", chosenVariant === "slim");
}

// Dibuja el frente de una capa (zona 10x16 de la textura de 64x32)
function drawCapeThumb(canvas, src) {
  canvas.width = 20;
  canvas.height = 32;
  if (!src) return;
  const img = new Image();
  img.onload = () => {
    const k = img.width / 64;
    const c = canvas.getContext("2d");
    c.imageSmoothingEnabled = false;
    c.drawImage(img, 1 * k, 1 * k, 10 * k, 16 * k, 0, 0, canvas.width, canvas.height);
  };
  img.src = src;
}

function renderCapes() {
  const grid = $("capeGrid");
  grid.textContent = "";
  const capes = (look && look.capes) || [];

  const mk = (id, name, tex, active) => {
    const b = document.createElement("button");
    b.className = "cape" + (active ? " active" : "");
    const cv = document.createElement("canvas");
    drawCapeThumb(cv, tex);
    const label = document.createElement("span");
    label.className = "cname";
    label.textContent = name;
    b.append(cv, label);
    b.onclick = () => equipCape(id);
    grid.appendChild(b);
  };

  mk(null, "Sin capa", null, !capes.some((c) => c.active));
  for (const c of capes) mk(c.id, c.alias, c.texture, c.active);

  const old = $("noCapes");
  if (old) old.remove();
  if (!capes.length) {
    const p = document.createElement("div");
    p.id = "noCapes";
    p.className = "hint";
    p.textContent = "Tu cuenta no tiene capas.";
    grid.parentElement.insertBefore(p, $("skinMsg"));
  }
}

async function equipCape(id) {
  setSkinMsg("Cambiando capa...");
  const r = await window.api.setCape(id);
  if (!r.ok) { setSkinMsg(r.error, true); return; }
  await loadLook();
  setSkinMsg(id ? "Capa equipada. Pulsa Espalda para verla." : "Capa quitada.");
}

$("pickSkin").onclick = async () => {
  const r = await window.api.pickSkin();
  if (!r.ok) { if (r.error) setSkinMsg(r.error, true); return; }
  pending = { dataUrl: r.dataUrl, name: r.name };
  $("pendingName").textContent = `Vista previa: ${r.name} (${r.width}x${r.height})`;
  $("pendingBox").hidden = false;
  setSkinMsg("");
  paintBig();
};

for (const [id, v] of [["varClassic", "classic"], ["varSlim", "slim"]]) {
  $(id).onclick = () => { chosenVariant = v; syncButtons(); if (pending) paintBig(); };
}

$("cancelSkin").onclick = () => {
  pending = null;
  $("pendingBox").hidden = true;
  if (look) chosenVariant = look.variant === "SLIM" ? "slim" : "classic";
  syncButtons();
  paintBig();
};

$("applySkin").onclick = async () => {
  $("applySkin").disabled = true;
  setSkinMsg("Subiendo skin...");
  const r = await window.api.uploadSkin(chosenVariant);
  $("applySkin").disabled = false;
  if (!r.ok) { setSkinMsg(r.error, true); return; }
  pending = null;
  $("pendingBox").hidden = true;
  await loadLook();
  setSkinMsg("Skin actualizada.");
};

$("skinBack").onclick = () => showView("play");

// Click en el busto de la barra lateral = abrir el panel de skin y capa
$("skinBox").addEventListener("click", () => {
  if (!currentUser) toggleAuth();
  else showView("skin");
});

/* ---------- pestaña Mods ---------- */
let modsCache = [];
let modsPending = false;

async function loadMods() {
  const { items, pending: pend } = await window.api.listMods();
  modsPending = pend;
  modsCache = items;
  renderMods();
}

// Icono del mod (viene de Modrinth); si falta o no carga, se muestra la primera letra
function makeIcon(m) {
  const holder = document.createElement("span");
  holder.className = "mico";
  const letra = () => { holder.textContent = (m.title[0] || "?").toUpperCase(); };
  if (m.icon) {
    const img = new Image();
    img.alt = "";
    img.loading = "lazy";
    img.onerror = () => { img.remove(); letra(); };
    img.src = m.icon;
    holder.appendChild(img);
  } else {
    letra();
  }
  return holder;
}

function renderMods() {
  const q = $("modFilter").value.trim().toLowerCase();
  const list = $("modList");
  list.textContent = "";
  const rows = modsCache.filter((m) => m.title.toLowerCase().includes(q));

  $("modsTitle").textContent = `MODS (${modsCache.length})`;
  for (const m of rows) {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.className = "mname";
    name.textContent = m.title;
    if (m.lib) {
      const tag = document.createElement("span");
      tag.className = "lib";
      tag.textContent = "[lib]";
      name.appendChild(tag);
    }
    const ver = document.createElement("span");
    ver.className = "ver";
    ver.textContent = m.version;
    li.append(makeIcon(m), name, ver);
    list.appendChild(li);
  }
  if (!rows.length) {
    const li = document.createElement("li");
    li.textContent = "No hay resultados.";
    list.appendChild(li);
  }
  $("modsHint").textContent = modsPending
    ? "Estos mods se descargarán la primera vez que pulses JUGAR."
    : "[lib] = librería que otro mod necesita.";
}
$("modFilter").addEventListener("input", renderMods);

/* ---------- pestaña Opciones ---------- */
function updateRamUI(mb) {
  $("ramValue").textContent = fmtGB(mb);
  $("ramNote").textContent = mb < 2048
    ? "Muy poca memoria: el juego puede ir lento o fallar al cargar."
    : "Se aplica la próxima vez que pulses JUGAR.";
}

async function loadOptions() {
  const s = await window.api.getSettings();
  // RAM
  const sl = $("ramSlider");
  sl.min = s.minMB; sl.max = s.maxMB; sl.step = s.stepMB; sl.value = s.ramMB;
  $("ramMin").textContent = fmtGB(s.minMB);
  $("ramMax").textContent = fmtGB(s.maxMB);
  $("ramInfo").textContent = `RAM de tu PC: ${fmtGB(s.totalMB)}. El máximo es el 75% para que Windows no se quede corto.`;
  updateRamUI(s.ramMB);

  // Resolución
  $("resWidth").value = s.resWidth || 854;
  $("resHeight").value = s.resHeight || 480;

  // Java
  $("javaPath").value = s.javaPath || "";
  $("jvmArgs").value = s.jvmArgs || "";
}

$("ramSlider").addEventListener("input", () => updateRamUI(Number($("ramSlider").value)));
$("ramSlider").addEventListener("change", async () => {
  const s = await window.api.setRam(Number($("ramSlider").value));
  $("ramSlider").value = s.ramMB;
  updateRamUI(s.ramMB);
});

// Resolución: guardar al cambiar
function saveResolution() {
  const w = Math.max(640, Math.min(3840, Number($("resWidth").value) || 854));
  const h = Math.max(360, Math.min(2160, Number($("resHeight").value) || 480));
  $("resWidth").value = w;
  $("resHeight").value = h;
  window.api.setSettings({ resWidth: w, resHeight: h });
}
$("resWidth").addEventListener("change", saveResolution);
$("resHeight").addEventListener("change", saveResolution);

$("resReset").onclick = () => {
  $("resWidth").value = 854;
  $("resHeight").value = 480;
  saveResolution();
};

// Presets de resolución
document.querySelectorAll(".res-preset").forEach((btn) => {
  btn.addEventListener("click", () => {
    $("resWidth").value = btn.dataset.w;
    $("resHeight").value = btn.dataset.h;
    saveResolution();
  });
});

// Java: guardar al cambiar
$("jvmArgs").addEventListener("change", () => {
  window.api.setSettings({ jvmArgs: $("jvmArgs").value.trim() });
});

/* ---------- botón JUGAR y modo carga ---------- */
function setState(state) {
  const idle = state === "idle";
  $("idleBox").hidden = !idle;
  $("loadBox").hidden = idle;

  if (state === "loading") $("loadText").textContent = "CARGANDO";
  if (state === "launching") { $("loadText").textContent = "LAUNCHING GAME"; setFill(100); }
  if (state === "running") { $("loadText").textContent = "GAME RUNNING"; setFill(100); }
  if (idle) setFill(0);

  if (window.setBackgroundPaused) window.setBackgroundPaused(state === "running"); // ahorra CPU mientras juegas

  // Pausar animaciones de skin mientras se juega para ahorrar CPU
  if (sideViewer && sideViewer.animation) {
    sideViewer.animation.paused = (state === "running");
  }
  if (bigViewer && bigViewer.animation) {
    bigViewer.animation.paused = (state === "running");
  }
}

function setFill(pct) {
  $("fill").style.width = pct + "%";
  $("pct").textContent = Math.round(pct) + "%";
}

$("playBtn").onclick = async () => {
  $("status").textContent = "";
  $("status").classList.remove("bad");
  const r = await window.api.play();
  if (!r.ok) $("status").textContent += "  (mira el Registro, en el menú)";
  const u = await window.api.getSession();
  setUser(u && u.name);
};

/* ---------- eventos que llegan del launcher ---------- */
window.api.onState(setState);
window.api.onProgress((p) => setFill(p.pct));
window.api.onStatus((t) => {
  $("status").textContent = t;
  $("status").classList.toggle("bad", /^Error/.test(t));
});
window.api.onLog((line) => {
  const el = $("log");
  el.textContent += line + "\n";
  if (el.textContent.length > 200000) el.textContent = el.textContent.slice(-100000);
  el.scrollTop = el.scrollHeight;
});

/* ---------- arranque ---------- */
(async () => {
  const b = await window.api.getBranding();
  $("title").textContent = b.title || "Mi Launcher";
  $("subtitle").textContent = b.subtitle || "";
  document.title = b.title || "Mi Launcher";

  if (b.accentColor) {
    document.documentElement.style.setProperty("--accent", b.accentColor);
    document.documentElement.style.setProperty("--accent-text", readableOn(b.accentColor));
  }
  const loader = b.loader ? b.loader[0].toUpperCase() + b.loader.slice(1) : "";
  $("meta").textContent = `Minecraft ${b.minecraft} · ${loader}`;

  const s = await window.api.getSession();
  setUser(s && s.name);
})();

(() => {
  const banner = document.getElementById("updateBanner");
  const text = document.getElementById("updateText");
  const bar = document.getElementById("updateBar");
  const fill = document.getElementById("updateFill");
  const btns = document.getElementById("updateBtns");
  const btnNow = document.getElementById("updateNow");
  const btnLater = document.getElementById("updateLater");

  const show = () => banner.classList.add("show");
  const hide = () => banner.classList.remove("show");

  bar.hidden = true;
  btns.hidden = true;

  window.api.onUpdate((u) => {
    if (u.state === "checking") {
      text.textContent = "Buscando actualizaciones...";
      bar.hidden = true;
      btns.hidden = true;
      show();
    } else if (u.state === "downloading") {
      text.textContent = `Descargando actualización... ${u.pct || 0}%`;
      fill.style.width = (u.pct || 0) + "%";
      bar.hidden = false;
      btns.hidden = true;
      show();
    } else if (u.state === "ready") {
      text.textContent = `Nueva versión v${u.version} lista`;
      bar.hidden = true;
      btns.hidden = false;
      show();
    } else {
      hide(); // sin actualización o error
    }
  });

  // Mientras Minecraft está abierto, no dejar reiniciar el launcher
  window.api.onState((s) => {
    btnNow.disabled = s === "loading" || s === "launching" || s === "running";
  });

  btnNow.onclick = () => window.api.installUpdate();
  btnLater.onclick = hide;
})();