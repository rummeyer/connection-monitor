/**
 * One round of pings to every target, as Smokeping's FPing probe sends them:
 * fping in count mode, so many pings per target spread over most of the
 * step, each answer's round-trip time or a dash for none.
 *
 *   10.0.1.1   : 1.33 0.771 0.599
 *   10.0.1.201 : - - -
 */
import { execFile } from 'node:child_process';

import type { Config, Target } from './config.ts';

/** One target's round: what was sent, and the times of what came back. */
export interface Sample {
  target: string;
  /** Unix seconds: the start of the round. */
  t: number;
  /** Seconds the sample stands for: the step, or longer for a summary. */
  step: number;
  sent: number;
  /** The share of pings without an answer, 0 to 1. */
  loss: number;
  /** The median round-trip time in ms; none when nothing came back. */
  median: number | null;
  /** The round-trip times in ms, fastest first. */
  rtts: number[];
}

export function median(sorted: number[]): number | null {
  if (sorted.length === 0) {
    return null;
  }
  const middle = sorted.length / 2;
  return sorted.length % 2 ? sorted[Math.floor(middle)]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/** fping's summary, a line per host, as samples for the targets asked about. */
export function parseFping(output: string, targets: Target[], t: number, step: number, pings: number): Sample[] {
  const byHost = new Map<string, string[]>();
  for (const line of output.split('\n')) {
    const match = /^(\S+)\s*:\s*(.*)$/.exec(line.trim());
    if (match) {
      byHost.set(match[1]!, match[2]!.trim().split(/\s+/));
    }
  }
  return targets.map((target) => {
    const fields = byHost.get(target.host) ?? [];
    const rtts = fields.map(Number).filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
    const sent = Math.max(fields.length, pings);
    return { target: target.name, t, step, sent, loss: (sent - rtts.length) / sent, median: median(rtts), rtts };
  });
}

/** The time between two pings to the same host, so that a round takes nine tenths of the step. */
export function pingPeriodMs(stepSeconds: number, pings: number): number {
  return Math.max(20, Math.floor((stepSeconds * 1000 * 0.9) / pings));
}

/** Pings every target once, as one fping. A host fping cannot resolve comes back as all lost. */
export function probe(config: Config, t: number): Promise<Sample[]> {
  const period = pingPeriodMs(config.stepSeconds, config.pings);
  const args = ['-C', String(config.pings), '-q', '-p', String(period), '-t', String(Math.min(period, 2000)),
    ...config.targets.map((target) => target.host)];
  return new Promise((resolve) => {
    execFile(config.fping, args, { timeout: config.stepSeconds * 1000 }, (error, _stdout, stderr) => {
      // fping exits with 1 when a host did not answer every ping, and 2 for one it could not
      // resolve: the summary is still there, so only a missing one is an error.
      const samples = parseFping(String(stderr), config.targets, t, config.stepSeconds, config.pings);
      if (error && !/ : /.test(String(stderr))) {
        console.error(`fping failed: ${error.message.split('\n')[0]}`);
      }
      resolve(samples);
    });
  });
}
