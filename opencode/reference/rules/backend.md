# Backend stack rules

Loaded by `/abet-implement`, `/abet-audit-pr` and `/abet-fix` when working in the
`backend/` package.

This file holds **stack mechanics** — how to run things, and the failure modes specific
to NestJS + TypeORM here. The *conventions* (naming, module layout, i18n keys, validation
pattern, response format) live in `backend/docs/POLICIES.md`. Read both, plus the
repo-root `docs/POLICIES.md`.

## Stack

NestJS 11 · TypeScript · PostgreSQL + TypeORM 0.3 · pnpm workspace · jest · eslint + prettier ·
JWT (passport-jwt) + Microsoft Entra ID (MSAL) · Zod-validated env.

## Commands

Run from the repo root with the path-filter form; from inside `backend/`, drop the
`pnpm --filter ./backend` prefix and run the plain script.

| Purpose | Command |
| ------- | ------- |
| Tests | `pnpm --filter ./backend test` |
| One file | `pnpm --filter ./backend exec jest --no-coverage src/path/to/file.spec.ts` |
| Typecheck | `pnpm --filter ./backend exec tsc --noEmit -p tsconfig.build.json` |
| Lint | `pnpm --filter ./backend lint` / `pnpm --filter ./backend lint:fix` |
| Format | `pnpm --filter ./backend format` |
| Everything | `pnpm --filter ./backend check` |
| Export API spec | `pnpm --filter ./backend openapi:export` |
| Create migration | `pnpm --filter ./backend migration:create src/database/migrations/<kebab-name>` |
| Run migrations | `pnpm --filter ./backend migration:run` |
| Revert one | `pnpm --filter ./backend migration:revert` |

**pnpm, never npm.** The lockfile is the root `pnpm-lock.yaml`, shared by both packages.

## Where things go

```
backend/src/
├── commons/     framework base classes (base.*), the transaction runner, shared errors/dtos/swagger
├── database/    typeorm.config.ts, migrations/, scripts/seeds/
├── libs/        cross-module helpers with no module ownership, one topic folder each
├── modules/     academic, accreditation, admin, auth, core, evaluation,
│                evidence, ifc, improvement, mail, organization, survey
└── shared/      cross-module constants and types only
```

**A file name says what the file is for, never how it is written.** One role per file.

### Inside a module

Every feature module has the same layers, and each layer has one meaning:

| Folder | Holds |
| --- | --- |
| `api/` | the HTTP surface: receives the request and orchestrates |
| `api/docs/` | OpenAPI only |
| `core/` | business logic and everything with I/O (DB, cache, external systems, files) |
| `model/` | data shapes only: no logic beyond construction |
| `config/` | module wiring and fixed values |
| `config/strings/` | i18n keys only |
| module root | only the Nest module |
| `decorators/`, `guards/`, `interceptors/`, `gateway/`, `strategies/` | one kind each |

A sub-domain folder inside a module group (`survey/shared/`, `admin/planner/shared/`) is
itself a module: it uses the same layers, and no source file sits directly in it except its
`.module.ts`. There is no module-level `constants/` folder.

Every file is `<kebab-name>.<kind>.ts` (tests: `<kebab-name>.<kind>.spec.ts`; tests that need
a real database: `<kebab-name>.<kind>.db-spec.ts`, beside the file they test). **Every kind
has exactly one folder**, and the kind decides it:

| Kind | The one folder | Holds |
| --- | --- | --- |
| `controller` | `api/` | HTTP handlers |
| `service` | `api/` | orchestration called by the controller |
| `http` | `api/` | response headers, cookies, streaming, attachments |
| `swagger` | `api/docs/` | OpenAPI decorator factories |
| `repository` | `core/` | all DB access |
| `interface` (secondary: `<name>.repository.interface.ts`, `<name>.service.interface.ts`) | `core/` | repository and service contracts |
| `sql` | `core/` | raw SQL text and SQL fragment/CTE builders; imported only by repositories |
| `validation` | `core/` | business-rule validation; throws domain errors |
| `calc` | `core/` | deterministic computation, no I/O |
| `mapper` | `core/` | row/entity → DTO/wire shape (`toXDto`, `toCachedValue`) |
| `builder` | `core/` | assembles files/documents/tokens (workbooks, PDF/HTML reports, export buffers, SSO tokens) |
| `theme` | `core/` | styling for what a builder renders (colours, fonts, report styles) |
| `cache` | `core/` | cache key builders, namespaces, cache classes |
| `crypto` | `core/` | hashing, encryption, key material |
| `client` | `core/` | outbound HTTP/SDK wrappers for external systems |
| `store` | `core/` | in-memory/state stores |
| `entity` | `model/` | TypeORM entities |
| `dtos` | `model/` | request/response DTO classes |
| `types` | `model/` | TS types/interfaces shared inside the module |
| `labels` | `model/` | display label maps |
| `errors` | `model/` | error classes, error factories, driver-error → domain-error translation tables |
| `routes` | `config/` | route constants |
| `constants` | `config/` | fixed values and tunables (codes, timeouts, limits) |
| `messages` | `config/strings/` | i18n key constants |
| `module` | module root | the Nest module |
| `config` | module root | module-level config factory |
| `decorator` | `decorators/` | custom decorators |
| `guard` | `guards/` | Nest guards |
| `interceptor` | `interceptors/` | Nest interceptors |
| `gateway` | `gateway/` | websocket gateways |
| `strategy` | `strategies/` | passport strategies |

**Reserved — use when first needed**, already accepted by the gate: `job` (`core/`,
background job definitions and registries), `policy` (`core/`, access and scope predicates
that are not endpoint guards — scope tiers, data-scoping decisions), `event` (`core/`, domain
event payloads and publishers).

For example, the course-section band calculation is `core/course-sections.calc.ts` — not
`course-sections.bands.ts`, not `course-sections.functions.ts`.

### Outside the modules: commons, libs, shared

These are not layers. Each is the **one** home of a fixed set of kinds that serve two or
more modules. A kind only one module uses never goes here: it goes in that module's folder
above.

| Folder | The only home of |
| --- | --- |
| `commons/` | framework base classes (`base.controller.ts`, `base.repository.ts`, ...), the generic transaction runner (`<name>.transaction.ts`), the shared `errors` (domain error, internal error), shared `dtos`, shared `swagger` |
| `libs/<topic>/` | cross-module `calc`, `mapper`, `sql`, `builder`, `cache`, `http`, `crypto`, `client`, plus `service`/`module` for an injectable lib (`encrypt`). Every file in a topic folder (`libs/reporting/`, `libs/excel/`, `libs/chart/`) — no new loose files at the `libs/` root |
| `shared/` | cross-module `constants` and `types` only |

`database/`, `tools/`, `main.ts` and `app.*` are outside the standard.

### Forbidden on new files

| Name | Instead |
| --- | --- |
| `.functions.ts` | retired — name it for what it is: maps a shape → `mapper`; computes a value → `calc`; builds a file/document → `builder`; SQL text → `sql`; translates/creates errors → `errors`; cache keys → `cache`; headers/cookies/streams → `http`; hashing/encryption → `crypto`; touches the DB → a repository method |
| `.utils.ts`, `.util.ts`, `.helpers.ts`, `.helper.ts`, `.common.ts`, `.misc.ts` | the same decision tree |
| `.transforms.ts` | `mapper` |
| `.dto.ts`, `.configs.ts` | `dtos`, `config` (the legacy `error` kind is still accepted; new files use `errors`) |
| `config/strings/*.validation.ts`, `.strings.ts` | `config/strings/<module>.messages.ts` — `.validation.ts` means only business-rule validation in `core/` |
| I-prefixed interface files (`ibase.repository.ts`) | `<name>.<kind>.interface.ts` |
| `index.ts` barrels, and files whose only statements are `export ... from` | import from the file that declares the symbol |
| a file with no kind segment (`report-filename.ts`) | `<name>.<kind>.ts` |

Only **new** paths are checked (`file-name-guard` on `Write`, and the pre-commit gate);
a `git mv` is a new path, so a rename must land on an allowed kind. Legacy files outside
the standard are grandfathered — editing them never blocks. But a legacy kind must not grow:
adding exports to an existing `.functions.ts`, `.utils.ts` or `.transforms.ts`, or keys to a
`config/strings/*.validation.ts`, is an audit finding — move the symbols you touch to their
kind instead. Adding a genuinely new kind is a change to backend POLICIES, this table and
`hooks/checks/file-naming.mjs`, never a per-file decision.

