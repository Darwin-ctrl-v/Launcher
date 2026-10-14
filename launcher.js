const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");
const { Client } = require("minecraft-launcher-core");
const config = require("./config");

const MODRINTH = "https://api.modrinth.com/v2";
const headers = { "User-Agent": config.userAgent };

async function getJSON(url) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} -> ${url}`);
  return res.json();
}

/* ---------------- Login con Microsoft (MSMC) ---------------- */

async function getAuthClass() {
  const m = await import("msmc"); // import dinámico: funciona sea ESM o CJS
  return m.Auth || (m.default && m.default.Auth);
}

async function loginMicrosoft() {
  const Auth = await getAuthClass();
  const authManager = new Auth("select_account");
  const xbox = await authManager.launch("electron");
  const mc = await xbox.getMinecraft();
  return { auth: mc.mclc(), saved: xbox.save(), name: mc.profile.name };
}

async function loginSaved(savedToken) {
  const Auth = await getAuthClass();
  const authManager = new Auth("select_account");
  const xbox = await authManager.refresh(savedToken);
  const mc = await xbox.getMinecraft();
  return { auth: mc.mclc(), saved: xbox.save(), name: mc.profile.name };
}

/* ---------------- Java ---------------- */

function javaMajor(bin) {
  return new Promise((resolve) => {
    execFile(bin, ["-version"], { timeout: 8000 }, (err, stdout, stderr) => {
      const out = `${stderr || ""}${stdout || ""}`;
      const m = /version "(\d+)(?:\.(\d+))?/.exec(out);
      if (!m) return resolve(null);
      resolve(m[1] === "1" ? Number(m[2]) : Number(m[1]));
    });
  });
}

function javaCandidates() {
  const exe = process.platform === "win32" ? "java.exe" : "java";
  const list = [];
  if (process.env.JAVA_HOME) list.push(path.join(process.env.JAVA_HOME, "bin", exe));

  if (process.platform === "win32") {
    // Java incluido con el launcher oficial de Minecraft (Java 21 = "java-runtime-delta")
    const appdata = process.env.APPDATA;
    if (appdata) {
      list.push(path.join(appdata, ".minecraft", "runtime", "java-runtime-delta", "windows-x64", "java-runtime-delta", "bin", exe));
    }
    // Instalaciones típicas (Temurin / Microsoft / Java)
    for (const base of ["C:\\Program Files\\Eclipse Adoptium", "C:\\Program Files\\Microsoft", "C:\\Program Files\\Java"]) {
      try {
        for (const d of fs.readdirSync(base)) {
          if (/(jdk|jre)-?21/i.test(d)) list.push(path.join(base, d, "bin", exe));
        }
      } catch {}
    }
  }
  list.push("java"); // el que esté en el PATH
  return list;
}

async function findJava() {
  for (const c of javaCandidates()) {
    const v = await javaMajor(c);
    if (v && v >= config.javaMajor) return c;
  }
  return null;
}

/* ---------------- Fabric ---------------- */

// Descarga el perfil de Fabric y lo deja en <juego>/versions/<id>/<id>.json
async function ensureFabric(gameDir) {
  const loaders = await getJSON(`https://meta.fabricmc.net/v2/versions/loader/${config.minecraft}`);
  const elegido = loaders.find((l) => l.loader.stable) || loaders[0];
  const loaderVersion = elegido.loader.version;
  const id = `fabric-loader-${loaderVersion}-${config.minecraft}`;
  const dir = path.join(gameDir, "versions", id);
  const file = path.join(dir, `${id}.json`);

  if (!fs.existsSync(file)) {
    const profile = await getJSON(
      `https://meta.fabricmc.net/v2/versions/loader/${config.minecraft}/${loaderVersion}/profile/json`
    );
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(profile, null, 2));
  }
  return id;
}

/* ---------------- Mods (Modrinth + Remoto GitHub) ---------------- */

