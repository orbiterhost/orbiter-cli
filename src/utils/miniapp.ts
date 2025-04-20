import fs from 'fs';
import path from 'path';
import os from 'os';
import ora from 'ora';
import { exec } from 'child_process';
import { promisify } from 'util';
import fetch from 'node-fetch';
import inquirer from 'inquirer';
import { getValidTokens } from './auth';
import { API_URL } from '../config';
import { deploySite } from './deploy';
const SOURCE = process.env.SOURCE || "cli"

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
async function fetchTemplate(templateName: string, parentSpinner?: ora.Ora): Promise<string> {
  const spinner = parentSpinner || ora(`Fetching template: ${templateName}`).start();

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
  const spinner = ora('Setting up your Farcaster Mini App').start();
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

    // Get frame name and domain - stop spinner during prompts
    spinner.stop();
    const { appName } = await inquirer.prompt([{
      type: 'input',
      name: 'appName',
      message: 'What should your Mini App be called?',
      default: projectName,
      validate: (input) => input.length > 0 || 'Mini App name is required'
    }]);

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
    const templateDir = await fetchTemplate(template, spinner);

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

    // Save the current working directory
    const originalCwd = process.cwd();

    try {
      // Change to the target directory
      process.chdir(targetDir);

      // Deploy directly using the deploySite function
      spinner.text = 'Deploying to Orbiter...';
      spinner.start();
      // Pass the existing spinner to deploySite
      await deploySite({
        domain: domain,
        buildCommand: 'npm run build',
        buildDir: 'dist',
        spinner: spinner // Pass the spinner
      });

      let deployedSiteId;
      try {
        const tokens = await getValidTokens();
        if (!tokens) {
          throw new Error('Authorization required. Please login first.');
        }

        const siteReq = await fetch(`${API_URL}/sites?domain=${domain}`, {
          method: "GET",
          headers: {
            "Source": `${SOURCE}`,
            "Content-Type": "application/json",
            ...(tokens.keyType === 'apikey'
              ? { "X-Orbiter-API-Key": `${tokens.access_token}` }
              : { "X-Orbiter-Token": tokens.access_token })
          },
        });

        const siteData: any = await siteReq.json();

        if (!siteReq.ok) {
          throw new Error(`Problem retrieving site data: ${JSON.stringify(siteData)}`);
        }

        if (!siteData || !siteData.data || siteData.data.length === 0) {
          throw new Error(`Could not find deployed site for domain ${domain}`);
        }

        deployedSiteId = siteData.data[0].id;
      } catch (error) {
        spinner.fail('Could not retrieve site information');
        throw error;
      }

      // Check for farcaster.json first before showing any farcaster-related messages
      const farcasterConfigPath = path.join(targetDir, 'public/.well-known/farcaster.json');
      if (fs.existsSync(farcasterConfigPath)) {
        try {
          await setupFarcasterAccountAssociation(deployedSiteId, farcasterConfigPath);

          await deploySite({
            domain: domain,
            siteId: deployedSiteId,
            buildCommand: 'npm run build',
            buildDir: 'dist',
            spinner: spinner
          });
        } catch (associationError) {
          // Just continue without showing error - we'll still have a working deployment
          spinner.text = 'Finishing deployment...';
        }
      }

      // Final success message
      spinner.succeed(`🚀 Mini App deployed successfully to https://${domain}.orbiter.website`);
    } finally {
      // Restore the original working directory
      process.chdir(originalCwd);
    }
  } catch (error) {
    spinner.fail('Failed to create Mini App');
    console.error('Error:', error);
  }
}

//  Recursively copy template files to target directory with modifications
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

export async function setupFarcasterAccountAssociation(
  siteId: string,
  configPath: string = './public/.well-known/farcaster.json',
): Promise<boolean> {

  try {
    // Check if site ID is valid
    if (!siteId) {
      const error = new Error('Cannot setup account association: Site ID is missing or undefined');
      throw error;
    }

    // Check if config file exists
    if (!fs.existsSync(configPath)) {
      const error = new Error(`Cannot setup account association: Config file not found at ${configPath}`);
      throw error;
    }

    // Get tokens for authentication
    const tokens = await getValidTokens();
    if (!tokens) {
      const error = new Error('Cannot setup account association: Authorization required. Please login first.');
      throw error;
    }

    try {
      const accountAssociationReq = await fetch(`${API_URL}/farcaster/account_association/${siteId}`, {
        method: "POST",
        headers: {
          "Source": `${SOURCE}`,
          "Content-Type": "application/json",
          ...(tokens.keyType === 'apikey'
            ? { "X-Orbiter-API-Key": `${tokens.access_token}` }
            : { "X-Orbiter-Token": tokens.access_token })
        },
      });

      // Handle API errors with detailed information
      if (!accountAssociationReq.ok) {
        let errorDetail = `Status: ${accountAssociationReq.status} ${accountAssociationReq.statusText}`;

        try {
          const errorData = await accountAssociationReq.json();
          errorDetail += `, Response: ${JSON.stringify(errorData)}`;
        } catch (e) {
          errorDetail += `, Response: Could not parse JSON response`;
        }

        const error = new Error(`Account association API call failed. ${errorDetail}`);
        throw error;
      }

      // Parse the response
      let associationData;
      try {
        associationData = await accountAssociationReq.json();
        if (!associationData) {
          const error = new Error('API returned empty response for account association');
          throw error;
        }
      } catch (jsonError: any) {
        const error = new Error(`Failed to parse API response: ${jsonError.message}`);
        throw error;
      }

      let farcasterConfig;
      try {
        const fileContent = fs.readFileSync(configPath, 'utf8');
        farcasterConfig = JSON.parse(fileContent);
      } catch (readError: any) {
        const error = new Error(`Failed to read or parse farcaster.json: ${readError.message}`);
        throw error;
      }

      // Handle the response data structure
      if (associationData && typeof associationData === 'object' && 'accountAssociation' in associationData) {
        farcasterConfig.accountAssociation = associationData.accountAssociation;
      } else {
        farcasterConfig.accountAssociation = associationData;
      }

      try {
        fs.writeFileSync(configPath, JSON.stringify(farcasterConfig, null, 2));
      } catch (writeError: any) {
        const error = new Error(`Failed to write updated farcaster.json: ${writeError.message} `);
        throw error;
      }

      return true;

    } catch (apiError: any) {
      throw new Error(`Failed to set up account association with API: ${apiError.message} `);
    }

  } catch (error: any) {

    throw new Error(`Account association setup failed: ${error.message} `);
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
