/**
 * File-naming gate — the ACC-SYS file-naming standard v2.
 *
 * A file name says what the file is **for**, never how it is written: one role per file.
 * Backend files are `<kebab-name>.<kind>.ts` (tests: `.<kind>.spec.ts` / `.<kind>.db-spec.ts`)
 * and every kind has exactly ONE home — `.service.ts` in `api/`, `.repository.ts` in `core/`,
 * and so on (`rules/backend.md`, "Where things go"). The vocabulary below is a target
 * standard the team agreed on, not a description of what the codebase happens to hold today:
 * legacy files outside it are grandfathered, new ones are not.
 *
 * Scope:
 * - backend `src/modules/**` — the kind decides the layer folder;
 * - backend `src/libs/<topic>/`, `src/commons/`, `src/shared/` — each the one home of a fixed
 *   set of cross-module kinds;
 * - frontend `frontend/src/**` — the forbidden helper suffixes and folders, and `mappers/`.
 * `database/`, `tools/`, `main.ts` and `app.*` are out of scope.
 *
 * Only NEW paths are checked. A `git mv` rename is a new path, so a rename wave passes only
 * by landing on an allowed kind; editing a grandfathered file is never blocked.
 *
 * Two callers, one rule: the `Write` PreToolUse hook (stops the model at creation, when the
 * correction is cheapest) and the pre-commit gate (covers Codex, opencode and humans).
 */

/** kind → the ONE folder it lives in inside a module. `.` is the module root. */
export const KIND_FOLDERS = {
  controller: 'api',
  service: 'api',
  http: 'api',
  swagger: 'api/docs',
  repository: 'core',
  sql: 'core',
  validation: 'core',
  calc: 'core',
  mapper: 'core',
  builder: 'core',
  theme: 'core',
  cache: 'core',
  crypto: 'core',
  client: 'core',
  store: 'core',
  // reserved: accepted now, documented as "use when first needed"
  job: 'core',
  policy: 'core',
  event: 'core',
  entity: 'model',
  dtos: 'model',
  types: 'model',
  labels: 'model',
  errors: 'model',
  error: 'model', // legacy spelling, still accepted; new files use `errors`
  routes: 'config',
  constants: 'config',
  messages: 'config/strings',
  module: '.',
  config: '.',
  decorator: 'decorators',
  guard: 'guards',
  interceptor: 'interceptors',
  gateway: 'gateway',
  strategy: 'strategies',
};

/** Kinds that may carry the secondary `interface` segment: `<name>.<kind>.interface.ts`. */
const INTERFACE_KINDS = new Set(['repository', 'service']);

/**
 * The one home of each cross-module kind outside the modules. A lib's own `types`, `theme`
 * and `messages` sit in its topic folder, next to the code they serve.
 */
const LIBS_CODE = ['calc', 'mapper', 'sql', 'builder', 'cache', 'http', 'crypto', 'client', 'service', 'module'];
export const LIBS_KINDS = [...LIBS_CODE, 'types', 'theme', 'messages'];
/**
 * `src/commons/` folder → the kinds it holds; `.` is the commons root, which also holds the
 * `base.<kind>.ts` framework base classes. App-wide config, the global exception filter and
 * app-wide interceptors are framework pieces, so they live here too, one folder each —
 * module-level config stays at the module root, the same split as module code vs libs/.
 */
export const COMMONS_FOLDERS = {
  '.': ['transaction', 'errors', 'dtos', 'swagger', 'messages'],
  configs: ['config'],
  filters: ['filter'],
  interceptors: ['interceptor'],
};
export const SHARED_KINDS = ['constants', 'types'];

/** Kinds with no home inside a module: they live only in `src/commons/`. */
const COMMONS_ONLY = new Set(['transaction', 'filter']);

