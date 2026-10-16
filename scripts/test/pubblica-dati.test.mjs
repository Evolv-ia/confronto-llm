// Verifica e merge della PR dei dati con un'API GitHub simulata: nessuna chiamata di rete.
import test from 'node:test';
import assert from 'node:assert/strict';
import { esegui, shaBlob, CONFIG } from '../pubblica-dati.mjs';
import { MAIN, ORA, proposta, giornoDopo } from './fixture.mjs';

const T_LETTURA = 'ghs_tokenDelWorkflowDiProva';
const T_MERGE = 'github_pat_tokenDiMergeDiProva';
const SHA_MAIN = 'a'.repeat(40);
const SHA_PR = 'b'.repeat(40);
const SHA_MERGE = 'c'.repeat(40);
const FORK_ID = 999001;

const evento = (cambia = (e) => e) => cambia({
  pull_request: {
    number: 7,
    user: { login: 'ai-maps-hub', id: CONFIG.forkOwnerId },
    head: { sha: SHA_PR, ref: 'dati', repo: { id: FORK_ID, full_name: 'ai-maps-hub/confronto-llm', fork: true, owner: { login: 'ai-maps-hub', id: CONFIG.forkOwnerId } } },
    base: { ref: 'main', repo: { id: CONFIG.upstreamId } },
  },
});

const ENV = { GITHUB_TOKEN: T_LETTURA, MERGE_TOKEN: T_MERGE, PUBBLICAZIONE_AUTOMATICA: 'attiva' };

/**
 * API simulata. `scenario` cambia singole risposte; registra ogni chiamata (percorso, metodo, quale token).
 */
function api(scenario = {}) {
  const testoPr = scenario.testoPr ?? proposta(giornoDopo);
  const chiamate = [];
  let letturePr = 0;
  const http = async (percorso, { token, metodo = 'GET', corpo } = {}) => {
    const chi = token === T_MERGE ? 'merge' : token === T_LETTURA ? 'lettura' : 'nessuno';
    chiamate.push({ percorso, metodo, chi, corpo });
    const r = (status, json, extra = {}) => ({ status, json, intestazioni: extra.intestazioni ?? {}, testo: extra.testo ?? null });
    if (scenario.risposte?.[`${metodo} ${percorso}`]) return scenario.risposte[`${metodo} ${percorso}`]({ chi, corpo, letturePr });

    if (percorso === `/repositories/${FORK_ID}`) return r(200, scenario.fork ?? { full_name: 'ai-maps-hub/confronto-llm', fork: true, owner: { id: CONFIG.forkOwnerId }, parent: { id: CONFIG.upstreamId } });
    if (percorso === `/repos/${CONFIG.upstream}/pulls/7` && metodo === 'GET') {
      letturePr += 1;
      const sha = scenario.shaPrAlRicontrollo && letturePr > 1 ? scenario.shaPrAlRicontrollo : SHA_PR;
      return r(200, { state: 'open', merged: false, head: { sha, repo: { id: FORK_ID } } });
    }
    if (percorso === `/repos/${CONFIG.upstream}/git/ref/heads/main`) {
      const n = chiamate.filter((c) => c.percorso === percorso).length;
      return r(200, { object: { sha: scenario.mainSpostato && n > 1 ? 'd'.repeat(40) : SHA_MAIN } });
    }
    if (percorso === `/repos/${CONFIG.upstream}/compare/${SHA_MAIN}...${SHA_PR}`) {
      return r(200, { behind_by: scenario.indietro ?? 0, ahead_by: 1, files: scenario.files ?? [{ filename: 'index.html', status: 'modified', sha: shaBlob(scenario.testoDichiarato ?? testoPr) }] });
    }
    if (percorso === `/repos/${CONFIG.upstream}/contents/index.html?ref=${SHA_MAIN}`) return r(200, null, { testo: MAIN });
    if (percorso === `/repos/ai-maps-hub/confronto-llm/contents/index.html?ref=${SHA_PR}`) return r(200, null, { testo: testoPr });
    if (percorso === '/user') return r(200, scenario.utente ?? { login: 'MattiaBezzi', id: CONFIG.mergeId }, { intestazioni: scenario.intestazioniUtente ?? {} });
    if (percorso === `/repos/${CONFIG.upstream}` && metodo === 'GET') return r(200, { permissions: { push: scenario.push ?? true } });
    if (CONFIG.repoPrivatiDiControllo.some((x) => percorso === `/repos/${x}`)) return r(scenario.vedePrivati ? 200 : 404, null);
    if (percorso === `/repos/${CONFIG.upstream}/pulls/7/merge`) return r(200, { merged: true, sha: SHA_MERGE });
    if (percorso === `/repos/${CONFIG.upstream}/commits/${SHA_MERGE}`) {
      return r(200, scenario.commitMerge ?? { parents: [{ sha: SHA_MAIN }, { sha: SHA_PR }], author: { login: 'MattiaBezzi' } });
    }
    if (percorso === `/repos/${CONFIG.upstream}/issues/7/comments`) return r(201, {});
    return r(404, { message: `non simulato: ${metodo} ${percorso}` });
  };
  return { http, chiamate };
}

