const { app, BrowserWindow, ipcMain, safeStorage, dialog } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("path");
const fs = require("fs");
const os = require("os");
const config = require("./config");
const L = require("./launcher");

let win;
let session = null; // { auth, saved, name }
let playing = false;

const gameDir = () => path.join(app.getPath("appData"), config.appName, "game");
const sessionFile = () => path.join(app.getPath("userData"), "session.bin");
const settingsFile = () => path.join(app.getPath("userData"), "settings.json");

const send = (channel, data) => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, data);
};
const status = (t) => send("status", t);

/* ---- Sesión cifrada (para no iniciar sesión cada vez) ---- */
function saveSession(token) {
  try {
    if (!token || !safeStorage.isEncryptionAvailable()) return;
    fs.writeFileSync(sessionFile(), safeStorage.encryptString(token));
  } catch (e) {
    console.error("No se pudo guardar la sesión:", e.message);
  }
}

function loadSavedToken() {
  try {
    if (!fs.existsSync(sessionFile()) || !safeStorage.isEncryptionAvailable()) return null;
    return safeStorage.decryptString(fs.readFileSync(sessionFile()));
  } catch {
    return null;
  }
}

async function ensureLogin(interactive) {
  if (session) return session;

  const token = loadSavedToken();
  if (token) {
    try {
      status("Recuperando sesión...");
      session = await L.loginSaved(token);
      saveSession(session.saved);
      return session;
    } catch {
      /* la sesión guardada caducó: se pide login normal */
    }
  }
  if (!interactive) return null;

  status("Abriendo inicio de sesión de Microsoft...");
  session = await L.loginMicrosoft();
  saveSession(session.saved);
  return session;
}

/* ---- Ajustes (RAM, resolución, Java) ---- */
function toMB(txt) {
  const m = /(\d+)\s*([gm])/i.exec(String(txt));
  if (!m) return 4096;
  return m[2].toLowerCase() === "g" ? Number(m[1]) * 1024 : Number(m[1]);
}

function ramLimits() {
  const totalMB = Math.floor(os.totalmem() / 1048576);
  const maxMB = Math.max(2048, Math.floor((totalMB * 0.75) / 512) * 512); // como mucho 75% de tu RAM
  return { totalMB, minMB: 1024, maxMB, stepMB: 512 };
}

function loadSettings() {
  try { return JSON.parse(fs.readFileSync(settingsFile(), "utf8")); } catch { return {}; }
}

function saveSettings(data) {
  const current = loadSettings();
  const merged = { ...current, ...data };
  try { fs.writeFileSync(settingsFile(), JSON.stringify(merged)); } catch {}
  return merged;
}

function currentRamMB() {
  const lim = ramLimits();
  const saved = loadSettings().ramMB;
  const v = Number(saved) || toMB(config.ram && config.ram.max);
  return Math.min(lim.maxMB, Math.max(lim.minMB, v));
}

function currentResolution() {
  const s = loadSettings();
  return { resWidth: Number(s.resWidth) || 854, resHeight: Number(s.resHeight) || 480 };
}

function currentJvmArgs() {
  const s = loadSettings();
  return s.jvmArgs || "";
}

ipcMain.handle("settings:get", async () => {
  const s = loadSettings();
  const javaPath = await L.findJava();
  return {
    ...ramLimits(),
    ramMB: currentRamMB(),
    resWidth: Number(s.resWidth) || 854,
    resHeight: Number(s.resHeight) || 480,
    javaPath: javaPath || "",
    jvmArgs: s.jvmArgs || "",
  };
});

ipcMain.handle("settings:setRam", (_e, mb) => {
  const lim = ramLimits();
  const v = Math.min(lim.maxMB, Math.max(lim.minMB, Math.round(Number(mb) / 512) * 512));
  saveSettings({ ramMB: v });
  return { ...lim, ramMB: v };
});

ipcMain.handle("settings:set", (_e, data) => {
  const allowed = {};
  if (data.resWidth != null) allowed.resWidth = Math.max(640, Math.min(3840, Number(data.resWidth) || 854));
  if (data.resHeight != null) allowed.resHeight = Math.max(360, Math.min(2160, Number(data.resHeight) || 480));
  if (data.jvmArgs != null) allowed.jvmArgs = String(data.jvmArgs).slice(0, 500);
  return saveSettings(allowed);
});

/* ---- Resto de IPC ---- */
ipcMain.handle("branding", () => ({
  ...config.branding,
  minecraft: config.minecraft,
  loader: config.loader,
}));

