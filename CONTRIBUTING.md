# Come si pubblica confronto-llm

Il sito va online **solo** con il deploy automatico di Vercel dopo un merge su `main`.

- **Aggiornamento quotidiano dei dati:** automatico. Fork `ai-maps-hub/confronto-llm`, branch `dati`,
  PR verificata e mergiata dal workflow "Pubblica dati". Dettagli: `docs/pubblicazione-automatica.md`;
  istruzioni per l'automazione sul PC di Matteo: `docs/istruzioni-matteo.md`.
- **Modifiche al sito** (grafica, testi, struttura dei dati): PR normale dal proprio fork o branch;
  il merge lo fa MattiaBezzi con **"Create a merge commit"** (mai squash né rebase).

Da non fare:

- niente push diretti su `main`;
- niente `vercel deploy` o `vercel --prod`: la produzione parte solo da Git;
- niente credenziali condivise (`evolvia-legacy` su GitHub, `evolvia2027` su Vercel).
