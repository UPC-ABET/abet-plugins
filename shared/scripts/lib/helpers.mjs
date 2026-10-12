/**
 * Reuse checks that work by name, not by shape: the diff declares something the repository
 * already has.
 *
 * `clones.mjs` finds copied blocks of 8+ lines. The audit ledger kept recording the copies it
 * cannot see because they are short: a re-declared `groupBy`, a local `SelectOption` type, a
 * second `import('archiver')` wrapper, a db-spec seeding rows with its own `insertSchool`
 * instead of `test/db/fixtures.ts`, a `'TG404-T001'` literal beside `TYPE_CODES`, another
 * recursive climb of `organization.charts`, another `lock_timeout` transaction wrapper (18+
 * findings in 9 changes, all judgment until now). Each rule here is one of those shapes.
 *
 * Every rule needs the existing helper to exist in the repository, so in a repo without it the
 * rule stays silent rather than guessing. A hit is a candidate: the auditor confirms it is the
 * same intent, not a coincidental name.
 */

const TEST = /[.-](spec|test)\.[jt]sx?$/;
const DB_SPEC = /\.db-spec\.[jt]s$/;
const FIXTURES = /(^|\/)test\/db\/fixtures\.[jt]s$/;
const packageOf = (file) => /^(backend|frontend)\//.exec(file)?.[1] ?? 'root';

