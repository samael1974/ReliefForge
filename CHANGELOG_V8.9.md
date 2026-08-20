# ReliefForge V8.9.0 — import di una depth map già elaborata

## Novità

### Studio accetta una depth map esterna

Fino alla 8.8 lo Studio poteva partire solo da una fotografia: la profondità la stimava sempre l'AI.
Ora, nella sezione **Immagine**, sotto un separatore, c'è **Apri depth map**.

- **Non serve nessuna immagine.** La depth map da sola basta a generare il rilievo.
- **Passthrough di default**: la depth entra esattamente com'è. Niente livelli, niente curva tonale,
  niente dettaglio, niente normalizzazione. Il lavoro fatto a monte non viene toccato.
- Una casella, **Rielabora con i controlli di Profondità**, riaccende l'intera pipeline esistente
  quando la si vuole davvero.
- **PNG 8/16 bit** letti dal decoder proprio, che i 16 bit li legge davvero senza passare da un canvas
  a 8 bit. Se il PNG è interlacciato o a palette — formati che quel decoder non copre — si ripiega
  automaticamente sul decoder di Chromium a 8 bit, **dichiarando il motivo** invece di fallire.
- **JPEG e WebP** accettati, con avviso esplicito: sono compressi a 8 bit e i loro artefatti a blocchi
  diventerebbero rilievo stampato.
- Oltre 1024×1024 la depth viene riscalata con `resampleHeightmapFiltered`, lo stesso filtro
  passa-basso già usato da anteprima ed export, per non saturare Electron.

### Pannello diagnostico

Dopo l'import compaiono dimensioni, profondità di bit reale, e soprattutto **quanto fondo scala usa
davvero la depth map**, con i valori minimo e massimo. Sotto il 40% arriva un avviso: un rilievo che
esce schiacciato non è un difetto del programma, è la depth map che usa poca escursione. Senza questo
dato, quel caso sembra un bug.

Se l'import fallisce, il motivo compare in un riquadro rosso nel pannello, non solo nella barra di
stato in fondo.

### Wizard: la depth map importata non viene più ri-normalizzata

Il generatore web ri-normalizzava sempre la depth map caricata, cancellando in parte il lavoro fatto a
monte. Ora il comportamento di default è il passthrough, con **Normalizza il range** riattivabile con
un click per chi vuole il rilievo più marcato di prima.

## Verifiche

### Nuovo controllo: invarianza degli STL

`pnpm stl:check` genera sei STL di riferimento da heightmap sintetiche deterministiche (rampa,
gaussiana, gradino, per `flat`/`recessed`/`offset` più un caso a mesh adattiva) e ne confronta hash
SHA-256, numero di triangoli, ingombro in mm e dimensione del file con i riferimenti committati in
`scripts/stl-golden.json`.

Copre una lacuna reale: `assembly:check`, `adaptive:check` e `curve:check` verificano **proprietà**
— watertight, tolleranza, monotonia. Una deriva silenziosa della geometria li supererebbe tutti,
perché la mesh resterebbe chiusa e nei limiti. Verificato per mutazione: una variazione di 0,001 mm
fa fallire il controllo con uno scarto di ingombro leggibile.

Quando la geometria cambia **volutamente**: `UPDATE_GOLDEN=1 pnpm stl:check`, poi si committa il diff
di `stl-golden.json`, che documenta esattamente cosa è cambiato.

### CI completata

Il workflow eseguiva solo `assembly:check` e `adaptive:check`. Ora esegue anche **`curve:check`**, che
esisteva ma non veniva mai lanciato in automatico, e il nuovo **`stl:check`**.

## Note tecniche

- `Raw.luma` è diventato nullable e `processHeightmap` salta `fuseDepthDetail` quando manca: senza
  immagine di colore non c'è luma da cui estrarre il micro-dettaglio, quindi la fusione non è
  disattivabile per sbaglio — è strutturalmente impossibile.
- Estratta `buildReliefStlBinary()` da `downloadReliefStlBinary()`: costruisce lo STL del solo rilievo
  e lo restituisce in memoria, senza toccare il DOM, così è eseguibile in Node. È la condizione che
  rende possibile `stl:check`. Il comportamento dell'export non cambia.
