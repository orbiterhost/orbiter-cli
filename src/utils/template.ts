import fs from 'fs';
import path from 'path';
import os from 'os';
import ora from 'ora';
import { exec } from 'child_process';
import { promisify } from 'util';
import fetch from 'node-fetch';
import inquirer from 'inquirer';

const execAsync = promisify(exec);

// Configuration
const TEMPLATES_REPO = 'orbiterhost/orbiter-templates';
const TEMPLATES_REPO_URL = 'https://github.com/orbiterhost/orbiter-templates';
const TEMPLATES_RAW_URL = 'https://raw.githubusercontent.com/orbiterhost/orbiter-templates/main';
const TEMPLATES_CACHE_DIR = path.join(os.homedir(), '.orbiter', 'templates');
const TEMPLATES_SUBDIRECTORY = 'mini-apps';


interface TemplateOptions {
  appName?: string;
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
async function fetchTemplate(templateName: string): Promise<string> {
  const spinner = ora(`Fetching template: ${templateName}`).start();

  // Create cache directory if it doesn't exist
  fs.mkdirSync(TEMPLATES_CACHE_DIR, { recursive: true });

  const localTemplatePath = path.join(TEMPLATES_CACHE_DIR, templateName);
  const cacheMetaPath = path.join(localTemplatePath, '.cache-meta.json');

  // Check if we need to fetch or update
  const needsFetch = !fs.existsSync(localTemplatePath) ||
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
          `git clone --depth=1 --single-branch --no-tags https://github.com/${TEMPLATES_REPO}.git ${tempDir}`
        );

        // Copy only the needed template to the final location
        const templateSourcePath = path.join(tempDir, 'templates', TEMPLATES_SUBDIRECTORY, templateName);
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
        JSON.stringify({
          fetchedAt: new Date().toISOString(),
          templateName,
          source: TEMPLATES_REPO_URL
        }, null, 2)
      );

      spinner.succeed(`Downloaded template: ${templateName}`);
    } else {
      spinner.succeed(`Using cached template: ${templateName}`);
    }

    return localTemplatePath;
  } catch (error) {
    spinner.fail(`Failed to fetch template: ${templateName}`);
    console.error('Error details:', error);

    // If degit fails, try suggesting available templates
    try {
      const templates = await listAvailableTemplates();
      console.log('\nAvailable templates:');
      templates.forEach(t => console.log(`  - ${t}`));
    } catch (e) {
      // Silently fail the suggestions
    }

    throw new Error(`Template '${templateName}' not found or couldn't be fetched`);
  }
}

