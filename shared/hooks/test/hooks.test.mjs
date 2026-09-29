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
 * Most of the pre-commit gate is exercised through its parsing seams only (secrets, shell).
 * `runPreCommitChecks` itself — including per-package toolchain resolution in a workspace
 * repo — is exercised against real `git init` fixtures with stub tool binaries further down.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync, readFileSync, cpSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { gitInvocations, tokenize, splitSegments, gitCommandCwd } from '../lib/shell.mjs';
import { scanDiff } from '../lib/secrets.mjs';
import { slugFromBranch } from '../lib/branches.mjs';
import { isAuthored, isScannable as isScannablePath } from '../lib/paths.mjs';
import { validateCommitMessage } from '../checks/commit-message.mjs';
import { runPreCommitChecks } from '../checks/pre-commit.mjs';
import { checkModuleFileName } from '../checks/file-naming.mjs';
import { isMain } from '../../scripts/lib/is-main.mjs';
import { checkLean, openQuestions, scopeCheckRows, BOUNDS } from '../../scripts/lib/lean-gate.mjs';
import { validateRecord, aggregate, renderReport } from '../../scripts/lib/ledger.mjs';
import { findClones } from '../../scripts/lib/clones.mjs';
import { scanSecurity, findRouteAuthIssues, findUnusedScopeParams } from '../../scripts/lib/security.mjs';
import { addedLines } from '../../scripts/lib/diff.mjs';
import { measure, chooseDepth, countTasks, packageOf, newTerms, findDocHits, headingsOf, addedByFile, exportedNames, findDeadCode, RISKY } from '../../scripts/audit-scope.mjs';
import { findWorkspacePackages, packageFor } from '../lib/workspace.mjs';

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

// ------------------------------------------------------------ command cwd resolution
console.log('command cwd resolution');

// A hook is handed the session cwd, not the one the command moves to. Without this,
// `cd ../other && git commit` inspects the wrong repository's staged files.
const cwdOf = (cmd) => gitCommandCwd(cmd, '/repo/backend');

check('no cd keeps the base', cwdOf('git commit -m "feat: x"'), '/repo/backend');
check('relative cd is applied', cwdOf('cd ../frontend && git commit -m "feat: x"'), '/repo/frontend');
check('absolute cd is applied', cwdOf('cd /srv/other && git push origin develop'), '/srv/other');
check('nested relative cd', cwdOf('cd sub/dir && git commit -m "feat: x"'), '/repo/backend/sub/dir');
check('dot segment ignored', cwdOf('cd ./sub && git commit -m "feat: x"'), '/repo/backend/sub');
check('subshell cd applied', cwdOf('(cd ../frontend && git push origin develop)'), '/repo/frontend');
check('cd after git does not count', cwdOf('git commit -m "feat: x" && cd ../frontend'), '/repo/backend');
check('quoted path with space', cwdOf('cd "../my repo" && git commit -m "feat: x"'), '/repo/my repo');
// An unquoted backslash is a shell escape, not a separator — `cd ..\frontend` really does
// mean `..frontend` in POSIX. A real Windows path therefore arrives quoted.
check('quoted windows absolute path', cwdOf('cd "D:\\projects\\app" && git commit -m "feat: x"'), 'D:\\projects\\app');
check('env prefix before cd', cwdOf('FOO=1 cd ../frontend && git commit -m "feat: x"'), '/repo/frontend');
check('cd with no target ignored', cwdOf('cd && git commit -m "feat: x"'), '/repo/backend');
check('non-git command does not stop the walk', cwdOf('ls && cd ../frontend && git commit -m "feat: x"'), '/repo/frontend');

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

// ------------------------------------------------------ workspace package resolution
console.log('workspace package resolution');

{
  const dir = mkdtempSync(join(tmpdir(), 'abet-ws-unit-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'root', private: true }));
  writeFileSync(join(dir, 'pnpm-workspace.yaml'), "packages:\n  - 'backend'\n  - 'frontend'\n");
  mkdirSync(join(dir, 'backend'), { recursive: true });
  writeFileSync(join(dir, 'backend', 'package.json'), '{}');
  mkdirSync(join(dir, 'frontend'), { recursive: true });
  writeFileSync(join(dir, 'frontend', 'package.json'), '{}');
  mkdirSync(join(dir, 'not-a-package'), { recursive: true }); // no package.json — must be excluded

  const pkgs = findWorkspacePackages(dir);
  const labels = pkgs.map((p) => relative(dir, p).replace(/\\/g, '/')).sort();
  check('findWorkspacePackages: finds backend+frontend', JSON.stringify(labels), JSON.stringify(['backend', 'frontend']));

  check('packageFor: backend file', relative(dir, packageFor(dir, pkgs, 'backend/src/a.ts')).replace(/\\/g, '/'), 'backend');
  check('packageFor: frontend file', relative(dir, packageFor(dir, pkgs, 'frontend/x.ts')).replace(/\\/g, '/'), 'frontend');
  check('packageFor: unmatched path falls back to root', packageFor(dir, pkgs, 'docker/x.yml'), dir);

  rmSync(dir, { recursive: true, force: true });
}

{
  // no pnpm-workspace.yaml, no `workspaces` field — single-package repos keep working
  const dir = mkdtempSync(join(tmpdir(), 'abet-ws-unit-single-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'solo' }));
  const pkgs = findWorkspacePackages(dir);
  check('findWorkspacePackages: single-package fallback is [root]', JSON.stringify(pkgs), JSON.stringify([dir]));
  check('packageFor: single-package repo always resolves to root', packageFor(dir, pkgs, 'src/a.ts'), dir);
  rmSync(dir, { recursive: true, force: true });
}

{
  // npm/yarn `workspaces` array, honoured as a fallback when there's no pnpm-workspace.yaml
  const dir = mkdtempSync(join(tmpdir(), 'abet-ws-unit-npmws-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'root', workspaces: ['packages/*'] }));
  mkdirSync(join(dir, 'packages', 'a'), { recursive: true });
  writeFileSync(join(dir, 'packages', 'a', 'package.json'), '{}');
  mkdirSync(join(dir, 'packages', 'b'), { recursive: true });
  writeFileSync(join(dir, 'packages', 'b', 'package.json'), '{}');
  const pkgs = findWorkspacePackages(dir);
  const labels = pkgs.map((p) => relative(dir, p).replace(/\\/g, '/')).sort();
  check('findWorkspacePackages: npm workspaces array glob', JSON.stringify(labels), JSON.stringify(['packages/a', 'packages/b']));
  rmSync(dir, { recursive: true, force: true });
}

// ------------------------------------------------------- pre-commit gate (real fixtures)
console.log('pre-commit gate (real git fixtures)');

function gitRepo(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  spawnSync('git', ['init', '-q'], { cwd: dir });
  spawnSync('git', ['config', 'user.email', 'abet-test@example.com'], { cwd: dir });
  spawnSync('git', ['config', 'user.name', 'ABET Test'], { cwd: dir });
  return dir;
}

function stage(dir, relPath, content = 'export const x = 1;\n') {
  const abs = join(dir, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
  spawnSync('git', ['add', '--', relPath], { cwd: dir });
}

/** Mirrors lib/toolchain.mjs's ENTRIES — the paths a stub tool must live at to be found. */
const TOOL_ENTRY = {
  eslint: 'node_modules/eslint/bin/eslint.js',
  prettier: 'node_modules/prettier/bin/prettier.cjs',
  tsc: 'node_modules/typescript/bin/tsc',
  jest: 'node_modules/jest/bin/jest.js',
};

/**
 * A stub tool that records its own cwd+argv (as one JSON line) and exits with `exitCode`.
 * On a nonzero exit it also prints a line — `runPreCommitChecks` treats empty stdout as
 * "nothing to report" (real eslint does the same), so a silent failing stub would never block.
 */
function writeStubTool(pkgDir, tool, recordFile, exitCode = 0) {
  const entry = join(pkgDir, TOOL_ENTRY[tool]);
  mkdirSync(dirname(entry), { recursive: true });
  const body = [
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    `const RECORD = ${JSON.stringify(recordFile)};`,
    'fs.mkdirSync(path.dirname(RECORD), { recursive: true });',
    "fs.appendFileSync(RECORD, JSON.stringify({ cwd: process.cwd(), argv: process.argv.slice(2) }) + '\\n');",
    `if (${exitCode} !== 0) console.log('stub ${tool} failure');`,
    `process.exit(${exitCode});`,
    '',
  ].join('\n');
  writeFileSync(entry, body);
}

function readRecords(recordFile) {
  if (!existsSync(recordFile)) return [];
  return readFileSync(recordFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

// --- (a) single-package repo: unchanged behaviour --------------------------------
{
  const dir = gitRepo('abet-pc-single-');
  const records = mkdtempSync(join(tmpdir(), 'abet-pc-single-rec-'));
  const record = (tool) => join(records, `${tool}.ndjson`);

  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: 'single-pkg', private: true,
    scripts: { 'format:fix': 'prettier --write .', 'lint:fix': 'eslint --fix .' },
  }));
  writeFileSync(join(dir, 'tsconfig.json'), '{}');
  for (const tool of ['eslint', 'prettier', 'tsc', 'jest']) writeStubTool(dir, tool, record(tool), 0);
  stage(dir, 'src/a.ts');

  const result = runPreCommitChecks(dir, {});
  check('single-package: all-green stubs pass', result.ok, true);
  check('single-package: prettier invoked with repo root as cwd', readRecords(record('prettier'))[0]?.cwd, dir);
  check('single-package: eslint sees the staged file', readRecords(record('eslint'))[0]?.argv.includes('src/a.ts'), true);
  check('single-package: jest sees the staged file', readRecords(record('jest'))[0]?.argv.includes('src/a.ts'), true);
  check('single-package: tsc runs against tsconfig.json', readRecords(record('tsc'))[0]?.argv.includes('tsconfig.json'), true);

  rmSync(dir, { recursive: true, force: true });
  rmSync(records, { recursive: true, force: true });
}

// --- (a2) single-package repo: a failing tool still blocks, with a root-style hint -
{
  const dir = gitRepo('abet-pc-single-fail-');
  const records = mkdtempSync(join(tmpdir(), 'abet-pc-single-fail-rec-'));
  const record = (tool) => join(records, `${tool}.ndjson`);

  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: 'single-pkg', private: true,
    scripts: { 'lint:fix': 'eslint --fix .' },
  }));
  writeFileSync(join(dir, 'tsconfig.json'), '{}');
  writeStubTool(dir, 'prettier', record('prettier'), 0);
  writeStubTool(dir, 'eslint', record('eslint'), 1); // fails
  writeStubTool(dir, 'tsc', record('tsc'), 0);
  writeStubTool(dir, 'jest', record('jest'), 0);
  stage(dir, 'src/a.ts');

  const result = runPreCommitChecks(dir, {});
  check('single-package: failing eslint blocks the commit', result.ok, false);
  check('single-package: block message is labelled root', result.message.startsWith('root:'), true);
  check('single-package: fixHint uses plain `pnpm run`', result.message.includes('pnpm run lint:fix'), true);

  rmSync(dir, { recursive: true, force: true });
  rmSync(records, { recursive: true, force: true });
}

// --- (b) workspace repo: backend + frontend, each with its own toolchain -----------
function buildWorkspaceRepo(prefix) {
  const dir = gitRepo(prefix);
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'monorepo-root', private: true }));
  writeFileSync(join(dir, 'pnpm-workspace.yaml'), "packages:\n  - 'backend'\n  - 'frontend'\n");
  for (const name of ['backend', 'frontend']) {
    mkdirSync(join(dir, name), { recursive: true });
    writeFileSync(join(dir, name, 'package.json'), JSON.stringify({
      name,
      scripts: { 'format:fix': 'prettier --write .', 'lint:fix': 'eslint --fix .' },
    }));
    writeFileSync(join(dir, name, 'tsconfig.json'), '{}');
  }
  return dir;
}

