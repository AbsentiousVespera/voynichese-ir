# Voynichese-IR — Formal Language Specification v0.1

**Method:** compiler-engineering reverse specification. No translation, no language identification, no cipher assumptions.
**Corpus:** ZL3b transliteration (Zandbergen–Landini, IVTFF Eva- 2.0, 2025-05-13), treated as opaque symbol IDs.
**Pipeline:** `D:\V\voynich-lab\src\` (Node.js) — `parse_ivtff.js` → `structure_shape.js` → `lexical_glyph.js` → `grammar.js` → `refine.js`.
**Raw results:** `reports/phase1_2.json`, `phase3_4.json`, `phase5_9.json`, `refine.json`, `productions.json`.

---

## 1. Corpus Normalization Report (Phase 0)

| Level | Count |
|---|---|
| Pages (Entries) | 227 |
| Paragraphs (Blocks) | 750 |
| Loci (Lines) | 5,059 |
| Tokens | 37,844 |
| Clean tokens (no uncertain glyphs/readings) | 33,838 (89.4%) |
| Analyzed tokens (paragraph + label text) | 34,781 |

Intermediate representation: `Document → Page{quire, hand, language, illustration} → Locus{position, type} → Token{surface, flags}` plus assembled `Paragraph → Line[]` structure. All uncertain-glyph (`?`), extended-glyph (`@nnn;`) tokens excluded from statistics but retained in the IR.

## 2. Document Hierarchy (Phase 1)

Eight sections self-identify by illustration type and have distinct **layout grammars**:

| Section | Pages | Tokens | Paragraphs/page | Tokens/line (median) | Profile |
|---|---|---|---|---|---|
| herbal | 129 | 10,928 | 1.9 | 7 | short blocks + few labels |
| stars-recipes | 25 | 11,646 | 11.7 | 10 | dense block lists |
| biological | 19 | 6,327 | 5.0 | 9 | blocks + label sets |
| pharmaceutical | 16 | 2,561 | 2.8 | 9 | blocks + many labels |
| zodiac | 12 | 1,001 | **0** | — | labels + circular text only |
| cosmological | 11 | 2,207 | 2.2 | 6 | circular/radial loci |
| astronomical | 8 | 812 | 2.3 | 3 | labels + short runs |
| text-only | 7 | 2,362 | 4.4 | 10 | pure prose blocks |

Locus-type inventory: paragraph text (`P*` 4,130), labels (`L*` 703 — **91% single-token**), circular (`Cc` 83), radial (`Ri`/`Ro` 142).

**Structural grammar (layout level):**
```
Document      ::= Section+
Section       ::= Entry+                     (Entry = page)
Entry(herbal) ::= Illustration Block{1..5} Label*
Entry(zodiac) ::= Illustration CircularText Label+
Entry(stars)  ::= Block{3..18}
Block         ::= Line+ TerminalLine         ; TerminalLine mean 6.0 tokens
                                             ; vs 8.7–9.1 for other lines
