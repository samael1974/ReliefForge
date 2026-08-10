# ReliefForge V8.7

ReliefForge trasforma immagini e depth map in bassorilievi 3D esportabili in STL, con cornice parametrica e profili ottimizzati per stampa 3D e CNC. App desktop per Windows basata su Electron.

## Installazione (utente finale)

**Windows**

1. Vai alla pagina **Releases** di questo repository.
2. Scarica `ReliefForge-Setup-8.7.1.exe`.
3. Doppio clic e segui la procedura guidata (lingua e cartella a scelta).
4. Avvia ReliefForge dall'icona sul Desktop o dal menu Start.

**macOS**

1. Dalla pagina **Releases** scarica il `.dmg` per il tuo Mac: `ReliefForge-8.7.1-mac-arm64.dmg` (chip Apple M1/M2/M3/M4) oppure `ReliefForge-8.7.1-mac-x64.dmg` (Mac Intel).
2. Apri il `.dmg` e trascina ReliefForge in Applicazioni.
3. Primo avvio: clic **destro** sull'app → Apri → Apri (l'app non è firmata Apple; dettagli in `ISTRUZIONI_MAC.txt`).

Non servono Node.js, pnpm o altri strumenti: l'installer contiene tutto.

> Nota: alla prima esecuzione Windows SmartScreen può mostrare un avviso perché l'installer non è firmato digitalmente. Clicca "Ulteriori informazioni" > "Esegui comunque". Su macOS vale l'equivalente (clic destro → Apri).

## Funzioni principali

- Conversione immagine -> depth map con modello AI (tre livelli di qualita': Veloce / Alta / Massima, WebGPU).
- Profili depth: Ritratto V8.1, Naturale V8.1, Scultura V8.3, Fotografia V8.3.
- Controlli fini: dettaglio micro, raggio dettaglio, rilievo locale, volume, contrasto, denoise.
- Mesh **adattiva** guidata dall'errore geometrico (Bilanciato 0,12 / Fine 0,06 / Massima 0,03 mm): STL leggeri a parita' di resa.
- Cornice e passepartout parametrici con battuta vetro e alloggiamento LED, con quote derivate mostrate a schermo.
- Export STL / OBJ / PLY e depth map 16-bit / 8-bit per CNC-CAM.

## Sviluppo

```powershell
pnpm install
pnpm electron:dev     # app desktop con dev server e DevTools
```

## Creare l'installer

Doppio clic su `CREA_SETUP_EXE.bat` (oppure `pnpm electron:build`).
L'installer viene creato in `release\ReliefForge-Setup-8.7.1.exe`.

## Requisiti consigliati

GPU con WebGPU per il modello depth in qualita' Massima; 16 GB di RAM consigliati. Risoluzione di elaborazione limitata a 1024 px per stabilita'.
