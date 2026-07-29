#!/usr/bin/env node
/**
 * Merge the permission snippets into a consuming repo's .claude/settings.json.
 *
 *   node install/apply-settings.mjs "../BACK-ACREDITACION-3.0" --profile backend
 *   node install/apply-settings.mjs "../FRONT-ACREDITACION-3.0"
 *   node install/apply-settings.mjs "../BACK-ACREDITACION-3.0" --profile backend --dry-run
 *
 * Plugins cannot ship permissions — there is no `permissions` field in the plugin
 * manifest — so the snippets live here and are merged in explicitly.
 *
 * The merge is additive and idempotent: existing entries are preserved, duplicates are
 * dropped, and nothing is ever removed. Run it again after updating the plugin.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith('--'));
const dryRun = args.includes('--dry-run');
const profileIdx = args.indexOf('--profile');
const profile = profileIdx !== -1 ? args[profileIdx + 1] : null;

if (!target) {
  console.error('usage: node install/apply-settings.mjs <repo-path> [--profile backend|frontend] [--dry-run]');
  process.exit(1);
}

const repo = resolve(process.cwd(), target);
if (!existsSync(repo)) {
  console.error(`no such directory: ${repo}`);
  process.exit(1);
}

const snippets = [join(ROOT, 'plugins', 'abet-common', 'install', 'settings.snippet.json')];
if (profile) snippets.push(join(ROOT, 'plugins', `abet-${profile}`, 'install', 'settings.snippet.json'));

const readJson = (p, fallback = {}) => {
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return fallback; }
};

const settingsPath = join(repo, '.claude', 'settings.json');
const settings = readJson(settingsPath, {});
settings.permissions ??= {};

const added = { allow: [], deny: [] };

for (const snippetPath of snippets) {
  if (!existsSync(snippetPath)) {
    console.error(`skipping missing snippet: ${snippetPath}`);
    continue;
  }
  const snippet = readJson(snippetPath);
  for (const key of ['allow', 'deny', 'ask']) {
    const incoming = snippet.permissions?.[key];
    if (!Array.isArray(incoming)) continue;
    const existing = new Set(settings.permissions[key] ?? []);
    const fresh = incoming.filter((entry) => !existing.has(entry));
    if (fresh.length === 0) continue;
    settings.permissions[key] = [...(settings.permissions[key] ?? []), ...fresh];
    (added[key] ??= []).push(...fresh);
  }
}

const total = Object.values(added).flat().length;

if (dryRun) {
  console.log(`[dry run] would write ${settingsPath}`);
  for (const [key, entries] of Object.entries(added)) {
    if (entries.length) console.log(`  +${entries.length} ${key}:\n${entries.map((e) => `    ${e}`).join('\n')}`);
  }
  if (total === 0) console.log('  nothing to add — already up to date');
  process.exit(0);
}

if (total > 0) {
  mkdirSync(dirname(settingsPath), { recursive: true });
  if (existsSync(settingsPath)) copyFileSync(settingsPath, `${settingsPath}.bak`);
  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
  console.log(`wrote ${settingsPath}`);
  for (const [key, entries] of Object.entries(added)) {
    if (entries.length) console.log(`  +${entries.length} ${key}`);
  }
  if (existsSync(`${settingsPath}.bak`)) console.log(`  previous version saved to settings.json.bak`);
} else {
  console.log('already up to date — nothing added');
}

console.log('\nNext: enable the plugins in this repo.');
console.log('  /plugin marketplace add ' + ROOT);
console.log('  /plugin install abet-common@abet-plugins');
if (profile) console.log(`  /plugin install abet-${profile}@abet-plugins`);
