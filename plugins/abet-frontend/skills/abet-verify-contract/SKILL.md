---
name: abet-verify-contract
description: Confirm the backend has actually shipped the API this change depends on, and that what shipped matches contract.md. Fetches the backend's published spec remotely — never from a local checkout. Use before merging any frontend change that calls a new or altered endpoint.
---

# Verify the backend contract

Answers two questions the frontend cannot answer for itself:

1. **Did the backend actually ship it?** — merged, and deployed to staging.
2. **Does what shipped match what we agreed?** — `contract.md`, or the types in this repo.

Everything here is **remote**. This skill never reads another repository from disk. A
teammate's checkout may sit on any branch, with uncommitted work, describing endpoints
that exist nowhere — so the local filesystem is not evidence of anything. It also means
this runs identically on any machine and in CI.

## Configuration

Two values, declared once in this repo's `docs/CONTEXT.md` under external integrations
(or as environment variables). Never a filesystem path.

| Value | Example | Env override |
| ----- | ------- | ------------ |
| Backend repository | `UPC-ABET/BACK-ACREDITACION-3.0` | `ABET_BACKEND_REPO` |
| Staging API base URL | `https://<staging-host>` | `ABET_STAGING_API_URL` |

If either is missing, say so and stop rather than guessing.

## Steps

### 1. Is it merged?

The backend commits `openapi.json`, generated from its Swagger decorators. Fetch it at an
explicit ref:

```bash
gh api "repos/$ABET_BACKEND_REPO/contents/openapi.json?ref=develop" \
  -H "Accept: application/vnd.github.raw" > /tmp/spec-develop.json
```

> **The ref is not optional.** This repository's GitHub default branch is `production`,
> so a request without `?ref=` silently returns the *production* spec — older than what
> you are building against, and wrong in a way that looks fine.

A **404 means it is not merged yet.** That is a clean, unambiguous answer: report it and
stop. Do not fall back to reading someone's working copy.

Record the blob SHA — it is what makes this check reproducible and reviewable:

```bash
gh api "repos/$ABET_BACKEND_REPO/contents/openapi.json?ref=develop" --jq '.sha'
```

### 2. Is it deployed?

Merged is not deployed, and the ordering rule is about **deployed**. The backend exposes
Swagger whenever `NODE_ENV` is not `production`, so staging serves the live document:

```bash
curl -fsS "$ABET_STAGING_API_URL/docs-json" > /tmp/spec-staging.json
```

Compare the endpoints you care about across the two files. They can legitimately differ:
`develop` is ahead of `staging` until a promotion runs. What matters is that the endpoints
**this change calls** are present in the *staging* document — that is the gate for merging
the frontend PR.

If staging is unreachable, say so plainly and report the merged-but-unverified state. Do
not assume it is deployed.

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

Backend repo:  UPC-ABET/BACK-ACREDITACION-3.0
Spec (develop): openapi.json @ 4b9c2f1
Spec (staging): reachable, 538 paths

| Endpoint                        | Merged | Staging | Matches contract |
| ------------------------------- | ------ | ------- | ---------------- |
| POST /rubrics/{id}/weights/bulk | ✅     | ✅      | ⚠️ see below     |

### Drift

| Field | contract.md | shipped spec | Action |
| ----- | ----------- | ------------ | ------ |
| `weight` | `number` | `string` | Spec wins — update the frontend type |
```

Verdict, one of:

- **✅ SHIPPED AND MATCHING** — safe to merge the frontend PR.
- **⚠️ SHIPPED WITH DRIFT** — the endpoints exist but shapes differ. **The spec wins.**
  Update the frontend types, and add a *dated correction* to `contract.md` in this repo
  (and tell the backend dev to mirror it in theirs). Never rewrite the original agreement.
- **⛔ NOT DEPLOYED** — merged but not on staging. The frontend PR must not merge yet.
- **⛔ NOT MERGED** — the backend has not landed. Keep developing against `contract.md`.

### 5. When drift is too large to absorb

If the shipped shape breaks the screen rather than requiring a type edit, this is not a
frontend fix. Report it, and take it back through `/abet-design-feature` — with a dated
scope extension on `proposal.md`. Quietly reshaping the UI to fit an unexpected API is how
a change stops matching its own acceptance criteria.

## Record what you verified

Put the spec SHA in the PR body:

```
Contract: openapi.json @ 4b9c2f1 (develop), verified on staging 2026-07-30
```

One line, and it makes "which contract version is this coded against?" answerable in
review — which reading a file off a disk never can.
