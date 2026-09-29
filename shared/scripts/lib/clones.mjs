/**
 * Duplicate-code detection for what a diff adds, measured against the whole repository.
 *
 * The rule the team wants applied: two copies are tolerated, a third is the trigger to
 * extract a shared function / service / repository method / component. A model asked "is
 * this duplicated?" answers from whatever it happened to open; this counts. It reports how
 * many copies exist *including the new one* and where they are, so the auditor argues from
 * evidence instead of "it's only used in one other place".
 *
 * Method: strip comments and noise lines, take every window of W consecutive significant
 * lines, and look for the same window elsewhere. Two flavours:
 *   exact    — identical after whitespace/comment normalisation
 *   renamed  — identical once identifiers, strings and numbers are masked (a copy with
 *              variables renamed), over a longer window to keep noise down
 * Adjacent matching windows merge into one block, and blocks are clustered per new region.
 *
 * Declarative boilerplate (DTOs, entities, Swagger decorators, route and string constants,
 * Nest modules) repeats by design and is left out on both sides, as are tests and migrations.
 */

export const W_EXACT = 8;
export const W_RENAMED = 10;
const MIN_CHARS_EXACT = 160;
const MIN_CHARS_RENAMED = 220;

/** Not compared, either as the new code or as the thing it might copy. */
export const NOT_COMPARED = new RegExp([
  '\\.(spec|test)\\.[jt]sx?$',
  '\\.d\\.ts$',
  '(^|/)migrations/',
  '\\.(swagger|dtos?|entity|routes|strings|labels|constants|types|module)\\.[jt]sx?$',
  '(^|/)config/strings/',
  '(^|/)(node_modules|dist|build|coverage|out|\\.next)/',
  '(^|/)(openapi\\.json|pnpm-lock\\.yaml)$',
].join('|'));

export const isCloneCandidate = (file) => /\.[jt]sx?$/.test(file) && !NOT_COMPARED.test(file);

const KEYWORDS = new Set(('if else for while do return const let var function async await new throw try catch finally switch case ' +
  'break continue class extends implements import export default typeof instanceof of in this null undefined true false void ' +
  'yield static private public protected readonly interface type enum').split(' '));

