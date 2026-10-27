/**
 * npm run import — Smokeping's history into the store, run on the machine
 * Smokeping runs on:
 *
 *   npm run import -- [--targets /etc/smokeping/config.d/Targets] [--data /var/lib/smokeping]
 *
 * Each of its targets is taken over under the same name. Without a
 * config.json, one is written with those targets, so that the measuring
 * goes on where Smokeping left off. Run again, it replaces what it took
 * before; what was measured here since is left as it is.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { DEFAULTS, ROOT, guessIcon, loadConfig } from './config.ts';
import { parseTargets, readRrd } from './smokeping.ts';
import { Store } from './store.ts';

const { values } = parseArgs({
  options: {
    targets: { type: 'string', default: '/etc/smokeping/config.d/Targets' },
    data: { type: 'string', default: '/var/lib/smokeping' },
  },
});

const targets = parseTargets(readFileSync(values.targets!, 'utf8'));
if (targets.length === 0) {
  console.error(`No targets with a host in ${values.targets}.`);
  process.exit(1);
}

const configFile = join(ROOT, 'config.json');
if (!existsSync(configFile)) {
  const config = {
    targets: targets.map((target) => ({ name: target.name, host: target.host, icon: guessIcon(target.name, target.host) })),
    stepSeconds: DEFAULTS.stepSeconds,
    pings: DEFAULTS.pings,
    port: DEFAULTS.port,
  };
  writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`);
  console.log(`Wrote ${configFile} with ${targets.length} targets from Smokeping.`);
}

const { config, problems } = loadConfig(configFile);
for (const problem of problems) {
  console.warn(problem);
}
const store = new Store(config.database);
for (const target of targets) {
  const samples = readRrd(values.data!, target);
  store.add(samples);
  const steps = [...new Set(samples.map((sample) => sample.step))].map((step) => `${samples.filter((s) => s.step === step).length} × ${step / 60} min`);
  const from = samples.length ? new Date(Math.min(...samples.map((s) => s.t)) * 1000).toISOString().slice(0, 10) : '–';
  console.log(`${target.name} (${target.host}): ${steps.join(', ')}, since ${from}`);
  if (!config.targets.some((t) => t.name === target.name)) {
    console.log(`  — not in config.json, so kept but not measured or shown; add it there to see it.`);
  }
}
store.close();
