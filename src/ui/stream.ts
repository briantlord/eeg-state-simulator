/**
 * The live streaming buffer.
 *
 * "Real-time generation is not in question. Do not architect around synthesis cost; THE
 * STREAMING BUFFER EXISTS FOR CONTINUITY, not throughput." Synthesis runs ~7,000x real time,
 * so the buffer is here so the display has scroll-back and a stable window to analyse — not
 * because generating is slow.
 *
 * Segments are generated ahead of the playhead and consumed in order. Each segment is one
 * `composeState` call, so within a segment the signal is exactly what the exporter would
 * write. ACROSS a segment boundary there is a discontinuity, and that is a deliberate,
 * bounded compromise:
 *
 *   The harness never reads this buffer. It reads exported epoch directories, which are
 *   generated as one continuous run precisely because a block-rate artefact there landed on
 *   g4_f2 (Finding 8). The display's boundary occurs once per `display_buffer_s` and is
 *   crossfaded; nothing scientific is measured across it.
 *
 * If that ever stops being true — if a gate or a published number is ever computed from the
 * live view — this buffer must be replaced by continuous synthesis, not patched.
 */
import {
  composeState,
  releasedInfraSlowDriverIds,
  releasedInfraSlowTemporalConfig,
  type ComposeOptions,
  type ComposeResult,
} from '../core/generators/compose.ts';
import {
  createInfraSlowController,
  synthesizeInfraSlowChunk,
  type InfraSlowControllerState,
} from '../core/generators/infraslow.ts';
import {
  createRespiratoryState,
  respiratoryRateForState,
  synthesizeRespirationChunk,
  type RespiratoryState,
} from '../core/generators/respiration.ts';
import {
  createCardiacState,
  synthesizeEcgChunk,
  type CardiacState,
} from '../core/generators/cardiac.ts';
import type { StateId } from '../core/types/state.ts';
import { scalarValue } from '../core/registry.ts';
import { releasedOptions } from '../core/release.ts';

export interface StreamOptions extends ComposeOptions {
  readonly seed: number;
  readonly state: StateId;
}

export class SignalStream {
  private readonly fs = scalarValue('fs');
  private readonly segmentS = scalarValue('display_buffer_s');
  private readonly crossfadeS = 0.25; // @lit-ok display crossfade duration (s); continuity only, nothing scientific measured across it (see file header)

  private segIndex = 0;
  private current: ComposeResult;
  private respirationState: RespiratoryState;
  private cardiacState: CardiacState;
  private infraSlowState: InfraSlowControllerState | null;
  private next: ComposeResult | null = null;
  /**
   * The segment before `current`, kept so the display window can span a segment join.
   *
   * WITHOUT IT THE TRACE FREEZES FOR A FULL WINDOW AT EVERY BOUNDARY. `positionS` wraps to ~0 at
   * a roll, and app.ts clamped the window start at zero, so for `windowS` seconds afterwards the
   * window stopped moving and the picture stood still -- reported as "the scroll stops after
   * about 90 s", which is exactly `display_buffer_s`. Holding one segment of history lets the
   * window keep sliding across the join instead of being pinned to the start of the new segment.
   */
  private prev: ComposeResult | null = null;

  /** Seconds elapsed since the stream started. Monotonic; never wraps. */
  private elapsed = 0;

  private opts: StreamOptions;

  constructor(opts: StreamOptions) {
    this.opts = { ...releasedOptions(opts), seed: opts.seed, state: opts.state };
    this.respirationState = this.makeRespiratoryState();
    this.cardiacState = this.makeCardiacState();
    this.infraSlowState = this.makeInfraSlowState();
    this.current = this.generate(0);
  }

  private makeRespiratoryState(): RespiratoryState {
    return createRespiratoryState(
      this.opts.seed,
      this.opts.state,
      this.fs,
      this.opts.respRatePerMin ?? (
        this.opts.respirationMode === 'regular'
          ? respiratoryRateForState(this.opts.state)
          : undefined
      ),
    );
  }

  private makeCardiacState(): CardiacState {
    return createCardiacState(this.opts.seed, this.opts.state, this.fs);
  }

  private makeInfraSlowState(): InfraSlowControllerState | null {
    if (this.opts.infraSlow === false || this.opts.infraSlowFixture !== undefined ||
        (this.opts.infraSlowCortical === false && this.opts.infraSlowModulation === false)) {
      return null;
    }
    return createInfraSlowController(
      this.opts.seed,
      releasedInfraSlowDriverIds(),
      releasedInfraSlowTemporalConfig(),
      this.fs,
    );
  }

