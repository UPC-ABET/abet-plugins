# API contract — <Change title>

**Slug**: `<slug>` · **Agreed**: YYYY-MM-DD · **Backend**: <who> · **Frontend**: <who>

Created only for a **parallel** change — one where the frontend cannot wait for the
backend to land. For sequential work, delete this file and use the backend's committed
`openapi.json` instead.

This file is copied **identically** into both repositories. Neither side deviates from it
without updating both copies and saying so here.

> **This is a design-time agreement, not a record.** Once the backend is implemented, its
> generated `openapi.json` is the source of truth. If the two disagree, the spec wins and
> this file gets a dated correction below.

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
