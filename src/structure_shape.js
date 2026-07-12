// Phase 1 — Document structure (glyphs ignored)
// Phase 2 — Shape grammar (glyph identities ignored; only geometry classes)

const fs = require('fs');
const path = require('path');
const doc = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'build', 'corpus.json')));

const R = {};

// ---------- Phase 1: structure ----------
const locusTypes = {};
const linesPerPara = [];
const tokensPerLine = {};       // by section
const parasPerPage = {};
const labelStats = { labelLoci: 0, labelTokens: 0, singleTokenLabelLoci: 0 };

for (const p of doc.pages) {
  const sec = p.illust || '?';
  parasPerPage[sec] = parasPerPage[sec] || [];
  parasPerPage[sec].push(p.paragraphs.length);
  for (const l of p.loci) {
    locusTypes[l.type] = (locusTypes[l.type] || 0) + 1;
    if (l.type.startsWith('P')) {
      tokensPerLine[sec] = tokensPerLine[sec] || [];
      tokensPerLine[sec].push(l.tokens.length);
    } else if (l.type.startsWith('L')) {
      labelStats.labelLoci++;
      labelStats.labelTokens += l.tokens.length;
      if (l.tokens.length === 1) labelStats.singleTokenLabelLoci++;
    }
  }
  for (const para of p.paragraphs) linesPerPara.push(para.lines.length);
}

const stats = a => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const mean = a.reduce((x, y) => x + y, 0) / a.length;
  return { n: a.length, mean: +mean.toFixed(2), median: s[a.length >> 1], min: s[0], max: s[s.length - 1] };
};

R.locusTypes = locusTypes;
R.linesPerParagraph = stats(linesPerPara);
R.tokensPerLine = Object.fromEntries(Object.entries(tokensPerLine).map(([k, v]) => [k, stats(v)]));
R.parasPerPage = Object.fromEntries(Object.entries(parasPerPage).map(([k, v]) => [k, stats(v)]));
R.labels = labelStats;

// Paragraph-position effect on line length (tokens): first / middle / last line
const lineLenByParaPos = { first: [], middle: [], last: [], only: [] };
for (const p of doc.pages) for (const para of p.paragraphs) {
  const L = para.lines;
  L.forEach((l, i) => {
    const k = L.length === 1 ? 'only' : i === 0 ? 'first' : i === L.length - 1 ? 'last' : 'middle';
    lineLenByParaPos[k].push(l.tokens.length);
  });
}
R.lineTokensByParaPosition = Object.fromEntries(
  Object.entries(lineLenByParaPos).map(([k, v]) => [k, stats(v)]));

// ---------- Phase 2: shape grammar ----------
// Geometry-only classes (facts about glyph shapes, not identities):
const ASC = new Set(['k', 't', 'p', 'f']);          // gallows: rise above x-height
const DESC = new Set(['q', 'y', 'm', 'g', 'j']);    // tails below baseline
const lenClass = w => w.length <= 3 ? 'S' : w.length <= 6 ? 'M' : 'L';
const shape = w => lenClass(w)
  + ([...w].some(c => ASC.has(c)) ? 'a' : '')
  + ([...w].some(c => DESC.has(c)) ? 'd' : '');

// (a) shape inventory
const shapeFreq = {};
// (b) token length by position in line
const lenByLinePos = { first: [], second: [], middle: [], penult: [], last: [] };
// (c) ascender rate: paragraph-initial word vs line-initial vs elsewhere
const ascRate = { paraInitial: [0, 0], lineInitial: [0, 0], other: [0, 0] };
// (d) descender-final glyph rate at line end vs elsewhere
const descEnd = { lineFinal: [0, 0], other: [0, 0] };
// (e) shape bigram conditioning
const shapeBigram = {}; const shapeMarginal = {};

for (const p of doc.pages) for (const para of p.paragraphs) {
  para.lines.forEach((l, li) => {
    const toks = l.tokens.filter(t => !t.f || !t.f.includes('u'));
    toks.forEach((t, i) => {
      const w = t.t, sh = shape(w);
      shapeFreq[sh] = (shapeFreq[sh] || 0) + 1;
      shapeMarginal[lenClass(w)] = (shapeMarginal[lenClass(w)] || 0) + 1;

      const posKey = i === 0 ? 'first' : i === 1 ? 'second'
        : i === toks.length - 1 ? 'last' : i === toks.length - 2 ? 'penult' : 'middle';
      lenByLinePos[posKey].push(w.length);

      const hasAsc = [...w].some(c => ASC.has(c));
      const bucket = (li === 0 && i === 0) ? 'paraInitial' : (i === 0 ? 'lineInitial' : 'other');
      ascRate[bucket][0] += hasAsc ? 1 : 0; ascRate[bucket][1]++;

      const endsDesc = DESC.has(w[w.length - 1]);
      const eb = (i === toks.length - 1) ? 'lineFinal' : 'other';
      descEnd[eb][0] += endsDesc ? 1 : 0; descEnd[eb][1]++;

      if (i > 0) {
        const prev = lenClass(toks[i - 1].t), curc = lenClass(w);
        shapeBigram[prev] = shapeBigram[prev] || {};
        shapeBigram[prev][curc] = (shapeBigram[prev][curc] || 0) + 1;
      }
    });
  });
}

R.shapeInventoryTop = Object.entries(shapeFreq).sort((a, b) => b[1] - a[1]);
R.tokenLenByLinePosition = Object.fromEntries(
  Object.entries(lenByLinePos).map(([k, v]) => [k, stats(v)]));
R.ascenderRate = Object.fromEntries(Object.entries(ascRate)
  .map(([k, [a, b]]) => [k, +(a / b).toFixed(3)]));
R.descenderFinalRate = Object.fromEntries(Object.entries(descEnd)
  .map(([k, [a, b]]) => [k, +(a / b).toFixed(3)]));
R.shapeBigramCond = Object.fromEntries(Object.entries(shapeBigram).map(([k, row]) => {
  const tot = Object.values(row).reduce((a, b) => a + b, 0);
  return [k, Object.fromEntries(Object.entries(row).map(([c, n]) => [c, +(n / tot).toFixed(3)]))];
}));
const totM = Object.values(shapeMarginal).reduce((a, b) => a + b, 0);
R.shapeMarginal = Object.fromEntries(Object.entries(shapeMarginal)
  .map(([k, n]) => [k, +(n / totM).toFixed(3)]));

fs.writeFileSync(path.join(__dirname, '..', 'reports', 'phase1_2.json'), JSON.stringify(R, null, 2));
console.log(JSON.stringify(R, null, 2));
