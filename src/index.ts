import { command, subcommands, run, binary, string, option, positional, optional } from 'cmd-ts';
import { authenticateWithApiKey, login } from './utils/auth';
import { createSite, deleteSite, listSites, listVersions, rollbackSite, updateSite } from './utils/sites';
//@ts-ignore
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
      short: 'p',
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

const authCmd = command({
  name: 'auth',
  description: 'Authenticate using an API key',
  args: {
    key: option({
      type: optional(string),
      long: 'key',
      short: 'k',
      description: 'Your API key',
    }),
  },
  handler: async (args) => {
    await authenticateWithApiKey(args.key);
  },
});

const createCmd = command({
  name: 'create',
  description: 'Upload and create a new site on Orbiter',
  args: {
    path: positional({
      type: string,
      displayName: 'path',
      description: 'Path to your build directory (e.g., "dist" or "build") or index.html file',
    }),
    domain: option({
      type: string,
      long: 'domain',
      short: 'd',
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
  args: {
    domain: option({
      type: optional(string),
      long: 'domain',
      short: 'd',
      description: 'Filter by exact subdomain',
      defaultValue: undefined
    }),
  },
  handler: async (args) => {
    await listSites(args.domain);
  },
});

const versionsCmd = command({
  name: 'versions',
  description: 'List versions of your website',
  args: {
    domain: positional({
      type: string,
      displayName: 'domain',
      description: 'Subdomain for your site, <domain>.orbiter.website',
    }),
  },
  handler: async (args) => {
    await listVersions(args.domain);
  },
});

const rollbackCmd = command({
  name: 'rollback',
  description: 'Rollback a site to a previous version',
  args: {
    domain: positional({
      type: string,
      displayName: 'domain',
      description: 'Subdomain for your site, <domain>.orbiter.website',
    }),
    cid: positional({
      type: string,
      displayName: 'cid',
      description: 'CID of the version you want to roll back to. Use the `versions` command to fetch this information',
    }),
  },
  handler: async (args) => {
    await rollbackSite(args.domain, args.cid);
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
      type: optional(string),
      long: 'siteId',
      short: 's',
      description: 'ID of the target site',
      defaultValue: undefined
    }),
    domain: option({
      type: optional(string),
      long: 'domain',
      short: 'd',
      description: 'Domain of the target site',
      defaultValue: undefined
    }),
  },
  handler: async (args) => {
    if (!args.siteId && !args.domain) {
      console.log("Provide either the --siteId or the --domain of the site you want to update. Use orbiter list to see both of these!");
      return;
    }
    await updateSite(args.path, args.siteId, args.domain);
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
  version: '0.4.0',
  cmds: {
    login: loginCmd,
    auth: authCmd,
    create: createCmd,
    list: listCmd,
    update: updateCmd,
    versions: versionsCmd,
    rollback: rollbackCmd,
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
