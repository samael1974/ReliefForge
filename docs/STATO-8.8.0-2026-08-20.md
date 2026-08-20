# ReliefForge 8.8.0 — stato verificato sul codice

**Data:** 20 agosto 2026 · **Base:** `main` @ `4b1c226`, allineato a `origin/main` · **Versione:** 8.8.0

Questo documento **sostituisce** `HANDOFF-2026-08-20.md` (scritto nella cartella `ReliefForgeV8.4`).
Quel documento analizzava la **8.4.0** credendola l'ultima versione: la 8.8.0 esisteva già su GitHub
dal 10 agosto. Tutte le sue conclusioni su file, numeri di riga e debito tecnico vanno considerate
**scadute**. Le voci qui sotto sono state riverificate una per una sul codice della 8.8.0.

---

## 1. Errori dell'handoff precedente, corretti

| Affermazione dell'handoff 8.4 | Realtà sulla 8.8.0 |
|---|---|
| «Versione reale 8.4.0, non esiste alcuna 8.8.0» | **Falso.** `origin/main` è 8.8.0, tag `v8.8.0`, 15 commit del 9–10 agosto |
| «Nessun test automatico, nessun runner» | **Falso.** `scripts/assembly-check.mts`, `curve-check.mts`, `adaptive-check.mts` + CI GitHub Actions |
| «Veletta LED: zero occorrenze, feature nuova» | **Falso.** Già implementata: toggle, sporgenza, profondità, anello positivo in anteprima e in export |
| «`buildFrameRectPhi.ts` ancora presente, due cornici coesistono» | **Superato.** Quei file sono stati eliminati dalla 8.5 il 10 agosto |
| «Wizard e Studio duplicati» | **Vero, ancora.** `ReliefWizard.tsx` 1437 righe, `Studio.tsx` 1376 |
| «Studio non importa depth map» | **Vero, ancora.** Unico input immagine: `accept="image/*"` |

---

## 2. Cosa è arrivato con le versioni 8.5 → 8.8

- **Mesh adattiva** (`buildAdaptiveSolid.ts`): STL 29–107× più leggeri a parità di resa; anteprima ed
  export usano lo **stesso** mesher.
- **Assieme cornice + passepartout coerente** fra anteprima ed export; fix della battuta vetro che
  entrava dentro il bassorilievo.
- **Modulo di layout geometrico** (`frame/assemblyLayout.ts`, `computeAssemblyLayout`, costanti
  `WELD_BITE`, `MAT_OVERLAP`, `MIN_RELIEF_ABOVE_MAT`) + `manifoldPrimitives.ts` +
  `buildPassepartoutManifold.ts`.
- **Algoritmo del rilievo nel dominio dei gradienti**, resa **gesso**, vista **Matcap**
  (`render/makeMatcap.ts`).
- **Curva tonale** sulla depth map (`transform/toneCurve.ts` + `DepthCurve.tsx`), che ha sostituito i
  livelli con istogramma della 8.7.0.
- **Veletta LED** completa.
- **CI** (`.github/workflows/build.yml`): typecheck, build, `assembly:check`, `adaptive:check`, poi
  installer Windows e macOS.
