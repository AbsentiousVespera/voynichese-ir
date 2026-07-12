// Refinement pass:
// 1. Fixed slot grammar (platform gallows allowed post-nucleus) -> recompute
// 2. Line-level (supra-word) syntax test: class-bigram mutual information vs shuffle
// 3. AST emission for sample page
// 4. Production table with per-edge confidence (count + cross-section stability)

const fs = require('fs');
const path = require('path');
const doc = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'build', 'corpus.json')));

const UNITS = ['ckh', 'cth', 'cph', 'cfh', 'ch', 'sh', 'eee', 'ee', 'iii', 'ii',
  'k', 't', 'p', 'f', 'q', 'd', 'l', 'r', 's', 'n', 'm', 'g', 'x',
  'a', 'o', 'y', 'e', 'i', 'b', 'j', 'u', 'v', 'z', '*'];
const segCache = {};
function segment(w) {
  if (segCache[w]) return segCache[w];
  const out = []; let i = 0;
  outer: while (i < w.length) {
    for (const u of UNITS) if (w.startsWith(u, i)) { out.push(u); i += u.length; continue outer; }
    out.push(w[i]); i++;
  }
  return segCache[w] = out;
}

const toks = [];
for (const p of doc.pages) {
  const sec = p.illust || '?', lang = p.language || '?';
  for (const pa of p.paragraphs) pa.lines.forEach((l, li) => {
    const T = l.tokens.filter(t => !t.f || !(t.f.includes('u') || t.f.includes('w')));
    T.forEach((t, i) => toks.push({ w: t.t, sec, lang, line: `${p.id}.${l.n}`, i, last: i === T.length - 1 }));
  });
}
const cnt = {};
for (const t of toks) cnt[t.w] = (cnt[t.w] || 0) + 1;

const R = {};

// ---- 1. fixed slot grammar --------------------------------------------------
const GALL = ['k', 't', 'p', 'f', 'ckh', 'cth', 'cph', 'cfh'];
const SLOTS = [
  ['Q',    ['q']],
  ['PRE',  ['d', 's', 'y', 'o', 'a', 'l', 'r', 'ch', 'sh', ...GALL]],
  ['CORE', ['e', 'ee', 'eee', 'o', 'a', 'ch', 'sh', 'd', 'l', ...GALL]],
  ['FIN',  ['i', 'ii', 'iii', 'n', 'r', 'l', 'm', 's', 'd', 'y', 'o', 'a', 'g', 'e', 'ee']]
];
const MAXPER = [1, 2, 5, 4];
function slotParse(w, collectAll) {
  const seg = segment(w);
  const results = [];
  function rec(i, slot, used, acc) {
    if (results.length > (collectAll ? 50 : 0)) return;
    if (i === seg.length) { results.push(acc.map((a, s) => a.length ? SLOTS[s][0] + ':' + a.join('+') : '').filter(Boolean).join(' ')); return; }
    if (slot >= SLOTS.length) return;
    if (used < MAXPER[slot] && SLOTS[slot][1].includes(seg[i])) {
      acc[slot].push(seg[i]); rec(i + 1, slot, used + 1, acc); acc[slot].pop();
    }
    rec(i, slot + 1, 0, acc);
  }
  rec(0, 0, 0, SLOTS.map(() => []));
  return results;
}
{
  let okTypes = 0, okToks = 0, fails = {};
  for (const [w, c] of Object.entries(cnt)) {
    if (slotParse(w, false).length) { okTypes++; okToks += c; }
    else if (c >= 20) fails[w] = c;
  }
  R.slotGrammarFixed = {
    typeCoverage: +(okTypes / Object.keys(cnt).length).toFixed(4),
    tokenCoverage: +(okToks / toks.length).toFixed(4),
    frequentFailures: Object.entries(fails).sort((a, b) => b[1] - a[1]).slice(0, 12)
  };
}

