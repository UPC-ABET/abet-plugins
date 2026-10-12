#!/usr/bin/env node
/**
 * lean-gate — may this change use the quick lane?
 *
 *   node lean-gate.mjs [<slug>]
 *
 * Reads openspec/changes/<slug>/{proposal,tasks}.md (the slug is inferred from the branch
 * when omitted) and prints JSON: `eligible`, the `reasons` it is not, and the `stats`. See
 * lib/lean-gate.mjs for the bounds and why they are what they are.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isMain } from './lib/is-main.mjs';
import { checkLean } from './lib/lean-gate.mjs';
import { inFlightChanges, isInFlight } from './lib/changes.mjs';

const git = (args) => {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
};

/**
 * Slug inference from the branch, then the only in-flight change folder (conventions.md).
 * `changes/archive/` is never a candidate.
 */
export function findSlug(explicit, branch = git(['rev-parse', '--abbrev-ref', 'HEAD']), root = '.') {
  if (explicit) return explicit;
  const slug = (branch.includes('/') ? branch.slice(branch.indexOf('/') + 1) : branch).replace(/^archive-/, '');
  if (isInFlight(slug, root)) return slug;
  const dirs = inFlightChanges(root);
  return dirs.length === 1 ? dirs[0] : null;
}

function main() {
  const slug = findSlug(process.argv[2]);
  if (!slug) {
    console.log(JSON.stringify({ eligible: false, reasons: ['cannot tell which change this is: pass the slug'], stats: {} }));
    return;
  }
  const dir = join('openspec', 'changes', slug);
  const read = (f) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), 'utf8') : null);
  const proposal = read('proposal.md');
  const tasks = read('tasks.md');
  if (proposal === null || tasks === null) {
    console.log(JSON.stringify({ eligible: false, reasons: [`${dir}/ needs both proposal.md and tasks.md`], stats: {} }));
    return;
  }
  console.log(JSON.stringify({ slug, ...checkLean({ proposal, tasks }) }, null, 2));
}

if (isMain(import.meta.url)) main();
