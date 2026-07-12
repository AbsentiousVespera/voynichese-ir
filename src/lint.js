// Voynichese linter (CLI).
// Usage: node src/lint.js "qokeedy shol daiin"
//        node src/lint.js --json "text..."
// Validates each word against the corpus-trained DFA and reports
// compiler-style diagnostics.

const fs = require('fs');
const path = require('path');
const G = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'build', 'grammar_export.json')));

const MIN_EDGE = G.meta.minEdge;      // production threshold (count >= 15)
const RARE_EDGE = 50;                 // below this: "unusual" style note

const rowTotals = {};
for (const [s, row] of Object.entries(G.edges))
  rowTotals[s] = Object.values(row).reduce((a, b) => a + b, 0);

function segment(w) {
  const out = []; let i = 0;
  outer: while (i < w.length) {
    for (const u of G.units) if (w.startsWith(u, i)) { out.push(u); i += u.length; continue outer; }
    return { error: { kind: 'unknown-glyph', at: i, char: w[i] } };
  }
  return { units: out };
}

function expected(state) {
  const row = G.edges[state] || {};
  return Object.entries(row)
    .filter(([, n]) => n >= MIN_EDGE)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([u, n]) => ({ u: u === '$' ? '(end)' : u, p: +(n / rowTotals[state]).toFixed(3) }));
}

function editDist(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, dp[i][j]);
    }
    if (rowMin > max) return max + 1;
  }
  return dp[a.length][b.length];
}

function suggest(w) {
  const out = [];
  for (const [cand, n] of Object.entries(G.lexicon)) {
    const d = editDist(w, cand, 2);
    if (d <= 2) out.push({ cand, n, d });
  }
  return out.sort((a, b) => a.d - b.d || b.n - a.n).slice(0, 3);
}

function lintWord(w) {
  const res = { word: w };
  if (!/^[a-z]+$/.test(w))
    return { ...res, status: 'error', message: `illegal character '${[...w].find(c => !/[a-z]/.test(c))}' — not an EVA glyph`, suggestions: [] };

  const seg = segment(w);
  if (seg.error)
    return { ...res, status: 'error', message: `unknown glyph '${seg.error.char}' at position ${seg.error.at} — not in the glyph-unit inventory`, suggestions: suggest(w) };

  res.units = seg.units;
  let state = '^', bits = 0, rare = null;
  for (let i = 0; i < seg.units.length; i++) {
    const u = seg.units[i];
    const n = (G.edges[state] || {})[u] || 0;
    if (n < MIN_EDGE) {
      return {
        ...res, status: 'error',
        message: state === '^'
          ? `no word may begin with '${u}'`
          : `'${u}' cannot follow '${state}' (position ${i + 1})`,
        expected: expected(state),
        suggestions: suggest(w)
      };
    }
    if (n < RARE_EDGE && !rare) rare = `${state}→${u}`;
    bits += -Math.log2(n / rowTotals[state]);
    state = u;
  }
  const endN = (G.edges[state] || {})['$'] || 0;
  if (endN < MIN_EDGE)
    return {
      ...res, status: 'error',
      message: `word may not end after '${state}' — the right edge is unterminated`,
      expected: expected(state), suggestions: suggest(w)
    };
  bits += -Math.log2(endN / rowTotals[state]);

  res.bitsPerUnit = +(bits / (seg.units.length + 1)).toFixed(2);
  const att = G.lexicon[w];
  if (att) {
    res.status = 'ok';
    res.message = `attested ${att}× in the manuscript` + (rare ? `; rare transition ${rare}` : '');
  } else {
    res.status = rare ? 'warn' : 'novel';
    res.message = (rare
      ? `grammatical but uses rare transition ${rare}`
      : `grammatical; not attested (novel but well-formed)`);
    res.suggestions = suggest(w);
  }
  return res;
}

function lint(text) {
  const words = text.toLowerCase().split(/[\s.,]+/).filter(Boolean);
  return words.map(lintWord);
}

// ---- CLI ----
const args = process.argv.slice(2);
const asJson = args[0] === '--json';
const text = (asJson ? args.slice(1) : args).join(' ');
if (!text) { console.log('usage: node src/lint.js [--json] "voynichese text"'); process.exit(1); }
const results = lint(text);
if (asJson) { console.log(JSON.stringify(results, null, 1)); process.exit(0); }

const ICON = { ok: 'OK   ', novel: 'NOVEL', warn: 'WARN ', error: 'ERROR' };
let errs = 0;
for (const r of results) {
  if (r.status === 'error') errs++;
  let line = `${ICON[r.status]}  ${r.word.padEnd(12)} ${r.message}`;
  if (r.units && r.status !== 'error') line += `  [${r.units.join(' ')}]`;
  console.log(line);
  if (r.expected) console.log(`       expected here: ${r.expected.map(e => `${e.u}(${e.p})`).join(' ')}`);
  if (r.suggestions && r.suggestions.length)
    console.log(`       did you mean: ${r.suggestions.map(s => `${s.cand}(${s.n}x)`).join(', ')}`);
}
console.log(`\n${results.length} words, ${errs} errors — ${errs ? 'NOT processable' : 'processable'}`);

module.exports = { lint };
