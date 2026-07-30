# Frontend stack rules

Loaded by `/abet-implement`, `/abet-audit-pr` and `/abet-fix` when working in the
frontend repository.

This file holds **stack mechanics** — how to run things, and the failure modes specific
to Next.js App Router + TanStack Query here. The *conventions* (naming, module layout,
import direction, i18n) live in `docs/POLICIES.md` in the repo itself. Read both.

## Stack

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript strict · TanStack Query for
server state, React context for client state · Tailwind CSS v4 · custom `useI18n()` with
`src/language/locales/{es,en}.json` · UI primitives in `src/shared/components/ui/`,
some based on shadcn/ui · pnpm.

## Commands

| Purpose | Command |
| ------- | ------- |
| Typecheck | `npx tsc --noEmit` |
| Lint | `pnpm lint` (runs with `--max-warnings 0`) |
| Format | `pnpm format` |
| Dev server | `pnpm dev` |
| Build | `pnpm build` |

**pnpm, never npm.**

### There is no test runner

No jest, no vitest, no playwright. This is a real gap, and it changes how the pipeline
behaves here:

- `/abet-implement`'s TDD loop has nothing to run. Substitute the tightest available
  feedback: `npx tsc --noEmit`, then `pnpm lint`, then manual verification against the
  steps in the change's `runbook.md`.
- A task's completion criterion becomes "typecheck and lint clean **and** the runbook
  step verified", not "its test passes".
- `/abet-audit-pr`'s testing auditor should report the absence of coverage as a finding
  on any change with real logic in it, rather than staying silent because there is
  nothing to inspect.

Do not silently skip verification because there is no runner. Say what you verified and
how.

## Where things go

```
src/
├── app/          route shell only — imports a page component and renders it
├── configs/
├── language/     locales/{es,en}.json
├── modules/      academic, accreditation, admin, ard, auth, banner, charts, core,
│                 evaluation, ifcs, loads, organization, planner,
│                 scraping-exports, surveys
├── providers/    AbetProvider, QueryProvider
└── shared/       components/ui, constants, hooks, lib
```

Every module: `components/`, `constants/`, `hooks/`, `pages/`, `schemas/`, `services/`
(API calls only, no types), `types/` (all types), plus a barrel `index.ts`. Create only
the folders the module actually needs.

## The failure modes that actually bite here

### Import direction
```
app/       → modules/, providers/, shared/
modules/   → shared/, providers/, other modules' barrels
providers/ → shared/, modules/
shared/    → shared/ ONLY — never modules/
```

`shared/` is the bottom of the tree. A `shared/ → modules/` import is a blocker, not a
style note: it inverts the dependency graph and the thing being imported almost always
belongs in the module.

Cross-module imports are legitimate, but **only through the barrel** (`@/modules/x`) or a
public folder (`@/modules/x/components`) — never another module's internal path.

`modules/admin/` is a **namespace folder with no barrel by design**. Import
`@/modules/admin/iam`, never `@/modules/admin` — an aggregate `export *` would silently
drop one of two same-named types exported by different admin concerns.

### Global scope comes from the provider, not the screen
School, modality and academic period are global top-bar selectors. Read them from
`useABET()`:

```ts
const { schoolId, modalityTypeId, academicPeriodId } = useABET();
```

The API client forwards them as `X-School-Id`, `X-Modality-Type-Id` and
`X-Academic-Period-Id` automatically. Never build a per-screen selector for these three
unless the task explicitly asks for one (comparing two periods side by side). When a
value is `null`, show a notice pointing at the top bar — do not render your own picker.

Screen-specific cascading filters (program, commission, accreditor, course) are
different: those are local to the page and belong there.

### Query keys must carry every scope variable
This is the highest-value thing to audit on this codebase, and it is the frontend twin of
the backend's scope-leak risk.

