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
const TEST = /\.(spec|test)\.[jt]sx?$/;

/** Single-line rules: `re` runs on every added line of a file matching `files`. */
export const LINE_RULES = [
  {
    id: 'scope-from-request',
    files: /\.controller\.ts$/,
    re: new RegExp(`@(Query|Body|Param)\\(\\s*['"]${SCOPE}['"]`),
    why: 'School, modality and academic period come from the X-* headers through @SchoolId() / @ModalityTypeId() / @AcademicPeriodId(), never the query, body or route params. A caller can otherwise ask for another school\'s data.',
  },
  {
    id: 'scope-in-dto',
    files: /\.dtos?\.ts$/,
    re: new RegExp(`^\\s*${SCOPE}\\??!?\\s*:`),
    why: 'Scope must not be a DTO field; the controller injects it from the header and passes it to the service.',
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
    skip: /(^|\/)(main|env\.config|[\w.-]*config)\.[jt]s$|(^|\/)(database|scripts|tools)\//,
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

/** Does a SQL first argument build the statement from values instead of parameters? */
export function interpolatesSql(arg) {
  if (/`[^`]*\$\{/.test(arg)) return true; // template literal with a substitution
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
export function findRouteAuthIssues({ text, addedNums }) {
  const lines = text.split('\n');
  const firstClass = lines.findIndex((l) => /^\s*export\s+(abstract\s+)?class\b/.test(l));
  const classLevel = firstClass >= 0 && AUTH.test(lines.slice(0, firstClass).join('\n'));
  const issues = [];
  const seen = new Set();

  for (let i = 0; i < lines.length; i++) {
    if (!ENDPOINT.test(lines[i]) || CLASS_LEVEL.test(lines[i])) continue;
    let up = i;
    while (up > 0 && lines[up - 1].trim() !== '' && !/[};{]\s*$/.test(lines[up - 1])) up--;
    let down = i;
    while (down + 1 < lines.length && down - i < 15 && !SIGNATURE.test(lines[down])) down++;
    if (seen.has(down)) continue; // one method, several decorators
    seen.add(down);
    if (![...Array(down - up + 1).keys()].some((k) => addedNums.has(up + k + 1))) continue; // untouched by the diff

    const stack = lines.slice(up, down + 1).join('\n');
    const name = /([A-Za-z_$][\w$]*)\s*\(/.exec(lines[down])?.[1] ?? 'method';
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
      if (interpolatesSql(firstArgument(joined, start))) {
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
        for (const i of findRouteAuthIssues({ text, addedNums })) push(file, i.line, i.rule, i.text, i.why);
      }
    }
  }
  return hits;
}
