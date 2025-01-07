## orbiter-cli

![cover](https://orbiter.host/og.png)

A CLI for creating and managing static sites on [Orbiter](https://orbiter.host)

> [!WARNING]
> README is still a work in progress

Before installing make sure you already have an account; sign up at [app.orbiter.host](https://orbiter.host).

## Installation

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
- create - Upload and create a new site on Orbiter
- list - List existing sites for your account
- update - Update a site with a new file or folder
- delete - Delete an existing site

For more help, try running `orbiter <subcommand> --help`
```

### `login`

Start by running `login` including your `--provider` (shorthand `-p`) of choice (`google` or `github`)

```
orbiter login --provider google
```

### `create`

Uploads and create a new site on Orbiter. Must include the `--domain` or `-d` for the default subdomain of the site. After providing a name give the path to the file or folder of the website you are creating, must contain an `index.html` file.

```
orbiter create --domain mysite ./dist
```

After sucessfull creation the CLI will return the URL of the new site.

```
Site created: https://mysite.orbiter.website
```

### `list`

List all sites currently on your Orbiter account. You can filter by domain with `-d` followed by the subdomain of the site.

> [!TIP]
> Use this command to get the site ID for a site you want to update

```
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

```
orbiter update --siteId a5dae6af-ad43-4bb3-bdab-3a4d41b573cc ./new-dist

orbiter update --domain astro-demo ./new-dist
```

### `delete`

Delete an existing site using the site ID which can be obtained by using `orbiter list`

```
orbiter delete bac0b100-1f5f-4c64-8cfa-a8ae9b22671
```

## Contact

If you have any issues or questions feel free to reach out!

[steve@orbiter.host](mailto:steve@orbiter.host)
