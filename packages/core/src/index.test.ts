import { describe, expect, it } from 'vitest';
import * as core from './index.ts';

// Placeholder until M1 adds real exports (#7); replace rather than extend.
describe('@rowing/core', () => {
  it('loads', () => {
    expect(core).toBeDefined();
  });
});