// (b1) a backend-only commit touches only backend's toolchain, with backend as cwd
{
  const dir = buildWorkspaceRepo('abet-pc-ws-be-');
  const records = mkdtempSync(join(tmpdir(), 'abet-pc-ws-be-rec-'));
  const beRecord = (tool) => join(records, `backend-${tool}.ndjson`);
  const feRecord = (tool) => join(records, `frontend-${tool}.ndjson`);
  for (const tool of ['eslint', 'prettier', 'tsc', 'jest']) {
    writeStubTool(join(dir, 'backend'), tool, beRecord(tool), 0);
    writeStubTool(join(dir, 'frontend'), tool, feRecord(tool), 0);
  }
  stage(dir, 'backend/src/a.ts');

  const result = runPreCommitChecks(dir, {});
  check('workspace: backend-only commit passes', result.ok, true);
  check('workspace: backend eslint cwd is backend/', readRecords(beRecord('eslint'))[0]?.cwd, join(dir, 'backend'));
  check('workspace: backend eslint sees a package-relative path', readRecords(beRecord('eslint'))[0]?.argv.includes('src/a.ts'), true);
  check('workspace: backend prettier invoked', readRecords(beRecord('prettier')).length, 1);
  check('workspace: backend jest invoked', readRecords(beRecord('jest')).length, 1);
  check('workspace: backend tsc invoked', readRecords(beRecord('tsc')).length, 1);
  check('workspace: frontend eslint NOT invoked', readRecords(feRecord('eslint')).length, 0);
  check('workspace: frontend prettier NOT invoked', readRecords(feRecord('prettier')).length, 0);
  check('workspace: frontend tsc NOT invoked', readRecords(feRecord('tsc')).length, 0);
  check('workspace: frontend jest NOT invoked', readRecords(feRecord('jest')).length, 0);

  rmSync(dir, { recursive: true, force: true });
  rmSync(records, { recursive: true, force: true });
}

// (b2) a frontend-only commit is the mirror image
{
  const dir = buildWorkspaceRepo('abet-pc-ws-fe-');
  const records = mkdtempSync(join(tmpdir(), 'abet-pc-ws-fe-rec-'));
  const beRecord = (tool) => join(records, `backend-${tool}.ndjson`);
  const feRecord = (tool) => join(records, `frontend-${tool}.ndjson`);
  for (const tool of ['eslint', 'prettier', 'tsc', 'jest']) {
    writeStubTool(join(dir, 'backend'), tool, beRecord(tool), 0);
    writeStubTool(join(dir, 'frontend'), tool, feRecord(tool), 0);
  }
  stage(dir, 'frontend/src/b.tsx');

  const result = runPreCommitChecks(dir, {});
  check('workspace: frontend-only commit passes', result.ok, true);
  check('workspace: frontend eslint cwd is frontend/', readRecords(feRecord('eslint'))[0]?.cwd, join(dir, 'frontend'));
  check('workspace: frontend eslint sees a package-relative path', readRecords(feRecord('eslint'))[0]?.argv.includes('src/b.tsx'), true);
  check('workspace: backend eslint NOT invoked', readRecords(beRecord('eslint')).length, 0);
  check('workspace: backend jest NOT invoked', readRecords(beRecord('jest')).length, 0);

  rmSync(dir, { recursive: true, force: true });
  rmSync(records, { recursive: true, force: true });
}

// (b3) root-level files never run eslint/tsc/jest once the repo is a real workspace —
// even when tooling happens to be hoisted to the root node_modules — only prettier.
{
  const dir = buildWorkspaceRepo('abet-pc-ws-root-');
  const records = mkdtempSync(join(tmpdir(), 'abet-pc-ws-root-rec-'));
  const rootRecord = (tool) => join(records, `root-${tool}.ndjson`);
  for (const tool of ['eslint', 'prettier', 'tsc', 'jest']) writeStubTool(dir, tool, rootRecord(tool), 0);
  stage(dir, 'scripts/build.mjs');

  const result = runPreCommitChecks(dir, {});
  check('workspace: root-level commit passes', result.ok, true);
  check('workspace: root prettier IS invoked', readRecords(rootRecord('prettier')).length, 1);
  check('workspace: root eslint is NOT invoked, workspace exists', readRecords(rootRecord('eslint')).length, 0);
  check('workspace: root tsc is NOT invoked, workspace exists', readRecords(rootRecord('tsc')).length, 0);
  check('workspace: root jest is NOT invoked, workspace exists', readRecords(rootRecord('jest')).length, 0);

  rmSync(dir, { recursive: true, force: true });
  rmSync(records, { recursive: true, force: true });
}

// (b3b) root-level commit notes when root has no prettier at all
{
  const dir = buildWorkspaceRepo('abet-pc-ws-root-note-');
  stage(dir, 'docker/x.yml', 'image: postgres\n');

  const result = runPreCommitChecks(dir, {});
  check('workspace: root note when prettier missing — still passes', result.ok, true);
  check('workspace: root note mentions prettier not installed',
    result.notes.some((n) => n === 'root: prettier not installed — format check skipped'), true);

  rmSync(dir, { recursive: true, force: true });
}