async function getModSlugs() {
  if (config.modsUrl && typeof config.modsUrl === "string" && config.modsUrl.trim()) {
    try {
      let rawUrl = config.modsUrl.trim();
      // Si es un enlace de GitHub Gist con hash de commit específico (/raw/<40-chars-hash>/archivo.json),
      // lo convertimos a /raw/archivo.json para que SIEMPRE descargue los cambios más recientes.
      rawUrl = rawUrl.replace(/(gist\.githubusercontent\.com\/[^/]+\/[^/]+\/raw\/)[a-f0-9]{40}\//i, "$1");

      const url = rawUrl + (rawUrl.includes("?") ? "&" : "?") + "t=" + Date.now();
      const res = await fetch(url, {
        headers: { "User-Agent": config.userAgent, "Cache-Control": "no-cache" },
      });
      if (res.ok) {
        const text = await res.text();
        // Tolerar comas finales como ["mod1", "mod2",] para que no falle el JSON
        const cleaned = text.replace(/,\s*([\]}])/g, "$1");
        const data = JSON.parse(cleaned);
        const list = Array.isArray(data) ? data : (data && Array.isArray(data.mods) ? data.mods : null);
        if (list && list.length > 0) {
          return list.map((s) => String(s).trim()).filter(Boolean);
        }
      }
    } catch (e) {
      console.warn("No se pudo obtener la lista de mods desde GitHub, usando lista local:", e.message);
    }
  }
  return config.mods || [];
}

async function resolveMods(slugs) {
  const found = new Map(); // project_id -> datos del mod
  const g = encodeURIComponent(JSON.stringify([config.minecraft]));
  const l = encodeURIComponent(JSON.stringify([config.loader]));

  // Comprobar si Iris está en la lista de mods
  const hasIris = slugs.some((s) => String(s).toLowerCase().startsWith("iris"));

  async function add(idOrSlug, esDependencia, specificVersionId) {
    let cleanId = idOrSlug;
    let targetVer = specificVersionId || null;

    // Soporte para especificar versión como "sodium@0.6" o "sodium:0.6"
    if (!targetVer && typeof idOrSlug === "string" && /[@:]/.test(idOrSlug)) {
      const parts = idOrSlug.split(/[@:]/);
      cleanId = parts[0].trim();
      targetVer = parts[1].trim();
    }

    // Para Iris en 1.21.1: usar la versión 1.8.14-beta.1 que es compatible con la última versión de Sodium 0.8.x
    if (!targetVer && (cleanId === "iris" || cleanId === "YL57xq9U") && config.minecraft === "1.21.1") {
      targetVer = "1.8.14";
    }

    const project = await getJSON(`${MODRINTH}/project/${cleanId}`);
    if (found.has(project.id)) {
      if (!esDependencia) found.get(project.id).dependency = false; // lo pediste tú: no es solo librería
      return;
    }

    const versions = await getJSON(`${MODRINTH}/project/${project.id}/version?game_versions=${g}&loaders=${l}`);

    let v = null;
    if (targetVer) {
      v = versions.find((x) => x.id === targetVer || (x.version_number && x.version_number.includes(targetVer)));
    }
    if (!v) {
      v = ["release", "beta", "alpha"].map((t) => versions.find((x) => x.version_type === t)).find(Boolean);
    }
    if (!v) throw new Error(`"${project.title}" no tiene versión compatible para ${config.minecraft} + ${config.loader}`);

    const file = v.files.find((f) => f.primary) || v.files[0];
    found.set(project.id, {
      title: project.title,
      slug: project.slug,
      icon: project.icon_url || null,
      version: v.version_number,
      dependency: !!esDependencia,
      name: file.filename,
      url: file.url,
      sha1: file.hashes.sha1,
    });

    for (const d of v.dependencies) {
      if (d.dependency_type === "required" && d.project_id) {
        await add(d.project_id, true, d.version_id);
      }
    }
  }

  for (const s of slugs) await add(s, false);
  return [...found.values()];
}

function sha1File(p) {
  return crypto.createHash("sha1").update(fs.readFileSync(p)).digest("hex");
}

