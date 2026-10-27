/**
 * The settings, from config.json beside package.json, every one with a
 * default so that a missing file or key still runs: the targets to ping,
 * how often and how many pings, where the data goes, the dashboard's port,
 * and how long what is kept.
 */
import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

export type TargetIcon = 'router' | 'internet' | 'server' | 'device';

export interface Target {
  /** What the dashboard calls it, and what its data is kept by. */
  name: string;
  host: string;
  icon: TargetIcon;
}

export interface Config {
  targets: Target[];
  /** Seconds between two rounds of pings. */
  stepSeconds: number;
  /** Pings per target and round, spread over most of the step. */
  pings: number;
  fping: string;
  port: number;
  /** The SQLite file. */
  database: string;
  /** Days each round is kept as it was measured, before it is folded into its hour. */
  rawDays: number;
  /** Days an hour is kept. */
  keepDays: number;
}

export const ROOT = join(import.meta.dirname, '..');

export const DEFAULTS: Config = {
  targets: [
    { name: 'Router', host: '10.0.1.1', icon: 'router' },
    { name: 'Internet', host: '8.8.4.4', icon: 'internet' },
  ],
  stepSeconds: 60,
  pings: 20,
  fping: '/usr/bin/fping',
  port: 8584,
  database: 'data/connection-monitor.db',
  rawDays: 30,
  keepDays: 730,
};

const ICONS: TargetIcon[] = ['router', 'internet', 'server', 'device'];

function whole(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

/** A guess for a target without an icon: the gateway a router, anything outside the internet. */
export function guessIcon(name: string, host: string): TargetIcon {
  const text = `${name} ${host}`.toLowerCase();
  if (/router|gateway|fritz|\.1$/.test(text)) {
    return 'router';
  }
  if (/nas|server|diskstation|synology/.test(text)) {
    return 'server';
  }
  if (!/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)|\.local$/.test(host)) {
    return 'internet';
  }
  return 'device';
}

/** Settings from raw JSON; what is missing or wrong takes its default, and is said in `problems`. */
export function parseConfig(raw: unknown): { config: Config; problems: string[] } {
  const problems: string[] = [];
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  let targets = DEFAULTS.targets;
  if (input.targets !== undefined) {
    if (!Array.isArray(input.targets)) {
      problems.push('"targets" is not a list; using the default targets');
    } else {
      const seen = new Set<string>();
      targets = [];
      for (const entry of input.targets as Record<string, unknown>[]) {
        const name = typeof entry?.name === 'string' ? entry.name.trim() : '';
        const host = typeof entry?.host === 'string' ? entry.host.trim() : '';
        if (!name || !host) {
          problems.push(`a target needs a name and a host: ${JSON.stringify(entry)}`);
          continue;
        }
        if (seen.has(name)) {
          problems.push(`target "${name}" is there twice; the second is left out`);
          continue;
        }
        seen.add(name);
        const icon = ICONS.includes(entry.icon as TargetIcon) ? (entry.icon as TargetIcon) : guessIcon(name, host);
        targets.push({ name, host, icon });
      }
    }
  }
  const config: Config = {
    targets,
    stepSeconds: whole(input.stepSeconds, 10, 3600, DEFAULTS.stepSeconds),
    pings: whole(input.pings, 1, 100, DEFAULTS.pings),
    fping: typeof input.fping === 'string' && input.fping ? input.fping : DEFAULTS.fping,
    port: whole(input.port, 1, 65535, DEFAULTS.port),
    database: typeof input.database === 'string' && input.database ? input.database : DEFAULTS.database,
    rawDays: whole(input.rawDays, 1, 3650, DEFAULTS.rawDays),
    keepDays: whole(input.keepDays, 1, 36500, DEFAULTS.keepDays),
  };
  if (!isAbsolute(config.database)) {
    config.database = join(ROOT, config.database);
  }
  return { config, problems };
}

/** config.json beside package.json, or the defaults if there is none. */
export function loadConfig(file = join(ROOT, 'config.json')): { config: Config; problems: string[] } {
  let raw: unknown = {};
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      return { ...parseConfig({}), problems: [`${file} could not be read: ${(error as Error).message}`] };
    }
  }
  return parseConfig(raw);
}