// (b4) backend/openapi.json stays exempt from every tool, per the shared generated-path filter
{
  const dir = buildWorkspaceRepo('abet-pc-ws-openapi-');
  const records = mkdtempSync(join(tmpdir(), 'abet-pc-ws-openapi-rec-'));
  const beRecord = (tool) => join(records, `backend-${tool}.ndjson`);
  for (const tool of ['eslint', 'prettier', 'tsc', 'jest']) writeStubTool(join(dir, 'backend'), tool, beRecord(tool), 0);
  stage(dir, 'backend/openapi.json', '{"openapi":"3.0.0"}\n');

  const result = runPreCommitChecks(dir, {});
  check('workspace: openapi.json commit passes', result.ok, true);
  check('workspace: openapi.json never reaches prettier', readRecords(beRecord('prettier')).length, 0);
  check('workspace: openapi.json never reaches eslint', readRecords(beRecord('eslint')).length, 0);

  rmSync(dir, { recursive: true, force: true });
  rmSync(records, { recursive: true, force: true });
}

// (b5) touching both packages runs both, and either one failing blocks the commit,
// with a package-scoped `pnpm --filter` fix hint
{
  const dir = buildWorkspaceRepo('abet-pc-ws-both-');
  const records = mkdtempSync(join(tmpdir(), 'abet-pc-ws-both-rec-'));
  const beRecord = (tool) => join(records, `backend-${tool}.ndjson`);
  const feRecord = (tool) => join(records, `frontend-${tool}.ndjson`);
  for (const tool of ['prettier', 'tsc', 'jest']) {
    writeStubTool(join(dir, 'backend'), tool, beRecord(tool), 0);
    writeStubTool(join(dir, 'frontend'), tool, feRecord(tool), 0);
  }
  writeStubTool(join(dir, 'backend'), 'eslint', beRecord('eslint'), 1); // backend fails lint
  writeStubTool(join(dir, 'frontend'), 'eslint', feRecord('eslint'), 0); // frontend is clean

  stage(dir, 'backend/src/a.ts');
  stage(dir, 'frontend/src/b.tsx');

  const result = runPreCommitChecks(dir, {});
  check('workspace: commit touching both packages blocks when one fails', result.ok, false);
  check('workspace: block message is labelled backend', result.message.startsWith('backend:'), true);
  check('workspace: fixHint uses pnpm --filter for the package', result.message.includes('pnpm --filter ./backend run lint:fix'), true);
  check('workspace: backend eslint was invoked', readRecords(beRecord('eslint')).length, 1);
  check('workspace: frontend eslint was ALSO invoked before blocking', readRecords(feRecord('eslint')).length, 1);
  check('workspace: typecheck phase never ran — lint already blocked', readRecords(beRecord('tsc')).length, 0);

  rmSync(dir, { recursive: true, force: true });
  rmSync(records, { recursive: true, force: true });
}

// ------------------------------------------------------- module file naming
console.log('module file naming');

const M = 'backend/src/modules/academic/course-sections';
const named = (path) => (checkModuleFileName(path) === null ? 'ok' : 'bad');

// the files the convention exists to protect
for (const f of ['api/course-sections.service.ts', 'api/course-sections.controller.ts',
  'api/docs/course-sections.swagger.ts', 'model/course-sections.entity.ts',
  'model/course-sections.dtos.ts', 'model/course-sections.types.ts',
  'core/course-sections.repository.ts', 'core/course-sections.validation.ts',
  'core/course-sections.functions.ts', 'config/course-sections.routes.ts',
  'course-sections.module.ts', 'api/course-sections.service.spec.ts',
  'core/course-sections.validation.spec.ts', 'decorators/roles.decorator.ts',
  'config/strings/course-sections.validation.ts', 'core/user-schools/user-schools.repository.ts',
  'core/browser-auth.client.ts']) {
  check(`naming: ${f} is accepted`, named(`${M}/${f}`), 'ok');
}

// what the model actually produced, plus the near misses
// `modules/core/` is a domain group, not the `core/` layer
check('naming: a module inside the `core` domain group is accepted',
  named('backend/src/modules/core/parameters/parameters.module.ts'), 'ok');
check('naming: layers still resolve inside the `core` domain group',
  named('backend/src/modules/core/parameters/api/parameters.service.ts'), 'ok');
check('naming: .bands.ts is rejected', named(`${M}/core/course-sections.bands.ts`), 'bad');
check('naming: .section-filter.ts is rejected', named(`${M}/core/course-sections.section-filter.ts`), 'bad');
check('naming: a kind in the wrong folder is rejected', named(`${M}/core/course-sections.controller.ts`), 'bad');
check('naming: a service in model/ is rejected', named(`${M}/model/course-sections.service.ts`), 'bad');
check('naming: controller at the module root is rejected', named(`${M}/course-sections.controller.ts`), 'bad');
check('naming: kind-less file is rejected', named(`${M}/core/helpers.ts`), 'bad');
check('naming: camelCase name is rejected', named(`${M}/core/courseSections.functions.ts`), 'bad');
check('naming: spec of an unknown kind is rejected', named(`${M}/core/course-sections.bands.spec.ts`), 'bad');
check('naming: message names the offending kind',
  checkModuleFileName(`${M}/core/course-sections.bands.ts`).includes('.bands.ts'), true);
check('naming: message points at .functions.ts',
  checkModuleFileName(`${M}/core/course-sections.bands.ts`).includes('functions'), true);
check('naming: message says where a misplaced kind belongs',
  checkModuleFileName(`${M}/core/course-sections.controller.ts`).includes('`api/`'), true);

// out of scope: anything not under src/modules, and non-TypeScript files
check('naming: outside src/modules is ignored', named('backend/src/libs/global.functions.ts'), 'ok');
check('naming: frontend is ignored', named('frontend/src/modules/x/foo.bands.ts'), 'ok');
check('naming: non-ts file is ignored', named(`${M}/core/notes.md`), 'ok');
check('naming: windows separators are handled', named(`backend\\src\\modules\\a\\b\\core\\b.bands.ts`), 'bad');

// the Write hook
function writeVerdict(file_path) {
  const res = spawnSync(process.execPath, [join(HOOKS, 'file-name-guard.mjs')], {
    input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path, content: '' } }),
    encoding: 'utf8', timeout: 30_000,
  });
  const out = (res.stdout || '').trim();
  return out && JSON.parse(out).hookSpecificOutput?.permissionDecision === 'deny' ? 'deny' : 'allow';
}
check('write hook: denies a new .bands.ts', writeVerdict(join(tmpdir(), `x/${M}/core/course-sections.bands.ts`)), 'deny');
check('write hook: allows a well-named new file', writeVerdict(join(tmpdir(), `x/${M}/core/course-sections.functions.ts`)), 'allow');
check('write hook: ignores other paths', writeVerdict(join(tmpdir(), 'x/README.md')), 'allow');
check('write hook: never blocks rewriting a file that already exists',
  writeVerdict(join(HOOKS, 'checks', 'file-naming.mjs')), 'allow');

// the pre-commit gate: new files are checked, legacy files being modified are not
{
  const dir = buildWorkspaceRepo('abet-pc-naming-');
  stage(dir, `${M}/core/legacy-codes.ts`); // predates the convention
  spawnSync('git', ['commit', '-q', '-m', 'chore: seed'], { cwd: dir });

  stage(dir, `${M}/core/legacy-codes.ts`, 'export const x = 2;\n');
  check('naming gate: modifying a legacy misnamed file passes', runPreCommitChecks(dir, {}).ok, true);

  stage(dir, `${M}/core/course-sections.bands.ts`);
  const blocked = runPreCommitChecks(dir, {});
  check('naming gate: adding a misnamed file blocks', blocked.ok, false);
  check('naming gate: block lists the file', blocked.message.includes('course-sections.bands.ts'), true);
  check('naming gate: ABET_SKIP_NAMING=1 bypasses it', runPreCommitChecks(dir, { ABET_SKIP_NAMING: '1' }).ok, true);

  rmSync(dir, { recursive: true, force: true });
}

// ------------------------------------------------------------ audit-scope
console.log('audit-scope (depth selection)');

const scope = (o) => chooseDepth({ requested: 'auto', lines: 50, files: 3, packages: ['backend'], risky: [], ...o });
check('audit-scope: small clean diff is lite', scope({}).depth, 'lite');
check('audit-scope: many lines is deep', scope({ lines: 401 }).depth, 'deep');
check('audit-scope: exactly at the line limit stays lite', scope({ lines: 400 }).depth, 'lite');
check('audit-scope: many files is deep', scope({ files: 16 }).depth, 'deep');
check('audit-scope: both packages is deep', scope({ packages: ['backend', 'frontend'] }).depth, 'deep');
check('audit-scope: a sensitive path is deep even when tiny',
  scope({ lines: 5, files: 1, risky: [{ file: 'backend/src/database/migrations/1-x.ts', why: 'database migration' }] }).depth, 'deep');
check('audit-scope: --depth lite overrides a big diff', scope({ requested: 'lite', lines: 9000 }).depth, 'lite');
check('audit-scope: --depth deep overrides a tiny diff', scope({ requested: 'deep' }).depth, 'deep');
check('audit-scope: reasons name what tipped it', scope({ lines: 500 }).reasons[0].includes('500'), true);

