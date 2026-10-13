# @guojinpeng/dsh-cost-meter

[English](README.md) | [简体中文](README.zh-CN.md)

This plugin shows estimated session and turn costs in DSH.
Use DSH 0.2.0-rc.2 or later.
Tests use DSH 0.2.0-rc.2.

## Install

1. Install the npm package:

```powershell
dsh plugin --profile web add -w @guojinpeng/dsh-cost-meter
```

2. Restart DSH.
3. Open **Plugins**.
4. Select **@guojinpeng/dsh-cost-meter** to change prices.

Replace `web` with your profile name.
If you used the old unscoped package, disable it before you install this package.

If the npm package is not available, download the scoped package from
[GitHub Releases](https://github.com/guojinpeng/dsh-cost-meter/releases).
Run this command in the download directory:

```powershell
dsh plugin --profile web add -w ./guojinpeng-dsh-cost-meter-0.1.2.tgz
```

Restart DSH.
Keep the downloaded file at the installation path.

## Features

- Shows session and completed-turn cost estimates.
- Shows a short initialization message while prices load.
- Shows input, output, cache-read and cache-write cost details.
- Groups used models by provider. The list comes from DSH session history.
- Supports separate prices for each full `provider/model` name.
- Gets initial prices from models.dev. Uses the local catalog cache first.
- Syncs only configured models. Asks for confirmation before prices are overwritten.
- Matches source prices by model ID. Prefers the manufacturer's usage-based price. Keeps existing prices if matching is unclear.
- Keeps existing prices when the source cannot supply a supported rate.
- Uses USD per million tokens for model prices. Supports USD and CNY cost display.
- Updates cost estimates after you save or sync prices.
- Supports price reset and separate session/turn visibility controls.
- Stores configuration at `~/.dsh/guojinpeng/dsh-cost-meter/config.json`. Uses `DSH_HOME` when set.
- Copies the old `~/.dsh/dsh-cost-meter/config.json` on first start if the new file does not exist. Keeps the old file.
- Uses isolated plugin, client, API, projection, style and configuration identifiers.

These screenshots use example model prices. They do not show a billing statement.

Session cost details:

![Session cost card](docs/images/session-cost.png)

Turn cost details:

![Turn cost card](docs/images/turn-cost.png)

Model price settings:

![Model price settings on desktop](docs/images/model-prices-desktop.png)

## Develop From Source

Install Node.js, pnpm 9 and Git. Install DSH globally before you run the tests:

```powershell
npm install -g @deepseek-ai/dsh@0.2.0-rc.2
git clone https://github.com/guojinpeng/dsh-cost-meter.git
cd dsh-cost-meter
pnpm install --frozen-lockfile
```

Edit files in `src/`. Run tests and create a package:

```powershell
npm test
npm run build
npm pack
```

`npm pack` also runs the build. It creates `guojinpeng-dsh-cost-meter-<version>.tgz`.
Install the generated file in your DSH profile. For version 0.1.2:

```powershell
dsh plugin --profile web add -w ./guojinpeng-dsh-cost-meter-0.1.2.tgz
```

Restart DSH and check the plugin. Repeat the build, package and install steps after changes.
Tests use the global DSH installation. Set `DSH_RUNTIME_ROOT` to the DSH package directory if its location is different.
Commit source files and `pnpm-lock.yaml`. Do not commit generated files or local configuration.

## Publish To npm

Use an npm account with publish access to `@guojinpeng/dsh-cost-meter`.
Run these commands in the project directory:

```powershell
npm login --registry=https://registry.npmjs.org/
npm whoami --registry=https://registry.npmjs.org/
npm view @guojinpeng/dsh-cost-meter version --registry=https://registry.npmjs.org/
```

An unpublished package can return `E404` from `npm view`.
For an update, choose a version that is newer than the published version.
Update `package.json`. You can use this command to increase the patch version without creating a Git tag:

```powershell
npm version patch --no-git-tag-version
pnpm install --lockfile-only
npm test
npm pack --dry-run
```

Check the file list from `npm pack --dry-run`. Then publish the public package:

```powershell
npm publish --access public --registry=https://registry.npmjs.org/
npm view @guojinpeng/dsh-cost-meter version --registry=https://registry.npmjs.org/
```

Complete npm's authentication steps when prompted.
Each package version can be published only once.
Commit and push the version change. Create the matching Git tag and GitHub Release.

Users can then install the package:

```powershell
dsh plugin --profile web add -w @guojinpeng/dsh-cost-meter
```
