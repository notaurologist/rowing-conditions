// Arguments for replay-case.ts. Kept apart so they can be tested without running a replay.

import { parseArgs } from 'node:util';
import type { DisplaySystem } from '@rowing/core';

export interface ReplayArgs {
  name: string;
  at: string; // ISO 8601 UTC
  timeZone: string;
  ruleSetPath: string;
  boatClassId?: string;
  units: DisplaySystem;
}

const usage = `Usage: pnpm fixtures:replay-case --name <case> --at YYYY-MM-DDTHH:MM \\
  --timezone <IANA zone, e.g. America/New_York> --rule-set <rule-set.json> \\
  [--boat-class <id>] [--units us|metric]`;

// The UTC offset of a time zone at an instant, in milliseconds.
function offsetMs(timeZone: string, utcMs: number): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(new Date(utcMs))
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - utcMs;
}

// A wall-clock time in a zone as UTC. Undefined for a time that doesn't exist there, such as
// 2:30 on the morning clocks spring forward.
export function localToUtc(local: string, timeZone: string): string | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!match) return undefined;
  const [, y, mo, d, h, mi] = match.map(Number) as number[];
  const wall = Date.UTC(y as number, (mo as number) - 1, d, h, mi);
  let utc = wall - offsetMs(timeZone, wall);
  utc = wall - offsetMs(timeZone, utc);
  // Round-trip check catches nonexistent times and out-of-range fields such as month 13.
  if (utc + offsetMs(timeZone, utc) !== wall) return undefined;
  const back = new Date(wall).toISOString().slice(0, 16);
  if (back !== local) return undefined;
  return new Date(utc).toISOString();
}

function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

// Throws an Error whose message says what's wrong and how to call the script.
export function parseReplayArgs(args: string[]): ReplayArgs {
  const fail = (problem: string): never => {
    throw new Error(`${problem}\n${usage}`);
  };
  let values: ReturnType<typeof parse>['values'];
  try {
    values = parse(args).values;
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }

  const name = values.name ?? fail('--name is required');
  const timeZone = values.timezone ?? fail('--timezone is required');
  if (!isTimeZone(timeZone)) fail(`--timezone is not a time zone: ${timeZone}`);
  const local = values.at ?? fail('--at is required');
  const at =
    localToUtc(local, timeZone) ??
    fail(`--at must be a local time YYYY-MM-DDTHH:MM that exists in ${timeZone}: ${local}`);
  const ruleSetPath = values['rule-set'] ?? fail('--rule-set is required');
  const units = values.units ?? 'us';
  if (units !== 'us' && units !== 'metric') fail(`--units must be us or metric: ${units}`);

  return {
    name,
    at,
    timeZone,
    ruleSetPath,
    ...(values['boat-class'] ? { boatClassId: values['boat-class'] } : {}),
    units: units as DisplaySystem,
  };
}

function parse(args: string[]) {
  return parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: {
      name: { type: 'string' },
      at: { type: 'string' },
      timezone: { type: 'string' },
      'rule-set': { type: 'string' },
      'boat-class': { type: 'string' },
      units: { type: 'string' },
    },
  });
}
