"""Exercise both actual scoring implementations with the same samples, not mirrored assertions."""
import json
import subprocess
from pathlib import Path

import numpy as np
import pytest

from prep.gates.g5_aasm_n3 import aasm_filtered, aasm_fraction, SCORER_VERSION

ROOT = Path(__file__).resolve().parents[1]


def test_typescript_scipy_scoring_parity():
    p = subprocess.run(["node", "--experimental-strip-types", "--no-warnings",
                        "prep/reference/scoring_contract.mts"], cwd=ROOT, capture_output=True,
                       text=True, check=True)
    result = json.loads(p.stdout)
    assert result["version"] == SCORER_VERSION
    for case in result["cases"]:
        x = np.array(case["raw"])
        y = aasm_filtered(x, result["fs"])
        np.testing.assert_allclose(y, case["filtered"], atol=1e-7, rtol=1e-9, err_msg=case["name"])
        assert aasm_fraction(np.stack([x, np.zeros_like(x)]), ["C3", "A2"], result["fs"]) == case["fraction"]


@pytest.mark.parametrize("flag,value", [("epochs", "0"), ("epochs", "1.5"), ("snr-db", "NaN"),
                                       ("resp-rate", "Infinity"), ("movement-artifact", "maybe"),
                                       ("resp-rate", "-1"), ("line-freq", "61"),
                                       ("respiration-mode", "unknown"), ("misspelled", "true")])
def test_invalid_export_arguments_leave_no_partial_run(tmp_path, flag, value):
    out = tmp_path / "invalid"
    p = subprocess.run(["node", "--experimental-strip-types", "--no-warnings", "bin/eegsim-export.mts",
                        "--out", str(out), f"--{flag}", value], cwd=ROOT, capture_output=True, text=True)
    assert p.returncode != 0
    assert not out.exists()
