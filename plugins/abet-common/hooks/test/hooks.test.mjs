#!/usr/bin/env node
/**
 * Regression suite for the ABET git-policy hooks.
 *
 *   node plugins/abet-common/hooks/test/hooks.test.mjs
 *
 * Each case feeds a synthetic PreToolUse payload to a hook and asserts the verdict.
 * pre-commit-validator is exercised through its parsing seams only (secrets, shell)
 * because the checks themselves need a real staged git tree.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { gitInvocations, tokenize, splitSegments } from '../lib/shell.mjs';
import { scanDiff } from '../lib/secrets.mjs';
import { slugFromBranch } from '../lib/branches.mjs';

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

// escape hatch for the release promotion flow
check('escape hatch allows develop', push('git push origin develop', { ABET_ALLOW_PROTECTED_PUSH: '1' }), 'allow');
check('escape hatch still blocks force', push('git push --force origin develop', { ABET_ALLOW_PROTECTED_PUSH: '1' }), 'deny');

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

// ----------------------------------------------------------------- report
console.log('');
if (failures.length === 0) {
  console.log(`✓ all ${passed} checks passed`);
  process.exit(0);
}
console.log(`✗ ${failures.length} failed, ${passed} passed\n`);
for (const f of failures) console.log(`  ${f}`);
process.exit(1);
