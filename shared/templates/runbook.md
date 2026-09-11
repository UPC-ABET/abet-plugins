# Runbook — <Change title>

**Slug**: `<slug>`

The manual validation plan and any one-time operational procedure this change needs. It
is committed and reviewed with the code, and archived with the change: a change's runbook
is part of its record, not local scratch.

<!-- Delete this file if the change needs no manual steps, no migration, and no
     deploy-time action. Do not leave it as an empty template. -->

## ⚠️ Deploy prerequisite

Anything that must be run **by hand**, before or after deploy. Lead with it — this is the
line someone will miss at 6pm on a Friday. Write "None" if there is none.

```bash
# exact commands, in order
pnpm --filter ./backend migration:run
pnpm --filter ./backend seed:auth-roles-permissions
```

## Manual validation

Steps a human performs to confirm the change works, with the expected result for each.
Cover the acceptance criteria that no automated test covers.

| # | Step | Expected |
| - | ---- | -------- |
| 1 | Log in as <role>, set scope to <school/modality/period> | ... |
| 2 | ... | ... |

## Data validation

Queries or checks confirming the data is in the state it should be, especially after a
migration or backfill.

```sql
-- expected: 0 rows
SELECT ...
```

## Symptom → diagnosis

What to look at when it goes wrong in an environment.

| Symptom | Likely cause | Check |
| ------- | ------------ | ----- |
|         |              |       |

## How to revert

The exact steps. If reverting the code is not sufficient — because a migration ran, or
data was rewritten — say so explicitly and give the data-level procedure.

```bash
pnpm --filter ./backend migration:revert
```

## Do NOT

Things that look like reasonable recovery actions but will make it worse.

- ...
