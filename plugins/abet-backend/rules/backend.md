# Backend stack rules

Loaded by `/abet-implement`, `/abet-audit-pr` and `/abet-fix` when working in the backend
repository.

This file holds **stack mechanics** — how to run things, and the failure modes specific
to NestJS + TypeORM here. The *conventions* (naming, module layout, i18n keys, validation
pattern, response format) live in `docs/POLICIES.md` in the repo itself. Read both.

## Stack

NestJS 11 · TypeScript · PostgreSQL + TypeORM 0.3 · pnpm · jest · eslint + prettier ·
JWT (passport-jwt) + Microsoft Entra ID (MSAL) · Zod-validated env.

## Commands

| Purpose | Command |
| ------- | ------- |
| Tests | `pnpm test` |
| One file | `npx jest --no-coverage src/path/to/file.spec.ts` |
| Typecheck | `pnpm exec tsc --noEmit -p tsconfig.build.json` |
| Lint | `pnpm lint` / `pnpm lint:fix` |
| Format | `pnpm format` |
| Everything | `pnpm check` |
| Create migration | `pnpm migration:create src/database/migrations/<kebab-name>` |
| Run migrations | `pnpm migration:run` |
| Revert one | `pnpm migration:revert` |

**pnpm, never npm.** The lockfile is `pnpm-lock.yaml`.

## Where things go

```
src/
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

Admin-owned functionality lives at `modules/admin/<domain>/<module>` but keeps its
original `@Entity({ schema, name })` — the folder move does not move the table.

## The failure modes that actually bite here

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

### Env
Every variable is declared in `src/commons/configs/env.config.ts` with Zod. Required vars
fail at bootstrap. Reading `process.env` directly anywhere else is a finding.

## Testing

`.spec.ts`, co-located with the source. Validation classes are tested against a mocked
repository (`{ findOneByCondition: jest.fn(), findOneById: jest.fn() }`), asserting
`resolves.toBeUndefined()` on the pass path and `rejects.toThrow(DomainError)` on the
fail path.

Watch for the fixture trap: a factory default that makes the condition under test a
no-op. A test that passes for the wrong reason is worse than no test, and it is the
single most common false positive on this codebase.
