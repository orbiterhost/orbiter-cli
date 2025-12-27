#!/usr/bin/env bun
import { config } from "dotenv";

// Load environment variables from .env
const env = config().parsed || {};

// Build with environment variables injected
await Bun.build({
	entrypoints: ["./src/index.ts"],
	outdir: "./dist",
	target: "node",
	external: ["esbuild"],
	define: {
		"process.env.SUPABASE_URL": JSON.stringify(env.SUPABASE_URL),
		"process.env.SUPABASE_ANON_KEY": JSON.stringify(env.SUPABASE_ANON_KEY),
		"process.env.API_URL": JSON.stringify(env.API_URL),
	},
});

console.log("✓ Build complete");
