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
├── commons/     base controller/service/repository/entity/validation, decorators, configs
├── database/    typeorm.config.ts, migrations/, scripts/seeds/
├── libs/        encrypt.service, secure.functions, global.functions
├── modules/     academic, accreditation, admin, auth, core, evaluation,
│                evidence, ifc, improvement, mail, organization, survey
└── shared/      filters/, strings/, types/
```

Every feature module has the same shape — `api/` (controller, service, docs/swagger),
`model/` (entity, dtos), `core/` (repository, validation, validation.spec), `config/`
(routes, strings). Two exceptions: `auth` has no entity, `mail` has no controller or model.

### File names inside a module

Every file is `<kebab-name>.<kind>.ts` (tests: `<kebab-name>.<kind>.spec.ts`), and the
`<kind>` decides the folder. **Do not invent a kind** — `course-sections.bands.ts` or
`course-sections.section-filter.ts` is wrong; the helper is `core/course-sections.functions.ts`.

| Kind | Folder | Holds |
| --- | --- | --- |
| `controller`, `service` | `api/` | HTTP surface, orchestration |
| `swagger` | `api/docs/` | OpenAPI decorators |
| `entity`, `dtos`, `types`, `labels`, `errors`, `transforms` | `model/` | shapes and data classes |
| `repository`, `validation`, `client`, `store` | `core/` | all DB access; business-rule validation |
| `sql` | `core/` | raw SQL text, only imported by the repository |
| `routes`, `strings` | `config/` | route constants; i18n keys (`config/strings/<module>.validation.ts`) |
| `functions`, `constants` | any layer | pure helpers and calculations; fixed values |
| `module` | module root | the Nest module |

A `.service.ts` may also sit in `core/` for a domain service that is not an HTTP surface.
Only **new** files are checked (`file-name-guard` on `Write`, and the pre-commit gate);
legacy files that predate this are left alone. Adding a genuinely new kind is a change to
this table and to `hooks/checks/file-naming.mjs`, never a per-file decision.

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
into one shared home: a function in `core/<module>.functions.ts` (or `libs/` when it
crosses modules), a service, or a repository method. Before writing a helper, `git grep`
for one that already exists. The audit counts copies across the whole repo and reports a
third one as **major**. Blocks repeated across many modules by convention (the validation
skeleton) are the pattern, not duplication.

### Repository boundary
All database access lives in `core/<module>.repository.ts`. A service must not inject
`DataSource` or `EntityManager`, must not call `.query(...)`, and must not build query
builders — raw SQL included. The service orchestrates; the repository is the only layer
touching the DB.

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

### i18n
User-facing strings are keys, never raw text: `error.<module>.<key>`, `success.<type>`.
Keys are declared as constants in `config/strings/<module>.validation.ts`. A hardcoded
Spanish or English string in a thrown error is a finding.

### Validation
Two layers, and they are not interchangeable: DTO shape validation via class-validator in
`model/<module>.dtos.ts`, business-rule validation in `core/<module>.validation.ts`
throwing `DomainError`. The service calls validation before the CRUD operation.

Every `core/<module>.validation.ts` must have a matching `.spec.ts`. That is the one test
file the audit will always look for.

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
Required vars fail at bootstrap. Reading `process.env` directly anywhere else is a finding.

## Testing

`.spec.ts`, co-located with the source. Validation classes are tested against a mocked
repository (`{ findOneByCondition: jest.fn(), findOneById: jest.fn() }`), asserting
`resolves.toBeUndefined()` on the pass path and `rejects.toThrow(DomainError)` on the
fail path.

Watch for the fixture trap: a factory default that makes the condition under test a
no-op. A test that passes for the wrong reason is worse than no test, and it is the
single most common false positive on this codebase.
