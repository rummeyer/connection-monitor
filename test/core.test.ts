import assert from 'node:assert/strict';
import test from 'node:test';

import { guessIcon, parseConfig } from '../src/config.ts';
import { parseFping, pingPeriodMs } from '../src/probe.ts';
import type { Sample } from '../src/probe.ts';
import { points, quantile, summarize, thin } from '../src/series.ts';
import { parseTargets, rowsToSamples } from '../src/smokeping.ts';
import { Store } from '../src/store.ts';

const targets = [
  { name: 'Router', host: '10.0.1.1', icon: 'router' as const },
  { name: 'Diskstation', host: '10.0.1.201', icon: 'server' as const },
];

test('fping counts: times sorted, a dash lost, a host missing from the output all lost', () => {
  const out = '10.0.1.1   : 1.33 0.771 - 0.599\n10.0.1.9 : 3 3 3 3\n';
  const [router, nas] = parseFping(out, targets, 600, 60, 4);
  assert.deepEqual(router!.rtts, [0.599, 0.771, 1.33]);
  assert.equal(router!.loss, 0.25);
  assert.equal(router!.median, 0.771);
  assert.deepEqual([nas!.loss, nas!.median, nas!.rtts], [1, null, []]);
});

test('pings spread over nine tenths of the step', () => {
  assert.equal(pingPeriodMs(60, 20), 2700);
  assert.equal(pingPeriodMs(300, 10), 27000);
});

test('quantiles between neighbours, and a summary thinned to its quantiles', () => {
  assert.equal(quantile([1, 2, 3, 4], 0.5), 2.5);
  assert.equal(quantile([], 0.5), null);
  const many = Array.from({ length: 101 }, (_, i) => i);
  assert.deepEqual(thin(many, 5), [0, 25, 50, 75, 100]);
  const s = summarize('R', [
    { target: 'R', t: 0, step: 60, sent: 10, loss: 0.1, median: 1, rtts: [1, 1, 1] },
    { target: 'R', t: 60, step: 60, sent: 10, loss: 0.3, median: 3, rtts: [3, 3, 3] },
  ], 0, 3600);
  assert.equal(s.loss, 0.2);
  assert.equal(s.sent, 20);
  assert.equal(s.median, 2);
});

test('a chart point is made of the finest samples there are, a gap where there are none', () => {
  const sample = (t: number, step: number, rtt: number): Sample => ({ target: 'R', t, step, sent: 2, loss: 0, median: rtt, rtts: [rtt, rtt] });
  // An hour from Smokeping over the whole stretch, and five minutes in its first half.
  const samples = [sample(0, 3600, 9), sample(0, 300, 1), sample(300, 300, 1), sample(600, 300, 1)];
  const chart = points(samples, 0, 3600 * 12, 24);
  assert.deepEqual(chart.slice(0, 4).map((p) => [p.median, p.step]), [[1, 300], [9, 3600], [null, null], [null, null]]);
  assert.equal(chart[0]!.smoke.length, 11);
  // Over two hours an hour is too long to say anything: a gap, not the hour.
  const short = points(samples, 0, 3600 * 2, 4);
  assert.deepEqual(short.map((p) => [p.median, p.step]), [[1, 300], [null, null], [null, null], [null, null]]);
});

test('Smokeping targets, with groups, and its archive rows as samples', () => {
  const targets = parseTargets(`*** Targets ***
probe = FPing
+ Router
menu = Router
title = My Router
host = 10.0.1.1
+ Remote
++ Google
host = 8.8.4.4 # the DNS
`);
  assert.deepEqual(targets, [
    { name: 'Router', host: '10.0.1.1', path: 'Router', title: 'My Router' },
    { name: 'Google', host: '8.8.4.4', path: 'Remote/Google' },
  ]);
  const csv = 'step,300\nt,uptime,loss,median,ping1,ping2,ping3,ping4\n600,1,1,0.002,0.001,0.002,0.003,\n900,,,,,,,\n1200,1,4,,,,,\n';
  const samples = rowsToSamples('Router', csv);
  assert.deepEqual(samples.map((s) => [s.t, s.step, s.loss, s.median, s.rtts]), [
    [300, 300, 0.25, 2, [1, 2, 3]],
    [900, 300, 1, null, []],
  ]);
});

test('rounds older than rawDays fold into their hour, replacing one from Smokeping', () => {
  const store = new Store(':memory:');
  const now = 100 * 86400;
  const old = 60 * 86400;
  store.add([
    { target: 'R', t: old, step: 3600, sent: 10, loss: 0, median: 50, rtts: [50] },
    { target: 'R', t: old, step: 60, sent: 10, loss: 0, median: 1, rtts: [1, 1] },
    { target: 'R', t: old + 60, step: 60, sent: 10, loss: 0.5, median: 3, rtts: [3] },
    { target: 'R', t: now - 60, step: 60, sent: 10, loss: 0, median: 2, rtts: [2] },
  ]);
  assert.equal(store.tidy(now, 30, 730), 2);
  const kept = store.range('R', 0, now);
  assert.deepEqual(kept.map((s) => [s.t, s.step, s.loss, s.median]), [[old, 3600, 0.25, 1], [now - 60, 60, 0, 2]]);
  store.close();
});

test('settings: defaults for what is missing, an icon guessed', () => {
  const { config, problems } = parseConfig({ targets: [{ name: 'NAS', host: '10.0.1.201' }, { host: 'x' }], pings: 0 });
  assert.equal(config.targets[0]!.icon, 'server');
  assert.equal(config.pings, 20);
  assert.equal(problems.length, 1);
  assert.equal(guessIcon('Internet', '8.8.4.4'), 'internet');
  assert.equal(guessIcon('Router', '10.0.1.1'), 'router');
});
