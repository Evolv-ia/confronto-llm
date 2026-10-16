# Pubblicazione automatica dei dati

Il sito si aggiorna ogni giorno senza interventi manuali e senza account condivisi:

```
PC di Matteo (attività pianificata) → fork ai-maps-hub/confronto-llm, branch "dati"
  → PR verso Evolv-ia/confronto-llm
  → workflow "Pubblica dati" (.github/workflows/pubblica-dati.yml): verifica
  → merge commit con il token di MattiaBezzi
  → deploy Git di Vercel (attribuito a mattiabezzi97, l'unico seat)
```

Nessun deploy da CLI: la produzione parte solo dal merge su `main`.

## Cosa controlla il workflow

Il workflow usa `pull_request_target`: gira con il codice di `main`, legge la PR **solo come dati**
tramite l'API e non esegue mai codice del fork. Lo script è `scripts/pubblica-dati.mjs`; il
validatore dei dati è `scripts/valida-dati.mjs`.

1. **Provenienza.** La PR deve essere aperta da `ai-maps-hub` (verificato anche l'id dell'account),
   dal suo fork `ai-maps-hub/confronto-llm` (fork di questa repo, verificato via API: owner e parent),
   branch `dati`, verso `main`. Se la variabile `FORK_REPO_ID` è impostata, anche l'id del fork deve
   coincidere.
2. **Contenuto.** La PR deve partire dal `main` attuale e cambiare **solo** `index.html`. Il
   contenuto scaricato deve avere lo stesso hash dichiarato dalla PR.
3. **Dati.** Cambia solo la riga `const PIATTAFORME = [...]`:
   - JSON valido;
   - stesse schede (`confronto-2026`, `openrouter`, `regolo`, `edenai`) e stessi campi;
   - date valide, non precedenti a quelle pubblicate e non nel futuro;
   - prezzi e punteggi nei limiti;
   - per ogni scheda, modelli non in calo oltre il 20% e non in crescita oltre il 50%;
   - nei testi nessun tag diverso da `<strong>` e nessuno script.
4. **Interruttore.** Senza la variabile `PUBBLICAZIONE_AUTOMATICA` = `attiva` il workflow verifica e
   commenta, ma **non mergia**.
5. **Token di merge.** Il secret `MERGE_TOKEN` deve esistere ed essere un token a grana fine di
   `MattiaBezzi` che può scrivere su questa repo e **non** vede altri repo privati dell'organizzazione.
   Se manca o non è conforme, nessun merge.
6. **Ricontrollo.** Subito prima del merge il workflow ricontrolla che PR e `main` non siano cambiati.
   Il merge è un merge commit vincolato allo SHA verificato. Dopo, controlla che il commit pubblicato
   abbia due genitori e autore `MattiaBezzi`.
7. **Una verifica alla volta.** Il gruppo di concorrenza impedisce merge in parallelo. Una PR già
   mergiata non viene pubblicata di nuovo, e il merge su `main` non riavvia il workflow.

Se i dati non sono validi la PR resta aperta con un commento che spiega il motivo. L'aggiornamento del
giorno dopo aggiorna la stessa PR e viene verificato di nuovo. Un cambiamento voluto alla struttura del
sito (grafica, schede, campi) non passa in automatico: si fa con una PR normale, mergiata a mano.

## Configurazione manuale (solo MattiaBezzi, una volta)

Il token non va mai incollato in chat, in file o in commit: solo nella pagina dei secret di GitHub.

1. **Token a grana fine.** GitHub, entrato come MattiaBezzi → Settings → Developer settings →
   Personal access tokens → **Fine-grained tokens** → Generate new token.
   - Nome: `confronto-llm-merge`. Scadenza: la più lunga accettata dall'organizzazione; segnare in
     calendario il rinnovo.
   - **Resource owner: `Evolv-ia`.**
   - **Repository access: Only select repositories → `Evolv-ia/confronto-llm`** (solo questa).
   - **Permissions → Repository permissions → Contents: Read and write.** Metadata (sola lettura) si
     aggiunge da solo. Nient'altro.
   - Se l'organizzazione richiede l'approvazione dei token: Evolv-ia → Settings → Personal access
     tokens → Pending requests → approva.
2. **Secret.** `Evolv-ia/confronto-llm` → Settings → Secrets and variables → Actions → **New
   repository secret**: nome `MERGE_TOKEN`, valore il token appena creato.
3. **Variabili** (stessa pagina, scheda *Variables*):
   - `FORK_REPO_ID`: l'id del fork, quando Matteo l'ha creato (`gh api repos/ai-maps-hub/confronto-llm -q .id`);
   - `PUBBLICAZIONE_AUTOMATICA`: **non impostarla finché la verifica in prova non è andata bene**
     (vedi sotto). Poi impostala a `attiva`.

Il workflow verifica da solo che il token sia di MattiaBezzi, sia a grana fine, possa scrivere su
questa repo e non veda altri repo privati: se qualcosa non torna non mergia e lo scrive nella PR.

## Attivazione in sicurezza

1. Mergiare la PR che introduce il workflow (merge commit). Da qui il workflow **verifica soltanto**.
2. Matteo configura fork e script (`docs/istruzioni-matteo.md`). Impostare `FORK_REPO_ID`.
3. Al primo aggiornamento automatico: la PR deve avere il commento "Dati validi ... nessun merge".
   Quella prima PR si può mergiare a mano (merge commit) per non lasciare il sito indietro.
4. Creare il token e il secret `MERGE_TOKEN`, poi impostare `PUBBLICAZIONE_AUTOMATICA` = `attiva`.
5. Al giro successivo verificare tutta la catena:
   - commento "Pubblicato con il merge commit ...";
   - su `main` un merge commit di MattiaBezzi con due genitori;
   - Vercel: deployment di produzione da Git, **creato da mattiabezzi97**, READY, sullo stesso SHA;
   - il sito mostra la nuova data "aggiornata al" e risponde 200;
   - nessun deploy da CLI.

**Spegnere in emergenza:** cancellare la variabile `PUBBLICAZIONE_AUTOMATICA` (o il secret
`MERGE_TOKEN`). Il workflow continua a verificare e commentare, ma non mergia più.

## Test

```
node --test "scripts/test/*.test.mjs"
```

I test usano l'`index.html` reale e un'API GitHub simulata: nessuna chiamata di rete.
