// Phase 3 — Lexical analysis (tokens as opaque strings)
// Phase 4 — Glyph analysis (positional constraints, transitions, inheritance)

const fs = require('fs');
const path = require('path');
const doc = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'build', 'corpus.json')));

// Collect clean tokens with context
const toks = [];           // {w, sec, lang, pos: first|mid|last, paraInit, locusKind}
for (const p of doc.pages) {
  const sec = p.illust || '?', lang = p.language || '?';
  for (const pa of p.paragraphs) pa.lines.forEach((l, li) => {
    const T = l.tokens.filter(t => !t.f || !(t.f.includes('u') || t.f.includes('w')));
    T.forEach((t, i) => toks.push({
      w: t.t, sec, lang,
      pos: i === 0 ? 'first' : i === T.length - 1 ? 'last' : 'mid',
      paraInit: li === 0 && i === 0
    }));
  });
  // labels separately
  for (const l of p.loci) if (l.type.startsWith('L'))
    for (const t of l.tokens) if (!t.f || !(t.f.includes('u') || t.f.includes('w')))
      toks.push({ w: t.t, sec, lang, pos: 'label', paraInit: false });
}

const R = {};
const cnt = {};
for (const t of toks) cnt[t.w] = (cnt[t.w] || 0) + 1;
const types = Object.keys(cnt);
const N = toks.length;
R.tokens = N; R.types = types.length;
R.hapax = types.filter(w => cnt[w] === 1).length;
R.hapaxRate = +(R.hapax / types.length).toFixed(3);

// Zipf slope (log-log linear regression over top 1000 ranks)
const sorted = Object.entries(cnt).sort((a, b) => b[1] - a[1]);
{
  const K = Math.min(1000, sorted.length);
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let r = 1; r <= K; r++) {
    const x = Math.log(r), y = Math.log(sorted[r - 1][1]);
    sx += x; sy += y; sxx += x * x; sxy += x * y;
  }
  R.zipfSlope = +((K * sxy - sx * sy) / (K * sxx - sx * sx)).toFixed(3);
}
R.top30 = sorted.slice(0, 30);

// Positional preference of top tokens
const posPref = {};
for (const t of toks) {
  if (cnt[t.w] < 100) continue;
  posPref[t.w] = posPref[t.w] || { first: 0, mid: 0, last: 0, label: 0, paraInit: 0, n: 0 };
  posPref[t.w][t.pos]++; posPref[t.w].n++;
  if (t.paraInit) posPref[t.w].paraInit++;
}
// overall baseline
const base = { first: 0, mid: 0, last: 0, label: 0 };
for (const t of toks) base[t.pos]++;
R.posBaseline = Object.fromEntries(Object.entries(base).map(([k, v]) => [k, +(v / N).toFixed(3)]));
R.posPreference = Object.fromEntries(Object.entries(posPref)
  .map(([w, o]) => [w, {
    n: o.n, first: +(o.first / o.n).toFixed(3), last: +(o.last / o.n).toFixed(3),
    label: +(o.label / o.n).toFixed(3), paraInit: +(o.paraInit / o.n).toFixed(3)
  }])
);

// Language A vs B selectivity of top tokens
const langCnt = { A: 0, B: 0 };
const langTok = {};
for (const t of toks) {
  if (t.lang !== 'A' && t.lang !== 'B') continue;
  langCnt[t.lang]++;
  if (cnt[t.w] >= 150) {
    langTok[t.w] = langTok[t.w] || { A: 0, B: 0 };
    langTok[t.w][t.lang]++;
  }
}
R.langSelectivity = Object.fromEntries(Object.entries(langTok).map(([w, o]) => {
  const expA = langCnt.A / (langCnt.A + langCnt.B);
  const obsA = o.A / (o.A + o.B);
  return [w, { n: o.A + o.B, shareA: +obsA.toFixed(3), expectedA: +expA.toFixed(3) }];
}));

// Adjacent repetition + bigrams
let rep = 0, big = {};
{
  let prev = null, prevKey = null;
  for (const t of toks) {
    if (t.pos === 'label') { prev = null; continue; }
    const key = t.sec; // reset across sections is fine-grained enough per line below
    if (prev && t.pos !== 'first') {
      if (t.w === prev) rep++;
      const b = prev + ' ' + t.w;
      big[b] = (big[b] || 0) + 1;
    }
    prev = t.w;
  }
}
R.adjacentRepetition = rep;
R.topBigrams = Object.entries(big).sort((a, b) => b[1] - a[1]).slice(0, 15);

