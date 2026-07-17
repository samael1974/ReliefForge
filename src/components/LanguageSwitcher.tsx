// src/components/LanguageSwitcher.tsx
import React from "react";
import { useI18n, LANGS, LANG_LABELS } from "@/lib/i18n";

export default function LanguageSwitcher() {
  const { lang, setLang } = useI18n();
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-slate-300">
      {LANGS.map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => setLang(l)}
          aria-pressed={lang === l}
          className={
            "px-2.5 py-1 text-xs font-semibold " +
            (lang === l ? "bg-[#2f6f7e] text-white" : "bg-white text-slate-700 hover:bg-slate-50")
          }
        >
          {LANG_LABELS[l]}
        </button>
      ))}
    </div>
  );
}
