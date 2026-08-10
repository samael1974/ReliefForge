# ReliefForge — Stato del progetto & Roadmap

> Documento storico V8.1, **rivisto in V8.5**: le voci marcate ⚠️ erano dichiarate risolte ma il codice le smentiva.
> Per la revisione corrente leggere `CHANGELOG_V8.5.md`.

> Documento di lavoro. Riepilogo di cosa è stato fatto e cosa manca. Aggiornato durante le sessioni di sviluppo con Federico.

---

## 1. Cos'è ReliefForge

App che trasforma una **foto → mappa di profondità (AI) → bassorilievo → STL stampabile** (con cornice, passepartout, vetro). Due "prodotti" dallo **stesso codice**:

- **Web app** (gratuita, in-browser): landing + `/relief` (generatore classico) + `/depth` (generatore depth) + `/studio`.
- **Programma desktop "Studio"** (Electron, Windows): interfaccia a tutto schermo, è la direzione principale di sviluppo.

Filosofia: gratuito, in-browser/locale, niente account, privacy. Donationware (PayPal). Niente backend a pagamento.

---

## 2. Stack tecnico

- **Frontend**: Vite + React + TypeScript (build SWC: **non** fa typecheck, conta solo la sintassi), pnpm.
- **3D**: three.js, @react-three/fiber, @react-three/drei.
- **CSG/STL**: `manifold-3d` (WASM) per fusione watertight.
- **Depth AI**: Depth Anything V2 via `@huggingface/transformers` (transformers.js), modelli ONNX `onnx-community/depth-anything-v2-{small,base,large}`. WebGPU `fp16`, fallback WASM `q8`.
- **Desktop**: Electron (Windows-first). Apre `/studio`. WebView Chromium → WebGPU funziona.
- **Repo GitHub storico**: `samael1974/floating-pangolin-hug`. Percorso locale rimosso dal pacchetto distribuibile.
- **Hosting web**: Vercel (`floating-pangolin-hug.vercel.app`).