// what counts as "size": code, not the docs, tests or generated spec around it
{
  const numstat = [
    '30\t2\tbackend/src/modules/a/api/a.service.ts',
    '20\t0\tbackend/src/modules/a/api/a.controller.ts',
    '90\t0\tbackend/src/modules/a/api/a.service.spec.ts',
    '600\t0\topenspec/changes/x/design.md',
    '57\t0\tbackend/openapi.json',
    '5\t1\tbackend/docs/CONTEXT.md',
    '-\t-\tlogo.png',
  ].join('\n');
  const m = measure(numstat);
  check('audit-scope: only non-test source counts as lines', m.lines, 52);
  check('audit-scope: only non-test source counts as files (binary included)', m.files, 3);
  check('audit-scope: the raw total still includes everything', m.totalLines, 805);
  check('audit-scope: a normal API change is lite (docs, tests and openapi.json do not tip it)',
    chooseDepth({ requested: 'auto', lines: m.lines, files: m.files, packages: ['backend'], risky: ['openapi.json'].flatMap((f) => RISKY.filter((r) => r.re.test(f))) }).depth, 'lite');
  check('audit-scope: openapi.json is not a risky path', RISKY.some((r) => r.re.test('backend/openapi.json')), false);
}

const riskyOf = (f) => RISKY.some((r) => r.re.test(f));
check('audit-scope: migrations are risky', riskyOf('backend/src/database/migrations/1700-add.ts'), true);
check('audit-scope: auth folder is risky', riskyOf('backend/src/modules/auth/guards/jwt.guard.ts'), true);
check('audit-scope: an ordinary service is not', riskyOf('backend/src/modules/academic/courses/api/courses.service.ts'), false);
check('audit-scope: packageOf backend', packageOf('backend/src/x.ts'), 'backend');
check('audit-scope: packageOf root file', packageOf('docker/compose.yml'), 'root');

{
  const dir = mkdtempSync(join(tmpdir(), 'abet-scope-'));
  writeFileSync(join(dir, 'tasks.md'), '- [x] one\n  - [X] two\n- [ ] three\nnot a task\n');
  writeFileSync(join(dir, 'tasks-backend.md'), '- [ ] four\n');
  writeFileSync(join(dir, 'design.md'), '- [ ] ignored, not a tasks file\n');
  const c = countTasks(dir);
  check('audit-scope: counts open tasks across tasks*.md only', c.open, 2);
  check('audit-scope: counts done tasks, either case', c.done, 2);
  rmSync(dir, { recursive: true, force: true });
}

// docs-currency lookup: terms the diff introduces, matched against CONTEXT.md lines
check('audit-scope: a scoped package yields itself and its short name',
  newTerms(["+import { S3Client } from '@aws-sdk/client-s3';"]).join(','), '@aws-sdk/client-s3,s3');
check('audit-scope: relative and src/ imports are not terms',
  newTerms(["+import { a } from './a';", "+import { b } from 'src/libs/b';"]).length, 0);
check('audit-scope: env vars are terms', newTerms(['+const r = process.env.AWS_REGION;']).join(','), 'AWS_REGION');
{
  // `nestjs` appears on 7 lines, so it is generic and must be dropped; `s3` appears once.
  const docs = [{ file: 'backend/docs/CONTEXT.md', text: `intro\nAWS S3 is configured but not yet wired\n${'nestjs\n'.repeat(7)}` }];
  const hits = findDocHits(['s3', 'nestjs', 'kafka'], docs);
  check('audit-scope: a doc line naming the term is returned', hits.length, 1);
  check('audit-scope: the hit carries file and line', `${hits[0].file}:${hits[0].line}`, 'backend/docs/CONTEXT.md:2');
  check('audit-scope: a term absent from the docs yields nothing', findDocHits(['kafka'], docs).length, 0);
  check('audit-scope: a generic term (many hits) is dropped',
    findDocHits(['x'], [{ file: 'f', text: Array(7).fill('x here').join('\n') }]).length, 0);
  check('audit-scope: matching is on whole words', findDocHits(['s3'], [{ file: 'f', text: 'ms3x' }]).length, 0);
}

// rules checklist: one line per `##` heading, none invented from code fences
check('audit-scope: headings are the ## sections only',
  headingsOf('# Title\n## One\ntext\n### Sub\n## Two\n').join('|'), 'One|Two');
check('audit-scope: a ## inside a code fence is not a heading',
  headingsOf('## Real\n```md\n## Example\n```\n## Also real\n').join('|'), 'Real|Also real');

// dead code: new files nothing imports, new exports nothing references
{
  const diff = [
    '+++ b/backend/src/m/core/m.section-filter.ts', '+export const sectionFilter = () => 1;',
    '+++ b/backend/src/m/core/m.repository.ts', '+export async function loadBands() {}', '+export class Used {}',
    '+++ b/backend/src/m/core/m.functions.spec.ts', '+export const fixture = 1;',
    '+++ b/backend/src/database/migrations/1-x.ts', '+export class AddX1 {}',
    '+++ b/README.md', '+ignored',
  ].join('\n');
  const added = addedByFile(diff);
  check('audit-scope: additions are grouped by file', [...added.keys()].length, 5);
  check('audit-scope: exports are extracted by name', exportedNames(added.get('backend/src/m/core/m.repository.ts')).join(','), 'loadBands,Used');
  const used = new Set(['Used']);
  const dead = findDeadCode({
    addedFiles: new Set(['backend/src/m/core/m.section-filter.ts']),
    added,
    usedElsewhere: (term) => used.has(term),
  });
  check('audit-scope: a new file nothing imports is dead', dead.some((d) => d.file.endsWith('section-filter.ts') && !d.name), true);
  check('audit-scope: an unreferenced new export is dead', dead.some((d) => d.name === 'loadBands'), true);
  check('audit-scope: a referenced export is not dead', dead.some((d) => d.name === 'Used'), false);
  check('audit-scope: specs and migrations are never candidates', dead.some((d) => /spec|migrations/.test(d.file)), false);
  check('audit-scope: a dead file does not also list its exports',
    dead.filter((d) => d.file.endsWith('section-filter.ts')).length, 1);
}

// ------------------------------------------------------------ reuse detection
console.log('reuse detection (rule of three)');

const LOGIC = (v = 'rows', f = 'filterActive') => `
export async function ${f}(repo, ${v}, schoolId) {
	const result = [];
	for (const item of ${v}) {
		const found = await repo.findOne({ where: { id: item.id, schoolId } });
		if (!found) {
			throw new DomainError('error.not-found');
		}
		if (found.status !== 'ACTIVE') {
			continue;
		}
		result.push({ id: found.id, name: found.name.trim() });
	}
	return result;
}
`;
const allNew = (text) => new Set(text.split('\n').map((_, i) => i + 1));
const clones = (target, others, file = 'backend/src/modules/a/b/core/b.functions.ts') =>
  findClones({
    targets: [{ file, text: target, addedNums: allNew(target) }],
    corpus: others.map((text, i) => ({ file: `backend/src/modules/x/y${i}/core/y${i}.functions.ts`, text })),
  });

