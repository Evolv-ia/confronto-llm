// Validatore dell'aggiornamento quotidiano dei dati (blocco PIATTAFORME di index.html).
// Puro: riceve i due testi (main attuale e versione proposta) e restituisce gli errori.
// Nessuna dipendenza, nessun accesso a rete o file: lo usa .github/workflows/pubblica-dati.yml
// tramite scripts/pubblica-dati.mjs, sempre dal branch main (mai codice del fork).

export const PREFISSO = 'const PIATTAFORME = ';

// Soglie di plausibilita' rispetto ai dati gia' pubblicati.
export const LIMITI = {
  caloMassimoModelli: 0.8, // ogni scheda conserva almeno l'80% dei modelli del giorno prima
  crescitaMassimaModelli: 1.5, // e non piu' del 150%
  caloMassimoTotale: 0.85,
  minimoModelliPerScheda: 5,
  lunghezzaMassimaRiga: 2_000_000,
  prezzoMassimo: 10_000, // euro per 1M token (o per unita' dichiarata)
  punteggioMassimo: 100,
  testoMassimo: 4000,
  campoBreveMassimo: 300,
  futuroMassimoMs: 36 * 3600 * 1000, // una data "aggiornato" non puo' stare nel futuro (tolleranza fusi orari)
};

const CHIAVI_MODELLO = ['id', 'name', 'provider', 'category', 'gratis', 'score', 'fonte', 'misurato', 'input', 'output', 'context', 'unita'];
const CHIAVI_PUNTEGGIO = ['nome', 'scala'];
const TAG_CONSENTITI = new Set(['<strong>', '</strong>']);

const tipo = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

/** Estrae e analizza il blocco PIATTAFORME. Restituisce { riga, indice, dati } o lancia un errore leggibile. */
export function estraiPiattaforme(testo, etichetta) {
  const righe = testo.split('\n');
  const indici = righe.map((r, i) => (r.startsWith(PREFISSO) ? i : -1)).filter((i) => i >= 0);
  if (indici.length !== 1) throw new Error(`${etichetta}: attesa esattamente una riga "${PREFISSO.trim()}", trovate ${indici.length}`);
  const riga = righe[indici[0]];
  if (riga.length > LIMITI.lunghezzaMassimaRiga) throw new Error(`${etichetta}: riga PIATTAFORME troppo lunga (${riga.length} caratteri)`);
  if (!riga.endsWith('];')) throw new Error(`${etichetta}: la riga PIATTAFORME deve chiudersi con "];"`);
  let dati;
  try {
    dati = JSON.parse(riga.slice(PREFISSO.length, -1));
  } catch (e) {
    throw new Error(`${etichetta}: JSON di PIATTAFORME non valido (${e.message.slice(0, 120)})`);
  }
  return { righe, indice: indici[0], riga, dati };
}

/** Tutte le stringhe di un valore JSON, con il percorso. */
function stringhe(v, percorso, out = []) {
  if (typeof v === 'string') out.push([percorso, v]);
  else if (Array.isArray(v)) v.forEach((x, i) => stringhe(x, `${percorso}[${i}]`, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) stringhe(x, `${percorso}.${k}`, out);
  return out;
}

/** Testo sicuro da incorporare nella pagina: solo i tag gia' usati dal sito, niente script o URL javascript. */
export function controllaTesto(percorso, s, errori) {
  for (const m of s.matchAll(/<[^>]*>?/g)) {
    if (!TAG_CONSENTITI.has(m[0])) errori.push(`${percorso}: tag non consentito ${JSON.stringify(m[0].slice(0, 40))}`);
  }
  if (/javascript:|data:text\/html|<!--|-->/i.test(s)) errori.push(`${percorso}: contenuto non consentito`);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(s)) errori.push(`${percorso}: caratteri di controllo`);
}

