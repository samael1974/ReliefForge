import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import dyadComponentTagger from "@dyad-sh/react-vite-component-tagger";
import path from "path";

export default defineConfig(({ command, mode }) => {
  // ✅ Dyad tagger SOLO in produzione (build), NON in dev
  const enableDyadTagger = command === "build" || mode === "production";

  return {
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
