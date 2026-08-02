#!/usr/bin/env node
/**
 * Regression suite for the ABET git-policy hooks.
 *
 *   node shared/hooks/test/hooks.test.mjs
 *
 * Covers both entry points into the same policy: the Claude Code PreToolUse hooks
 * (synthetic payload in, verdict out) and the git-hook CLI that husky calls, so a rule
 * cannot pass on one provider and fail on another.
 *
 * The pre-commit gate is exercised through its parsing seams only (secrets, shell) —
 * the checks themselves need a real staged git tree, which lives in a separate manual test.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { gitInvocations, tokenize, splitSegments } from '../lib/shell.mjs';
import { scanDiff } from '../lib/secrets.mjs';
import { slugFromBranch } from '../lib/branches.mjs';
import { isAuthored, isScannable as isScannablePath } from '../lib/paths.mjs';
import { validateCommitMessage } from '../checks/commit-message.mjs';

const HOOKS = join(dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
const failures = [];

function check(label, actual, expected) {
  if (actual === expected) { passed++; return; }
  failures.push(`${label}\n    expected ${expected}, got ${actual}`);
}

/** Run a hook against a Bash command; returns 'deny' | 'warn' | 'allow'. */
function verdict(hook, command, env = {}) {
  const payload = JSON.stringify({
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command },
    cwd: process.cwd(),
  });
  const res = spawnSync(process.execPath, [join(HOOKS, hook)], {
    input: payload, encoding: 'utf8', timeout: 30_000,
    env: { ...process.env, ...env },
  });
  const out = (res.stdout || '').trim();
  if (!out) return 'allow';
  try {
    const parsed = JSON.parse(out);
    if (parsed.hookSpecificOutput?.permissionDecision === 'deny') return 'deny';
    if (parsed.systemMessage) return 'warn';
    return 'allow';
  } catch {
    return 'allow';
  }
}

const push = (cmd, env) => verdict('push-guard.mjs', cmd, env);
const commit = (cmd) => verdict('commit-msg-validator.mjs', cmd);
const branch = (cmd) => verdict('branch-name-validator.mjs', cmd);

// ---------------------------------------------------------------- push-guard
console.log('push-guard');

// protected branches, plain forms
check('push develop', push('git push origin develop'), 'deny');
check('push staging', push('git push origin staging'), 'deny');
check('push production', push('git push origin production'), 'deny');
check('push -u develop', push('git push -u origin develop'), 'deny');
check('push --set-upstream develop', push('git push --set-upstream origin develop'), 'deny');
check('push HEAD:develop', push('git push origin HEAD:develop'), 'deny');
check('push refs/heads/develop', push('git push origin HEAD:refs/heads/develop'), 'deny');
check('push feat:production', push('git push origin feat/x:production'), 'deny');

// feature branches pass
check('push feature branch', push('git push -u origin feat/bulk-edit-rubric-weights'), 'allow');
check('push fix branch', push('git push origin fix/gra-is-active'), 'allow');
check('push chore/archive', push('git push -u origin chore/archive-bulk-edit'), 'allow');

// force pushes
check('force to feature', push('git push --force origin feat/x'), 'deny');
check('force short flag', push('git push -f origin feat/x'), 'deny');
check('force in cluster -uf', push('git push -uf origin feat/x'), 'deny');
check('plus refspec is force', push('git push origin +feat/x:feat/x'), 'deny');
check('force-with-lease allowed', push('git push --force-with-lease origin feat/x'), 'allow');
check('force-with-lease=ref allowed', push('git push --force-with-lease=feat/x origin feat/x'), 'allow');
check('force-if-includes allowed', push('git push --force-if-includes --force-with-lease origin feat/x'), 'allow');

// deletion
check('delete develop', push('git push origin --delete develop'), 'deny');
check('delete via empty src', push('git push origin :develop'), 'deny');
check('delete feature branch', push('git push origin --delete feat/x'), 'allow');

// hiding places
check('chained after commit', push('git add . && git commit -m "feat: x" && git push origin develop'), 'deny');
check('semicolon chain', push('git status; git push origin staging'), 'deny');
check('subshell', push('(cd repo && git push origin production)'), 'deny');
check('bash -c wrapper', push('bash -c "git push origin develop"'), 'deny');
check('sh -c single quotes', push("sh -c 'git push origin develop'"), 'deny');
check('git -C global', push('git -C /tmp/repo push origin develop'), 'deny');
check('git -c global', push('git -c user.name=x push origin develop'), 'deny');
check('git --git-dir= global', push('git --git-dir=/tmp/.git push origin develop'), 'deny');
check('env prefix', push('GIT_TRACE=1 git push origin develop'), 'deny');
check('absolute git path', push('/usr/bin/git push origin develop'), 'deny');
check('quoted branch', push('git push origin "develop"'), 'deny');
check('push-option does not eat branch', push('git push -o ci.skip origin develop'), 'deny');