/** Where each kind goes when 2+ modules (or the whole app) use it, for the messages. */
const CROSS_MODULE_HOME = {
  ...Object.fromEntries(LIBS_CODE.map((k) => [k, '`src/libs/<topic>/`'])),
  transaction: '`src/commons/`', errors: '`src/commons/`', dtos: '`src/commons/`', swagger: '`src/commons/`',
  config: '`src/commons/configs/`', filter: '`src/commons/filters/`', interceptor: '`src/commons/interceptors/`',
  constants: '`src/shared/`', types: '`src/shared/`',
};

const FUNCTIONS_TREE =
  'Name the file for what it is for: maps a shape → `core/<name>.mapper.ts`; computes a value → ' +
  '`core/<name>.calc.ts`; builds a file/document/token → `core/<name>.builder.ts`; SQL text → ' +
  '`core/<name>.sql.ts`; translates or creates errors → `model/<name>.errors.ts`; cache keys → ' +
  '`core/<name>.cache.ts`; headers/cookies/streams → `api/<name>.http.ts`; hashing/encryption → ' +
  '`core/<name>.crypto.ts`; touches the database → a method on `core/<name>.repository.ts`. ' +
  'Used by 2+ modules → the same kind in `src/libs/<topic>/`.';

/** Retired or misspelled kinds → what to write instead. */
export const RETIRED_KINDS = {
  functions: `\`.functions.ts\` is retired: it says how the file is written, not what it is for. ${FUNCTIONS_TREE}`,
  utils: `\`.utils.ts\` names no role. ${FUNCTIONS_TREE}`,
  util: `\`.util.ts\` names no role. ${FUNCTIONS_TREE}`,
  helpers: `\`.helpers.ts\` names no role. ${FUNCTIONS_TREE}`,
  helper: `\`.helper.ts\` names no role. ${FUNCTIONS_TREE}`,
  common: `\`.common.ts\` names no role. ${FUNCTIONS_TREE}`,
  misc: `\`.misc.ts\` names no role. ${FUNCTIONS_TREE}`,
  transforms: '`.transforms.ts` is retired: a row/entity → DTO shape is a `core/<name>.mapper.ts`.',
  dto: 'The kind is plural: `model/<name>.dtos.ts`.',
  configs: 'The kind is singular: `<name>.config.ts` — at the module root, or in `src/commons/configs/` for app-wide config.',
  strings: 'i18n key constants are `<name>.messages.ts`: `config/strings/` in a module, the topic folder in ' +
    '`libs/`, the `commons/` root for framework-wide keys.',
};

const LAYERS = new Set(['api', 'model', 'core', 'config', 'decorators', 'guards', 'interceptors', 'gateway', 'strategies']);
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const where = (layer) => (layer === '.' ? 'the module root' : `\`${layer}/\``);

/** Nearest enclosing layer folder: `api`, `api/docs`, `config/strings`, `core`, ... or `.`. */
function layerOf(dirs) {
  for (let i = dirs.length - 1; i >= 0; i--) {
    if (dirs[i] === 'docs' && dirs[i - 1] === 'api') return 'api/docs';
    if (dirs[i] === 'strings' && dirs[i - 1] === 'config') return 'config/strings';
    if (LAYERS.has(dirs[i])) return dirs[i];
  }
  return '.';
}

/** `a.repository.interface.spec.ts` → { name: 'a', kind: 'repository', secondary: 'interface', suffix: 'spec', extra: [] }. */
function parseName(file) {
  const parts = file.replace(/\.ts$/, '').split('.');
  const suffix = ['spec', 'db-spec'].includes(parts.at(-1)) && parts.length > 1 ? parts.pop() : null;
  const [name, kind, ...rest] = parts;
  const secondary = rest[0] === 'interface' ? rest.shift() : null;
  return { name, kind, secondary, suffix, extra: rest };
}

