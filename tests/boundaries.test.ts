import { describe, expect, it } from 'vitest';

const files = import.meta.glob('/src/sim/**/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

describe('sim boundaries', () => {
  it('finds the sim files', () => {
    expect(Object.keys(files).length).toBeGreaterThan(0);
  });
  it('imports nothing from views, app or input, and never touches the browser', () => {
    for (const [path, src] of Object.entries(files)) {
      for (const m of src.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
        expect(m[1], `${path} imports ${m[1]}`).not.toMatch(/(^|\/)(views|app|input)(\/|$)/);
      }
      expect(src, path).not.toMatch(/\b(document|window)\b/);
    }
  });
});
