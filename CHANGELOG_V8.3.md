# ReliefForge V8.3

## Obiettivo

Recuperare la leggibilità e la morbidezza della resa V8.1 mantenendo i controlli fini della V8.2, con una preview più stabile e un STL meno pesante.

## Correzioni principali

- Risoluzione desktop uniformata a un massimo di 1024 px; rimossa la strada 1600 px.
- Quattro preset di depth non distruttivi, compresi due riferimenti V8.1.
- Esposti raggio del dettaglio e scala del rilievo locale, prima nascosti nello Studio.
- Avviso quando dettaglio, gamma e denoise formano una combinazione incline a creare grana artificiale.
- Ricampionamento Gaussian + bilineare al posto del salto secco dei pixel.
- Tre profili geometria con stima preventiva di griglia e triangoli.
- Retro piano compatto: conserva la superficie frontale densa ma elimina la seconda griglia completa inutile sul fondo.
- Preview a DPR controllato, ombre calcolate una sola volta e materiale verde V8.1 più leggibile.
- Protezione da crash WebGL: un errore del renderer non deve più trasformare l'intera interfaccia in una pagina bianca.
- Oggetti di preview memoizzati per evitare la ricostruzione delle cornici a ogni aggiornamento dello stato.
- Vite limitato a 127.0.0.1 e cartelle locali/cache escluse dal watcher.
- Avvio Windows più rapido: le dipendenze vengono installate solo quando mancano.

## Compatibilità

- I progetti `.rforge` precedenti restano apribili: i parametri mancanti ricevono valori V8.1 sicuri.
- I nuovi progetti vengono salvati con `appVersion: 8.3.0` e `fileVersion: 2`.
- Il fondo offset mantiene la griglia completa perché segue le normali; l'ottimizzazione compatta si applica ai fondi piatto e incassato.

## Verifiche eseguite

- TypeScript: superato.
- ESLint: nessun errore bloccante; restano avvisi legacy già presenti nel progetto.
- Build Vite di produzione: superata.
- Test topologico su fondo piatto, incassato e offset: zero bordi aperti e coordinate finite.
- Server di preview della build: HTML e bundle Studio serviti con risposta HTTP 200.

La qualità finale va comunque validata con le immagini campione e con l'importazione dello STL nello slicer usato per la stampa.