check('reuse: no other copy is no finding', clones(LOGIC(), []).length, 0);
{
  const one = clones(LOGIC(), [LOGIC()]);
  check('reuse: one other copy is a tolerated pair', `${one[0]?.copies}/${one[0]?.verdict}`, '2/tolerated');
  const two = clones(LOGIC(), [LOGIC(), LOGIC()]);
  check('reuse: two other copies is the third — extract', `${two[0]?.copies}/${two[0]?.verdict}`, '3/extract');
  check('reuse: the finding lists every location', two[0]?.locations.length, 3);
  const many = clones(LOGIC(), [LOGIC(), LOGIC(), LOGIC(), LOGIC()]);
  check('reuse: more copies keep counting', many[0]?.copies, 5);
}
{
  const renamed = clones(LOGIC('rows', 'filterActive'), [LOGIC('items', 'pickActive'), LOGIC('list', 'keepActive')]);
  check('reuse: renamed copies are found', `${renamed[0]?.copies}/${renamed[0]?.kind}`, '3/renamed');
  const mixed = clones(LOGIC(), [LOGIC(), LOGIC('items', 'pickActive')]);
  check('reuse: an exact copy makes the finding exact', mixed[0]?.kind, 'exact');
}
{
  const unrelated = `
export function total(list) {
	let sum = 0;
	for (const n of list) {
		sum += n.amount * n.quantity;
	}
	return sum;
}
`;
  check('reuse: different code is not a clone', clones(LOGIC(), [unrelated, unrelated]).length, 0);
}
{
  // a window that overlaps no added line is not the diff's code
  const target = LOGIC();
  const found = findClones({
    targets: [{ file: 'backend/src/modules/a/b/core/b.functions.ts', text: target, addedNums: new Set() }],
    corpus: [{ file: 'backend/src/modules/x/y/core/y.functions.ts', text: LOGIC() }],
  });
  check('reuse: unchanged code is never reported', found.length, 0);
}
{
  // existing scaffolding with one new line next to it is not the diff's copy
  const target = LOGIC();
  const lineCount = target.split('\n').length;
  const one = findClones({
    targets: [{ file: 'backend/src/modules/a/b/core/b.functions.ts', text: target, addedNums: new Set([3]) }],
    corpus: [{ file: 'backend/src/modules/x/y/core/y.functions.ts', text: LOGIC() }],
  });
  check('reuse: one new line beside existing scaffolding is not a copy', one.length, 0);
  const most = findClones({
    targets: [{ file: 'backend/src/modules/a/b/core/b.functions.ts', text: target, addedNums: new Set(Array.from({ length: lineCount - 2 }, (_, i) => i + 2)) }],
    corpus: [{ file: 'backend/src/modules/x/y/core/y.functions.ts', text: LOGIC() }],
  });
  check('reuse: a block that is mostly new is still found', most.length, 1);
}
{
  const imports = `import {\n\tSwaggerCreate,\n\tSwaggerUpdate,\n\tSwaggerDelete,\n\tSwaggerGetAll,\n\tSwaggerGetById,\n\tSwaggerFilters,\n\tSwaggerMaintenance,\n\tSwaggerList,\n\tSwaggerRemove,\n} from './docs/x.swagger';\n`;
  check('reuse: repeated multi-line imports are ignored', clones(imports + LOGIC('a', 'f1'), [imports, imports, imports]).length, 0);
  check('reuse: tests are never compared', findClones({
    targets: [{ file: 'backend/src/modules/a/b/core/b.functions.ts', text: LOGIC(), addedNums: allNew(LOGIC()) }],
    corpus: [{ file: 'backend/src/modules/x/y/core/y.functions.spec.ts', text: LOGIC() }],
  }).length, 0);
  check('reuse: declarative kinds (dtos) are never compared', findClones({
    targets: [{ file: 'backend/src/modules/a/b/model/b.dtos.ts', text: LOGIC(), addedNums: allNew(LOGIC()) }],
    corpus: [{ file: 'backend/src/modules/x/y/model/y.dtos.ts', text: LOGIC() }],
  }).length, 0);
}
{
  const a = { file: 'backend/src/modules/a/api/a.service.ts', text: LOGIC(), addedNums: allNew(LOGIC()) };
  const b = { file: 'backend/src/modules/b/api/b.service.ts', text: LOGIC(), addedNums: allNew(LOGIC()) };
  const both = findClones({ targets: [a, b], corpus: [{ file: a.file, text: a.text }, { file: b.file, text: b.text }] });
  check('reuse: a copy between two new files is one finding', `${both.length}/${both[0]?.copies}`, '1/2');
  const self = findClones({ targets: [a], corpus: [{ file: a.file, text: a.text }] });
  check('reuse: a file is not a copy of itself', self.length, 0);
}
{
  // a block found in many places is a standardised template, not a missed reuse
  const template = clones(LOGIC(), Array(13).fill(LOGIC()));
  check('reuse: a block in more than 12 places is a template', `${template[0]?.copies}/${template[0]?.verdict}`, '14/template');
  const twelve = clones(LOGIC(), Array(11).fill(LOGIC()));
  check('reuse: 12 copies is still a finding, not yet a template', twelve[0]?.verdict, 'extract');
  // code in different packages cannot share an extraction
  const cross = findClones({
    targets: [{ file: 'backend/src/modules/a/api/a.service.ts', text: LOGIC(), addedNums: allNew(LOGIC()) }],
    corpus: [{ file: 'frontend/src/modules/a/hooks/useA.ts', text: LOGIC() }, { file: 'frontend/src/modules/b/hooks/useB.ts', text: LOGIC() }],
  });
  check('reuse: a copy in the other package is not a copy', cross.length, 0);
  // interface members are declarations, not logic
  const members = Array.from({ length: 14 }, (_, i) => `\tfield${i}: string;`).join('\n');
  check('reuse: repeated interface members are ignored',
    clones(`export interface A {\n${members}\n}`, [`export interface B {\n${members}\n}`, `export interface C {\n${members}\n}`]).length, 0);
}
check('reuse: comments and whitespace do not hide a copy', clones(LOGIC(), [LOGIC().replace(/\t/g, '    ').replace('const result', '// build it\n\tconst result')]).length, 1);

// ------------------------------------------------------------ security scan
console.log('security scan');

const scan = (file, text, extra = {}) => scanSecurity({
  added: new Map([[file, text.split('\n').map((t, i) => ({ n: i + 1, text: t }))]]),
  readFile: () => extra.full ?? text,
}).map((h) => h.rule);
const C = 'backend/src/modules/a/b/api/b.controller.ts';
const S = 'backend/src/modules/a/b/api/b.service.ts';

check('security: schoolId from @Query is flagged', scan(C, "async f(@Query('schoolId') s: number) {}").includes('scope-from-request'), true);
check('security: schoolId from @Body is flagged', scan(C, "f(@Body('schoolId') s) {}").includes('scope-from-request'), true);
check('security: @SchoolId() header decorator is fine', scan(C, 'async f(@SchoolId() schoolId: number) {}').includes('scope-from-request'), false);
check('security: a scope field in a DTO is flagged', scan('backend/src/modules/a/b/model/b.dtos.ts', '\tschoolId: number;').includes('scope-in-dto'), true);
check('security: @Public() is flagged for confirmation', scan(C, '@Public()').includes('public-route'), true);
check('security: @SkipPermissions() is flagged', scan(C, '@SkipPermissions()').includes('skip-permissions'), true);
check('security: raw process.env is flagged', scan(S, 'const k = process.env.KEY;').includes('process-env'), true);
check('security: process.env in a config file is allowed', scan('backend/src/commons/configs/env.config.ts', 'const k = process.env.KEY;').includes('process-env'), false);
check('security: eval is flagged', scan(S, 'eval(userInput);').includes('dangerous-api'), true);
check('security: md5 is flagged', scan(S, "createHash('md5')").includes('weak-crypto'), true);
check('security: logging a token is flagged', scan(S, 'this.logger.log(`token ${token}`);').includes('log-sensitive'), true);
check('security: tests are not scanned', scan('backend/src/modules/a/b/api/b.service.spec.ts', 'eval(x); process.env.A;').length, 0);
check('security: an unscoped cache key is flagged', scan(S, 'const c = this.bandCache.get(courseId);').includes('cache-key-without-scope'), true);
check('security: a scoped cache key is fine', scan(S, 'const c = this.bandCache.get(`${schoolId}:${courseId}`);').includes('cache-key-without-scope'), false);
check('security: SQL built with a template literal is flagged', scan(S, 'await ds.query(`SELECT * FROM t WHERE id = ${id}`);').includes('sql-interpolation'), true);
check('security: SQL built by concatenation is flagged', scan(S, "await ds.query('SELECT * FROM t WHERE id = ' + id);").includes('sql-interpolation'), true);
check('security: parameterised SQL is fine', scan(S, "await ds.query('SELECT * FROM t WHERE id = $1', [id]);").includes('sql-interpolation'), false);
check('security: a comma inside the SQL string does not fool it', scan(S, "await ds.query('SELECT a, b FROM t WHERE id = $1', [id]);").includes('sql-interpolation'), false);

