// Validatore del blocco PIATTAFORME: un aggiornamento normale passa, tutto il resto viene bloccato.
// Esecuzione: node --test scripts/test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { validaAggiornamento, PREFISSO } from '../valida-dati.mjs';
import { MAIN, ORA, proposta, giornoDopo } from './fixture.mjs';

const ko = (testo, atteso) => {
  const r = validaAggiornamento(MAIN, testo, { ora: ORA });
  assert.equal(r.ok, false, 'doveva essere bloccato');
  assert.ok(r.errori.some((e) => atteso.test(e)), `errore atteso ${atteso}, trovati:\n${r.errori.slice(0, 5).join('\n')}`);
};

test('aggiornamento quotidiano normale: passa, con il riepilogo per scheda', () => {
  const r = validaAggiornamento(MAIN, proposta(giornoDopo), { ora: ORA });
  assert.deepEqual(r.errori, []);
  assert.equal(r.ok, true);
  assert.deepEqual(r.riepilogo.schede.map((s) => s.id), ['confronto-2026', 'openrouter', 'regolo', 'edenai']);
  assert.equal(r.riepilogo.totaleNuovo, r.riepilogo.totaleBase + 1);
});

test('stesso contenuto (nessun cambiamento ai dati) e date invariate: ammesso', () => {
  assert.equal(validaAggiornamento(MAIN, MAIN, { ora: ORA }).ok, true);
});

test('blocca modifiche fuori dal blocco PIATTAFORME', () => {
  ko(proposta(giornoDopo).replace('<title>', '<title>X '), /fuori dal blocco PIATTAFORME/);
  ko(`${proposta(giornoDopo)}\n<script>alert(1)</script>`, /numero di righe/);
  const righe = proposta(giornoDopo).split('\n');
  const i = righe.findIndex((r) => r.startsWith(PREFISSO));
  [righe[i - 1], righe[i]] = [righe[i], righe[i - 1]];
  ko(righe.join('\n'), /spostata|fuori dal blocco|esattamente una riga/);
});

test('blocca JSON non valido, riga duplicata o mancante', () => {
  ko(MAIN.replace(/^const PIATTAFORME = \[/m, 'const PIATTAFORME = [['), /JSON di PIATTAFORME non valido/);
  ko(MAIN.replace(/^const PIATTAFORME = .*$/m, (r) => `${r}\n${r}`), /esattamente una riga/);
  ko(MAIN.replace(/^const PIATTAFORME = /m, 'const ALTRO = '), /esattamente una riga/);
  ko(MAIN.replace(/^(const PIATTAFORME = .*)\];$/m, '$1]'), /chiudersi con/);
});

test('blocca schede cambiate, campi nuovi o mancanti', () => {
  ko(proposta((d) => { d.pop(); }), /schede diverse/);
  ko(proposta((d) => { d[0].id = 'altro'; }), /schede diverse/);
  ko(proposta((d) => { d[1].extra = 'x'; }), /campi della scheda cambiati/);
  ko(proposta((d) => { d[2].nome = 'Altro nome'; }), /nome della scheda cambiato/);
  ko(proposta((d) => { d[1].modelli[0].nuovo = 1; }), /campi diversi dal previsto/);
  ko(proposta((d) => { delete d[1].modelli[0].score; }), /campi diversi dal previsto/);
});

test('blocca tipi e valori non plausibili', () => {
  ko(proposta((d) => { d[1].modelli[0].input = -1; }), /prezzo non plausibile/);
  ko(proposta((d) => { d[1].modelli[0].output = '3'; }), /prezzo non plausibile/);
  ko(proposta((d) => { d[1].modelli[0].score = 250; }), /fuori scala/);
  ko(proposta((d) => { d[1].modelli[0].gratis = 'no'; }), /booleano/);
  ko(proposta((d) => { d[1].modelli[0].name = ''; }), /stringa non valida/);
});

test('date: valide, non precedenti a quelle pubblicate, non nel futuro', () => {
  ko(proposta((d) => { d[0].aggiornato = '2026-13-45'; }), /data non valida/);
  ko(proposta((d) => { d[1].aggiornato = 'ieri'; }), /data non valida/);
  ko(proposta((d) => { d[0].aggiornato = '2020-01-01'; }), /precedente a quella pubblicata/);
  const r = validaAggiornamento(MAIN, proposta((d) => { d[0].aggiornato = '2027-06-01'; }), { ora: ORA });
  assert.ok(r.errori.some((e) => /nel futuro/.test(e)));
});

test('numero di modelli: blocca cali oltre il 20% e crescite oltre il 50%', () => {
  ko(proposta((d) => { d[1].modelli = d[1].modelli.slice(0, Math.floor(d[1].modelli.length * 0.7)); }), /oltre il 20% in meno/);
  ko(proposta((d) => { d[2].modelli = [...d[2].modelli, ...d[2].modelli.map((m, i) => ({ ...m, id: `${m.id}-${i}` }))]; }), /oltre il 50% in piu'/);
  ko(proposta((d) => { d[1].modelli.push({ ...d[1].modelli[0] }); }), /duplicati/);
});

test('testi: nessun markup nuovo, nessuno script, nessun URL javascript', () => {
  ko(proposta((d) => { d[0].nota = 'ciao <script>alert(1)</script>'; }), /tag non consentito/);
  ko(proposta((d) => { d[1].modelli[0].name = '</script><img src=x onerror=alert(1)>'; }), /tag non consentito/);
  ko(proposta((d) => { d[1].nota = '<a href="javascript:alert(1)">x</a>'; }), /tag non consentito|contenuto non consentito/);
  ko(proposta((d) => { d[1].modelli[0].provider = 'javascript:alert(1)'; }), /contenuto non consentito/);
  ko(proposta((d) => { d[1].scala = '<!-- x'; }), /tag non consentito|contenuto non consentito/);
  // il tag gia' usato dal sito resta ammesso
  assert.equal(validaAggiornamento(MAIN, proposta((d) => { giornoDopo(d); d[1].nota = 'Classifica per <strong>IP</strong>'; }), { ora: ORA }).ok, true);
});
