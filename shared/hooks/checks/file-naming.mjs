/**
 * File-naming gate for backend feature modules.
 *
 * Every file under `src/modules/` is `<kebab-name>.<kind>.ts` (or `.<kind>.spec.ts` / `.<kind>.db-spec.ts`), and
 * each `<kind>` lives in exactly one folder — `.service.ts` in `api/`, `.repository.ts` in
 * `core/`, and so on (see `rules/backend.md`, "Where things go"). A model asked to add
 * "some helper" will happily invent `course-sections.bands.ts` or `.section-filter.ts`;
 * that is a naming problem a machine can see, so a machine catches it instead of a
 * reviewer three days later.
 *
 * Only NEW files are checked. The codebase has a handful of legacy files that predate the
 * vocabulary (`scraper-provider-codes.ts`, `*.repository.interface.ts`); holding every
 * commit that touches them hostage would make the rule something people route around.
 *
 * Two callers, one rule: the `Write` PreToolUse hook (stops the model at creation, when the
 * correction is cheapest) and the pre-commit gate (covers Codex, opencode and humans).
 */

/**
 * kind → the layer(s) it may live in. A layer is the nearest enclosing folder from
 * LAYERS below; `.` is anything else (the module root, `shared/`, a sub-domain folder) and
 * `*` means any layer.
 *
 * Derived from the kinds the codebase really uses, not from an ideal: `config/strings/`
 * holds `<module>.validation.ts`, `core/` holds `.client.ts` and `.store.ts` in the banner
 * and auth modules. The rule's job is to stop *invented* kinds (`.bands.ts`,
 * `.section-filter.ts`); placement is strict only where the layout has no exceptions.
 */
export const KIND_FOLDERS = {
  controller: ['api'],
  swagger: ['api/docs'],
  entity: ['model'],
  dtos: ['model'],
  labels: ['model'],
  errors: ['model'],
  error: ['model'],
  transforms: ['model'],
  types: ['model', 'core'],
  repository: ['core'],
  validation: ['core', 'config/strings'],
  client: ['core'],
  store: ['core'],
  sql: ['core', 'api'],
  service: ['api', 'core', '.'],
  theme: ['api', '.'],
  routes: ['config'],
  strings: ['config', 'config/strings'],
  module: ['.'],
  config: ['.'],
  decorator: ['decorators'],
  guard: ['guards'],
  interceptor: ['interceptors'],
  gateway: ['gateway'],
  strategy: ['strategies'],
  functions: ['*'],
  constants: ['*'],
};

const LAYERS = new Set(['api', 'model', 'core', 'config', 'decorators', 'guards', 'interceptors', 'gateway', 'strategies']);
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** What to reach for instead, keyed by the shape of the thing the author was probably adding. */
const HINT =
  'Pure helpers and business calculations go in `<module>.functions.ts`; rules that ' +
  'validate input in `core/<module>.validation.ts`; database access in `core/<module>.repository.ts`; ' +
  'shared shapes in `model/<module>.types.ts`; fixed values in `model/<module>.constants.ts`.';

/** Nearest enclosing layer folder: `api`, `api/docs`, `config/strings`, `core`, ... or `.`. */
function layerOf(dirs) {
  for (let i = dirs.length - 1; i >= 0; i--) {
    if (dirs[i] === 'docs' && dirs[i - 1] === 'api') return 'api/docs';
    if (dirs[i] === 'strings' && dirs[i - 1] === 'config') return 'config/strings';
    if (LAYERS.has(dirs[i])) return dirs[i];
  }
  return '.';
}

/**
 * Check one path. Returns `null` when it is fine or out of scope, else a message written
 * for the author — it names the rule, the folder's allowed kinds, and what to do instead.
 */
export function checkModuleFileName(path) {
  const norm = path.replace(/\\/g, '/');
  // The frontend has its own `src/modules/` with a different layout (the abet-module skill).
  if (/(^|\/)frontend\//.test(norm)) return null;
  const at = norm.lastIndexOf('/src/modules/');
  const rel = at >= 0 ? norm.slice(at + '/src/modules/'.length)
    : norm.startsWith('src/modules/') ? norm.slice('src/modules/'.length) : null;
  if (rel === null || !rel.endsWith('.ts')) return null;

  const segments = rel.split('/');
  const file = segments.pop();
  // The first segment is the domain group (`academic`, `core`, `admin`, ...), never a layer:
  // `modules/core/` is a group that merely shares its name with the `core/` layer folder.
  const layer = layerOf(segments.slice(1));

  const parts = file.slice(0, -'.ts'.length).split('.');
  const suffix = ['spec', 'db-spec'].includes(parts.at(-1)) ? parts.at(-1) : null;
  if (suffix) parts.pop();
  const [name, kind, ...extra] = parts;

  const allowedHere = Object.entries(KIND_FOLDERS)
    .filter(([, folders]) => folders.includes(layer) || folders.includes('*')).map(([k]) => k);
  const expected = `\`<name>.<kind>${suffix ? `.${suffix}` : ''}.ts\``;
  const where = layer === '.' ? 'the module root' : `\`${layer}/\``;

  if (!name || !kind || extra.length > 0 || !NAME.test(name)) {
    return `\`${file}\` in ${where} is not ${expected} with a kebab-case name. ` +
      `Kinds allowed in ${where}: ${allowedHere.join(', ') || '(none — this folder holds no source files)'}. ${HINT}`;
  }
  if (!(kind in KIND_FOLDERS)) {
    return `\`.${kind}.ts\` is not a kind this codebase uses (\`${file}\`). ` +
      `Kinds allowed in ${where}: ${allowedHere.join(', ') || '(none)'}. ${HINT}`;
  }
  if (!KIND_FOLDERS[kind].includes(layer) && !KIND_FOLDERS[kind].includes('*')) {
    const home = KIND_FOLDERS[kind].map((f) => (f === '.' ? 'the module root' : `\`${f}/\``)).join(' or ');
    return `\`.${kind}.ts\` belongs in ${home}, not ${where} (\`${file}\`).`;
  }
  return null;
}

/** Check a list of newly added paths; returns one message per offending file. */
export function checkNewFiles(paths) {
  return paths
    .map((p) => ({ path: p, problem: checkModuleFileName(p) }))
    .filter((r) => r.problem);
}