// ---- 2. supra-word syntax test ---------------------------------------------
// word class = [q? ] [gallows-type] [final-unit-group]
function wclass(w) {
  const seg = segment(w);
  const q = seg[0] === 'q' ? 'Q' : '';
  const g = seg.find(u => GALL.includes(u));
  const gt = g ? (g.length === 3 ? 'G2' : 'G1') : 'G0';
  const last = seg[seg.length - 1];
  const fg = ['n', 'm'].includes(last) ? 'Fn' : ['y'].includes(last) ? 'Fy'
    : ['r', 'l', 's'].includes(last) ? 'Fr' : ['o', 'a', 'e', 'ee', 'd'].includes(last) ? 'Fo' : 'Fx';
  return q + gt + fg;
}
{
  const pairs = [];
  for (let i = 1; i < toks.length; i++)
    if (toks[i].line === toks[i - 1].line && toks[i].i === toks[i - 1].i + 1)
      pairs.push([wclass(toks[i - 1].w), wclass(toks[i].w)]);
  const MI = ps => {
    const ca = {}, cb = {}, cab = {}; const n = ps.length;
    for (const [a, b] of ps) { ca[a] = (ca[a] || 0) + 1; cb[b] = (cb[b] || 0) + 1; cab[a + '|' + b] = (cab[a + '|' + b] || 0) + 1; }
    let mi = 0;
    for (const [k, nab] of Object.entries(cab)) {
      const [a, b] = k.split('|');
      mi += (nab / n) * Math.log2((nab / n) / ((ca[a] / n) * (cb[b] / n)));
    }
    return mi;
  };
  const obs = MI(pairs);
  // shuffle second elements
  const bs = pairs.map(p => p[1]);
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = bs.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1));[bs[i], bs[j]] = [bs[j], bs[i]]; }
  const shuf = MI(pairs.map(([a], i) => [a, bs[i]]));
  R.supraWordSyntax = { pairs: pairs.length, classBigramMI_bits: +obs.toFixed(4), shuffledMI_bits: +shuf.toFixed(4) };

  // specific conditioning: P(next starts q | cur final group)
  const cond = {};
  for (const [a, b] of pairs) {
    const key = a.includes('Fn') ? 'after-Fn(n/m)' : a.includes('Fy') ? 'after-Fy(y)' : a.includes('Fr') ? 'after-Fr(r/l/s)' : 'after-other';
    cond[key] = cond[key] || [0, 0];
    cond[key][1]++; if (b.startsWith('Q')) cond[key][0]++;
  }
  R.qConditioning = Object.fromEntries(Object.entries(cond).map(([k, [a, b]]) => [k, +(a / b).toFixed(3)]));
}

// ---- 3. AST for sample page f1r ---------------------------------------------
{
  const p = doc.pages.find(x => x.id === 'f1r');
  const ast = {
    node: 'Entry', id: p.id, section: p.illust, language: p.language, hand: p.hand,
    children: p.paragraphs.map((pa, pi) => ({
      node: 'Block', index: pi,
      children: pa.lines.map(l => ({
        node: 'Line', locus: l.n,
        children: l.tokens.map(t => {
          const sp = slotParse(t.t, false);
          return { node: 'Word', surface: t.t, units: segment(t.t), slots: sp[0] || null };
        })
      }))
    }))
  };
  fs.writeFileSync(path.join(__dirname, '..', 'build', 'ast_f1r.json'), JSON.stringify(ast, null, 1));
  R.astSample = 'build/ast_f1r.json written';
}

// ---- 4. production table with confidence ------------------------------------
{
  const secs = ['herbal', 'stars-recipes', 'biological', 'pharmaceutical', 'text-only', 'cosmological'];
  const train = list => {
    const T = { '^': {} };
    for (const t of list) {
      let prev = '^';
      for (const u of segment(t.w)) { (T[prev] = T[prev] || {})[u] = (T[prev][u] || 0) + 1; prev = u; }
      (T[prev] = T[prev] || {})['$'] = (T[prev]['$'] || 0) + 1;
    }
    return T;
  };
  const Tall = train(toks);
  const perSec = secs.map(s => train(toks.filter(t => t.sec === s)));
  const prods = [];
  for (const [s, row] of Object.entries(Tall)) {
    const tot = Object.values(row).reduce((a, b) => a + b, 0);
    for (const [nxt, n] of Object.entries(row)) {
      if (n < 50) continue;
      const stability = perSec.filter(T => T[s] && T[s][nxt] >= 5).length / secs.length;
      prods.push({
        rule: `${s} -> ${nxt}`, count: n, prob: +(n / tot).toFixed(3),
        stability: +stability.toFixed(2),
        confidence: +Math.min(1, (Math.log10(n) / 4) * 0.5 + stability * 0.5).toFixed(2)
      });
    }
  }
  prods.sort((a, b) => b.count - a.count);
  R.productions = prods.length;
  fs.writeFileSync(path.join(__dirname, '..', 'reports', 'productions.json'), JSON.stringify(prods, null, 1));
  R.topProductions = prods.slice(0, 20);
}

fs.writeFileSync(path.join(__dirname, '..', 'reports', 'refine.json'), JSON.stringify(R, null, 2));
const { topProductions, ...core } = R;
console.log(JSON.stringify(core, null, 1));
console.log('top productions:', topProductions.map(p => `${p.rule} (${p.count}, p=${p.prob}, conf=${p.confidence})`).join('; '));
