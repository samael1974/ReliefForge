# ReliefForge — dove siamo e da dove ripartire

**Data:** 20 agosto 2026 · **Versione tecnica:** 8.20.1 · **Documento privato**

Questo file collega lo **stato reale del software** alla **strategia commerciale**. Serve a rispondere a
una domanda sola: *da cosa comincio domani mattina.*

---

## 1. La risposta breve

**Comincia dalla Fase 1 del tuo piano — il catalogo di 10–12 pezzi — e non scrivere una riga di
software nuovo per farlo.**

Il motivo non è la prudenza. È che la Fase 1 è l'unica cosa che verifica contemporaneamente le due
ipotesi su cui poggia tutto il resto:

1. **ReliefForge ha davvero un vantaggio tecnico.** Lo scopri producendo dodici pezzi veri: se ci
   metti poco e vengono bene, il vantaggio esiste. Se ogni pezzo richiede due ore di aggiustamenti,
   non esiste ancora — e nessuna piattaforma lo compenserebbe.
2. **Qualcuno vuole comprare questi soggetti.** Lo scoprono i primi acquisti, non un sondaggio.

Il rischio numero 1 del tuo stesso report ("competizione tecnologica") è quello che il resto del
piano dà per risolto. È l'unico che va verificato **prima**, e si verifica producendo.

---

## 2. Cosa il software sa già fare (verificato sul codice, 20/08/2026)

| Promessa commerciale del report | Stato reale |
|---|---|
| Da immagine a bassorilievo stampabile | ✅ foto → depth AI → rilievo → STL |
| Controllo della profondità | ✅ profondità, base, curva tonale, livelli |
| Smoothing / pulizia | ✅ denoise, dettaglio micro, rilievo locale, contrasto |
| Dimensionamento in mm | ✅ larghezza, altezza derivata, quote reali |
| Generazione automatica della cornice | ✅ rettangolare, quadrata, **rotonda**, con bordino d'appoggio e sede vetro |
| STL | ✅ rilievo, cornice sola, assieme fuso |
| Preview tridimensionale | ✅ con mesh adattiva: STL 29–107× più leggeri |
| Preview materiali e finiture | 🟡 tre rese (matcap, gesso, studio) e colori configurabili. **Manca oro / rame / argento** |
| File ottimizzato per stampa FDM | 🟡 mesh watertight verificata, ma manca un controllo esplicito degli spessori minimi |
| 3MF | ❌ non esiste. Ci sono STL, OBJ, PLY, depth PNG 8/16 bit |
| Import di una depth map già pronta | ✅ (utile per chi lavora già con altri strumenti) |

**Sette controlli automatici** verificano geometria, tenuta manifold e invarianza degli STL a ogni
modifica. È un asset di qualità che i concorrenti amatoriali non hanno: significa che il file che
vendi non cambia per caso da una versione all'altra.

### Cosa manca sul piano tecnico, in ordine di impatto commerciale

1. **3MF** — è il formato che rende "print ready" un'affermazione vera e non una promessa: porta
   dentro dimensioni, orientamento e profilo di stampa. Senza, il *Print Ready Pack* è uno STL con
   un PDF di istruzioni.
2. **Controllo dello spessore minimo** — verifica che nessun dettaglio scenda sotto la larghezza
   dell'ugello. È il difetto che il cliente scopre a stampa finita, ed è quello che genera i rimborsi.
3. **Preview delle finiture metalliche** — oro, rame, argento. Serve a vendere l'Atelier, non a
   stampare.
4. **CI rossa** — tutte le esecuzioni recenti falliscono in meno di un minuto. Va sistemata perché
   è ciò che costruisce l'app **macOS**, che è già configurata (dmg + zip, Apple Silicon e Intel) ma
   non è mai stata pubblicata.

---

## 3. Dove la strategia e il software non combaciano

**La web app esiste già.** La Fase 2 del tuo report ("generatore online") la dà come da costruire, ma
il progetto ha già `/relief`, `/depth` e `/studio` funzionanti in browser, con lo stesso codice del
desktop. Quello che manca non è il generatore: è **pagamento, download protetto e account**. È molto
meno lavoro di quanto il piano assuma.

**Il calcolo gira sul dispositivo del cliente.** La depth AI e la geometria girano nel browser, non su
un tuo server. Ottimo per i costi — il tuo KPI "costo computazionale per generazione" è
sostanzialmente **zero** — ma vuol dire che chi ha un PC lento avrà un'esperienza lenta, e su
telefono probabilmente non funzionerà. Da tenere presente quando misuri la conversione preview →
acquisto: una preview che non parte non è un cliente che non vuole comprare.

