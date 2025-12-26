/**
 * Loads esbuild dynamically.
 *
 * esbuild is marked as external in the build, so this import resolves
 * from the runtime environment rather than being bundled. This avoids
 * version conflicts when the CLI is used in Bun monorepos.
 */
export async function loadEsbuild(): Promise<typeof import("esbuild")> {
	try {
		return await import("esbuild");
	} catch (error) {
		throw new Error(
			"esbuild is required for server deployments but was not found.\n" +
				"Please install it: npm install esbuild --save-dev\n" +
				"Or with bun: bun add -d esbuild",
		);
	}
}