- Versione unica letta da `package.json` (l'app diceva ancora 8.4).

---

## 3. Infrastruttura di test esistente

Tre verifiche headless, eseguite bundlando i `.mts` con esbuild (`scripts/run-assembly-check.mjs`
risolve l'alias `@` e gli import Vite `?url`, così il WASM di manifold funziona in Node):

| Comando | Cosa verifica |
|---|---|
| `pnpm assembly:check` | Assieme cornice + passepartout + rilievo: watertight, numero di corpi, ingombri, e che il rilievo resti **visibile** |
| `pnpm adaptive:check` | Mesher adattivo: chiuso come l'uniforme, tolleranza dichiarata rispettata, peso molto minore |
| `pnpm curve:check` | Curva tonale: identità, monotonia (nessuna curva può invertire il rilievo), equivalenza ai livelli |

**Sono verifiche di proprietà, non di invarianza.** Nessuna di esse si accorge se un STL cambia
*silenziosamente* a parità di parametri: la mesh resterebbe chiusa e nei limiti, quindi passerebbero.
Il criterio di regressione della roadmap — «STL rettangolari invariati a parità di parametri» — **non
è quindi ancora coperto**.

⚠️ **`curve:check` non è nella CI**: il workflow esegue solo `assembly:check` e `adaptive:check`.

---

## 4. Roadmap riverificata sulla 8.8.0

| # | Punto | Stato | Evidenza |
|---|---|---|---|
| — | **Import depth map in Studio** | 🔴 aperto | `Studio.tsx:1217` solo `accept="image/*"` |
| 1 | Cornice indipendente dall'immagine | 🔴 aperto | Ogni azione è bloccata su `hmState`; «Solo cornice» richiede il rilievo «per le proporzioni» (`Studio.tsx:613`) |
| 2 | Sistema generale di forma (rett./circ.) | 🔴 aperto | Zero occorrenze di circolare/cerchio/diametro in tutto `src/` |
| 3 | Bassorilievo circolare | 🔴 aperto | idem |
| 4 | Cornice circolare | 🔴 aperto | idem |
| 5 | Compatibilità 4 combinazioni | 🔴 aperto | dipende da 2–4 |
| 6 | Eliminare lo spostamento sinistra/destra | 🔴 aperto | Barra verticale sinistra da 70 px (`Studio.tsx:808`), Inspector a destra (`:886`) |
| 7 | Cornice sempre disponibile | 🟡 parziale | I passi sono liberamente cliccabili (nessun `disabled` sulla barra), ma le **azioni** restano bloccate senza `hmState` |
| 8 | Gruppi collassabili nella sezione Cornice | 🔴 aperto | Nessun accordion in `Studio.tsx` |
| 9 | Esporta in due passaggi | 🟡 parziale | Gli output ci sono tutti (STL, OBJ, PLY, depth 16/8, assieme, solo cornice) ma in elenco piatto e tutti gated su `hmState` |
| 10 | Modulo geometrico dedicato per le booleane | 🟢 in gran parte fatto | `assemblyLayout.ts`, `manifoldPrimitives.ts`, `buildPassepartoutManifold.ts`; `buildReliefAssemblyGeometry` è esportata e pura |
| 11 | Depth Map e Curva richiudibili per sezione | 🔴 aperto | Pannello sempre presente in fondo all'Inspector (`:1128`, `:1165`) |
| 12 | Inspector ridimensionabile | 🔴 aperto | Larghezza **fissa a 250 px**, sotto il minimo di 280 che chiedevi |
| 13 | Eliminare parametri duplicati | 🔴 aperto | `QualityPills` renderizzato due volte: barra in alto (`:799`) e sezione Immagine (`:895`) |
| 14 | Spostare «Offri un caffè» dall'Inspector | 🟢 fatto per Studio | PayPal è solo nel Wizard (`ReliefWizard.tsx:1104`, `:1306`); Studio non lo ha |
| 15 | Shortcut `Ctrl+1..5` | 🔴 aperto | Solo `Ctrl+S` (`Studio.tsx:489`) |
| 16 | Toolbar del viewport | 🟡 parziale | Ci sono wireframe e stile di resa (matcap/gesso/studio); mancano adatta alla finestra, centra, reset camera, griglia, ortogonale/prospettica |
| 17 | Parametri con reset e indicatore `🔒 Auto` | 🔴 aperto | Esiste `levelsAuto` per i livelli, ma nessun reset per parametro né marcatore per i valori derivati |
| 18 | Preset di progetto | 🟡 parziale | Esiste **un solo** preset («ritratto») + custom; i quattro storici sono stati rimossi nella 8.5 perché tarati su una pipeline superata. Mancano i preset di progetto (rilievo rett./circ., cornice semplice/vetro/passepartout/LED) |
| — | Veletta LED | 🟢 fatta | `rimOn`/`rimW`/`rimD` (`Studio.tsx:348-350`), anello positivo in anteprima e in export |

---

## 5. Debito tecnico confermato sulla 8.8.0

1. **Nessuna verifica di invarianza sugli STL** — vedi sezione 3.
2. **`curve:check` fuori dalla CI.**
3. **Wizard e Studio restano UI duplicate** sopra la stessa geometria (1437 + 1376 righe).
4. **Nessun modello di progetto**: lo stato è sparso in `useState` dentro `Studio.tsx`; il programma
   non sa «cosa contiene il progetto». I punti 1, 2, 5, 7 e 9 lo richiedono tutti.
5. **`downloadReliefStlBinary` è ancora accoppiata al DOM** (scarica e basta). Per l'assieme il pezzo
   puro esiste già (`buildReliefAssemblyGeometry`), per il **solo rilievo** no: manca l'equivalente
   che restituisca il binario in memoria, che è la condizione per testarne l'invarianza.
6. **Versionamento a copie di cartelle**: `ReliefForge`, `V8.2`, `V8.3`, `V8.3 - Copia`,
   `V8.3 MAC - Copia`, `V8.4`. La copia allineata a GitHub è **`ReliefForgeV8.3 MAC - Copia\ReliefForge-git`**,
   cioè la più aggiornata ha il nome più fuorviante. È la causa diretta dell'errore di oggi.

---

## 6. Copie locali e loro versione (20/08/2026)

| Cartella | Versione | Git |
|---|---|---|
| `ReliefForgeV8.3 MAC - Copia\ReliefForge-git` | **8.8.0** | `main` @ `4b1c226`, pulita, allineata a origin ✅ |
| `ReliefForgeV8.4` | 8.4.0 | branch locale `feat/8.5-depth-import`, **non pubblicato** |
| `ReliefForge` | 8.1.0 | `main` @ `623361e` |
| `ReliefForgeV8.2` / `V8.3` / `V8.3 - Copia` | 8.2 / 8.3 | senza git |

**Lavorare solo in `ReliefForge-git`.**