// escape hatch, via the real environment
check('escape hatch allows develop', push('git push origin develop', { ABET_ALLOW_PROTECTED_PUSH: '1' }), 'allow');
check('escape hatch still blocks force', push('git push --force origin develop', { ABET_ALLOW_PROTECTED_PUSH: '1' }), 'deny');

// escape hatch, written inline in the command. A hook is a child of Claude Code, not of
// the command, so process.env never sees this prefix — it has to be read as literal text.
check('inline prefix allows develop', push('ABET_ALLOW_PROTECTED_PUSH=1 git push origin develop'), 'allow');
check('inline prefix allows production', push('ABET_ALLOW_PROTECTED_PUSH=1 git push origin production'), 'allow');
check('inline export form', push('export ABET_ALLOW_PROTECTED_PUSH=1 && git push origin staging'), 'allow');
check('inline prefix inside bash -c', push('bash -c "ABET_ALLOW_PROTECTED_PUSH=1 git push origin develop"'), 'allow');
check('inline prefix still blocks force', push('ABET_ALLOW_PROTECTED_PUSH=1 git push --force origin develop'), 'deny');
check('inline prefix set to 0 does not unlock', push('ABET_ALLOW_PROTECTED_PUSH=0 git push origin develop'), 'deny');
check('a different var does not unlock', push('SOMETHING_ELSE=1 git push origin develop'), 'deny');
check('mentioning the var in a message does not unlock',
  push('git commit -m "ABET_ALLOW_PROTECTED_PUSH=1" && git push origin develop'), 'deny');

// non-push git and non-git commands
check('git fetch untouched', push('git fetch origin'), 'allow');
check('git log untouched', push('git log --oneline -5'), 'allow');
check('echo mentioning push', push('echo "git push origin develop"'), 'allow');

// -------------------------------------------------------- commit-msg-validator
console.log('commit-msg-validator');

check('valid feat', commit('git commit -m "feat(rubrics): add bulk weight editing"'), 'allow');
check('valid fix no scope', commit('git commit -m "fix: apply is_active filter"'), 'allow');
check('valid breaking', commit('git commit -m "feat(api)!: drop legacy grade endpoint"'), 'allow');
check('valid chore openspec', commit('git commit -m "chore(openspec): archive bulk-edit-rubric-weights"'), 'allow');
check('valid with -am', commit('git commit -am "fix(gra): null guard"'), 'allow');

check('missing type', commit('git commit -m "added bulk editing"'), 'deny');
check('unknown type', commit('git commit -m "feature: add thing"'), 'deny');
check('no space after colon', commit('git commit -m "feat:add thing"'), 'deny');
check('empty subject', commit('git commit -m "feat: "'), 'deny');
check('uppercase type', commit('git commit -m "Feat: add thing"'), 'deny');

check('--no-verify blocked', commit('git commit --no-verify -m "feat: x"'), 'deny');
check('-n blocked', commit('git commit -n -m "feat: x"'), 'deny');
check('multiline blocked', commit('git commit -m "feat: x\n\nsome body"'), 'deny');
check('two -m blocked', commit('git commit -m "feat: x" -m "body"'), 'deny');
check('co-authored-by blocked', commit('git commit -m "feat: x Co-Authored-By: Someone <a@b.c>"'), 'deny');
check('generated-with blocked', commit('git commit -m "feat: x 🤖 Generated with Claude Code"'), 'deny');
check('over 100 chars blocked', commit(`git commit -m "feat: ${'x'.repeat(110)}"`), 'deny');
check('over 72 warns', commit(`git commit -m "feat(scope): ${'x'.repeat(70)}"`), 'warn');

check('no -m warns', commit('git commit'), 'warn');
check('amend without -m ignored', commit('git commit --amend --no-edit'), 'allow');
check('commit -F ignored', commit('git commit -F message.txt'), 'allow');
check('not a commit', commit('git status'), 'allow');

// ------------------------------------------------------- branch-name-validator
console.log('branch-name-validator');