**La preview gratuita regala già il prodotto.** Se il cliente vede il 3D nel browser, la geometria è
sul suo computer. Serve una scelta: preview a risoluzione ridotta o con filigrana, e file pieno solo
dopo il pagamento. Non è un dettaglio implementativo, è il perno del Livello 1.

---

## 4. Da dove cominciare, in concreto

### Settimana 1 — produci, non programmare

Fai **tre** pezzi, non dodici. Uno per famiglia fra quelle che ti interessano di più (Bonds/Knots,
Botanical, Mediterranean). Per ciascuno annota due numeri:

- **quanto tempo** ci hai messo dalla foto all'STL buono;
- **quante volte** hai dovuto rifare.

Quei due numeri valgono più di qualunque analisi di mercato: ti dicono se il prodotto digitale è
scalabile o se stai vendendo il tuo tempo travestito da software.

### Settimana 2 — stampa e fotografa

Stampa quei tre. Fotografa **tutta la filiera** come dice il tuo report: immagine, depth map, preview,
slicer, pezzo reale. Quel set di foto è il tuo vero materiale di vendita — *"Not just downloadable.
Actually printable"* funziona solo con la prova in mano.

Se uno dei tre viene male, hai trovato il limite del software: quello è il prossimo sviluppo, e lo hai
scelto sui fatti invece che a intuito.

### Settimana 3 — vendi, dove il traffico c'è già

Metti quei tre su **Etsy o Cults3D**, non su uno Shopify nuovo. Il rischio 4 del tuo report è reale:
uno Shopify senza traffico non vende. I marketplace il traffico ce l'hanno, si prendono una
percentuale ed è il prezzo giusto per una validazione. Shopify ha senso **dopo** che sai cosa vende.

### Solo dopo — la piattaforma

Se i tre pezzi si vendono, allora ha senso il generatore online a pagamento. E a quel punto il lavoro
tecnico è ordinato così:

1. 3MF e spessore minimo → rendono vero "Print Ready"
2. Preview a risoluzione ridotta → protegge il Livello 1
3. Pagamento + download → chiude il ciclo
4. Finiture metalliche in preview → vende l'Atelier

---

## 5. Le tre cose che ti sconsiglio, con il perché

**Non partire da Shopify.** Costa canone e tempo, e senza traffico misura zero. Prima serve sapere se
qualcuno compra.

**Non costruire il configuratore di stampa adesso.** Dimensione, materiale, colore, cornice, finitura:
sono cinque assi. Finché non sai *quale* combinazione vogliono i clienti, stai costruendo l'interfaccia
per un catalogo che non esiste. Le prime venti stampe puoi gestirle a mano via email, e impari di più.

**Non mettere la doratura nel flusso standard.** Nel tuo report è già chiaro, ma vale ripeterlo: è
l'unica parte che non scala, e se finisce nel percorso principale diventa il collo di bottiglia che
blocca tutto il resto.

---

## 6. Il KPI che conta più di tutti, all'inizio

Fra quelli che elenchi, il primo da misurare non è il traffico né la conversione. È:

> **minuti di lavoro tuo per ogni pezzo prodotto.**

Se scende sotto i dieci minuti, hai un prodotto digitale. Se resta sopra l'ora, hai uno studio di
progettazione — che è un business legittimo ma completamente diverso, con prezzi diversi e volumi
diversi. Sapere quale dei due hai in mano cambia ogni altra decisione di questo piano.

---

## 7. Stato tecnico per chi riprende il codice

- Cartella di lavoro: `ReliefForgeV8.3 MAC - Copia\ReliefForge-git` (il nome inganna: è la copia
  aggiornata).
- Branch `feat/import-depth-map`, 20+ commit, spinto sul repo privato. **Non ancora unito a `main`.**
- Sette controlli: `pnpm check`, `assembly:check`, `adaptive:check`, `curve:check`, `stl:check`,
  `frameonly:check`, `circular:check`. Tutti verdi in locale.
- `SMOKE_TEST.ps1` li esegue tutti e avvia l'app.
- Repo pubblico di distribuzione: `samael1974/ReliefForge-Download` — **programmato per tornare
  privato il 21/08/2026 alle 18:00.**
- Stato verificato del codice: `docs/STATO-8.8.0-2026-08-20.md` (fermo alla 8.8, da aggiornare).
