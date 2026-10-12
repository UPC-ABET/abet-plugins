/**
 * Deterministic security checks over what a diff adds.
 *
 * Each rule is a fact about a line or a route, encoded from the team's own conventions
 * (`backend/docs/POLICIES.md`: Auth & Guards, Scope Headers, "Don't use process.env"), not
 * a generic scanner's guess. A hit is a candidate — the auditor confirms it — but finding it
 * costs no tokens and does not depend on the model noticing.
 *
 * The one thing this cannot see is intent: a cache of global lookup data legitimately has no
 * school in its key. Hence "candidate", and a `why` that says what to check.
 */

const SCOPE = '(schoolId|modalityTypeId|academicPeriodId)';
const SOURCE = /\.[jt]sx?$/;
/** `x.spec.ts`, `x.test.ts` and `x.repository.db-spec.ts` — the hyphen form was being scanned. */
export const TEST = /[.-](spec|test)\.[jt]sx?$/;
/** Migrations and seed scripts: their SQL values are their own constants, not input. */
const MIGRATION = /(^|\/)migrations\/|(^|\/)database\/scripts\/seeds\//;

/** Single-line rules: `re` runs on every added line of a file matching `files`. */
export const LINE_RULES = [
  {
    id: 'scope-from-request',
    files: /\.controller\.ts$/,
    re: new RegExp(`@(Query|Body|Param)\\(\\s*['"]${SCOPE}['"]`),
    why: 'School, modality and academic period come from the X-* headers through @SchoolId() / @ModalityTypeId() / @AcademicPeriodId(), never the query, body or route params. A caller can otherwise ask for another school\'s data.',
  },
  {
    id: 'public-route',
    files: SOURCE,
    re: /@Public\(\)/,
    why: 'Removes JWT and permission checks: the route is open to anyone. Confirm that is intended and that it exposes nothing scoped.',
  },
  {
    id: 'skip-permissions',
    files: SOURCE,
    re: /@SkipPermissions\(\)/,
    why: 'Any authenticated user may call it, with no permission check. Confirm no scoped or admin data is reachable.',
  },
  {
    id: 'process-env',
    files: /\.[jt]sx?$/,
    // test/db/ is the db-spec harness, which POLICIES lets read the environment directly
    skip: /(^|\/)(main|env\.config|[\w.-]*config)\.[jt]s$|(^|\/)(database|scripts|tools)\/|(^|\/)test\/db\//,
    re: /\bprocess\.env\b/,
    why: 'POLICIES: "Don\'t use process.env directly — use ConfigService". Unvalidated env access also skips the Zod-validated schema.',
  },
  {
    id: 'dangerous-api',
    files: SOURCE,
    re: /\b(eval\s*\(|new Function\s*\()|dangerouslySetInnerHTML|\.innerHTML\s*=|rejectUnauthorized\s*:\s*false/,
    why: 'Executes or injects arbitrary content, or turns off TLS verification.',
  },
  {
    id: 'weak-crypto',
    files: SOURCE,
    re: /createHash\(\s*['"](md5|sha1)['"]/,
    why: 'MD5/SHA-1 are broken for integrity and passwords; use SHA-256+ or bcrypt as the codebase does.',
  },
  {
    id: 'insecure-random',
    files: SOURCE,
    re: /\bMath\.random\s*\(/,
    why: 'Not cryptographically secure. Fine for jitter; wrong for tokens, ids, secrets or anything guessable.',
  },
  {
    id: 'cors-any-origin',
    files: SOURCE,
    re: /origin\s*:\s*(['"]\*['"]|true)/,
    why: 'Allows any origin to call the API from a browser.',
  },
  {
    id: 'log-sensitive',
    files: SOURCE,
    re: /(console\.(log|debug|info|warn|error)|logger\.\w+)\s*\([^)]*\b(password|passwd|secret|token|authorization|api_?key)\b/i,
    why: 'Sensitive values must never reach logs (POLICIES: never log tokens).',
  },
  {
    id: 'shell-interpolation',
    files: SOURCE,
    re: /\b(exec|execSync|spawn|spawnSync)\s*\(\s*`[^`]*\$\{/,
    why: 'Interpolating a value into a shell command is command injection unless it is fixed and trusted.',
  },
  // Promoted from the audit ledger (6 findings, 5 changes): request text, stored names and
  // driver errors interpolated raw into a log line can forge log entries and leak internals.
  {
    id: 'log-unescaped-input',
    files: SOURCE,
    re: /(console\.\w+|logger\.\w+)\s*\(\s*`[^`]*\$\{(?!\s*JSON\.stringify)[^}]*(\b(err|error|e)\.message\b|\b(query|dto|body|params)\.\w+|\.name\b)/,
    why: 'Request, admin-entered or driver text interpolated raw into a log line: a newline in it forges a log entry, and a driver message can leak schema details. Wrap the value in JSON.stringify(), or log a fixed message plus a structured field.',
  },
  {
    id: 'error-message-in-response',
    files: SOURCE,
    re: /description\s*:\s*[\w.?]*\b(err|error|e)\.message\b/,
    why: 'An exception description built from err.message returns the driver\'s or library\'s internals to the client. Return a fixed i18n key; keep the message in the log (escaped).',
  },
  // Promoted from the audit ledger (review-85 blocker): `($1::int[] IS NULL OR school_id = ANY($1))`
  // turns a missing scope into "every school".
  {
    id: 'nullable-scope-predicate',
    files: /\.(sql|repository)\.ts$/,
    re: /\$\d+::int\[\]\s+IS\s+NULL\s+OR\b.*\b\w*(school|program|faculty|modality|period)\w*/i,
    why: 'A NULL scope parameter disables the scope filter: any path that passes null (an "all" flag, a missing header) reads every school\'s rows. Make the scope parameter mandatory, and give genuinely global reads their own query.',
  },
];

/** Cache calls: `this.bandCache.get(courseId)`, `cache.set(key, …)`. */
const CACHE_CALL = /\b(\w*[cC]ache\w*)\.(get|set|has|delete)\(\s*([^,)]+)/;
const HAS_SCOPE = /school|scope|tenant|modality|period|program|organi[sz]ation/i;

/**
 * Text of the first argument of a call starting at `from` in `s`, tracking quotes, template
 * literals and parentheses so a comma inside a string does not end it.
 */
export function firstArgument(s, from) {
  let depth = 0;
  let quote = null;
  for (let i = from; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) return s.slice(from, i);
      depth--;
    } else if (c === ',' && depth === 0) return s.slice(from, i);
  }
  return s.slice(from);
}

/** `${…}` substitutions in `s`, each as `{ expr, placeholder }`, tracking nested braces. */
export function substitutions(s) {
  const out = [];
  for (let i = s.indexOf('${'); i >= 0; i = s.indexOf('${', i + 2)) {
    let depth = 0;
    let j = i + 1;
    for (; j < s.length; j++) {
      if (s[j] === '{') depth++;
      else if (s[j] === '}' && --depth === 0) break;
    }
    out.push({ expr: s.slice(i + 2, j).trim(), placeholder: s[i - 1] === '$' });
  }
  return out;
}

/**
 * A substitution that cannot carry a value: a `$${n}` parameter placeholder, an ALL_CAPS
 * constant (or a member of one), or a call to a function that returns a SQL fragment
 * (`chartAncestryCte(...)`) — those build SQL with their own `$n` placeholders. These made up
 * most of the rule's false positives in the ledger.
 */
const SAFE_SUBSTITUTION = [
  /^[A-Z][A-Z0-9_]*(\.[A-Za-z0-9_]+)*$/,
  /^[\w.]+(Cte|Sql|Join|Fragment|Clause|Columns|Select|Where)\(/,
];
const safeSubstitution = ({ expr, placeholder }) => placeholder || SAFE_SUBSTITUTION.some((re) => re.test(expr));

/** Does a SQL first argument build the statement from values instead of parameters? */
export function interpolatesSql(arg) {
  // template literal with a substitution that may carry a value
  for (const tpl of arg.match(/`[^`]*`/g) ?? []) if (!substitutions(tpl).every(safeSubstitution)) return true;
  // string concatenation outside quotes: 'SELECT ... ' + id
  let quote = null;
  for (let i = 0; i < arg.length; i++) {
    const c = arg[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '+') return true;
  }
  return false;
}

const SCOPE_PARAM = /^(schoolId|modalityTypeId|academicPeriodId)$/;
const NOT_A_FUNCTION = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'constructor', 'return', 'await']);

/** Index of the `}` matching the `{` at `open`, skipping strings, template literals and comments. */
export function closingBrace(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '/') i = text.indexOf('\n', i) < 0 ? text.length : text.indexOf('\n', i);
    else if (c === '/' && text[i + 1] === '*') i = text.indexOf('*/', i) < 0 ? text.length : text.indexOf('*/', i) + 1;
    else if (c === '"' || c === "'" || c === '`') {
      for (i++; i < text.length && text[i] !== c; i++) if (text[i] === '\\') i++;
    } else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  return text.length;
}

/**
 * A function that accepts a scope id (school, modality, academic period) and never uses it in
 * its body: the work it does is not scoped to the caller's school, however the route is
 * decorated. Promoted from the audit ledger: the auditor kept finding IDORs shaped exactly like
 * this (`getRoster(id, schoolId) { return repo.findRoster(id); }`) before any rule existed.
 */
export function findUnusedScopeParams({ text, addedNums }) {
  const issues = [];
  const start = /^[ 	]*(?:(?:public|private|protected|static|async)\s+)*([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\(/gm;
  for (const m of text.matchAll(start)) {
    if (NOT_A_FUNCTION.has(m[1])) continue;
    const parenOpen = m.index + m[0].length - 1;
    const parenClose = closingBracket(text, parenOpen, '(', ')');
    if (!/^\s*[{:]/.test(text.slice(parenClose + 1, parenClose + 40))) continue; // a call, not a declaration
    const names = text.slice(parenOpen + 1, parenClose).replace(/@\w+\([^)]*\)/g, '').split(',')
      .map((p) => p.trim().replace(/^(readonly|private|public|protected)\s+/, '').split(/[?:=\s]/)[0])
      .filter((p) => SCOPE_PARAM.test(p));
    if (names.length === 0) continue;

    // the body's `{` is the first one after the parameters that is not inside the return type
    // (`Promise<{ rows: X[] }>` has braces of its own)
    let angle = 0;
    let open = -1;
    for (let i = parenClose + 1; i < text.length; i++) {
      const c = text[i];
      if (c === '<') angle++;
      else if (c === '>' && text[i - 1] !== '=') angle = Math.max(0, angle - 1);
      else if (c === ';' && angle === 0) break; // a declaration with no body
      else if (c === '{' && angle === 0) { open = i; break; }
    }
    if (open < 0) continue;

    const line = text.slice(0, parenOpen).split('\n').length;
    const lastLine = text.slice(0, open).split('\n').length;
    if (![...Array(lastLine - line + 1).keys()].some((k) => addedNums.has(line + k))) continue; // signature untouched by the diff
    const body = text.slice(open, closingBrace(text, open));
    for (const p of names) {
      if (!new RegExp(`\\b${p}\\b`).test(body)) {
        issues.push({ rule: 'scope-param-unused', line, text: `${m[1]}(… ${p} …)`,
          why: `${m[1]} accepts ${p} and never uses it, so what it does is not scoped to the caller's school: any caller can reach another school's rows by id (an IDOR). Pass it into the query, or drop the parameter if the work is genuinely global.` });
      }
    }
  }
  return issues;
}

/** Index of the bracket closing the one at `open`, for a paired `(`…`)`, skipping strings. */
function closingBracket(text, open, o, c) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === '`') for (i++; i < text.length && text[i] !== ch; i++) { if (text[i] === '\\') i++; }
    else if (ch === o) depth++;
    else if (ch === c && --depth === 0) return i;
  }
  return text.length;
}



const ENDPOINT = /^\s*@(Get|Post|Put|Patch|Delete|Head|Options|All|Swagger\w+?)\(/;
const CLASS_LEVEL = /^\s*@Swagger\w*Controller\(/;
const AUTH = /@(RequirePermission|Public|SkipPermissions)\b/;
const SIGNATURE = /^\s*(?:(?:public|private|protected|static|async)\s+)*[A-Za-z_$][\w$]*\s*(?:<[^>]*>)?\s*\(/;

/**
 * Endpoint methods (a route or Swagger decorator on them) that carry none of
 * @RequirePermission / @Public / @SkipPermissions. By POLICIES the guard then throws
 * `error.auth.noPermissionsConfigured`: the endpoint fails closed, so this is a defect
 * (it can never succeed), not an open door. Also flags @ApiTokenAuth() with
 * @SkipPermissions(), which POLICIES forbids outright.
 */
/**
 * Every endpoint method of a controller: `{ up, down, stack, params, name, verb, touched }`.
 * `up`..`down` are 0-based line indexes of its decorators through its signature line, `stack`
 * that text, `params` its whole parameter list (which may run over several lines), and
 * `touched` whether the diff added any line of it.
 */
export function endpoints(text, addedNums) {
  const lines = text.split('\n');
  const starts = [0];
  for (const l of lines) starts.push(starts[starts.length - 1] + l.length + 1);
  const out = [];
  const seen = new Set();
  for (let i = 0; i < lines.length; i++) {
    if (!ENDPOINT.test(lines[i]) || CLASS_LEVEL.test(lines[i])) continue;
    let up = i;
    while (up > 0 && lines[up - 1].trim() !== '' && !/[};{]\s*$/.test(lines[up - 1])) up--;
    let down = i;
    while (down + 1 < lines.length && down - i < 15 && !SIGNATURE.test(lines[down])) down++;
    if (seen.has(down)) continue; // one method, several decorators
    seen.add(down);
    const sig = SIGNATURE.exec(lines[down]);
    const open = sig ? starts[down] + sig[0].length - 1 : -1;
    const params = open >= 0 ? text.slice(open + 1, closingBracket(text, open, '(', ')')) : '';
    const paramsEnd = text.slice(0, open + 1 + params.length).split('\n').length - 1;
    out.push({
      up, down, params,
      stack: lines.slice(up, down + 1).join('\n'),
      name: /([A-Za-z_$][\w$]*)\s*\(/.exec(lines[down])?.[1] ?? 'method',
      verb: /@(Get|Post|Put|Patch|Delete)\(/.exec(lines.slice(up, down + 1).join('\n'))?.[1] ?? null,
      touched: [...Array(Math.max(down, paramsEnd) - up + 1).keys()].some((k) => addedNums.has(up + k + 1)),
    });
  }
  return out;
}

export function findRouteAuthIssues({ text, addedNums }) {
  const lines = text.split('\n');
  const firstClass = lines.findIndex((l) => /^\s*export\s+(abstract\s+)?class\b/.test(l));
  const classLevel = firstClass >= 0 && AUTH.test(lines.slice(0, firstClass).join('\n'));
  const issues = [];

  for (const { up, stack, name, touched } of endpoints(text, addedNums)) {
    if (!touched) continue;
    if (/@ApiTokenAuth\b/.test(stack) && /@SkipPermissions\b/.test(stack)) {
      issues.push({ rule: 'api-token-skip-permissions', line: up + 1, text: name,
        why: 'POLICIES: never combine @ApiTokenAuth() with @SkipPermissions() — a machine principal would be authorised with no scope check at all.' });
    }
    if (!classLevel && !AUTH.test(stack)) {
      issues.push({ rule: 'route-without-permission', line: up + 1, text: name,
        why: 'No @RequirePermission, @Public or @SkipPermissions: the guard throws error.auth.noPermissionsConfigured, so this endpoint can never succeed. Add the decorator that says who may call it.' });
    }
  }
  return issues;
}

const TAKES_SCOPE = /@(SchoolId|AcademicPeriodId|ModalityTypeId)\(/;

/**
 * Routes that skip the scope their siblings take. Promoted from the audit ledger (13 findings
 * in 6 changes, 2 blockers): one route family gets `@SchoolId()` and the write next to it on
 * the same entity does not, or a machine route (`@ApiTokenAuth()`) returns per-school data
 * with no school at all. Only controllers where some route does take a scope are judged: a
 * controller of global catalogues (periods, campuses) takes none, and replaying the rule over
 * ACC-SYS history without that condition flagged every one of its routes.
 */
export function findRouteScopeIssues({ text, addedNums }) {
  const all = endpoints(text, addedNums);
  const siblingsScoped = all.some((e) => TAKES_SCOPE.test(e.params));
  const classMachine = /@ApiTokenAuth\b/.test(text.split(/^\s*export\s+(?:abstract\s+)?class\b/m)[0]);
  const issues = [];
  for (const e of all) {
    if (!e.touched || TAKES_SCOPE.test(e.params) || !siblingsScoped) continue;
    if (classMachine || /@ApiTokenAuth\b/.test(e.stack)) {
      issues.push({ rule: 'machine-route-without-scope', line: e.up + 1, text: e.name,
        why: `${e.name} admits a machine principal (@ApiTokenAuth) and takes no @SchoolId(): if it returns per-school or personal data, any token holder reads every school. Take the school from the header like the other per-school routes, or record why the data is global.` });
    } else if (/^(Post|Put|Patch|Delete)$/.test(e.verb ?? '')) {
      issues.push({ rule: 'route-scope-inconsistent', line: e.up + 1, text: e.name,
        why: `${e.name} writes without @SchoolId() while other routes in this controller take it: a by-id write that never checks the row's school lets one school change another's data. Take the scope and check the row belongs to it, or record why this entity is global.` });
    }
  }
  return issues;
}

const PROPERTY = /^\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)[?!]?\s*:\s*[^=;]+;\s*$/;
const RESPONSE_DTO = /(Response|Ref|View|Out(?:put)?)Dto$/;

/**
 * Per-property checks over a DTO file, judged on the property's whole decorator block:
 *   dto-int-unbounded    @IsInt without @Max — an id past int4 reaches SQL and comes back a 500
 *   dto-array-unbounded  @IsArray / `each: true` without @ArrayMaxSize — the request picks the loop size
 *   scope-in-dto         a scope field on an input DTO (response DTOs legitimately carry one)
 * The first two are promoted from the audit ledger (6 findings in 5 changes).
 */
export function findDtoIssues({ text, addedNums }) {
  const issues = [];
  let cls = null;
  let block = [];
  let depth = 0;
  text.split('\n').forEach((line, idx) => {
    const n = idx + 1;
    const c = /^\s*export\s+(?:abstract\s+)?class\s+([\w$]+)/.exec(line);
    if (c) { cls = c[1]; block = []; depth = 0; return; }
    if (depth > 0 || /^\s*@/.test(line)) { // a decorator, or the rest of one spanning lines
      block.push({ n, line });
      depth += (line.match(/\(/g) ?? []).length - (line.match(/\)/g) ?? []).length;
      return;
    }
    const p = PROPERTY.exec(line);
    if (!p || !cls) { block = []; return; }
    const decorators = block.map((b) => b.line).join('\n');
    const touched = addedNums.has(n) || block.some((b) => addedNums.has(b.n));
    block = [];
    if (!touched) return;
    const at = (rule, why) => issues.push({ rule, line: n, text: `${cls}.${p[1]}`, why });
    if (/@IsInt\(/.test(decorators) && !/@Max\(/.test(decorators)) {
      at('dto-int-unbounded', '@IsInt() with no @Max(): a value past 2147483647 passes validation and fails in SQL as a 500. Add @Max() (2147483647 for an id).');
    }
    if ((/@IsArray\(/.test(decorators) || /each\s*:\s*true/.test(decorators)) && !/@ArrayMaxSize\(/.test(decorators)) {
      at('dto-array-unbounded', 'An array with no @ArrayMaxSize(): the caller chooses how many items the handler loops, locks or queries over. Add a bound.');
    }
    if (new RegExp(`^${SCOPE}$`).test(p[1]) && !RESPONSE_DTO.test(cls)) {
      at('scope-in-dto', 'Scope must not be an input DTO field; the controller injects it from the header and passes it to the service.');
    }
  });
  // One hit per rule per file, naming every property: a new DTO file can add dozens of ids,
  // and one row each would crowd every other finding out of the scanner's list.
  const byRule = new Map();
  for (const i of issues) {
    const g = byRule.get(i.rule);
    if (!g) byRule.set(i.rule, { ...i, fields: [i.text] });
    else g.fields.push(i.text);
  }
  return [...byRule.values()].map(({ fields, ...i }) => ({
    ...i,
    text: `${fields.slice(0, 6).join(', ')}${fields.length > 6 ? `, … (${fields.length} in all)` : ''}`,
  }));
}

/**
 * Run every rule over the diff's added lines.
 *   added:     Map<file, [{n, text}]>          (lib/diff.mjs → addedLines)
 *   readFile:  (file) => string | null          full text, for the route checks
 */
export function scanSecurity({ added, readFile }) {
  const hits = [];
  const push = (file, n, rule, text, why) => hits.push({ rule, file, line: n, text: text.trim().slice(0, 160), why });

  for (const [file, lines] of added) {
    if (!SOURCE.test(file) || TEST.test(file)) continue;

    for (const { n, text } of lines) {
      for (const r of LINE_RULES) {
        if (r.files.test(file) && !r.skip?.test(file) && r.re.test(text)) push(file, n, r.id, text, r.why);
      }
      const cache = CACHE_CALL.exec(text);
      if (cache && !HAS_SCOPE.test(cache[3])) {
        push(file, n, 'cache-key-without-scope', text,
          'POLICIES: "Treat every new cache key and every new async path as a scope-leak candidate." This key has no school/scope, so one school\'s entry can be served to another. Fine only if the cached data is global.');
      }
    }

    // .query( with a built-up statement, judged over the call's first argument
    const joined = lines.map((l) => l.text).join('\n');
    let from = 0;
    for (;;) {
      const at = joined.indexOf('.query(', from);
      if (at < 0) break;
      const start = at + '.query('.length;
      const arg = firstArgument(joined, start);
      // a migration's or seed's values are its own constants; only the environment is input there
      if (MIGRATION.test(file) ? /\bprocess\.env\b/.test(arg) && interpolatesSql(arg) : interpolatesSql(arg)) {
        const before = joined.slice(0, at).split('\n').length - 1;
        push(file, lines[Math.min(before, lines.length - 1)].n, 'sql-interpolation', lines[Math.min(before, lines.length - 1)].text,
          'The statement is built from values instead of $1 parameters: SQL injection unless every value is fixed and trusted.');
      }
      from = start;
    }

    if (/\.(service|repository|functions|controller)\.ts$/.test(file)) {
      const full = readFile(file);
      if (full) {
        const nums = new Set(lines.map((l) => l.n));
        for (const i of findUnusedScopeParams({ text: full, addedNums: nums })) push(file, i.line, i.rule, i.text, i.why);
      }
    }

    if (/\.controller\.ts$/.test(file)) {
      const text = readFile(file);
      if (text) {
        const addedNums = new Set(lines.map((l) => l.n));
        for (const i of [...findRouteAuthIssues({ text, addedNums }), ...findRouteScopeIssues({ text, addedNums })]) {
          push(file, i.line, i.rule, i.text, i.why);
        }
      }
    }

    if (/\.dtos?\.ts$/.test(file)) {
      const text = readFile(file);
      if (text) for (const i of findDtoIssues({ text, addedNums: new Set(lines.map((l) => l.n)) })) push(file, i.line, i.rule, i.text, i.why);
    }
  }
  return hits;
}