/** The problem with `<name>.<kind>` regardless of folder, or null. */
function kindProblem(file, { name, kind, secondary, suffix, extra }, allowed, place) {
  const expected = `\`<name>.<kind>${suffix ? `.${suffix}` : ''}.ts\``;
  const list = `Kinds allowed in ${place}: ${allowed.join(', ') || '(none — this folder holds no source files)'}.`;
  if (file === 'index.ts') {
    return `\`index.ts\` in ${place}: the backend has no barrels. Import from the file that declares the symbol.`;
  }
  if (!name || !kind) {
    return `\`${file}\` in ${place} has no kind segment; it must be ${expected} with a kebab-case name. ${list}`;
  }
  if (kind in RETIRED_KINDS) return `\`${file}\`: ${RETIRED_KINDS[kind]}`;
  if (!NAME.test(name) || extra.length > 0) {
    return `\`${file}\` in ${place} is not ${expected} with a kebab-case name. ${list}`;
  }
  if (secondary && !INTERFACE_KINDS.has(kind)) {
    return `\`${file}\`: only a repository or service contract takes the \`.interface\` segment ` +
      '(`<name>.repository.interface.ts`, `<name>.service.interface.ts`).';
  }
  if (!(kind in KIND_FOLDERS) && !COMMONS_ONLY.has(kind)) {
    return `\`.${kind}.ts\` is not a kind in the file-naming standard (\`${file}\`). ${list} ${FUNCTIONS_TREE}`;
  }
  return null;
}

function checkModule(rel) {
  const segments = rel.split('/');
  const file = segments.pop();
  // The first segment is the domain group (`academic`, `core`, `admin`, ...), never a layer:
  // `modules/core/` is a group that merely shares its name with the `core/` layer folder.
  const layer = layerOf(segments.slice(1));
  const parsed = parseName(file);
  const allowedHere = Object.entries(KIND_FOLDERS).filter(([, f]) => f === layer).map(([k]) => k);
  const problem = kindProblem(file, parsed, allowedHere, where(layer));
  if (problem) return problem;

  const { kind } = parsed;
  if (kind === 'validation' && layer === 'config/strings') {
    return `\`${file}\`: i18n key constants are \`config/strings/<module>.messages.ts\`; ` +
      '`.validation.ts` means business-rule validation in `core/`.';
  }
  if (kind === 'transaction') {
    return `\`${file}\`: \`.transaction.ts\` is the generic transaction runner and lives only in \`src/commons/\`. ` +
      'A module runs its writes through it from a repository.';
  }
  if (kind === 'filter') {
    return `\`${file}\`: an exception filter is framework-wide and lives only in \`src/commons/filters/\`.`;
  }
  // a repository or service contract sits in core/, beside the repositories it describes
  const home = parsed.secondary ? 'core' : KIND_FOLDERS[kind];
  if (home !== layer) {
    const shared = CROSS_MODULE_HOME[kind] && !parsed.secondary ? ` (or ${CROSS_MODULE_HOME[kind]} when 2+ modules use it)` : '';
    const constantsNote = kind === 'constants' ? ' There is no module-level `constants/` folder.' : '';
    const subdomain = layer === '.' && kind !== 'module' && kind !== 'config'
      ? ' A sub-domain folder (`survey/shared/`) is a module: it uses the same `api/core/model/config` layers.'
      : '';
    const shown = parsed.secondary ? `${kind}.${parsed.secondary}` : kind;
    return `\`.${shown}.ts\` belongs in ${where(home)}${shared}, not ${where(layer)} (\`${file}\`).${constantsNote}${subdomain}`;
  }
  return null;
}

function checkLibs(rel) {
  const segments = rel.split('/');
  const file = segments.pop();
  const parsed = parseName(file);
  const problem = kindProblem(file, parsed, LIBS_KINDS, '`src/libs/`');
  if (problem) return problem;
  if (segments.length === 0) {
    return `\`libs/${file}\`: new code in \`src/libs/\` goes in a topic folder (\`libs/reporting/\`, \`libs/excel/\`), ` +
      'never loose at the root.';
  }
  if (!LIBS_KINDS.includes(parsed.kind)) {
    const other = CROSS_MODULE_HOME[parsed.kind];
    return `\`.${parsed.kind}.ts\` does not live in \`src/libs/\` (\`${file}\`). ` +
      (other ? `Its cross-module home is ${other}. ` : '') +
      `libs/ holds cross-module ${LIBS_CODE.join(', ')}, plus a lib's own types, theme and messages. ` +
      "A kind only one module uses goes in that module's " +
      `${KIND_FOLDERS[parsed.kind] ? where(KIND_FOLDERS[parsed.kind]) : 'folder'}.`;
  }
  return null;
}

