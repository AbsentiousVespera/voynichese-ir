// Phase 5 — Morphological grammar (unit re-tokenization + slot induction)
// Phase 6 — Grammar induction + MDL model comparison
// Phase 7 — Parser construction (coverage, ambiguity, FIRST/FOLLOW analogs)
// Phase 9 — Cross-section validation

const fs = require('fs');
const path = require('path');
const doc = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'build', 'corpus.json')));

// ---- collect clean tokens with section/lang -------------------------------
const toks = [];
for (const p of doc.pages) {
  const sec = p.illust || '?', lang = p.language || '?';
  for (const l of p.loci)
    for (const t of l.tokens)
      if (!t.f || !(t.f.includes('u') || t.f.includes('w')))
        toks.push({ w: t.t, sec, lang });
}
const cnt = {};
for (const t of toks) cnt[t.w] = (cnt[t.w] || 0) + 1;

// ---- Phase 5a: unit re-tokenization ---------------------------------------
// Multigraph units justified by Phase 4 transition statistics:
//   c->h 0.83, s->h 0.65 (benches ch/sh); gallows-in-bench ligatures ckh/cth/cph/cfh;
//   q->o 0.98 (but kept separate: q is a prefix particle, o occurs alone too);
//   e-runs and i-runs collapsed (successor entropy of e,i low; runs act as units).
const UNITS = ['ckh', 'cth', 'cph', 'cfh', 'ch', 'sh',
  'eee', 'ee', 'iii', 'ii',
  'k', 't', 'p', 'f', 'q', 'd', 'l', 'r', 's', 'n', 'm', 'g', 'x',
  'a', 'o', 'y', 'e', 'i', 'b', 'j', 'u', 'v', 'z', '*'];
function segment(w) {
  const out = [];
  let i = 0;
  outer: while (i < w.length) {
    for (const u of UNITS) if (w.startsWith(u, i)) { out.push(u); i += u.length; continue outer; }
    out.push(w[i]); i++;   // unknown char as its own unit
  }
  return out;
}

// ---- Phase 5b: unit positional profile -> slot classes --------------------
const uPos = {};   // unit -> {sum, n, init, final}
const segCache = {};
for (const [w, c] of Object.entries(cnt)) {
  const seg = segCache[w] = segment(w);
  seg.forEach((u, i) => {
    uPos[u] = uPos[u] || { sum: 0, n: 0, init: 0, fin: 0 };
    const rel = seg.length === 1 ? 0.5 : i / (seg.length - 1);
    uPos[u].sum += rel * c; uPos[u].n += c;
    if (i === 0) uPos[u].init += c;
    if (i === seg.length - 1) uPos[u].fin += c;
  });
}
const unitProfile = Object.entries(uPos)
  .filter(([, o]) => o.n >= 25)
  .map(([u, o]) => ({
    u, n: o.n, meanPos: +(o.sum / o.n).toFixed(3),
    initRate: +(o.init / o.n).toFixed(3), finRate: +(o.fin / o.n).toFixed(3)
  }))
  .sort((a, b) => a.meanPos - b.meanPos);

// ---- Phase 6a: bigram automaton over units --------------------------------
function trainAutomaton(tokenList, minEdge) {
  const T = { '^': {} };
  for (const t of tokenList) {
    const seg = segCache[t.w] || (segCache[t.w] = segment(t.w));
    let prev = '^';
    for (const u of seg) { (T[prev] = T[prev] || {})[u] = (T[prev][u] || 0) + 1; prev = u; }
    (T[prev] = T[prev] || {})['$'] = (T[prev]['$'] || 0) + 1;
  }
  if (minEdge > 0) {
    for (const [s, row] of Object.entries(T))
      for (const k of Object.keys(row)) if (row[k] < minEdge) delete row[k];
  }
  return T;
}
function accepts(T, w) {
  const seg = segCache[w] || (segCache[w] = segment(w));
  let prev = '^';
  for (const u of seg) { if (!T[prev] || !T[prev][u]) return false; prev = u; }
  return !!(T[prev] && T[prev]['$']);
}
function coverage(T, tokenList) {
  let ok = 0;
  for (const t of tokenList) if (accepts(T, t.w)) ok++;
  return ok / tokenList.length;
}

