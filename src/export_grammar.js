// Exports the trained word-DFA + attested lexicon for the linter (CLI + web).

const fs = require('fs');
const path = require('path');
const doc = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'build', 'corpus.json')));

const UNITS = ['ckh', 'cth', 'cph', 'cfh', 'ch', 'sh', 'eee', 'ee', 'iii', 'ii',
  'k', 't', 'p', 'f', 'q', 'd', 'l', 'r', 's', 'n', 'm', 'g', 'x',
  'a', 'o', 'y', 'e', 'i'];
function segment(w) {
  const out = []; let i = 0;
  outer: while (i < w.length) {
    for (const u of UNITS) if (w.startsWith(u, i)) { out.push(u); i += u.length; continue outer; }
    return null; // non-EVA char
  }
  return out;
}

const cnt = {};
let total = 0;
for (const p of doc.pages)
  for (const l of p.loci)
    for (const t of l.tokens)
      if (!t.f || !(t.f.includes('u') || t.f.includes('w'))) {
        cnt[t.t] = (cnt[t.t] || 0) + 1; total++;
      }

// train automaton (unpruned counts; linter applies thresholds itself)
const T = { '^': {} };
for (const [w, c] of Object.entries(cnt)) {
  const seg = segment(w);
  if (!seg) continue;
  let prev = '^';
  for (const u of seg) { (T[prev] = T[prev] || {})[u] = (T[prev][u] || 0) + c; prev = u; }
  (T[prev] = T[prev] || {})['$'] = (T[prev]['$'] || 0) + c;
}

// lexicon: types with freq >= 2 (keeps size sane, hapax excluded)
const lex = Object.fromEntries(Object.entries(cnt).filter(([, c]) => c >= 2));

const out = {
  meta: { corpus: 'ZL3b', tokens: total, types: Object.keys(cnt).length, minEdge: 15 },
  units: UNITS,
  edges: T,
  lexicon: lex
};
fs.writeFileSync(path.join(__dirname, '..', 'build', 'grammar_export.json'), JSON.stringify(out));
console.log('edges:', Object.values(T).reduce((a, r) => a + Object.keys(r).length, 0),
  'lexicon entries:', Object.keys(lex).length,
  'size:', (JSON.stringify(out).length / 1024).toFixed(0) + 'KB');