function dataValida(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z)?$/.test(s)) return null;
  const t = Date.parse(s.length === 10 ? `${s}T00:00:00Z` : s);
  return Number.isNaN(t) ? null : t;
}

function controllaModello(m, percorso, errori) {
  if (tipo(m) !== 'object') return errori.push(`${percorso}: atteso un oggetto`);
  const chiavi = Object.keys(m);
  const mancanti = CHIAVI_MODELLO.filter((k) => !chiavi.includes(k));
  const extra = chiavi.filter((k) => !CHIAVI_MODELLO.includes(k));
  if (mancanti.length || extra.length) errori.push(`${percorso}: campi diversi dal previsto (mancanti: ${mancanti.join(',') || '-'}; in piu': ${extra.join(',') || '-'})`);
  for (const k of ['id', 'name', 'provider', 'category', 'context', 'unita']) {
    if (typeof m[k] !== 'string' || !m[k].length || m[k].length > LIMITI.campoBreveMassimo) errori.push(`${percorso}.${k}: stringa non valida`);
  }
  for (const k of ['gratis', 'misurato']) if (typeof m[k] !== 'boolean') errori.push(`${percorso}.${k}: atteso booleano`);
  if (!(m.fonte === null || (typeof m.fonte === 'string' && m.fonte.length <= 20))) errori.push(`${percorso}.fonte: atteso testo breve o null`);
  if (!(m.score === null || (Number.isFinite(m.score) && m.score >= 0 && m.score <= LIMITI.punteggioMassimo))) errori.push(`${percorso}.score: fuori scala`);
  for (const k of ['input', 'output']) {
    // null = prezzo non pubblicato (router senza listino, modelli con una sola tariffa): c'e' gia' oggi.
    if (!(m[k] === null || (Number.isFinite(m[k]) && m[k] >= 0 && m[k] <= LIMITI.prezzoMassimo))) errori.push(`${percorso}.${k}: prezzo non plausibile`);
  }
}

/**
 * Confronta la versione pubblicata (main) con quella proposta.
 * @returns {{ ok: boolean, errori: string[], riepilogo: object }}
 */
