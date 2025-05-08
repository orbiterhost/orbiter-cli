## orbiter-cli

![cover](https://orbiter.host/og.png)

A CLI for creating and managing static sites on [Orbiter](https://orbiter.host)

Before installing make sure you already have an account; sign up at [app.orbiter.host](https://orbiter.host).

## Installation

> [!NOTE]
> If you are using Windows please be sure to use [WSL](https://learn.microsoft.com/en-us/windows/wsl/install) as the CLI does not have native support for Windows.

The orbiter-cli is an NPM package you can download with manager of choice.

```bash
npm i -g orbiter-cli
```

Confirm that it was installed successfully by running the main command

```bash
orbiter
```

## Usage

Running the `orbiter` command will reveal the available subcommands

```bash
orbiter <subcommand>
> Upload and deploy static sites with Orbiter.host

where <subcommand> can be one of:

- login - Login with OAuth
- auth - Authenticate using an API key
- create - Upload and create a new site on Orbiter
- list - List existing sites for your account
- update - Update a site with a new file or folder
- versions - List versions of your website
- rollback - Rollback a site to a previous version
- delete - Delete an existing site
- deploy - Deploy your site using configuration from orbiter.json or create new deployment
- miniapp - Create a new Farcaster Mini App ready to deploy
- new - Create a new app ready to deploy

For more help, try running `orbiter <subcommand> --help`
```

### `login`

Start by running `login` including your `--provider` (shorthand `-p`) of choice (`google` or `github`)

```bash
orbiter login
> Login with OAuth

OPTIONS:
  --provider, -p <str> - Choose the OAuth provider you want to login with (github | google)

FLAGS:
  --help, -h - show help

USAGE:
orbiter login --provider google
```

### `auth`

An alternative way to authenticate the CLI is with an Orbiter API key. This can be obtained at [app.orbiter.host/api-keys](https://app.orbiter.host/api-keys). You can either just run `orbiter auth` and it will prompt you for the key and not display it visibly, or if you're using the CLI in an automation you can use the `--key` flag.

:::tip
Orbiter will also look for the enviornment variable `ORBITER_API_KEY` for an API key to authorize the CLI
:::

```bash
orbiter auth
> Authenticate using an API key

OPTIONS:
  --key, -k <str> - Your API key [optional]

FLAGS:
  --help, -h - show help

USAGE:

orbiter auth # Will prompt you for the key

orbiter auth --key <YOUR_API_KEY> # Will bypass the prompt and authorize
```

### `new`

In just one command create a new project through an available template and deploy

```bas
orbiter new
> Create a new app ready to deploy

ARGUMENTS:
  [name] - Name of the new project [optional]

FLAGS:
  --help, -h - show help
```

### `deploy`

A one stop shop command to deploy your Orbiter site, whether it's brand new or updating an existing one. Running this command by itself will give you prompts to setup your site and save the configuration to an `orbiter.json` file in the root of your project directory. The command also includes flags if you want to bypass the prompts.

```bash
orbiter deploy
> Deploy your site using configuration from orbiter.json or create new deployment

OPTIONS:
  --domain, -d <str>       - Domain for the site [optional]
  --siteId, -s <str>       - ID of existing site [optional]
  --buildCommand, -b <str> - Build command to run [optional]
  --buildDir, -o <str>     - Output directory for build [optional]

FLAGS:
  --help, -h - show help

USAGE:

orbiter deploy
```

### `create`

Uploads and create a new site on Orbiter. Must include the `--domain` or `-d` for the default subdomain of the site. After providing a name give the path to the file or folder of the website you are creating, must contain an `index.html` file.

```bash
orbiter create
> Upload and create a new site on Orbiter

ARGUMENTS:
  <path> - Path to your build directory (e.g., "dist" or "build") or index.html file

OPTIONS:
  --domain, -d <str> - Custom domain

FLAGS:
  --help, -h - show help

USAGE:

orbiter create --domain mysite ./dist
```

After sucessfull creation the CLI will return the URL of the new site.

```
Site created: https://mysite.orbiter.website
```

### `list`

List all sites currently on your Orbiter account. You can filter by domain with `-d` followed by the subdomain of the site.

```bash
orbiter list
> List existing sites for your account

OPTIONS:
  --domain, -d <str> - Filter by exact subdomain [optional]

FLAGS:
  --help, -h - show help

USAGE:

orbiter list
```

This will return the following JSON response from the API:

```typescript
{
  data: [
    {
      id: 'string',
      created_at: 'string',
      organization_id: 'string',
      cid: 'string',
      domain: 'string',
      site_contract: 'string',
      updated_at: 'string',
      deployed_by: 'string',
      custom_domain: 'string',
      domain_ownership_verified: boolean,
      ssl_issued: boolean
    }
  ]
}
```

### `update`

Update an existing site with a file or folder. You can target a site with either the `--siteId | -s` or the `--domain | -d` (subdomain) followed by the updated folder or file. Both the subdomain and site ID can be found by using `orbiter list`.

```bash
orbiter update
> Update a site with a new file or folder

ARGUMENTS:
  <path> - Path to your build directory (e.g., "dist" or "build")

OPTIONS:
  --siteId, -s <str> - ID of the target site [optional]
  --domain, -d <str> - Domain of the target site [optional]

FLAGS:
  --help, -h - show help

USAGE:

orbiter update --siteId a5dae6af-ad43-4bb3-bdab-3a4d41b573cc ./new-dist

orbiter update --domain astro-demo ./new-dist
```

### `versions`

:::note
Versions are only available on paid plans
:::

List previous versions of a site for a given subdomain, ie `<subdomain>.orbiter.website`. the `cid` listed in the response can be used in `rollback` to rollback a site to a previous version.

```bash
orbiter versions
> List versions of your website

ARGUMENTS:
  <domain> - Subdomain for your site, <domain>.orbiter.website

FLAGS:
  --help, -h - show help

USAGE:

orbiter versions <subdomain>
```

This will return the following object

```typescript
{
  data: [
    {
      id: 'string',
      site_id: 'string',
      created_at: 'string',
      organization_id: 'string',
      cid: 'string',
      domain: 'string',
      site_contract: 'string',
      version_number: number,
      deployed_by: 'string'
    },
  ]
}
```

### `rollback`

:::note
Rollbacks are only available on paid plans
:::

Rollback a site to a previous version using the `subdomain` and the `cid` of the previous version to update it. Use `versions` to get the previous versions for a site.

```bash
orbiter rollback
> Rollback a site to a previous version

ARGUMENTS:
  <domain> - Subdomain for your site, <domain>.orbiter.website
  <cid>    - CID of the version you want to roll back to. Use the `versions` command to fetch this information

FLAGS:
  --help, -h - show help

USAGE:

orbiter rollback <subdomain> <cid>
```

### `delete`

Delete an existing site using the site ID which can be obtained by using `orbiter list`

```bash
orbiter delete
> Delete an existing site

ARGUMENTS:
  <siteId> - The ID of the target site to delete

FLAGS:
  --help, -h - show help

USAGE:

orbiter delete bac0b100-1f5f-4c64-8cfa-a8ae9b22671
```

## Contact

If you have any issues or questions feel free to reach out!

[steve@orbiter.host](mailto:steve@orbiter.host)