const CTRL = `import { Controller } from '@nestjs/common';

@Controller('x')
export class XController {
	@Get(':id')
	@RequirePermission({ module: M, action: A })
	async ok() {}

	@Post('go')
	async unprotected() {}

	@SwaggerXPublic()
	@Public()
	async open() {}

	@Post('m2m')
	@ApiTokenAuth()
	@SkipPermissions()
	async both() {}
}
`;
{
  const issues = findRouteAuthIssues({ text: CTRL, addedNums: allNew(CTRL) });
  const by = (rule) => issues.filter((i) => i.rule === rule).map((i) => i.text);
  check('security: a route with no auth decorator is flagged', by('route-without-permission').join(','), 'unprotected');
  check('security: @RequirePermission and @Public routes pass', by('route-without-permission').includes('ok') || by('route-without-permission').includes('open'), false);
  check('security: @ApiTokenAuth + @SkipPermissions is flagged', by('api-token-skip-permissions').join(','), 'both');
  check('security: only routes the diff touched are reported',
    findRouteAuthIssues({ text: CTRL, addedNums: new Set([1]) }).length, 0);
  const classLevel = "@RequirePermission({ module: M, action: A })\nexport class YController {\n\t@Get()\n\tasync a() {}\n}\n";
  check('security: a class-level permission covers its routes', findRouteAuthIssues({ text: classLevel, addedNums: allNew(classLevel) }).length, 0);
  const swagger = "export class ZController {\n\t@SwaggerZCreate()\n\tasync create() {}\n}\n";
  check('security: a Swagger-decorated method counts as an endpoint',
    findRouteAuthIssues({ text: swagger, addedNums: allNew(swagger) }).map((i) => i.rule).join(','), 'route-without-permission');
}
// scope-param-unused: promoted from the audit ledger (an IDOR the auditor kept finding by hand)
{
  const unused = (src, nums) => findUnusedScopeParams({ text: src, addedNums: nums ?? allNew(src) }).map((i) => i.text);
  check('scope-param-unused: an accepted, dropped schoolId is flagged',
    unused('class S {\n\tasync getRoster(id: number, schoolId: number) {\n\t\treturn this.repo.findRoster(id);\n\t}\n}').join(), 'getRoster(… schoolId …)');
  check('scope-param-unused: a used schoolId is fine',
    unused('class S {\n\tasync getRoster(id: number, schoolId: number) {\n\t\treturn this.repo.findRoster(id, schoolId);\n\t}\n}').length, 0);
  check('scope-param-unused: shorthand `{ schoolId }` counts as use',
    unused('class S {\n\tasync f(schoolId: number) {\n\t\treturn this.repo.find({ where: { schoolId } });\n\t}\n}').length, 0);
  // regression: braces in the return type must not be mistaken for the body
  check('scope-param-unused: a Promise<{ … }> return type does not hide the real body',
    unused('class S {\n\tasync get(\n\t\tid: number,\n\t\tschoolId: number,\n\t): Promise<{ rows: number[] }> {\n\t\tconst ctx = await this.load(id, schoolId);\n\t\treturn ctx;\n\t}\n}').length, 0);
  // regression: a multi-line call is not a declaration
  check('scope-param-unused: a call spanning lines is not a function',
    unused('class S {\n\tasync f() {\n\t\treturn this.pdf.build(\n\t\t\ttoRequester(principal, schoolId),\n\t\t\tid,\n\t\t\t{ lang },\n\t\t);\n\t}\n}').length, 0);
  check('scope-param-unused: a decorated controller param that is never passed on is flagged',
    unused('class C {\n\t@Get()\n\tasync run(\n\t\t@Body() dto: D,\n\t\t@AcademicPeriodId() academicPeriodId: number,\n\t) {\n\t\treturn this.svc.run(dto);\n\t}\n}').join(), 'run(… academicPeriodId …)');
  check('scope-param-unused: a declaration with no body is ignored', unused('interface R {\n\tfind(id: number, schoolId: number): void;\n}').length, 0);
  check('scope-param-unused: a signature the diff did not touch is not reported',
    unused('class S {\n\tasync f(id: number, schoolId: number) {\n\t\treturn 1;\n\t}\n}', new Set([99])).length, 0);
  check('scope-param-unused: the scanner reports it on services',
    scan('backend/src/modules/a/b/api/b.service.ts', 'async getRoster(id: number, schoolId: number) {\n\treturn this.repo.findRoster(id);\n}').includes('scope-param-unused'), true);
}
check('security: addedLines numbers lines from the hunk header',
  addedLines('+++ b/x.ts\n@@ -1,0 +10,2 @@\n+a\n+b\n').get('x.ts').map((l) => l.n).join(','), '10,11');

// ------------------------------------------------------------- audit ledger
console.log('audit ledger');

const MECH = { area: 'security', source: 'mechanical', rule: 'cache-key-without-scope', category: 'scope-leak', severity: 'blocker', verdict: 'confirmed', file: 'a.service.ts', line: 31, summary: 'cache keyed by courseId only' };
const JUDG = { area: 'security', source: 'judgment', category: 'idor', severity: 'major', verdict: 'confirmed', file: 'b.controller.ts', line: 12,
  summary: 'roster returned by section id without a school check', pattern: 'controller returns a row by :id without passing the school to the repository',
  detect: 'route param :id flows into repository.findOne with no schoolId argument', convertible: 'medium' };
const errs = (r) => validateRecord(r);

check('ledger: a mechanical confirmed record is valid', errs(MECH).length, 0);
check('ledger: a mechanical false positive with a reason is valid',
  errs({ ...MECH, verdict: 'false-positive', severity: undefined, reason: 'the cached data is global' }).length, 0);
check('ledger: a judgment record is valid', errs(JUDG).length, 0);
check('ledger: an unknown field is rejected (a typo must not vanish)', errs({ ...MECH, servrity: 'x' }).some((e) => /unknown field "servrity"/.test(e)), true);
check('ledger: a mechanical record needs its rule', errs({ ...MECH, rule: undefined }).some((e) => /rule is required/.test(e)), true);
check('ledger: a judgment record needs the code shape', errs({ ...JUDG, pattern: undefined }).some((e) => /pattern is required/.test(e)), true);
check('ledger: a judgment record needs a detection note', errs({ ...JUDG, detect: '' }).some((e) => /detect is required/.test(e)), true);
check('ledger: a judgment record needs a convertibility estimate', errs({ ...JUDG, convertible: 'maybe' }).some((e) => /convertible must be/.test(e)), true);
check('ledger: a judgment record cannot carry a rule', errs({ ...JUDG, rule: 'x' }).some((e) => /no rule/.test(e)), true);
check('ledger: a judgment finding cannot be a false positive', errs({ ...JUDG, verdict: 'false-positive', reason: 'r' }).some((e) => /only a mechanical hit/.test(e)), true);
check('ledger: a false positive must say why', errs({ ...MECH, verdict: 'false-positive' }).some((e) => /reason is required/.test(e)), true);
check('ledger: a confirmed finding needs a severity', errs({ ...MECH, severity: undefined }).some((e) => /severity must be/.test(e)), true);
check('ledger: an invalid category is rejected', errs({ ...MECH, category: 'vibes' }).some((e) => /category must be/.test(e)), true);
check('ledger: line must be a positive integer', errs({ ...MECH, line: 0 }).some((e) => /line must be/.test(e)), true);
check('ledger: a non-object is rejected', errs('x').length, 1);

{
  const rec = (o, i = 0) => ({ v: 1, date: `2026-0${1 + (i % 6)}-10`, branch: `feat/b${i}`, ...o });
  // rule precision: 8 hits, 2 wrong = 75% (healthy); 6 hits, 3 wrong = 50% (watch); 3 hits = too few
  const many = (rule, ok, bad) => [
    ...Array.from({ length: ok }, (_, i) => rec({ ...MECH, rule }, i)),
    ...Array.from({ length: bad }, (_, i) => rec({ ...MECH, rule, verdict: 'false-positive', severity: undefined, reason: `reason ${i}` }, i)),
  ];
  const agg = aggregate([...many('healthy-rule', 6, 2), ...many('watch-rule', 3, 3), ...many('noisy-rule', 1, 4), ...many('rare-rule', 2, 1)]);
  const advice = (r) => agg.rules.find((x) => x.rule === r).advice;
  check('ledger report: a mostly-right rule is healthy', advice('healthy-rule'), 'healthy');
  check('ledger report: a half-wrong rule is on watch', advice('watch-rule'), 'watch: a third of its hits are wrong');
  check('ledger report: a mostly-wrong rule is called noisy', advice('noisy-rule'), 'noisy: tighten the rule');
  check('ledger report: too few hits to judge a rule', advice('rare-rule'), 'too few hits to judge');
  check('ledger report: precision is confirmed / hits', agg.rules.find((r) => r.rule === 'healthy-rule').precision, 0.75);

  // judgment grouping and promotion
  const idor = (extra = {}, i = 0) => rec({ ...JUDG, ...extra }, i);
  const g2 = aggregate([idor({}, 0), idor({ pattern: 'a controller returns a row by :id and never passes the school to the repository' }, 1)]);
  check('ledger report: the same shape in different words is one group', g2.judgment.length, 1);
  check('ledger report: a recurring, convertible shape is promoted', g2.judgment[0].recommendation, 'promote to a mechanical rule');
  check('ledger report: the group counts its occurrences', g2.judgment[0].count, 2);
  const once = aggregate([idor()]);
  check('ledger report: seen once is only watched', once.judgment[0].recommendation, 'seen once: keep watching');
  const blocker = aggregate([idor({ severity: 'blocker' })]);
  check('ledger report: a single blocker that a rule could catch is promoted', blocker.judgment[0].recommendation, 'promote to a mechanical rule');
  const hard = aggregate([idor({ convertible: 'low' }, 0), idor({ convertible: 'low' }, 1)]);
  check('ledger report: recurring but unconvertible stays judgment', hard.judgment[0].recommendation, 'recurring, but hard to detect: keep as judgment');
  const apart = aggregate([idor({}, 0), idor({ category: 'ssrf', pattern: 'fetches a caller-supplied url without an allowlist' }, 1)]);
  check('ledger report: different categories never merge', apart.judgment.length, 2);
  check('ledger report: dropped mechanical hits are not judgment groups', aggregate(many('r', 0, 3)).judgment.length, 0);
  // re-auditing one branch is one observation; recurrence means different changes
  const rerun = aggregate([rec({ ...JUDG, severity: 'major' }, 0), rec({ ...JUDG, severity: 'major' }, 0), rec({ ...JUDG, severity: 'major' }, 0)]);
  check('ledger report: reruns on one branch do not make a gap look recurrent', `${rerun.judgment[0].count}/${rerun.judgment[0].recommendation}`, '1/seen once: keep watching');
  const dup = aggregate([...many('r', 6, 0), ...many('r', 6, 0)]);
  check('ledger report: the same hit recorded twice counts once', dup.rules[0].hits, 6);
  // two real phrasings of the same IDOR, from two runs of the audit on the fixture
  const phrasing = aggregate([
    rec({ ...JUDG, branch: 'feat/x', pattern: 'service/repository method receives schoolId param but the SQL has no school_id predicate', detect: 'param named schoolId unused in function body' }, 0),
    rec({ ...JUDG, branch: 'feat/y', pattern: 'service method receives schoolId but the repository query takes only a record id', detect: 'needs judgment' }, 1),
  ]);
  check('ledger report: differently worded IDORs cluster', `${phrasing.judgment.length}/${phrasing.judgment[0].count}`, '1/2');
  const md = renderReport(g2);
  check('ledger report: the markdown names what to promote', /Promote to mechanical rules \(1\)/.test(md), true);
  check('ledger report: the markdown carries the detection idea', md.includes('repository.findOne with no schoolId'), true);
  check('ledger report: an empty ledger says so', /None yet/.test(renderReport(aggregate([]))), true);
}

