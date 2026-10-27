import { describe, expect, it } from 'vitest';
import { DatabaseTimeoutError, withTimeout } from './client.ts';

describe('withTimeout', () => {
  it('resolves with the query’s result when it answers in time', async () => {
    await expect(withTimeout(Promise.resolve([1]), 50)).resolves.toEqual([1]);
  });

  it('passes on the query’s own failure', async () => {
    await expect(withTimeout(Promise.reject(new Error('relation missing')), 50)).rejects.toThrow(
      'relation missing',
    );
  });

  it('rejects with DatabaseTimeoutError when the query never answers', async () => {
    const never = new Promise<never>(() => {});
    const result = withTimeout(never, 20);
    await expect(result).rejects.toBeInstanceOf(DatabaseTimeoutError);
    await expect(result).rejects.toThrow('database did not answer within 20 ms');
  });
});
