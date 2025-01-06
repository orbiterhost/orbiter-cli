## orbiter-cli

A CLI for creating and managing static sites on [Orbiter](https://orbiter.host)

> [!WARNING]
> README is still a work in progress

Before installing make sure you already have an account; sign up at [app.orbiter.host](https://orbiter.host). 

## Installation 

The orbiter-cli is an NPM package you can download with manager of choice. 

```
npm i -g orbiter-cli
```

Confirm that it was installed successfully by running the main command

```
orbiter
```

## Usage 

Running the `orbiter` command will reveal the available subcommands

```
orbiter
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

Start by running `login` including your `--provider` of choice (`googlr` or `github`)

```
orbiter login --provider google
```

After logging in you can inspect instructions for other commands by using `orbiter <subcommand> --help`

