import fs from "fs";
import path from "path";
import { exec } from "child_process";
import inquirer from "inquirer";
import ora from "ora";
import { listSites, createSite, updateSite } from "./sites";
import { promisify } from "util";
import { getValidTokens } from "./auth";
import { API_URL } from "../config";
import dotenv from "dotenv";
import { loadEsbuild } from "./esbuild-loader";

// Detect if running under bun
function isBunRuntime(): boolean {
	return typeof Bun !== "undefined" || process.versions.bun !== undefined;
}

const SOURCE = process.env.SOURCE || "cli";

const execAsync = promisify(exec);

interface DeployServerOptions {
	siteId?: string;
	entryFile?: string;
	buildDir?: string;
	buildCommand?: string;
	configPath?: string;
	env?: boolean;
}

interface ServerConfig {
	siteId: string;
	entryPath: string;
	buildCommand: string;
	buildDir: string;
	runtime?: string;
}

interface OrbiterConfig {
	siteId?: string;
	domain: string;
	buildCommand: string;
	buildDir: string;
}

interface ServerConfig {
	siteId: string;
	entryPath: string;
	buildCommand: string;
	buildDir: string;
	runtime?: string;
}

interface DeploymentOptions {
	domain?: string;
	siteId?: string;
	buildCommand?: string;
	buildDir?: string;
	spinner?: ora.Ora;
	configPath?: string;
	server?: boolean;
	env?: boolean;
}

interface DeploymentResponse {
	message: string;
	data: {
		siteId: string;
		scriptName: string;
		apiUrl: string;
		apiEndpoint: string;
		lastUpdated: string;
	};
}

interface EnvBinding {
	name: string;
	text: string;
	type: "secret_text";
}

// Load environment variables from .env file if --env flag is present
export function loadEnvVariables(): Record<string, string> {
	const envPath = path.join(process.cwd(), ".env");
	if (fs.existsSync(envPath)) {
		const result = dotenv.config({ path: envPath });
		return result.parsed || {};
	}
	return {};
}

// Convert environment variables to bindings format
export function createEnvBindings(
	envVars: Record<string, string>,
): EnvBinding[] {
	return Object.entries(envVars).map(([name, value]) => ({
		name,
		text: value,
		type: "secret_text" as const,
	}));
}

