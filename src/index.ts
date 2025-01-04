import { Command } from 'commander'
import { login } from './utils/auth';
import { uploadSite } from './utils/pinata';
import { createSite } from './utils/sites';

async function main() {

  const program = new Command()

  program
    .name('orbiter')
    .description('Upload and deploy static sites with Orbiter.host')
    .version('1.0.0')

  program
    .command('login')
    .description('Login with OAuth')
    .option('-p, --provider <github | google>', 'Choose the OAuth provider you want to login with')
    .action(async (options) => {
      await login(options.provider)
    });

  program
    .command("create")
    .description("Upload and create a new site on Orbiter")
    .argument('<path>', 'Path to your build directory (e.g., "dist" or "build")')
    .option('-d, --domain <domain>', 'Custom domain')
    .action(async (path, options) => {
      const upload = await uploadSite(path)
      await createSite(upload?.IpfsHash as string, options.domain)
    })


  program.parse()
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