Admin-owned functionality lives at `modules/admin/<domain>/<module>` but keeps its
original `@Entity({ schema, name })` — the folder move does not move the table.

## The failure modes that actually bite here

### No dead code
Nothing unused is merged: no unused file, function, export, parameter, import, variable or
commented-out block. If nothing in this change or already in the tree calls it, delete it —
git keeps the history, so "for later" is not a reason. A new export whose only caller is
its own test is dead: the test is the sole user. Wiring by the framework (a Nest provider,
a decorator, a TypeORM entity) counts as use. An audit reports unused code as **major**,
never as a suggestion.

### No duplicated logic — the rule of three
Two copies of a piece of logic are tolerated. The **third** is the trigger to extract it
into one shared home: a file of the kind it is for (`core/<module>.calc.ts`,
`core/<module>.mapper.ts`, ... — or the same kind in `libs/<topic>/` when it crosses
modules), a service, or a repository method. Before writing a helper, `git grep`
for one that already exists. The audit counts copies across the whole repo and reports a
third one as **major**. Blocks repeated across many modules by convention (the validation
skeleton) are the pattern, not duplication.

Short copies count too, and the audit checks them by name: before adding any top-level
function, constant or type, `git grep` its name **and** its most distinctive literal (a type
code, a table name, a header). Use what exists: the shared SQL fragments in `libs/` (the
chart-ancestry climb, shared joins) instead of a new CTE that re-derives a business rule,
`TYPE_CODES` instead of a `'TGnnn-Tnnn'` literal, the existing `import('<pkg>')` wrapper
instead of a second one. Say in the task's retro what you searched for and what you reused.

### Repository boundary
All database access lives in `core/<module>.repository.ts`. Nothing else — service,
validation, calc, mapper, a legacy `.functions.ts` — may import `DataSource`,
`EntityManager` or `QueryRunner` as a value, or call `.query(`, `.createQueryBuilder(`,
`.getRepository(` or `.transaction(` — raw SQL included. The service orchestrates; the
repository is the only layer touching the DB. The exceptions are the generic transaction
runner (`commons/<name>.transaction.ts`), tests and db-specs, and `database/` / `tools/`.
`import type { EntityManager }` is allowed outside a repository only to pass the value
straight through to a repository call.

The pre-commit gate blocks a new one on the lines a commit adds (`checks/db-access.mjs`),
and `/abet-audit-pr` and `/abet-review-pr` report it as a policy violation.

Several legacy services still violate this. When you touch one, move its DB access into
the repository as part of the change. When auditing, a **new** violation is a blocker; a
pre-existing one you did not touch is not your finding.

### Migrations
- `synchronize: false`. Always a migration, never auto-sync.
- **Always create the file with the CLI** so the timestamp is `Date.now()` and sorts
  after everything existing. A hand-picked or round-number timestamp can run before its
  dependencies and break a fresh database.
- **The database is in production.** Never edit an applied migration — its row already
  exists in the `migrations` table, so the edit will not run and environments desync.
  Every schema change is a new, forward-only migration.
- Every migration implements both `up()` and a correct `down()`.
- Constraint naming is explicit and uppercase: `IDX_<table>_<cols>`, `FK_<table>_<col>`,
  `UQ_<table>_<cols>`, `PK_<table>`. Never the auto-generated hash form.

### Scope headers
School, modality and academic period arrive as `X-School-Id`, `X-Modality-Type-Id`,
`X-Academic-Period-Id` and are read **only** through the param decorators
(`@SchoolId()`, `@ModalityTypeId()`, `@AcademicPeriodId()`), each paired with its Swagger
header decorator. Never from the body, query or route params. Never added as DTO fields.

This is the highest-value thing to audit on this codebase. Scope is request-derived, so
anything that crosses into a cache key, a background job, or a shared singleton and drops
it will serve one school's data to another — silently, and correctly-looking.

The shapes that keep coming back in audits:

- **Siblings agree.** When one route on an entity takes `@SchoolId()`, every route on that
  entity does — the write next to a scoped read is the one that gets forgotten.
