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

### 5. La battuta vetro entrava DENTRO il bassorilievo

Segnalato da Federico sulla 8.5.0 e corretto: erano **due** compenetrazioni distinte,
non una.

La cornice ha due fori concentrici: il **vassoio** grande sul lato in vista (dove si
cala il vetro) e l'**apertura** piccola dietro la battuta. A trattenere il rilievo è
quella piccola. Il codice però dimensionava sul contenuto il *vassoio*, e ricavava
l'apertura sottraendo la battuta: con battuta 3 mm l'apertura veniva
`rilievo − 6 mm`, cioè la cornice entrava di **3,7 mm per lato** nel materiale del
bassorilievo. Non era "la battuta che copre qualche mm di quadro" — come avevo
scritto io: era compenetrazione vera. Ora si dimensiona l'apertura sul contenuto e
il vassoio si ricava aggiungendo la battuta.

In più la cornice era ancorata in Z con la **faccia anteriore** sul fronte del rilievo.
Ma ciò che deve appoggiarsi al rilievo è la **spalla della battuta**: il vassoio davanti
serve al vetro, e il vetro va davanti al rilievo. Con quell'ancoraggio la spalla — e con
lei il vetro — finiva `profondità incasso` mm **dentro** al bassorilievo (3,6 mm nel caso
segnalato). Ora la spalla cade esattamente sul fronte del rilievo.

Con i parametri del caso reale (bordo 5, altezza 21, battuta 3, incasso 3,6, gioco 0,3):

| | prima | dopo |
|---|---|---|
| battuta dentro il rilievo | 3,70 mm/lato | **0,70 mm/lato** (solo saldatura) |
| vetro dentro il rilievo | 3,60 mm | **0,00 mm** |

I nomi `frameBackInnerW` / `frameFrontInnerW` erano invertiti rispetto alla geometria
("back" era davanti) ed è probabilmente ciò che ha generato l'errore: rinominati in
`framePocketW` (vassoio) e `frameApertureW` (apertura). Caso G di `assembly:check`
blocca la regressione.

### 6. Nessuna quota derivata a schermo
Il pannello Cornice mostra ora **ingombro esterno**, **apertura visibile**,
**quanto la cornice copre il rilievo per lato** e l'**apertura del passepartout**,
più eventuali avvisi. Con i valori di default della 8.4 (battuta 3,2 + morso 1,0) la
cornice copriva **4,2 mm per lato** senza che nulla lo dicesse.

## Motore mesh adattivo

`buildSolidFromHeightmap` emetteva **2 triangoli per ogni cella**, uniformemente: lo sfondo
piatto di un ritratto costava esattamente quanto l'iride. Su una placca 93×63 mm il risultato
erano 1.131.856 triangoli e 56,6 MB — triangoli da ~0,1 mm con ugelli da 0,4 mm.

Nuovo `buildAdaptiveSolid.ts`: **quadtree ristretto** (bilanciato 2:1) guidato dall'errore
geometrico reale in millimetri. La densità segue il dettaglio. La mesh resta chiusa e senza
T-junction per costruzione: il bilanciamento 2:1 garantisce che ogni lato confini al massimo
con due foglie più fini, e la triangolazione a ventaglio inserisce il punto medio solo dove
il vicino è effettivamente più fine.

Misurato su un ritratto sintetico 1024×683, placca 90 mm, rilievo 3 mm:

| Tolleranza | Triangoli | STL | vs uniforme | Errore max | Errore medio |
|---|---|---|---|---|---|
| — (uniforme 8.4) | 1.405.602 | 67,0 MB | 1× | 0 | 0 |
| 0,20 mm | 13.292 | 0,6 MB | **107×** | 0,217 mm | 0,003 mm |
| 0,10 mm | 22.592 | 1,1 MB | **63×** | 0,127 mm | 0,002 mm |
| 0,06 mm (Fine) | 35.060 | 1,7 MB | **41×** | 0,086 mm | 0,002 mm |
| 0,03 mm (Massima) | 48.720 | 2,3 MB | **29×** | 0,066 mm | 0,001 mm |

Tutte watertight. L'errore *medio* resta sotto i 3 µm: la tolleranza viene spesa solo dove
serve. Il CSG manifold lavora di conseguenza su ordini di grandezza meno triangoli, quindi
anche l'export è molto più rapido.

Il mesher adattivo e' anche **1,8–2,5× piu' rapido da costruire** della griglia uniforme
(53 ms contro 97 ms a tolleranza 0,03 mm, su 1024×683). L'**anteprima usa lo stesso mesher
alla stessa tolleranza dell'export**: quello che vedi nel viewport e' letteralmente la mesh
che esporti, e il renderer regge 30–100× meno triangoli.

