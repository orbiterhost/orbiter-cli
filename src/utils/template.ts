import fs from "fs";
import path from "path";
import os from "os";
import ora from "ora";
import { exec } from "child_process";
import { promisify } from "util";
import fetch from "node-fetch";
import inquirer from "inquirer";
import { deploySite } from "./deploy";

const SOURCE = process.env.SOURCE || "cli";
const execAsync = promisify(exec);

// Configuration
const TEMPLATES_REPO = "orbiterhost/orbiter-templates";
const TEMPLATES_REPO_URL = "https://github.com/orbiterhost/orbiter-templates";
const TEMPLATES_RAW_URL =
	"https://raw.githubusercontent.com/orbiterhost/orbiter-templates/main";
const TEMPLATES_CACHE_DIR = path.join(os.homedir(), ".orbiter", "templates");
const TEMPLATES_SUBDIRECTORY = "general";

interface TemplateOptions {
	domain?: string;
}

interface TemplateMetadata {
	name: string;
	displayName: string;
	description: string;
	tags: string[];
}

/**
 * Fetch template from GitHub repository
 */
async function fetchTemplate(
	templateName: string,
	parentSpinner?: ora.Ora,
): Promise<string> {
	const spinner =
		parentSpinner || ora(`Fetching template: ${templateName}`).start();

	// Create cache directory if it doesn't exist
	fs.mkdirSync(TEMPLATES_CACHE_DIR, { recursive: true });

	const localTemplatePath = path.join(TEMPLATES_CACHE_DIR, templateName);
	const cacheMetaPath = path.join(localTemplatePath, ".cache-meta.json");

	// Check if we need to fetch or update
	const needsFetch =
		!fs.existsSync(localTemplatePath) ||
		!fs.existsSync(cacheMetaPath) ||
		isCacheStale(cacheMetaPath);

	try {
		if (needsFetch) {
			spinner.text = `Downloading ${templateName} template...`;

			// Delete existing directory if it exists
			if (fs.existsSync(localTemplatePath)) {
				fs.rmSync(localTemplatePath, { recursive: true, force: true });
			}

			// Create temp directory for cloning
			const tempDir = path.join(os.tmpdir(), `orbiter-template-${Date.now()}`);
			fs.mkdirSync(tempDir, { recursive: true });

			try {
				// Use git clone with minimal configuration for speed
				// --depth=1: Shallow clone (only latest commit)
				// --single-branch: Only clone the main branch
				// --no-tags: Skip downloading tags
				await execAsync(
					`git clone --depth=1 --single-branch --no-tags https://github.com/${TEMPLATES_REPO}.git ${tempDir}`,
				);

				// Copy only the needed template to the final location
				const templateSourcePath = path.join(
					tempDir,
					"templates",
					TEMPLATES_SUBDIRECTORY,
					templateName,
				);
				fs.mkdirSync(localTemplatePath, { recursive: true });

				// Copy the specific template to the final destination
				await execAsync(`cp -r ${templateSourcePath}/* ${localTemplatePath}`);

				// Cleanup temporary directory
				fs.rmSync(tempDir, { recursive: true, force: true });
			} catch (gitError) {
				spinner.text = `Git clone failed, trying direct download...`;

				// Create template directory
				fs.mkdirSync(localTemplatePath, { recursive: true });

				// Fallback to direct download if git fails
				const templateUrl = `${TEMPLATES_RAW_URL}/templates/${TEMPLATES_SUBDIRECTORY}/${templateName}`;
				await downloadTemplateFiles(templateUrl, localTemplatePath);
			}

			// Create cache metadata
			fs.writeFileSync(
				cacheMetaPath,
				JSON.stringify(
					{
						fetchedAt: new Date().toISOString(),
						templateName,
						source: TEMPLATES_REPO_URL,
					},
					null,
					2,
				),
			);

			spinner.succeed(`Downloaded template: ${templateName}`);
		} else {
			spinner.succeed(`Using cached template: ${templateName}`);
		}

		return localTemplatePath;
	} catch (error) {
		spinner.fail(`Failed to fetch template: ${templateName}`);
		console.error("Error details:", error);

		// If degit fails, try suggesting available templates
		try {
			const templates = await listAvailableTemplates();
			console.log("\nAvailable templates:");
			templates.forEach((t) => console.log(`  - ${t}`));
		} catch (e) {
			// Silently fail the suggestions
		}

		throw new Error(
			`Template '${templateName}' not found or couldn't be fetched`,
		);
	}
}

function isCacheStale(metaPath: string): boolean {
	try {
		const metadata = JSON.parse(fs.readFileSync(metaPath, "utf8"));
		const fetchedAt = new Date(metadata.fetchedAt).getTime();
		const now = new Date().getTime();
		const hoursSinceFetch = (now - fetchedAt) / (1000 * 60 * 60);

		return hoursSinceFetch > 24;
	} catch (e) {
		// If we can't read/parse the metadata, consider it stale
		return true;
	}
}

