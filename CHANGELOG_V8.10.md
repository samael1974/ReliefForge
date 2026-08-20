# ReliefForge V8.10.0 — la cornice non ha più bisogno di un bassorilievo

## La novità

Fino alla 8.9 ogni progetto doveva partire da un bassorilievo: la cornice ricavava le proprie
proporzioni dalla heightmap, e senza di quella il pulsante «Solo cornice» rispondeva *«Genera prima il
rilievo (serve per le proporzioni)»*. Chi voleva soltanto stampare una cornice era costretto a
generare un rilievo che poi buttava via.

Ora ReliefForge apre anche progetti di **sola cornice**.

- Nella sezione **Immagine**, terza via dopo «Apri immagine» e «Apri depth map»: **Crea solo cornice**.
- L'apertura si dichiara: **Larghezza** e **Altezza apertura**, in millimetri. Senza rilievo non c'è
  nessuna proporzione da cui dedurla, quindi diventa un parametro esplicito invece di un valore
  implicito.
- L'**anteprima 3D** mostra la cornice da sola. Prima rispondeva «Carica un file per vedere il 3D»
  anche quando c'era una cornice perfettamente definita da mostrare.
- L'export **«Solo cornice»** non richiede più il rilievo.

È il punto 1 della roadmap, e il primo pezzo del modello di progetto: il programma comincia a
distinguere *cosa contiene* un progetto invece di presumere che contenga sempre tutto.

## Verifiche

Nuovo `pnpm frameonly:check`, anche in CI. Costruisce una cornice senza rilievo con la stessa funzione
usata dall'export e verifica che:

- la geometria non sia vuota e non contenga vertici non finiti;
- ci siano abbastanza triangoli per una cornice con apertura vera (48 su 24 vertici: un anello
  rettangolare estruso con la battuta, la geometria minima corretta a spigoli vivi);
- l'ingombro esterno superi l'apertura dichiarata su entrambi i lati, senza sbracare;
- **l'apertura rettangolare resti rettangolare.** Questo controllo esiste per un motivo preciso:
  l'anteprima, quando non trovava la heightmap, ripiegava su un'impronta **quadrata** di lato pari
  alla larghezza. Un progetto 130×100 sarebbe diventato 130×130 senza dire niente.

## Note tecniche

- `ReliefPreview3D` accetta `openingHeightMm` e non pretende più una heightmap per costruire cornice,
  passepartout e veletta LED: quelle tre geometrie avevano una guardia `if (!hmState) return null` che
  le spegneva anche quando erano perfettamente calcolabili.
- La mesh del rilievo, quando non c'è rilievo, riceve una `BufferGeometry` vuota invece di essere
  smontata dal JSX: meno rischio di rompere l'albero di rendering, stesso risultato a schermo.
- L'export di sola cornice sintetizza una heightmap piatta con le proporzioni dell'apertura. Serve
  unicamente a dare le quote: con `frameOnly: true` il rilievo non entra nel file.
- `frameonly-check.mts` usa `process.exitCode` e non `process.exit()`. Con `process.exit()` il WASM di
  manifold ha ancora handle aperti e libuv aborta con un'assertion, facendo fallire la CI **anche
  quando tutti i controlli passano**.