function checkCommons(rel) {
  const segments = rel.split('/');
  const file = segments.pop();
  const folder = segments.length === 0 ? '.' : segments.join('/');
  const commonsPath = (f) => (f === '.' ? '`src/commons/`' : `\`src/commons/${f}/\``);
  const place = commonsPath(folder);
  const parsed = parseName(file);
  if (parsed.name === 'ibase' && parsed.kind) {
    return `\`${file}\`: no \`I\` prefix in file names. The contract is \`base.${parsed.kind}.interface.ts\`.`;
  }
  const allowed = COMMONS_FOLDERS[folder];
  if (!allowed) {
    const folders = Object.keys(COMMONS_FOLDERS).filter((f) => f !== '.').map((f) => `\`${f}/\``).join(', ');
    return `${place} is not a commons folder (\`${file}\`): commons/ holds its root plus ${folders}.`;
  }
  const problem = kindProblem(file, parsed, folder === '.' ? [...allowed, 'base.<kind>'] : allowed, place);
  // `base.controller.ts`, `base.repository.ts`, ...: the framework base classes, at the root
  if (problem || (parsed.name === 'base' && folder === '.')) return problem;
  if (allowed.includes(parsed.kind)) return null;
  if (parsed.name === 'base') return `\`${file}\`: the framework base classes live at the \`src/commons/\` root.`;

  const home = Object.entries(COMMONS_FOLDERS).find(([, kinds]) => kinds.includes(parsed.kind))?.[0];
  if (home) return `\`.${parsed.kind}.ts\` belongs in ${commonsPath(home)}, not ${place} (\`${file}\`).`;
  const other = CROSS_MODULE_HOME[parsed.kind];
  return `\`.${parsed.kind}.ts\` does not live in \`src/commons/\` (\`${file}\`). ` +
    'commons/ holds the `base.*` classes, the transaction runner, the shared errors, dtos, swagger and messages, ' +
    'and the app-wide configs, filters and interceptors. ' +
    (other ? `Its cross-module home is ${other}.` : `Inside a module it lives in ${where(KIND_FOLDERS[parsed.kind])}.`);
}

function checkShared(rel) {
  const file = rel.split('/').pop();
  const parsed = parseName(file);
  const problem = kindProblem(file, parsed, SHARED_KINDS, '`src/shared/`');
  if (problem) return problem;
  if (!SHARED_KINDS.includes(parsed.kind)) {
    const other = CROSS_MODULE_HOME[parsed.kind];
    return `\`.${parsed.kind}.ts\` does not live in \`src/shared/\` (\`${file}\`): shared/ holds cross-module ` +
      `constants and types only.${other ? ` Its cross-module home is ${other}.` : ''}`;
  }
  return null;
}

const FRONTEND_HELPER = /(?:^|[a-z0-9])(?:Utils?|Helpers?)$|^(?:utils?|helpers?)$/;
const FRONTEND_HELPER_HINT =
  'Name the file for what it does: a pure function goes in a `utils/` folder, one function per file, ' +
  'named after the function (`formatDate.ts`); a shape mapping is `mappers/<thing>Mapper.ts`; a hook is ' +
  '`hooks/useX.ts`; a constant is in `constants/`.';

