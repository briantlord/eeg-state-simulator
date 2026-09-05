"""ISF-2 — characterize unit-variance infra-slow BEM source families.

This probe reads the generated projection artifact, never the lead-field cache. It assigns every
spatial mode an independent unit-variance driver and reports the resulting channel covariance.
There is deliberately no microvolt scale, temporal fit, state gain, shared source, or delay.

Reproduce:
    .venv311/Scripts/python.exe prep/reference/isf2_source_families.py
"""
from __future__ import annotations

import json
from itertools import combinations
from pathlib import Path

import numpy as np


ROOT = Path(__file__).resolve().parents[2]
PROJECTION = ROOT / 'data' / 'projection_10_20.json'
MONTAGE = ROOT / 'data' / 'montage_10_20.json'
REGISTRY = ROOT / 'gen' / 'registry.json'
OUT = ROOT / 'prep' / 'out' / 'isf2_source_families.json'

FAMILY_BY_REGISTRY_NAME = {
    'frontomedial_association': 'isf_frontomedial',
    'sensorimotor': 'isf_sensorimotor',
    'posterior_visual': 'isf_posterior',
}


def modes_of(projection: dict, family: str) -> np.ndarray:
    """Return mode x channel weights in the producer's declared mode order."""
    entries = projection['generators']
    first = entries[family]
    count = int(first['provenance']['of_modes'])
    keys = [family] + [f'{family}_m{k}' for k in range(1, count)]
    return np.asarray([entries[key]['weights'] for key in keys], dtype=np.float64)


def covariance(modes: np.ndarray) -> np.ndarray:
    """Channel covariance for independent, zero-mean, unit-variance temporal mode drivers."""
    return modes.T @ modes


def reference_operators(projection: dict) -> dict[str, np.ndarray]:
    channels = projection['channels']
    scalp = projection['scalp']
    refs = projection['reference']
    n_all = len(channels)
    n_scalp = len(scalp)
    index = {name: i for i, name in enumerate(channels)}

    raw = np.zeros((n_scalp, n_all))
    linked = np.zeros_like(raw)
    average = np.zeros_like(raw)
    for row, name in enumerate(scalp):
        raw[row, index[name]] = 1.0
        linked[row, index[name]] = 1.0
        average[row, index[name]] = 1.0
        for ref in refs:
            linked[row, index[ref]] -= 1.0 / len(refs)
        for other in scalp:
            average[row, index[other]] -= 1.0 / n_scalp
    return {'unreferenced': raw, 'linked_mastoid': linked, 'average': average}


def spatial_metrics(cov: np.ndarray, positions: np.ndarray) -> dict:
    eig = np.clip(np.linalg.eigvalsh(cov), 0.0, None)
    total = float(eig.sum())
    effective_rank = total * total / float(eig @ eig) if total > 0 else 0.0
    pc1 = float(eig[-1] / total) if total > 0 else 0.0

    sd = np.sqrt(np.clip(np.diag(cov), 0.0, None))
    denom = np.outer(sd, sd)
    corr = np.divide(cov, denom, out=np.zeros_like(cov), where=denom > 0)
    tri = np.triu_indices_from(corr, k=1)
    pair_corr = np.abs(corr[tri])

    delta = positions[:, None, :] - positions[None, :, :]
    distance = np.sqrt((delta * delta).sum(axis=-1))[tri]
    near_edge, far_edge = np.quantile(distance, [0.25, 0.75])
    near = pair_corr[distance <= near_edge]
    far = pair_corr[distance >= far_edge]

    return {
        'effectiveRank': effective_rank,
        'pc1VarianceFraction': pc1,
        'medianAbsCorrelation': float(np.median(pair_corr)),
        'nearDistanceQuartileMedianAbsCorrelation': float(np.median(near)),
        'farDistanceQuartileMedianAbsCorrelation': float(np.median(far)),
        'distanceQuartileEdges': [float(near_edge), float(far_edge)],
    }


