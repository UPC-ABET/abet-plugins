---
name: abet-verify-contract
description: "Confirm the frontend's API calls match backend/openapi.json at HEAD, and that what's committed matches contract.md when one exists. A local, same-tree check — no network fetch, no other repository. Use before merging any frontend change that calls a new or altered endpoint. Cost: light."
---

# Verify the backend contract

Answers one question: **does what the frontend calls match what the backend actually
ships?** — checked against `backend/openapi.json` on disk, because backend and frontend
are packages in the same repository and the same working tree.

This is a **local, same-tree** check. There is no `gh api` call, no remote repository, and
no environment to reach — the spec is a committed file at a known path, read at whatever
ref you are on.

## Steps

### 1. Enumerate the endpoints the frontend calls

Search `frontend/src` for API client call sites:

```bash
rg -n "api(Get|Post|Put|Patch|Delete|PostBlob)\(" frontend/src
```

For each call, extract the method and the path argument. Normalise path params to the
spec's placeholder form — a call built as `` `/rubrics/${id}/weights` `` matches the spec's
`/rubrics/{id}/weights`.

If the change is scoped to one module, you can narrow the search to that module's
`services/` folder, but do the full sweep at least once per PR.

### 2. Check each call exists in the spec at HEAD

Read `backend/openapi.json` at the current HEAD and confirm, for every normalised
call site:

- The path and method exist.
- Request fields the frontend sends match the spec's request shape (names, types,
  required vs optional).
- The response shape the frontend's type expects matches the spec's response, including
  the envelope (`data`, `message`).
- Scope headers the endpoint requires (`X-School-Id`, `X-Modality-Type-Id`,
  `X-Academic-Period-Id`) are actually sent.

A call with no matching operation in the spec is a **finding**, not a warning — either the
frontend is calling something that does not exist yet, or the spec is stale.

### 3. On a PR branch, diff the spec against the merge-base

```bash
git diff $(git merge-base origin/develop HEAD) HEAD -- backend/openapi.json
```

Read the diff as a contract change: list added operations, removed operations, and
renamed or retyped fields. A removed or renamed operation that a frontend call site still
targets is a **blocker** — it will compile and fail at runtime.

### 4. Does it match contract.md, if one exists?

**Parallel mode** — `openspec/changes/<slug>/contract.md` exists. For every endpoint in it,
check against `backend/openapi.json` at HEAD:

- Path and method present
- Request shape: field names, types, required vs optional
- Response shape, including the envelope (`data`, `message`)
- Error statuses and their i18n keys
- Scope headers declared
- Pagination shape, if contracted

**Sequential mode** — no `contract.md`. Then step 2 above (frontend call sites vs. spec) is
the whole check.

### 5. Report

```
## Contract verification — <slug>

Spec: backend/openapi.json @ 4b9c2f1 (git log -1 --format=%h -- backend/openapi.json)

| Endpoint                        | In spec | Frontend call matches |
| -------------------------------- | ------- | ---------------------- |
| POST /rubrics/{id}/weights/bulk  | ✅      | ⚠️ see below           |

### Drift

| Field    | contract.md / frontend type | spec | Action |
| -------- | ---------------------------- | ---- | ------ |
| `weight` | `number`                     | `string` | Spec wins — update the frontend type |
```

Verdict, one of:

- **✅ MATCHING** — every call site resolves in the spec, shapes agree. Safe to merge.
- **⚠️ DRIFT** — the endpoints exist but shapes differ. **The spec wins.** Update the
  frontend types, and add a *dated correction* to `contract.md` if one exists. Never
  rewrite the agreement.
- **⛔ MISSING** — a frontend call has no matching operation in `backend/openapi.json` at
  HEAD. Either the backend side of this change is not committed yet, or the frontend is
  calling the wrong path/method.

### 6. When drift is too large to absorb

If the shipped shape breaks the screen rather than requiring a type edit, this is not a
one-line frontend fix. Report it, and take it back through `/abet-design-feature` — with a
dated scope extension on `proposal.md`. Quietly reshaping the UI to fit an unexpected API
is how a change stops matching its own acceptance criteria.

## Record what you verified

Put the spec SHA in the PR body:

```
Contract: backend/openapi.json @ 4b9c2f1, verified 2026-09-10
```

One line, and it makes "which version of the spec was this built against?" answerable in
review.
