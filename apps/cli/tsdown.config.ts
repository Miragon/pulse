import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: { operate: 'src/bin/operate.ts' },
  format: 'esm',
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  dts: false,
  sourcemap: false,
  fixedExtension: false,
});
