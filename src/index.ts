process.removeAllListeners('warning');
process.on('warning', (warning) => {
  if (warning.name === 'DeprecationWarning' && warning.message.includes('punycode')) {
    return;
  }
  if (warning.name === 'ExperimentalWarning' && warning.message.includes('ES Module')) {
    return;
  }
  console.warn(warning.name, warning.message);
});

import { Command } from 'commander'
import { login } from './utils/auth';
import { createSite, deleteSite, listSites, updateSite } from './utils/sites';

async function main() {

  const program = new Command()

  program
    .name('orbiter')
    .description('Upload and deploy static sites with Orbiter.host')
    .version('0.0.3')

  program
    .command('login')
    .description('Login with OAuth')
    .option('-p, --provider <github | google>', 'Choose the OAuth provider you want to login with')
    .action(async (options) => {
      if (!options.provider) {
        console.log("Please select a provider: `orbiter login --provider <github | google>`")
        return
      }
      await login(options.provider)
    });

  program
    .command("create")
    .description("Upload and create a new site on Orbiter")
    .argument('<path>', 'Path to your build directory (e.g., "dist" or "build")')
    .option('-d, --domain <domain>', 'Custom domain')
    .action(async (path, options) => {
      if (!options.domain) {
        console.log("Please provide a domain: `orbiter create --domain <your subdomain> /path/to/build/folder`")
        return
      }
      if (!path) {
        console.log("Please provide a path to the site folder or file you want to upload")
        return
      }
      await createSite(path, options.domain)
    })

  program
    .command("list")
    .description("List existing sites for your account")
    .action(async () => {
      await listSites()
    })

  program
    .command("update")
    .description("Update a site with a new file or folder")
    .argument('<path>', 'Path to your build directory (e.g., "dist" or "build")')
    .option('-s, --siteId <siteId>', 'ID of the tartget site')
    .action(async (path, options) => {
      if (!options.siteId) {
        console.log("Please provide the site ID you want to update (use `orbiter list` to see your sites): `orbiter update --sideId <siteId> /path/to/folder`")
        return
      }
      if (!path) {
        console.log("Please provide a path to the site folder or file you want to upload")
        return
      }
      await updateSite(options.siteId, path)
    })

  program
    .command("delete")
    .description("Delete an existing site")
    .argument('<siteId>', 'The ID of the target site to delete')
    .action(async (siteId) => {
      if (!siteId) {
        console.log("Please provide the ID of the site you want to delete (use `orbiter list` to see your sites)")
      }
      await deleteSite(siteId)
    })

  program.parse()
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