async function downloadVerified(url, dest, sha1) {
  if (fs.existsSync(dest) && sha1File(dest) === sha1) return false; // ya está bien
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`No se pudo descargar ${url} (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  const got = crypto.createHash("sha1").update(buf).digest("hex");
  if (got !== sha1) throw new Error(`El archivo ${path.basename(dest)} llegó corrupto (hash distinto)`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
  return true;
}

const manifestPath = (gameDir) => path.join(gameDir, "mods-manifest.json");

// Lista de mods que se ve en la pestaña "Mods" del launcher
function readModsManifest(gameDir) {
  try {
    return JSON.parse(fs.readFileSync(manifestPath(gameDir), "utf8"));
  } catch {
    return null;
  }
}

async function syncMods(gameDir, onStatus, onProgress) {
  const modsDir = path.join(gameDir, "mods");
  fs.mkdirSync(modsDir, { recursive: true });

  let list;
  try {
    const slugs = await getModSlugs();
    list = await resolveMods(slugs);
  } catch (e) {
    const hayJars = fs.readdirSync(modsDir).some((f) => f.endsWith(".jar"));
    if (hayJars && /fetch failed|ENOTFOUND|ECONN|network/i.test(String(e.message + e.cause))) {
      onStatus("Sin conexión con Modrinth: se usan los mods ya instalados.");
      return;
    }
    throw e;
  }

  // Borra los .jar que ya no están en la lista (esta carpeta es solo del launcher)
  const wanted = new Set(list.map((m) => m.name));
  for (const f of fs.readdirSync(modsDir)) {
    if (f.endsWith(".jar") && !wanted.has(f)) fs.rmSync(path.join(modsDir, f));
  }

  let hechos = 0;
  for (const m of list) {
    onStatus(`Mods: ${m.title}`);
    await downloadVerified(m.url, path.join(modsDir, m.name), m.sha1);
    hechos++;
    if (onProgress) onProgress(hechos / list.length);
  }

  fs.writeFileSync(
    manifestPath(gameDir),
    JSON.stringify(list.map(({ title, slug, version, dependency, name, icon }) => ({ title, slug, version, dependency, name, icon })), null, 2)
  );
}

/* ---------------- Lanzar el juego ---------------- */

async function launch({ auth, javaPath, gameDir, fabricId, ramMB, resWidth, resHeight, jvmArgs, onLog, onProgress, onReady, onClose }) {
  const client = new Client();
  let ready = false;
  const markReady = () => {
    if (!ready) {
      ready = true;
      onReady();
    }
  };

  client.on("debug", (m) => onLog(String(m)));
  client.on("data", (m) => {
    const txt = String(m);
    onLog(txt);
    if (/Setting user:|Backend library|LWJGL/.test(txt)) markReady(); // el juego ya está arrancando
  });
  client.on("progress", (e) => onProgress({ type: e.type, task: e.task, total: e.total }));
  client.on("close", (code) => {
    ready = true;
    onClose(code);
  });

  const launchOpts = {
    authorization: auth,
    root: gameDir,
    javaPath,
    version: { number: config.minecraft, type: "release", custom: fabricId },
    memory: { min: `${Math.min(2048, ramMB)}M`, max: `${ramMB}M` },
  };

  // Resolución de ventana
  if (resWidth && resHeight) {
    launchOpts.window = { width: resWidth, height: resHeight };
  }

  // Argumentos JVM extra
  if (jvmArgs && jvmArgs.trim()) {
    launchOpts.customArgs = jvmArgs.trim().split(/\s+/);
  }

  const proc = await client.launch(launchOpts);
  if (!proc) throw new Error("No se pudo iniciar Minecraft. Revisa el Registro.");

  setTimeout(markReady, 20000); // por si no aparece ninguna de las líneas anteriores
  return proc;
}

// Título e icono de varios mods de una sola vez (para la pestaña Mods, aunque aún no se hayan descargado)
const infoCache = new Map(); // slug -> { title, icon }
async function fetchProjectInfo(slugs) {
  const faltan = slugs.filter((s) => !infoCache.has(s));
  for (let i = 0; i < faltan.length; i += 40) {
    const ids = encodeURIComponent(JSON.stringify(faltan.slice(i, i + 40)));
    const lista = await getJSON(`${MODRINTH}/projects?ids=${ids}`);
    for (const p of lista) infoCache.set(p.slug, { title: p.title, icon: p.icon_url || null });
  }
  return infoCache;
}

module.exports = { loginMicrosoft, loginSaved, findJava, ensureFabric, syncMods, readModsManifest, fetchProjectInfo, launch, getModSlugs };
