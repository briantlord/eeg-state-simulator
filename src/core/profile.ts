/** Shared mechanism defaults. Low-level composeState remains an explicit fixture API. */
import type { ComposeOptions } from './generators/compose.ts';
import { enumValue } from './registry.ts';

export const RELEASE_PROFILE_ID = 'physiology-v1';
export const RELEASE_MECHANISMS = Object.freeze({
  respirationMode: 'natural',
  movementArtifact: true,
  amplitudeModulation: true,
  chiModulation: true,
  eventRespirationCoupling: true,
  infraSlowCortical: true,
  infraSlowModulation: true,
  lineNoise: false,
  lineFreqHz: Number(enumValue('line_freq').at(-1)),
  suppressGraphoelements: false,
} satisfies ComposeOptions);

/** Historical isolated carrier fixture; validation must request this profile explicitly. */
export const ISOLATED_MECHANISMS = Object.freeze({
  ...RELEASE_MECHANISMS,
  movementArtifact: false,
  amplitudeModulation: false,
  chiModulation: false,
});
