import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],  // Change to CommonJS format
  splitting: false,
  sourcemap: true,
  clean: true,
  minify: false,   // Disable minification for better debugging
  noExternal: [
    'commander',
    'express',
    'open',
    '@supabase/supabase-js',
    'pinata-web3'
  ],
  platform: 'node',
  target: 'node18',
  banner: {
    js: '#!/usr/bin/env node',
  },
  treeshake: true,
  external: [
    /^node:.*/,  // Exclude node: imports from bundling
  ]
});
