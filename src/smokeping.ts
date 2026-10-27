/**
 * Smokeping's history, taken over: its targets from its Targets file, and
 * from each target's RRD every archive at its own step — five minutes for
 * the last days, hours for half a year, twelve hours for a year. Read
 * through Perl's RRDs module, which Smokeping itself uses, so that rrdtool
 * need not be installed.
 *
 * Smokeping keeps a round's pings sorted, in seconds, as ping1 … pingN, the
 * median beside them and the loss as a number of pings; an archive averages
 * each of them over its step.
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { median } from './probe.ts';
import type { Sample } from './probe.ts';

export interface SmokepingTarget {
  /** The section's name, as the RRD file is called: Router for Router.rrd. */
  name: string;
  host: string;
  title?: string;
  /** The RRD's path below Smokeping's data directory, for one in a group. */
  path: string;
}

/**
 * The targets with a host, from a Targets file:
 *
 *   + Router
 *   host = 10.0.1.1
 *   ++ Inner        (in a group: Router/Inner.rrd)
 */
export function parseTargets(text: string): SmokepingTarget[] {
  const targets: SmokepingTarget[] = [];
  const path: string[] = [];
  let current: SmokepingTarget | undefined;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*/, '').trim();
    const section = /^(\++)\s*(\S+)/.exec(line);
    if (section) {
      const depth = section[1]!.length;
      path.length = depth - 1;
      path.push(section[2]!);
      current = { name: section[2]!, host: '', path: path.join('/') };
      targets.push(current);
      continue;
    }
    const setting = /^(\w+)\s*=\s*(.*)$/.exec(line);
    if (setting && current) {
      if (setting[1] === 'host') {
        current.host = setting[2]!.trim();
      } else if (setting[1] === 'title') {
        current.title = setting[2]!.trim();
      }
    }
  }
  return targets.filter((target) => target.host);
}

/** An archive's rows as samples: `t` each the start of its row. */
export function rowsToSamples(target: string, csv: string): Sample[] {
  const lines = csv.trim().split('\n');
  const step = Number(lines[0]!.split(',')[1]);
  const names = lines[1]!.split(',');
  const pingColumns = names.map((name, i) => (/^ping\d+$/.test(name) ? i : -1)).filter((i) => i >= 0);
  const lossColumn = names.indexOf('loss');
  const pings = pingColumns.length;
  const samples: Sample[] = [];
  for (const line of lines.slice(2)) {
    const fields = line.split(',');
    const loss = fields[lossColumn] === '' ? NaN : Number(fields[lossColumn]);
    if (!Number.isFinite(loss)) {
      // Nothing measured then: Smokeping not running, or before it started.
      continue;
    }
    const rtts = pingColumns
      .map((i) => fields[i])
      .filter((value) => value !== '' && value !== undefined)
      .map((value) => Number(value) * 1000)
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    samples.push({
      target,
      t: Number(fields[0]) - step,
      step,
      sent: pings,
      loss: Math.min(1, Math.max(0, loss / pings)),
      median: median(rtts),
      rtts,
    });
  }
  return samples;
}

const FETCH = `
use strict; use RRDs;
my ($file, $res, $start, $end) = @ARGV;
my ($s, $step, $names, $data) = RRDs::fetch($file, 'AVERAGE', '-r', $res, '-s', $start, '-e', $end);
my $err = RRDs::error; die "$err\\n" if $err;
print "step,$step\\n";
print join(',', 't', @$names), "\\n";
my $t = $s;
for my $row (@$data) { $t += $step; print join(',', $t, map { defined $_ ? $_ : '' } @$row), "\\n"; }
`;

const LAST = `use RRDs; print RRDs::last($ARGV[0]);`;

/** The three archives Smokeping keeps by default: step in seconds, and how many rows. */
export const ARCHIVES = [
  { step: 300, rows: 1008 },
  { step: 3600, rows: 4320 },
  { step: 43200, rows: 720 },
];

/** Every archive of one target's RRD, as samples. */
export function readRrd(dataDir: string, target: SmokepingTarget, name = target.name): Sample[] {
  const file = join(dataDir, `${target.path}.rrd`);
  const last = Number(execFileSync('perl', ['-e', LAST, file], { encoding: 'utf8' }));
  const samples: Sample[] = [];
  for (const archive of ARCHIVES) {
    const end = Math.floor(last / archive.step) * archive.step;
    const start = end - archive.step * archive.rows;
    const csv = execFileSync('perl', ['-e', FETCH, file, String(archive.step), String(start), String(end)], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    samples.push(...rowsToSamples(name, csv));
  }
  return samples;
}
