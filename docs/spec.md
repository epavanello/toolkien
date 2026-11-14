# Toolkien — specifica per il generatore del progetto

Nov 14, 2026 · @Ema

## Istruzioni per l'agente

Sei un ingegnere senior che deve generare da zero il progetto descritto qui. Questa specifica è la fonte di verità: dove è ambigua, scegli l'opzione più sicura e semplice e annotala in `DECISIONS.md`.

1. Prima di scrivere codice, leggi la specifica MCP più recente su modelcontextprotocol.io e usa l'ultima versione stabile del protocollo, con negoziazione di versione.
2. Proponi struttura del repo, schema del database e piano per milestone, poi procedi milestone per milestone.
3. Ogni milestone termina con test verdi, migrazioni del database e un `README` aggiornato.
4. Non introdurre servizi esterni non elencati qui senza segnalarlo.
5. Lingua: tutto il progetto è in inglese (codice, nomi, commenti, commit, README, file in \`docs/\`, \`DECISIONS.md\`, testi dell'interfaccia, landing, email, bozze legali). L'italiano si usa solo per parlare con l'autore in chat. Nessuna predisposizione i18n: le stringhe in inglese stanno direttamente nei componenti. Tutto il codice è in TypeScript strict.

## Contesto e obiettivo

Toolkien (nome provvisorio) è un gateway MCP in “code mode”: l'utente collega **un solo** server MCP ai suoi client (Claude, Codex, Cursor e altri), e da lì usa tutti i server MCP remoti che ha configurato sulla piattaforma.

- L'agente non riceve centinaia di schemi di tool: scopre i tool con strumenti di discovery e legge solo le definizioni TypeScript (`.d.ts`) che gli servono.
- L'agente esegue script TypeScript in una sandbox Deno; lo script può solo chiamare i tool consentiti, passando dal bridge.
- Le chiamate di scrittura sono soggette a permessi espliciti e approvazioni umane.
- Supporta workspace personali e aziendali, con connettori condivisi pre-autenticati dall'admin.
- Il servizio fa da intermediario: non conserva i contenuti che transitano, solo i metadati necessari.

Fase iniziale: gratuito, limiti larghi, solo server MCP **remoti** (directory curata + URL aggiunti dall'utente).

## Brand e marketing

Nome: **Toolkien**, gioco di parole tra _tool_ e Tolkien. Tono del marketing in inglese, ironico ma da prodotto serio.

- Tagline principale: _“One MCP to rule them all.”_
- Alternative per hero e social: _“Connect once. Call them all.”_, _“One tool to find them, one sandbox to run them.”_
- Usare nel codice una costante unica per nome e tagline (`src/lib/brand.ts`), così si cambiano in un punto solo.
- Landing page nello stesso stile sobrio dell'app: niente immagini, font o simboli riconducibili alle opere di Tolkien (anelli, mappe, rune), solo il gioco di parole nel testo.

Prima del lancio: verifica di marchi e domini sul nome; questa nota non costituisce consulenza legale.

## Stack e deploy

| Componente               | Tecnologia                                     | Note                                                                                                   |
| ------------------------ | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| App web, API, server MCP | SvelteKit (adapter-node), Svelte 5, TypeScript | Istanza singola; remote functions come nei progetti di riferimento                                     |
| UI                       | shadcn-svelte + Tailwind                       | Componenti custom (Button con spinner e icone native, ecc.) copiati dai progetti di riferimento        |
| Autenticazione           | Better Auth                                    | Login utenti, organizzazioni, e se possibile ruolo di authorization server OAuth per i client MCP      |
| Database                 | Turso (libSQL/SQLite gestito), regione UE      | Drizzle con driver libSQL; migrazioni versionate                                                       |
| Stato temporaneo         | In memoria nell'app                            | Rate limit, sessioni MCP, cache dei `.d.ts`, job pianificati; niente Redis finché l'istanza è una sola |
| Segreti                  | OpenBao                                        | Transit engine per envelope encryption                                                                 |
| Runner                   | Deno, container fatto da noi                   | Supervisore + un processo Deno per esecuzione                                                          |
| Proxy di egress          | Container dedicato                             | Unica uscita verso gli upstream                                                                        |
| Deploy                   | Coolify su VPS in UE                           | Un'unica risorsa Docker Compose                                                                        |

- Rete interna Docker: solo l'app è esposta pubblicamente; runner, OpenBao ed egress proxy non hanno porte pubbliche.
- Il runner è su una rete isolata che raggiunge **solo** il bridge.
- Configurazione via variabili d'ambiente gestite da Coolify; nessun segreto nel repo. Lo stato in memoria presuppone \*\*una sola istanza\*\*: niente rolling deploy con due istanze attive insieme, e tutto ciò che deve sopravvivere a un riavvio va su Turso. Il passaggio a più istanze richiederà uno store condiviso (es. Redis).

## Riferimenti dai progetti esistenti

Struttura, convenzioni e pattern vanno presi dai progetti dell'autore nella cartella dei sideproject sul Mac: **DevMotion**, **Hi Cherries** e i più recenti modificati. Prima di generare codice, l'agente deve:

1. Trovare i repo (chiedere il percorso se non li trova) e ordinarli per data di ultima modifica: in caso di conflitto vince il più recente.
2. Riassumere in `docs/conventions.md` cosa ha ricavato: struttura delle cartelle, naming, uso delle remote functions, configurazione di Better Auth, schema e migrazioni, gestione errori, test, lint e format.
3. Copiare i componenti custom (Button con spinner e icone native e gli altri già personalizzati) invece di rigenerarli da shadcn-svelte; quelli mancanti si aggiungono con la CLI di shadcn-svelte.
4. Non copiare segreti, `.env`, dati o logica di business specifica di quei progetti.

**Remote functions e query reattive**: per i dati che devono aggiornarsi in tempo reale (stato delle esecuzioni, approvazioni in attesa, log attività) usare la tecnica di `$lib/remote/liveQuery.svelte` del progetto in `/Users/emanuele/Pack/pack/` (il file può avere estensione `.svelte.ts`). Prima di copiarla, verificare se la versione corrente di SvelteKit offre un metodo nativo più semplice per query live o aggiornamenti in streaming: se c'è, usarlo e annotare la scelta in `DECISIONS.md`.

## Design

Stile enterprise “old school” alla PostHog: denso, sobrio, funzionale, pensato per chi lo usa tutto il giorno.

- Sidebar a sinistra con selettore del workspace in alto; sezioni: Connettori, Directory, Permessi, Attività, Membri, Impostazioni.
- Tabelle dense con filtri, ricerca e paginazione come vista principale; dettagli in pagina o pannello laterale.
- Palette neutra, un solo colore d'accento, stati con colori semantici (riuscito, in attesa, errore).
- Monospace per ID, nomi dei tool e firme TypeScript; badge per livelli di permesso e per “non verificato”.
- Light e dark mode, navigazione completa da tastiera, accessibilità WCAG AA.
- Niente illustrazioni decorative o animazioni superflue.

## Deploy su Coolify e OpenBao

Tutto gira in **una sola risorsa Docker Compose** su Coolify; solo l'app ha un dominio pubblico.

| Servizio        | Reti Docker                  | Volume persistente | Esposto             |
| --------------- | ---------------------------- | ------------------ | ------------------- |
| app (SvelteKit) | `public`, `core`, `sandbox`  | No                 | Sì, dominio Coolify |
| openbao         | `core`                       | Sì (storage raft)  | No                  |
| egress-proxy    | `core`, `public`             | No                 | No                  |
| runner          | `sandbox` (`internal: true`) | No                 | No                  |

Turso è esterno al VPS: l'app lo raggiunge via HTTPS con un token in variabile d'ambiente. Il database contiene solo token già cifrati da OpenBao, che resta sul VPS: un furto del database non espone credenziali.

**Runner fatto da noi**

- Un supervisore leggero (Deno) riceve i job dall'app via HTTP sulla rete `sandbox`, autenticato con un segreto condiviso, e avvia un processo `deno run` senza permessi per ogni esecuzione.
- Le chiamate ai tool tornano all'app sulla stessa connessione; la rete `sandbox` è interna, quindi il runner non ha alcuna uscita verso internet.
- **Mai** montare il socket Docker in app o runner, e niente docker-in-docker.
- Opzioni del container: `read_only`, `tmpfs` per `/tmp`, `cap_drop: [ALL]`, `no-new-privileges`, limiti di CPU, memoria e numero di processi.

**OpenBao: cosa impostare**

1. Immagine ufficiale OpenBao, **mai in dev mode**; storage raft integrato su volume persistente, listener solo sulla rete `core`.
2. Inizializzazione una tantum: chiavi di unseal (Shamir) e root token conservati offline, fuori dal server; root token revocato dopo il setup.
3. Unseal dopo ogni riavvio: manuale con script documentato in prima versione; valutare auto-unseal (KMS esterno o altra istanza) più avanti.
4. Transit engine con una chiave `toolkien-tokens` di tipo derivato, con l'ID del workspace come contesto: ogni workspace ha di fatto la sua chiave.
5. Policy `app`: solo `encrypt`, `decrypt` e `rewrap` su quella chiave, nient'altro.
6. Autenticazione dell'app con AppRole: `role_id` e `secret_id` nelle variabili d'ambiente di Coolify, token brevi e rinnovabili.
7. Audit device attivo (i valori sensibili sono hashati), rotazione periodica della chiave transit con `rewrap` in background.
8. Snapshot raft cifrati inclusi nei backup, separati dai backup del database.

L'agente deve fornire `docker-compose.yml`, script di init e unseal, e una guida passo passo in `docs/deploy-coolify.md`.

## Architettura a componenti

L'unico componente esposto è l'app SvelteKit; il runner esegue codice non fidato su una rete isolata che raggiunge solo il bridge.

&#91;embedded content: architettura · 7 componenti su un VPS Coolify\]

Il bridge è l'unico punto che decifra i token e chiama gli upstream, sempre attraverso il proxy di egress. Può stare nell'app SvelteKit come modulo separato, con interfacce pronte per estrarlo in un servizio a parte.

## Protocollo MCP e OAuth verso i client

Toolkien espone **un** server MCP remoto con trasporto Streamable HTTP, all'ultima versione stabile della spec, e fa da authorization server OAuth 2.1 secondo la sezione Authorization della spec.

**OAuth**

- Usare i plugin di Better Auth per OAuth e MCP se coprono la versione corrente della spec, altrimenti un'implementazione dedicata sopra Better Auth. Protected Resource Metadata e Authorization Server Metadata pubblicati agli endpoint well-known previsti.
- Registrazione client secondo la spec corrente (Client ID Metadata Documents e/o Dynamic Client Registration).
- PKCE S256 obbligatorio, resource indicator obbligatorio, token legati all'audience di Toolkien.
- Access token brevi (15 minuti), refresh token con rotazione e rilevamento del riuso.
- Schermata di consenso: l'utente vede il client che chiede accesso e sceglie il workspace iniziale.

**Tool esposti ai client** (l'elenco è fisso e breve):

| Tool               | Funzione                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------ |
| `workspace_list`   | Elenca i workspace dell'utente e quello attivo                                                   |
| `workspace_switch` | Cambia workspace attivo per la sessione (vedi Workspace)                                         |
| `tools_search`     | Cerca tool per testo nel workspace attivo; restituisce percorsi e una riga di descrizione        |
| `tools_describe`   | Restituisce le definizioni `.d.ts` dei percorsi richiesti                                        |
| `execute`          | Esegue uno script TypeScript nel runner; restituisce risultato o stato in attesa di approvazione |
| `execution_status` | Stato o ripresa di un'esecuzione in pausa                                                        |

- Le descrizioni dei tool spiegano all'agente il flusso: cerca, descrivi, poi esegui.
- Il server usa l'elicitation quando il client la dichiara nelle capability, altrimenti il fallback fuori banda (vedi Permessi).

## Workspace, ruoli e connettori

Ogni utente ha un workspace personale e può appartenere a più workspace aziendali. Un'azienda crea il suo workspace, invita gli utenti, e i membri ereditano i connettori pre-autenticati dall'admin.

| Ruolo  | Può fare                                                                                                     |
| ------ | ------------------------------------------------------------------------------------------------------------ |
| Owner  | Tutto, incluse fatturazione futura, eliminazione del workspace e trasferimento di proprietà                  |
| Admin  | Gestire membri, connettori condivisi, policy dei permessi, vedere i log di tutti                             |
| Member | Usare i connettori consentiti, aggiungere connettori personali se la policy lo permette, vedere i propri log |

**Connettori**

- _Condiviso_: autenticato dall'admin con le credenziali aziendali; i membri lo usano senza vedere i token.
- _Personale nel workspace_: ogni membro autentica il proprio account (es. il suo Gmail aziendale).
- Fonte: directory curata (configurazione e annotazioni verificate) oppure URL libero aggiunto dall'utente (marcato “non verificato”).
- Autenticazione upstream: OAuth (con PKCE) oppure token/API key incollato dall'utente.

**Policy dell'admin**: elenco dei server ammessi, permessi minimi imposti che i membri non possono allentare, divieto o consenso ai connettori personali e agli URL liberi.

**Cambio di workspace**: una sola connessione MCP per client; il cambio avviene con `workspace_switch` solo su richiesta esplicita dell'utente.

- Il cambio richiede conferma umana (elicitation o fallback) e viene registrato nei log.
- Ogni esecuzione è legata a **un solo** workspace: uno script non può mai usare tool di due workspace.
- Il workspace attivo è sempre indicato nei risultati di `tools_search` ed `execute`, così l'utente vede dove sta operando.

## Discovery, tipi TypeScript e refresh

I tool upstream diventano funzioni TypeScript tipizzate, raggruppate per connettore: `await gmail.searchThreads({ query })`.

- Generazione: da `inputSchema` e `outputSchema` MCP a `.d.ts`, con descrizioni come JSDoc e annotazioni riportate in un commento (`@readOnly`, `@destructive`).
- Senza `outputSchema` il ritorno è `unknown`, e il JSDoc invita l'agente a ispezionare il risultato.
- Nomi normalizzati in camelCase, univoci per workspace; collisioni risolte con il prefisso del connettore.
- `tools_search` restituisce solo percorsi e una riga; `tools_describe` restituisce i tipi completi solo per i percorsi chiesti. Ricerca testuale (SQLite FTS5) in prima versione.
- I tool non consentiti dai permessi non compaiono nella discovery.

**Refresh delle definizioni**

1. Notifica `tools/list_changed` dall'upstream, quando supportata.
2. Ricarica all'apertura di ogni sessione e cache con scadenza di 6 ore.
3. Refresh automatico quando una chiamata fallisce per tool inesistente o parametri non validi: si rigenerano i tipi e l'errore restituito all'agente include la nuova firma.
4. Pulsante “aggiorna” nella UI del connettore.

Ogni rigenerazione salva una versione delle definizioni; se cambiano firme già approvate nei permessi, il tool torna “da confermare”.

## Runner Deno ed esecuzione

Il runner esegue codice non fidato e non vede mai token, database o rete esterna: ogni chiamata a un tool passa per il bridge.

- Un processo Deno nuovo per ogni esecuzione, avviato senza permessi (nessun `--allow-*`), con limiti di memoria V8, timeout e kill forzato.
- Container: utente non root, filesystem in sola lettura, `/tmp` in memoria, CPU e RAM limitate, seccomp di default; runtime gVisor se disponibile.
- Comunicazione: l'app parla con il supervisore del runner via HTTP sulla rete interna, il supervisore con il processo Deno via JSON-RPC su stdin/stdout: lo script vede solo le funzioni generate, che serializzano la chiamata e attendono la risposta.
- Nessun accesso a `fetch`, `Deno.env`, filesystem o import remoti; gli import sono limitati ai moduli forniti.
- Il codice viene type-checkato contro i `.d.ts` prima dell'esecuzione; gli errori tornano subito all'agente.

**Esecuzione durevole**: ogni chiamata a un tool riceve un numero di sequenza.

1. Se una chiamata richiede approvazione, l'esecuzione va in pausa e lo stato viene salvato su Turso, non in memoria, così sopravvive a riavvii e deploy (codice, risultati già ottenuti per sequenza, cifrati con OpenBao e cancellati alla fine dell'esecuzione o alla scadenza).
2. Alla ripresa lo script viene rieseguito; le chiamate già completate restituiscono il risultato in cache, senza ripeterle.
3. Le scritture già eseguite non vengono mai ripetute.

**Output**: risultato e `console.log` restituiti all'agente, troncati oltre una soglia configurabile con un avviso esplicito. Limiti iniziali larghi ma configurabili: timeout 120 s, 200 chiamate a tool per esecuzione, output 100 KB.

## Permessi e approvazioni

Ogni tool ha un livello di permesso impostabile dall'utente, come nei client Claude e Codex: **consentito sempre**, **chiedi conferma**, **bloccato**.

| Origine del tool | Annotazione                   | Default                                                            |
| ---------------- | ----------------------------- | ------------------------------------------------------------------ |
| Directory curata | `readOnlyHint: true`          | Consentito sempre                                                  |
| Directory curata | Scrittura o `destructiveHint` | Chiedi conferma                                                    |
| URL libero       | Qualsiasi annotazione         | Proposta come default, l'utente conferma alla prima configurazione |
| Qualsiasi        | Nessuna annotazione           | Trattato come scrittura: chiedi conferma                           |

- Le policy dell'admin prevalgono: un membro può solo rendere i permessi più restrittivi.
- Il bridge controlla il permesso a ogni singola chiamata, non solo in discovery.

**Approvazioni a runtime**

- Con elicitation supportata: dialogo con testo esplicito (connettore, tool, argomenti principali, workspace) e scelte “approva solo questa”, “approva tutte le chiamate a questo tool in questo script”, “rifiuta”.
- Senza elicitation: l'esecuzione va in pausa, `execute` restituisce un link alla pagina di approvazione di Toolkien e lo stato “in attesa”; l'agente usa `execution_status` dopo la conferma.
- L'approvazione non deve **mai** poter arrivare dal modello: nessun tool `approve` esposto via MCP.
- Le approvazioni in attesa scadono dopo 30 minuti.

**Modalità piano** (milestone successiva): esecuzione con scritture simulate, elenco delle azioni previste, una sola approvazione per il batch, poi esecuzione reale.

## Sicurezza

Obiettivo: anche con il database rubato, nessun token upstream è leggibile.

**Credenziali upstream**

- Envelope encryption: una data key per workspace, cifrata dal transit engine di OpenBao; i token sono cifrati con AES-256-GCM e l'ID del workspace come dato associato.
- La chiave master non lascia mai OpenBao; rotazione delle chiavi supportata senza downtime.
- Decifratura solo nel bridge, in memoria, al momento della chiamata; mai nei log, negli errori o nelle risposte.
- Refresh automatico dei token OAuth upstream, scope minimi, revoca all'eliminazione del connettore.
- **Nessun passthrough**: il token che il client dà a Toolkien non viene mai inoltrato upstream.

**URL liberi (SSRF)**

- Solo `https`; blocco di IP privati, loopback, link-local, metadata cloud e reti Docker interne.
- Risoluzione DNS verificata al momento della connessione (contro il DNS rebinding), nessun redirect verso indirizzi bloccati.
- Le chiamate upstream escono da un proxy di egress dedicato.

**Tool poisoning**: descrizioni dei server non verificati marcate come tali nei `.d.ts` e in UI; avviso all'utente se le descrizioni cambiano.

**Applicazione**: sessioni con cookie `HttpOnly`, `Secure`, `SameSite`; CSRF; header di sicurezza (CSP, HSTS); dipendenze bloccate e verificate; 2FA o passkey per owner e admin.

## Log e audit

I log registrano chi ha fatto cosa e quando, mai i contenuti: né argomenti, né risultati, né il codice degli script.

| Campo              | Esempio                                                                               |
| ------------------ | ------------------------------------------------------------------------------------- |
| Data e ora         | 2026-11-14 10:32:05 UTC                                                               |
| Utente e workspace | Mario Rossi, workspace “Acme”                                                         |
| Client MCP         | Claude, Codex, Cursor                                                                 |
| Evento             | Esecuzione, chiamata a tool, approvazione, cambio workspace, modifica permessi, login |
| Connettore e tool  | `github.createIssue`                                                                  |
| Esito e durata     | Riuscito, 840 ms                                                                      |
| Approvato da       | Utente stesso, admin, policy automatica                                               |

- Vista per l'utente finale: timeline delle proprie attività, filtrabile per connettore ed esito, raggruppata per esecuzione.
- Vista admin: stessa timeline per tutti i membri del workspace, con filtro per utente ed export CSV.
- Log append-only, conservazione 90 giorni (configurabile), poi eliminazione automatica.
- Log tecnici del server separati, senza dati personali oltre agli ID, conservazione 14 giorni.

## Privacy e documenti legali

Principio: **minimizzazione dei dati**. Toolkien non conserva i contenuti che transitano; conserva solo account, credenziali cifrate, configurazioni e log di metadati. Non dichiarare “non conserviamo nulla”: non sarebbe accurato.

- Server e sub-responsabili in UE (provider del VPS, Turso in regione UE); nessun analytics di terze parti, solo cookie tecnici.
- Per i dati che transitano Toolkien agisce come responsabile del trattamento per conto dei clienti.
- Export dei dati e cancellazione dell'account dal pannello utente.

L'agente deve generare **bozze** in `legal/`, in inglese (versione italiana da valutare prima del lancio), pagine pubbliche nel sito:

- [ ] Privacy policy
- [ ] Termini di servizio
- [ ] Data Processing Agreement (DPA)
- [ ] Elenco dei sub-responsabili
- [ ] Policy di conservazione dei dati
- [ ] Pagina sicurezza (architettura, cifratura, segnalazione vulnerabilità)
- [ ] Cookie policy (solo cookie tecnici, niente banner)

Ogni bozza riporta in testa: _“Bozza generata automaticamente: da rivedere con un avvocato o un DPO prima della pubblicazione.”_

> Avvertenza: le indicazioni di questa sezione sono orientative e non costituiscono consulenza legale.

## Limiti, abusi, kill switch, eliminazione

Limiti larghi ma sempre presenti e configurabili da pannello admin di piattaforma.

- Rate limit per utente, per workspace e per IP (es. 60 esecuzioni al minuto per utente), in memoria: si azzerano al riavvio, accettabile con un'istanza singola.
- Limiti di concorrenza del runner per utente e globali, con coda.
- **Kill switch** a tre livelli: utente, workspace, piattaforma. Revoca immediata di sessioni, token OAuth dei client ed esecuzioni in corso; i connettori upstream restano configurati ma sospesi.
- **Eliminazione account**: revoca dei token upstream presso i provider dove possibile, cancellazione di credenziali e configurazioni, log anonimizzati o eliminati secondo la policy.
- **Eliminazione workspace**: solo l'owner, con conferma e periodo di grazia di 7 giorni.
- Point-in-time restore di Turso più un export giornaliero cifrato sul VPS, con test di ripristino documentato; le chiavi restano in OpenBao, separate dai backup.

## Test e compatibilità

- Unit test (Vitest) per generazione dei `.d.ts`, permessi, cifratura, validazione degli URL.
- Test di integrazione con server MCP finti (con e senza `outputSchema`, annotazioni, OAuth, `list_changed`).
- Test di sicurezza del runner: tentativi di `fetch`, lettura env e file, loop infiniti, consumo di memoria, import remoti; tutti devono fallire.
- Test SSRF con indirizzi privati, IPv6, redirect e DNS rebinding.
- Test end-to-end del flusso OAuth e MCP con MCP Inspector.
- Matrice manuale documentata in `docs/compatibility.md`: Claude, Codex, Cursor, VS Code, con supporto rilevato per OAuth, elicitation form e URL, notifiche.

## Milestone

Ogni milestone è rilasciabile e chiude con test verdi.

1. **Fondamenta**: repo, docker-compose per Coolify, Postgres e migrazioni, login utente, workspace personale, OpenBao e modulo di cifratura.
2. **Connettori**: directory curata, aggiunta di URL liberi con protezione SSRF, OAuth e token upstream, generazione dei `.d.ts`, refresh.
3. **Server MCP**: OAuth 2.1 verso i client, `tools_search`, `tools_describe`, `workspace_list`, `workspace_switch`.
4. **Runner**: container Deno, bridge JSON-RPC, `execute` con type-check, limiti e troncamento dell'output.
5. **Permessi e approvazioni**: livelli per tool, elicitation, fallback con pagina di approvazione, esecuzione durevole.
6. **Workspace aziendali**: inviti, ruoli, connettori condivisi, policy dell'admin.
7. **Log, kill switch, eliminazione, export**, pagine legali in bozza.
8. **Modalità piano** e rifiniture UX.

## Decisioni aperte

Finché non vengono decise, l'agente usa il default indicato e lo annota in `DECISIONS.md`.

| Decisione                    | Default                                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------------------------- |
| Nome definitivo e dominio    | “Toolkien” come nome provvisorio nel codice, facile da sostituire                                       |
| Metodo di login degli utenti | Better Auth con i metodi usati nei progetti di riferimento; passkey o 2FA obbligatori per owner e admin |
| Supporto Python negli script | Escluso dalla prima versione                                                                            |
| Directory curata iniziale    | 10–20 server MCP remoti popolari, elenco da definire                                                    |
| Pricing                      | Gratuito; registrare già le metriche di uso per workspace                                               |