// the CLI, end to end in a real repo
{
  const dir = gitRepo('abet-ledger-');
  spawnSync('git', ['commit', '--allow-empty', '-q', '-m', 'chore: init'], { cwd: dir });
  spawnSync('git', ['checkout', '-q', '-b', 'fix/scope-bug'], { cwd: dir });
  const ledger = (args, input) => spawnSync(process.execPath, [join(HOOKS, '..', 'scripts', 'audit-ledger.mjs'), ...args], { cwd: dir, input, encoding: 'utf8' });

  const bad = ledger(['add'], JSON.stringify([MECH, { ...JUDG, pattern: undefined }]));
  check('ledger cli: an invalid record fails the whole batch', bad.status, 1);
  check('ledger cli: the error names the record and the field', /record 2: pattern is required/.test(bad.stderr), true);
  check('ledger cli: nothing is written when any record is invalid', existsSync(join(dir, 'openspec')), false);
  check('ledger cli: bad JSON is reported', ledger(['add'], 'not json').status, 1);

  const ok = ledger(['add'], JSON.stringify([MECH, JUDG]));
  check('ledger cli: valid records are appended', JSON.parse(ok.stdout).appended, 2);
  const file = join(dir, 'openspec', 'audit-ledger', 'scope-bug.jsonl');
  check('ledger cli: with no change folder it uses the bug-lane ledger', existsSync(file), true);
  const lines = readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  check('ledger cli: each line is stamped with version, branch and sha', `${lines[0].v}/${lines[0].branch}/${lines[0].sha?.length > 0}`, '1/fix/scope-bug/true');

  spawnSync('git', ['checkout', '-q', '-b', 'feat/with-change'], { cwd: dir });
  mkdirSync(join(dir, 'openspec', 'changes', 'with-change'), { recursive: true });
  ledger(['add'], JSON.stringify(JUDG));
  check('ledger cli: with a change folder it lives beside the change', existsSync(join(dir, 'openspec', 'changes', 'with-change', 'audit.jsonl')), true);

  // the review lane: someone else's PR gets its own file and never touches the change folder
  const noPr = ledger(['add', '--lane', 'review'], JSON.stringify(JUDG));
  check('ledger cli: a review needs the PR number', `${noPr.status}/${/needs --pr/.test(noPr.stderr)}`, '1/true');
  check('ledger cli: an unknown lane is rejected', ledger(['add', '--lane', 'x'], JSON.stringify(JUDG)).status, 1);
  const rv = ledger(['add', '--lane', 'review', '--pr', '42'], JSON.stringify([JUDG]));
  const reviewFile = join(dir, 'openspec', 'audit-ledger', 'review-42.jsonl');
  check('ledger cli: a review is recorded per PR', `${rv.status}/${existsSync(reviewFile)}`, '0/true');
  const rvLine = JSON.parse(readFileSync(reviewFile, 'utf8').trim());
  check('ledger cli: a review record is stamped with its lane and PR', `${rvLine.lane}/${rvLine.pr}`, 'review/42');
  check('ledger cli: a review does not write into the change folder',
    readFileSync(join(dir, 'openspec', 'changes', 'with-change', 'audit.jsonl'), 'utf8').trim().split('\n').length, 1);

  const rep = ledger(['report']);
  check('ledger cli: report reads every ledger', /4 findings across 2 branch/.test(rep.stdout), true);
  check('ledger cli: report separates own audits from peer reviews', /own audits 3, peer reviews 1/.test(rep.stdout), true);
  const json = JSON.parse(ledger(['report', '--json']).stdout);
  check('ledger cli: report --json is machine-readable', json.bySource.judgment, 3);
  writeFileSync(file, readFileSync(file, 'utf8') + 'not json\n');
  check('ledger cli: a corrupt line is skipped, not fatal', JSON.parse(ledger(['report', '--json']).stdout).malformed, 1);
  rmSync(dir, { recursive: true, force: true });
}

// ------------------------------------------- scripts run through a package link
console.log('scripts through a link (how pnpm installs the package)');

// pnpm links node_modules/abet-plugins into .pnpm/; the agent types the LINK path. A script that
// decides "was I run directly?" by comparing that path to its real one prints nothing at all,
// which reads as "cannot run the script". Each CLI must answer when started through a link.
{
  const base = mkdtempSync(join(tmpdir(), 'abet-link-'));
  const real = join(base, 'real');
  mkdirSync(real);
  cpSync(join(HOOKS, '..', 'scripts'), join(real, 'scripts'), { recursive: true });
  cpSync(join(HOOKS, 'lib'), join(real, 'hooks', 'lib'), { recursive: true });
  const link = join(base, 'link');
  symlinkSync(real, link, 'junction'); // a junction needs no privilege on Windows; ignored elsewhere
  const work = mkdtempSync(join(tmpdir(), 'abet-link-cwd-')); // not a git repo: each script must still say something
  const out = (dir, script, args = []) => spawnSync(process.execPath, [join(dir, 'scripts', script), ...args], { cwd: work, encoding: 'utf8' }).stdout.trim();

  for (const [script, args] of [['audit-scope.mjs', []], ['lean-gate.mjs', []], ['audit-ledger.mjs', ['path']]]) {
    const viaReal = out(real, script, args);
    const viaLink = out(link, script, args);
    check(`link: ${script} prints something when run from its real path`, viaReal.length > 0, true);
    check(`link: ${script} prints the same through a link`, viaLink, viaReal);
  }
  check('link: isMain is true for a link to the running script',
    isMain(pathToFileURL(join(real, 'scripts', 'lean-gate.mjs')).href, join(link, 'scripts', 'lean-gate.mjs')), true);
  check('link: isMain is false for a different script',
    isMain(pathToFileURL(join(real, 'scripts', 'lean-gate.mjs')).href, join(real, 'scripts', 'audit-scope.mjs')), false);
  check('link: isMain is false when there is no argv[1]', isMain(pathToFileURL(join(real, 'scripts', 'lean-gate.mjs')).href, undefined), false);
  check('link: isMain is false for a path that does not exist',
    isMain(pathToFileURL(join(real, 'scripts', 'lean-gate.mjs')).href, join(base, 'nope.mjs')), false);
  rmSync(base, { recursive: true, force: true }); // everything under it is a throwaway copy
  rmSync(work, { recursive: true, force: true });
}

// ---------------------------------------------------------------- lean gate
console.log('lean gate (quick lane eligibility)');