check('valid feat branch', branch('git checkout -b feat/bulk-edit-rubric-weights'), 'allow');
check('valid switch -c', branch('git switch -c fix/gra-is-active-filter'), 'allow');
check('valid chore archive', branch('git checkout -b chore/archive-bulk-edit'), 'allow');
check('no type prefix warns', branch('git checkout -b bulk-edit'), 'warn');
check('underscores warn', branch('git checkout -b feat/bulk_edit'), 'warn');
check('uppercase warns', branch('git checkout -b feat/BulkEdit'), 'warn');
check('plain checkout ignored', branch('git checkout develop'), 'allow');
check('branch -d ignored', branch('git branch -d feat/old'), 'allow');
check('branch --list ignored', branch('git branch --list'), 'allow');

// ------------------------------------------------------------- shell parsing
console.log('shell parser');

check('tokenize quoted', JSON.stringify(tokenize('git commit -m "feat: a b"')), JSON.stringify(['git', 'commit', '-m', 'feat: a b']));
check('tokenize empty string arg', JSON.stringify(tokenize('git commit -m ""')), JSON.stringify(['git', 'commit', '-m', '']));
check('splitSegments count', splitSegments('a && b ; c || d | e').length, 5);
check('gitInvocations count', gitInvocations('git add . && git push origin x').length, 2);
check('nested bash -c depth', gitInvocations('bash -c "bash -c \\"git push origin develop\\""').length, 1);

// --------------------------------------------------------------- slug mapping
console.log('slug inference');

check('feat slug', slugFromBranch('feat/bulk-edit-rubric-weights'), 'bulk-edit-rubric-weights');
check('fix slug', slugFromBranch('fix/gra-is-active'), 'gra-is-active');
check('archive slug', slugFromBranch('chore/archive-bulk-edit-rubric-weights'), 'bulk-edit-rubric-weights');
check('legacy feature/ prefix', slugFromBranch('feature/ard-module'), 'ard-module');
check('bare name passthrough', slugFromBranch('surveys-v1'), 'surveys-v1');

// -------------------------------------------------------------- secret scanner
console.log('secret scanner');

const diffOf = (file, line) => `+++ b/${file}\n@@ -0,0 +1 @@\n+${line}\n`;

check('aws key caught', scanDiff(diffOf('src/a.ts', 'const k = "AKIAIOSFODNN7EXAMPLE";')).length, 1);
check('jwt caught', scanDiff(diffOf('src/a.ts', 'const t = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijk";')).length, 1);
check('pg url caught', scanDiff(diffOf('src/a.ts', 'const u = "postgres://admin:s3cretpass@db:5432/abet";')).length, 1);
check('password literal caught', scanDiff(diffOf('src/a.ts', 'const password = "Abet_Str0ng!2026";')).length, 1);
check('env reference ignored', scanDiff(diffOf('src/a.ts', 'const password = process.env.DB_PASSWORD;')).length, 0);
check('placeholder ignored', scanDiff(diffOf('src/a.ts', 'const password = "changeme";')).length, 0);
check('.env.example ignored', scanDiff(diffOf('.env.example', 'DB_PASSWORD="supersecretvalue"')).length, 0);
check('lockfile ignored', scanDiff(diffOf('pnpm-lock.yaml', 'token = "ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"')).length, 0);
check('allow-secret marker respected', scanDiff(diffOf('src/a.spec.ts', 'const password = "Abet_Str0ng!2026"; // abet-allow-secret')).length, 0);
check('removed lines ignored', scanDiff('+++ b/src/a.ts\n@@ -1 +0,0 @@\n-const password = "Abet_Str0ng!2026";\n').length, 0);

// ---------------------------------------------------------- generated-path filter
console.log('generated-path filter');

// A lockfile is not Prettier-formatted and no repo `format` script targets it, so
// format-checking one blocks every dependency change with unactionable advice.
check('lockfile not authored', isAuthored('pnpm-lock.yaml'), false);
check('npm lockfile not authored', isAuthored('package-lock.json'), false);
check('yarn lockfile not authored', isAuthored('yarn.lock'), false);
check('nested lockfile not authored', isAuthored('apps/api/pnpm-lock.yaml'), false);
check('generated spec not authored', isAuthored('openapi.json'), false);
check('dist output not authored', isAuthored('dist/main.js'), false);
check('node_modules not authored', isAuthored('node_modules/x/index.js'), false);
check('next build not authored', isAuthored('.next/static/chunk.js'), false);
check('binary not authored', isAuthored('public/logo.png'), false);
check('source IS authored', isAuthored('src/modules/x/x.service.ts'), true);
check('package.json IS authored', isAuthored('package.json'), true);
check('markdown IS authored', isAuthored('docs/POLICIES.md'), true);
check('yaml config IS authored', isAuthored('.github/workflows/ci.yml'), true);

