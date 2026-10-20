import { expect, test } from 'vitest';
import { DatasetError } from '../../src/domain/errors';

for (const [code, message] of [
  ['stale-revision', 'Stale dataset revision'],
  ['historical-conflict', 'Historical commitment conflict'],
] as const) {
  test(`${code} retains its diagnostic and supports independent wording`, () => {
    const original = new DatasetError(code);
    expect(original).toBeInstanceOf(Error);
    expect(original.name).toBe('DatasetError');
    expect(original.code).toBe(code);
    expect(original.message).toBe(message);
    const reworded = new DatasetError(code, 'A different diagnostic');
    expect(reworded).toBeInstanceOf(DatasetError);
    expect(reworded.code).toBe(original.code);
    expect(reworded.message).toBe('A different diagnostic');
  });
}