Label         ::= Word                       (91% of label loci)
```

## 3–4. Word-Shape Grammar (Phase 2, glyph identities masked)

Shape classes: length S/M/L × ascender(a) × descender(d).

- Marginals: M 62%, L 20%, S 18%. Top shapes: `Mad` (7,449), `M` (5,600), `Md` (4,397), `Lad` (4,288).
- **Block-start rule:** paragraph-initial words contain an ascender **91.7%** vs 51% baseline. Confidence: very high (n=742). This is a BEGIN-marker at the layout level.
- **Line-end rule:** line-final words end in a descender glyph **56.7%** vs 41.8% elsewhere.
- Line-initial words are longer (mean 5.46 vs 5.07 glyphs) and ascender-poor (42.3%).
- Shape bigrams deviate from independence: S→S 0.26 (marginal 0.18), L→L 0.256 (marginal 0.20) — mild same-shape clustering.

## 5. Token Inventory (Phase 3)

- 7,650 types / 34,781 tokens. Hapax rate **70.5%** of types.
- Zipf slope **−1.037** (log-log regression, top 1000 ranks) — near-perfect Zipfian.
- Top tokens: `daiin` 766, `ol` 521, `chedy` 488, `aiin` 451, `shedy` 422, `chol` 363, `or` 353 …
- Word-level entropy H(w) = 10.36 bits; H(w | prev) = 6.23 bits.
- **Positional selectivity is real syntax:** `chdy` never line-initial (0/132), enriched line-final; `sho` line-initial at 2.4× baseline; `ar` avoids line-initial (0.018 vs 0.119 baseline).
- **Register split (Currier A/B) is near-absolute for part of the lexicon:** `qokeedy` (n=303): 0% in A; `chedy` (n=487): 0.2% in A; `qokain` 1.4% A — while `chor` is 86% A (expected 32%). Same morphology (see §14), disjoint lexical preferences.
- Exact adjacent repetition (`daiin daiin`): 274 occurrences — far above natural-language rates.

## 6. Token Family Graph

Among the 261 types with frequency ≥ 20, **249 form a single connected component** under edit-distance 1. The lexicon is one dense combinatorial neighborhood, not a set of isolated lexemes. (Natural-language frequent vocabularies decompose into many small components.)

## 7. Glyph Inventory (Phase 4)

19 effective symbols (25 observed; 6 marginal, <0.1%). Top: `o` 13.0%, `e` 10.3%, `h` 9.5%, `y` 9.3%, `a` 7.5%, `c` 7.0%, `d` 6.9%, `i` 6.3%, `k` 5.8%, `l` 5.5%.

Hard positional constraints (measured, not assumed):

| Glyph | Constraint | Strength |
|---|---|---|
| q | word-initial | 0.990 |
| q→o | successor is o | 0.977 |
| n | word-final | 0.972 |
| ii→n | i-run closes with n | 0.950 |
| m | word-final | 0.944 |
| y | word-final | 0.861 |
| c→h | forms bench | 0.827 |
| r | word-final | 0.766 |
| h | never word-initial | 1.000 |

Successor entropy: `q` 0.21, `n` 0.26, `m` 0.46, `c` 0.96, `y` 0.98 bits (locked units) vs `o` 3.07, `^`(word start) 3.20 (free hubs).

## 8. Glyph Inheritance Graph

Justified by transition statistics (§7), not visual intuition:

```
GALLOWS base        {k t p f}
  └─ PLATFORMED     {ckh cth cph cfh}   = bench ∘ gallows ligature
BENCH base          ch
  └─ PLUMED         sh                  = ch + plume diacritic
E-SERIES            e → ee → eee        (run-length morpheme)
I-SERIES            i → ii → iii        (run-length morpheme, must close
                                         with terminal n/r/l/m)
CLITIC              q                   (word-initial only, binds to o)
TERMINALS           y n m g r l s d     (right-edge class)
```

Verdict per variant: `ckh/cth/cph/cfh` behave as **ligatures** (position = bench, composition = gallows); `sh` as **modifier variant** of `ch`; e/i runs as **iterated modifiers**; `q` as **prefix particle**, not stem material.

## 9. Morphological Grammar (Phase 5)

Empirical proof of slot structure: mean normalized position of every unit is monotone and tightly ordered —
`q` .004 → `sh` .138 → `ch` .214 → `cth` .257 → `t` .307 → `o` .313 → `k` .350 → `a` .468 → `e` .476 → `d` .502 → `ee` .554 → `ii` .695 → `l` .688 → `r` .847 → `y` .875 → `m` .968 → `n` .987.

```
Word ::= Q? PRE{0..2} CORE{0..5} FIN{0..4}

Q    ::= 'q'
PRE  ::= d | s | y | o | a | l | r | ch | sh | GALLOWS
CORE ::= e | ee | eee | o | a | ch | sh | d | l | GALLOWS
FIN  ::= i | ii | iii | n | r | l | m | s | d | y | o | a | g | e | ee
GALLOWS ::= k | t | p | f | ckh | cth | cph | cfh
```

Coverage: **96.65% of tokens, 85.5% of types**; no failing type with frequency ≥ 20.

## 10. Grammar Class (Phase 6)

MDL model comparison (model bits + data bits, per token):

| Model | bits/token | model params |
|---|---|---|
| unigram units | 21.05 | 37 |
| **bigram automaton (regular)** | **12.86** | 594 |
| trigram | 13.88 | 3,378 |

The order-1 regular model is MDL-optimal; trigram context does not pay for itself. **The word language is Regular** — strictly a small sub-regular (star-free, slot-ordered) family. It is LL(1)/LR(0)-trivial and PEG-compatible; deterministic as a DFA.

Supra-word level: class-bigram MI = 0.110 bits (shuffled baseline 0.014). Non-zero but an order of magnitude below word-internal structure. Strongest rule: **P(next word begins q | current ends y) = 0.281** vs 0.065–0.107 otherwise. There is no evidence of phrase-level constituency; sentence-level grammar is at most a weak Markov process over word classes.

## 11. Parser Specification (Phase 7)

Deterministic finite automaton over 30 glyph units; 267 edges after pruning (count ≥ 15) cover **96.9% of tokens** / 87.3% of types.

FIRST set (word-initial distribution): `o` .225, `ch` .159, `q` .143, `d` .093, `sh` .084, `a` .055, `y` .049, `l` .039, `s` .034, `k` .034 …
LAST set (word-final): `y` .404, `n` .159, `l` .155, `r` .153, `s` .036, `o` .035, `m` .026 …
FOLLOW(Word) at line level: unconstrained except q-conditioning (§10).

**Generative precision: 75.3%** of 2,000 strings sampled from the automaton are attested word types. The automaton is simultaneously a recognizer and a near-exhaustive generator of the lexicon: **the lexicon ≈ the language.**

## 12. AST Specification (Phase 8)

```
Document
 └── Section (illustration-typed)
      └── Entry (page; attrs: quire, hand, register A/B)
           ├── Block*            ; paragraph
           │    └── Line+        ; attrs: is-terminal
           │         └── Word+   ; attrs: units[], slots{Q,PRE,CORE,FIN}
           └── LabelSet*
                └── Word