- **A by-id write proves ownership.** An id from the path or body is checked to belong to
  the caller's school before the write, and "not yours" answers exactly like "does not
  exist", so the route cannot be used to discover ids.
- **Machine routes are scoped too.** An `@ApiTokenAuth()` route returning per-school or
  personal data takes `@SchoolId()` like any other.
- **A scope parameter is never nullable in SQL.** `($1::int[] IS NULL OR school_id = ANY($1))`
  turns a missing scope into every school. Genuinely global reads get their own query.

### i18n
User-facing strings are keys, never raw text: `error.<module>.<key>`, `success.<type>`.
Keys are declared as constants in `config/strings/<module>.messages.ts`. A hardcoded
Spanish or English string in a thrown error is a finding.

### Validation
Two layers, and they are not interchangeable: DTO shape validation via class-validator in
`model/<module>.dtos.ts`, business-rule validation in `core/<module>.validation.ts`
throwing `DomainError`. The service calls validation before the CRUD operation.

Every `core/<module>.validation.ts` must have a matching `.spec.ts`. That is the one test
file the audit will always look for.

Every input is bounded at the DTO: `@IsInt()` comes with `@Max()` (`2147483647` for an id —
past int4 it fails in SQL as a 500), and every array with `@ArrayMaxSize()`, because
otherwise the caller chooses how many items the handler loops, locks or queries over.

### Logs and error responses
- Text from a request, an admin-entered field or a driver error goes into a log line only
  through `JSON.stringify(...)`: a raw newline forges a log entry.
- Never put `err.message` in an exception's `description` or a 5xx `errors` array — it
  returns the library's internals to the client. Return the i18n key; log the detail.

### Transactions and locks
Run a locking write through the shared transaction wrapper (`runInTransaction` with
`lockTimeoutMs`), never by setting `lock_timeout` by hand or overriding
`runInTransaction` in a repository. When a change takes more than one lock, the design says
what each serialises against and in which order they are taken.

### Performance
- TypeORM relation loading inside a loop is the standard N+1 here. Load with the relation
  or a single join.
- `find()` with no `take`/`skip` on anything that grows with enrolment is unbounded.
- Excel (`exceljs`) and archive (`archiver`) generation must stream. Materialising a
  full report in memory is how this service gets OOM-killed on a real academic period.

### The API spec is a committed artifact
`backend/openapi.json` is generated from the Swagger decorators by
`pnpm --filter ./backend openapi:export` and is **committed**. It is the frontend's source
of truth for the API — read directly on disk, since both packages share this repo.

Regenerate and commit it **in the same PR** as any change to a route, a DTO, or a response
shape. A spec that lags the endpoints is worse than no spec, because the frontend trusts
it and has no way to detect the lag.

Two consequences worth internalising:

- The spec diff *is* the contract review. A renamed or retyped field shows up as a line in
  the PR even though nothing in `backend/` fails to compile — that is the point, and it is
  the only place a breaking change becomes visible before it reaches the frontend.
- Swagger decorators are therefore load-bearing, not documentation. An endpoint with no
  `@ApiResponse` type, or a DTO whose decorators disagree with its TypeScript type,
  produces a spec that lies. Treat that as a defect.

Scope headers must appear in the spec too — apply the Swagger header decorator alongside
the value decorator, or the frontend cannot see that the endpoint requires them.

### Env
Every variable is declared in `backend/src/commons/configs/env.config.ts` with Zod.
Required vars fail at bootstrap. Reading `process.env` directly anywhere else is a finding,
except in the db-spec harness under `backend/test/db/`.

## Testing

`.spec.ts`, co-located with the source. Validation classes are tested against a mocked
repository (`{ findOneByCondition: jest.fn(), findOneById: jest.fn() }`), asserting
`resolves.toBeUndefined()` on the pass path and `rejects.toThrow(DomainError)` on the
fail path.

DB specs (`*.db-spec.ts`) seed only through `backend/test/db/fixtures.ts`. If a builder is
missing, add it there — never as a local `insertX` / `seedX` function in the spec, and never
as a raw `INSERT INTO organization.*`. Two specs with their own builders drift apart.

Watch for the fixture trap: a factory default that makes the condition under test a
no-op. A test that passes for the wrong reason is worse than no test, and it is the
single most common false positive on this codebase.