// Word-order information: H(w) vs H(w | prev) over frequent words
{
  const H = pf => {
    let h = 0, tot = Object.values(pf).reduce((a, b) => a + b, 0);
    for (const v of Object.values(pf)) { const p = v / tot; h -= p * Math.log2(p); }
    return h;
  };
  R.unigramEntropyBits = +H(cnt).toFixed(3);
  // conditional: average H(next | prev) weighted, prev restricted to top 200 words
  const top200 = new Set(sorted.slice(0, 200).map(x => x[0]));
  const cond = {};
  let prev = null;
  for (const t of toks) {
    if (t.pos === 'label') { prev = null; continue; }
    if (t.pos === 'first') prev = null;
    if (prev && top200.has(prev)) { cond[prev] = cond[prev] || {}; cond[prev][t.w] = (cond[prev][t.w] || 0) + 1; }
    prev = t.w;
  }
  let hw = 0, tot = 0;
  for (const [w, dist] of Object.entries(cond)) {
    const n = Object.values(dist).reduce((a, b) => a + b, 0);
    hw += n * H(dist); tot += n;
  }
  R.condEntropyBitsGivenPrevTop200 = +(hw / tot).toFixed(3);
}

// Token families: edit-distance-1 graph over types with freq>=20
{
  const freqTypes = types.filter(w => cnt[w] >= 20);
  const set = new Set(freqTypes);
  const edits = w => {
    const out = new Set(); const A = 'abcdefghijklmnopqrstuvxyz';
    for (let i = 0; i <= w.length; i++) {
      if (i < w.length) out.add(w.slice(0, i) + w.slice(i + 1));           // deletion
      for (const c of A) {
        out.add(w.slice(0, i) + c + w.slice(i));                          // insertion
        if (i < w.length) out.add(w.slice(0, i) + c + w.slice(i + 1));    // substitution
      }
    }
    out.delete(w); return out;
  };
  const parent = {}; const find = x => parent[x] === x ? x : (parent[x] = find(parent[x]));
  for (const w of freqTypes) parent[w] = w;
  for (const w of freqTypes) for (const e of edits(w)) if (set.has(e)) {
    const a = find(w), b = find(e); if (a !== b) parent[a] = b;
  }
  const fams = {};
  for (const w of freqTypes) { const r = find(w); fams[r] = fams[r] || []; fams[r].push(w); }
  const famList = Object.values(fams).sort((a, b) => b.length - a.length);
  R.familyCount = famList.length;
  R.typesInFamilies = freqTypes.length;
  R.largestFamilySize = famList[0].length;
  R.topFamilies = famList.slice(0, 6).map(f =>
    f.sort((a, b) => cnt[b] - cnt[a]).slice(0, 12));
}

// ---------------- Phase 4: glyphs ----------------
const G = {};
const gCnt = {}, gInit = {}, gFinal = {}, trans = {};
let totalGlyphs = 0;
for (const [w, c] of Object.entries(cnt)) {
  for (let i = 0; i < w.length; i++) {
    const g = w[i];
    gCnt[g] = (gCnt[g] || 0) + c; totalGlyphs += c;
    if (i === 0) gInit[g] = (gInit[g] || 0) + c;
    if (i === w.length - 1) gFinal[g] = (gFinal[g] || 0) + c;
    const nxt = i < w.length - 1 ? w[i + 1] : '#';   // '#' = word end
    trans[g] = trans[g] || {};
    trans[g][nxt] = (trans[g][nxt] || 0) + c;
  }
  trans['^'] = trans['^'] || {};
  trans['^'][w[0]] = (trans['^'][w[0]] || 0) + c;
}
G.inventory = Object.entries(gCnt).sort((a, b) => b[1] - a[1])
  .map(([g, n]) => [g, n, +(n / totalGlyphs * 100).toFixed(2) + '%']);

// positional profile per glyph
G.positional = {};
for (const [g, n] of Object.entries(gCnt)) {
  G.positional[g] = {
    initRate: +((gInit[g] || 0) / n).toFixed(3),
    finalRate: +((gFinal[g] || 0) / n).toFixed(3)
  };
}

// strongest transition constraints (P(next|g) > 0.75)
G.hardTransitions = [];
for (const [g, row] of Object.entries(trans)) {
  const tot = Object.values(row).reduce((a, b) => a + b, 0);
  if (tot < 200) continue;
  for (const [nxt, n] of Object.entries(row)) {
    const pr = n / tot;
    if (pr > 0.6) G.hardTransitions.push([g + '->' + nxt, +pr.toFixed(3), tot]);
  }
}
G.hardTransitions.sort((a, b) => b[1] - a[1]);

// per-glyph successor entropy (low entropy => glyph is part of a multigraph unit)
G.successorEntropy = {};
for (const [g, row] of Object.entries(trans)) {
  const tot = Object.values(row).reduce((a, b) => a + b, 0);
  if (tot < 200) continue;
  let h = 0;
  for (const n of Object.values(row)) { const p = n / tot; h -= p * Math.log2(p); }
  G.successorEntropy[g] = +h.toFixed(3);
}

R.glyphs = G;
fs.writeFileSync(path.join(__dirname, '..', 'reports', 'phase3_4.json'), JSON.stringify(R, null, 2));

// compact console output
const { glyphs, ...lex } = R;
console.log(JSON.stringify(lex, null, 1));
console.log('--- GLYPHS ---');
console.log(JSON.stringify(glyphs, null, 1));
