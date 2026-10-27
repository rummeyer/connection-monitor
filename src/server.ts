/**
 * The dashboard and what it asks for, read only:
 *
 *   GET /api/status                       every target: its last round, hour and day
 *   GET /api/series?target=…&range=24h    a target's chart: 1h, 3h, 12h, 24h, 7d, 30d or 1y
 *
 * Without a login, for a browser on the home network, as Appliance
 * Monitor's and Synology Monitor's dashboards are.
 */
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { Server, ServerResponse } from 'node:http';
import { join } from 'node:path';

import { ROOT } from './config.ts';
import type { Config } from './config.ts';
import { points, summarize } from './series.ts';
import type { Store } from './store.ts';

const FILES: Record<string, { type: string; path: string }> = {
  '/': { type: 'text/html; charset=utf-8', path: 'web/index.html' },
  '/dashboard.js': { type: 'text/javascript; charset=utf-8', path: 'web/dashboard.js' },
  '/theme.js': { type: 'text/javascript; charset=utf-8', path: 'web/theme.js' },
  '/icon.png': { type: 'image/png', path: 'web/icon.png' },
  '/home.svg': { type: 'image/svg+xml', path: 'web/home.svg' },
};

/** The chart's ranges, in seconds. */
export const RANGES: Record<string, number> = {
  '1h': 3600,
  '3h': 3 * 3600,
  '12h': 12 * 3600,
  '24h': 24 * 3600,
  '7d': 7 * 86400,
  '30d': 30 * 86400,
  '1y': 365 * 86400,
};

const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version as string;

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

/** A summary of a target's samples since `seconds` ago, or none if nothing was measured. */
function since(store: Store, target: string, now: number, seconds: number) {
  const samples = store.range(target, now - seconds, now).filter((s) => s.t >= now - seconds);
  if (samples.length === 0) {
    return null;
  }
  const finest = Math.min(...samples.map((s) => s.step));
  const summary = summarize(target, samples.filter((s) => s.step === finest), now - seconds, seconds);
  return { median: summary.median, loss: summary.loss, min: summary.rtts[0] ?? null, max: summary.rtts.at(-1) ?? null };
}

export function status(config: Config, store: Store, problems: string[], now = Math.floor(Date.now() / 1000)) {
  const oldest = store.oldest();
  return {
    version: VERSION,
    step: config.stepSeconds,
    pings: config.pings,
    problems,
    targets: config.targets.map((target) => {
      const last = store.latest(target.name);
      return {
        name: target.name,
        host: target.host,
        icon: target.icon,
        last: last && {
          t: last.t,
          step: last.step,
          median: last.median,
          loss: last.loss,
          min: last.rtts[0] ?? null,
          max: last.rtts.at(-1) ?? null,
        },
        hour: since(store, target.name, now, 3600),
        day: since(store, target.name, now, 86400),
        since: oldest.get(target.name) ?? null,
      };
    }),
  };
}

export function series(config: Config, store: Store, target: string, range: string, now = Math.floor(Date.now() / 1000)) {
  const seconds = RANGES[range] ?? RANGES['24h']!;
  // A point per round where that fits, else as many as a chart is wide.
  const count = Math.min(720, Math.ceil(seconds / config.stepSeconds));
  const width = seconds / count;
  const to = Math.ceil(now / width) * width;
  const from = to - seconds;
  return { target, range, from, to, points: points(store.range(target, from, to), from, to, count) };
}

export function startServer(config: Config, store: Store, problems: string[]): Server {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://dashboard');
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    try {
      if (url.pathname === '/api/status') {
        json(response, 200, status(config, store, problems));
        return;
      }
      if (url.pathname === '/api/series') {
        const target = url.searchParams.get('target') ?? '';
        if (!config.targets.some((t) => t.name === target)) {
          json(response, 404, { error: `No target "${target}"` });
          return;
        }
        json(response, 200, series(config, store, target, url.searchParams.get('range') ?? '24h'));
        return;
      }
      const file = FILES[url.pathname];
      if (!file) {
        response.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
        return;
      }
      response.writeHead(200, { 'Content-Type': file.type, 'Cache-Control': 'no-cache' });
      response.end(readFileSync(join(ROOT, file.path)));
    } catch (error) {
      json(response, 500, { error: (error as Error).message });
    }
  });
  server.listen(config.port);
  return server;
}