/**
 * List available templates from the repository
 */
export async function listAvailableTemplates(): Promise<string[]> {
	try {
		// Get directory listing from GitHub API for the new path
		const response = await fetch(
			`https://api.github.com/repos/${TEMPLATES_REPO}/contents/templates/${TEMPLATES_SUBDIRECTORY}`,
		);

		if (!response.ok) {
			throw new Error(`GitHub API error: ${response.statusText}`);
		}

		const data = (await response.json()) as { name: string; type: string }[];

		// Filter for directories only
		return data.filter((item) => item.type === "dir").map((item) => item.name);
	} catch (error) {
		console.error("Error fetching template list:", error);
		throw error;
	}
}
/**
 * Fetch template metadata
 */
export async function getTemplateMetadata(
	templateName: string,
): Promise<TemplateMetadata | null> {
	try {
		const metadataUrl = `${TEMPLATES_RAW_URL}/templates/${TEMPLATES_SUBDIRECTORY}/${templateName}/template.json`;
		const response = await fetch(metadataUrl);

		if (!response.ok) {
			return null;
		}

		return (await response.json()) as TemplateMetadata;
	} catch (error) {
		return null;
	}
}
/**
 * Creates a new project from a template
 */
export async function createTemplateApp(providedName?: string) {
	const spinner = ora("Setting Up your app").start();
	let projectName = providedName as string;

	try {
		// Get project name
		if (!projectName) {
			spinner.stop();
			const answer = await inquirer.prompt([
				{
					type: "input",
					name: "projectName",
					message: "What would you like to name your project?",
					validate: (input) => input.length > 0 || "Project name is required",
				},
			]);
			projectName = answer.projectName;
			spinner.start("Setting up your app");
		}

		spinner.stop();
		const { domain } = await inquirer.prompt([
			{
				type: "input",
				name: "domain",
				message: "Choose a subdomain for your app (yourname.orbiter.website):",
				default: projectName.toLowerCase().replace(/\s+/g, "-"),
				validate: (input) => {
					if (input.length === 0) return "Subdomain is required";
					if (input.includes("."))
						return "Please enter only the subdomain part (without .orbiter.website)";
					if (!/^[a-z0-9-]+$/.test(input))
						return "Subdomain can only contain lowercase letters, numbers, and hyphens";
					return true;
				},
			},
		]);

		// Choose template
		spinner.text = "Fetching available templates...";
		spinner.start();
		const templates = await listAvailableTemplates();
		spinner.stop();

		if (templates.length === 0) {
			throw new Error(
				"No templates found. Please check your internet connection or try again later.",
			);
		}

		const { template } = await inquirer.prompt([
			{
				type: "list",
				name: "template",
				message: "Select a template:",
				choices: templates.map((t) => ({ name: t, value: t })),
			},
		]);

		const { packageManager } = await inquirer.prompt([
			{
				type: "list",
				name: "packageManager",
				message: "Select a package manager:",
				choices: [
					{ name: "npm", value: "npm" },
					{ name: "yarn", value: "yarn" },
					{ name: "pnpm", value: "pnpm" },
					{ name: "bun", value: "bun" },
				],
				default: "npm",
			},
		]);

		// Create the project
		spinner.text = `Creating project with ${template} template...`;
		spinner.start();
		const targetDir = path.join(process.cwd(), projectName);

		// Get the template directory
		const templateDir = await fetchTemplate(template, spinner);

		// Create target directory
		fs.mkdirSync(targetDir, { recursive: true });

		// Copy template files with modifications
		copyTemplateFilesRecursive(templateDir, targetDir, {
			domain,
		});

		// Install dependencies
		spinner.text = "Installing dependencies...";

		let installCommand;
		let buildCommand;
		let workingDir = targetDir; // Default working directory
		let buildOutputDir = "dist"; // Default build output directory

		switch (packageManager) {
			case "yarn":
				installCommand = "yarn";
				buildCommand = "yarn build";
				break;
			case "pnpm":
				installCommand = "pnpm install";
				buildCommand = "pnpm run build";
				break;
			case "bun":
				installCommand = "bun install";
				buildCommand = "bun run build";
				break;
			case "npm":
			default:
				installCommand = "npm install";
				buildCommand = "npm run build";
				break;
		}

		// Special handling for bhvr monorepo template
		if (template === "bhvr") {
			// Install dependencies at the root level first
			spinner.text = "Installing root dependencies...";
			await execAsync(installCommand, { cwd: targetDir });

			// Set client directory as the working directory for build and deploy
			workingDir = path.join(targetDir, "client");
		} else {
			// Standard template handling
			spinner.text = "Installing dependencies...";
			await execAsync(installCommand, { cwd: targetDir });
		}

		spinner.succeed("Project created and dependencies installed");

		// Save the current working directory
		const originalCwd = process.cwd();

		try {
			// Change to the target directory
			process.chdir(workingDir);

			// Deploy directly using the deploySite function
			spinner.text = "Deploying to Orbiter...";
			spinner.start();
			// Pass the existing spinner to deploySite
			await deploySite({
				domain: domain,
				buildCommand: buildCommand,
				buildDir: buildOutputDir,
				spinner: spinner, // Pass the spinner
			});

			spinner.succeed(
				`🚀 App deployed successfully to https://${domain}.orbiter.website`,
			);
		} finally {
			// Restore the original working directory
			process.chdir(originalCwd);
		}
	} catch (error) {
		spinner.fail("Failed to create Mini App");
		console.error("Error:", error);
	}
}

