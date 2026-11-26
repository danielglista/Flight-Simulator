import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The built map is a binary asset; tests inline it.
  assetsInclude: ['**/*.bin'],
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // The long simulation tests take 3 to 4 s alone and pass 5 s when every file runs at once.
    testTimeout: 20000,
  },
});
