# Registry grammar

*Normative. `registry/parameters.yaml` is the single source of truth; `docs/PARAMETERS.md` is
generated from it. See `docs/Execution-Scheme.md` D11.*

`node tools/registry/emit.mjs` regenerates every projection.
`node tools/registry/emit.mjs --check` regenerates in memory and diffs — **the fixed-point
check**. It fails the build if the human table and the machine values have drifted apart. That
is the mechanism by which they are *incapable* of disagreeing, rather than merely expected not
to.

---

## Record

```yaml
<key>:
  value:    <value object>        # required
  units:    <string | null>       # required; null only for dimensionless/categorical
  standing: <standing>            # required
  source:   <source object>       # required
  states:   all | [<state>, ...]  # required
  section:  <string>              # required; groups rows in the generated markdown
  note:     <string>              # optional prose, reproduced in the markdown
  milestone: <T0-M4|T1-M1|T1-M2|...>   # required iff standing is invented or pending
```

`states` draws from the canonical set, declared once at the top of the file and exported as
`StateId` (seam 2): `wake_eo`, `wake_ec`, `n1`, `n2`, `n3`, `rem`.

> `chi_n1` was absent from the source markdown although `chi_direction` and `knee_present` both
> reference N1. The state set was never enumerated in one place. It is now.

## Value objects — a tagged union

The source markdown used at least five syntaxes with no stated grammar, and its ranges meant
three incompatible things. One accessor returning all three is how a plausible-looking number
reaches a filter.

| `kind` | Fields | Meaning | Accessor |
|---|---|---|---|
| `scalar` | `v` | One number | `scalarValue(k)` |
| `interval` | `lo`, `hi`, `meaning` | See below | `bandEdges(k)` / `uncertainty(k)` / `uiDomain(k)` |
| `enum` | `options` | One of a fixed set | `enumValue(k)` |
| `bound` | `op` ∈ `lt gt le ge`, `v` | A one-sided threshold | `boundValue(k)` |
| `electrodes` | `labels` | Electrode expectation (G6) | `electrodeSet(k)` |
| `ordering` | `text`, `relations` | A direction, not a magnitude | `ordering(k)` |
| `procedure` | `text` | A method, not a value | *(no numeric accessor)* |
| `solved` | `procedure`, `artifact` | Solved once by calibration; runtime value read from `artifact` | `solvedValue(k)` |
| `pending` | — | **No value.** `provisional` required | `provisionalValue(k)` only |
| `absent` | `reason` | Deliberately no value, ever, at this tier | *(no accessor)* |

### `interval.meaning` — the three incompatible readings

- `band_edges` — **both endpoints simultaneously in force**, e.g. `spindle_band` 11–16 Hz is a
  filter passband. Reducing it to a point is a bug.
- `uncertainty` — a spread the generator must reduce to a point plus `Dv`, e.g. `alpha_amp`
  20–50 µV. Reading it as band edges would build a 20–50 Hz filter.
- `ui_domain` — a control's slider range, e.g. `snr_range_ui`. Never a signal parameter.

`bandEdges()` throws on an `uncertainty` interval and vice versa. The distinction is enforced
at the accessor, not documented in a comment.

### `pending` — the anti-placeholder rule

A `pending` row carries **no value**. It requires:

```yaml
provisional:
  v: <number>                    # the number the generator actually runs on today
  basis: <string>                # where it came from, honestly
  expires_at_milestone: T1-M1
  constrained_by: <string>       # what it must not be derived from
```

The only path to that number in code is `provisionalValue(P.chi_n2)`. `P.chi_n2` is typed with
no numeric accessor, so `P.chi_n2 * 2` is a **compile error**. This is what stops a placeholder
from silently becoming the value of record — the failure the registry exists to prevent.

## Standings — six, plus `absent`

`definitional` · `chosen` · `literature` · `derived` · `fitted` · `invented`, per
`PARAMETERS.md` §Standing. Build Plan seam 6 names only four; it is the stale list, and the two
it omits (`chosen`, `derived`) are the standings of the project's most load-bearing
non-invented values — `snr_nominal`, `g4_percentile`, `gate_g4_criterion`, `gate_topography`.

`absent` is added for rows that are **deliberately unset and scheduled**, distinct from an
`invented` guess: `gate_chi_tol_knee`, `gate_chi_tol_fixed`, `gate_spindle_f1`. The source
markdown left their `Standing` cell empty, which no enum can represent.

## Source objects — discipline made mechanical

```yaml
source: {kind: standard,  name: "AASM Manual v2.6", clause: "..."}   # definitional REQUIRES
source: {kind: citation,  authors: "Lendner et al.", year: 2020, venue: "eLife"}  # literature REQUIRES
source: {kind: procedure, text: "..."}                               # derived REQUIRES
source: {kind: none, rationale: "..."}                               # chosen / invented only
```

Enforced by `emit.mjs`:

- `standing: definitional` → `kind: standard` with a non-empty `name`
- `standing: literature` → `kind: citation` with **both** `authors` and `year`, or `kind:
  standard`. A venue and year with no author fails.
- `standing: derived` → `kind: procedure`
- `standing: chosen | invented` → any, including `none`

**A row failing this is re-standed, not re-sourced by guess** — the source document's own rule.
Eleven rows failed on import and were re-standed; each carries a `note` recording it.

## Gate rows

Rows under `section: "12. Gate criteria"` additionally carry:

```yaml
gate:
  id: G4
  arm: positive | null
  failable: true | false      # false => record-only; the runner prints RECORD, never PASS
```

`runner.py` refuses to start if a `failable: true` gate's criterion row has standing
`invented` — §1's circularity rule, mechanically.
