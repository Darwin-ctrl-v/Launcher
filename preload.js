const { contextBridge, ipcRenderer } = require("electron");
const on = (channel, cb) => ipcRenderer.on(channel, (_e, data) => cb(data));

contextBridge.exposeInMainWorld("api", {
  getBranding: () => ipcRenderer.invoke("branding"),
  getSession: () => ipcRenderer.invoke("session:get"),
  login: () => ipcRenderer.invoke("login"),
  logout: () => ipcRenderer.invoke("logout"),
  play: () => ipcRenderer.invoke("play"),
  getProfile: () => ipcRenderer.invoke("profile:get"),
  pickSkin: () => ipcRenderer.invoke("skin:pick"),
  uploadSkin: (variant) => ipcRenderer.invoke("skin:upload", variant),
  setCape: (id) => ipcRenderer.invoke("cape:set", id),
  listMods: () => ipcRenderer.invoke("mods:list"),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  setRam: (mb) => ipcRenderer.invoke("settings:setRam", mb),
  setSettings: (data) => ipcRenderer.invoke("settings:set", data),
  onStatus: (cb) => on("status", cb),
  onLog: (cb) => on("log", cb),
  onProgress: (cb) => on("progress", cb),
  onState: (cb) => on("state", cb),
    onUpdate: (cb) => on("update", cb),
  installUpdate: () => ipcRenderer.invoke("update:install"),
});