ipcMain.handle("mods:list", async () => {
  const slugs = await L.getModSlugs();
  const manifest = L.readModsManifest(gameDir());
  const items = manifest
    ? manifest.map((m) => ({ title: m.title, slug: m.slug, version: m.version, lib: m.dependency, icon: m.icon || null }))
    : slugs.map((s) => ({ title: s, slug: s, version: "", lib: false, icon: null }));

  if (items.some((i) => !i.icon)) {
    try {
      const info = await L.fetchProjectInfo(items.map((i) => i.slug));
      for (const it of items) {
        const p = info.get(it.slug);
        if (!p) continue;
        it.icon = it.icon || p.icon;
        if (!manifest) it.title = p.title;
      }
    } catch { /* sin internet: se muestran sin icono */ }
  }
  return { items, pending: !manifest };
});

ipcMain.handle("session:get", async () => {
  try {
    const s = await ensureLogin(false);
    status("");
    return s ? { name: s.name } : null;
  } catch {
    return null;
  }
});

ipcMain.handle("login", async () => {
  try {
    const s = await ensureLogin(true);
    status("");
    return { ok: true, name: s.name };
  } catch (e) {
    status("Error de inicio de sesión: " + e.message);
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("logout", async () => {
  session = null;
  try { fs.rmSync(sessionFile(), { force: true }); } catch {}
  return true;
});

ipcMain.handle("play", async () => {
  if (playing) return { ok: false, error: "Minecraft ya se está ejecutando." };
  playing = true;
  send("state", "loading");

  let pct = 0;
  const setPct = (p) => {
    pct = Math.max(pct, Math.min(100, p));
    send("progress", { pct });
  };

  try {
    setPct(2);
    const s = await ensureLogin(true);
    setPct(8);

    status("Buscando Java 21...");
    const javaPath = await L.findJava();
    if (!javaPath) {
      throw new Error("No se encontró Java 21. Instala Temurin 21 desde https://adoptium.net y vuelve a intentar.");
    }
    setPct(12);

    const dir = gameDir();
    status("Preparando Fabric...");
    const fabricId = await L.ensureFabric(dir);
    setPct(18);

    status("Comprobando mods...");
    await L.syncMods(dir, status, (r) => setPct(18 + r * 22));
    setPct(40);

    status("Descargando y preparando Minecraft...");
    let ready = false;
    const res = currentResolution();
    const jvmArgs = currentJvmArgs();
    await L.launch({
      auth: s.auth,
      javaPath,
      gameDir: dir,
      fabricId,
      ramMB: currentRamMB(),
      resWidth: res.resWidth,
      resHeight: res.resHeight,
      jvmArgs,
      onLog: (line) => send("log", line),
      onProgress: (p) => { if (p && p.total) setPct(40 + (p.task / p.total) * 55); },
      onReady: () => { ready = true; send("state", "running"); },
      onClose: (code) => {
        playing = false;
        status(`Minecraft se cerró (código ${code}).`);
        send("state", "idle");
      },
    });
    setPct(100);
    status("");
    if (!ready) send("state", "launching");
    return { ok: true };
  } catch (e) {
    playing = false;
    send("state", "idle");
    status("Error: " + e.message);
    send("log", "ERROR: " + (e.stack || e.message));
    return { ok: false, error: e.message };
  }
});

/* ---- Skin y capa (API de Minecraft Services) ---- */
const MCS = "https://api.minecraftservices.com";
let pendingSkin = null; // Buffer del PNG elegido, pendiente de aplicar
const textureCache = new Map();

// Llama a la API con tu sesión; si el token caducó (401) renueva la sesión y reintenta una vez
async function mcFetch(pathname, init = {}, retry = true) {
  const s = await ensureLogin(true);
  const res = await fetch(MCS + pathname, {
    ...init,
    headers: { Authorization: `Bearer ${s.auth.access_token}`, ...(init.headers || {}) },
  });
  if (res.status === 401 && retry) {
    session = null;
    return mcFetch(pathname, init, false);
  }
  return res;
}

async function apiError(res) {
  let body = "";
  try { body = (await res.text()).slice(0, 200); } catch {}
  if (res.status === 429) return "Mojang pide esperar: se hicieron demasiados cambios seguidos. Prueba en unos minutos.";
  if (res.status === 401) return "Tu sesión caducó. Cierra sesión y vuelve a entrar.";
  if (res.status === 400) return "Mojang rechazó el archivo (¿es una skin válida?). " + body;
  return `Error ${res.status}. ${body}`;
}

// Se descargan aquí (no en la ventana) para evitar problemas de CORS; se envían como data URL
async function textureDataUrl(url) {
  if (!url) return null;
  if (textureCache.has(url)) return textureCache.get(url);
  try {
    const res = await fetch(url.replace(/^http:/, "https:"));
    if (!res.ok) return null;
    const data = "data:image/png;base64," + Buffer.from(await res.arrayBuffer()).toString("base64");
    textureCache.set(url, data);
    return data;
  } catch {
    return null;
  }
}

ipcMain.handle("profile:get", async () => {
  try {
    const res = await mcFetch("/minecraft/profile");
    if (!res.ok) throw new Error(await apiError(res));
    const p = await res.json();

    const skins = p.skins || [];
    const skin = skins.find((x) => x.state === "ACTIVE") || skins[0];
    const capes = await Promise.all(
      (p.capes || []).map(async (c) => ({
        id: c.id,
        alias: c.alias || "Capa",
        active: c.state === "ACTIVE",
        texture: await textureDataUrl(c.url),
      }))
    );
    const activeCape = capes.find((c) => c.active);
    return {
      ok: true,
      name: p.name,
      variant: skin && skin.variant ? skin.variant : "CLASSIC",
      skin: await textureDataUrl(skin && skin.url),
      cape: activeCape ? activeCape.texture : null,
      capes,
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("skin:pick", async () => {
  const r = await dialog.showOpenDialog(win, {
    title: "Elige tu skin (PNG)",
    filters: [{ name: "Skin (PNG)", extensions: ["png"] }],
    properties: ["openFile"],
  });
  if (r.canceled || !r.filePaths[0]) return { ok: false };
  try {
    const buf = fs.readFileSync(r.filePaths[0]);
    if (buf.length < 33 || buf.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
      throw new Error("El archivo no es un PNG válido.");
    }
    const w = buf.readUInt32BE(16);
    const h = buf.readUInt32BE(20);
    if (w !== 64 || (h !== 64 && h !== 32)) throw new Error(`La skin debe medir 64x64 (o 64x32). Esta mide ${w}x${h}.`);
    if (buf.length > 1024 * 1024) throw new Error("El archivo es demasiado grande.");
    pendingSkin = buf;
    return { ok: true, dataUrl: "data:image/png;base64," + buf.toString("base64"), width: w, height: h, name: path.basename(r.filePaths[0]) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("skin:upload", async (_e, variant) => {
  if (!pendingSkin) return { ok: false, error: "Primero elige un archivo." };
  try {
    const form = new FormData();
    form.append("variant", variant === "slim" ? "slim" : "classic");
    form.append("file", new Blob([pendingSkin], { type: "image/png" }), "skin.png");
    const res = await mcFetch("/minecraft/profile/skins", { method: "POST", body: form });
    if (!res.ok) throw new Error(await apiError(res));
    pendingSkin = null;
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("cape:set", async (_e, capeId) => {
  try {
    const res = capeId
      ? await mcFetch("/minecraft/profile/capes/active", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ capeId }),
        })
      : await mcFetch("/minecraft/profile/capes/active", { method: "DELETE" });
    if (!res.ok) throw new Error(await apiError(res));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

/* ---- Ventana ---- */
function createWindow() {
  // Buscar ícono: primero logo.png (dev), luego build/icon.ico (producción)
  const logoPng = path.join(__dirname, "renderer", "assets", "logo.png");
  const icoPath = path.join(__dirname, "build", "icon.ico");
  const iconPath = fs.existsSync(logoPng) ? logoPng : (fs.existsSync(icoPath) ? icoPath : undefined);
  win = new BrowserWindow({
    width: 980,
    height: 620,
    minWidth: 860,
    minHeight: 540,
    autoHideMenuBar: true,
    title: (config.branding && config.branding.title) || "Mi Launcher",
    icon: iconPath,
    backgroundColor: "#0b0a18",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  setupAutoUpdater();
}

/* ---- Auto-actualizaciones automáticas desde GitHub Releases ---- */
function setupAutoUpdater() {
  if (!app.isPackaged) return; // En modo desarrollo no busca updates

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => {
    status("Buscando actualizaciones del launcher...");
  });

  autoUpdater.on("update-available", (info) => {
    status(`Descargando actualización v${info.version}...`);
  });

  autoUpdater.on("download-progress", (p) => {
    const pct = Math.round(p.percent || 0);
    status(`Descargando nueva versión: ${pct}%`);
  });

  autoUpdater.on("update-downloaded", (info) => {
    status(`Launcher v${info.version} listo para instalar.`);
    if (win && !win.isDestroyed()) {
      dialog
        .showMessageBox(win, {
          type: "info",
          title: "Actualización disponible",
          message: `Se descargó una nueva versión del Launcher (v${info.version}).\n\n¿Quieres reiniciar ahora para actualizarlo?`,
          buttons: ["Reiniciar y actualizar", "Más tarde"],
          defaultId: 0,
        })
        .then((choice) => {
          if (choice.response === 0) {
            autoUpdater.quitAndInstall();
          }
        });
    }
  });

  autoUpdater.on("error", (err) => {
    console.warn("AutoUpdater warning:", err.message);
  });

  // Comprobar actualizaciones a los 3 segundos de abrir
  setTimeout(() => {
    autoUpdater.checkForUpdatesAndNotify().catch(() => {});
  }, 3000);
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());
