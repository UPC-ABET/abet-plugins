/**
 * Resolving the package a staged file belongs to, for repos that grew into a
 * pnpm/npm/yarn workspace.
 *
 * The pre-commit gate used to resolve one toolchain for the whole repo. Once the
 * consuming project splits into `backend`/`frontend` packages, each with its own
 * `node_modules`, `tsconfig*.json` and lint/format config, that single resolution
 * finds nothing and the gate silently no-ops. This module finds the real package
 * roots so the gate can resolve — and run — a toolchain per package instead.
 *
 * No YAML/glob dependency: `pnpm-workspace.yaml`'s `packages:` list only ever uses
 * a handful of shapes in practice (`backend`, `packages/*`, `apps/**`), so a small
 * hand-rolled parser and matcher covers it without pulling in a library.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { readPackageJson } from './toolchain.mjs';

/** Pull the `packages:` list out of a pnpm-workspace.yaml. Returns null if absent/empty. */
function parsePnpmWorkspaceYaml(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^\s*packages\s*:\s*(#.*)?$/.test(l));
  if (start === -1) return null;

  const patterns = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*$/.test(line) || /^\s*#/.test(line)) continue;
    const item = line.match(/^\s*-\s*(.+)$/);
    if (!item) break; // dedented to a sibling key — the list block is over
    const value = item[1].replace(/\s+#.*$/, '').trim().replace(/^['"]|['"]$/g, '');
    if (value) patterns.push(value);
  }
  return patterns.length > 0 ? patterns : null;
}

/** `package.json#workspaces`, either the bare array form or `{ packages: [...] }`. */
function workspacePatternsFromPackageJson(pkg) {
  if (!pkg) return null;
  const ws = pkg.workspaces;
  if (Array.isArray(ws)) return ws.length > 0 ? ws : null;
  if (ws && Array.isArray(ws.packages)) return ws.packages.length > 0 ? ws.packages : null;
  return null;
}

function listSubdirs(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && e.name !== 'node_modules' && !e.name.startsWith('.'))
    .map((e) => e.name);
}

/** Expand one glob pattern (`backend`, `packages/*`, `apps/**`) into absolute dirs. */
function expandPattern(root, pattern) {
  const norm = pattern.replace(/\\/g, '/').replace(/\/+$/, '');
  const dirs = [];

  if (norm.endsWith('/**')) {
    const base = norm.slice(0, -3);
    const baseDir = base ? join(root, base) : root;
    const stack = [baseDir];
    while (stack.length > 0) {
      const dir = stack.pop();
      for (const name of listSubdirs(dir)) {
        const sub = join(dir, name);
        dirs.push(sub);
        stack.push(sub);
      }
    }
  } else if (norm.endsWith('/*')) {
    const base = norm.slice(0, -2);
    const baseDir = base ? join(root, base) : root;
    for (const name of listSubdirs(baseDir)) dirs.push(join(baseDir, name));
  } else if (!norm.includes('*')) {
    if (norm && norm !== '.') dirs.push(join(root, norm));
  }
  // A pattern with a `*` in the middle of a segment (e.g. `pkg-*`) is not something the
  // consuming repo uses today — skipped rather than guessed at.

  return dirs;
}

/**
 * Absolute directories of every workspace package under `root`, each containing its
 * own `package.json`. Falls back to `[root]` when the repo isn't a workspace at all,
 * so a single-package repo behaves exactly as it always has.
 */
export function findWorkspacePackages(root) {
  let patterns = null;

  const yamlPath = join(root, 'pnpm-workspace.yaml');
  if (existsSync(yamlPath)) {
    try {
      patterns = parsePnpmWorkspaceYaml(readFileSync(yamlPath, 'utf8'));
    } catch {
      patterns = null;
    }
  }
  if (!patterns) {
    patterns = workspacePatternsFromPackageJson(readPackageJson(root));
  }
  if (!patterns) return [root];

  const dirs = new Set();
  for (const pattern of patterns) {
    for (const dir of expandPattern(root, pattern)) {
      const rel = relative(root, dir).replace(/\\/g, '/');
      if (!rel || rel.split('/').includes('node_modules')) continue;
      if (existsSync(join(dir, 'package.json'))) dirs.add(dir);
    }
  }
  return dirs.size > 0 ? [...dirs] : [root];
}

/**
 * The deepest package in `packages` whose directory is a prefix of `relPath`
 * (a path relative to `root`, forward-slashed). Falls back to `root` when no
 * package claims it — e.g. `docker/x.yml` in a workspace repo.
 */
export function packageFor(root, packages, relPath) {
  const normalized = relPath.replace(/\\/g, '/');
  let best = null;
  let bestLen = -1;

  for (const pkgDir of packages) {
    const rel = relative(root, pkgDir).replace(/\\/g, '/');
    if (!rel) continue; // that "package" is root itself — handled by the fallback
    if (normalized === rel || normalized.startsWith(`${rel}/`)) {
      if (rel.length > bestLen) {
        bestLen = rel.length;
        best = pkgDir;
      }
    }
  }
  return best ?? root;
}
