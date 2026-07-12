// Phase 0 — Corpus Normalization
// Parses IVTFF (ZL3b-n.txt) into the intermediate representation:
// Document -> Section -> Entry(page) -> Paragraph -> Line -> Token
// No interpretation: EVA codes are treated as opaque glyph symbol IDs.

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'corpus', 'ZL3b-n.txt');
const OUT = path.join(__dirname, '..', 'build', 'corpus.json');

const ILLUST = { T: 'text-only', H: 'herbal', A: 'astronomical', Z: 'zodiac',
                 B: 'biological', C: 'cosmological', P: 'pharmaceutical', S: 'stars-recipes' };

const raw = fs.readFileSync(SRC, 'latin1').split(/\r?\n/);

const doc = { source: 'ZL3b-n (IVTFF Eva- 2.0)', pages: [] };
let page = null;

// --- token cleaning -------------------------------------------------------
// Returns { text, flags } or null if nothing remains.
// flags: u = contained uncertainty (?, alternates, weirdo @nnn, {} groups, comma-space)
function cleanTokenText(t) {
  let flags = '';
  if (/[?]/.test(t)) flags += 'u';
  if (/@\d+;/.test(t)) flags += 'w';           // "weirdo" / extended glyph
  // alternate readings [x:y] -> take first reading
  let s = t.replace(/\[([^\]:]*):[^\]]*\]/g, (_, a) => { flags += 'a'; return a; });
  // {..} grouping (ligature/odd writing): keep content, drop braces and half-space '
  s = s.replace(/[{}']/g, m => { if (m !== "'") flags += 'g'; return ''; });
  // extended chars @nnn; -> single placeholder symbol '*'
  s = s.replace(/@\d+;/g, '*');
  if (s.length === 0) return null;
  return { text: s, flags };
}

// --- line text -> tokens ---------------------------------------------------
function tokenize(text) {
  // strip inline comments <!...>
  let s = text.replace(/<![^>]*>/g, '');
  const paraStart = /<%>/.test(s);
  const paraEnd = /<\$>/.test(s);
  // remove markup tags <%> <$> <-> <~> and any remaining <..> controls
  s = s.replace(/<[^>]*>/g, '');
  // split on word separators: '.' certain, ',' uncertain
  const parts = s.split(/([.,])/).filter(x => x.length);
  const tokens = [];
  let pendingUncertainSep = false;
  for (const p of parts) {
    if (p === '.') { pendingUncertainSep = false; continue; }
    if (p === ',') { pendingUncertainSep = true; continue; }
    const ct = cleanTokenText(p);
    if (!ct) continue;
    const tok = { t: ct.text };
    let fl = ct.flags;
    if (pendingUncertainSep) fl += 's';       // preceded by uncertain space
    if (fl) tok.f = fl;
    tokens.push(tok);
    pendingUncertainSep = false;
  }
  return { tokens, paraStart, paraEnd };
}

// --- main loop --------------------------------------------------------------
for (const lineRaw of raw) {
  const line = lineRaw.trim();
  if (!line || line.startsWith('#')) continue;

  // page header: <f1r>  <! $Q=A $P=A ...>
  const ph = line.match(/^<(f\d+[rv]\d*|[a-z]+\d*[rv]?\d*)>\s*(<!([^>]*)>)?\s*$/i);
  if (ph && !ph[1].includes('.')) {
    const vars = {};
    if (ph[3]) for (const m of ph[3].matchAll(/\$(\w+)=(\S+)/g)) vars[m[1]] = m[2];
    page = {
      id: ph[1], quire: vars.Q || null, hand: vars.H || null,
      language: vars.L || null, illust: ILLUST[vars.I] || vars.I || null,
      loci: []
    };
    doc.pages.push(page);
    continue;
  }

  // locus line: <f1r.1,@P0>   text...
  const lm = line.match(/^<([^.>]+)\.([^,>]+),([@+*=~])(\w\w?)>\s*(.*)$/);
  if (lm) {
    if (!page || page.id !== lm[1]) {
      page = doc.pages.find(p => p.id === lm[1]);
      if (!page) { page = { id: lm[1], loci: [] }; doc.pages.push(page); }
    }
    const { tokens, paraStart, paraEnd } = tokenize(lm[5]);
    page.loci.push({
      n: lm[2], pos: lm[3], type: lm[4],
      paraStart, paraEnd, tokens
    });
  }
}

// --- assemble paragraphs (P-type loci only), attach as structure -----------
for (const p of doc.pages) {
  p.paragraphs = [];
  let cur = null;
  for (const l of p.loci) {
    if (!l.type.startsWith('P')) continue;
    if (l.paraStart || l.pos === '*' || l.pos === '@' || !cur) {
      cur = { lines: [] };
      p.paragraphs.push(cur);
    }
    cur.lines.push(l);
    if (l.paraEnd) cur = null;
  }
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(doc));

// --- summary ---------------------------------------------------------------
let nl = 0, nt = 0, np = 0, clean = 0;
const bySec = {};
for (const p of doc.pages) {
  np += p.paragraphs.length;
  for (const l of p.loci) {
    nl++;
    for (const t of l.tokens) { nt++; if (!t.f) clean++; }
  }
  const s = p.illust || '?';
  bySec[s] = bySec[s] || { pages: 0, tokens: 0 };
  bySec[s].pages++;
  bySec[s].tokens += p.loci.reduce((a, l) => a + l.tokens.length, 0);
}
console.log(JSON.stringify({
  pages: doc.pages.length, paragraphs: np, loci: nl,
  tokens: nt, cleanTokens: clean, sections: bySec
}, null, 2));
