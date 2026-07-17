import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./globals.css";
import { I18nProvider } from "@/lib/i18n";

createRoot(document.getElementById("root")!).render(
  <I18nProvider>
    <App />
  </I18nProvider>
);
