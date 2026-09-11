---
name: abet-module
description: Create or audit a frontend domain module against the required layout and import rules. Use when adding a new module, adding a folder to an existing one, or when a change has crossed a module boundary. Checks barrel exports, import direction, and that shared/ never imports from modules/.
---

# Create or audit a module

Module structure is the frontend's load-bearing convention. Get it wrong and the damage
is not cosmetic: an import that inverts the dependency graph, or a barrel that silently
drops a type, produces bugs that look like something else entirely.

Two modes. Say which one you are in.

## Mode A — create a module

### 1. Confirm it should be a module at all

A new module owns a **domain concept**. Before creating one, check that what you have is
not actually:

- a feature of an existing module → add it there,
- a cross-cutting utility → `shared/`,
- an admin concern → `modules/admin/<concern>/`, which is a namespace folder with no
  aggregate barrel (see below).

Modules are cheap to add and expensive to merge back. Ask once.

### 2. Create only the folders it needs

```
modules/<name>/
├── components/
├── constants/
├── hooks/
├── pages/          page-level components, the entry points app/ routes render
├── schemas/        validation logic extracted from components
├── services/       API calls only — no types here
├── types/          ALL types: request, response, domain
└── index.ts        the barrel
```

**No empty placeholder files.** Do not create `schemas/index.ts` containing `export {}`.
Create the folder when there is something to put in it.

> The repository ships a `generator/crear-modulo.ts` that scaffolds every folder with an
> `export {}` placeholder. That directly contradicts the no-placeholder rule. If you use
> the generator, delete the folders the module does not need before committing — or fix
> the generator, which is the better answer.

### 3. Wire the route

`app/` is a thin shell. The route file imports a page component from the module and
renders it. No business logic, no data fetching, no auth checks in `app/`.

```tsx
// app/<route>/page.tsx
import { ThingPage } from '@/modules/thing';
export default function Page() { return <ThingPage />; }
```

### 4. Export through the barrel

`index.ts` re-exports the module's public surface. Everything else is internal, and other
modules must not reach past the barrel to get at it.

## Mode B — audit boundaries

Run this when a change touched more than one module, added a `shared/` file, or you are
auditing a PR.

### 1. Check import direction

```
app/       → modules/, providers/, shared/
modules/   → shared/, providers/, other modules' barrels
providers/ → shared/, modules/
shared/    → shared/ ONLY
```

The one that matters most:

```bash
rg "from '@/modules" frontend/src/shared/
```

**Any hit is a blocker.** `shared/` is the bottom of the dependency tree. A
`shared/ → modules/` import means either the imported thing belongs in `shared/`, or the
importing code belongs in the module. Decide which; do not add the import.

### 2. Check for internal-path imports

```bash
rg "from '@/modules/[a-z-]+/(?!components|hooks|types|constants|schemas|services)" frontend/src/
```

Cross-module imports go through the barrel (`@/modules/x`) or a public folder
(`@/modules/x/components`). Reaching into another module's internals couples you to its
implementation and breaks the moment it reorganises.

### 3. Check the admin namespace rule

```bash
rg "from '@/modules/admin'" frontend/src/
```

**Any hit is a blocker.** `modules/admin/` is a namespace folder and has **no**
`index.ts` by design. Both `admin/iam` and `admin/chart-heads` export a `RawUser` type;
an aggregate `export *` would silently drop one of them, and the resulting bug looks like
a type error in unrelated code. Import the concern sub-module directly:
`@/modules/admin/iam`, `@/modules/admin/notifications`.

### 4. Check domain ownership

The module that owns a concept exports it; others import from there. A selector for
academic periods belongs in `@/modules/academic/components`, not in `shared/`. If you
find a domain concept in `shared/`, that is a finding.

### 5. Check the admin route shape

If the change touched admin: one route per concern (`/admin/iam`), domains selected by
**in-page tabs** with state in the URL (`?tab=`, and `?sub=` only where a domain has
several screens). Never `/admin/<concern>/<domain>`. Switching the top tab clears `?sub=`.

Sidebar is **max two levels**. A feature that does not fit as siblings pushes the split
into the page as tabs, not into the sidebar as a third level.

### 6. Verify

```bash
pnpm --filter ./frontend exec tsc --noEmit
pnpm --filter ./frontend lint
```

Both must be clean. Lint runs with `--max-warnings 0`, so a warning is a failure.

## Report

For Mode A: the folders created and why the others were not, the barrel contents, and the
route wiring.

For Mode B: a table of violations with file, rule, and the fix. Blockers first.

**Do not commit.**
