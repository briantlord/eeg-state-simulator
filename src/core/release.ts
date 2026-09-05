import calibration from '../../prep/fixtures/snr_calibration.json' with { type: 'json' };
import { GENERATOR_VERSION } from './registry.ts';
import { RELEASE_MECHANISMS, RELEASE_PROFILE_ID } from './profile.ts';
import type { ComposeOptions } from './generators/compose.ts';

export { RELEASE_PROFILE_ID };
export const RELEASE_CALIBRATION = Object.freeze(calibration);

export function releasedOptions(overrides: ComposeOptions = {}): ComposeOptions {
  if (!Number.isFinite(calibration.value_db) || calibration.generator_version !== GENERATOR_VERSION) {
    throw new Error('Missing, invalid, or stale release calibration; run npm run calibrate');
  }
  return { ...RELEASE_MECHANISMS, snrDb: calibration.value_db, ...overrides };
}