  private generate(index: number): ComposeResult {
    // Segment index enters the seed so consecutive segments are different signal rather than
    // a visible loop, while the whole stream stays a pure function of (seed, state, index).
    const n = Math.round(this.segmentS * this.fs);
    const respiratory = synthesizeRespirationChunk(this.respirationState, n);
    this.respirationState = respiratory.state;
    const cardiac = synthesizeEcgChunk(this.cardiacState, respiratory.result);
    this.cardiacState = cardiac.state;
    const infraSlow = this.infraSlowState
      ? synthesizeInfraSlowChunk(this.infraSlowState, n)
      : null;
    if (infraSlow) this.infraSlowState = infraSlow.state;
    return composeState(
      this.opts.seed + index * 7919, // @lit-ok a prime decorrelating consecutive segment seeds; any large prime serves
      this.opts.state,
      n,
      this.fs,
      {
        ...this.opts,
        respirationOverride: respiratory.result,
        cardiacOverride: cardiac.result,
        ...(infraSlow ? { infraSlowOverride: infraSlow.drivers } : {}),
      },
    );
  }

  get channels(): readonly Float64Array[] {
    return this.current.channels;
  }

  get events() {
    return this.current.events;
  }

  get truth() {
    return this.current.truth;
  }

  /**
   * The respiratory phase that drove this segment, sample-aligned to `channels`.
   *
   * Exposed because Demo 1 measures coupling AGAINST THE KNOWN PHASE rather than one recovered
   * from the signal — recovering it would let estimator error into the reference and confound
   * the loss being demonstrated. This is ground truth, and it is only available because we
   * generated it.
   */
  get respirationPhase(): Float64Array {
    return this.current.respirationPhase;
  }

  /** Respiration belt and surface ECG, for the auxiliary display lanes. */
  get respirationBelt(): Float64Array {
    return this.current.respirationBelt;
  }

  get ecg(): Float64Array {
    return this.current.ecg;
  }

  get rPeaks(): readonly number[] {
    return this.current.rPeaks;
  }

  get segmentSeconds(): number {
    return this.segmentS;
  }

  /** Playhead position within the current segment, in seconds. */
  get positionS(): number {
    return this.elapsed % this.segmentS;
  }

  get elapsedS(): number {
    return this.elapsed;
  }

  /** Index of the segment on screen. Used as a cache key by the display. */
  get segmentIndex(): number {
    return this.segIndex;
  }

  /** The previous segment, or null before the first roll. */
  get previous(): ComposeResult | null {
    return this.prev;
  }

  /** Advance the playhead by `dt` seconds, rolling to the next segment when due. */
  advance(dt: number): void {
    if (!Number.isFinite(dt) || dt < 0) throw new Error('Stream advance must be finite and non-negative');
    this.elapsed += dt;
    const after = Math.floor(this.elapsed / this.segmentS);
    // Consume every segment in order, including after a long suspended frame. Stateful
    // physiology must advance through skipped records; a prefetched segment belongs to index+1.
    while (this.segIndex < after) {
      this.segIndex++;
      this.prev = this.current;
      this.current = this.next ?? this.generate(this.segIndex);
      this.next = null;
      this.crossfadeIn();
    }
    if (this.next === null && this.positionS > this.segmentS * 0.75) { // @lit-ok display prefetch trigger
      this.next = this.generate(this.segIndex + 1);
    }
  }

  /**
   * Decay the boundary offset to join the last displayed EEG sample. This is a presentation
   * correction, not continuous synthesis; scientific long records use fullband.ts/export.
   * The old zero taper manufactured a hard step from the previous sample to zero.
   */
  private crossfadeIn(): void {
    const n = Math.round(this.crossfadeS * this.fs);
    // Respiration and ECG are deliberately absent: their controllers are continuous across
    // chunks, and a taper to zero would manufacture the joins R1/R2 removed.
    const tracks = this.current.channels;
    for (let c = 0; c < tracks.length; c++) {
      const ch = tracks[c]!;
      const previous = this.prev!.channels[c]!;
      const offset = previous[previous.length - 1]! - ch[0]!;
      for (let i = 0; i < n && i < ch.length; i++) {
        ch[i] = ch[i]! + offset * 0.5 * (1 + Math.cos((Math.PI * i) / n));
      }
    }
  }

  /** Seek within the current segment. Used when paused. */
  seekTo(positionS: number): void {
    if (!Number.isFinite(positionS)) throw new Error('Stream seek must be finite');
    this.elapsed = this.segIndex * this.segmentS +
      Math.max(0, Math.min(this.segmentS - 1 / this.fs, positionS));
  }

  /** Rebuild from scratch, e.g. after a state or seed change. */
  reset(opts: Partial<StreamOptions> = {}): void {
    this.opts = { ...this.opts, ...opts };
    this.segIndex = 0;
    this.elapsed = 0;
    this.next = null;
    // History goes too. Keeping it would splice signal from before the reset into the left of the
    // first window -- the old seed's trace bleeding into the new one's.
    this.prev = null;
    this.respirationState = this.makeRespiratoryState();
    this.cardiacState = this.makeCardiacState();
    this.infraSlowState = this.makeInfraSlowState();
    this.current = this.generate(0);
  }
}