export function validaAggiornamento(testoMain, testoProposto, { ora = Date.now() } = {}) {
  const errori = [];
  let base, nuovo;
  try {
    base = estraiPiattaforme(testoMain, 'main');
    nuovo = estraiPiattaforme(testoProposto, 'proposta');
  } catch (e) {
    return { ok: false, errori: [e.message], riepilogo: null };
  }

  // 1. Cambia SOLO la riga PIATTAFORME: stesso numero di righe, stessa posizione, tutto il resto identico.
  if (base.righe.length !== nuovo.righe.length) errori.push(`numero di righe di index.html cambiato (${base.righe.length} -> ${nuovo.righe.length}): e' cambiato altro oltre ai dati`);
  else if (base.indice !== nuovo.indice) errori.push('la riga PIATTAFORME si e\' spostata: e\' cambiato altro oltre ai dati');
  else {
    const diverse = base.righe.map((r, i) => (i !== base.indice && r !== nuovo.righe[i] ? i + 1 : 0)).filter(Boolean);
    if (diverse.length) errori.push(`index.html cambia anche fuori dal blocco PIATTAFORME (righe ${diverse.slice(0, 10).join(', ')}${diverse.length > 10 ? ', ...' : ''})`);
  }

  // 2. Struttura: stesse schede, stesso ordine, stessi campi.
  if (tipo(nuovo.dati) !== 'array') return { ok: false, errori: [...errori, 'PIATTAFORME deve essere un array'], riepilogo: null };
  const idBase = base.dati.map((p) => p.id);
  const idNuovi = nuovo.dati.map((p) => p?.id);
  if (JSON.stringify(idBase) !== JSON.stringify(idNuovi)) errori.push(`schede diverse da quelle pubblicate (attese ${idBase.join(',')}, trovate ${idNuovi.join(',')})`);

  const riepilogo = { schede: [], totaleBase: 0, totaleNuovo: 0 };
  nuovo.dati.forEach((p, i) => {
    const b = base.dati[i];
    const pre = `PIATTAFORME[${i}]${p?.id ? ` (${p.id})` : ''}`;
    if (tipo(p) !== 'object' || !b) return errori.push(`${pre}: scheda non valida`);
    const chiaviB = Object.keys(b).sort().join(',');
    const chiaviN = Object.keys(p).sort().join(',');
    if (chiaviB !== chiaviN) errori.push(`${pre}: campi della scheda cambiati (${chiaviB} -> ${chiaviN})`);
    if (p.nome !== b.nome) errori.push(`${pre}: nome della scheda cambiato`);
    if (tipo(p.punteggio) !== 'object' || Object.keys(p.punteggio).sort().join(',') !== CHIAVI_PUNTEGGIO.join(',')) errori.push(`${pre}.punteggio: struttura non valida`);
    for (const k of ['nota', 'notaTabella', 'notaPrezzi', 'scala']) {
      if (k in p && (typeof p[k] !== 'string' || p[k].length > LIMITI.testoMassimo)) errori.push(`${pre}.${k}: testo non valido`);
    }

    // Data: valida, non precedente a quella pubblicata, non nel futuro.
    const tN = dataValida(p.aggiornato);
    const tB = dataValida(b.aggiornato);
    if (tN === null) errori.push(`${pre}.aggiornato: data non valida (${JSON.stringify(p.aggiornato)})`);
    else {
      if (tB !== null && tN < tB) errori.push(`${pre}.aggiornato: precedente a quella pubblicata (${p.aggiornato} < ${b.aggiornato})`);
      if (tN > ora + LIMITI.futuroMassimoMs) errori.push(`${pre}.aggiornato: data nel futuro (${p.aggiornato})`);
    }

    // Modelli: struttura di ogni voce e numero plausibile rispetto al giorno prima.
    if (tipo(p.modelli) !== 'array') return errori.push(`${pre}.modelli: atteso un array`);
    p.modelli.forEach((m, j) => controllaModello(m, `${pre}.modelli[${j}]`, errori));
    const nB = Array.isArray(b.modelli) ? b.modelli.length : 0;
    const nN = p.modelli.length;
    riepilogo.schede.push({ id: p.id, modelliPrima: nB, modelli: nN, aggiornato: p.aggiornato });
    riepilogo.totaleBase += nB;
    riepilogo.totaleNuovo += nN;
    if (nN < LIMITI.minimoModelliPerScheda) errori.push(`${pre}: solo ${nN} modelli`);
    if (nB && nN < Math.floor(nB * LIMITI.caloMassimoModelli)) errori.push(`${pre}: modelli scesi da ${nB} a ${nN} (oltre il 20% in meno)`);
    if (nB && nN > Math.ceil(nB * LIMITI.crescitaMassimaModelli)) errori.push(`${pre}: modelli saliti da ${nB} a ${nN} (oltre il 50% in piu')`);
    const doppi = p.modelli.length - new Set(p.modelli.map((m) => m?.id)).size;
    const doppiBase = Array.isArray(b.modelli) ? b.modelli.length - new Set(b.modelli.map((m) => m?.id)).size : 0;
    if (doppi > doppiBase) errori.push(`${pre}: ${doppi} id di modello duplicati`);
  });
  if (riepilogo.totaleBase && riepilogo.totaleNuovo < Math.floor(riepilogo.totaleBase * LIMITI.caloMassimoTotale)) errori.push(`totale modelli sceso da ${riepilogo.totaleBase} a ${riepilogo.totaleNuovo}`);

  // 3. Testi incorporati nella pagina: nessun markup nuovo, nessuno script.
  for (const [percorso, s] of stringhe(nuovo.dati, 'PIATTAFORME')) controllaTesto(percorso, s, errori);

  return { ok: errori.length === 0, errori, riepilogo };
}
