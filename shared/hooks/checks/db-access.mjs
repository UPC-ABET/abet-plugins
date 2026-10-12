/**
 * Database access outside a repository.
 *
 * Backend POLICIES: "All database access lives in the repository". A service that injects
 * `DataSource`, a helper that calls `manager.query(...)`, a `.functions.ts` that opens its
 * own transaction — each is a second, untested path to the database that the repository's
 * scoping and locking never see. ACC-SYS's `survey/shared/core/derived-score.functions.ts`
 * is the case that made this a machine check.
 *
 * Only added lines are judged, so a legacy violation does not block every commit that
 * touches its file; adding a new one does. Three callers: the pre-commit gate (blocks), and
 * `audit-scope.mjs` for `/abet-audit-pr` and `/abet-review-pr` (reports a policy violation).
 */

const POLICY = 'backend POLICIES: "All database access lives in the repository"';

/**
 * Files where database access is the point: repositories, the generic transaction runner
 * in `commons/`, tests, migrations/seeds and tooling. Only backend `src/` TypeScript is
 * judged; the db-spec harness under `test/` is test code.
 */
export function isDbAccessExempt(path) {
  const norm = path.replace(/\\/g, '/');
  if (/(^|\/)frontend\//.test(norm) || !/\.ts$/.test(norm) || norm.endsWith('.d.ts')) return true;
  if (!/(^|\/)src\//.test(norm)) return true;
  if (/\.repository(\.interface)?\.ts$/.test(norm)) return true;
  if (/(^|\/)commons\/(.+\/)?[^/]+\.transaction\.ts$/.test(norm)) return true;
  if (/[.-](spec|db-spec|test)\.ts$/.test(norm)) return true;
  return /(^|\/)src\/(database|tools)\//.test(norm);
}

const DB_TYPES = /\b(DataSource|EntityManager|QueryRunner)\b/;
const CALLS = [
  { re: /\.query\s*\(/, what: '`.query(...)`' },
  { re: /\.createQueryBuilder\s*\(/, what: '`.createQueryBuilder(...)`' },
  { re: /\.getRepository\s*\(/, what: '`.getRepository(...)`' },
  { re: /\.transaction\s*\(/, what: '`.transaction(...)`' },
];

/**
 * Hits on the added lines of one file.
 *
 * `text` is the file's full content (multi-line imports are judged as one statement);
 * `addedNums` the 1-based numbers of the lines the change adds. Returns
 * `[{ line, rule, severity, text, why }]` where severity is `block` (a value import of a
 * TypeORM handle, or a query call) or `warn` (an `import type { EntityManager }`, which is
 * fine when the value is passed straight through to a repository call).
 */
export function findDbAccess({ file, text, addedNums }) {
  if (isDbAccessExempt(file)) return [];
  const lines = text.split('\n');
  const out = [];

  // imports from 'typeorm', possibly spanning lines
  const importRe = /import\s+(type\s+)?\{([^}]*)\}\s*from\s*['"]typeorm['"]/g;
  for (const m of text.matchAll(importRe)) {
    const start = text.slice(0, m.index).split('\n').length;
    const end = start + m[0].split('\n').length - 1;
    let touched = false;
    for (let n = start; n <= end; n++) if (addedNums.has(n)) touched = true;
    if (!touched) continue;
    const typeOnly = Boolean(m[1]);
    const names = m[2].split(',').map((s) => s.trim()).filter(Boolean);
    const valueHandles = names.filter((n) => !typeOnly && !n.startsWith('type ') && DB_TYPES.test(n));
    const typeHandles = names.filter((n) => (typeOnly || n.startsWith('type ')) && DB_TYPES.test(n));
    if (valueHandles.length > 0) {
      out.push({
        line: start, rule: 'db-handle-outside-repository', severity: 'block', text: lines[start - 1].trim(),
        why: `imports ${valueHandles.join(', ')} from typeorm outside a repository — ${POLICY}. ` +
          'Inject the module repository and add the method there. If it is only a parameter type passed ' +
          'straight through to a repository call (`manager?: EntityManager`), write `import type { EntityManager }`.',
      });
    } else if (typeHandles.length > 0) {
      out.push({
        line: start, rule: 'db-type-outside-repository', severity: 'warn', text: lines[start - 1].trim(),
        why: `imports the type ${typeHandles.join(', ')} outside a repository. Fine only when the value is passed ` +
          `straight through to a repository call; anything else is a query path outside the repository — ${POLICY}.`,
      });
    }
  }

  for (const n of addedNums) {
    const line = lines[n - 1];
    if (line == null || /^\s*(\/\/|\*|\/\*)/.test(line)) continue;
    for (const c of CALLS) {
      if (!c.re.test(line)) continue;
      out.push({
        line: n, rule: 'db-call-outside-repository', severity: 'block', text: line.trim(),
        why: `${c.what} outside a repository — ${POLICY}. Move the access into \`core/<module>.repository.ts\` ` +
          '(or run the write through the commons transaction runner from the repository).',
      });
      break;
    }
  }
  return out.sort((a, b) => a.line - b.line);
}

/** Every hit across a diff: `added` is `addedLines()`'s map, `readFile(path)` the content or null. */
export function scanDbAccess({ added, readFile }) {
  const out = [];
  for (const [file, lines] of added) {
    if (isDbAccessExempt(file)) continue;
    const text = readFile(file);
    if (text == null) continue;
    for (const h of findDbAccess({ file, text, addedNums: new Set(lines.map((l) => l.n)) })) out.push({ file, ...h });
  }
  return out;
}