function isCacheStale(metaPath: string): boolean {
  try {
    const metadata = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
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
    const response = await fetch(`https://api.github.com/repos/${TEMPLATES_REPO}/contents/templates/${TEMPLATES_SUBDIRECTORY}`);

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.statusText}`);
    }

    const data = await response.json() as { name: string, type: string }[];

    // Filter for directories only
    return data
      .filter(item => item.type === 'dir')
      .map(item => item.name);

  } catch (error) {
    console.error('Error fetching template list:', error);
    throw error;
  }
}
/**
 * Fetch template metadata
 */
export async function getTemplateMetadata(templateName: string): Promise<TemplateMetadata | null> {
  try {
    const metadataUrl = `${TEMPLATES_RAW_URL}/templates/${TEMPLATES_SUBDIRECTORY}/${templateName}/template.json`;
    const response = await fetch(metadataUrl);

    if (!response.ok) {
      return null;
    }

    return await response.json() as TemplateMetadata;
  } catch (error) {
    return null;
  }
}
/**
 * Creates a new project from a template
 */
export async function createInteractiveMiniApp(providedName?: string) {
  const spinner = ora().start('Setting up your Farcaster Mini App');
  let projectName = providedName as string;

  try {
    // Get project name
    if (!projectName) {
      spinner.stop();
      const answer = await inquirer.prompt([{
        type: 'input',
        name: 'projectName',
        message: 'What would you like to name your project?',
        validate: (input) => input.length > 0 || 'Project name is required'
      }]);
      projectName = answer.projectName;
      spinner.start('Setting up your Farcaster Mini App');
    }

    // Get frame name
    spinner.stop();
    const { appName } = await inquirer.prompt([{
      type: 'input',
      name: 'appName',
      message: 'What should your Mini App be called?',
      default: projectName,
      validate: (input) => input.length > 0 || 'Mini App name is required'
    }]);

    // Get domain
    const { domain } = await inquirer.prompt([{
      type: 'input',
      name: 'domain',
      message: 'Choose a subdomain for your app (yourname.orbiter.website):',
      default: projectName.toLowerCase().replace(/\s+/g, '-'),
      validate: (input) => {
        if (input.length === 0) return 'Subdomain is required';
        if (input.includes('.')) return 'Please enter only the subdomain part (without .orbiter.website)';
        if (!/^[a-z0-9-]+$/.test(input)) return 'Subdomain can only contain lowercase letters, numbers, and hyphens';
        return true;
      }
    }]);

    // Choose template
    spinner.text = 'Fetching available templates...';
    spinner.start();
    const templates = await listAvailableTemplates();
    spinner.stop();

    // Filter templates - prefer frame templates, but fallback to all if none found
    if (templates.length === 0) {
      throw new Error('No templates found. Please check your internet connection or try again later.');
    }

    const { template } = await inquirer.prompt([{
      type: 'list',
      name: 'template',
      message: 'Select a template:',
      choices: templates.map(t => ({ name: t, value: t }))
    }]);

    // Create the project
    spinner.text = `Creating project with ${template} template...`;
    spinner.start();
    const targetDir = path.join(process.cwd(), projectName);

    // Get the template directory
    const templateDir = await fetchTemplate(template);

    // Create target directory
    fs.mkdirSync(targetDir, { recursive: true });

    // Copy template files with modifications
    copyTemplateFilesRecursive(templateDir, targetDir, {
      appName,
      domain
    });

    // Install dependencies
    spinner.text = 'Installing dependencies...';
    await execAsync('npm install', { cwd: targetDir });
    spinner.succeed('Project created and dependencies installed');

    // Deploy the project
    spinner.text = 'Preparing to deploy...';
    spinner.start();

    // Create orbiter.json for deployment
    const orbiterConfig = {
      domain,
      buildCommand: 'npm run build',
      buildDir: 'dist' // Adjust based on common template output dirs
    };

    fs.writeFileSync(
      path.join(targetDir, 'orbiter.json'),
      JSON.stringify(orbiterConfig, null, 2)
    );

    let buildError: any

    // Run build and deploy
    spinner.text = 'Building project...';
    try {
      await execAsync('npm install && npm run build', { cwd: targetDir });

      spinner.text = 'Deploying to Orbiter...';
      await execAsync('npx orbiter-cli deploy', { cwd: targetDir });

      spinner.succeed(`🚀 Mini App deployed successfully to https://${domain}.orbiter.website`);
    } catch (buildError) {
      spinner.warn(`Build or deploy encountered an issue, but your project has been created.`);
      console.error('Error details:', buildError);
    }

  } catch (error) {
    spinner.fail('Failed to create Mini App');
    console.error('Error:', error);
  }
}
/**
 * Recursively copy template files to target directory with modifications
 */
