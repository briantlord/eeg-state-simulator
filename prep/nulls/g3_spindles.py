"""G3's matched null -- and it carries the whole verdict, because the gate is record-only.

"Detector on pure aperiodic background at matched chi; false-positive rate near zero."

"NEAR ZERO" IS NOT DIRECTLY TESTABLE AS WRITTEN, and pretending otherwise would put an invented
number in the one place this project spends most of its effort keeping them out. Any value
chosen for "near" would be exactly that. What IS testable without inventing anything is the
PAIRED contrast: the same background, the same seed, the same everything, with and without the
graphoelements in the mix. Under the null that YASA is responding to the events rather than to
the record, removing the events must remove most of the detections.

That is also the stronger claim. A low absolute false-positive count is consistent with a
detector that fires on the background at a rate that happens to be low; the paired contrast
attributes the detections to the events.

MATCHED MEANS BIT-IDENTICAL BACKGROUND, which needed a generator change to be true. Graphoelement
synthesis still runs under `--no-graphoelements`; only the summation into the channel mix is
skipped (see `suppressGraphoelements` in compose.ts). Skipping the synthesis would also skip
every RNG draw it makes, so the aperiodic background downstream would differ from the gate's by
more than the absence of spindles -- and a null that differs from its gate by an unintended
second thing is not matched.

TWO CLAUSES, because either alone is weak:

  PAIRED     detections(suppressed) < detections(present), per seed, exact sign test against
             p = 0.5. The 0.5 comes from the pairing, as in G4 (D14).
  ABSOLUTE   the suppressed count must be a small fraction of the injected count. Without this,
             a detector firing 90 times on background and 100 times with events would pass the
             paired clause while being useless.

The absolute clause's fraction is a bookkeeping bound of the same kind as the gate's overlap
convention: it separates "a few" from "as many as were injected", and any value across a wide
range gives the same verdict. It is stated in `gate_g3_null_fp_rate` and reported with the raw
counts beside it so a reader can apply their own.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np

from ..epochio import generate
from ..runner import rmtree_robust
from ..spec import GateSpec, ScalarMetric
from .. import registry as R
from ..gates.g3_spindles import CHANNEL, EPOCHS, detect, injected_spindles
from ..gates.g4_offfreq import sign_test

SPEC = GateSpec(
    id="G3",
    title="Spindle null — the same background without spindles must not be detected as spindles",
    gate_class="V",
    runtime_tier="slow",
    failable=True,
    depends_on=("G2",),
    criterion_key="gate_g3_null_fp_rate",
    requires_tools=("yasa",),
    claim="Attributes YASA's detections to the injected events rather than to the background, "
    "by a paired contrast on a bit-identical background. Says nothing about whether the "
    "spindles look right — only that the detector is not firing on the noise.",
)

#: "A small fraction of the injected count". A bookkeeping bound; see the module docstring.
MAX_FP_FRACTION = 0.2


def run(seeds: list[int], params: dict[str, Any]) -> tuple[ScalarMetric, bool, str, dict]:
    work = Path(params["out_root"]) / "g3_null"
    rmtree_robust(work)
    fs = R.scalar_value("fs")

    with_ev: list[int] = []
    without: list[int] = []
    injected: list[int] = []
    for s in seeds:
        a = generate(work / f"on_{s}", seed=s, state="n2", epochs=EPOCHS)
        b = generate(work / f"off_{s}", seed=s, state="n2", epochs=EPOCHS,
                     no_graphoelements=True)
        sig_a, ch_a = a.concatenated()
        sig_b, ch_b = b.concatenated()
        with_ev.append(len(detect(sig_a[ch_a.index(CHANNEL)], fs)))
        without.append(len(detect(sig_b[ch_b.index(CHANNEL)], fs)))
        injected.append(len(injected_spindles(a)))

    n = len(seeds)
    k = sum(1 for lo, hi in zip(without, with_ev) if lo < hi)
    p = sign_test(k, n)
    paired_ok = p < 0.05

    frac = float(np.median(without)) / max(float(np.median(injected)), 1e-9)
    absolute_ok = frac < MAX_FP_FRACTION
    passed = paired_ok and absolute_ok

    detail = (
        f"n2 @ {CHANNEL}, {EPOCHS} epochs x {n} seeds, bit-identical background. "
        f"median detections {int(np.median(with_ev))} with events vs "
        f"{int(np.median(without))} with them suppressed, against "
        f"{int(np.median(injected))} injected. "
        f"paired {k}/{n} (p={p:.2g}, {'ok' if paired_ok else 'FAIL'}); "
        f"false positives {frac:.3f} of injected (< {MAX_FP_FRACTION} "
        f"{'ok' if absolute_ok else 'FAIL'}). "
        f"'False-positive rate near zero' is not testable as written — no value of 'near' "
        f"exists that would not be invented — so the paired contrast carries the claim and the "
        f"raw counts are printed for a reader who wants to apply their own bound."
    )

    return (
        ScalarMetric(per_seed={s: float(v) for s, v in zip(seeds, without)},
                     unit="YASA detections on background with spindles suppressed"),
        passed,
        detail,
        {"with_events": with_ev, "suppressed": without, "injected": injected,
         "paired": {"k": k, "n": n, "p": p}, "fp_fraction": frac,
         "max_fp_fraction": MAX_FP_FRACTION},
    )
