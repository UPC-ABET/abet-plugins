#!/usr/bin/env node
/**
 * Materialize each provider's tree from shared/.
 *
 *   node build/generate.mjs            regenerate every provider
 *   node build/generate.mjs --check    fail if anything is out of date (for CI)
 *   node build/generate.mjs claude     regenerate one provider
 *
 * The pipeline content — skills, agents, templates, rules, conventions — is the same
 * prose for every provider. Only the packaging differs: Claude Code wants a plugin with
 * frontmattered SKILL.md files, Codex wants prompt files plus AGENTS.md, opencode wants
 * .opencode/commands. Keeping one copy in shared/ and generating the rest is what stops
 * three divergent versions of the same instructions.
 *
 * Generated output IS committed, so installing a provider needs no build step. Re-run this
 * after editing anything under shared/ — `--check` in CI catches a forgotten run.
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, existsSync, statSync, copyFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SHARED = join(ROOT, 'shared');

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const only = args.find((a) => !a.startsWith('--'));

/**
 * The single version for the whole marketplace, taken from package.json and stamped into
 * every plugin manifest.
 *
 * Claude Code pins a plugin to its declared `version`, so users only receive an update
 * when that string changes — three manifests that drift apart, or one left un-bumped, means
 * a fix silently never reaches anybody. Deriving them from one number makes drift
 * impossible and leaves exactly one field to bump when releasing.
 */
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;

function stampManifestVersions() {
  for (const key of Object.keys(PROFILES)) {
    const file = join(ROOT, 'claude', 'plugins', `abet-${key}`, '.claude-plugin', 'plugin.json');
    if (!existsSync(file)) continue;
    const manifest = JSON.parse(readFileSync(file, 'utf8'));
    if (manifest.version === VERSION) continue;
    // Keep `version` in its documented position rather than appended at the end.
    const ordered = {};
    let stamped = false;
    for (const [k, v] of Object.entries(manifest)) {
      if (k === 'version') {
        ordered.version = VERSION;
        stamped = true;
        continue;
      }
      ordered[k] = v;
      if (!stamped && k === 'displayName') {
        ordered.version = VERSION;
        stamped = true;
      }
    }
    if (!stamped) ordered.version = VERSION;
    emit(file, `${JSON.stringify(ordered, null, 2)}\n`);
  }
}

/** Which plugin owns which shared subtree. Ownership is structural, not configured. */
const PROFILES = {
  common: { skills: 'common', agents: 'common', rules: null },
  backend: { skills: 'backend', agents: 'backend', rules: 'backend.md' },
  frontend: { skills: 'frontend', agents: 'frontend', rules: 'frontend.md' },
};

// ---------------------------------------------------------------- frontmatter

function parseFrontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!m) return { data: {}, body: text };
  const data = {};
  for (const line of m[1].split('\n')) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (kv) data[kv[1]] = kv[2].trim();
  }
  return { data, body: text.slice(m[0].length) };
}

