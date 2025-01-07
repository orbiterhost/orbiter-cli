import { command, subcommands, run, binary, string, option, positional } from 'cmd-ts';
import { login } from './utils/auth';
import { createSite, deleteSite, listSites, updateSite } from './utils/sites';
import figlet from "figlet"

const text =
  figlet.textSync("ORBITER", {
    font: "Univers",
    horizontalLayout: "default",
    verticalLayout: "default",
    width: 200,
    whitespaceBreak: true,
  })

const loginCmd = command({
  name: 'login',
  description: 'Login with OAuth',
  args: {
    provider: option({
      type: string,
      long: 'provider',
      description: 'Choose the OAuth provider you want to login with (github | google)',
    }),
  },
  handler: async (args) => {
    if (!args.provider) {
      console.log("Please select a provider: `orbiter login --provider <github | google>`");
      return;
    }
    await login(args.provider as 'github' | 'google');
  },
});

const createCmd = command({
  name: 'create',
  description: 'Upload and create a new site on Orbiter',
  args: {
    path: positional({
      type: string,
      displayName: 'path',
      description: 'Path to your build directory (e.g., "dist" or "build")',
    }),
    domain: option({
      type: string,
      long: 'domain',
      description: 'Custom domain',
    }),
  },
  handler: async (args) => {
    if (!args.domain) {
      console.log("Please provide a domain: `orbiter create --domain <your subdomain> /path/to/build/folder`");
      return;
    }
    await createSite(args.path, args.domain);
  },
});

const listCmd = command({
  name: 'list',
  description: 'List existing sites for your account',
  args: {},
  handler: async () => {
    await listSites();
  },
});

const updateCmd = command({
  name: 'update',
  description: 'Update a site with a new file or folder',
  args: {
    path: positional({
      type: string,
      displayName: 'path',
      description: 'Path to your build directory (e.g., "dist" or "build")',
    }),
    siteId: option({
      type: string,
      long: 'siteId',
      description: 'ID of the target site',
    }),
  },
  handler: async (args) => {
    if (!args.siteId) {
      console.log("Please provide the site ID you want to update (use `orbiter list` to see your sites): `orbiter update --sideId <siteId> /path/to/folder`");
      return;
    }
    await updateSite(args.siteId, args.path);
  },
});

const deleteCmd = command({
  name: 'delete',
  description: 'Delete an existing site',
  args: {
    siteId: positional({
      type: string,
      displayName: 'siteId',
      description: 'The ID of the target site to delete',
    }),
  },
  handler: async (args) => {
    if (!args.siteId) {
      console.log("Please provide the ID of the site you want to delete (use `orbiter list` to see your sites)");
      return;
    }
    await deleteSite(args.siteId);
  },
});

const cli = subcommands({
  name: 'orbiter',
  description: `\n ${text} \n Create and manage static sites with Orbiter. Get started by running orbiter login`,
  version: '0.1.2',
  cmds: {
    login: loginCmd,
    create: createCmd,
    list: listCmd,
    update: updateCmd,
    delete: deleteCmd,
  },
});

// Handle warning events
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

async function main() {
  try {
    await run(binary(cli), process.argv);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();