//  Recursively copy template files to target directory with modifications
function copyTemplateFilesRecursive(
	source: string,
	target: string,
	options: TemplateOptions,
) {
	// Get all items in the source directory
	const items = fs.readdirSync(source);

	for (const item of items) {
		// Skip cache metadata and template metadata
		if (item === ".cache-meta.json" || item === "template.json") {
			continue;
		}

		const sourcePath = path.join(source, item);
		const targetPath = path.join(target, item);
		const stat = fs.statSync(sourcePath);

		if (stat.isDirectory()) {
			// Create the directory in the target
			fs.mkdirSync(targetPath, { recursive: true });
			// Recursively copy content
			copyTemplateFilesRecursive(sourcePath, targetPath, options);
		} else {
			// Process and copy the file
			processAndCopyFile(sourcePath, targetPath, options);
		}
	}
}

/**
 * Process file content and write to target
 */
function processAndCopyFile(
	sourcePath: string,
	targetPath: string,
	options: TemplateOptions,
) {
	const content = fs.readFileSync(sourcePath, "utf8");

	if (sourcePath.endsWith("package.json")) {
		const processedContent = processPackageJson(content, options, targetPath);
		fs.writeFileSync(targetPath, processedContent);
	} else {
		// Copy file as is for all other files
		fs.copyFileSync(sourcePath, targetPath);
	}
}

/**
 * Process package.json template
 */
function processPackageJson(
	content: string,
	options: TemplateOptions,
	filePath: string,
): string {
	try {
		const packageJson = JSON.parse(content);

		// Check if this is part of the bhvr template
		const isBhvrTemplate =
			filePath.includes("/bhvr") || filePath.includes("\\bhvr");

		// For bhvr template, only modify the root package.json
		if (isBhvrTemplate) {
			// Check if this is the root package.json (not in client, server, or shared directories)
			const isSubpackage =
				filePath.includes("/client/") ||
				filePath.includes("\\client\\") ||
				filePath.includes("/server/") ||
				filePath.includes("\\server\\") ||
				filePath.includes("/shared/") ||
				filePath.includes("\\shared\\");

			// Only modify root package.json for bhvr template
			if (!isSubpackage) {
				packageJson.name =
					options.domain?.toLowerCase().replace(/\s+/g, "-") || "my-app";
			}
		} else {
			// For non-bhvr templates, modify the package name as usual
			packageJson.name =
				options.domain?.toLowerCase().replace(/\s+/g, "-") || "my-app";
		}

		return JSON.stringify(packageJson, null, 2);
	} catch (error) {
		console.warn("Error processing package.json, using original", error);
		return content;
	}
}

/**
 * Update all cached templates
 */
export async function updateCachedTemplates(): Promise<void> {
	const spinner = ora("Updating template cache...").start();

	try {
		const templates = await listAvailableTemplates();
		spinner.text = `Found ${templates.length} templates`;

		for (const template of templates) {
			spinner.text = `Updating ${template}...`;

			// Force refresh the template
			const templateDir = path.join(TEMPLATES_CACHE_DIR, template);
			if (fs.existsSync(templateDir)) {
				fs.rmSync(templateDir, { recursive: true, force: true });
			}

			await fetchTemplate(template);
		}

		spinner.succeed(`Updated ${templates.length} templates`);
	} catch (error) {
		spinner.fail("Failed to update templates");
		console.error("Error:", error);
	}
}

async function downloadTemplateFiles(baseUrl: string, targetPath: string) {
	// First get the directory listing
	const apiUrl = `https://api.github.com/repos/${TEMPLATES_REPO}/contents/templates/${TEMPLATES_SUBDIRECTORY}/${path.basename(targetPath)}`;
	const response = await fetch(apiUrl);

	if (!response.ok) {
		throw new Error(`Failed to fetch template files: ${response.statusText}`);
	}

	const files = (await response.json()) as any[];

	// Download each file
	for (const file of files) {
		if (file.type === "file") {
			const fileResponse = await fetch(file.download_url);
			const content = await fileResponse.text();
			fs.writeFileSync(path.join(targetPath, file.name), content);
		} else if (file.type === "dir") {
			const dirPath = path.join(targetPath, file.name);
			fs.mkdirSync(dirPath, { recursive: true });
			await downloadTemplateFiles(`${baseUrl}/${file.name}`, dirPath);
		}
	}
}
