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
import { composeState, type ComposeOptions, type ComposeResult } from '../core/generators/compose.ts';
import type { StateId } from '../core/types/state.ts';
import { scalarValue } from '../core/registry.ts';

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
  private next: ComposeResult | null = null;

  /** Seconds elapsed since the stream started. Monotonic; never wraps. */
  private elapsed = 0;

  constructor(private opts: StreamOptions) {
    this.current = this.generate(0);
  }

  private generate(index: number): ComposeResult {
    // Segment index enters the seed so consecutive segments are different signal rather than
    // a visible loop, while the whole stream stays a pure function of (seed, state, index).
    const n = Math.round(this.segmentS * this.fs);
    return composeState(this.opts.seed + index * 7919, this.opts.state, n, this.fs, this.opts); // @lit-ok a prime decorrelating consecutive segment seeds; any large prime serves
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

  /** Advance the playhead by `dt` seconds, rolling to the next segment when due. */
  advance(dt: number): void {
    const before = Math.floor(this.elapsed / this.segmentS);
    this.elapsed += dt;
    const after = Math.floor(this.elapsed / this.segmentS);

    // Prepare the next segment a little before it is needed, so the roll never blocks a frame.
    if (this.next === null && this.positionS > this.segmentS * 0.75) { // @lit-ok prefetch trigger: prepare the next segment at 75% through the current one
      this.next = this.generate(after + 1);
    }
    if (after !== before) {
      this.segIndex = after;
      this.current = this.next ?? this.generate(after);
      this.next = null;
      this.crossfadeIn();
    }
  }

  /**
   * Taper the first samples of a new segment against zero.
   *
   * Not a true crossfade against the previous segment — that would need both in memory and
   * buys nothing here, because a hard step at the join is the only thing worth avoiding and a
   * quarter-second ramp removes it. Stated plainly rather than called a crossfade.
   */
  private crossfadeIn(): void {
    const n = Math.round(this.crossfadeS * this.fs);
    // The aux traces are tapered TOO. They are drawn on the same screen from the same segment,
    // so leaving them out would put a step in the respiration and ECG lanes at exactly the
    // moment the EEG lanes are being smoothed -- the defect this taper exists to remove.
    const tracks = [
      ...this.current.channels,
      this.current.respirationBelt,
      this.current.ecg,
    ];
    for (const ch of tracks) {
      for (let i = 0; i < n && i < ch.length; i++) {
        ch[i] = ch[i]! * (0.5 * (1 - Math.cos((Math.PI * i) / n)));
      }
    }
  }

  /** Seek within the current segment. Used when paused. */
  seekTo(positionS: number): void {
    const base = Math.floor(this.elapsed / this.segmentS) * this.segmentS;
    this.elapsed = base + Math.max(0, Math.min(this.segmentS, positionS));
  }

  /** Rebuild from scratch, e.g. after a state or seed change. */
  reset(opts: Partial<StreamOptions> = {}): void {
    this.opts = { ...this.opts, ...opts };
    this.segIndex = 0;
    this.elapsed = 0;
    this.next = null;
    this.current = this.generate(0);
  }
}
