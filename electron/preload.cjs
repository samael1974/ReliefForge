// electron/preload.cjs — ponte minimale e sicuro verso il renderer.
// Espone solo un flag per riconoscere l'ambiente desktop (utile in futuro
// per attivare funzioni native: filesystem, sidecar AI, ecc.).
const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("reliefforge", {
  isElectron: true,
  platform: process.platform,
});