async function giro({ scenario, env = ENV, ev = evento() } = {}) {
  const a = api(scenario);
  const righe = [];
  const r = await esegui({ evento: ev, env, http: a.http, ora: ORA, log: (s) => righe.push(String(s)) });
  const merge = a.chiamate.filter((c) => c.percorso.endsWith('/merge'));
  const commenti = a.chiamate.filter((c) => c.percorso.endsWith('/comments')).map((c) => c.corpo.body);
  return { r, merge, commenti, chiamate: a.chiamate, log: righe.join('\n') };
}

test('percorso completo: dati validi -> merge commit con il token di MattiaBezzi vincolato allo SHA verificato', async () => {
  const g = await giro();
  assert.equal(g.r.esito, 'pubblicato', g.log);
  assert.equal(g.merge.length, 1);
  assert.equal(g.merge[0].chi, 'merge', 'il merge usa solo MERGE_TOKEN');
  assert.equal(g.merge[0].metodo, 'PUT');
  assert.equal(g.merge[0].corpo.merge_method, 'merge', 'mai squash ne\' rebase');
  assert.equal(g.merge[0].corpo.sha, SHA_PR, 'merge vincolato allo SHA verificato');
  assert.equal(g.r.dettagli.shaMerge, SHA_MERGE);
  // le letture usano il token del workflow, mai quello di merge
  for (const c of g.chiamate.filter((x) => x.percorso.includes('/contents/') || x.percorso.includes('/compare/'))) assert.equal(c.chi, 'lettura');
});

test('i token non compaiono mai nei log ne\' nei commenti', async () => {
  for (const scenario of [{}, { utente: { login: 'altro', id: 1 } }, { testoPr: MAIN.replace('<title>', '<title>X ') }]) {
    const g = await giro({ scenario });
    const tutto = `${g.log}\n${g.commenti.join('\n')}`;
    assert.ok(!tutto.includes(T_MERGE) && !tutto.includes(T_LETTURA));
  }
});

test('pubblicazione automatica non attiva: verifica i dati, nessun merge', async () => {
  for (const valore of [undefined, '', 'si', 'ATTIVA']) {
    const g = await giro({ env: { ...ENV, PUBBLICAZIONE_AUTOMATICA: valore } });
    assert.equal(g.merge.length, 0, String(valore));
    assert.equal(g.r.codice, 0);
    assert.match(g.commenti.join(''), /Dati validi.*nessun merge/s);
  }
});

test('secret MERGE_TOKEN assente: si ferma senza merge', async () => {
  const g = await giro({ env: { ...ENV, MERGE_TOKEN: '' } });
  assert.equal(g.merge.length, 0);
  assert.equal(g.r.codice, 1);
  assert.match(g.r.dettagli.motivo, /MERGE_TOKEN non configurato/);
});