// annotations go OUTSIDE the backticks, as templates/tasks.md writes them: - `path` (modify)
const fileLine = (f) => {
  const m = /^(\S+)(?: \((.*)\))?$/.exec(f);
  return `- \`${m[1]}\`${m[2] ? ` (${m[2]})` : ''}`;
};
const box = (n, files) => `### Task ${n} — t${n}\n\n- [ ] Task complete\n\n**Files**\n${files.map(fileLine).join('\n')}\n`;
const plan = (taskFiles) => `# Tasks\n\n${taskFiles.map((f, i) => box(i + 1, f)).join('\n')}`;
const SCOPE_TABLE = '| Table | Scoped to the caller\'s school by | Can rows be shared across schools? | Covered by |\n| --- | --- | --- | --- |\n';
const scopeSection = (rows) => `## Scope check\n\n${SCOPE_TABLE}${rows}\n\n`;
const OK_ROW = '| academic.course_sections | EXISTS over the school\'s study plans | No: one section, one course (unique key) | AC-1 |';
const PROP = `# P\n\n## Acceptance criteria\n1. x\n\n${scopeSection(OK_ROW)}## Open questions\n\nNone\n`;
const propWith = (rows) => `# P\n\n## Acceptance criteria\n1. x\n\n${rows === null ? '' : scopeSection(rows)}## Open questions\n\nNone\n`;
const B = 'backend/src/modules/a/b';
const small = plan([[`${B}/api/b.controller.ts (modify)`, `${B}/api/b.controller.spec.ts (test)`], [`${B}/api/b.service.ts (modify)`], [`${B}/core/b.repository.ts (modify)`]]);
const lean = (proposal, tasks) => checkLean({ proposal, tasks });

check('lean gate: a small, clean plan is eligible', lean(PROP, small).eligible, true);
check('lean gate: it reports what it counted', JSON.stringify(lean(PROP, small).stats), '{"tasks":3,"sourceFiles":3,"files":4,"packages":["backend"]}');
check('lean gate: more than 5 tasks goes to the full lane', lean(PROP, plan(Array.from({ length: 6 }, (_, i) => [`${B}/f${i}.ts`]))).reasons.some((r) => /6 tasks/.test(r)), true);
check('lean gate: too many source files goes to the full lane',
  lean(PROP, plan([Array.from({ length: BOUNDS.sourceFiles + 1 }, (_, i) => `${B}/f${i}.ts`)])).reasons.some((r) => /source files/.test(r)), true);
check('lean gate: exactly the bound is still eligible',
  lean(PROP, plan([Array.from({ length: BOUNDS.sourceFiles }, (_, i) => `${B}/f${i}.ts`)])).eligible, true);
check('lean gate: a layered endpoint (7 files) fits — the bound is calibrated on this codebase',
  lean(PROP, plan([['controller', 'service', 'repository', 'validation', 'dtos', 'swagger', 'routes'].map((k) => `${B}/${k}.ts`)])).eligible, true);
check('lean gate: tests are not counted against the change',
  lean(PROP, plan([[...Array.from({ length: 8 }, (_, i) => `${B}/f${i}.ts`), ...Array.from({ length: 7 }, (_, i) => `${B}/f${i}.spec.ts`)]])).eligible, true);
check('lean gate: docs and the regenerated spec are not counted',
  lean(PROP, plan([[...Array.from({ length: 8 }, (_, i) => `${B}/f${i}.ts`), 'backend/openapi.json', 'backend/docs/CONTEXT.md', 'openspec/changes/x/runbook.md']])).eligible, true);
check('lean gate: touching both packages goes to the full lane',
  lean(PROP, plan([[`${B}/a.ts`, 'frontend/src/modules/a/b.tsx']])).reasons.some((r) => /both backend and frontend/.test(r)), true);
check('lean gate: a migration goes to the full lane',
  lean(PROP, plan([[`${B}/a.ts`, 'backend/src/database/migrations/1700-add.ts']])).reasons.some((r) => /migration/.test(r)), true);
check('lean gate: a dependency change goes to the full lane',
  lean(PROP, plan([[`${B}/a.ts`, 'backend/package.json']])).reasons.some((r) => /dependency/.test(r)), true);
check('lean gate: deploy config goes to the full lane', lean(PROP, plan([[`${B}/a.ts`, 'docker/compose.yml']])).eligible, false);
check('lean gate: the rulebook is never the quick lane\'s to edit', lean(PROP, plan([[`${B}/a.ts`, 'docs/POLICIES.md']])).eligible, false);
check('lean gate: a new module is structural', lean(PROP, plan([[`${B}/b.module.ts (new)`]])).reasons.some((r) => /new module/.test(r)), true);
check('lean gate: editing an existing module is fine', lean(PROP, plan([[`${B}/b.module.ts (modify)`, `${B}/a.ts`]])).eligible, true);
check('lean gate: an open question goes to the full lane',
  lean(PROP.replace('None', '1. Does "withdrawn" mean is_active false?'), small).reasons.some((r) => /open question/.test(r)), true);
check('lean gate: a question wrapped over two lines is one question, not two',
  JSON.stringify(openQuestions(PROP.replace('None', '**Non-empty.** Not ready.\n\n1. Does withdrawn mean\n   is_active false, or a status?\n2. Should shared sections be visible\n   to every school?'))),
  '["Does withdrawn mean","Should shared sections be visible"]');
check('lean gate: prose under Open questions with no list is one question',
  openQuestions(PROP.replace('None', 'Nobody has said whether withdrawn is a flag.')).length, 1);
check('lean gate: "None" and comments are not open questions',
  lean(PROP.replace('None', '<!-- nothing yet -->\nNone'), small).eligible, true);
check('lean gate: confirmed assumptions are not open questions',
  lean(PROP + '\n## Assumptions (confirmed)\n\n1. Withdrawn means is_active false.\n', small).eligible, true);
check('lean gate: an ADR-gate row answered Yes goes to the full lane',
  lean(PROP + '\n| Trigger | Hit? |\n| --- | --- |\n| New module boundary | Yes |\n', small).reasons.some((r) => /ADR gate/.test(r)), true);
check('lean gate: an ADR-gate row answered No or "assessed" is fine',
  lean(PROP + '\n| Trigger | Hit? |\n| --- | --- |\n| Datastore | No |\n| Public API | Partially — assessed, not an ADR |\n', small).eligible, true);
// the Scope check: a quick plan reads one module and can miss that a row is shared across schools
check('lean gate: a plan that reads data with no Scope check is refused',
  lean(propWith(null), small).reasons.some((r) => /no "## Scope check"/.test(r)), true);
check('lean gate: an empty Scope check table is refused',
  lean(propWith(''), small).reasons.some((r) => /no filled rows/.test(r)), true);
check('lean gate: the template\'s blank row does not count',
  lean(propWith('|  |  |  | AC-? |'), small).reasons.some((r) => /no filled rows/.test(r)), true);
check('lean gate: a row that does not say whether rows are shared is refused',
  lean(propWith('| academic.course_sections | EXISTS over study plans |  |  |'), small).reasons.some((r) => /incomplete/.test(r)), true);
check('lean gate: a shared table with no acceptance criterion is refused',
  lean(propWith('| academic.student_section_enrollments | via the student\'s program | Yes: a section can hold two schools\' students |  |'), small)
    .reasons.some((r) => /shared across schools but no acceptance criterion/.test(r)), true);
check('lean gate: a shared table covered by an AC is eligible',
  lean(propWith('| academic.student_section_enrollments | via the student\'s program | Yes: a section can hold two schools\' students | AC-3 |'), small).eligible, true);
check('lean gate: a controller-only plan needs no Scope check',
  lean(propWith(null), plan([[`${B}/api/b.controller.ts (modify)`]])).eligible, true);
check('lean gate: a plan touching a repository needs one',
  lean(propWith(null), plan([[`${B}/core/b.repository.ts (modify)`]])).eligible, false);
check('lean gate: several tables are each checked',
  lean(propWith(`${OK_ROW}\n| academic.enrolled_students | via the program | Yes: shared |  |`), small).eligible, false);
check('lean gate: scopeCheckRows reads only filled rows',
  scopeCheckRows(propWith(`${OK_ROW}\n|  |  |  | AC-? |`)).length, 1);
check('lean gate: a plan with no boxes cannot be audited', lean(PROP, '# Tasks\n### Task 1.1 — x\n').reasons.some((r) => /no `- \[ \] Task complete`/.test(r)), true);
check('lean gate: a plan that names no files is refused', lean(PROP, '# Tasks\n### Task 1.1 — x\n\n- [ ] Task complete\n').reasons.some((r) => /no source files/.test(r)), true);

// ----------------------------------------------------------------- report
console.log('');
if (failures.length === 0) {
  console.log(`✓ all ${passed} checks passed`);
  process.exit(0);
}
console.log(`✗ ${failures.length} failed, ${passed} passed\n`);
for (const f of failures) console.log(`  ${f}`);
process.exit(1);
