"""Round-trip tests for the seam-9 boundary the harness measures (DECISIONS D7).

These exercise the whole D7 contract: the TypeScript exporter runs, writes an epoch
directory, and the Python harness reads it back. That is the interface Tier 2 later swaps
the Python package behind, so a break here is a break in the upgrade path.
"""
from __future__ import annotations

import numpy as np
import pytest

from . import registry as R
from .epochio import EpochIOError, generate, load_run

SEED = 4242


@pytest.fixture(scope="module")
def run(tmp_path_factory):
    return generate(tmp_path_factory.mktemp("run_a"), seed=SEED, state="n2", epochs=3)


def test_manifest_round_trips(run):
    assert run.seed == SEED
    assert run.generator_version == R.GENERATOR_VERSION
    assert run.n_epochs == 3
    assert len(run.registry_digest) == 16


def test_epoch_shape_matches_registry(run):
    ep = run.epoch(0)
    n_ch = int(R.scalar_value("n_channels"))
    n_samp = int(R.scalar_value("fs") * R.scalar_value("epoch_display"))
    assert ep.signal.shape == (n_ch, n_samp)
    assert ep.signal.dtype == np.float64
    assert ep.fs == R.scalar_value("fs")


def test_signal_is_lossless_float64(run, tmp_path):
    """CSV would round-trip float64 only at 17 significant digits.

    G2's bit-identity check run through a lossy serializer tests the serializer, not the
    generator — the same argument harness section 8 uses to reject EDF.
    """
    ep = run.epoch(0)
    raw = np.fromfile(run.path / "epoch_00000" / "signal.f64", dtype="<f8")
    assert np.array_equal(raw.reshape(ep.signal.shape), ep.signal)


def test_epochs_are_contiguous(run):
    sig, channels = run.concatenated()
    n_samp = int(R.scalar_value("fs") * R.scalar_value("epoch_display"))
    assert sig.shape == (len(channels), n_samp * 3)


def test_epochs_slice_one_continuous_stream(tmp_path):
    """Regression: epochs must be slices of a single run, not independent realisations.

    Per-epoch substreams gave the stitched record a hard discontinuity every
    `epoch_display` seconds, depositing a comb at k/30 Hz. `g4_f1` = 0.10 Hz is harmonic
    k = 3 EXACTLY while `g4_f2` = 0.25 Hz is k = 7.5 and lands on nothing -- so a pure export
    artefact produced energy at f1 and not at f2, which is the exact pattern G4 declares a
    pass.

    The check: a 1-epoch run and a 10-epoch run at the same seed must agree bit-for-bit over
    the first epoch. They can only do that if the stream is continuous and the epoch index
    merely slices it.
    """
    short = generate(tmp_path / "short", seed=31337, state="n3", epochs=1)
    long_ = generate(tmp_path / "long", seed=31337, state="n3", epochs=10)
    np.testing.assert_array_equal(
        short.epoch(0).signal,
        long_.epoch(0).signal,
        err_msg="epoch 0 differs between a 1-epoch and a 10-epoch run: "
        "epochs are independent realisations, not slices of one stream",
    )


def test_g4_f1_would_land_on_the_epoch_boundary_comb(tmp_path):
    """Guards the reason the test above matters, so it is not deleted as redundant.

    If this ever stops holding, the continuity requirement is less load-bearing -- but while
    it holds, any per-epoch discontinuity feeds G4's positive arm directly.
    """
    f1 = R.scalar_value("g4_f1")
    f2 = R.scalar_value("g4_f2")
    epoch = R.scalar_value("epoch_display")
    assert (f1 * epoch) % 1 == 0, "g4_f1 is no longer an exact harmonic of 1/epoch_display"
    assert (f2 * epoch) % 1 != 0, "g4_f2 has become a harmonic; the asymmetry is gone"


def test_sidecar_carries_injected_ground_truth(run):
    """Without this the harness would have to reimplement generator internals."""
    truth = run.epoch(0).truth
    for field in (
        "chi", "knee", "snrDb", "chiModDepth", "chiModPhi0",
        "respFreq", "independentChiModFreq", "projectionWeights", "respMechanisms",
    ):
        assert field in truth, f"sidecar is missing ground-truth field {field!r}"
    # G4 needs chi modulation decoupled from respiration; the field must exist even when unused.
    assert truth["independentChiModFreq"] is None


def test_aasm_reference_channels_are_present(run):
    """A 19-channel 10-20 montage has no mastoids, but gate_aasm_n3 is referenced to
    contralateral mastoid and anchors every absolute uV amplitude in the registry."""
    assert run.manifest["referenceChannels"] == R.electrode_set("reference_channels")


def test_state_is_recorded_per_epoch(run):
    assert all(ep.state == "n2" for ep in run.epochs())


# --------------------------------------------------------------- G2 in embryo

def test_same_seed_is_bit_identical(tmp_path):
    a = generate(tmp_path / "a", seed=777, state="n3", epochs=2)
    b = generate(tmp_path / "b", seed=777, state="n3", epochs=2)
    assert a.digest() == b.digest()


def test_different_seeds_differ(tmp_path):
    """The matched null. Trivial, and it catches a seed not actually threaded through."""
    a = generate(tmp_path / "a", seed=777, state="n3", epochs=2)
    c = generate(tmp_path / "c", seed=778, state="n3", epochs=2)
    assert a.digest() != c.digest()


def test_state_changes_output(tmp_path):
    a = generate(tmp_path / "a", seed=555, state="n3", epochs=1)
    b = generate(tmp_path / "b", seed=555, state="rem", epochs=1)
    assert a.epoch(0).truth["chi"] != b.epoch(0).truth["chi"]


# ------------------------------------------------------------------ integrity

def test_missing_epoch_raises(run):
    with pytest.raises(EpochIOError, match="missing epoch directory"):
        run.epoch(99)


def test_missing_manifest_raises(tmp_path):
    with pytest.raises(EpochIOError, match="no manifest.json"):
        load_run(tmp_path)


def test_unknown_channel_raises(run):
    with pytest.raises(EpochIOError, match="no channel"):
        run.epoch(0).channel("NOT_A_CHANNEL")