const yamlEscape = (v) => (/[:#]/.test(v) ? JSON.stringify(v) : v);

function renderFrontmatter(data) {
  const lines = Object.entries(data)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}: ${yamlEscape(String(v))}`);
  return `---\n${lines.join('\n')}\n---\n`;
}

// ---------------------------------------------------------------------- files

const written = [];
const stale = [];

function emit(absPath, content) {
  const rel = relative(ROOT, absPath);
  if (checkOnly) {
    const current = existsSync(absPath) ? readFileSync(absPath, 'utf8') : null;
    if (current !== content) stale.push(rel);
    return;
  }
  mkdirSync(dirname(absPath), { recursive: true });
  writeFileSync(absPath, content, 'utf8');
  written.push(rel);
}

function emitCopy(src, dest) {
  emit(dest, readFileSync(src, 'utf8'));
}

function listDirs(p) {
  return existsSync(p) ? readdirSync(p).filter((d) => statSync(join(p, d)).isDirectory()).sort() : [];
}

function listFiles(p, ext = '.md') {
  return existsSync(p) ? readdirSync(p).filter((f) => f.endsWith(ext)).sort() : [];
}

/**
 * Model roles, resolved per provider.
 *
 * A skill says what a subagent's job IS — `{{pin:execute}}` for rote work guided by a
 * plan, `{{pin:procedural}}` for counting, path checks and regexes — and never names a
 * model. Claude Code maps them to sonnet/haiku and Codex to terra/luna. opencode's model
 * ids depend on the user's provider, so the role expands to nothing there and the
 * subagent runs on whatever model the user chose. The plan role has no pin at all on purpose: it runs on the session's own
 * model, which is the user's decision (a $20 plan and a $100 plan should not be forced
 * onto the same one).
 *
 * Pinning happens per subagent spawn, never in a skill's own frontmatter: a probe skill with
 * `model: haiku` run in an Opus session still ran on Opus, while a spawn with
 * `model: "haiku"` was billed to Haiku. A skill-level pin would be inert and misleading.
 */
const PINS = {
  claude: {
    execute: ' with `model: "sonnet"` set explicitly on every spawn (never omit it: an omitted model inherits the session model, which may be the most expensive one)',
    procedural: ' with `model: "haiku"` set explicitly on every spawn — the work is mechanical and needs no more',
  },
  codex: {
    execute: ' with `model: "terra"` set explicitly on every spawn (never omit it: an omitted model inherits the session model, which may be the most expensive one)',
    procedural: ' with `model: "luna"` set explicitly on every spawn — the work is mechanical and needs no more',
  },
  opencode: { execute: '', procedural: '' },
};

/** Expand `{{pin:<role>}}` for one provider; an unknown role is a build error, not silent text. */
function expandBody(body, provider) {
  // `{{include:name}}` pastes `shared/snippets/name.md`: text two skills must say identically
  // (the audit-ledger field table) lives once, so the skills cannot drift apart.
  const included = body.replace(/\{\{include:([\w-]+)\}\}/g, (_, name) => {
    const file = join(SHARED, 'snippets', `${name}.md`);
    if (!existsSync(file)) throw new Error(`unknown snippet "{{include:${name}}}": no ${relative(ROOT, file)}`);
    return readFileSync(file, 'utf8').replace(/\n+$/, '');
  });
  const out = included.replace(/\{\{pin:([\w-]+)\}\}/g, (_, role) => {
    if (!(role in PINS[provider])) throw new Error(`unknown model role "{{pin:${role}}}" (provider: ${provider})`);
    return PINS[provider][role];
  });
  // A typo like `{{pinn:execute}}` would otherwise ship as literal braces in the prompt.
  const stray = /\{\{[^}]*\}\}/.exec(out);
  if (stray) throw new Error(`unexpanded placeholder ${stray[0]} in a skill body (provider: ${provider})`);
  return out;
}

/** Every skill in shared/, with its canonical frontmatter parsed. */
function loadSkills(group) {
  const base = join(SHARED, 'skills', group);
  return listDirs(base).map((name) => {
    const file = join(base, name, 'SKILL.md');
    const { data, body } = parseFrontmatter(readFileSync(file, 'utf8'));
    return { name: data.name || name, dir: name, description: data.description || '', body, data };
  });
}

function loadAgents(group) {
  const base = join(SHARED, 'agents', group);
  return listFiles(base).map((f) => {
    const { data, body } = parseFrontmatter(readFileSync(join(base, f), 'utf8'));
    return { file: f, name: data.name || f.replace(/\.md$/, ''), description: data.description || '', model: data.model, body, data };
  });
}

/**
 * `includeTemplatesAndReference` defaults to true for codex/opencode, which have no
 * per-plugin split and need templates + conventions in their single flat reference/ tree
 * regardless of which profile's rules file is being copied alongside them. For Claude
 * Code, buildClaude() passes false for the backend/frontend profiles: no skill or agent
 * under shared/skills/{backend,frontend} or shared/agents/{backend,frontend} references
 * `${CLAUDE_PLUGIN_ROOT}/templates` or `/reference` (verified by grep), and abet-common —
 * which does ship both — is always installed alongside the stack profiles in this
 * monorepo. Copying them three times over was pure duplication.
 */
function sharedSupportFiles(profileKey, { includeTemplatesAndReference = true } = {}) {
  const out = [];
  if (includeTemplatesAndReference) {
    for (const t of listFiles(join(SHARED, 'templates'))) {
      out.push({ src: join(SHARED, 'templates', t), rel: join('templates', t) });
    }
    out.push({ src: join(SHARED, 'reference', 'conventions.md'), rel: join('reference', 'conventions.md') });
  }
  const rules = PROFILES[profileKey].rules;
  if (rules) out.push({ src: join(SHARED, 'rules', rules), rel: join('rules', rules) });
  return out;
}

// --------------------------------------------------------------- claude code

function buildClaude() {
  for (const [key, profile] of Object.entries(PROFILES)) {
    const dest = join(ROOT, 'claude', 'plugins', `abet-${key}`);

    for (const skill of loadSkills(profile.skills)) {
      // Claude Code's SKILL.md frontmatter is the canonical form — emit as authored.
      emit(join(dest, 'skills', skill.dir, 'SKILL.md'),
        renderFrontmatter({ name: skill.name, description: skill.description }) + expandBody(skill.body, 'claude'));
    }

    for (const agent of loadAgents(profile.agents)) {
      emit(join(dest, 'agents', agent.file),
        renderFrontmatter({ name: agent.name, description: agent.description, model: agent.model }) + agent.body);
    }

    for (const f of sharedSupportFiles(key, { includeTemplatesAndReference: key === 'common' })) {
      emitCopy(f.src, join(dest, f.rel));
    }
  }

  // Hook logic is shared; hooks.json (the wiring) is hand-maintained under claude/.
  const hookDest = join(ROOT, 'claude', 'plugins', 'abet-common', 'hooks');
  for (const sub of ['', 'lib', 'checks']) {
    const src = join(SHARED, 'hooks', sub);
    for (const f of listFiles(src, '.mjs')) emitCopy(join(src, f), join(hookDest, sub, f));
  }
}

// --------------------------------------------------------------------- codex

function buildCodex() {
  // Codex has no plugin system: it reads AGENTS.md and custom prompts from prompts/.
  // Every skill becomes a prompt file; there is no hook equivalent, which is why the
  // git-policy validators are also wired as husky hooks in the consuming repos.
  const dest = join(ROOT, 'codex');
  const index = [];

  for (const group of ['common', 'backend', 'frontend']) {
    for (const skill of loadSkills(group)) {
      emit(join(dest, 'prompts', `${skill.name}.md`), `${expandBody(skill.body, 'codex').trimStart()}`);
      index.push({ group, name: skill.name, description: skill.description });
    }
    for (const agent of loadAgents(group)) {
      emit(join(dest, 'prompts', `${agent.name}.md`), `${agent.body.trimStart()}`);
      index.push({ group, name: agent.name, description: agent.description });
    }
  }

  for (const f of sharedSupportFiles('backend')) emitCopy(f.src, join(dest, 'reference', f.rel));
  emitCopy(join(SHARED, 'rules', 'frontend.md'), join(dest, 'reference', 'rules', 'frontend.md'));

  const rows = index.map((e) => `| \`/${e.name}\` | ${e.group} | ${e.description.split('.')[0]}. |`).join('\n');
  emit(join(dest, 'README.md'),
    `# ABET prompts for Codex\n\n` +
    `Codex reads \`AGENTS.md\` from the repository root and custom prompts from \`~/.codex/prompts/\`.\n` +
    `There is no plugin or hook mechanism, so:\n\n` +
    `- Copy \`prompts/*.md\` into \`~/.codex/prompts/\` to get the pipeline as slash commands.\n` +
    `- Enforcement comes from the husky git hooks in each repository, not from Codex.\n\n` +
    `> Generated from \`shared/\` by \`build/generate.mjs\`. Do not edit by hand.\n\n` +
    `| Prompt | Profile | Purpose |\n| --- | --- | --- |\n${rows}\n`);
}

