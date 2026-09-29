#!/usr/bin/env node
/**
 * audit-scope — the deterministic half of `/abet-audit-pr` Phase 0, as code.
 *
 *   node audit-scope.mjs [--base develop] [--depth auto|lite|deep]
 *
 * Prints one JSON object: what changed, which packages, whether the openspec change is
 * complete, and — the part that matters for cost — which audit shape to run. Everything
 * here is `git`, `grep`-style counting and arithmetic; asking a model to do it costs
 * tokens on every run and gets a different answer some of the time.
 *
 * Depth is a function of risk, not of the user's plan: a small, low-risk diff is audited
 * in one pass, a large or sensitive one fans out. `--depth lite|deep` overrides the choice.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { addedLines } from './lib/diff.mjs';
import { scanSecurity } from './lib/security.mjs';
import { findClones, isCloneCandidate } from './lib/clones.mjs';
import { scanDiff } from '../hooks/lib/secrets.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const BASE = flag('base', 'develop');
const REQUESTED = flag('depth', 'auto');

/** Above either bound the diff is too big to hold in one pass with any care. */
export const LIMITS = { lines: 400, files: 15 };

/** Paths where a miss costs the most: data, access, deploy, dependencies, the API contract. */
export const RISKY = [
  { re: /(^|\/)migrations\//, why: 'database migration' },
  { re: /(^|\/)(auth|guards?|strategies)\//, why: 'authentication / authorisation' },
  { re: /\.sql\.ts$/, why: 'raw SQL' },
  { re: /(^|\/)(docker|\.github)\//, why: 'deploy / CI' },
  { re: /(^|\/)(package\.json|pnpm-lock\.yaml|Dockerfile)$/, why: 'dependencies / image' },
  { re: /(^|\/)\.env/, why: 'environment config' },
];

const git = (args) => {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (e) {
    return null;
  }
};

/**
 * What counts toward "is this diff too big to hold in one pass": source code that is not a
 * test. Design docs under `openspec/`, markdown, lockfiles and the generated `openapi.json`
 * are read in seconds and would push every ordinary feature over the line — the spec is
 * regenerated on *every* API change by policy, so it says nothing about risk. Tests are
 * skipped for the same reason: they are read alongside the code they cover.
 */
const NOT_SIZE = /(^|\/)(openspec|docs)\/|\.md$|(^|\/)openapi\.json$|(^|\/)pnpm-lock\.yaml$|\.(spec|test)\.[jt]sx?$/;

/** From `git diff --numstat`: code lines and files (for the depth decision) and the raw total. */
export function measure(numstat) {
  let lines = 0, files = 0, totalLines = 0;
  for (const row of numstat.split('\n').filter(Boolean)) {
    const [a, d, ...rest] = row.split('\t');
    const n = (parseInt(a, 10) || 0) + (parseInt(d, 10) || 0); // binary files show '-'
    totalLines += n;
    if (!NOT_SIZE.test(rest.join('\t'))) {
      lines += n;
      files++;
    }
  }
  return { lines, files, totalLines };
}

/** Pure: choose the audit shape from measurements. Exported for the tests. */
export function chooseDepth({ requested = 'auto', lines, files, packages, risky }) {
  if (requested === 'lite' || requested === 'deep') return { depth: requested, reasons: [`requested: ${requested}`] };
  const reasons = [];
  if (lines > LIMITS.lines) reasons.push(`${lines} changed lines (> ${LIMITS.lines})`);
  if (files > LIMITS.files) reasons.push(`${files} files (> ${LIMITS.files})`);
  if (packages.length > 1) reasons.push('touches both packages');
  for (const r of risky) reasons.push(`touches ${r.why}: ${r.file}`);
  return reasons.length > 0
    ? { depth: 'deep', reasons }
    : { depth: 'lite', reasons: [`${lines} changed lines in ${files} file(s), no sensitive paths`] };
}

/** Pure: package label for a root-relative path. */
export const packageOf = (path) => (/^(backend|frontend)\//.exec(path)?.[1] ?? 'root');

/**
 * Terms the diff newly relies on — third-party imports and env vars — whose mention in a
 * CONTEXT.md may have just gone stale. `@aws-sdk/client-s3` yields itself and `s3`.
 */
export function newTerms(addedLines) {
  const terms = new Set();
  for (const line of addedLines) {
    const imp = /from\s+['"]([^'"]+)['"]/.exec(line);
    if (imp && !/^[./]/.test(imp[1]) && !imp[1].startsWith('src/')) {
      terms.add(imp[1]);
      const last = imp[1].split('/').pop().replace(/^client-/, '');
      if (last.length >= 2) terms.add(last);
    }
    for (const m of line.matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g)) terms.add(m[1]);
  }
  return [...terms];
}

const escapeRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Lines of the given docs that mention any term. A term found on more than `maxPerTerm`
 * lines is generic (`typeorm`, `nestjs`) and says nothing about this diff, so it is dropped.
 * One entry per doc line, listing every term that matched it.
 */
export function findDocHits(terms, docs, { maxPerTerm = 6 } = {}) {
  const byLine = new Map();
  for (const term of terms) {
    const re = new RegExp(`(^|[^\\w])${escapeRe(term)}([^\\w]|$)`, 'i');
    const found = [];
    for (const { file, text } of docs) {
      text.split('\n').forEach((l, i) => { if (re.test(l)) found.push({ file, line: i + 1, text: l.trim().slice(0, 240) }); });
    }
    if (found.length === 0 || found.length > maxPerTerm) continue;
    for (const f of found) {
      const key = `${f.file}:${f.line}`;
      const hit = byLine.get(key) ?? { ...f, terms: [] };
      hit.terms.push(term);
      byLine.set(key, hit);
    }
  }
  return [...byLine.values()];
}

/** Open `- [ ]` and done `- [x]` counts across a change's tasks files. */
export function countTasks(dir) {
  let open = 0, done = 0;
  for (const f of readdirSync(dir).filter((n) => /^tasks.*\.md$/.test(n))) {
    for (const line of readFileSync(join(dir, f), 'utf8').split('\n')) {
      if (/^\s*- \[ \]/.test(line)) open++;
      else if (/^\s*- \[[xX]\]/.test(line)) done++;
    }
  }
  return { open, done };
}

/**
 * The `##` headings of a rules file, skipping any inside a code fence. They are the
 * checklist an audit answers one line at a time: a model cannot say PASS/FAIL/N/A for a
 * section it never opened, which "read the whole file" alone cannot guarantee.
 */
export function headingsOf(text) {
  const out = [];
  let fenced = false;
  for (const line of text.split('\n')) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    else if (!fenced && /^## /.test(line)) out.push(line.slice(3).trim());
  }
  return out;
}

/** Added lines of a unified diff, grouped by the file they were added to. */
export function addedByFile(diff) {
  const out = new Map();
  let file = null;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) {
      const target = line.slice(4).replace(/^b\//, '');
      file = target === '/dev/null' ? null : target;
    } else if (file && line.startsWith('+')) {
      if (!out.has(file)) out.set(file, []);
      out.get(file).push(line);
    }
  }
  return out;
}

/** Names exported by the added lines (`export function|class|const|enum|type|interface X`). */
export function exportedNames(addedLines) {
  const names = new Set();
  for (const l of addedLines) {
    const m = /^\+\s*export\s+(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:function\*?|class|const|let|enum|interface|type)\s+([A-Za-z_$][\w$]*)/.exec(l);
    if (m) names.add(m[1]);
  }
  return [...names];
}

/** Files that are referenced by tooling, not by imports — never reported as dead. */
const NOT_A_CANDIDATE = /(\.spec\.[jt]sx?$|\.d\.ts$|(^|\/)migrations\/|(^|\/)main\.ts$)/;

/**
 * Dead-code candidates among what the diff adds: a new file no other source file imports,
 * or a new export nothing else references. Tests do not count as a use — code that only a
 * test calls is dead in production.
 *
 * `usedElsewhere(term, file)` reports whether any non-test source other than `file`
 * mentions `term`; it is injected so this stays testable without a repository.
 */
export function findDeadCode({ addedFiles, added, usedElsewhere, max = 40 }) {
  const out = [];
  let checked = 0;
  for (const [file, lines] of added) {
    if (!/\.[jt]sx?$/.test(file) || NOT_A_CANDIDATE.test(file)) continue;
    if (addedFiles.has(file) && checked++ < max) {
      const base = file.split('/').pop().replace(/\.[jt]sx?$/, '');
      if (!usedElsewhere(base, file)) {
        out.push({ file, why: 'new file that no other source file imports' });
        continue; // its exports are dead with it
      }
    }
    for (const name of exportedNames(lines)) {
      if (checked++ >= max) break;
      if (!usedElsewhere(name, file)) out.push({ file, name, why: 'new export that nothing else references' });
    }
  }
  return out;
}

function main() {
  const range = `origin/${BASE}...HEAD`;
  const names = git(['diff', '--name-only', range]);
  if (names === null) {
    console.log(JSON.stringify({ error: `cannot diff against origin/${BASE} — run \`git fetch origin ${BASE}\` first` }));
    process.exit(0);
  }
  const files = names.split('\n').filter(Boolean);
  if (files.length === 0) {
    console.log(JSON.stringify({ empty: true, note: 'the diff is empty — nothing to audit' }));
    return;
  }

  const size = measure(git(['diff', '--numstat', range]) ?? '');
  const lines = size.lines;
  const packages = [...new Set(files.map(packageOf))].filter((p) => p !== 'root');
  const risky = files.flatMap((file) => RISKY.filter((r) => r.re.test(file)).map((r) => ({ file, why: r.why })));

  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']) ?? '';
  const slug = branch.includes('/') ? branch.slice(branch.indexOf('/') + 1) : null;
  const changeDir = slug ? join('openspec', 'changes', slug) : null;
  const change = changeDir && existsSync(changeDir)
    ? { slug, path: `openspec/changes/${slug}`, ...countTasks(changeDir) }
    : { slug, path: null };

  // Docs the diff may have made false: CONTEXT.md is up to ~100KB, so look up instead of read.
  const addedMap = addedByFile(git(['diff', '-U0', range, '--', '*.ts', '*.tsx', '*.js', '*.mjs']) ?? '');
  const added = [...addedMap.values()].flat();
  const contextFiles = ['docs/CONTEXT.md', ...packages.map((p) => `${p}/docs/CONTEXT.md`)].filter((f) => existsSync(f));
  const docsHits = findDocHits(newTerms(added), contextFiles.map((file) => ({ file, text: readFileSync(file, 'utf8') }))).slice(0, 20);

  // The rules an audit is held to. POLICIES.md is the team's conventions (the backend's runs
  // to ~600 lines), so it is read in full; `headings` is what makes that checkable.
  const rules = ['docs/POLICIES.md', ...packages.map((p) => `${p}/docs/POLICIES.md`)]
    .filter((f) => existsSync(f))
    .map((file) => {
      const text = readFileSync(file, 'utf8');
      return { file, lines: text.split('\n').length, headings: headingsOf(text) };
    });

  // No dead code: anything the diff adds that nothing uses.
  const addedFiles = new Set((git(['diff', '--name-only', '--diff-filter=A', range]) ?? '').split('\n').filter(Boolean));
  const usedElsewhere = (term, file) => Boolean(
    git(['grep', '-l', '-w', '-F', '-e', term, '--', '*.ts', '*.tsx', '*.js', '*.mjs', ':!*.spec.*', `:!${file}`]),
  );
  const deadCode = findDeadCode({ addedFiles, added: addedMap, usedElsewhere });

  // Security and reuse: facts a model would otherwise have to notice on its own.
  const fullDiff = git(['diff', '-U0', range, '--', '.', ':!pnpm-lock.yaml', ':!*openapi.json']) ?? '';
  const numbered = addedLines(fullDiff);
  const readFile = (f) => (existsSync(f) ? readFileSync(f, 'utf8') : null);
  const security = {
    hits: scanSecurity({ added: numbered, readFile }).slice(0, 40),
    // file, line and rule only: the scanner's preview is the raw line, secret included
    secrets: scanDiff(fullDiff).map(({ file, line, rule }) => ({ file, line, rule })),
    newDependencies: [...numbered].filter(([f]) => /(^|\/)package\.json$/.test(f))
      .flatMap(([f, ls]) => ls.map((l) => /"([@\w./-]+)":\s*"[\^~><=]*\d[^"]*"/.exec(l.text)?.[1]).filter((n) => n && n !== 'version').map((n) => ({ file: f, name: n }))),
  };
  const targets = [...numbered].filter(([f]) => isCloneCandidate(f) && existsSync(f))
    .map(([file, ls]) => ({ file, text: readFileSync(file, 'utf8'), addedNums: new Set(ls.map((l) => l.n)) }));
  const corpus = targets.length === 0 ? [] : (git(['ls-files', '--', '*.ts', '*.tsx', '*.js', '*.mjs']) ?? '').split('\n')
    .filter((f) => f && isCloneCandidate(f) && existsSync(f))
    .map((file) => ({ file, text: readFileSync(file, 'utf8') }))
    .filter((c) => c.text.length < 300_000);
  const clones = findClones({ targets, corpus });
  const reuse = {
    // a third copy is the trigger to extract; a second is tolerated but the next one must not be
    extract: clones.filter((c) => c.verdict === 'extract').slice(0, 10),
    tolerated: clones.filter((c) => c.verdict === 'tolerated').slice(0, 5),
    templatesSkipped: clones.filter((c) => c.verdict === 'template').length,
  };

  // A route/DTO change with an untouched spec is the frontend's silent breakage.
  const apiSurface = files.some((f) => /^backend\/.*\.(controller|dtos|swagger)\.ts$/.test(f));
  const specTouched = files.includes('backend/openapi.json');

  console.log(JSON.stringify({
    base: BASE,
    branch,
    files,
    stats: { files: files.length, lines: size.totalLines, codeFiles: size.files, codeLines: size.lines },
    packages,
    change,
    rules,
    docsHits,
    deadCode,
    security,
    reuse,
    blockers: [
      ...(change.path && change.open > 0 ? [`${change.open} open task(s) in ${change.path}`] : []),
      ...(change.path && change.open === 0 && change.done === 0 ? [`${change.path} has no task checkboxes at all`] : []),
      ...(apiSurface && !specTouched ? ['backend routes/DTOs changed but backend/openapi.json was not regenerated'] : []),
    ],
    ...chooseDepth({ requested: REQUESTED, lines, files: size.files, packages, risky }),
  }, null, 2));
}

// Run only as a CLI, so the tests can import the pure functions without side effects.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