I profili mesh diventano tolleranze: **Bilanciato 0,12 mm · Fine 0,06 mm · Massima 0,03 mm**.
Interruttore "Mesh adattiva" nel pannello Rilievo per tornare alla griglia uniforme.

### Due trappole trovate e chiuse durante lo sviluppo

**La griglia di lavoro cambiava le dimensioni fisiche.** Il quadtree richiede una griglia
(Bx·2^D + 1) × (By·2^D + 1), il cui aspetto è quantizzato. Derivando l'altezza in mm da quella
griglia la placca si rimpiccioliva di ~1 mm e **la cornice appena sistemata non avrebbe più
combaciato**. L'altezza in mm ora viene dall'aspetto della heightmap originale.

**Il ricampionamento arrotondava per difetto.** Con `round` la griglia poteva risultare più
rada della sorgente: le incisioni nette (occhi) venivano smussate *prima* di triangolare, e
l'errore finale restava inchiodato a 0,39 mm per quanto si stringesse la tolleranza. Ora `ceil`:
la griglia non è mai più rada della heightmap. Il pavimento residuo è 0,066 mm, misurato
esplicitamente dal test e ben sotto la risoluzione di stampa.

## Algoritmo del bassorilievo: compressione nel dominio dei gradienti

Il difetto di fondo della pipeline 8.4: era tutta **puntuale** (blur, unsharp, gamma,
clip percentile), cioè funzioni della forma `h → f(h)`.

In una depth map il dislivello soggetto/sfondo domina l'intero intervallo: una testa
sporge di decine di centimetri, mentre naso, labbra e palpebre sono variazioni di
pochi millimetri appoggiate sopra quel dislivello. Schiacciando tutto in 3 mm, il
dettaglio di superficie finisce a pochi micron. Una funzione puntuale **non può**
rimediare: vede solo il valore, non quanto cambia rispetto ai vicini, quindi qualunque
curva che schiacci il salto grande schiaccia anche il dettaglio che ci sta sopra.

Nuovi `gradientRelief.ts` + `poisson.ts`: si lavora sulle derivate. Si attenuano i
gradienti **grandi** (silhouette) lasciando intatti i **piccoli** (superficie) con una
compressione logaritmica, poi si ricostruisce il campo risolvendo `lap(h) = div(g')`
con un multigrid a condizioni di Neumann. È l'approccio dei bassorilievi digitali di
riferimento (Weyrich et al., SIGGRAPH 2007).

Misurato su scena sintetica (cupola + dettaglio di ampiezza nota, rilievo 3 mm) —
ampiezza RMS dell'alta frequenza sopravvissuta:

| Metodo | Dettaglio | vs lineare |
|---|---|---|
| lineare (8.4) | 26 µm | 1,00× |
| gamma 0,6 | 24 µm | 0,90× |
| gamma 0,4 | 27 µm | 1,02× |
| **gradienti α=5** | **196 µm** | **7,5×** |
| gradienti α=10 | 203 µm | 7,8× |

Il confronto con gamma è la conferma della diagnosi: le rimappature puntuali non
spostano nulla. E la soglia che conta è pratica — un layer FDM tipico è 80–200 µm,
quindi **26 µm non si stampano proprio**, 196 µm sì.

Costo ~130 ms su 1024×683: compatibile con l'anteprima. Verifica di correttezza:
con compressione 0 la ricostruzione restituisce esattamente il campo di partenza
(differenza media 0,000000), il che valida gradienti, divergenza e risolutore insieme.

Nuovo slider **"Compressione gradienti"** nel pannello Profondità (0 = comportamento
8.4). Attivo per default nei quattro preset: Ritratto 4, Naturale 3, Scultura 6,
Fotografia 5.

## Resa del viewport

Un bassorilievo si giudica con la **luce radente**, non con l'illuminazione frontale:
è l'inclinazione a rivelare le incisioni. Il viewport 8.4 usava un materiale lucido
con quattro luci diffuse, che annegava il dettaglio nei riflessi.

- Nuova resa **"Gesso"** (default): materiale opaco, environment attenuato, luce chiave
  radente ad alta intensità e riempimento tenue. Serve a *valutare* il rilievo.
- Resa **"Studio"**: il comportamento lucido precedente, per presentare il pezzo.
- **Cursore della direzione luce** (0–180°) nel viewport: ruotare la luce è il gesto
  con cui si controlla un rilievo dal vero.

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
