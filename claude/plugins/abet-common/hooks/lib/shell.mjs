/**
 * Shared shell-command parsing for the ABET git-policy hooks.
 *
 * These hooks inspect a Bash tool call *before* it runs, so everything here is
 * static parsing of a command string. It must handle the ways a git command can
 * hide: inside quotes, behind `&&`/`;`/subshells, wrapped in `bash -c "..."`,
 * prefixed with env assignments, or carrying git global flags (`git -C dir push`).
 */

/** Split a raw command string into tokens, honouring quotes and backslash escapes. */
export function tokenize(cmd) {
  const out = [];
  let cur = '';
  let started = false;
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];

    if (inSingle) {
      if (c === "'") inSingle = false;
      else cur += c;
      continue;
    }
    if (inDouble) {
      if (c === '\\' && i + 1 < cmd.length && '"\\$`\n'.includes(cmd[i + 1])) {
        cur += cmd[++i];
        continue;
      }
      if (c === '"') inDouble = false;
      else cur += c;
      continue;
    }
    if (c === "'") { inSingle = true; started = true; continue; }
    if (c === '"') { inDouble = true; started = true; continue; }
    if (c === '\\' && i + 1 < cmd.length) { cur += cmd[++i]; started = true; continue; }
    if (/\s/.test(c)) {
      if (cur !== '' || started) { out.push(cur); cur = ''; started = false; }
      continue;
    }
    cur += c;
  }
  if (cur !== '' || started) out.push(cur);
  return out;
}

/**
 * Split a command line into individually-executed segments on shell operators,
 * so `git add . && git push origin develop` yields two segments.
 * Subshell and group delimiters are treated as separators too.
 */
export function splitSegments(cmd) {
  const segs = [];
  let cur = '';
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    const n = cmd[i + 1];

    if (inSingle) { cur += c; if (c === "'") inSingle = false; continue; }
    if (inDouble) {
      cur += c;
      if (c === '\\' && n !== undefined) { cur += n; i++; continue; }
      if (c === '"') inDouble = false;
      continue;
    }
    if (c === "'") { inSingle = true; cur += c; continue; }
    if (c === '"') { inDouble = true; cur += c; continue; }
    if (c === '\\' && n !== undefined) { cur += c + n; i++; continue; }

    if ((c === '&' && n === '&') || (c === '|' && n === '|')) { segs.push(cur); cur = ''; i++; continue; }
    if (c === ';' || c === '\n' || c === '|' || c === '&') { segs.push(cur); cur = ''; continue; }
    if (c === '(' || c === ')' || c === '{' || c === '}') { segs.push(cur); cur = ''; continue; }

    cur += c;
  }
  segs.push(cur);
  return segs.map((s) => s.trim()).filter(Boolean);
}

const WRAPPERS = new Set(['sudo', 'command', 'nohup', 'time', 'env', 'builtin', 'exec']);
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh']);

/** git global options that consume the following token as their value. */
const GIT_GLOBAL_WITH_VALUE = new Set(['-C', '-c', '--namespace', '--git-dir', '--work-tree', '--exec-path', '--super-prefix']);
/** git global options that stand alone. */
const GIT_GLOBAL_FLAGS = new Set([
  '-p', '--paginate', '-P', '--no-pager', '--bare', '--no-replace-objects',
  '--literal-pathspecs', '--glob-pathspecs', '--noglob-pathspecs', '--icase-pathspecs',
  '--no-optional-locks', '--no-lazy-fetch', '--no-advice',
]);

const ENV_ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;

/**
 * Collect environment assignments written into the command itself, whether as a prefix
 * (`FOO=1 git push`) or a preceding `export FOO=1 && git push`.
 *
 * This exists because a PreToolUse hook runs as a child of Claude Code, not of the command
 * it is inspecting — so `process.env` never sees a variable the user prefixed onto their
 * command. Reading the assignment as literal text from the command string is the only way
 * an inline override can work, and an inline override is what the block message tells
 * people to use.
 */
export function envAssignments(cmd, depth = 0) {
  if (depth > 4 || typeof cmd !== 'string') return {};
  const env = {};

  for (const seg of splitSegments(cmd)) {
    const t = tokenize(seg);
    let i = 0;

    if (t[i] === 'export' || t[i] === 'set') i++;
    while (i < t.length) {
      const m = ENV_ASSIGNMENT.exec(t[i]);
      if (!m) break;
      env[m[1]] = m[2];
      i++;
    }

    while (i < t.length && WRAPPERS.has(t[i])) i++;
    if (i >= t.length) continue;

    const base = t[i].replace(/\\/g, '/').split('/').pop().replace(/\.exe$/i, '');
    if (SHELLS.has(base)) {
      const ci = t.indexOf('-c', i);
      if (ci !== -1 && t[ci + 1] !== undefined) Object.assign(env, envAssignments(t[ci + 1], depth + 1));
    }
  }
  return env;
}

/** True when `name` is set to `1` either in the real environment or inline in the command. */
export function flagEnabled(cmd, name) {
  return process.env[name] === '1' || envAssignments(cmd)[name] === '1';
}

/**
 * Find every git invocation in a command string.
 * Returns `{ subcommand, args }` per invocation, with git's own global flags stripped.
 */
export function gitInvocations(cmd, depth = 0) {
  if (depth > 4 || typeof cmd !== 'string') return [];
  const found = [];

  for (const seg of splitSegments(cmd)) {
    const t = tokenize(seg);
    let i = 0;

    // Skip leading env assignments (FOO=bar git push) and benign wrappers.
    while (i < t.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t[i]) || WRAPPERS.has(t[i]))) i++;
    if (i >= t.length) continue;

    const base = t[i].replace(/\\/g, '/').split('/').pop().replace(/\.exe$/i, '');

    // Recurse into `bash -c "..."` style wrappers.
    if (SHELLS.has(base)) {
      const ci = t.indexOf('-c', i);
      if (ci !== -1 && t[ci + 1] !== undefined) found.push(...gitInvocations(t[ci + 1], depth + 1));
      continue;
    }
    if (base !== 'git') continue;

    let j = i + 1;
    while (j < t.length) {
      const a = t[j];
      if (GIT_GLOBAL_WITH_VALUE.has(a)) { j += 2; continue; }
      if (a.includes('=') && [...GIT_GLOBAL_WITH_VALUE].some((f) => a.startsWith(f + '='))) { j += 1; continue; }
      if (GIT_GLOBAL_FLAGS.has(a)) { j += 1; continue; }
      break;
    }
    if (j >= t.length) continue;

    found.push({ subcommand: t[j], args: t.slice(j + 1) });
  }
  return found;
}

/**
 * Split an option list into positional arguments, skipping flags and the values
 * of flags that take one. `valueFlags` names the flags that consume a value.
 */
export function positionals(args, valueFlags = new Set()) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') { out.push(...args.slice(i + 1)); break; }
    if (a.startsWith('-') && a !== '-') {
      if (valueFlags.has(a)) i++;
      continue;
    }
    out.push(a);
  }
  return out;
}

/** True when a short-option cluster like `-uf` contains the given letter. */
export function hasShortFlag(args, letter) {
  return args.some((a) => /^-[A-Za-z]+$/.test(a) && a.slice(1).includes(letter));
}
