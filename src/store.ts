/**
 * The samples, in SQLite (built into Node): every round as measured for
 * `rawDays`, then folded into its hour, the hours kept for `keepDays`.
 * Smokeping's history goes in beside them with its own steps — five
 * minutes, an hour, twelve hours — and the chart takes the finest there is.
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { Sample } from './probe.ts';
import { summarize } from './series.ts';

const HOUR = 3600;

export class Store {
  readonly #db: DatabaseSync;

  constructor(file: string) {
    if (file !== ':memory:') {
      mkdirSync(dirname(file), { recursive: true });
    }
    this.#db = new DatabaseSync(file);
    this.#db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS samples (
        target TEXT NOT NULL,
        t INTEGER NOT NULL,
        step INTEGER NOT NULL,
        sent INTEGER NOT NULL,
        loss REAL NOT NULL,
        median REAL,
        rtts TEXT NOT NULL,
        PRIMARY KEY (target, step, t)
      ) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS samples_by_time ON samples (target, t);
    `);
  }

  close(): void {
    this.#db.close();
  }

  /** Samples in, replacing one of the same target, step and start. */
  add(samples: Sample[]): void {
    const insert = this.#db.prepare(
      'INSERT OR REPLACE INTO samples (target, t, step, sent, loss, median, rtts) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    this.#db.exec('BEGIN');
    try {
      for (const s of samples) {
        insert.run(s.target, s.t, s.step, s.sent, s.loss, s.median, JSON.stringify(s.rtts.map((v) => Math.round(v * 1000) / 1000)));
      }
      this.#db.exec('COMMIT');
    } catch (error) {
      this.#db.exec('ROLLBACK');
      throw error;
    }
  }

  /** A target's samples that reach into `from` to `to` (unix seconds), oldest first. */
  range(target: string, from: number, to: number): Sample[] {
    const rows = this.#db
      .prepare('SELECT target, t, step, sent, loss, median, rtts FROM samples WHERE target = ? AND t < ? AND t + step > ? ORDER BY t')
      .all(target, to, from) as unknown as (Omit<Sample, 'rtts'> & { rtts: string })[];
    return rows.map((row) => ({ ...row, rtts: JSON.parse(row.rtts) as number[] }));
  }

  /** The newest round of a target: measured here, or Smokeping's last before the first one here. */
  latest(target: string): Sample | undefined {
    const row = this.#db
      .prepare('SELECT target, t, step, sent, loss, median, rtts FROM samples WHERE target = ? AND step < 3600 ORDER BY t DESC, step LIMIT 1')
      .get(target) as unknown as (Omit<Sample, 'rtts'> & { rtts: string }) | undefined;
    return row && { ...row, rtts: JSON.parse(row.rtts) as number[] };
  }

  /** The oldest time anything is kept for, per target. */
  oldest(): Map<string, number> {
    const rows = this.#db.prepare('SELECT target, MIN(t) AS t FROM samples GROUP BY target').all() as { target: string; t: number }[];
    return new Map(rows.map((row) => [row.target, row.t]));
  }

  /**
   * Rounds older than `rawDays` folded into their hours — replacing an hour
   * Smokeping had, which they say more about — and hours older than
   * `keepDays` gone. Returns how many rounds were folded.
   */
  tidy(now: number, rawDays: number, keepDays: number): number {
    const before = Math.floor((now - rawDays * 86400) / HOUR) * HOUR;
    const old = this.#db
      .prepare('SELECT target, t, step, sent, loss, median, rtts FROM samples WHERE step < ? AND t < ? ORDER BY target, t')
      .all(HOUR, before) as unknown as (Omit<Sample, 'rtts'> & { rtts: string })[];
    const hours = new Map<string, Sample[]>();
    for (const row of old) {
      const key = `${row.target}\u0000${Math.floor(row.t / HOUR) * HOUR}`;
      const list = hours.get(key) ?? [];
      list.push({ ...row, rtts: JSON.parse(row.rtts) as number[] });
      hours.set(key, list);
    }
    const folded = [...hours].map(([key, samples]) => {
      const [target, hour] = key.split('\u0000');
      return summarize(target!, samples, Number(hour), HOUR);
    });
    this.add(folded);
    this.#db.prepare('DELETE FROM samples WHERE step < ? AND t < ?').run(HOUR, before);
    this.#db.prepare('DELETE FROM samples WHERE t + step < ?').run(now - keepDays * 86400);
    return old.length;
  }
}