// Server deployment functions
export async function buildServerCode(
	entryPath: string,
	buildDir: string,
	spinner: ora.Ora,
): Promise<void> {
	const useBun = isBunRuntime();
	spinner.text = `Building server code with ${useBun ? "bun" : "esbuild"}...`;

	// Ensure build directory exists
	if (!fs.existsSync(buildDir)) {
		fs.mkdirSync(buildDir, { recursive: true });
	}

	const outputPath = path.join(buildDir, "index.js");

	try {
		// Load esbuild in an environment-aware way to avoid version conflicts
		const esbuild = await loadEsbuild();
		// Build with esbuild for Cloudflare Workers with process.env to c.env transformation
		const result = await esbuild.build({
			entryPoints: [entryPath],
			bundle: true,
			outfile: outputPath,
			platform: "browser", // Cloudflare Workers use browser-like environment
			target: ["es2020"], // Cloudflare Workers support ES2020
			format: "esm", // ES modules format for Workers
			minify: true,
			sourcemap: false,
			// Handle Node.js polyfills for Cloudflare Workers
			define: {
				"process.env.NODE_ENV": '"production"',
			},
			// External modules that Cloudflare Workers provide
			external: ["dotenv"],
			// Conditions for resolving imports
			conditions: ["worker", "browser"],
			// Main fields to check when resolving packages
			mainFields: ["browser", "module", "main"],
			// Ensure all dependencies are bundled
			packages: "bundle",
			// Handle potential Node.js specific imports
			banner: {
				js: `
// Cloudflare Workers compatibility
const process = { env: {} };
const global = globalThis;
				`.trim(),
			},
			// Plugins for handling specific scenarios
			plugins: [
				{
					name: "cloudflare-transform",
					setup(build) {
						build.onLoad({ filter: /\.(ts|js)$/ }, async (args) => {
							const fs = await import("fs/promises");

							try {
								let contents = await fs.readFile(args.path, "utf8");

								// 1. Remove dotenv imports (comprehensive patterns)
								const dotenvPatterns = [
									/import\s+['"]dotenv\/config['"];?\s*\n?/g, // import 'dotenv/config'
									/import\s+['"]dotenv['"];?\s*\n?/g, // import 'dotenv'
									/import\s+\*\s+as\s+\w+\s+from\s+['"]dotenv['"];?\s*\n?/g, // import * as dotenv from 'dotenv'
									/import\s+\{[^}]*\}\s+from\s+['"]dotenv['"];?\s*\n?/g, // import { config } from 'dotenv'
									/import\s+\w+\s+from\s+['"]dotenv['"];?\s*\n?/g, // import dotenv from 'dotenv'
									/require\s*\(\s*['"]dotenv[^'"]*['"]\s*\);?\s*\n?/g, // require('dotenv/config')
									/const\s+\w+\s*=\s*require\s*\(\s*['"]dotenv['"];?\s*\n?/g, // const dotenv = require('dotenv')
								];

								dotenvPatterns.forEach((pattern) => {
									contents = contents.replace(pattern, "");
								});

								// 2. Transform process.env to c.env
								contents = contents.replace(
									/process\.env\.([A-Z_][A-Z0-9_]*)/g,
									"c.env.$1",
								);

								return {
									contents,
									loader: args.path.endsWith(".ts") ? "ts" : "js",
								};
							} catch (error) {
								return null; // Let esbuild handle it normally
							}
						});
					},
				},
			],
		});

		if (result.errors.length > 0) {
			throw new Error(
				`Build errors: ${result.errors.map((e) => e.text).join(", ")}`,
			);
		}

		// Write metadata about the build
		const metadata = {
			built: new Date().toISOString(),
			entryPoint: entryPath,
			outputSize: fs.statSync(outputPath).size,
		};
		fs.writeFileSync(
			path.join(buildDir, "build-metadata.json"),
			JSON.stringify(metadata, null, 2),
		);

		spinner.text = "Server code built successfully";
	} catch (error) {
		throw new Error(`Build failed: ${error}`);
	}
}

export async function readBuiltScript(buildDir: string): Promise<string> {
	const scriptPath = path.join(buildDir, "index.js");

	if (!fs.existsSync(scriptPath)) {
		throw new Error(`Built script not found at ${scriptPath}`);
	}

	const scriptContent = fs.readFileSync(scriptPath, "utf8");

	if (!scriptContent.trim()) {
		throw new Error("Built script file is empty");
	}

	return scriptContent;
}

export async function deployToOrbiter(
	siteId: string,
	scriptContent: string,
	envBindings: EnvBinding[],
	spinner: ora.Ora,
): Promise<DeploymentResponse | null> {
	const tokens = await getValidTokens();
	if (!tokens) {
		throw new Error("Authentication required. Please login first.");
	}

	const requestBody = {
		script: scriptContent,
		...(envBindings.length > 0 && { bindings: envBindings }),
	};

	const response = await fetch(`${API_URL}/functions/deploy/${siteId}`, {
		method: "POST",
		headers: {
			Source: SOURCE,
			"Content-Type": "application/json",
			...(tokens.keyType === "apikey"
				? { "X-Orbiter-API-Key": `${tokens.access_token}` }
				: { "X-Orbiter-Token": tokens.access_token }),
		},
		body: JSON.stringify(requestBody),
	});

	if (!response.ok) {
		const errorData = await response.json();
		if (response.status === 401) {
			// Show upgrade message and stop spinner properly
			spinner.stop();
			console.log(
				"\n\x1b[31m/////// HOUSTON, WE HAVE A PROBLEM! ///////\x1b[0m",
			);
			console.log("\x1b[31m///////////////////////////////////////////\x1b[0m");
			console.log("\x1b[31m/// SERVER FUNCTIONS NEED A PAID PLAN /////\x1b[0m");
			console.log("\x1b[31m/// UPGRADE TO UNLOCK ORBITAL DEPLOYMENT //\x1b[0m");
			console.log("\x1b[31m///////////////////////////////////////////\x1b[0m");
			console.log(
				"\n\x1b[31m🚀 MISSION CONTROL: https://app.orbiter.host/billing\x1b[0m\n",
			);
			return null;
		}
		throw new Error(errorData.message || "Deployment failed");
	}

	return await response.json();
}

async function createServerConfig(): Promise<ServerConfig> {
	const spinner = ora("Loading sites...").start();

	try {
		// Get list of existing sites
		const sites = await listSites();

		if (!sites?.data?.length) {
			spinner.fail("No sites found");
			throw new Error(
				"No sites found. Please create a site first using 'orbiter create' or 'orbiter deploy'",
			);
		}

		spinner.stop();

		const siteChoices = sites.data.map((site: any) => ({
			name: `${site.domain} (${site.id})`,
			value: { id: site.id, domain: site.domain },
		}));

		const { site } = await inquirer.prompt([
			{
				type: "list",
				name: "site",
				message: "Select a site to deploy the server to:",
				choices: siteChoices,
			},
		]);

		const { entryPath } = await inquirer.prompt([
			{
				type: "input",
				name: "entryPath",
				message: "Enter the path to your server entry file:",
				default: "src/index.ts",
				validate: (input) => {
					if (!input.length) return "Entry path is required";
					if (!fs.existsSync(input)) return "Entry file does not exist";
					return true;
				},
			},
		]);

		const { buildDir } = await inquirer.prompt([
			{
				type: "input",
				name: "buildDir",
				message: "Enter the build output directory:",
				default: "dist",
			},
		]);

		const config: ServerConfig = {
			siteId: site.id,
			entryPath,
			buildCommand: `esbuild ${entryPath} --bundle --outfile=${buildDir}/index.js --platform=browser --target=es2020 --format=esm --minify`,
			buildDir,
			runtime: "cloudflare-workers",
		};

		// Save configuration
		fs.writeFileSync("orbiter.json", JSON.stringify(config, null, 2));

		const configSpinner = ora(
			"Server configuration saved to orbiter.json",
		).succeed();

		return config;
	} catch (error) {
		spinner.fail("Failed to create server configuration");
		throw error;
	}
}

function loadServerConfig(
	configPath: string = "./orbiter.json",
): ServerConfig | null {
	if (!fs.existsSync(configPath)) {
		return null;
	}

	try {
		const content = fs.readFileSync(configPath, "utf8");
		const config = JSON.parse(content) as ServerConfig;

		// Validate required fields for server deployment
		if (!config.siteId || !config.entryPath) {
			return null;
		}

		// Set defaults for missing optional fields
		if (!config.buildDir) {
			config.buildDir = "dist";
		}

		if (!config.buildCommand) {
			config.buildCommand = generateDefaultBuildCommand(
				config.entryPath,
				config.buildDir,
			);
		}

		if (!config.runtime) {
			config.runtime = "cloudflare-workers";
		}

		return config;
	} catch (error) {
		console.warn("Warning: Could not parse orbiter.json");
		return null;
	}
}

async function deployServer(
	configPath?: string,
	useEnv?: boolean,
): Promise<void> {
	const spinner = ora("Preparing server deployment...").start();

	try {
		// Check for existing configuration
		spinner.text = "Looking for server configuration...";
		let config = loadServerConfig(configPath);

		if (!config) {
			spinner.info("No server configuration found. Starting setup...");
			config = await createServerConfig();
			spinner.start("Configuration created");
		} else {
			spinner.text = "Server configuration loaded";
		}

		// Load environment variables if --env flag is present
		let envBindings: EnvBinding[] = [];
		if (useEnv) {
			spinner.text = "Loading environment variables from .env file...";
			const envVars = loadEnvVariables();
			envBindings = createEnvBindings(envVars);
			if (envBindings.length > 0) {
				spinner.text = `Loaded ${envBindings.length} environment variables`;
			} else {
				spinner.text = "No environment variables found in .env file";
			}
		}

		// Build the server code
		spinner.text = "Building server code with esbuild...";
		await buildServerCode(config.entryPath, config.buildDir, spinner);
		spinner.text = "Build completed successfully";

		// Read built script
		spinner.text = "Reading built script...";
		const scriptContent = await readBuiltScript(config.buildDir);
		const bundleSize = (scriptContent.length / 1024).toFixed(2);
		spinner.text = `Built bundle size: ${bundleSize} KB`;

		// Deploy to Orbiter
		spinner.text = "Deploying server to Orbiter...";
		const result = await deployToOrbiter(
			config.siteId,
			scriptContent,
			envBindings,
			spinner,
		);

		if (!result) {
			return; // Exit gracefully without showing success message
		}

		spinner.succeed(`Server deployed: ${result?.data.apiUrl}`);
	} catch (error) {
		spinner.fail("Server deployment failed");
		console.error("Error:", error);
		throw error;
	}
}

export async function deployServerCommand(
	options: DeployServerOptions,
): Promise<void> {
	const spinner = ora("Preparing server deployment...").start();

	try {
		let config: ServerConfig;

		// Check if we should load from config file
		const configPath = options.configPath || "./orbiter.json";

		if (fs.existsSync(configPath) && !hasAnyOptions(options)) {
			// Load from existing config if no options provided
			spinner.text = "Loading server configuration...";
			const loadedConfig = loadServerConfig(configPath);

			if (!loadedConfig) {
				spinner.info(
					"Invalid server configuration found. Starting interactive setup...",
				);
				config = await createInteractiveServerConfig();
			} else {
				config = loadedConfig;
				spinner.text = "Server configuration loaded from file";
			}
		} else if (hasAllRequiredOptions(options)) {
			// Use provided options
			spinner.text = "Using provided configuration options...";
			config = {
				siteId: options.siteId!,
				entryPath: options.entryFile!,
				buildDir: options.buildDir!,
				buildCommand:
					options.buildCommand ||
					generateDefaultBuildCommand(options.entryFile!, options.buildDir!),
				runtime: "cloudflare-workers",
			};
		} else {
			// Interactive setup
			spinner.info("Starting interactive server setup...");
			config = await createInteractiveServerConfig(options);
		}

		// Validate configuration
		if (!config.siteId || !config.entryPath || !config.buildDir) {
			throw new Error(
				"Invalid configuration: siteId, entryPath, and buildDir are required",
			);
		}

		// Load environment variables if --env flag is present
		let envBindings: EnvBinding[] = [];
		if (options.env) {
			spinner.text = "Loading environment variables from .env file...";
			const envVars = loadEnvVariables();
			envBindings = createEnvBindings(envVars);
			if (envBindings.length > 0) {
				spinner.text = `Loaded ${envBindings.length} environment variables`;
			} else {
				spinner.text = "No environment variables found in .env file";
			}
		}

		// Build the server code
		spinner.text = "Building server code with esbuild...";
		await buildServerCode(config.entryPath, config.buildDir, spinner);
		spinner.text = "Build completed successfully";

		// Read built script
		spinner.text = "Reading built script...";
		const scriptContent = await readBuiltScript(config.buildDir);
		const bundleSize = (scriptContent.length / 1024).toFixed(2);
		spinner.text = `Built bundle size: ${bundleSize} KB`;

		// Deploy to Orbiter
		spinner.text = "Deploying server to Orbiter...";
		const result = await deployToOrbiter(
			config.siteId,
			scriptContent,
			envBindings,
			spinner,
		);

		if (!result) {
			spinner.stop();
			return; // Exit gracefully without throwing error
		}

		// Save configuration for future use
		if (!fs.existsSync("orbiter.json")) {
			fs.writeFileSync("orbiter.json", JSON.stringify(config, null, 2));
			spinner.text = "Configuration saved to orbiter.json";
		}

		spinner.succeed(`Server deployed: ${result?.data.apiUrl}`);
	} catch (error) {
		spinner.fail("Server deployment failed");
		console.error("Error:", error);
		throw error;
	}
}

function hasAnyOptions(options: DeployServerOptions): boolean {
	return !!(
		options.siteId ||
		options.entryFile ||
		options.buildDir ||
		options.buildCommand
	);
}

function hasAllRequiredOptions(options: DeployServerOptions): boolean {
	return !!(options.siteId && options.entryFile && options.buildDir);
}

function generateDefaultBuildCommand(
	entryFile: string,
	buildDir: string,
): string {
	if (isBunRuntime()) {
		return `bun build ${entryFile} --outfile ${buildDir}/index.js --target browser --format esm --minify`;
	}
	return `esbuild ${entryFile} --bundle --outfile=${buildDir}/index.js --platform=browser --target=es2020 --format=esm --minify`;
}

async function createInteractiveServerConfig(
	options?: DeployServerOptions,
): Promise<ServerConfig> {
	const spinner = ora("Loading sites...").start();

	try {
		// Get list of existing sites
		const sites = await listSites();

		if (!sites?.data?.length) {
			spinner.fail("No sites found");
			throw new Error(
				"No sites found. Please create a site first using 'orbiter create' or 'orbiter deploy'",
			);
		}

		spinner.stop();

		// Site selection
		let siteId = options?.siteId;
		if (!siteId) {
			const siteChoices = sites.data.map((site: any) => ({
				name: `${site.domain} (${site.id})`,
				value: { id: site.id, domain: site.domain },
			}));

			const { site } = await inquirer.prompt([
				{
					type: "list",
					name: "site",
					message: "Select a site to deploy the server to:",
					choices: siteChoices,
				},
			]);
			siteId = site.id;
		}

		// Entry file selection
		let entryPath = options?.entryFile;
		if (!entryPath) {
			const { entryFile } = await inquirer.prompt([
				{
					type: "input",
					name: "entryFile",
					message: "Enter the path to your server entry file:",
					default: "src/index.ts",
					validate: (input) => {
						if (!input.length) return "Entry path is required";
						if (!fs.existsSync(input)) return "Entry file does not exist";
						return true;
					},
				},
			]);
			entryPath = entryFile;
		}

		// Build directory selection
		let buildDir = options?.buildDir;
		if (!buildDir) {
			const { outputDir } = await inquirer.prompt([
				{
					type: "input",
					name: "outputDir",
					message: "Enter the build output directory:",
					default: "dist",
				},
			]);
			buildDir = outputDir;
		}

		// Build command (optional)
		let buildCommand = options?.buildCommand;
		if (!buildCommand) {
			const { customBuildCommand } = await inquirer.prompt([
				{
					type: "confirm",
					name: "customBuildCommand",
					message: "Do you want to specify a custom build command?",
					default: false,
				},
			]);

			if (customBuildCommand) {
				const { command } = await inquirer.prompt([
					{
						type: "input",
						name: "command",
						message: "Enter your custom build command:",
						default: generateDefaultBuildCommand(entryPath!, buildDir!),
					},
				]);
				buildCommand = command;
			} else {
				buildCommand = generateDefaultBuildCommand(entryPath!, buildDir!);
			}
		}

		const config: ServerConfig = {
			siteId: siteId!,
			entryPath: entryPath!,
			buildCommand: buildCommand!,
			buildDir: buildDir!,
			runtime: "cloudflare-workers",
		};

		return config;
	} catch (error) {
		spinner.fail("Failed to create server configuration");
		throw error;
	}
}

async function createNewDeployment(
	options?: DeploymentOptions,
): Promise<OrbiterConfig> {
	let siteId = options?.siteId;
	let domain = options?.domain;
	let buildCommand = options?.buildCommand;
	let buildDir = options?.buildDir;

	if (siteId && !domain) {
		const sites = await listSites();
		const site = sites?.data?.find((site: any) => site.id === siteId);
		if (site) {
			domain = site.domain.replace(".orbiter.website", "");
		} else {
			throw new Error(`No site found with ID: ${siteId}`);
		}
	}

	if (!siteId && !domain) {
		// Get list of existing sites
		const sites = await listSites();
		const siteChoices =
			sites?.data?.map((site: any) => ({
				name: `${site.domain} (${site.id})`,
				value: { id: site.id, domain: site.domain },
			})) || [];

		const { action } = await inquirer.prompt([
			{
				type: "list",
				name: "action",
				message: "Would you like to:",
				choices: [
					{ name: "Create new site", value: "new" },
					...(siteChoices.length
						? [{ name: "Link to existing site", value: "existing" }]
						: []),
				],
			},
		]);

		if (action === "existing") {
			const { site } = await inquirer.prompt([
				{
					type: "list",
					name: "site",
					message: "Select a site to link:",
					choices: siteChoices,
				},
			]);
			siteId = site.id;
			domain = site.domain.replace(".orbiter.website", "");
		} else {
			const { newDomain } = await inquirer.prompt([
				{
					type: "input",
					name: "newDomain",
					message: "Enter a subdomain for your new site:",
					validate: (input) => input.length > 0 || "Domain is required",
				},
			]);
			domain = newDomain;
		}
	}

	if (!buildCommand) {
		const { buildCommand: cmd } = await inquirer.prompt([
			{
				type: "input",
				name: "buildCommand",
				message: "Enter build command:",
				default: "npm run build",
			},
		]);
		buildCommand = cmd;
	}

	if (!buildDir) {
		const { buildDir: dir } = await inquirer.prompt([
			{
				type: "input",
				name: "buildDir",
				message: "Enter build directory:",
				default: "dist",
			},
		]);
		buildDir = dir;
	}

	const config: OrbiterConfig = {
		siteId,
		domain: domain!,
		buildCommand: buildCommand!,
		buildDir: buildDir!,
	};

	fs.writeFileSync("orbiter.json", JSON.stringify(config, null, 2));
	return config;
}

export async function deploySite(
	options?: DeploymentOptions,
): Promise<boolean> {
	// Handle server deployment
	if (options?.server) {
		try {
			await deployServer(options.configPath, options.env);
			return true;
		} catch (error) {
			return false;
		}
	}

	// Use existing spinner or create a new one
	const spinner = options?.spinner || ora();
	const shouldStartSpinner = !options?.spinner; // Only start if we created it

	try {
		const configPath =
			options?.configPath || path.join(process.cwd(), "orbiter.json");
		let config: OrbiterConfig;

		if (
			fs.existsSync(configPath) &&
			(!options ||
				!(
					options.domain ||
					options.siteId ||
					options.buildCommand ||
					options.buildDir
				))
		) {
			if (shouldStartSpinner) spinner.start("Reading configuration...");
			else spinner.text = "Reading configuration...";

			config = JSON.parse(fs.readFileSync(configPath, "utf8"));
			if (shouldStartSpinner) spinner.succeed("Configuration loaded");
		} else {
			if (shouldStartSpinner)
				spinner.info(
					"No configuration found or options provided. Starting setup...",
				);
			else spinner.text = "No configuration found. Setting up...";

			config = await createNewDeployment(options);
			if (shouldStartSpinner) spinner.succeed("Configuration created");
		}

		// Run build command
		if (shouldStartSpinner)
			spinner.start(`Running build command: ${config.buildCommand}`);
		else spinner.text = `Running build command: ${config.buildCommand}`;

		await execAsync(config.buildCommand);
		if (shouldStartSpinner) spinner.succeed("Build completed");

		// Deploy
		if (config.siteId) {
			if (shouldStartSpinner)
				spinner.start(
					`Updating existing site: ${config.domain}.orbiter.website`,
				);
			else
				spinner.text = `Updating existing site: ${config.domain}.orbiter.website`;

			await updateSite(config.buildDir, config.siteId, undefined, true);
			if (shouldStartSpinner)
				spinner.succeed(
					`Site updated: https://${config.domain}.orbiter.website`,
				);
			return true;
		} else {
			if (shouldStartSpinner)
				spinner.start(
					`Creating new site: https://${config.domain}.orbiter.website`,
				);
			else
				spinner.text = `Creating new site: https://${config.domain}.orbiter.website`;

			const createResult = await createSite(
				config.buildDir,
				config.domain,
				true,
			);

			// Check if creation failed due to site limit (createSite returns undefined on failure)
			if (!createResult) {
				// The error message was already shown in createSite, just return
				spinner.stop();
				return false;
			}

			// Update config with new site ID
			const sites = await listSites(config.domain, false, spinner);
			if (sites?.data?.[0]?.id) {
				config.siteId = sites.data[0].id;
				fs.writeFileSync("orbiter.json", JSON.stringify(config, null, 2));
			}
			if (shouldStartSpinner)
				spinner.succeed(
					`Site deployed: https://${config.domain}.orbiter.website`,
				);
			return true;
		}
	} catch (error) {
		if (shouldStartSpinner) spinner.fail("Deployment failed");
		else spinner.text = "Deployment failed";
		console.error("Error:", error);
		return false;
	}
}