// ------------------------------------------------------------------ opencode

function buildOpencode() {
  // opencode reads AGENTS.md and loads commands from .opencode/commands/*.md, whose
  // frontmatter takes description/agent/model/subtask.
  const dest = join(ROOT, 'opencode');

  for (const group of ['common', 'backend', 'frontend']) {
    for (const skill of loadSkills(group)) {
      emit(join(dest, '.opencode', 'commands', `${skill.name}.md`),
        renderFrontmatter({ description: skill.description }) + expandBody(skill.body, 'opencode'));
    }
    for (const agent of loadAgents(group)) {
      emit(join(dest, '.opencode', 'agents', `${agent.name}.md`),
        renderFrontmatter({ description: agent.description, model: agent.model }) + agent.body);
    }
  }

  for (const f of sharedSupportFiles('backend')) emitCopy(f.src, join(dest, 'reference', f.rel));
  emitCopy(join(SHARED, 'rules', 'frontend.md'), join(dest, 'reference', 'rules', 'frontend.md'));

  emit(join(dest, 'README.md'),
    `# ABET commands for opencode\n\n` +
    `opencode reads \`AGENTS.md\` from the repository root (falling back to \`CLAUDE.md\`) and\n` +
    `loads commands from \`.opencode/commands/\`.\n\n` +
    `- Copy \`.opencode/\` into the repository you are working in.\n` +
    `- opencode has no pre-tool hook, so enforcement comes from the husky git hooks in each\n` +
    `  repository.\n\n` +
    `> Generated from \`shared/\` by \`build/generate.mjs\`. Do not edit by hand.\n`);
}

