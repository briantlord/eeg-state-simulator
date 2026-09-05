/**
 * ISF-4 external-evidence and identifiability audit.
 *
 * This is deliberately an eligibility audit, not a fit. A full-band scalp recording can anchor
 * the observed electrode spectrum, but it cannot by itself assign that voltage to the cortical
 * current path rather than BBB/vascular, respiratory, skin/electrode or reference contributions.
 * The generator parameter is cortical source RMS, so total scalp RMS is the wrong estimand.
 *
 * Reproduce:
 *   node --experimental-strip-types --no-warnings prep/reference/isf4_external_evidence.mts
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { scalarValue } from '../../src/core/registry.ts';

export type StateCoverage = 'wake' | 'nrem' | 'rem';

export interface EvidenceRecord {
  readonly id: string;
  readonly source: string;
  readonly states: readonly StateCoverage[];
  readonly publicRaw: boolean;
  readonly lowerPassbandHz: number | null;
  readonly longestContinuousS: number;
  readonly reportsAbsoluteFullBandAmplitude: boolean;
  readonly cleanFullBandScalpPotential: boolean;
  readonly separatesCorticalFromNonCorticalPotential: boolean;
  readonly use: string;
}

export const EVIDENCE: readonly EvidenceRecord[] = [
  {
    id: 'vayrynen-2023',
    source: 'Väyrynen et al. 2023, Clinical Neurophysiology 156:207-219',
    states: ['wake', 'nrem'],
    publicRaw: false,
    lowerPassbandHz: 0,
    longestContinuousS: 600,
    reportsAbsoluteFullBandAmplitude: false,
    cleanFullBandScalpPotential: true,
    separatesCorticalFromNonCorticalPotential: false,
    use: 'Primary band, aggregate NREM>wake direction and estimator-specific PAC comparators.',
  },
  {
    id: 'openneuro-ds005385',
    source: 'OpenNeuro ds005385, Dortmund Vital resting EEG',
    states: ['wake'],
    publicRaw: true,
    lowerPassbandHz: 0,
    longestContinuousS: 180,
    reportsAbsoluteFullBandAmplitude: true,
    cleanFullBandScalpPotential: true,
    separatesCorticalFromNonCorticalPotential: false,
    use: 'Large DC-amplifier wake corpus; too short for ten cycles at 0.008 Hz.',
  },
  {
    id: 'openneuro-ds007987',
    source: 'OpenNeuro ds007987, alternating eyes-open/closed resting EEG',
    states: ['wake'],
    publicRaw: true,
    lowerPassbandHz: null,
    longestContinuousS: 300,
    reportsAbsoluteFullBandAmplitude: true,
    cleanFullBandScalpPotential: true,
    separatesCorticalFromNonCorticalPotential: false,
    use: 'Raw 128-channel wake corpus; exact acquisition high-pass is not stated and runs are short.',
  },
  {
    id: 'openneuro-ds003768',
    source: 'OpenNeuro ds003768, simultaneous EEG-fMRI rest and sleep',
    states: ['wake', 'nrem'],
    publicRaw: true,
    lowerPassbandHz: 0,
    longestContinuousS: 900,
    reportsAbsoluteFullBandAmplitude: true,
    cleanFullBandScalpPotential: false,
    separatesCorticalFromNonCorticalPotential: false,
    use: 'Scored W/N1/N2/N3 and 0-250 Hz acquisition, but raw records contain MR gradient and BCG artifacts.',
  },
] as const;

export interface EvidenceVerdict extends EvidenceRecord {
  readonly lowerEdgeCycles: number;
  readonly eligibleObservedScalpFit: boolean;
  readonly eligibleCorticalRmsFit: boolean;
}

export function auditEvidence(
  evidence: readonly EvidenceRecord[] = EVIDENCE,
): readonly EvidenceVerdict[] {
  const requiredS = scalarValue('isf_probe_record_length');
  const lowerEdgeHz = 10 / requiredS;
  return evidence.map((item) => {
    const passbandKnownAndOpen = item.lowerPassbandHz !== null
      && item.lowerPassbandHz <= lowerEdgeHz;
    const eligibleObservedScalpFit = item.publicRaw
      && passbandKnownAndOpen
      && item.longestContinuousS >= requiredS
      && item.reportsAbsoluteFullBandAmplitude
      && item.cleanFullBandScalpPotential;
    return {
      ...item,
      lowerEdgeCycles: item.longestContinuousS * lowerEdgeHz,
      eligibleObservedScalpFit,
      eligibleCorticalRmsFit:
        eligibleObservedScalpFit && item.separatesCorticalFromNonCorticalPotential,
    };
  });
}

export function report(): object {
  const records = auditEvidence();
  return {
    probe: 'ISF-4 external amplitude calibration eligibility',
    status: records.some((record) => record.eligibleCorticalRmsFit)
      ? 'FIT_ELIGIBLE'
      : 'HOLD_NOT_IDENTIFIABLE',
    estimand: 'projected cortical-source RMS, not total full-band scalp RMS',
    requiredContinuousS: scalarValue('isf_probe_record_length'),
    records,
    decision: records.some((record) => record.eligibleCorticalRmsFit)
      ? 'A held-out cortical RMS fit may proceed.'
      : 'Keep cortical RMS, source sharing/delay and modulation depths absent. Published relative scalp and PAC measurements remain comparators only.',
  };
}

const invoked = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invoked) console.log(JSON.stringify(report(), null, 2));
