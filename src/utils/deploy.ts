import fs from "fs";
import path from "path";
import { exec } from "child_process";
import inquirer from "inquirer";
import ora from "ora";
import { listSites, createSite, updateSite } from "./sites";
import { promisify } from "util";
import { getValidTokens } from "./auth";
import { API_URL } from "../config";
import esbuild from "esbuild";

const SOURCE = process.env.SOURCE || "cli";

const execAsync = promisify(exec);

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

// Server deployment functions
async function buildServerCode(
	entryPath: string,
	buildDir: string,
	spinner: ora.Ora,
): Promise<void> {
	spinner.text = "Building server code with esbuild...";

	// Ensure build directory exists
	if (!fs.existsSync(buildDir)) {
		fs.mkdirSync(buildDir, { recursive: true });
	}

	const outputPath = path.join(buildDir, "index.js");

	try {
		// Build with esbuild for Cloudflare Workers
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
			external: [],
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
					name: "node-polyfills",
					setup(build) {
						// Handle Node.js built-ins that might be imported
						const nodeModules = [
							"crypto",
							"buffer",
							"stream",
							"util",
							"events",
							"path",
							"url",
							"querystring",
							"fs",
							"http",
							"https",
							"zlib",
							"assert",
						];

						nodeModules.forEach((mod) => {
							build.onResolve({ filter: new RegExp(`^${mod}$`) }, () => {
								return {
									path: mod,
									namespace: "node-polyfill",
								};
							});

							build.onLoad({ filter: /.*/, namespace: "node-polyfill" }, () => {
								return {
									contents: `export default {}; export const ${mod} = {};`,
									loader: "js",
								};
							});
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

async function readBuiltScript(buildDir: string): Promise<string> {
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

async function deployToOrbiter(
	siteId: string,
	scriptContent: string,
	spinner: ora.Ora,
): Promise<DeploymentResponse> {
	spinner.text = "Deploying to Orbiter...";

	const tokens = await getValidTokens();
	if (!tokens) {
		throw new Error("Authentication required. Please login first.");
	}

	const response = await fetch(`${API_URL}/functions/deploy/${siteId}`, {
		method: "POST",
		headers: {
			Source: SOURCE,
			"Content-Type": "application/json",
			...(tokens.keyType === "apikey"
				? { "X-Orbiter-API-Key": `${tokens.access_token}` }
				: { "X-Orbiter-Token": tokens.access_token }),
		},
		body: JSON.stringify({
			script: scriptContent,
		}),
	});

	if (!response.ok) {
		const errorData = await response.json();
		throw new Error(errorData.message || "Deployment failed");
	}

	return await response.json();
}

async function createServerConfig(): Promise<ServerConfig> {
	// Get list of existing sites
	const sites = await listSites();

	if (!sites?.data?.length) {
		throw new Error(
			"No sites found. Please create a site first using 'orbiter create' or 'orbiter deploy'",
		);
	}

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

	return config;
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

		return config;
	} catch (error) {
		console.warn("Warning: Could not parse orbiter.json");
		return null;
	}
}

async function deployServer(configPath?: string): Promise<void> {
	const spinner = ora("Preparing server deployment...").start();

	try {
		// Check for existing configuration
		let config = loadServerConfig(configPath);

		if (!config) {
			spinner.stop();
			console.log("No server configuration found. Setting up...");
			config = await createServerConfig();
			spinner.start("Preparing server deployment...");
		}

		// Validate entry file exists
		if (!fs.existsSync(config.entryPath)) {
			throw new Error(`Entry file not found: ${config.entryPath}`);
		}

		// Build the server code
		await buildServerCode(config.entryPath, config.buildDir, spinner);

		// Read built script
		const scriptContent = await readBuiltScript(config.buildDir);

		// Log deployment info
		spinner.text = `Deploying server to Orbiter...`;

		// Deploy to Orbiter
		const result = await deployToOrbiter(config.siteId, scriptContent, spinner);

		spinner.succeed("Server deployment successful!");
		console.log(`🌐 API URL: ${result.data.apiUrl}`);
	} catch (error) {
		spinner.fail("❌ Server deployment failed");
		console.error("Error:", error);
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

export async function deploySite(options?: DeploymentOptions) {
	// Handle server deployment
	if (options?.server) {
		return await deployServer(options.configPath);
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
		} else {
			if (shouldStartSpinner)
				spinner.start(
					`Creating new site: https://${config.domain}.orbiter.website`,
				);
			else
				spinner.text = `Creating new site: https://${config.domain}.orbiter.website`;

			await createSite(config.buildDir, config.domain, true);

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
		}
	} catch (error) {
		if (shouldStartSpinner) spinner.fail("Deployment failed");
		else spinner.text = "Deployment failed";
		console.error("Error:", error);
	}
}
