# ReliefForge - Riepilogo e stato del progetto

> Documento storico V8.1. Per la revisione corrente leggere `CHANGELOG_V8.3.md` e `ISTRUZIONI_V8.3.txt`.

Aggiornamento: 28 giugno 2026

## Obiettivo

ReliefForge e un'applicazione desktop gratuita per trasformare immagini e depth map in bassorilievi 3D esportabili, con strumenti per cornici, passepartout, vetro, illuminazione LED e preparazione alla stampa 3D o alla lavorazione CNC.

Cartella di lavoro principale:

`<cartella-locale>\ReliefForge`

## Tecnologie principali

- Electron per l'applicazione desktop Windows.
- React, TypeScript e Vite per l'interfaccia.
- Three.js e React Three Fiber per la preview 3D.
- Transformers/Hugging Face e ONNX Runtime per la stima della profondita.
- Manifold 3D per fusioni e sottrazioni booleane affidabili.
- Electron Builder e NSIS per la creazione dell'installer Windows.

## Funzioni disponibili

### Immagine e profondita

- Apertura di immagini JPG, PNG e WEBP.
- Generazione automatica della depth map con qualita Veloce, Alta e Massima.
- Regolazione di dettaglio, volume, contrasto, denoise e segmentazione del soggetto.
- Inversione della profondita e isolamento del soggetto.
- Esportazione della depth map a 8 e 16 bit per CNC/CAM.

### Bassorilievo

- Preview 3D interattiva con griglia, assi e modalita wireframe.
- Controllo di larghezza, profondita, base e decimazione.
- Esportazione STL chiuso e stampabile.
- Esportazione OBJ e PLY.
- Controllo automatico della complessita della mesh.

### Cornice e passepartout

- Cornice rettangolare regolabile per spessore e altezza.
- Angoli arrotondabili.
- Passepartout a gradoni proporzionati.
- Regolazione della larghezza, dello spessore e del salto dei gradoni.
- Correzione dell'aggancio tra passepartout e cornice quando la banda viene ampliata.
- Preview ed esportazione STL basate sulla stessa impronta geometrica.
- Esportazione fusa oppure della sola cornice separata.

### Vetro e illuminazione

- Alloggiamento vetro realizzato con sottrazione booleana negativa.
- Gola a U aperta superiormente per inserire la lastra.
- Regolazione della profondita della gola e dello spessore della sede.
- Veletta LED positiva separata dall'alloggiamento vetro.
- Regolazione della sporgenza interna e della profondita della veletta.
- Blocco dell'esportazione se la booleana dello scasso vetro non riesce.

### Colori e preferenze

- Nuova tendina `Preferenze` con icona impostazioni.
- Modalita interfaccia chiara o scura.
- Colore configurabile del bassorilievo.
- Colore configurabile della cornice.
- Colore configurabile del passepartout.
- Aggiornamento immediato dei materiali nella preview 3D.
- Salvataggio automatico delle preferenze sul computer.
- Inclusione dei colori e del tema nei progetti `.rforge`.
- Comando con icona per ripristinare le impostazioni predefinite.

### Progetti e menu File

- Apertura di un progetto `.rforge`.
- Voce `Salva` nel menu File.
- Scorciatoia `Ctrl+S`.
- Il progetto salva immagine, parametri del rilievo, cornice, passepartout, vetro, veletta LED e preferenze grafiche.
- Esportazioni STL e depth map accessibili dal menu File.
- Messaggio commerciale configurabile manualmente dal menu File.

## Avvio, icona e installazione

Sono disponibili:

- `AVVIA_RELIEFFORGE.bat`: avvio dell'applicazione in sviluppo.
- `INSTALLA_RELIEFFORGE.bat`: installazione delle dipendenze.
- `CREA_ICONA_DESKTOP.bat`: creazione del collegamento sul desktop.
- `CREA_INSTALLER_WINDOWS.bat`: generazione dell'installer Windows.
- Cartella `logo` con icona PNG e ICO di ReliefForge.
- Icona applicata all'app, al collegamento desktop e all'installer.

## Installer multilingua

L'installer NSIS mostra il selettore della lingua e supporta:

- Italiano.
- Inglese.
- Spagnolo.
- Portoghese.
- Francese.
- Tedesco.

Installer verificato e generato:

`release\ReliefForge Setup 8.1.0.exe`

Dimensione rilevata: circa 267 MB.

L'interfaccia generale del progetto dispone gia di traduzioni IT, EN, ES e PT. Lo Studio desktop principale contiene ancora diverse etichette italiane: la traduzione completa dello Studio resta una fase successiva.

## Analisi STL eseguite

### BUDDA-cornice-rotta.stl

- STL binario formalmente valido.
- Mesh chiusa e manifold.
- Nessun bordo aperto o triangolo degenerato.
- Il difetto rilevato dipendeva dal calcolo non uniforme tra passepartout e cornice, non da una corruzione del file.
- Formula di preview ed esportazione corretta.

### CORNICE DENTINO VETRO.stl

- Dimensioni: 104 x 104 x 21 mm.
- 56 triangoli.
- Nessun bordo aperto o non manifold.
- La geometria presente era una sporgenza positiva, correttamente riclassificata come `Veletta LED`.
- La nuova voce `Alloggiamento vetro` usa invece una booleana negativa.

## Verifiche del 28 giugno 2026

- Compilazione Vite di produzione: superata.
- Moduli trasformati: 2385.
- Verifica browser della schermata `/studio`: superata.
- Menu File con voce Salva: presente.
- Tendina Preferenze: presente e funzionante.
- Tema chiaro: verificato visivamente.
- Selettori colore: presenti per bassorilievo, cornice e passepartout.
- Errori console browser durante la verifica: nessuno.
- Installer Windows NSIS: generato correttamente.

## Stato tecnico e rischi noti

- La compilazione di produzione e funzionante.
- Il controllo ESLint generale non e ancora pulito: 69 errori e 12 avvisi, in gran parte relativi a tipizzazioni `any`, componenti storici e regole Fast Refresh.
- I messaggi del build segnalano alcuni pacchetti JavaScript di grandi dimensioni; in futuro sara utile dividere il caricamento dei modelli AI e delle librerie STL.
- Il database Browserslist risulta datato e andra aggiornato.
- Il repository contiene molte modifiche non ancora consolidate in un commit Git dedicato.
- L'installer non e firmato con un certificato commerciale; Windows SmartScreen potrebbe mostrare un avviso sui computer degli utenti.

## Prossime priorita consigliate

1. Test pratico completo con immagini reali e nuovi STL.
2. Verifica dimensionale dello scasso vetro con tolleranze da stampa.
3. Traduzione completa dello Studio desktop.
4. Riduzione degli errori ESLint e miglioramento delle tipizzazioni.
5. Ottimizzazione delle dimensioni dell'installer e caricamento differito dei modelli AI.
6. Preparazione di una release GitHub con installer, README aggiornato e note di versione.
7. Eventuale firma digitale dell'eseguibile Windows.

## Nota sui colori

I colori configurati modificano la visualizzazione della preview 3D e vengono salvati nel progetto. Un file STL non contiene normalmente informazioni di colore: per mantenere colori/materiali in un file esportato e necessario usare formati che li supportano oppure gestire il colore nello slicer e nel processo di stampa.
