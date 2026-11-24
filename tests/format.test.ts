import { describe, expect, it } from 'vitest';
import { formatHeading } from '../src/views/format';

describe('format', () => {
  it('formats headings', () => {
    expect(formatHeading(0)).toBe('360');
    expect(formatHeading(Math.PI / 4)).toBe('045');
    expect(formatHeading((359.7 * Math.PI) / 180)).toBe('360');
    expect(formatHeading(Math.PI / 2)).toBe('090');
  });
});
