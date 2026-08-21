# Da incollare in una nuova conversazione Claude

> Copia tutto quello che sta **sotto la riga**, incollalo come primo messaggio in una chat nuova.
> È scritto per una conversazione normale, dove Claude non vede né i tuoi file né il codice: tutti i
> dati che servono sono già dentro.

---

Ciao. Ho bisogno di aiuto per portare sul mercato un software che ho già costruito. Ti do il
contesto completo, poi ti dico cosa mi serve.

## Chi sono

Mi chiamo Federico. Faccio stampa 3D FDM, modellazione, e post-produzione artigianale: lavorazione
dei pezzi stampati, cornici, e doratura a foglia. Ho sviluppato personalmente il software di cui
parliamo.

## Il prodotto

**ReliefForge** trasforma una fotografia in un **bassorilievo stampabile in 3D**, con cornice,
passepartout e vetro. Gira interamente in locale: nessun account, nessun caricamento su server,
nessun costo di calcolo per me. Esiste come applicazione desktop Windows (macOS già configurato ma
non ancora pubblicato) e come web app che gira nel browser.

### Cosa fa oggi, verificato

- Foto → mappa di profondità con AI → bassorilievo → STL.
- Import di una depth map già pronta, senza rielaborarla.
- Controllo di profondità, base, curva tonale, livelli, denoise, micro-dettaglio, contrasto.
- Dimensionamento in millimetri reali.
- Cornice parametrica **rettangolare, quadrata o rotonda**, generabile anche **senza alcuna
  immagine**, con bordino d'appoggio per il bassorilievo, sede del vetro a L, passepartout e veletta
  per strip LED.
- Bassorilievo **rotondo** costruito direttamente tondo, non ritagliato.
- Mesh adattiva: STL da 29 a 107 volte più leggeri a parità di resa.
- Export STL, OBJ, PLY, depth map PNG a 8 e 16 bit; cornice e rilievo separati oppure fusi.
- Anteprima 3D con tre rese (matcap, gesso, studio) e colori configurabili.
- Sette controlli automatici verificano geometria, tenuta manifold e invarianza degli STL a ogni
  modifica del codice.

### Cosa manca, e conta commercialmente

- **Export 3MF**: è il formato che rende vera l'espressione "print ready", perché porta dentro
  dimensioni, orientamento e profilo di stampa. Oggi c'è solo STL.
- **Controllo dello spessore minimo stampabile**: intercetta i dettagli più sottili dell'ugello prima
  che diventino un pezzo venuto male.
- **Anteprima delle finiture metalliche** (oro, rame, argento): serve a vendere, non a stampare.
- **Pagamento, download protetto e account** sulla web app: il generatore esiste già, manca il
  commercio attorno.

### Due vincoli tecnici da tenere presenti

1. Il calcolo gira sul **dispositivo del cliente**, non su un mio server. Il costo per generazione è
   quindi vicino a zero, ma chi ha un computer lento avrà un'esperienza lenta e su telefono
   probabilmente non funziona.
2. Se il cliente vede l'anteprima 3D, la geometria è **già sul suo computer**. Una preview gratuita a
   piena risoluzione regala il prodotto.

## La strategia che ho in mente

Non un semplice negozio di file STL, ma più livelli di monetizzazione sullo stesso asset digitale:

1. **Preview gratuita** — abbassa la barriera d'ingresso.
2. **File digitale** — STL base, STL + cornice, "Print Ready Pack".
3. **Licenza commerciale** — il cliente stampa e rivende il fisico, non il file.
4. **Personalizzazione assistita** — intervengo a mano quando l'automatismo non basta.
5. **Stampa fisica** — configuratore con dimensione, materiale, colore, cornice, finitura.
6. **Atelier** — pezzo stampato, rifinito e dorato a foglia, come prodotto premium.

I rischi che vedo: concorrenti che già convertono immagini in rilievi; la pirateria degli STL; il
tempo manuale della doratura come collo di bottiglia; e un negozio senza traffico che non vende.

## Cosa mi serve da te

Non ho ancora venduto niente. Il mio piano è cominciare producendo **tre pezzi** — uno per famiglia
di soggetti — misurando quanto tempo mi costa ciascuno, stampandoli, fotografando tutta la filiera
(immagine, depth map, anteprima, slicer, pezzo reale, versione dorata) e mettendoli su un marketplace
dove il traffico esiste già, invece di aprire subito un negozio mio.

Aiutami con:

- **le schede prodotto**: titoli, descrizioni, parole chiave per Etsy o Cults3D;
- **i prezzi**: quali fasce testare per file digitale, licenza commerciale, stampa fisica e pezzo
  dorato;
- **quali soggetti** conviene provare per primi, e perché;
- **il testo** che spiega la differenza fra scaricare un file e comprare un pezzo finito;
- **cosa misurare** nelle prime settimane per capire se sto vendendo un prodotto digitale o il mio
  tempo.

## Come vorrei che lavorassi

Dimmi anche quando qualcosa non ti convince: se un prezzo ti sembra sbagliato o una scelta rischiosa,
preferisco saperlo subito. Se ti manca un dato per rispondere bene, chiedimelo invece di ipotizzarlo.
E tieni conto che il tempo che posso dedicarci è limitato: preferisco poche cose fatte davvero a un
piano perfetto che non parte.
