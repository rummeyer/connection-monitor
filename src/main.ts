/**
 * npm start — pings every target each step, keeps what came back, tidies
 * once an hour, and serves the dashboard.
 */
import { loadConfig } from './config.ts';
import { probe } from './probe.ts';
import { startServer } from './server.ts';
import { Store } from './store.ts';

const { config, problems } = loadConfig();
for (const problem of problems) {
  console.warn(`config: ${problem}`);
}
const store = new Store(config.database);
const server = startServer(config, store, problems);
console.log(`Connection Monitor: ${config.targets.map((t) => `${t.name} (${t.host})`).join(', ')}; ` +
  `${config.pings} pings every ${config.stepSeconds} s; dashboard on port ${config.port}`);

let running = false;

/** A round, unless the last one is still going: fping waits for the slowest answer. */
async function round(): Promise<void> {
  if (running) {
    return;
  }
  running = true;
  try {
    const t = Math.floor(Date.now() / 1000 / config.stepSeconds) * config.stepSeconds;
    store.add(await probe(config, t));
  } catch (error) {
    console.error(`round failed: ${(error as Error).message}`);
  } finally {
    running = false;
  }
}

function tidy(): void {
  try {
    const folded = store.tidy(Math.floor(Date.now() / 1000), config.rawDays, config.keepDays);
    if (folded) {
      console.log(`Folded ${folded} rounds older than ${config.rawDays} days into hours.`);
    }
  } catch (error) {
    console.error(`tidying failed: ${(error as Error).message}`);
  }
}

// Rounds on the step's boundaries, as Smokeping's, so that they line up with its history.
const step = config.stepSeconds * 1000;
setTimeout(() => {
  void round();
  setInterval(() => void round(), step);
}, step - (Date.now() % step));
tidy();
setInterval(tidy, 3600_000);

function stop(): void {
  server.close();
  store.close();
  process.exit(0);
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
