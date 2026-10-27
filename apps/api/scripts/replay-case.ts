// Replays a recorded backtesting case: what the app would have shown at a past time, against a
// rule set. Reads only recorded fixtures, so it makes no network calls.
//
//   pnpm fixtures:replay-case --name may-15-high-water --at 2026-05-15T06:00 \
//     --timezone America/New_York --rule-set my-club.json
//
// See docs/backtesting.md.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { RuleSet } from '@rowing/core';
import { formatReplay } from '../src/backtesting/format.ts';
import { loadCase, replayCase } from '../src/backtesting/replay.ts';
import { fixturesDir } from './recorder.ts';
import { parseReplayArgs } from './replay-args.ts';

try {
  const args = parseReplayArgs(process.argv.slice(2));
  const ruleSet = RuleSet.parse(JSON.parse(await readFile(args.ruleSetPath, 'utf8')));
  const recorded = await loadCase(join(fixturesDir, 'cases', args.name));
  const replay = await replayCase({
    recorded,
    at: args.at,
    timeZone: args.timeZone,
    ruleSet,
    ...(args.boatClassId ? { boatClassId: args.boatClassId } : {}),
  });
  process.stdout.write(formatReplay(replay, { caseName: args.name, ...args }));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