```
Sample instance: `build/ast_f1r.json` (full parse of folio 1r).

## 13. Ambiguity Report

- Glyph-unit segmentation: deterministic under longest-match (bench/platform ligatures never conflict because `h` is never initial and `c→h` is near-obligatory).
- The DFA recognizer is deterministic — zero conflicts.
- The slot grammar *written as a CFG* is massively ambiguous (6,465 types admit multiple slot assignments, e.g. `shol` = PRE:sh+o FIN:l vs PRE:sh CORE:o+l) because slot alphabets overlap. The **language** is unambiguous (regular); the **CFG presentation** is not. Recommended canonical form: the DFA, with slots as a human-readable view using leftmost-longest assignment.

## 14. Validation Report (Phase 9)

Cross-section transfer (automaton trained on row, token coverage on column):

| train\test | herbal | stars | bio | pharma | text |
|---|---|---|---|---|---|
| herbal | — | .936 | .957 | .922 | .942 |
| stars-recipes | .887 | — | .956 | .911 | .935 |
| biological | .792 | .862 | — | .780 | .863 |
| pharmaceutical* | .685 | .631 | .571 | — | .655 |
| text-only* | .721 | .806 | .852 | .713 | — |

*small training sets (≤2.6k tokens) undertrain; as test sets they are covered at 0.91+.

Register transfer: A-trained covers **92.3%** of B; B-trained covers **94.2%** of A. One morphology governs the entire manuscript across sections, hands, and registers.

## 15. Production Confidence

169 productions with count ≥ 50, each scored by frequency and cross-section stability (present with n≥5 in k/6 sections). Full table: `reports/productions.json`. Top rules all at confidence ≥ 0.93:
`y→$` (13,846; p=.862) · `^→o` (6,973; p=.205) · `d→y` (6,404; p=.541) · `n→$` (5,632; p=.973) · `o→k` (5,543; p=.249) · `^→ch` (5,490) · `q→o` (5,207; p=.977) · `ii→n` (3,850; p=.950) · `a→ii` (3,839) · `ch→e` (3,985; p=.394) …

---

## Engineering Verdict

If this were a recovered source tree, the spec review would read:

1. **The Word is the statement.** Nearly all structure lives *inside* the token: a rigid, regular, slot-ordered template (`Q? PRE CORE FIN`). Word-internal transitions carry ~4 bits/unit of constraint; word-to-word order carries ~0.1 bit.
2. **The lexicon is an enumeration, not a vocabulary.** 75% of random walks through the grammar are attested words; frequent types form one edit-distance-1 cluster. The "dictionary" is close to *all short legal strings* of the grammar — like an opcode space, not like a natural lexicon.
3. **Layout is syntax.** Block-start ascender marker (92%), short terminal lines, line-final descender bias, label = single Word. The document AST was recoverable without reading a single glyph.
4. **Two registers, one language.** Currier A/B are disjoint regions of the same word-space under the same grammar — two programs linked against different subsets of the same instruction set.
5. **Language class: Regular** (sub-regular, star-free). LL(1)-parseable; a complete parser is specified by 267 weighted edges.

What this profile is structurally *inconsistent* with (stated as constraint, not theory): a lexicon this dense-in-its-own-grammar-space, with near-zero supra-word syntax, Zipfian frequencies, and 274 adjacent exact repetitions, does not match the statistical shape of natural-language lexica or of simple substitution of a natural language (which preserves lexical sparsity and word-order information). Any future semantic hypothesis must reproduce: (a) regular slot morphology, (b) lexicon≈language density, (c) weak Markov word order with q|y coupling, (d) layout-level BEGIN/END marking, (e) the A/B register split under one grammar.
