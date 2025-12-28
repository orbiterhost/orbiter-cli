/**
 * Loads esbuild dynamically.
 *
 * esbuild is not bundled with the CLI to avoid version conflicts.
 * Projects using server deployment features need to install esbuild
 * as a dev dependency in their own project.
 */
export async function loadEsbuild(): Promise<typeof import("esbuild")> {
	try {
		return await import("esbuild");
	} catch (error) {
		throw new Error(
			"esbuild is required for server deployments but was not found.\n\n" +
				"Please install esbuild in your project:\n" +
				"  npm install --save-dev esbuild\n" +
				"  # or\n" +
				"  yarn add -D esbuild\n" +
				"  # or\n" +
				"  pnpm add -D esbuild\n" +
				"  # or\n" +
				"  bun add -d esbuild\n\n" +
				"Recommended version: esbuild@^0.25.0 or later",
		);
	}
}
