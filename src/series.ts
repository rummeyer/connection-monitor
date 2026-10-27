/**
 * What the chart draws, and what an hour keeps of its rounds. A round's
 * pings, or many rounds' together, are told by their quantiles: the median
 * as the line, the spread around it as the smoke — the fastest and slowest
 * tenth faintest, the middle fifth darkest — as Smokeping draws it.
 */
import { median } from './probe.ts';
import type { Sample } from './probe.ts';

/** How many times a summary keeps of its pings: enough for the smoke's tenths. */
export const KEPT_TIMES = 21;

/** The quantile q (0 to 1) of times sorted fastest first, between neighbours. */
export function quantile(sorted: number[], q: number): number | null {
  if (sorted.length === 0) {
    return null;
  }
  const at = q * (sorted.length - 1);
  const below = Math.floor(at);
  const above = Math.min(below + 1, sorted.length - 1);
  return sorted[below]! + (sorted[above]! - sorted[below]!) * (at - below);
}

/** At most `count` times standing for all of them: their quantiles, evenly spread. */
export function thin(sorted: number[], count = KEPT_TIMES): number[] {
  if (sorted.length <= count) {
    return sorted;
  }
  return Array.from({ length: count }, (_, i) => quantile(sorted, i / (count - 1))!);
}

/** Several samples as one, starting at `t` and standing for `step` seconds. */
export function summarize(target: string, samples: Sample[], t: number, step: number): Sample {
  const sent = samples.reduce((sum, sample) => sum + sample.sent, 0);
  const lost = samples.reduce((sum, sample) => sum + sample.loss * sample.sent, 0);
  const all = samples.flatMap((sample) => sample.rtts).sort((a, b) => a - b);
  return { target, t, step, sent, loss: sent ? lost / sent : 1, median: median(all), rtts: thin(all) };
}

/** One point of the chart. */
export interface Point {
  /** Unix seconds: the start of what it stands for. */
  t: number;
  /** None for a stretch nothing was measured in. */
  median: number | null;
  loss: number | null;
  /** The times at the quantiles 0, .1, … 1: the smoke. Empty when nothing came back. */
  smoke: number[];
  /** The step of the samples it was made of: 60 s measured here, 300 s or more from Smokeping. */
  step: number | null;
}

export const SMOKE_QUANTILES = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];

/**
 * The samples between `from` and `to` (unix seconds) as `count` points. Where
 * samples of several steps cover the same stretch — Smokeping's five minutes
 * beside its hours, or an hour that rounds were folded into — a point is made
 * of the finest there is.
 */
export function points(samples: Sample[], from: number, to: number, count: number): Point[] {
  const width = (to - from) / count;
  const buckets: Sample[][] = Array.from({ length: count }, () => []);
  for (const sample of samples) {
    // A sample longer than a point goes into every point it covers.
    const first = Math.max(0, Math.floor((sample.t - from) / width));
    const last = Math.min(count - 1, Math.floor((sample.t + sample.step - 1 - from) / width));
    for (let i = first; i <= last; i++) {
      buckets[i]!.push(sample);
    }
  }
  return buckets.map((bucket, i) => {
    const t = Math.round(from + i * width);
    if (bucket.length === 0) {
      return { t, median: null, loss: null, smoke: [], step: null };
    }
    const finest = Math.min(...bucket.map((sample) => sample.step));
    const summary = summarize('', bucket.filter((sample) => sample.step === finest), t, finest);
    const smoke = summary.rtts.length ? SMOKE_QUANTILES.map((q) => quantile(summary.rtts, q)!) : [];
    return { t, median: summary.median, loss: summary.loss, smoke, step: finest };
  });
}