def main() -> None:
    projection = json.loads(PROJECTION.read_text(encoding='utf8'))
    montage = json.loads(MONTAGE.read_text(encoding='utf8'))
    registry = json.loads(REGISTRY.read_text(encoding='utf8'))

    selected = registry['params']['isf_source_families']['value']['options']
    families = [FAMILY_BY_REGISTRY_NAME[name] for name in selected]
    positions_by_name = {
        item['label']: [item['x'], item['y']]
        for item in montage['channels'] + montage['reference']
    }
    scalp_positions = np.asarray(
        [positions_by_name[name] for name in projection['scalp']], dtype=np.float64
    )
    operators = reference_operators(projection)

    failures: list[str] = []
    family_modes: dict[str, np.ndarray] = {}
    family_covariances: dict[str, np.ndarray] = {}
    summaries: dict[str, dict] = {}

    for family in families:
        entries = projection['generators']
        if family not in entries:
            failures.append(f'missing projection family {family}')
            continue
        modes = modes_of(projection, family)
        family_modes[family] = modes
        family_covariances[family] = covariance(modes)

        count = modes.shape[0]
        mode_ids = [family] + [f'{family}_m{k}' for k in range(1, count)]
        provenance = [entries[key]['provenance'] for key in mode_ids]
        if any(item.get('method') != 'leadfield_patch_eigenmode' for item in provenance):
            failures.append(f'{family} contains a non-BEM mode')
        if any(not item.get('regions') for item in provenance):
            failures.append(f'{family} contains a mode without named atlas regions')
        if any('phase' in item or 'delay' in item for item in provenance):
            failures.append(f'{family} stores phase or delay in channel projection metadata')

        by_reference = {}
        for ref_name, operator in operators.items():
            referenced = operator @ family_covariances[family] @ operator.T
            metrics = spatial_metrics(referenced, scalp_positions)
            loading = np.sqrt(np.clip(np.diag(referenced), 0.0, None))
            metrics['peakChannel'] = projection['scalp'][int(np.argmax(loading))]
            metrics['peakUnitVarianceRms'] = float(loading.max())
            by_reference[ref_name] = metrics

        summaries[family] = {
            'regions': provenance[0]['regions'],
            'nSources': provenance[0]['n_sources'],
            'nModes': count,
            'byReference': by_reference,
        }

    subset_summaries: dict[str, dict] = {}
    for size in range(1, len(families) + 1):
        for subset in combinations(families, size):
            cov = sum((family_covariances[name] for name in subset), np.zeros_like(next(iter(family_covariances.values()))))
            linked = operators['linked_mastoid'] @ cov @ operators['linked_mastoid'].T
            subset_summaries['+'.join(subset)] = spatial_metrics(linked, scalp_positions)

    joint_cov = sum(family_covariances.values(), np.zeros_like(next(iter(family_covariances.values()))))
    reference_residuals = {}
    stacked = np.vstack([family_modes[name] for name in families])
    for ref_name, operator in operators.items():
        from_covariance = operator @ joint_cov @ operator.T
        projected_modes = stacked @ operator.T
        from_modes = projected_modes.T @ projected_modes
        reference_residuals[ref_name] = float(np.max(np.abs(from_covariance - from_modes)))

    result = {
        'probe': 'ISF-2 unit-variance BEM source-family characterization',
        'status': 'PASS' if not failures else 'FAIL',
        'claimBoundary': {
            'physiologicalAmplitudeSelected': False,
            'sharedSourceFractionSelected': False,
            'sourceDelaySelected': False,
            'stateGainSelected': False,
            'temporalDrivers': 'independent unit-variance characterization fixtures only',
        },
        'selectedFamilies': families,
        'omittedConditionalFamily': 'lateral association',
        'selectionBasis': (
            'Three anatomically fixed systems supply anterior, central and posterior BEM modes. '
            'A fourth family has no independent external requirement; covariance summaries are '
            'predictions and were not fitted as separate targets.'
        ),
        'families': summaries,
        'linkedMastoidSubsets': subset_summaries,
        'referenceLinearityMaxAbsResidual': reference_residuals,
        'failures': failures,
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(result, indent=2) + '\n', encoding='utf8')

    print('family             modes  raw peak  LM peak   LM rank   LM PC1  LM |corr|')
    for family in families:
        summary = summaries[family]
        raw = summary['byReference']['unreferenced']
        linked = summary['byReference']['linked_mastoid']
        print(
            f"{family:<19} {summary['nModes']:>5}  {raw['peakChannel']:>8}  "
            f"{linked['peakChannel']:>7}  {linked['effectiveRank']:>8.3f}  "
            f"{linked['pc1VarianceFraction']:>7.3f}  "
            f"{linked['medianAbsCorrelation']:>9.3f}"
        )
    print('\nlinked-mastoid equal-variance subsets')
    for name, metric in subset_summaries.items():
        print(
            f"{name:<58} rank {metric['effectiveRank']:.3f}  "
            f"PC1 {metric['pc1VarianceFraction']:.3f}  |corr| {metric['medianAbsCorrelation']:.3f}"
        )
    print(f'\nstatus: {result["status"]}')
    print(f'wrote {OUT}')
    if failures:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