// ---------------------------------------------------------------------- main

const BUILDERS = { claude: buildClaude, codex: buildCodex, opencode: buildOpencode };

if (only && !BUILDERS[only]) {
  console.error(`unknown provider: ${only}. Expected one of ${Object.keys(BUILDERS).join(', ')}`);
  process.exit(1);
}

// Clear generated trees so a deleted shared file does not linger.
if (!checkOnly) {
  for (const key of Object.keys(BUILDERS)) {
    if (only && key !== only) continue;
    if (key === 'claude') {
      for (const p of Object.keys(PROFILES)) {
        for (const sub of ['skills', 'agents', 'templates', 'reference', 'rules']) {
          rmSync(join(ROOT, 'claude', 'plugins', `abet-${p}`, sub), { recursive: true, force: true });
        }
      }
      for (const f of listFiles(join(ROOT, 'claude/plugins/abet-common/hooks'), '.mjs')) {
        rmSync(join(ROOT, 'claude/plugins/abet-common/hooks', f), { force: true });
      }
      for (const sub of ['lib', 'checks']) {
        rmSync(join(ROOT, 'claude/plugins/abet-common/hooks', sub), { recursive: true, force: true });
      }
    } else {
      for (const sub of ['prompts', 'reference', '.opencode']) {
        rmSync(join(ROOT, key, sub), { recursive: true, force: true });
      }
    }
  }
}

for (const [key, build] of Object.entries(BUILDERS)) {
  if (only && key !== only) continue;
  build();
}

if (!only || only === 'claude') stampManifestVersions();

if (checkOnly) {
  if (stale.length === 0) {
    console.log('✓ generated output is up to date');
    process.exit(0);
  }
  console.error(`✗ ${stale.length} generated file(s) out of date — run \`node build/generate.mjs\`:`);
  for (const f of stale.slice(0, 20)) console.error(`    ${f}`);
  process.exit(1);
}

console.log(`✓ generated ${written.length} files from shared/`);