// ---- Phase 6b: MDL comparison ---------------------------------------------
// Models: M0 unigram over units, M1 bigram automaton, M2 trigram.
// DL = model bits (params * (log2(#units)+16)) + data bits (-sum log2 P, Laplace).
function dlUnigram(tokens) {
  const c = {}; let N = 0;
  for (const t of tokens) for (const u of segCache[t.w]) { c[u] = (c[u] || 0) + 1; N++; }
  for (const t of tokens) { c['$'] = (c['$'] || 0) + 1; N++; }
  const V = Object.keys(c).length;
  let bits = 0;
  for (const t of tokens) {
    for (const u of segCache[t.w]) bits += -Math.log2((c[u]) / N);
    bits += -Math.log2(c['$'] / N);
  }
  return { model: V * 24, data: bits };
}
function dlNgram(tokens, order) {
  const c = {}, ctx = {};
  const hist = t => {
    const seg = ['^', ...segCache[t.w], '$'];
    const out = [];
    for (let i = 1; i < seg.length; i++)
      out.push([seg.slice(Math.max(0, i - order + 1), i).join(' '), seg[i]]);
    return out;
  };
  for (const t of tokens) for (const [h, u] of hist(t)) {
    c[h + '|' + u] = (c[h + '|' + u] || 0) + 1;
    ctx[h] = (ctx[h] || 0) + 1;
  }
  const V = 40;
  let bits = 0;
  for (const t of tokens) for (const [h, u] of hist(t))
    bits += -Math.log2((c[h + '|' + u] + 0.5) / (ctx[h] + 0.5 * V));
  const params = Object.keys(c).length;
  return { model: params * 24, data: bits };
}

// ---- Phase 5c/6c: slot grammar --------------------------------------------
// Data-driven slot template. Classes induced from meanPos + init/fin rates:
//   Q    = q                        (meanPos ~0, initRate ~1)
//   PRE  = o|y|d|s|ch|sh|...        left-attaching openers
//   GAL  = k|t|p|f|ckh|cth|cph|cfh  gallows (word-medial skeleton)
//   MID  = e-runs, a, o             connective nucleus
//   FIN  = i-runs+n|r|l|m|y|s|d..   right edge
// Implemented as ordered regex over units; induction = assign each unit to
// slots where it statistically lives, then parse words as monotone slot walk.
const SLOTS = [
  ['Q', ['q']],
  ['PRE', ['d', 's', 'y', 'o', 'a', 'l', 'r', 'ch', 'sh', 't', 'k', 'p', 'f', 'ckh', 'cth', 'cph', 'cfh']],
  ['GAL', ['k', 't', 'p', 'f', 'ckh', 'cth', 'cph', 'cfh', 'ch', 'sh']],
  ['MID', ['e', 'ee', 'eee', 'o', 'a', 'ch', 'sh', 'd', 'l', 'k', 't']],
  ['FIN', ['i', 'ii', 'iii', 'n', 'r', 'l', 'm', 's', 'd', 'y', 'o', 'a', 'g']]
];
// Slot parse: units must be consumable by slots in order, each slot 0..k units.
// Greedy with backtracking; returns list of possible slot assignments (ambiguity).
function slotParse(w) {
  const seg = segCache[w] || (segCache[w] = segment(w));
  const results = [];
  const MAXPER = [1, 2, 2, 4, 4];
  function rec(i, slot, used, acc) {
    if (i === seg.length) { results.push(acc.map(a => a.join('+')).join(' ')); return; }
    if (slot >= SLOTS.length) return;
    if (results.length > 4) return;
    // consume in current slot
    if (used < MAXPER[slot] && SLOTS[slot][1].includes(seg[i])) {
      acc[slot].push(seg[i]);
      rec(i + 1, slot, used + 1, acc);
      acc[slot].pop();
    }
    // advance slot
    rec(i, slot + 1, 0, acc);
  }
  rec(0, 0, 0, [[], [], [], [], []]);
  return results;
}

// ---- run everything --------------------------------------------------------
const R = {};
R.unitProfile = unitProfile;

const Tall = trainAutomaton(toks, 0);
const Tpruned = trainAutomaton(toks, 15);
R.automaton = {
  edgesAll: Object.values(Tall).reduce((a, r) => a + Object.keys(r).length, 0),
  edgesPruned: Object.values(Tpruned).reduce((a, r) => a + Object.keys(r).length, 0),
  coverageTokensPruned: +coverage(Tpruned, toks).toFixed(4)
};
// type coverage
{
  let okT = 0, totT = 0;
  for (const w of Object.keys(cnt)) { totT++; if (accepts(Tpruned, w)) okT++; }
  R.automaton.coverageTypesPruned = +(okT / totT).toFixed(4);
}