test('token di merge non conforme: nessun merge', async () => {
  const casi = [
    [{ env: { ...ENV, MERGE_TOKEN: 'ghp_classico' } }, /grana fine/],
    [{ scenario: { utente: { login: 'evolvia-legacy', id: 313397617 } } }, /non appartiene a MattiaBezzi/],
    [{ scenario: { intestazioniUtente: { 'x-oauth-scopes': 'repo' } } }, /scope classici/],
    [{ scenario: { push: false } }, /non puo' scrivere/],
    [{ scenario: { vedePrivati: true } }, /altri repository privati/],
  ];
  for (const [opz, atteso] of casi) {
    const g = await giro(opz);
    assert.equal(g.merge.length, 0, String(atteso));
    assert.match(g.r.dettagli.motivo, atteso);
  }
});

test('provenienza: solo il fork di ai-maps-hub, branch dati, verso main', async () => {
  const casi = [
    (e) => { e.pull_request.head.repo.full_name = 'altro/confronto-llm'; return e; },
    (e) => { e.pull_request.head.repo.owner.id = 1; return e; },
    (e) => { e.pull_request.head.repo.fork = false; return e; },
    (e) => { e.pull_request.head.ref = 'main'; return e; },
    (e) => { e.pull_request.user = { login: 'ai-maps-hub', id: 5 }; return e; },
    (e) => { e.pull_request.base.ref = 'altro'; return e; },
  ];
  for (const cambia of casi) {
    const g = await giro({ ev: evento(cambia) });
    assert.equal(g.merge.length, 0);
    assert.equal(g.r.esito, 'fermato');
  }
  // id del fork registrato (variabile FORK_REPO_ID) diverso da quello dell'evento
  const g = await giro({ env: { ...ENV, FORK_REPO_ID: '123' } });
  assert.equal(g.merge.length, 0);
});

test('identita\' del fork verificata via API, non solo dall\'evento', async () => {
  for (const fork of [
    { full_name: 'ai-maps-hub/confronto-llm', fork: true, owner: { id: CONFIG.forkOwnerId }, parent: { id: 42 } },
    { full_name: 'ai-maps-hub/confronto-llm', fork: false, owner: { id: CONFIG.forkOwnerId }, parent: { id: CONFIG.upstreamId } },
    { full_name: 'ai-maps-hub/confronto-llm', fork: true, owner: { id: 9 }, parent: { id: CONFIG.upstreamId } },
  ]) {
    const g = await giro({ scenario: { fork } });
    assert.equal(g.merge.length, 0);
    assert.match(g.r.dettagli.motivo, /fork di ai-maps-hub/);
  }
});

test('la PR deve partire dal main attuale e cambiare solo index.html', async () => {
  let g = await giro({ scenario: { indietro: 2 } });
  assert.equal(g.merge.length, 0);
  assert.match(g.r.dettagli.motivo, /non parte dal main attuale/);
  g = await giro({ scenario: { files: [{ filename: 'index.html', status: 'modified', sha: 'x' }, { filename: 'vercel.json', status: 'modified', sha: 'y' }] } });
  assert.equal(g.merge.length, 0);
  assert.match(g.r.dettagli.motivo, /solo index.html/);
  g = await giro({ scenario: { files: [{ filename: '.github/workflows/pubblica-dati.yml', status: 'modified', sha: 'x' }] } });
  assert.equal(g.merge.length, 0);
});

test('contenuto letto diverso da quello dichiarato dalla PR: nessun merge', async () => {
  const g = await giro({ scenario: { testoDichiarato: proposta((d) => { giornoDopo(d); d[0].nota = 'altro'; }) } });
  assert.equal(g.merge.length, 0);
  assert.match(g.r.dettagli.motivo, /non corrisponde/);
});

test('dati non validi: commento con il motivo e nessun merge', async () => {
  const g = await giro({ scenario: { testoPr: proposta((d) => { d[1].modelli = d[1].modelli.slice(0, 10); }) } });
  assert.equal(g.merge.length, 0);
  assert.equal(g.r.esito, 'rifiutato');
  assert.match(g.commenti.join(''), /dati non validi/);
});

test('ricontrollo prima del merge: PR o main cambiati -> nessun merge', async () => {
  let g = await giro({ scenario: { shaPrAlRicontrollo: 'e'.repeat(40) } });
  assert.equal(g.merge.length, 0);
  assert.match(g.r.dettagli.motivo, /cambiata durante la verifica/);
  g = await giro({ scenario: { mainSpostato: true } });
  assert.equal(g.merge.length, 0);
  assert.match(g.r.dettagli.motivo, /main si e' spostato/);
});

test('dopo il merge: se non e\' un merge commit di MattiaBezzi lo segnala come errore', async () => {
  let g = await giro({ scenario: { commitMerge: { parents: [{ sha: SHA_MAIN }], author: { login: 'MattiaBezzi' } } } });
  assert.equal(g.r.codice, 1);
  assert.match(g.r.dettagli.motivo, /non e' un merge commit/);
  g = await giro({ scenario: { commitMerge: { parents: [{ sha: SHA_MAIN }, { sha: SHA_PR }], author: { login: 'github-actions[bot]' } } } });
  assert.equal(g.r.codice, 1);
});

test('PR gia\' chiusa o mergiata: nessuna seconda pubblicazione', async () => {
  const g = await giro({ scenario: { risposte: { [`GET /repos/${CONFIG.upstream}/pulls/7`]: () => ({ status: 200, json: { state: 'closed', merged: true, head: { sha: SHA_PR, repo: { id: FORK_ID } } }, intestazioni: {} }) } } });
  assert.equal(g.merge.length, 0);
  assert.equal(g.r.codice, 0);
});