### File chiave
- `src/pages/Studio.tsx` — interfaccia desktop (la più importante ora).
- `src/lib/relief/depth/estimateDepth.ts` — motore depth (modelli + predicted_depth float).
- `src/lib/relief/depth/fuseDepthDetail.ts`, `src/lib/relief/transform/tonemap.ts` — post-processing.
- `src/components/relief/ReliefPreview3D.tsx` — anteprima 3D (relief + cornice + passepartout + vetro).
- `src/components/relief/reliefStl.ts` — export STL (`downloadReliefStlBinary`, `downloadReliefAssemblyStl` con fusione manifold).
- `src/lib/relief/frame/buildFrameRectPocket.ts` (cornice a vassoio + angoli arrotondati + helper `effectiveFrameLipMm`), `buildPassepartoutRectPhi.ts` — geometrie cornice/passepartout. **Nota:** `buildFrameRectPhi.ts`, `buildFrameAssembly.ts`, `createFrameGeometry.ts` e `FramePreview3D.tsx` sono stati **eliminati in V8.5** (erano codice morto con tre convenzioni di assi diverse: la confusione fra "front" e "back" che ne derivava è all'origine del difetto della battuta).
- `electron/main.cjs`, `electron/preload.cjs`, `electron-builder.json` — packaging desktop.
- `Avvia-ReliefForge.bat` — avvio dev con doppio click (solo sul PC di Federico).

---

## 3. Cosa è stato FATTO

### Motore depth
- ✅ Fix **terrazzamento**: si legge `predicted_depth` (float) invece di `depth` (uint8 8-bit) → niente banding sulle superfici lisce.
- ✅ Selettore **qualità**: Veloce (Small) / Alta (Base) / Massima (Large). Cache separata per modello.
- ✅ Verificato che Base e Large esistono in ONNX per il browser.

### Studio desktop (Electron)
- ✅ Layout scuro: menu in alto, **strumenti a sinistra** (Immagine → Profondità → Rilievo → Cornice → Esporta), **viewport 3D al centro**, **parametri a destra**, **depth map 2D** in basso a destra, status bar.
- ✅ Tema scuro (scelto da Federico). Materiale anteprima: **lucido attuale** (clay opaco rimandato).
- ✅ Apertura predefinita su `/studio` in Electron.
- ✅ **Bombatura**: segmentazione del soggetto **dal solo depth** (niente modello aggiuntivo): sfondo sotto soglia → appiattito, soggetto ri-normalizzato su 0..1. Controlli: Isola soggetto, Soglia sfondo, Sfuma bordo.
- ✅ Controlli depth integrati: Dettaglio micro, Rilievo locale, Volume, Contrasto, Denoise, Inverti.
- ✅ **Input numerici** decimali su ogni slider (digiti il valore esatto al centesimo di mm).
- ✅ **Export**: STL, OBJ, PLY (mesh via exporter three.js), depth map **16-bit** e **8-bit** (CNC/CAM).
- ⚠️ **Numero sbagliato**: `MESH_PROFILES` limita le **celle** della heightmap, non i triangoli. `maximum.exportCells = 1_100_000` celle → oltre 2 M di triangoli. Misurato su un export reale 93×63 mm: **1.131.856 triangoli, 56,6 MB** (triangoli da ~0,1 mm su ugello 0,4 mm). Serve decimazione adattiva.
- ✅ **Donazione** PayPal (pulsante corallo visibile in basso).
- ✅ Fix **cache modello in Electron** (il Large non si riscarica tra le sessioni).

### Cornici / passepartout / vetro
- ✅ Cablati nello Studio (riuso geometria del generatore classico): Cornice (spessore, altezza), Passepartout a gradoni φ, vetro.
- ✅ **Posizione in profondità**: slider Profondità rilievo (reliefZ) e Profondità passepartout (matZ).
- ✅ Export **fuso** (cornice+rilievo, manifold, watertight) e **solo cornice** (STL separato, `frameOnly`).
- ⚠️ **Parzialmente falso**: valeva per l'ANTEPRIMA. Nell'export FUSO la cornice continuava a mordere il rilievo di `FRAME_INSET=1.0` per lato → 2 mm di scarto fra ciò che si vedeva e ciò che si stampava. **Corretto in V8.5** con `assemblyLayout.ts` (sorgente unica per anteprima ed export).
- ✅ **#2 cornice a VASSOIO (L-profile booleano)** — *rifatto in sessione 2026-06-22*: l'apertura visibile davanti è più stretta del vassoio dietro; la **battuta è ora un gradino strutturale** ottenuto per **sottrazione CSG manifold** (`outer − frontHole − pocket`), non più un anello additivo. La battuta è quindi **visibile in anteprima** "gratis" (è la cornice stessa). Nuovi parametri: **Profondità vassoio** (`pocketDepthMm`). Builder unico `buildFrameRectPocket.ts` (con fallback a scatola cava simmetrica quasi battuta/vassoio = 0).
- ⚠️ **RIMOSSO in una revisione successiva alla 8.3** — `effectiveFrameLipMm` oggi è solo `Math.max(0, lipMm)`: la battuta resta attiva anche senza passepartout e copre `lipMm` di rilievo per lato. È voluto (una cornice vera copre qualche mm di quadro), ma fino alla 8.4 non era scritto da nessuna parte e nessun numero a schermo lo diceva. **V8.5**: la copertura risultante è ora mostrata nel pannello Cornice.
- ✅ **Angoli arrotondati** — nuovo slider **"Arrotonda bordi"** (0–12 mm). Raggi concentrici (bordo a larghezza costante). Anteprima: perimetri rounded-rect allineati (6 segmenti/angolo). Export: `CrossSection.square().offset('Round').extrude()` di manifold (watertight); `R=0` → spigolo vivo via `cube` (veloce). **DA VERIFICARE in stampa/Bambu.**
- ✅ **Gola a U**: ora dimensionata sull'**apertura frontale** (non più quella retro) → non taglia le pareti laterali quando coesiste col vassoio.
- ✅ Tipi estesi: `FrameCfg`/`FrameUI` con `pocketDepthMm` e `cornerRadiusMm`. Propagati in `Studio.tsx`, `ReliefPreview3D.tsx`, `ReliefWizard.tsx`.
- ✅ Verifiche statiche sessione 2026-06-22: **`tsc --noEmit` pulito** e **`vite build` verde** (2385 moduli, manifold bundlato). Verifica a video/stampa ancora da fare.

### Deploy / packaging
- ✅ Web app v8.1 promossa in produzione su Vercel (dominio ora segue `main`). Causa risolta: dominio era agganciato a un ambiente Preview.
- ✅ Electron + `electron-builder.json` (target NSIS Windows). `package.json` v8.1.0 con author/description.
- ✅ `.bat` di avvio dev creato.

---

## 4. Roadmap — cosa MANCA

### Richieste recenti — sessione corrente
**Fatte ora (✅):**
- Default pannello Profondità: Dettaglio micro 0.5, Rilievo locale 0.1, Volume 0.8, Contrasto 0, Denoise 3.
- Default pannello Rilievo: Profondità 5 mm, Base 2 mm, Larghezza 100 mm, Decimazione 1. + **Altezza (auto)** mostrata.
- Default Cornice: Spessore bordo 5, Altezza 21; Passepartout Gradoni 1, Larghezza bande 10, Spessore 2, Salto gradino 2.
- **Bordino vetro (dentino)**: sostituito il vassoio confuso con toggle + Larghezza + Profondità (geometria nell'export).
- ⚠️ **"Gola a U" NON è stata rimossa**: il toggle "Alloggiamento vetro (scasso a U)" è vivo in `Studio.tsx` e la sottrazione booleana è cablata in `reliefStl.ts`. È una funzione attiva, non codice morto. Resta da tarare le tolleranze con prove reali.

**Da fare (⏳):**
- **Bordino vetro VISIBILE in anteprima** (ora la resa preview manca — renderlo nel viewport).
- **Menu File: "Salva"** (sovrascrive il file aperto) accanto a **"Salva con nome"**. Richiede gestione file nativa Electron (IPC + dialog), perché nel browser il "salva" non può sovrascrivere.
- **Menu "Personalizzazione"**: tema **chiaro/scuro**.
- **Colori personalizzati** scelti dall'utente per **rilievo / cornice / passepartout** (color picker → materiali preview) per anteprime a piacimento.
- Valutare se bloccare Gradoni a 1 (ora default 1 ma slider resta).


### Cornici (in corso, una alla volta)
- ✅ ~~Rendere la **battuta visibile anche in anteprima**~~ → FATTO con la cornice a vassoio (la battuta è il gradino della cornice).
- ✅ ~~**Arrotonda bordi**~~ → FATTO (slider 0–12 mm, anteprima + export manifold).
- ⏳ **Verificare in stampa (Bambu)** la cornice a vassoio + battuta + angoli arrotondati e tararne le quote (profondità vassoio, battuta, raggio).
- ⏳ **Gola a U**: ri-tarare le **tolleranze vetro** (spessore vetro + ~0,3–0,4 mm) con prove reali.
- ⏳ **Veletta LED** (vano per nascondere la strip LED) — prossimo step: sottrazione manifold sul retro/lato esterno (stessa famiglia del vassoio).
- ⏳ **Profili ornati**: mezzotondo (sezione tonda) e modanata (gole/tori). Base pronta: `CrossSection.extrude/revolve` di manifold già in uso per gli angoli arrotondati.
- ⏳ **Suggerimenti di progettazione φ (1.618)** per proporzioni cornice/passepartout; possibilità di **caricare cornici** custom con parametri.

### Studio / qualità
- ⏳ **Multilingua nello Studio** (ora solo IT). Base IT/EN/ES/PT esiste già sul web; va cablata con `t()`.
- ⏳ (Opzionale) **Materiale clay opaco + ambient occlusion** in anteprima (Federico ha scelto di tenere il lucido per ora).
- ⏳ Forme avanzate: bassorilievo su **cilindro/sfera** (palline di Natale, addobbi).
- ⏳ Editor **maschere/bombatura** (radiale convesso/concavo).

### Produzione / distribuzione
- ⏳ **Verifica build** completa (`pnpm build` verde) e creazione **installer** (`pnpm electron:build` → `release\ReliefForge Setup 8.1.0.exe`).
- ⏳ Test installer su **altro PC via USB** (non firmato → SmartScreen "Esegui comunque").
- ⏳ (Futuro) **firma del codice** per evitare l'avviso Windows (~200–400 €/anno o Azure Trusted Signing).
- ⏳ (Opzionale, M2) Motore depth **nativo** `onnxruntime-node` + **DirectML** per il modello Large senza limiti del browser. Nota: il Large via **WebGPU funziona già**, quindi M2 è un "di più", non un prerequisito.

### Web app
- ✅ **DECISO: web app CONGELATA** alla v8.1, focus sul desktop. Non si pusha più sul sito.
- Le modifiche restano **committate in locale** (eventuale push solo se un giorno si riprende il web).

---

## 5. Decisioni già prese (per non richiederle)
- Desktop = **Electron**, **Windows-first**, niente Python/Rust/CUDA (si userà **DirectML** se/quando si fa il nativo).
- Tema Studio = **scuro**. Materiale anteprima = **lucido** (per ora).
- Segmentazione = **dal depth**, senza modelli/licenze extra.
- Cornice STL = **sia fusa sia separata**.
- Tipi cornice desiderati = **tutti** (liscia, gradoni, mezzotondo, modanata) + caricabili + φ + passepartout.
- Distribuzione = **gratuita su GitHub**, donationware.
- **Web app congelata** alla v8.1 → si lavora solo sul desktop.
- **Priorità ora = finire le cornici** (dopo aver verificato la battuta in stampa).
- **Depth nativo (onnxruntime-node + DirectML)** = **in roadmap** (dopo le cornici / produzione), per togliere i limiti del browser. Il Large via WebGPU intanto basta.
- **Firma codice**: **distribuiamo NON firmato adesso** (zero costi, "Esegui comunque" è normale per app gratuite). Si valuterà **Azure Trusted Signing** (economico per singoli) solo SE l'avviso SmartScreen diventa un ostacolo reale all'adozione. Niente certificato EV costoso.

---

## 6. Note tecniche / trappole
- **Mount stale (ambiente di Claude)**: la sandbox a volte legge versioni vecchie/troncate dei file dopo le modifiche. I tool host (Read/Edit) sono autoritativi; la verifica vera la fa **Vite** (in `pnpm electron:dev` l'overlay rosso segnala errori reali).
- **Build SWC**: non fa typecheck → contano solo sintassi e import.
- `downloadReliefAssemblyStl` usa **manifold** (WASM) e produce 1 corpo watertight. ⚠️ Il cap NON tiene la mesh leggera: vedi sopra.
- Electron: WebGPU ok; `useBrowserCache=false` in Electron per la cache modello.

---

## 7. Stato commit
- Ultimo push su Vercel/GitHub `main`: **370f845** (fix predicted_depth).
- Commit locale successivo: **aba56f0** (Studio: bombatura, input numerici, export, donazione).
- Dopo aba56f0: **modifiche locali non ancora committate** (cornici a filo, battuta export, frame-only, cap, v8.1, bat, fix vari) → **da committare**.
- **Sessione 2026-06-22 (non committata)** — Cornici, refactor:
  - NUOVO `src/lib/relief/frame/buildFrameRectPocket.ts` (cornice a vassoio + angoli arrotondati + `effectiveFrameLipMm`).
  - ELIMINATO `src/lib/relief/frame/buildFrameRectPhi.ts`.
  - MODIFICATI `src/components/relief/reliefStl.ts` (CSG vassoio + `roundedBox` via CrossSection + auto-clamp battuta), `src/components/relief/ReliefPreview3D.tsx` (cornice a vassoio in anteprima, rimosso lip separato, vetro sul gradino), `src/pages/Studio.tsx` (slider Profondità vassoio + Arrotonda bordi, rename "Battuta vetro (gradino)"), `src/components/relief/ReliefWizard.tsx` (propagazione `pocketDepthMm`/`cornerRadiusMm`).
  - Stato: `tsc` pulito, `vite build` verde. **Verifica a video/stampa ancora da fare.**
