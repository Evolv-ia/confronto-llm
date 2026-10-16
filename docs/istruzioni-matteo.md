# Istruzioni per l'AI sul PC di Matteo

Da incollare all'assistente AI che gestisce l'attività pianificata "DSH - Modelli OpenRouter".

---

Devi adattare l'automazione che aggiorna i dati del sito confronto-llm al nuovo flusso di
pubblicazione. **Non cambiare la generazione dei dati né la frequenza o l'orario dell'attività
pianificata**: cambia solo come il risultato arriva su GitHub.

## Flusso nuovo

Generazione dati (invariata) → commit sul fork personale `ai-maps-hub/confronto-llm`, branch `dati` →
pull request verso `Evolv-ia/confronto-llm`. Il controllo e la pubblicazione li fa un workflow di
GitHub nella repo dell'organizzazione: tu **non** pubblichi niente.

## Regole

- Usa solo l'account GitHub personale **ai-maps-hub**. Mai `Evolv-ia` / `evolvia-legacy`.
- Niente Vercel sul PC: **nessun** `vercel deploy`, `vercel --prod` o simili.
- Non pushare mai su `Evolv-ia/confronto-llm` e mai sul branch `main`: solo sul branch `dati` del fork.
- Non scrivere token o password in file, script, log o messaggi.

## 1. Pulizia delle credenziali vecchie (una volta)

1. `vercel logout`, poi cancella la cartella `.vercel/` nella copia locale del progetto (se c'è).
2. Gestione credenziali di Windows: rimuovi le voci GitHub che non sono di `ai-maps-hub`
   (`git:https://github.com`, `gh:github.com:*`). Se usi `gh`: `gh auth status` e, per un account
   diverso da `ai-maps-hub`, `gh auth logout --hostname github.com --user <account>`.
3. `gh auth login` con l'account **ai-maps-hub**, poi `gh auth setup-git`.
4. Verifica: `gh api user -q .login` deve rispondere `ai-maps-hub`.

## 2. Fork e copia locale (una volta)

```
gh repo fork Evolv-ia/confronto-llm --clone=false
```

Nella copia locale usata dall'automazione:

```
git remote set-url origin https://github.com/ai-maps-hub/confronto-llm.git
git remote add upstream https://github.com/Evolv-ia/confronto-llm.git   # se esiste già: set-url
git config user.name  "<nome di Matteo>"
git config user.email "<email di Matteo associata a ai-maps-hub>"
```

Comunica a Mattia l'id del fork (`gh api repos/ai-maps-hub/confronto-llm -q .id`).

## 3. Script dell'attività

Mantieni la generazione esistente. Attorno a lei lo script deve fare, nell'ordine:

```
git fetch upstream main
git checkout -B dati upstream/main          # riparti SEMPRE dal sito pubblicato
<generazione esistente: aggiorna SOLO la riga "const PIATTAFORME = [...]" di index.html>
git diff --quiet -- index.html && exit 0    # nessun dato nuovo: fine
git add index.html                          # solo questo file
git commit -m "dati AAAA-MM-GG: N modelli su quattro schede"
git push --force-with-lease origin dati     # solo il branch dati del fork
APERTE=$(gh pr list --repo Evolv-ia/confronto-llm --head dati --author ai-maps-hub --state open --json number -q length)
[ "$APERTE" = "0" ] && gh pr create --repo Evolv-ia/confronto-llm --base main --head ai-maps-hub:dati \
  --title "dati AAAA-MM-GG" --body "Aggiornamento automatico dei dati."
```

Su Windows (PowerShell o .cmd) traduci gli stessi passi; la logica non cambia.

Requisiti, perché il workflow accetti la PR:

- il branch `dati` parte dal `main` attuale di `Evolv-ia/confronto-llm` (passo `checkout -B ... upstream/main`);
- la PR cambia **solo** `index.html`, e dentro `index.html` **solo** la riga `const PIATTAFORME = ...`;
- la struttura dei dati resta quella attuale (stesse quattro schede, stessi campi): un cambio di struttura
  o di grafica va proposto a Mattia con una PR normale, non con l'automazione.

Se la PR del giorno prima è ancora aperta, il push forzato su `dati` la aggiorna: non aprirne un'altra.

## 4. Verifica dopo il primo giro

- Su GitHub c'è una PR da `ai-maps-hub:dati` verso `Evolv-ia/confronto-llm`, con un commento del
  workflow "Pubblica dati" che dice se i dati sono validi.
- Nessun deploy partito dal PC; nessuna credenziale diversa da `ai-maps-hub` usata.
- L'attività pianificata ha lo stesso orario e la stessa frequenza di prima.

Se il commento dice "dati non validi", leggi il motivo e correggi la generazione: non forzare la
pubblicazione in altri modi.
