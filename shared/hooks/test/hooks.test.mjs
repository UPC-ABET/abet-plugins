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
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { gitInvocations, tokenize, splitSegments, gitCommandCwd } from '../lib/shell.mjs';
import { scanDiff } from '../lib/secrets.mjs';
import { slugFromBranch } from '../lib/branches.mjs';
import { isAuthored, isScannable as isScannablePath } from '../lib/paths.mjs';
import { validateCommitMessage } from '../checks/commit-message.mjs';
import { runPreCommitChecks } from '../checks/pre-commit.mjs';
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

// ----------------------------------------------------------------- report
console.log('');
if (failures.length === 0) {
  console.log(`✓ all ${passed} checks passed`);
  process.exit(0);
}
console.log(`✗ ${failures.length} failed, ${passed} passed\n`);
for (const f of failures) console.log(`  ${f}`);
process.exit(1);
