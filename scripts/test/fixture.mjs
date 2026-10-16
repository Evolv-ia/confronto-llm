// Dati di prova per i test: index.html reale del repo e un aggiornamento quotidiano tipico.
import fs from 'node:fs';
import { PREFISSO } from '../valida-dati.mjs';

export const MAIN = fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
export const ORA = Date.parse('2026-12-31T12:00:00Z');

/** Sostituisce la riga PIATTAFORME con i dati modificati da `muta`. */
export function proposta(muta, testo = MAIN) {
  const righe = testo.split('\n');
  const i = righe.findIndex((r) => r.startsWith(PREFISSO));
  const dati = JSON.parse(righe[i].slice(PREFISSO.length, -1));
  muta(dati);
  righe[i] = `${PREFISSO}${JSON.stringify(dati)};`;
  return righe.join('\n');
}

/** Aggiornamento quotidiano tipico: date avanti di un giorno, un prezzo cambiato, un modello in piu'. */
export const giornoDopo = (d) => {
  for (const p of d) {
    p.aggiornato = p.aggiornato.length === 10
      ? new Date(Date.parse(`${p.aggiornato}T00:00:00Z`) + 864e5).toISOString().slice(0, 10)
      : new Date(Date.parse(p.aggiornato) + 864e5).toISOString();
  }
  const m = d[1].modelli.find((x) => typeof x.input === 'number');
  m.input = Math.round(m.input * 1.1 * 1000) / 1000;
  d[3].modelli.push({ ...d[3].modelli[0], id: `${d[3].modelli[0].id}-nuovo`, name: 'Modello nuovo' });
};