function copyTemplateFilesRecursive(source: string, target: string, options: TemplateOptions) {
  // Get all items in the source directory
  const items = fs.readdirSync(source);

  for (const item of items) {
    // Skip cache metadata and template metadata
    if (item === '.cache-meta.json' || item === 'template.json') {
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
function processAndCopyFile(sourcePath: string, targetPath: string, options: TemplateOptions) {
  const content = fs.readFileSync(sourcePath, 'utf8');

  // Special handling for specific files
  if (sourcePath.endsWith('index.html')) {
    const processedContent = processIndexHtml(content, options);
    fs.writeFileSync(targetPath, processedContent);
  }
  else if (sourcePath.endsWith('farcaster.json')) {
    const processedContent = processFarcasterJson(content, options);
    fs.writeFileSync(targetPath, processedContent);
  }
  else if (sourcePath.endsWith('package.json')) {
    const processedContent = processPackageJson(content, options);
    fs.writeFileSync(targetPath, processedContent);
  }
  else {
    // Copy file as is for all other files
    fs.copyFileSync(sourcePath, targetPath);
  }
}

/**
 * Process index.html template
 */
function processIndexHtml(content: string, options: TemplateOptions): string {
  const domain = options.domain ? `${options.domain}.orbiter.website` : 'your-app.orbiter.website';
  const frameName = options.appName || 'Orbiter App';

  // Create proper frame meta content without extra spaces
  const frameContent = `<meta name="fc:frame" content='{"version":"next","imageUrl":"https://${domain}/image.png","button":{"title":"Launch","action":{"type":"launch_frame","name":"${frameName}","url":"https://${domain}","splashImageUrl":"https://${domain}/splash.png","splashBackgroundColor":"#ffffff"}}}' />`;

  // Replace existing meta tag or add it if not present
  if (content.includes('<meta name="fc:frame"')) {
    return content.replace(
      /<meta name="fc:frame"[^>]*>/,
      frameContent
    );
  } else {
    // If no fc:frame meta tag exists, add it before the title or before the closing head tag
    if (content.includes('<title>')) {
      return content.replace(
        /(<title>)/,
        `${frameContent}\n      $1`
      );
    } else {
      return content.replace(
        /<\/head>/,
        `  ${frameContent}\n    </head>`
      );
    }
  }
}
/**
 * Process farcaster.json template
 */
function processFarcasterJson(content: string, options: TemplateOptions): string {
  const domain = options.domain ? `${options.domain}.orbiter.website` : 'your-app.orbiter.website';
  const frameName = options.appName || 'Orbiter App';

  try {
    const farcasterConfig = JSON.parse(content);

    // Update frame configuration
    if (farcasterConfig.frame) {
      farcasterConfig.frame.name = frameName;
      farcasterConfig.frame.homeUrl = `https://${domain}`;
      farcasterConfig.frame.iconUrl = `https://${domain}/icon.png`;
      farcasterConfig.frame.imageUrl = `https://${domain}/image.png`;
      farcasterConfig.frame.splashImageUrl = `https://${domain}/splash.png`;
    }

    return JSON.stringify(farcasterConfig, null, 2);
  } catch (error) {
    console.warn('Error processing farcaster.json, using original');
    return content;
  }
}

/**
 * Process package.json template
 */
function processPackageJson(content: string, options: TemplateOptions): string {
  try {
    const packageJson = JSON.parse(content);

    // Use project name for package name
    if (options.appName) {
      packageJson.name = options.appName.toLowerCase().replace(/\s+/g, '-');
    }

    return JSON.stringify(packageJson, null, 2);
  } catch (error) {
    console.warn('Error processing package.json, using original');
    return content;
  }
}

/**
 * Update all cached templates
 */
export async function updateCachedTemplates(): Promise<void> {
  const spinner = ora('Updating template cache...').start();

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
    spinner.fail('Failed to update templates');
    console.error('Error:', error);
  }
}

async function downloadTemplateFiles(baseUrl: string, targetPath: string) {
  // First get the directory listing
  const apiUrl = `https://api.github.com/repos/${TEMPLATES_REPO}/contents/templates/${TEMPLATES_SUBDIRECTORY}/${path.basename(targetPath)}`;
  const response = await fetch(apiUrl);

  if (!response.ok) {
    throw new Error(`Failed to fetch template files: ${response.statusText}`);
  }

  const files = await response.json() as any[];

  // Download each file
  for (const file of files) {
    if (file.type === 'file') {
      const fileResponse = await fetch(file.download_url);
      const content = await fileResponse.text();
      fs.writeFileSync(path.join(targetPath, file.name), content);
    } else if (file.type === 'dir') {
      const dirPath = path.join(targetPath, file.name);
      fs.mkdirSync(dirPath, { recursive: true });
      await downloadTemplateFiles(`${baseUrl}/${file.name}`, dirPath);
    }
  }
}
