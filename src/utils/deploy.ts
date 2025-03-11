import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import inquirer from 'inquirer';
import ora from 'ora';
import { listSites, createSite, updateSite } from './sites';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface OrbiterConfig {
  siteId?: string;
  domain: string;
  buildCommand: string;
  buildDir: string;
}

interface DeploymentOptions {
  domain?: string;
  siteId?: string;
  buildCommand?: string;
  buildDir?: string;
}

async function createNewDeployment(options?: DeploymentOptions): Promise<OrbiterConfig> {
  let siteId = options?.siteId;
  let domain = options?.domain;
  let buildCommand = options?.buildCommand;
  let buildDir = options?.buildDir;

  if (siteId && !domain) {
    const sites = await listSites();
    const site = sites?.data?.find((site: any) => site.id === siteId);
    if (site) {
      domain = site.domain.replace('.orbiter.website', '');
    } else {
      throw new Error(`No site found with ID: ${siteId}`);
    }
  }

  if (!siteId && !domain) {
    // Get list of existing sites
    const sites = await listSites();
    const siteChoices = sites?.data?.map((site: any) => ({
      name: `${site.domain} (${site.id})`,
      value: { id: site.id, domain: site.domain }
    })) || [];

    const { action } = await inquirer.prompt([{
      type: 'list',
      name: 'action',
      message: 'Would you like to:',
      choices: [
        { name: 'Create new site', value: 'new' },
        ...(siteChoices.length ? [{ name: 'Link to existing site', value: 'existing' }] : [])
      ]
    }]);

    if (action === 'existing') {
      const { site } = await inquirer.prompt([{
        type: 'list',
        name: 'site',
        message: 'Select a site to link:',
        choices: siteChoices
      }]);
      siteId = site.id;
      domain = site.domain.replace('.orbiter.website', '');
    } else {
      const { newDomain } = await inquirer.prompt([{
        type: 'input',
        name: 'newDomain',
        message: 'Enter a subdomain for your new site:',
        validate: (input) => input.length > 0 || 'Domain is required'
      }]);
      domain = newDomain;
    }
  }

  if (!buildCommand) {
    const { buildCommand: cmd } = await inquirer.prompt([{
      type: 'input',
      name: 'buildCommand',
      message: 'Enter build command:',
      default: 'npm run build'
    }]);
    buildCommand = cmd;
  }

  if (!buildDir) {
    const { buildDir: dir } = await inquirer.prompt([{
      type: 'input',
      name: 'buildDir',
      message: 'Enter build directory:',
      default: 'dist'
    }]);
    buildDir = dir;
  }

  const config: OrbiterConfig = {
    siteId,
    domain: domain!,
    buildCommand: buildCommand!,
    buildDir: buildDir!
  };

  fs.writeFileSync('orbiter.json', JSON.stringify(config, null, 2));
  return config;
}

export async function deploySite(options?: DeploymentOptions) {
  const spinner = ora();
  try {
    const configPath = path.join(process.cwd(), 'orbiter.json');
    let config: OrbiterConfig;

    if (fs.existsSync(configPath) &&
      (!options ||
        !(options.domain || options.siteId || options.buildCommand || options.buildDir))) {
      spinner.start('Reading configuration...');
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      spinner.succeed('Configuration loaded');
    } else {
      spinner.info('No configuration found or options provided. Starting setup...');
      config = await createNewDeployment(options);
      spinner.succeed('Configuration created');
    }

    // Run build command
    spinner.start(`Running build command: ${config.buildCommand}`);
    await execAsync(config.buildCommand);
    spinner.succeed('Build completed');

    // Deploy
    if (config.siteId) {
      spinner.start(`Updating existing site: ${config.domain}.orbiter.website`);
      await updateSite(config.buildDir, config.siteId, undefined, true);
      spinner.succeed(`Site updated: https://${config.domain}.orbiter.website`);
    } else {
      spinner.start(`Creating new site: https://${config.domain}.orbiter.website`);
      await createSite(config.buildDir, config.domain, true);

      // Update config with new site ID
      const sites = await listSites(config.domain, false);
      if (sites?.data?.[0]?.id) {
        config.siteId = sites.data[0].id;
        fs.writeFileSync('orbiter.json', JSON.stringify(config, null, 2));
      }
      spinner.succeed(`Site deployed: https://${config.domain}.orbiter.website`);
    }
  } catch (error) {
    spinner.fail('Deployment failed');
    console.error('Error:', error);
  }
}
