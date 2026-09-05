import json
from types import SimpleNamespace

import numpy as np
from prep.reference.t1m1_state_realism import select_epochs, preprocess, metrics, PROTOCOL_PATH
from prep.gates import g3_spindles


def test_nonadjacent_stage_epochs_are_filtered_in_their_original_context():
    fs = 256
    t = np.arange(fs * 150) / fs
    signal = (25 * np.sin(2 * np.pi * t) + np.where(t > 75, 200, 0))[None, :]
    annotations = SimpleNamespace(onset=[30, 90], duration=[30, 30], description=["Sleep stage N3"] * 2)
    selected = select_epochs(signal, annotations, fs, 120)["n3"]
    full = preprocess(signal, fs)
    np.testing.assert_array_equal(selected[0], full[:, 30 * fs:60 * fs])
    np.testing.assert_array_equal(selected[1], full[:, 90 * fs:120 * fs])
    joined = preprocess(np.concatenate([signal[:, 30 * fs:60 * fs], signal[:, 90 * fs:120 * fs]], axis=-1), fs)
    assert np.max(np.abs(joined - np.concatenate(selected, axis=-1))) > 10


def test_epoch_order_does_not_manufacture_spectral_or_temporal_texture():
    fs = 256
    rng = np.random.default_rng(907)
    epochs = rng.normal(size=(4, 2, 30 * fs))
    a = metrics(epochs, fs)
    b = metrics(epochs[::-1], fs)
    for key in a:
        np.testing.assert_allclose(a[key], b[key], rtol=1e-12)


def test_protocol_separates_existing_fitting_nights_and_reserved_evaluation():
    protocol = json.loads(PROTOCOL_PATH.read_text())
    assert set(protocol["heldout_subjects"]).isdisjoint(protocol["development_subjects"])
    assert len(set(protocol["generated_seeds"])) == 6
    assert 20260728 not in protocol["generated_seeds"]


def test_g3_scores_all_events_independently_of_arbitrary_tags(monkeypatch):
    events = [{"type": "spindle_fast", "channels": ["Cz"], "onset": 1, "duration": 1,
               "inclusionTag": 0.01}]
    run = SimpleNamespace(events={"events": events}, concatenated=lambda: (np.zeros((1, 2560)), ["Cz"]))
    monkeypatch.setattr(g3_spindles, "detect", lambda *args: [(1, 2)])
    low, _ = g3_spindles.curve(run, 256)
    events[0]["inclusionTag"] = 0.99
    high, _ = g3_spindles.curve(run, 256)
    assert low == high
    assert low[0]["f1"] == 1
