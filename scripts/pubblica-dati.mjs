// Verifica e merge automatico della PR quotidiana dei dati (ai-maps-hub/confronto-llm, branch "dati").
// Gira in .github/workflows/pubblica-dati.yml (pull_request_target) dal checkout di main: legge la PR
// SOLO tramite API come dati, non esegue mai codice del fork. Il merge usa il token di MattiaBezzi
// (secret MERGE_TOKEN) solo se tutti i controlli passano e la variabile PUBBLICAZIONE_AUTOMATICA vale "attiva".
// I token non vengono mai stampati: il client HTTP non registra intestazioni ne' corpi delle richieste.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { validaAggiornamento } from './valida-dati.mjs';

export const CONFIG = {
  upstream: 'Evolv-ia/confronto-llm',
  upstreamId: 1396612093,
  forkOwner: 'ai-maps-hub',
  forkOwnerId: 224416330,
  ramo: 'dati',
  base: 'main',
  file: 'index.html',
  mergeLogin: 'MattiaBezzi',
  mergeId: 260653821,
  // Repo privati dell'organizzazione che il token di merge NON deve poter leggere: prova che e' limitato.
  repoPrivatiDiControllo: ['Evolv-ia/Evolv-ia', 'Evolv-ia/rankmaster'],
};

const API = 'https://api.github.com';