const EXPORT_DECL = /^export\s+(?:declare\s+)?(?:default\s+)?(?:abstract\s+)?(?:async\s+)?(?:function\*?|const|let|var|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/gm;
const TOP_LEVEL_DECL = /^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?(?:async\s+)?(?:function\*?|const|let|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/;
const FUNCTION_DECL = /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/;
const DYNAMIC_IMPORT = /\bimport\(\s*['"]([^./'"][^'"]*)['"]\s*\)/g;
const LOCK_TIMEOUT = /set_config\(\s*'lock_timeout'/;
const RUNTIME_LOGIC = /\.(sql|repository|functions|service|validation|controller|calc|mapper|builder|cache|http|policy|job)\.ts$/;
const TX_OVERRIDE =/^\s*(?:(?:public|protected|private|override|async)\s+)*runInTransaction\s*[<(]/;

/**
 * Names short or conventional enough to be declared in many files on purpose: Next.js route
 * and page exports, migration hooks, component prop types.
 */
const CONVENTIONAL = new Set(['metadata', 'generateMetadata', 'generateStaticParams', 'dynamic', 'revalidate', 'runtime',
  'middleware', 'config', 'handler', 'default', 'Layout', 'Loading', 'NotFound']);
const conventional = (name) => name.length < 6 || CONVENTIONAL.has(name) || /Props$/.test(name);

/**
 * What the repository already has, from every source file: `{ file, text }[]`.
 *   exports          name → files that export a top-level declaration of it (tests excluded)
 *   fixtures         names exported by test/db/fixtures
 *   dbSpecFunctions  function name → db-spec files declaring it
 *   dynamicImports   package → files that import() it (tests excluded)
 *   lockTimeout      files that set lock_timeout themselves (tests excluded)
 *   txOverrides      files that declare runInTransaction (tests excluded)
 */
export function buildIndex(files) {
  const index = { exports: new Map(), fixtures: new Set(), dbSpecFunctions: new Map(), dynamicImports: new Map(),
    lockTimeout: new Set(), txOverrides: new Set() };
  const add = (map, key, file) => (map.get(key) ?? map.set(key, new Set()).get(key)).add(file);
  for (const { file, text } of files) {
    if (FIXTURES.test(file)) for (const m of text.matchAll(EXPORT_DECL)) index.fixtures.add(m[1]);
    if (DB_SPEC.test(file)) {
      for (const line of text.split('\n')) {
        const f = FUNCTION_DECL.exec(line);
        if (f) add(index.dbSpecFunctions, f[1], file);
      }
    }
    if (TEST.test(file) || FIXTURES.test(file)) continue;
    for (const m of text.matchAll(EXPORT_DECL)) add(index.exports, m[1], file);
    for (const m of text.matchAll(DYNAMIC_IMPORT)) add(index.dynamicImports, m[1], file);
    if (LOCK_TIMEOUT.test(text)) index.lockTimeout.add(file);
    if (text.split('\n').some((l) => TX_OVERRIDE.test(l))) index.txOverrides.add(file);
  }
  return index;
}

/** Files in `set` other than `file` and in the same package (code cannot be shared across packages). */
const elsewhere = (set, file) => [...(set ?? [])].filter((f) => f !== file && packageOf(f) === packageOf(file)).sort();

/**
 * Run every rule over the diff's added lines.
 *   added:  Map<file, [{n, text}]>   (hooks/lib/diff.mjs → addedLines)
 *   index:  buildIndex() over the repository
 */
export function findHelperReuse({ added, index }) {
  const hits = [];
  const push = (file, n, rule, text, why, locations = []) =>
    hits.push({ rule, file, line: n, text: text.trim().slice(0, 160), why, ...(locations.length ? { locations: locations.slice(0, 5) } : {}) });
  const hasTypeCodes = index.exports.has('TYPE_CODES');
  const ancestryHelpers = [...index.exports.keys()].filter((n) => /^chartAncestry/.test(n)).flatMap((n) => [...index.exports.get(n)]);

  for (const [file, lines] of added) {
    if (!/\.[jt]sx?$/.test(file) || /\.d\.ts$/.test(file)) continue;

    if (DB_SPEC.test(file)) {
      for (const { n, text } of lines) {
        const f = FUNCTION_DECL.exec(text);
        // a builder named for what it builds (`insertSchool`), not a spec's own `seed()`
        if (f && /^(insert|seed|create|make|build|map)[A-Z]/.test(f[1])) {
          const others = elsewhere(index.dbSpecFunctions.get(f[1]), file);
          if (index.fixtures.has(f[1]) || others.length) {
            push(file, n, 'dbspec-local-fixture', text,
              `${f[1]} is ${index.fixtures.has(f[1]) ? 'already exported by test/db/fixtures' : `also declared in ${others.length} other db-spec(s)`}. A db-spec seeds through test/db/fixtures; add a missing builder there, never as a local function.`, others);
          }
        }
        if (/INSERT\s+INTO\s+organization\.(faculties|schools)\b/i.test(text) && index.fixtures.size) {
          push(file, n, 'dbspec-local-fixture', text, 'Raw INSERT into the organization tables inside a db-spec: seed schools and faculties through test/db/fixtures so every spec builds the same valid tree.');
        }
      }
      continue;
    }
    if (TEST.test(file) || FIXTURES.test(file)) continue;

    lines.forEach(({ n, text }, i) => {
      const d = TOP_LEVEL_DECL.exec(text);
      if (d && !conventional(d[1])) {
        const others = elsewhere(index.exports.get(d[1]), file);
        if (others.length) {
          push(file, n, 'redeclared-export', text,
            `${d[1]} is already exported by ${others[0]}${others.length > 1 ? ` and ${others.length - 1} more` : ''}. Import it instead of declaring another; if the two must differ, rename this one so they cannot be confused.`, others);
        }
      }
      for (const m of text.matchAll(DYNAMIC_IMPORT)) {
        const others = elsewhere(index.dynamicImports.get(m[1]), file);
        if (others.length) {
          push(file, n, 'duplicate-dynamic-import', text,
            `${others[0]} already wraps import('${m[1]}'). Use that wrapper instead of a second one with its own local types.`, others);
        }
      }
      // runtime query and logic only: migrations and seeds are frozen history, DTO and Swagger
      // files carry codes as documentation examples, and the constants file is the definition
      if (hasTypeCodes && RUNTIME_LOGIC.test(file) && /'TG\d{3}-T\d{3}'/.test(text)) {
        push(file, n, 'type-code-literal', text, 'A core.types code spelled as a literal. Use TYPE_CODES, so a renamed or retired code is one edit and a grep finds every use.');
      }
      if (/WITH\s+RECURSIVE/i.test(text) && ancestryHelpers.length && !ancestryHelpers.includes(file)
        && /organization\.charts/i.test(lines.slice(i, i + 15).map((l) => l.text).join('\n'))) {
        push(file, n, 'recursive-cte-outside-helper', text,
          `A recursive climb of organization.charts written again. ${ancestryHelpers[0]} owns that walk (and its depth bound); interpolate its fragment instead.`, ancestryHelpers);
      }
      if (LOCK_TIMEOUT.test(text)) {
        const others = elsewhere(index.lockTimeout, file);
        if (others.length) push(file, n, 'lock-timeout-wrapper', text, `${others[0]} already runs a transaction with lock_timeout. Call it instead of setting lock_timeout by hand.`, others);
      }
      if (TX_OVERRIDE.test(text)) {
        const others = elsewhere(index.txOverrides, file);
        if (others.length) push(file, n, 'lock-timeout-wrapper', text, `runInTransaction is already declared in ${others[0]}. Inherit or call it; an override drifts from the lock-timeout and retry behaviour the base one has.`, others);
      }
    });
  }
  return hits;
}
