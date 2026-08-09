// electron/main.cjs — processo principale Electron (ReliefForge Desktop, M1).
// In sviluppo carica il dev server Vite (http://localhost:8080).
// In produzione serve la build statica (dist/) da un mini server HTTP locale:
// la build web usa percorsi assoluti (/assets/...) che non funzionano via file://.
const { app, BrowserWindow, shell } = require("electron");
const path = require("path");
const http = require("http");
const fs = require("fs");

// WebGPU per il modello depth (transformers.js) + sblocco GPU.
app.commandLine.appendSwitch("enable-unsafe-webgpu");
app.commandLine.appendSwitch("ignore-gpu-blocklist");

const isDev = !app.isPackaged;
const isSmoke = process.env.RELIEFFORGE_SMOKE === "1";
const DEV_URL = process.env.VITE_DEV_SERVER_URL || "http://localhost:8080";
const APP_ICON = path.join(__dirname, "..", "logo", "reliefforge_icon.ico");
const DIST_DIR = path.join(__dirname, "..", "dist");

// URL base dell'app in produzione (impostato all'avvio del server locale).
let PROD_URL = "";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
};

// Mini server statico locale (solo 127.0.0.1, porta effimera).
// Fallback SPA su index.html, come il rewrite di vercel.json.
function startStaticServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const urlPath = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname);
        let filePath = path.normalize(path.join(DIST_DIR, urlPath));
        if (!filePath.startsWith(DIST_DIR)) {
          res.writeHead(403);
          res.end("Forbidden");
          return;
        }
        if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
          filePath = path.join(DIST_DIR, "index.html");
        }
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
        fs.createReadStream(filePath).pipe(res);
      } catch (err) {
        res.writeHead(500);
        res.end("Internal error");
      }
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolve(`http://127.0.0.1:${server.address().port}`);
    });
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: "ReliefForge",
    icon: APP_ICON,
    backgroundColor: "#0f172a",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  const APP_URL = isDev ? DEV_URL : PROD_URL;

  // I link esterni si aprono nel browser di sistema, non in finestre Electron.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http") && !url.startsWith(APP_URL)) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    const allowed = url.startsWith(APP_URL);
    if (!allowed) {
      event.preventDefault();
      if (url.startsWith("http")) shell.openExternal(url);
    }
  });
  win.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));

  if (isDev) {
    win.loadURL(DEV_URL + "/studio");
    if (!isSmoke) win.webContents.openDevTools({ mode: "detach" });
  } else {
    // Build con HashRouter: la rotta sta nell'hash.
    win.loadURL(PROD_URL + "/#/studio");
  }

  win.webContents.on("did-fail-load", (_event, code, description) => {
    console.error(`[ELECTRON] Caricamento fallito (${code}): ${description}`);
    if (isSmoke) app.exit(1);
  });
  win.webContents.on("render-process-gone", (_event, details) => {
    console.error(`[ELECTRON] Renderer terminato: ${details.reason}`);
    if (isSmoke) app.exit(1);
  });
  if (isSmoke) {
    win.webContents.once("did-finish-load", () => {
      console.log(`[SMOKE] ReliefForge ${app.getVersion()} Studio caricato correttamente.`);
      app.quit();
    });
  }
}

app.whenReady().then(async () => {
  if (!isDev) {
    try {
      PROD_URL = await startStaticServer();
    } catch (err) {
      console.error("[ELECTRON] Avvio server locale fallito:", err);
      app.exit(1);
      return;
    }
  }
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