const maskLine = (norm) => norm
  .replace(/(['"`])(?:\\.|(?!\1).)*\1/g, 'S')
  .replace(/\b\d+(?:\.\d+)?\b/g, 'N')
  .replace(/\b[A-Za-z_$][\w$]*\b/g, (id) => (KEYWORDS.has(id) ? id : '_'));

const NOISE = /^[\]})\{;,\s]*$/;
/** `name?: Type;` — ends in `;` where an object-literal property (`code: x.code,`) ends in `,`. */
const MEMBER_DECLARATION = /^(readonly\s+)?[\w$]+\??:\s*[^=(){}]+;$/;

/**
 * A block found in more places than this is a convention the team standardised (every
 * module's `validateCreate` skeleton), not a reuse someone missed: extracting it would be
 * a codebase-wide refactor, not something to hold a PR for.
 */
export const TEMPLATE_COPIES = 12;

/** `backend` / `frontend`: code in different packages cannot share an extraction. */
const packageOf = (file) => /^(backend|frontend)\//.exec(file)?.[1] ?? null;

/** Comment-free, noise-free lines of a file: `{ n, norm, mask }`, `n` being the source line. */
export function significantLines(text) {
  const out = [];
  let inBlock = false;
  let inList = false; // inside a multi-line `import { … } from` / `export { … } from`
  text.split('\n').forEach((raw, idx) => {
    let line = raw;
    if (inBlock) {
      const end = line.indexOf('*/');
      if (end < 0) return;
      line = line.slice(end + 2);
      inBlock = false;
    }
    line = line.replace(/\/\*.*?\*\//g, '');
    const open = line.indexOf('/*');
    if (open >= 0) {
      line = line.slice(0, open);
      inBlock = true;
    }
    line = line.replace(/(^|\s)\/\/[^'"`]*$/, '').trim();
    if (inList) {
      if (/\bfrom\s+['"]/.test(line) || /^\}\s*;?$/.test(line)) inList = false;
      return;
    }
    if (/^(import|export)\s*(type\s*)?\{[^}]*$/.test(line)) { // opens a list that closes on a later line
      inList = true;
      return;
    }
    if (NOISE.test(line) || /^import\b/.test(line) || /^export\s+(\*|\{)[^;]*\bfrom\b/.test(line) || line.startsWith('@')) return;
    if (MEMBER_DECLARATION.test(line)) return; // `firstName: string;` — an interface member, not logic
    const norm = line.replace(/\s+/g, ' ').replace(/[;,]$/, '');
    out.push({ n: idx + 1, norm, mask: maskLine(norm) });
  });
  return out;
}

const sizeOf = (lines, i, w) => lines.slice(i, i + w).reduce((n, l) => n + l.norm.length, 0);

/** Windows of a file as `{ i, key }` for the given flavour. */
function* windows(lines, w, field, minChars) {
  for (let i = 0; i + w <= lines.length; i++) {
    if (sizeOf(lines, i, w) < minChars) continue;
    yield { i, key: lines.slice(i, i + w).map((l) => l[field]).join('\n') };
  }
}

/**
 * Find copies of the added code.
 *   targets: [{ file, text, addedNums:Set<number> }]  the changed files and which lines are new
 *   corpus:  [{ file, text }]                          every file to compare against
 */
export function findClones({ targets, corpus }) {
  const flavours = [
    { kind: 'exact', w: W_EXACT, field: 'norm', min: MIN_CHARS_EXACT, index: new Map() },
    { kind: 'renamed', w: W_RENAMED, field: 'mask', min: MIN_CHARS_RENAMED, index: new Map() },
  ];
  const tLines = new Map();

  for (const t of targets) {
    if (!isCloneCandidate(t.file)) continue;
    const lines = significantLines(t.text);
    tLines.set(t.file, lines);
    for (const f of flavours) {
      for (const { i, key } of windows(lines, f.w, f.field, f.min)) {
        // Only a window that is mostly new code is the diff's copy. One added line beside
        // existing scaffolding (an import, an interface) does not make that scaffolding new.
        if (lines.slice(i, i + f.w).filter((l) => t.addedNums.has(l.n)).length < Math.ceil(f.w / 2)) continue;
        if (!f.index.has(key)) f.index.set(key, []);
        f.index.get(key).push({ file: t.file, i });
      }
    }
  }
  if (tLines.size === 0) return [];

  // matches: every (new window, other window) pair with the same key
  const matches = [];
  for (const c of corpus) {
    if (!isCloneCandidate(c.file)) continue;
    const cl = significantLines(c.text);
    for (const f of flavours) {
      for (const { i, key } of windows(cl, f.w, f.field, f.min)) {
        for (const hit of f.index.get(key) ?? []) {
          const tl = tLines.get(hit.file);
          const tStart = tl[hit.i].n, tEnd = tl[hit.i + f.w - 1].n;
          const cStart = cl[i].n, cEnd = cl[i + f.w - 1].n;
          if (c.file === hit.file && cStart <= tEnd && tStart <= cEnd) continue; // itself
          if (packageOf(c.file) !== packageOf(hit.file)) continue; // cannot be shared across packages
          matches.push({ tfile: hit.file, tStart, tEnd, cfile: c.file, cStart, cEnd, kind: f.kind });
        }
      }
    }
  }

  // merge sliding windows into blocks, per (new file, other file)
  const blocks = [];
  const groups = new Map();
  for (const m of matches) {
    const k = `${m.tfile}\u0000${m.cfile}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(m);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => a.tStart - b.tStart || a.cStart - b.cStart);
    let cur = null;
    for (const m of list) {
      if (cur && m.tStart <= cur.tEnd && m.cStart >= cur.cStart && m.cStart <= cur.cEnd + 1) {
        cur.tEnd = Math.max(cur.tEnd, m.tEnd);
        cur.cEnd = Math.max(cur.cEnd, m.cEnd);
        if (m.kind === 'exact') cur.kind = 'exact';
      } else {
        if (cur) blocks.push(cur);
        cur = { ...m };
      }
    }
    if (cur) blocks.push(cur);
  }

  // cluster blocks that cover the same new region into one finding
  const findings = [];
  const byFile = new Map();
  for (const b of blocks) {
    if (!byFile.has(b.tfile)) byFile.set(b.tfile, []);
    byFile.get(b.tfile).push(b);
  }
  for (const [file, list] of byFile) {
    list.sort((a, b) => a.tStart - b.tStart);
    let cluster = null;
    const flush = () => {
      if (!cluster) return;
      const locs = new Map([[`${file}:${cluster.tStart}`, { file, start: cluster.tStart, end: cluster.tEnd }]]);
      for (const b of cluster.blocks) locs.set(`${b.cfile}:${b.cStart}`, { file: b.cfile, start: b.cStart, end: b.cEnd });
      findings.push({
        file, start: cluster.tStart, end: cluster.tEnd,
        kind: cluster.blocks.some((b) => b.kind === 'exact') ? 'exact' : 'renamed',
        copies: locs.size,
        locations: [...locs.values()],
      });
    };
    for (const b of list) {
      if (cluster && b.tStart <= cluster.tEnd) {
        cluster.tEnd = Math.max(cluster.tEnd, b.tEnd);
        cluster.blocks.push(b);
      } else {
        flush();
        cluster = { tStart: b.tStart, tEnd: b.tEnd, blocks: [b] };
      }
    }
    flush();
  }

  // a copy between two new files is reported from both sides; keep one
  const seen = new Set();
  return findings
    .map((f) => ({ ...f, verdict: f.copies > TEMPLATE_COPIES ? 'template' : f.copies >= 3 ? 'extract' : 'tolerated' }))
    .filter((f) => {
      const key = f.locations.map((l) => `${l.file}:${l.start}`).sort().join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.copies - a.copies || (b.end - b.start) - (a.end - a.start));
}
