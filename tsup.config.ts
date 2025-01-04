import { defineConfig } from 'tsup';
import { config } from 'dotenv';
const env = config().parsed || {};


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
  define: {
    'process.env.SUPABASE_URL': JSON.stringify(env.SUPABASE_URL),
    'process.env.SUPABASE_ANON_KEY': JSON.stringify(env.SUPABASE_ANON_KEY),
    'process.env.API_URL': JSON.stringify(env.API_URL),
  },
  external: [
    /^node:.*/,  // Exclude node: imports from bundling
  ]
});
