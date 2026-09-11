# API contract — <Change title>

**Slug**: `<slug>` · **Agreed**: YYYY-MM-DD · **Backend**: <who> · **Frontend**: <who>

Optional. Write this only for a **parallel** change — two people, or the frontend starts
before the backend code exists. For sequential work (the default), skip this file and
code the frontend against `backend/openapi.json` on disk at HEAD instead.

One copy, in this change's folder. There is nothing to keep in sync across repositories —
backend and frontend are packages in the same working tree.

> **This is a design-time agreement, not a record.** Once the backend is implemented, its
> generated `backend/openapi.json` is the source of truth. If the two disagree, the spec
> wins and this file gets a dated correction below.

## Endpoints

### `<METHOD> /<path>`

**Purpose** — one line.

**Scope headers** — which of `X-School-Id`, `X-Modality-Type-Id`, `X-Academic-Period-Id`
this endpoint requires, and whether any is optional.

**Auth** — the guard and the permission required.

**Request**

```ts
// body / query / params
{
  field: string;      // constraints: max length, allowed values
}
```

**Response — 200**

```ts
{
  data: {
    id: number;
    field: string;
  };
  message: 'success.ok';
}
```

**Errors**

| Status | i18n key | When |
| ------ | -------- | ---- |
| 400 | `error.<module>.<key>` | ... |
| 403 | `error.auth.forbidden` | ... |
| 404 | `error.<module>.notFound` | ... |

**Pagination** — the shape if the endpoint is paginated, or "not paginated" and why that
is safe for the expected row count.

---

## Shared shapes

Types appearing in more than one endpoint, declared once.

```ts
type <Name> = {
  ...
};
```

## Decisions

Things the two sides agreed that are not obvious from the shapes — why a field is a string
rather than a number, why a list is not paginated, why an error is a 400 and not a 422.
These are the questions that otherwise get re-litigated in review.

- ...

## Not in this contract

Endpoints or fields deliberately left out of this change, so neither side builds against
them speculatively.

- ...

---

<!--
Corrections are dated appends, never rewrites of the above:

### Correction — <what> (YYYY-MM-DD)

The implemented spec returns `weight` as a string, not a number, because the column is
NUMERIC and precision would be lost. openapi.json is correct; the original shape above
was wrong. Frontend updated in <PR>.
-->
