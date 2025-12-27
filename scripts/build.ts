#!/usr/bin/env bun
import { config } from "dotenv";

// Load environment variables from .env file (for local development)
config();

// Get environment variables (from .env file or GitHub Actions/system env)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const API_URL = process.env.API_URL;

// Build with environment variables injected
await Bun.build({
	entrypoints: ["./src/index.ts"],
	outdir: "./dist",
	target: "node",
	external: ["esbuild"],
	define: {
		"process.env.SUPABASE_URL": JSON.stringify(SUPABASE_URL),
		"process.env.SUPABASE_ANON_KEY": JSON.stringify(SUPABASE_ANON_KEY),
		"process.env.API_URL": JSON.stringify(API_URL),
	},
});

console.log("✓ Build complete");
