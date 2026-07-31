# Verify the backend contract

Answers two questions the frontend cannot answer for itself:

1. **How far has the backend got?** — merged to `develop`, promoted to `staging`, released
   to `production`.
2. **Does what shipped match what we agreed?** — `contract.md`, or the types in this repo.

Everything here is **remote**. This skill never reads another repository from disk. A
teammate's checkout may sit on any branch, with uncommitted work, describing endpoints
that exist nowhere — so the local filesystem is not evidence of anything. It also means
this runs identically on any machine and in CI.

## Configuration

One value, declared once in this repo's `docs/CONTEXT.md` under external integrations, or
as an environment variable. Never a filesystem path.

| Value | Example | Env override |
| ----- | ------- | ------------ |
| Backend repository | `UPC-ABET/BACK-ACREDITACION-3.0` | `ABET_BACKEND_REPO` |

If it is missing, say so and stop rather than guessing.

There is no environment to call. The entire check is `gh api` against branches, so it
needs no running backend, no staging host, and no credentials beyond `gh`.

## Steps

### 1. Fetch the spec at each branch in the promotion chain

The backend commits `openapi.json`, generated from its Swagger decorators. Promotion runs
`develop → staging → production`, fast-forward only, so a branch tells you exactly how far
the change has travelled:

```bash
for ref in develop staging production; do
  gh api "repos/$ABET_BACKEND_REPO/contents/openapi.json?ref=$ref" \
    -H "Accept: application/vnd.github.raw" > "/tmp/spec-$ref.json" 2>/dev/null \
    && echo "$ref: present" || echo "$ref: not there yet"
done
```

> **The ref is not optional.** This repository's GitHub default branch is `production`,
> so a request without `?ref=` silently returns the *production* spec — older than what
> you are building against, and wrong in a way that looks fine.

A **404 is a clean answer**: the change has not reached that branch. Report it and stop.
Do not fall back to reading someone's working copy.

Record the blob SHA of the ref you verified against — that is what makes this check
reproducible and reviewable:

```bash
gh api "repos/$ABET_BACKEND_REPO/contents/openapi.json?ref=staging" --jq '.sha'
```

### 2. Read what each branch means

| Branch | Means |
| ------ | ----- |
| `develop` | Merged. The backend dev is done, nothing is released. |
| `staging` | **Promoted — this is the gate for merging the frontend PR.** |
| `production` | Released. Currently the only branch that is actually deployed. |

The endpoints this change calls must be present in the **`staging`** spec before the
frontend PR merges. That guarantees the backend leads the frontend through the promotion
chain, so frontend code can never reach production ahead of the API it calls.

Note what this check is *not*: `staging` is a branch, not a running environment. Being
present there proves the code is promoted and queued for release — it does not prove
anything responds. Runtime verification happens against a locally-run backend, or against
production once released.

### 3. Does it match what we agreed?

**Parallel mode** — `openspec/changes/<slug>/contract.md` exists. For every endpoint in it,
check against the fetched spec:

- Path and method present
- Request shape: field names, types, required vs optional
- Response shape, including the envelope (`data`, `message`)
- Error statuses and their i18n keys
- Scope headers declared (`X-School-Id`, `X-Modality-Type-Id`, `X-Academic-Period-Id`)
- Pagination shape, if contracted

**Sequential mode** — no `contract.md`. Then verify this repo's hand-written types in the
relevant `types/index.ts` against the spec instead. Same checks, different reference.

### 4. Report

```
## Contract verification — <slug>

Backend repo: UPC-ABET/BACK-ACREDITACION-3.0
Verified against: openapi.json @ 4b9c2f1 (staging)

| Endpoint                        | develop | staging | production | Matches contract |
| ------------------------------- | ------- | ------- | ---------- | ---------------- |
| POST /rubrics/{id}/weights/bulk | ✅      | ✅      | —          | ⚠️ see below     |

### Drift

| Field | contract.md | shipped spec | Action |
| ----- | ----------- | ------------ | ------ |
| `weight` | `number` | `string` | Spec wins — update the frontend type |
```

Verdict, one of:

- **✅ PROMOTED AND MATCHING** — on `staging`, shapes agree. Safe to merge the frontend PR.
- **⚠️ PROMOTED WITH DRIFT** — the endpoints are on `staging` but shapes differ. **The spec
  wins.** Update the frontend types, and add a *dated correction* to `contract.md` in this
  repo (and tell the backend dev to mirror it in theirs). Never rewrite the agreement.
- **⛔ MERGED, NOT PROMOTED** — on `develop` only. The frontend PR must not merge yet; ask
  for the backend to be promoted to `staging`.
- **⛔ NOT MERGED** — the backend has not landed at all. Keep developing against
  `contract.md`.

### 5. When drift is too large to absorb

If the shipped shape breaks the screen rather than requiring a type edit, this is not a
frontend fix. Report it, and take it back through `/abet-design-feature` — with a dated
scope extension on `proposal.md`. Quietly reshaping the UI to fit an unexpected API is how
a change stops matching its own acceptance criteria.

## Record what you verified

Put the spec SHA in the PR body:

```
Contract: openapi.json @ 4b9c2f1 (staging), verified 2026-07-30
```

One line, and it makes "which contract version is this coded against?" answerable in
review — which reading a file off a disk never can.
