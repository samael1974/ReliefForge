// scripts/run-assembly-check.mjs
// Bundla assembly-check.mts con esbuild (risolvendo l'alias @ e gli import Vite
// tipo "...wasm?url") e lo esegue in Node.

import * as path from "node:path";
import * as url from "node:url";
import * as fs from "node:fs";
import { createRequire } from "node:module";

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const require_ = createRequire(import.meta.url);

// esbuild arriva come dipendenza transitiva di vite: con pnpm non e' hoistata,
// quindi la si cerca anche nello store .pnpm.
async function loadEsbuild() {
  try { return await import("esbuild"); } catch { /* fallback sotto */ }
  const pnpmDir = path.join(root, "node_modules/.pnpm");
  const hit = fs.readdirSync(pnpmDir).find((d) => d.startsWith("esbuild@"));
  if (!hit) throw new Error("esbuild non trovato: esegui `pnpm install`.");
  const entry = path.join(pnpmDir, hit, "node_modules/esbuild/lib/main.js");
  return await import(url.pathToFileURL(entry).href);
}
const esbuild = await loadEsbuild();

/** Gli import "?url" di Vite diventano il percorso assoluto del file su disco:
 *  in Node emscripten sa caricare il .wasm da un path. */
const viteUrlImports = {
  name: "vite-url-imports",
  setup(build) {
    build.onResolve({ filter: /\?url$/ }, (args) => ({
      path: args.path,
      namespace: "vite-url",
    }));
    build.onLoad({ filter: /.*/, namespace: "vite-url" }, (args) => {
      const spec = args.path.replace(/\?url$/, "");
      const resolved = require_.resolve(spec, { paths: [root] });
      return { contents: `export default ${JSON.stringify(resolved)};`, loader: "js" };
    });
  },
};

const EXTS = ["", ".ts", ".tsx", ".mts", ".js", ".jsx", "/index.ts", "/index.tsx"];

const aliasAt = {
  name: "alias-at",
  setup(build) {
    build.onResolve({ filter: /^@\// }, (args) => {
      const base = path.join(root, "src", args.path.slice(2));
      for (const e of EXTS) {
        const p = base + e;
        if (fs.existsSync(p) && fs.statSync(p).isFile()) return { path: p };
      }
      return { errors: [{ text: `alias @ non risolto: ${args.path}` }] };
    });
  },
};

const outfile = path.join(root, "scripts/out/assembly-check.bundle.mjs");

await esbuild.build({
  entryPoints: [path.join(root, "scripts/assembly-check.mts")],
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  outfile,
  plugins: [aliasAt, viteUrlImports],
  external: ["node:*"],
  logLevel: "warning",
});

await import(url.pathToFileURL(outfile).href);