A query key that omits `academicPeriodId` (or school, or modality) will serve one
period's cached data after the user switches periods. It looks like a caching bug and it
is actually a correctness bug, because the user cannot tell the data is stale.

Define key factories per module and include every scope value the query depends on:

```ts
const notificationConfigsKeys = {
  all: ['notification-configs'] as const,
  bundle: (periodId: number) => [...notificationConfigsKeys.all, 'bundle', periodId] as const,
};
```

Default `staleTime` is `0`, `refetchOnWindowFocus` off, `gcTime` 5 minutes. Use
`staleTime: Infinity` only for static lookups (types, modalities, parameters, languages),
and always pair it with explicit invalidation if the data can change at all.

### Types come from the backend's committed spec
The backend commits `openapi.json`, generated from its Swagger decorators. That file — not
the Swagger UI, and not a guess — is the source of truth for every request and response
shape this app sends or receives.

Types here are **hand-written** in each module's `types/index.ts`, so nothing enforces the
match. That makes it your job:

- Before writing a type for a backend response, read the shape in the backend's
  `openapi.json`. Transcribing from a screenshot or from memory is where drift starts.
- A field the backend renamed will still **compile** here and fail at runtime. Typecheck
  passing proves nothing about contract correctness.
- When a response shape looks wrong, check the spec before assuming the backend is broken —
  and check the spec's commit date, because a stale spec is also possible.

For a **parallel** cross-repo change, code against `openspec/changes/<slug>/contract.md`
until the backend lands, then reconcile against the real spec. Where they differ, **the
spec wins** — the contract was a design-time agreement, not a record.

Your PR may not merge until the backend's endpoints are live on `staging`. Verify against
real responses there; that is where mismatches actually surface.

### Data fetching
All of it goes through `useQuery` / `useMutation`. **Never `useEffect` + `useState` for
an API call** — it loses caching, deduplication, and error handling, and it is the most
common thing to find in code ported from elsewhere.

All HTTP goes through `src/shared/lib/apiClient.ts` (`apiGet`, `apiPost`, `apiPut`,
`apiPatch`, `apiDelete`, `apiPostBlob`). Raw `fetch()` is permitted only for talking to
an internal Next.js route handler, since `apiClient` targets the external backend.

### i18n
Every user-visible string is `t('key')` from `useI18n()`. Locale files are
`src/language/locales/es.json` and `en.json` — a key added to one and not the other is a
finding.

Backend error codes (`error.ifc.notFound`) are i18n keys too, and go in both locale
files. Services throw keys, never localized text. Errors pass through
`tryTranslate(t, errorCode)`.

Hardcoded Spanish or English in a component, service or toast is a blocker.

### Lint is strict, and it is strict on purpose
`pnpm lint` runs `--max-warnings 0`, and the config promotes `react-hooks` correctness
rules and a set of `jsx-a11y` interactive-element rules to **errors**:
`set-state-in-effect`, `refs`, `preserve-manual-memoization`, `exhaustive-deps`,
`incompatible-library`, `click-events-have-key-events`, `interactive-supports-focus`,
and others.

An inline `eslint-disable` is acceptable only with a specific reason in the comment. The
existing sanctioned cases are SSR mount guards, async bootstrap, and external store sync
— an effect that legitimately sets state. Adding a disable to silence
`exhaustive-deps` because the dependency list was inconvenient is not one of those, and
it is how stale closures get shipped.

`label-has-associated-control` is deliberately **not** enabled: it cannot see i18n-dynamic
label text or a wrapper primitive's consumer-supplied control, so it only false-positives
here. Do not add it back.

### Client lifecycle
- Effects that subscribe must return a cleanup.
- No state updates after unmount.
- Server vs client components: keep `app/` thin and push interactivity down into module
  page components. A `'use client'` at the top of a route file drags the whole tree
  client-side.

### Silent catches are not allowed
Every `catch` either handles the error visibly or logs via `logger.warn`. An empty catch
is a blocker.