function checkFrontend(rel) {
  const segments = rel.split('/');
  const file = segments.pop();
  if (!/\.tsx?$/.test(file) || file.endsWith('.d.ts')) return null;
  const base = file.replace(/\.tsx?$/, '');
  const helperDir = segments.find((d) => d === 'helpers' || d === 'helper');
  if (helperDir) return `\`${helperDir}/\` is not a frontend folder (\`${file}\`). ${FRONTEND_HELPER_HINT}`;
  if (FRONTEND_HELPER.test(base)) return `\`${file}\` names no role. ${FRONTEND_HELPER_HINT}`;
  const inMappers = segments.at(-1) === 'mappers';
  if (inMappers && base !== 'index' && !/^[a-z][A-Za-z0-9]*Mapper$/.test(base)) {
    return `\`mappers/${file}\`: a mapper file is \`<thing>Mapper.ts\` (\`rubricMapper.ts\`), one per thing.`;
  }
  if (!inMappers && /Mappers?$/.test(base)) {
    return `\`${file}\`: mappers live in the module's (or \`shared/\`'s) \`mappers/\` folder as \`<thing>Mapper.ts\`.`;
  }
  return null;
}

/**
 * Check one path. Returns `null` when it is fine or out of scope, else a message written
 * for the author — it names the rule, the one folder the kind belongs in, and what to do instead.
 */
export function checkFileName(path) {
  const norm = path.replace(/\\/g, '/');
  const fe = /(?:^|\/)frontend\/src\/(.+)$/.exec(norm);
  if (fe) return checkFrontend(fe[1]);
  if (/(^|\/)frontend\//.test(norm)) return null;

  const m = /(?:^|\/)src\/(modules|libs|commons|shared)\/(.+)$/.exec(norm);
  if (!m || !m[2].endsWith('.ts') || m[2].endsWith('.d.ts')) return null;
  const [, area, rel] = m;
  if (area === 'modules') return checkModule(rel);
  if (area === 'libs') return checkLibs(rel);
  if (area === 'commons') return checkCommons(rel);
  return checkShared(rel);
}

/** Kept for callers of the previous release. */
export const checkModuleFileName = checkFileName;

const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
const RE_EXPORT = /export\s+(?:type\s+)?(?:\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s*from\s*['"][^'"]+['"]\s*;?/g;

/** A file whose only statements are `export ... from` — a barrel by another name. */
export function isReExportOnly(text) {
  const code = stripComments(text);
  const matches = code.match(RE_EXPORT);
  return Boolean(matches) && code.replace(RE_EXPORT, '').trim() === '';
}

/** Whether every top-level export is an interface or a type alias. */
function onlyContracts(text) {
  const code = stripComments(text);
  const exports = [...code.matchAll(/^\s*export\s+(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(\w+)/gm)].map((x) => x[1]);
  return exports.length > 0 && exports.every((k) => k === 'interface' || k === 'type');
}

/**
 * Checks that need the file's content: a backend re-export-only file, and a repository or
 * service file that holds only a contract (the `ibase.repository.ts` shape). Path-only rules
 * run first; `content` may be null when it is not available.
 */
export function checkNewFile(path, content = null) {
  const byName = checkFileName(path);
  if (byName || content == null) return byName;
  const norm = path.replace(/\\/g, '/');
  if (/(^|\/)frontend\//.test(norm) || !/(?:^|\/)src\/(modules|libs|commons|shared)\/.+\.ts$/.test(norm)) return null;
  const file = norm.split('/').pop();
  if (isReExportOnly(content)) {
    return `\`${file}\` only re-exports other files: the backend has no barrels. Import from the file that declares the symbol.`;
  }
  const { name, kind, secondary, suffix } = parseName(file);
  if (!suffix && !secondary && INTERFACE_KINDS.has(kind) && onlyContracts(content)) {
    return `\`${file}\` holds only a contract: name it \`${name}.${kind}.interface.ts\` ` +
      '(and drop any `I` prefix from the name: `ibase.repository.ts` → `base.repository.interface.ts`).';
  }
  return null;
}

/** Check a list of newly added paths; returns one message per offending file. */
export function checkNewFiles(paths, readContent = () => null) {
  return paths
    .map((p) => ({ path: p, problem: checkNewFile(p, readContent(p)) }))
    .filter((r) => r.problem);
}
