import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import dyadComponentTagger from "@dyad-sh/react-vite-component-tagger";
import path from "path";
import { readFileSync } from "fs";

// Versione UNICA: package.json. Prima l'intestazione dello Studio e il salvataggio
// progetto avevano il numero scritto a mano, e sono rimasti a 8.4 dopo il bump.
const pkgVersion = JSON.parse(readFileSync(path.resolve(__dirname, "package.json"), "utf-8")).version as string;

export default defineConfig(({ command, mode }) => {
  // ✅ Dyad tagger SOLO in produzione (build), NON in dev
  const enableDyadTagger = command === "build" || mode === "production";

  return {
    define: {
      __APP_VERSION__: JSON.stringify(pkgVersion),
    },
    server: {
      host: "127.0.0.1",
      port: 8080,
      strictPort: true,
      watch: {
        ignored: ["**/.pnpm-store/**", "**/.pnpm-home/**", "**/.xdg/**", "**/dist/**", "**/release/**"],
      },
    },
    plugins: [react(), enableDyadTagger ? dyadComponentTagger() : null].filter(Boolean),
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
