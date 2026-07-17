// src/lib/i18n.tsx — i18n minimale IT/EN/ES/PT (no dipendenze). Avvolgi <App/> con <I18nProvider>.
import React, { createContext, useContext, useState, useCallback } from "react";

export type Lang = "it" | "en" | "es" | "pt";
type Entry = { it: string; en: string; es: string; pt: string };
type Dict = Record<string, Entry>;

export const LANGS: Lang[] = ["it", "en", "es", "pt"];
export const LANG_LABELS: Record<Lang, string> = { it: "IT", en: "EN", es: "ES", pt: "PT" };

export const DICT: Dict = {
  // Generatore (base)
  tagline:       { it: "Da foto a bassorilievo STL pronto da stampare in pochi minuti.", en: "From photo to print-ready bas-relief STL in minutes.", es: "De foto a bajorrelieve STL listo para imprimir en minutos.", pt: "De foto a baixo-relevo STL pronto para impressão em minutos." },
  goToGenerator: { it: "Vai al generatore", en: "Open the generator", es: "Abrir el generador", pt: "Abrir o gerador" },
  genDepth:      { it: "Genera Depth Map", en: "Generate Depth Map", es: "Generar Mapa de Profundidad", pt: "Gerar Mapa de Profundidade" },
  source:        { it: "Sorgente", en: "Source", es: "Fuente", pt: "Fonte" },
  image:         { it: "Immagine", en: "Image", es: "Imagen", pt: "Imagem" },
  depthmap:      { it: "Depth map", en: "Depth map", es: "Mapa de profundidad", pt: "Mapa de profundidade" },
  preset:        { it: "Preset", en: "Preset", es: "Preajuste", pt: "Predefinição" },
  base:          { it: "Base", en: "Base", es: "Base", pt: "Base" },
  quality:       { it: "Qualità", en: "Quality", es: "Calidad", pt: "Qualidade" },
  instructions:  { it: "Istruzioni", en: "Instructions", es: "Instrucciones", pt: "Instruções" },
  downloadStl:   { it: "Scarica STL", en: "Download STL", es: "Descargar STL", pt: "Baixar STL" },
  depthMm:       { it: "Profondità rilievo (mm)", en: "Relief depth (mm)", es: "Profundidad del relieve (mm)", pt: "Profundidade do relevo (mm)" },
  baseMm:        { it: "Spessore base (mm)", en: "Base thickness (mm)", es: "Grosor de la base (mm)", pt: "Espessura da base (mm)" },
  detail:        { it: "Dettaglio", en: "Detail", es: "Detalle", pt: "Detalhe" },
  smooth:        { it: "Smussatura", en: "Smoothing", es: "Suavizado", pt: "Suavização" },
  invertDepth:   { it: "Inverti profondità", en: "Invert depth", es: "Invertir profundidad", pt: "Inverter profundidade" },

  // Landing
  badge:         { it: "Strumento gratuito • STL manifold • PNG 16-bit • Nessun account", en: "Free tool • Manifold STL • 16-bit PNG • No account", es: "Herramienta gratuita • STL manifold • PNG 16-bit • Sin cuenta", pt: "Ferramenta gratuita • STL manifold • PNG 16-bit • Sem conta" },
  heroLead:      { it: "Carica un'immagine, regola profondità e dettaglio, scarica uno STL chiuso (manifold) pronto per la stampa 3D.", en: "Upload an image, adjust depth and detail, and download a closed (manifold) STL ready for 3D printing.", es: "Sube una imagen, ajusta profundidad y detalle, y descarga un STL cerrado (manifold) listo para impresión 3D.", pt: "Carregue uma imagem, ajuste profundidade e detalhe e baixe um STL fechado (manifold) pronto para impressão 3D." },
  ctaGenerator:  { it: "Vai al generatore", en: "Open the generator", es: "Abrir el generador", pt: "Abrir o gerador" },
  ctaDepth:      { it: "Genera Depth Map", en: "Generate Depth Map", es: "Generar Mapa de Profundidad", pt: "Gerar Mapa de Profundidade" },
  donateInline:  { it: "Se non vuoi donare, va benissimo: usalo e basta. Se però ti ha risparmiato tempo, anche un caffè aiuta a mantenerlo gratuito e a migliorarlo.", en: "Don't want to donate? That's totally fine — just use it. But if it saved you time, even a coffee helps keep it free and improve it.", es: "¿No quieres donar? Está perfecto: úsalo sin más. Pero si te ahorró tiempo, hasta un café ayuda a mantenerlo gratis y mejorarlo.", pt: "Não quer doar? Tudo bem, é só usar. Mas se economizou seu tempo, até um café ajuda a mantê-lo gratuito e a melhorá-lo." },
  heroCaption:   { it: "Originale → Depth Map → Rilievo STL", en: "Original → Depth Map → STL relief", es: "Original → Mapa de profundidad → Relieve STL", pt: "Original → Mapa de profundidade → Relevo STL" },
  step1Title:    { it: "1) Carica un'immagine", en: "1) Upload an image", es: "1) Sube una imagen", pt: "1) Carregue uma imagem" },
  step1Body:     { it: "JPG/PNG/WEBP. Va bene anche una foto normale. Se vuoi più resa (volti/loghi), puoi usare una depth map (PNG 8/16-bit).", en: "JPG/PNG/WEBP. A normal photo works too. For better results (faces/logos), you can use a depth map (8/16-bit PNG).", es: "JPG/PNG/WEBP. También sirve una foto normal. Para mejores resultados (rostros/logos), puedes usar un mapa de profundidad (PNG 8/16-bit).", pt: "JPG/PNG/WEBP. Uma foto normal também serve. Para melhores resultados (rostos/logos), você pode usar um mapa de profundidade (PNG 8/16-bit)." },
  step2Title:    { it: "2) Regola il rilievo", en: "2) Adjust the relief", es: "2) Ajusta el relieve", pt: "2) Ajuste o relevo" },
  step2Body:     { it: "Imposta profondità, dettaglio e base. Se il file è pesante, aumenta la decimazione per alleggerirlo.", en: "Set depth, detail and base. If the file is heavy, increase decimation to lighten it.", es: "Configura profundidad, detalle y base. Si el archivo es pesado, aumenta la decimación para aligerarlo.", pt: "Defina profundidade, detalhe e base. Se o arquivo for pesado, aumente a decimação para aliviá-lo." },
  step3Title:    { it: "3) Scarica lo STL", en: "3) Download the STL", es: "3) Descarga el STL", pt: "3) Baixe o STL" },
  step3Body:     { it: "Export STL chiuso (manifold) e stampabile. Pronto per slicer e stampa 3D.", en: "Closed (manifold), printable STL export. Ready for slicers and 3D printing.", es: "Exportación STL cerrada (manifold) e imprimible. Lista para slicers e impresión 3D.", pt: "Exportação STL fechada (manifold) e imprimível. Pronta para slicers e impressão 3D." },
  donateTitle:   { it: "Supporta lo sviluppo (facoltativo)", en: "Support development (optional)", es: "Apoya el desarrollo (opcional)", pt: "Apoie o desenvolvimento (opcional)" },
  donateBody:    { it: "Questo progetto resta gratuito. Se ti ha evitato Blender, booleane o mesh rotte, puoi offrire un caffè. Nessuna pressione: davvero.", en: "This project stays free. If it saved you from Blender, booleans or broken meshes, you can buy a coffee. No pressure, really.", es: "Este proyecto sigue siendo gratuito. Si te ahorró Blender, booleanas o mallas rotas, puedes invitar a un café. Sin presión, de verdad.", pt: "Este projeto continua gratuito. Se te poupou do Blender, de booleanas ou de malhas quebradas, você pode pagar um café. Sem pressão, de verdade." },
  donatePaypal:  { it: "Dona su PayPal", en: "Donate via PayPal", es: "Donar con PayPal", pt: "Doar pelo PayPal" },
  donateSmall:   { it: "Anche 1–2€ fanno la differenza", en: "Even €1–2 makes a difference", es: "Incluso 1–2€ marcan la diferencia", pt: "Até 1–2€ fazem a diferença" },
  donateTip:     { it: "Suggerimento: se non puoi donare, il modo migliore per supportare è condividere il link con un maker o un amico che stampa in 3D.", en: "Tip: if you can't donate, the best way to support is sharing the link with a maker or a friend who 3D-prints.", es: "Consejo: si no puedes donar, la mejor forma de apoyar es compartir el enlace con un maker o un amigo que imprime en 3D.", pt: "Dica: se não puder doar, a melhor forma de apoiar é compartilhar o link com um maker ou um amigo que imprime em 3D." },
  footerTag:     { it: "ReliefForge • Generatore bassorilievi STL", en: "ReliefForge • STL bas-relief generator", es: "ReliefForge • Generador de bajorrelieves STL", pt: "ReliefForge • Gerador de baixos-relevos STL" },
};

type Ctx = { lang: Lang; setLang: (l: Lang) => void; t: (k: keyof typeof DICT) => string };
const I18nCtx = createContext<Ctx>({ lang: "it", setLang: () => {}, t: (k) => String(k) });

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const initial = (typeof localStorage !== "undefined" && (localStorage.getItem("rf_lang") as Lang)) || "it";
  const [lang, setLangState] = useState<Lang>(initial);
  const setLang = useCallback((l: Lang) => { setLangState(l); try { localStorage.setItem("rf_lang", l); } catch {} }, []);
  const t = useCallback((k: keyof typeof DICT) => DICT[k]?.[lang] ?? String(k), [lang]);
  return <I18nCtx.Provider value={{ lang, setLang, t }}>{children}</I18nCtx.Provider>;
}
export const useI18n = () => useContext(I18nCtx);