const m0 = dlUnigram(toks), m1 = dlNgram(toks, 2), m2 = dlNgram(toks, 3);
const perTok = x => +((x.model + x.data) / toks.length).toFixed(2);
R.mdl = {
  unigram: { bitsPerToken: perTok(m0), modelBits: m0.model },
  bigram: { bitsPerToken: perTok(m1), modelBits: m1.model },
  trigram: { bitsPerToken: perTok(m2), modelBits: m2.model }
};

// slot grammar coverage + ambiguity
{
  let ok = 0, ambig = 0, okTok = 0, ambigEx = [];
  const fails = {};
  for (const [w, c] of Object.entries(cnt)) {
    const rs = slotParse(w);
    if (rs.length > 0) { ok++; okTok += c; if (rs.length > 1) { ambig++; if (ambigEx.length < 5 && c > 50) ambigEx.push([w, rs.slice(0, 3)]); } }
    else if (c >= 30) fails[w] = c;
  }
  R.slotGrammar = {
    typeCoverage: +(ok / Object.keys(cnt).length).toFixed(4),
    tokenCoverage: +(okTok / toks.length).toFixed(4),
    ambiguousTypes: ambig,
    ambiguityExamples: ambigEx,
    frequentFailures: Object.entries(fails).sort((a, b) => b[1] - a[1]).slice(0, 15)
  };
}

// FIRST/FOLLOW analogs from pruned automaton
{
  const first = Object.entries(Tpruned['^']).sort((a, b) => b[1] - a[1]);
  const tot = first.reduce((a, [, n]) => a + n, 0);
  R.FIRST = first.map(([u, n]) => [u, +(n / tot).toFixed(3)]);
  // FOLLOW($-predecessors)
  const fin = [];
  for (const [s, row] of Object.entries(Tpruned)) if (row['$']) fin.push([s, row['$']]);
  const ftot = fin.reduce((a, [, n]) => a + n, 0);
  R.LAST = fin.sort((a, b) => b[1] - a[1]).map(([u, n]) => [u, +(n / ftot).toFixed(3)]);
}

// overgeneration check: sample from pruned automaton, % attested types
{
  const rng = (() => { let s = 42; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; })();
  let attested = 0, S = 2000;
  const typeSet = new Set(Object.keys(cnt));
  for (let i = 0; i < S; i++) {
    let st = '^', out = '';
    for (let step = 0; step < 15; step++) {
      const row = Tpruned[st]; if (!row) break;
      const tot = Object.values(row).reduce((a, b) => a + b, 0);
      let r = rng() * tot, pick = null;
      for (const [k, n] of Object.entries(row)) { r -= n; if (r <= 0) { pick = k; break; } }
      if (pick === '$' || pick === null) break;
      out += pick; st = pick;
    }
    if (typeSet.has(out)) attested++;
  }
  R.generativePrecision = +(attested / S).toFixed(3);
}

// ---- Phase 9: cross-section validation -------------------------------------
{
  const secs = ['herbal', 'stars-recipes', 'biological', 'pharmaceutical', 'text-only'];
  const M = {};
  for (const tr of secs) {
    const Ttr = trainAutomaton(toks.filter(t => t.sec === tr), 10);
    M[tr] = {};
    for (const te of secs) {
      if (te === tr) continue;
      M[tr][te] = +coverage(Ttr, toks.filter(t => t.sec === te)).toFixed(3);
    }
  }
  R.crossSectionCoverage = M;
  // language cross-validation
  const TA = trainAutomaton(toks.filter(t => t.lang === 'A'), 10);
  const TB = trainAutomaton(toks.filter(t => t.lang === 'B'), 10);
  R.crossLanguage = {
    'A->B': +coverage(TA, toks.filter(t => t.lang === 'B')).toFixed(3),
    'B->A': +coverage(TB, toks.filter(t => t.lang === 'A')).toFixed(3)
  };
}

fs.writeFileSync(path.join(__dirname, '..', 'reports', 'phase5_9.json'), JSON.stringify(R, null, 2));
console.log(JSON.stringify(R, null, 1));
