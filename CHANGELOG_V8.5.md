# Changelog V8.5 — Cornice e passepartout

Rilascio di correzione geometrica. Il tema è uno solo: **quello che vedi in anteprima
è quello che esci in STL**, e il bassorilievo non viene più mangiato dagli altri pezzi.

## Difetti corretti

### 1. Il passepartout esportato non era un passepartout
In anteprima si vedeva l'anello a gradoni φ **con l'apertura**; l'export STL costruiva
invece un `Manifold.cube`, cioè una **lastra piena senza foro**, e la fondeva col rilievo.
Erano due oggetti diversi: è il motivo per cui nel file stampato il bassorilievo finiva
*inglobato nel passepartout*.

Ora l'export costruisce la stessa geometria a gradoni dell'anteprima con primitive
manifold (`buildPassepartoutManifold.ts`), watertight e componibile con cornice e rilievo.

### 2. Penetrazione fissa di 3 mm che seppelliva i rilievi sottili
La lastra entrava nel retro del rilievo di `OV = 3.0 mm` **costanti**. Con un rilievo di
spessore totale (base + profondità) ≤ 3 mm il fronte della lastra superava la superficie
e il rilievo spariva del tutto; anche a 5 mm ne consumava 3.

Ora la penetrazione è calcolata e **clampata**: lascia sempre almeno
`MIN_RELIEF_ABOVE_MAT = 0.8 mm` di rilievo davanti al passepartout, qualunque siano
spessore e slider di profondità. Se il valore richiesto non è ottenibile, l'utente
riceve un avviso esplicito invece di un STL sbagliato.

### 3. Anteprima ed export divergevano di 2 mm per lato
Senza passepartout, in export fuso:

| | apertura cornice |
|---|---|
| anteprima 8.4 | `rilievo + 2·gioco` (cornice **più grande**) |
| export 8.4 | `rilievo − 2·FRAME_INSET` (cornice **più piccola**, morde 1 mm/lato) |

Le due formule vivevano in file diversi (`ReliefPreview3D.tsx` e `reliefStl.ts`) e non
c'era nulla che le tenesse allineate.

Ora esiste **`assemblyLayout.ts`**: una sola funzione calcola tutte le quote derivate e
tutti i piani Z, ed è consumata sia dall'anteprima sia dall'export. La divergenza non è
più rappresentabile. Il nuovo pulsante **"Anteprima: fuso / separati"** nel viewport
sceglie quale dei due export stai guardando.

### 4. Cornice 0,03 mm più grande del rilievo
La cornice usava `widthMm · (h / w)` per l'altezza del piano, mentre
`buildSolidFromHeightmap` usa `widthMm · ((h−1) / (w−1))` (segmenti, non pixel).
Su 1024×683 sono 0,03 mm di scarto. Ora la formula è la stessa in entrambi.

### 5. Nessuna quota derivata a schermo
Il pannello Cornice mostra ora **ingombro esterno**, **apertura visibile**,
**quanto la cornice copre il rilievo per lato** e l'**apertura del passepartout**,
più eventuali avvisi. Con i valori di default della 8.4 (battuta 3,2 + morso 1,0) la
cornice copriva **4,2 mm per lato** senza che nulla lo dicesse.

## Pulizia

- Rimosso codice morto: `toGeom`, `mergeGeoms`, `csgUnion`, `csgSubtract` (orfani da
  quando la 8.4 ha eliminato il fallback non-manifold) e la dipendenza `three-bvh-csg`
  dal percorso di export.
- `roundedBox` estratto in `manifoldPrimitives.ts`, condiviso da cornice e passepartout.
- Una sola implementazione delle bande φ (`passepartoutBandsMm`), usata da anteprima ed export.

## Note per chi stampa

L'STL fuso resta **un corpo unico saldato**: è voluto, serve a stamparlo in un pezzo solo.
Per stampare cornice e rilievo separatamente usa **"Solo cornice"**, che ora applica
davvero il gioco impostato (niente morso di saldatura).

## Ancora da verificare

- Prova di stampa reale (Bambu) di cornice a vassoio + battuta + angoli arrotondati.
- Taratura delle tolleranze vetro con pezzi in mano.
