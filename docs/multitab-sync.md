# Sincronizzazione tra tab

NutriTrack tiene allineate le tab aperte sulla stessa app. I dati stanno in IndexedDB; quando una tab salva, avvisa le altre con un messaggio su `BroadcastChannel('nutritrack-sync')`. Il messaggio contiene solo la revisione: chi lo riceve rilegge il documento da IndexedDB.

## Chi possiede cosa

`src/lib/storage.ts` possiede revisioni e regole di conflitto. Lo store e la UI non manipolano mai le revisioni.

Ogni documento persistito porta, oltre ai dati, tre metadati (salvati anche nel record `meta`, piccolo da leggere):

- `revision`: intero crescente a ogni commit;
- `originTabId`: identificativo della tab, usato solo per spareggiare revisioni uguali;
- `syncKind`: `state` per un salvataggio normale, `reset` per la cancellazione di tutti i dati.

Sono metadati interni: l'export JSON per l'utente non li contiene.

## Ordine

Un commit locale avviene in una transazione IndexedDB che legge i metadati correnti e scrive il nuovo documento. La nuova revisione è maggiore sia dell'ultima vista da questa tab sia di quella persistita. IndexedDB serializza le transazioni sullo stesso store, quindi due tab non possono produrre la stessa revisione leggendo lo stesso predecessore.

Uno snapshot remoto si applica solo se il suo `(revision, syncKind, originTabId)` è più recente di quello corrente.

## Modifiche locali non ancora salvate

Il salvataggio automatico parte al frame successivo a una modifica. Se nel frattempo arriva l'avviso di un'altra tab, la modifica locale viene salvata prima: riceve una revisione più alta, quindi lo snapshot remoto più vecchio non può più sovrascriverla.

Invariante: **uno snapshot remoto più vecchio non sostituisce mai una modifica locale più recente.**

## Dialog aperti

Le bozze degli editor non fanno parte del documento persistito: uno snapshot remoto si applica anche con un dialog aperto. Gli editor confrontano i dati correnti con quelli di partenza al salvataggio e, se nel frattempo sono cambiati in un'altra tab, non sovrascrivono e lo dicono.

## Reset

Il reset scrive un documento vuoto con `syncKind: reset` e cancella il backup. È una barriera: una tab che lo riceve lo applica subito, anche sopra modifiche locali; una tab che ha perso l'avviso lo trova comunque nella transazione del suo prossimo salvataggio e applica il reset invece di sovrascriverlo.

## Tab in background

I browser sospendono `requestAnimationFrame` nelle tab nascoste: una tab in background riceve e applica lo stato remoto, ma aggiorna lo schermo quando torna visibile.

## Fuori dallo scopo

La sincronizzazione è a snapshot, non a fusione di campi: non c'è CRDT né log di operazioni, una complessità non giustificata per un'app locale a utente singolo. Tab con versioni diverse dell'app non sono uno scenario supportato: la proposta di aggiornamento serve a riportarle tutte alla stessa versione.
