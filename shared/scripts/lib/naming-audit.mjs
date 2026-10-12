/**
 * The file-naming standard's audit half: what the pre-commit gate deliberately lets through.
 *
 * The gate checks only new paths, so a grandfathered `.functions.ts` can keep growing and a
 * new file can hold five roles under one honest-looking name. Neither blocks a commit; both
 * are findings an auditor should not have to notice on their own. Everything here is a
 * candidate — the role of an export is read from its name, which is a guess the auditor
 * confirms.
 */

/** Grandfathered kinds that must not grow. */
const LEGACY_KIND = /\.(functions|utils?|helpers?|transforms|common|misc)\.ts$/;
const LEGACY_MESSAGES = /(^|\/)config\/strings\/[^/]+\.(validation|strings)\.ts$/;

/** Role of an exported name, by the words it is built from. First match wins. */
const ROLES = [
  { kind: 'errors', re: /Error|Exception|^(translate|map)\w*Error|Violation/ },
  { kind: 'sql', re: /Sql|SQL|Cte|CTE|Fragment|Clause|Join[A-Z]|^(select|where)[A-Z]/ },
  { kind: 'cache', re: /[Cc]ache|Namespace/ },
  { kind: 'http', re: /Header|Cookie|Stream|Attachment|ContentDisposition|Download|^send[A-Z]|Response/ },
  { kind: 'crypto', re: /^(hash|encrypt|decrypt|sign|verify|digest)|Hash|Cipher|Hmac|Secret|Salt/ },
  { kind: 'builder', re: /^(build|render|generate|write)[A-Z]|Workbook|Sheet|Pdf|PDF|Html|HTML|Buffer|Zip|Token|Document|Report/ },
  { kind: 'mapper', re: /^(to|map|from|serialize|normalize)[A-Z]|Mapper|Dto$|ToDto|Shape/ },
  { kind: 'calc', re: /^(calc|calculate|compute|sum|avg|average|count|percent|round|score|weigh|rank|aggregate|derive|resolve|group)[A-Z]?|Score|Percent|Average|Total|Ratio|Weight|Band/ },
];

/** The kind an exported name most likely belongs in, or null when the name says nothing. */
export function roleOf(name) {
  return ROLES.find((r) => r.re.test(name))?.kind ?? null;
}

const EXPORT = /^\s*export\s+(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:function\*?|class|const|let|enum|interface|type)\s+([A-Za-z_$][\w$]*)/;
const exportsOf = (lines) => lines.map((l) => EXPORT.exec(l)?.[1]).filter(Boolean);

/** `a, b → calc; c → mapper` for a message, from exported names. */
function suggest(names) {
  const by = new Map();
  for (const n of names) {
    const k = roleOf(n) ?? 'mapper | calc | builder | sql | errors | cache | http | crypto';
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(n);
  }
  return [...by].map(([k, ns]) => `${ns.join(', ')} → \`${k}\``).join('; ');
}

/**
 * Findings over a diff.
 *   added:      Map<file, [{n, text}]>   (hooks/lib/diff.mjs → addedLines)
 *   newFiles:   Set of paths the diff adds or renames into
 *   readFile:   path → content | null
 * Returns `[{ file, rule, severity, names?, why }]`.
 */
export function auditNaming({ added, newFiles, readFile }) {
  const out = [];
  for (const [file, lines] of added) {
    const isNew = newFiles.has(file);
    const addedExports = exportsOf(lines.map((l) => l.text));

    if (!isNew && LEGACY_KIND.test(file) && addedExports.length > 0) {
      out.push({
        file, rule: 'legacy-kind-grew', severity: 'minor', names: addedExports,
        why: `legacy kind grew; move the touched symbols to their kind: ${suggest(addedExports)}.`,
      });
    }
    if (!isNew && LEGACY_MESSAGES.test(file) && lines.length > 0) {
      out.push({
        file, rule: 'legacy-kind-grew', severity: 'minor',
        why: 'legacy kind grew; i18n keys belong in `config/strings/<module>.messages.ts` — move the touched keys there.',
      });
    }

    const text = (isNew || addedExports.length > 0) ? readFile(file) : null;
    if (text == null) continue;

    // one role per file: a large new or grown file whose exports span several roles
    if (/\.tsx?$/.test(file) && text.split('\n').length > 300) {
      const names = exportsOf(text.split('\n'));
      const roles = [...new Set(names.map(roleOf).filter(Boolean))];
      if (roles.length > 1) {
        out.push({
          file, rule: 'mixed-roles', severity: 'suggestion', names,
          why: `${text.split('\n').length} lines whose exports fall into ${roles.join(', ')}: split by role (${suggest(names)}).`,
        });
      }
    }

    // frontend: shared/lib is infrastructure with side effects; pure functions go to shared/utils
    if (isNew && /(^|\/)frontend\/src\/shared\/lib\/[^/]+\.tsx?$/.test(file) && !/\/index\.tsx?$/.test(file) && !SIDE_EFFECT.test(text)) {
      out.push({
        file, rule: 'shared-lib-pure', severity: 'minor',
        why: 'no side effect found (no fetch, cookies, storage, logging, env, timers, Next.js server APIs): a pure ' +
          'function belongs in `shared/utils/<functionName>.ts`, one function per file. Confirm before reporting.',
      });
    }

    // frontend utils/: one pure function per file, named after the function
    if (/(^|\/)frontend\/src\/(.+\/)?utils\/[^/]+\.tsx?$/.test(file) && !/\/index\.tsx?$/.test(file)) {
      const fns = exportsOf(text.split('\n')).filter((n) => !/^[A-Z]/.test(n));
      if (fns.length > 1) {
        out.push({
          file, rule: 'utils-multiple-functions', severity: 'suggestion', names: fns,
          why: `exports ${fns.length} functions (${fns.join(', ')}): a \`utils/\` file holds one function and is named after it. Split unless they are one unit.`,
        });
      }
    }
  }
  return out;
}

const SIDE_EFFECT = /\b(fetch|window|document|localStorage|sessionStorage|navigator|process\.env|console\.|cookies|headers|redirect|setTimeout|setInterval|logger)\b|from\s+['"]next\//;