check('.env.example not scannable', isScannablePath('.env.example'), false);
check('lockfile not scannable', isScannablePath('pnpm-lock.yaml'), false);
check('source IS scannable', isScannablePath('src/a.ts'), true);

// ------------------------------------------------- shared commit-message policy
console.log('commit-message policy (shared with husky)');

const msg = (m) => validateCommitMessage(m).level;

check('policy: valid subject', msg('feat(rubrics): add bulk weight editing'), 'ok');
check('policy: bad type', msg('feature: add thing'), 'error');
check('policy: body rejected', msg('feat: x\n\nbody text'), 'error');
check('policy: trailer rejected', msg('feat: x Co-Authored-By: A <a@b.c>'), 'error');
check('policy: empty rejected', msg(''), 'error');
check('policy: over 72 warns', msg(`feat(scope): ${'x'.repeat(70)}`), 'warn');
check('policy: over 100 errors', msg(`feat: ${'x'.repeat(110)}`), 'error');

// COMMIT_EDITMSG arrives with git's `#` guidance and a trailing newline. Neither is a
// body, and treating them as one would reject every editor-written commit.
check('policy: strips git comment lines',
  msg('feat(gra): apply is_active filter\n\n# Please enter the commit message.\n# On branch feat/x\n'), 'ok');
check('policy: strips trailing blank lines', msg('fix: guard null period\n\n\n'), 'ok');
check('policy: real body still rejected past comments',
  msg('feat: x\nactual body\n# comment\n'), 'error');

// ------------------------------------------------------------- git-hook CLI
console.log('git-hook CLI (husky entry point)');

const CLI = join(HOOKS, 'cli.mjs');
const tmp = mkdtempSync(join(tmpdir(), 'abet-cli-'));

/** Run cli.mjs; returns 'block' (exit 1) or 'allow' (exit 0). */
function cli(args, { input = '', env = {} } = {}) {
  const res = spawnSync(process.execPath, [CLI, ...args], {
    input, encoding: 'utf8', cwd: tmp, timeout: 30_000,
    env: { ...process.env, ...env },
  });
  return res.status === 1 ? 'block' : 'allow';
}

const msgFile = join(tmp, 'COMMIT_EDITMSG');
const writeMsg = (m) => { writeFileSync(msgFile, m, 'utf8'); return msgFile; };

check('cli commit-msg: valid', cli(['commit-msg', writeMsg('feat(x): y')]), 'allow');
check('cli commit-msg: invalid type', cli(['commit-msg', writeMsg('nope: y')]), 'block');
check('cli commit-msg: with git comments', cli(['commit-msg', writeMsg('fix(x): y\n\n# On branch feat/z\n')]), 'allow');
check('cli commit-msg: missing file arg', cli(['commit-msg']), 'block');

// pre-push reads `<local ref> <local sha> <remote ref> <remote sha>` on stdin.
const pushLine = (remoteRef) => `refs/heads/x abc123 ${remoteRef} def456\n`;

check('cli pre-push: develop blocked', cli(['pre-push'], { input: pushLine('refs/heads/develop') }), 'block');
check('cli pre-push: staging blocked', cli(['pre-push'], { input: pushLine('refs/heads/staging') }), 'block');
check('cli pre-push: production blocked', cli(['pre-push'], { input: pushLine('refs/heads/production') }), 'block');
check('cli pre-push: feature allowed', cli(['pre-push'], { input: pushLine('refs/heads/feat/thing') }), 'allow');
check('cli pre-push: HEAD:develop caught via remote ref', cli(['pre-push'], { input: pushLine('refs/heads/develop') }), 'block');
check('cli pre-push: escape hatch', cli(['pre-push'], { input: pushLine('refs/heads/develop'), env: { ABET_ALLOW_PROTECTED_PUSH: '1' } }), 'allow');
check('cli pre-push: multiple refs, one protected',
  cli(['pre-push'], { input: pushLine('refs/heads/feat/a') + pushLine('refs/heads/production') }), 'block');
check('cli: unknown command', cli(['nonsense']), 'allow'); // exit 2, not a block

rmSync(tmp, { recursive: true, force: true });

// ----------------------------------------------------------------- report
console.log('');
if (failures.length === 0) {
  console.log(`✓ all ${passed} checks passed`);
  process.exit(0);
}
console.log(`✗ ${failures.length} failed, ${passed} passed\n`);
for (const f of failures) console.log(`  ${f}`);
process.exit(1);
