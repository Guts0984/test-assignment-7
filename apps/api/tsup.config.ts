import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { main: 'src/main.ts', bootstrap: 'src/db/bootstrap.ts' },
  format: ['esm'],
  target: 'node22',
  clean: true,
  sourcemap: true,
  // The shared package ships TypeScript source, so it must be bundled.
  noExternal: ['@catalog/shared'],
});