/** Client minimo per l'API GitHub. Non registra mai token, intestazioni o corpi. */
export async function richiestaGitHub(percorso, { token, metodo = 'GET', corpo, grezzo = false } = {}) {
  const r = await fetch(`${API}${percorso}`, {
    method: metodo,
    headers: {
      accept: grezzo ? 'application/vnd.github.raw' : 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'confronto-llm-pubblica-dati',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(corpo ? { 'content-type': 'application/json' } : {}),
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const testo = await r.text();
  let json = null;
  if (!grezzo) { try { json = testo ? JSON.parse(testo) : null; } catch { json = null; } }
  return { status: r.status, intestazioni: Object.fromEntries(r.headers.entries()), json, testo: grezzo ? testo : null };
}

/** Hash Git di un blob: permette di confrontare il contenuto scaricato con lo SHA che GitHub dichiara. */
export const shaBlob = (testo) => {
  const buf = Buffer.from(testo, 'utf8');
  return createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${buf.length}\0`), buf])).digest('hex');
};

class Stop extends Error {
  constructor(motivo, { codice = 1, commento = true } = {}) { super(motivo); this.codice = codice; this.commento = commento; }
}

/** Controlli sul solo evento: chi ha aperto la PR, da quale repository, verso quale ramo. */
export function controllaEvento(pr, { forkRepoId } = {}) {
  const e = [];
  const h = pr?.head ?? {};
  if (h.repo?.full_name !== `${CONFIG.forkOwner}/confronto-llm`) e.push(`repository sorgente ${h.repo?.full_name ?? '-'} non autorizzato`);
  if (h.repo?.owner?.login !== CONFIG.forkOwner || h.repo?.owner?.id !== CONFIG.forkOwnerId) e.push('proprietario del repository sorgente non corrisponde');
  if (h.repo?.fork !== true) e.push('il repository sorgente non e\' un fork');
  if (forkRepoId && h.repo?.id !== Number(forkRepoId)) e.push(`id del fork ${h.repo?.id} diverso da quello registrato`);
  if (h.ref !== CONFIG.ramo) e.push(`ramo sorgente "${h.ref}" diverso da "${CONFIG.ramo}"`);
  if (pr?.user?.login !== CONFIG.forkOwner || pr?.user?.id !== CONFIG.forkOwnerId) e.push(`PR aperta da ${pr?.user?.login ?? '-'}, non da ${CONFIG.forkOwner}`);
  if (pr?.base?.ref !== CONFIG.base || pr?.base?.repo?.id !== CONFIG.upstreamId) e.push('ramo o repository di destinazione non corrispondono');
  return e;
}

/**
 * Esegue verifica ed eventuale merge. Tutte le dipendenze esterne sono iniettabili per i test.
 * @returns {Promise<{ esito: string, codice: number, dettagli?: object }>}
 */
export async function esegui({ evento, env, http = richiestaGitHub, ora = Date.now(), log = console.log }) {
  const pr = evento?.pull_request;
  const lettura = env.GITHUB_TOKEN; // token del workflow: solo lettura dei contenuti + commenti sulla PR
  const commenta = async (testo) => {
    if (!pr?.number || !lettura) return;
    await http(`/repos/${CONFIG.upstream}/issues/${pr.number}/comments`, { token: lettura, metodo: 'POST', corpo: { body: testo } });
  };

  try {
    // 1. Evento: provenienza e destinazione.
    const errEvento = controllaEvento(pr, { forkRepoId: env.FORK_REPO_ID });
    if (errEvento.length) throw new Stop(`PR non ammessa alla pubblicazione automatica: ${errEvento.join('; ')}`, { codice: 0 });
    const shaEvento = pr.head.sha;

    // 2. Identita' del repository sorgente, letta dall'API e non dal solo evento.
    const fork = await http(`/repositories/${pr.head.repo.id}`, { token: lettura });
    const f = fork.json;
    if (fork.status !== 200 || f?.full_name !== `${CONFIG.forkOwner}/confronto-llm` || f?.fork !== true || f?.owner?.id !== CONFIG.forkOwnerId || f?.parent?.id !== CONFIG.upstreamId) {
      throw new Stop('il repository sorgente non risulta il fork di ai-maps-hub di Evolv-ia/confronto-llm');
    }

    // 3. Stato attuale della PR e di main.
    const statoPr = await http(`/repos/${CONFIG.upstream}/pulls/${pr.number}`, { token: lettura });
    const p = statoPr.json;
    if (statoPr.status !== 200 || p.state !== 'open' || p.merged) throw new Stop('la PR non e\' piu\' aperta', { codice: 0, commento: false });
    if (p.head.sha !== shaEvento || p.head.repo?.id !== pr.head.repo.id) throw new Stop('la PR e\' cambiata dopo l\'evento: verra\' verificata dal giro successivo', { codice: 0, commento: false });
    const ref = await http(`/repos/${CONFIG.upstream}/git/ref/heads/${CONFIG.base}`, { token: lettura });
    const shaMain = ref.json?.object?.sha;
    if (!shaMain) throw new Stop('impossibile leggere lo SHA di main');

    // 4. La PR parte dal main attuale e cambia solo index.html.
    const cmp = await http(`/repos/${CONFIG.upstream}/compare/${shaMain}...${shaEvento}`, { token: lettura });
    const c = cmp.json;
    if (cmp.status !== 200) throw new Stop('confronto con main non disponibile');
    if (c.behind_by !== 0) throw new Stop(`la PR non parte dal main attuale (indietro di ${c.behind_by} commit): va rigenerata partendo da upstream/main`);
    const file = c.files ?? [];
    if (file.length !== 1 || file[0].filename !== CONFIG.file || file[0].status !== 'modified') {
      throw new Stop(`la PR deve modificare solo ${CONFIG.file} (trovati: ${file.map((x) => `${x.filename} [${x.status}]`).join(', ') || 'nessuno'})`);
    }

    // 5. Contenuti: main attuale e versione proposta, verificata contro lo SHA del blob dichiarato.
    const testoMain = (await http(`/repos/${CONFIG.upstream}/contents/${CONFIG.file}?ref=${shaMain}`, { token: lettura, grezzo: true })).testo;
    const proposta = await http(`/repos/${CONFIG.forkOwner}/confronto-llm/contents/${CONFIG.file}?ref=${shaEvento}`, { token: lettura, grezzo: true });
    if (typeof testoMain !== 'string' || proposta.status !== 200 || typeof proposta.testo !== 'string') throw new Stop('impossibile leggere index.html');
    if (shaBlob(proposta.testo) !== file[0].sha) throw new Stop('il contenuto letto non corrisponde a quello della PR');

    // 6. Validazione dei dati.
    const v = validaAggiornamento(testoMain, proposta.testo, { ora });
    if (!v.ok) throw new Stop(`dati non validi:\n- ${v.errori.slice(0, 25).join('\n- ')}${v.errori.length > 25 ? `\n- ... altri ${v.errori.length - 25}` : ''}`);
    const sintesi = v.riepilogo.schede.map((s) => `${s.id} ${s.modelliPrima}->${s.modelli}`).join(', ');
    log(`dati validi: ${sintesi} (totale ${v.riepilogo.totaleBase}->${v.riepilogo.totaleNuovo})`);

    // 7. Pubblicazione automatica attivata solo esplicitamente.
    if (env.PUBBLICAZIONE_AUTOMATICA !== 'attiva') {
      throw new Stop(`Dati validi (${sintesi}). Pubblicazione automatica non attiva (variabile PUBBLICAZIONE_AUTOMATICA): nessun merge.`, { codice: 0 });
    }

    // 8. Token di merge: presente, a grana fine, di MattiaBezzi, limitato a questa repo.
    const merge = env.MERGE_TOKEN;
    if (!merge) throw new Stop('secret MERGE_TOKEN non configurato: nessun merge');
    if (!merge.startsWith('github_pat_')) throw new Stop('MERGE_TOKEN non e\' un token a grana fine: nessun merge');
    const chi = await http('/user', { token: merge });
    if (chi.status !== 200 || chi.json?.login !== CONFIG.mergeLogin || chi.json?.id !== CONFIG.mergeId) throw new Stop(`MERGE_TOKEN non appartiene a ${CONFIG.mergeLogin}: nessun merge`);
    if ((chi.intestazioni['x-oauth-scopes'] ?? '').trim()) throw new Stop('MERGE_TOKEN ha scope classici: serve un token a grana fine');
    const accesso = await http(`/repos/${CONFIG.upstream}`, { token: merge });
    if (accesso.status !== 200 || accesso.json?.permissions?.push !== true) throw new Stop('MERGE_TOKEN non puo\' scrivere su Evolv-ia/confronto-llm');
    for (const privato of CONFIG.repoPrivatiDiControllo) {
      const r = await http(`/repos/${privato}`, { token: merge });
      if (r.status !== 404) throw new Stop('MERGE_TOKEN vede altri repository privati dell\'organizzazione: va limitato a confronto-llm');
    }

    // 9. Ricontrollo subito prima del merge: stessa PR, stesso SHA verificato, main non spostato.
    const prima = await http(`/repos/${CONFIG.upstream}/pulls/${pr.number}`, { token: lettura });
    const refPrima = await http(`/repos/${CONFIG.upstream}/git/ref/heads/${CONFIG.base}`, { token: lettura });
    if (prima.json?.state !== 'open' || prima.json?.merged || prima.json?.head?.sha !== shaEvento || prima.json?.head?.repo?.id !== pr.head.repo.id) {
      throw new Stop('la PR e\' cambiata durante la verifica: nessun merge', { codice: 0, commento: false });
    }
    if (refPrima.json?.object?.sha !== shaMain) throw new Stop('main si e\' spostato durante la verifica: nessun merge', { codice: 0, commento: false });

    // 10. Merge commit, vincolato allo SHA verificato.
    const titolo = `Merge pull request #${pr.number} from ${CONFIG.forkOwner}/${CONFIG.ramo}`;
    const m = await http(`/repos/${CONFIG.upstream}/pulls/${pr.number}/merge`, {
      token: merge, metodo: 'PUT',
      corpo: { merge_method: 'merge', sha: shaEvento, commit_title: titolo, commit_message: `Pubblicazione automatica dei dati verificati (${sintesi}).` },
    });
    if (m.status !== 200 || m.json?.merged !== true) throw new Stop(`merge non riuscito (HTTP ${m.status}): ${m.json?.message ?? '-'}`);
    const shaMerge = m.json.sha;

    // 11. Il commit pubblicato deve essere un merge commit di MattiaBezzi (e' quello che Vercel attribuisce al seat).
    const commit = await http(`/repos/${CONFIG.upstream}/commits/${shaMerge}`, { token: lettura });
    const genitori = (commit.json?.parents ?? []).map((x) => x.sha);
    const okMerge = genitori.length === 2 && genitori.includes(shaMain) && genitori.includes(shaEvento) && commit.json?.author?.login === CONFIG.mergeLogin;
    if (!okMerge) throw new Stop(`ERRORE: il commit pubblicato ${shaMerge} non e' un merge commit di ${CONFIG.mergeLogin} (genitori ${genitori.length}, autore ${commit.json?.author?.login ?? '-'})`);
    log(`pubblicato: merge commit ${shaMerge} di ${CONFIG.mergeLogin}`);
    await commenta(`Pubblicato con il merge commit ${shaMerge} (${sintesi}). Vercel pubblica da Git.`);
    return { esito: 'pubblicato', codice: 0, dettagli: { shaMerge, shaVerificato: shaEvento, shaMain } };
  } catch (e) {
    if (!(e instanceof Stop)) {
      log(`errore inatteso: ${e.message}`);
      await commenta('Verifica interrotta da un errore inatteso: nessun merge. Dettagli nel log del workflow.').catch(() => {});
      return { esito: 'errore', codice: 1 };
    }
    log(e.message);
    if (e.commento) await commenta(e.message).catch(() => {});
    return { esito: e.codice === 0 ? 'fermato' : 'rifiutato', codice: e.codice, dettagli: { motivo: e.message } };
  }
}

// Avvio dal workflow: evento da GITHUB_EVENT_PATH, configurazione dalle variabili d'ambiente.
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('pubblica-dati.mjs')) {
  const evento = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const r = await esegui({ evento, env: process.env });
  console.log(`esito: ${r.esito}`);
  process.exitCode = r.codice;
}
