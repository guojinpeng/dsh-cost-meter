# dsh-cost-meter

DSH session and turn cost estimates from token usage. Requires DSH 0.2.0-rc.2 or later; verified against 0.2.0-rc.2.

## Install From GitHub Release

Install DSH 0.2.0-rc.2 or later, download `dsh-cost-meter-0.1.2.tgz` from the
[GitHub Releases](https://github.com/guojinpeng/dsh-cost-meter/releases) page,
then run this command from the download directory:

```powershell
dsh plugin --profile web add -w ./dsh-cost-meter-0.1.2.tgz
```

Restart DSH. Replace `web` with your profile name. Keep the downloaded package
at that path while your profile references it as a local dependency.

## Build From Source

```powershell
pnpm install --frozen-lockfile
npm test
npm pack
dsh plugin --profile web add -w ./dsh-cost-meter-0.1.2.tgz
```

Restart DSH after installing. Use your actual profile name in place of `web`.
Tests use the globally installed DSH for peer dependencies. Set `DSH_RUNTIME_ROOT` to its package directory when using a different installation.

## Publish A Release

1. Update the version in `package.json` for each new release.
2. Run `pnpm install --frozen-lockfile`, `npm test`, and `npm pack`.
3. Commit source, documentation and `pnpm-lock.yaml`; omit `node_modules`, `dist`, local configuration and `.tgz` files.
4. Push to GitHub and create a tag matching the package version, such as `v0.1.2`.
5. Create a GitHub Release for the tag and upload the generated `.tgz` as a release asset. Source-only ZIP downloads do not contain the built plugin.

Publishing to npm is optional. The unscoped name `dsh-cost-meter` is already registered;
confirm ownership before publishing. A scoped package name requires updating the bundle
patch and client registration identifiers consistently before installation testing.
Do not publish changed contents under an existing version.

## Pricing

- Rates are USD per million tokens, matched by exact `provider/model`. There are no built-in prices or model aliases.
- Saving or syncing prices immediately recalculates all mounted session and turn chips. While initial pricing or a new model's pricing loads, chips show a lightweight initialization status.
- Each model is priced separately within a turn. Missing model attribution stays unpriced.
- The form groups historical models under provider headings, with indented model rows. Configuration keeps full `provider/model` keys. Missing prices initialize from models.dev; unmatched or ambiguous models start at zero. Reset sets all four prices to zero. The model-rate heading displays `USD / 1M tokens`, independent of the cost display currency.
- On first upgrade, existing bare-model rates migrate to historical routes. The previous configuration is backed up to `config.json.v0.1.1.bak` before migration. Unused price entries are removed after a successful complete history scan.
- models.dev is the only sync source. The complete API catalog is stored next to config.json at `data/models.dev.json`. First startup initializes the cache. New historical models use the cache first and fetch the API if no valid cache exists. Existing configured prices, including zero, are preserved during initialization.
- Source matching uses exact model IDs regardless of the local DSH provider. The manufacturer's pay-as-you-go offer is preferred, excluding subscription plans. Otherwise identical unambiguous offers may be used; conflicting offers retain existing prices. `A/model` and `B/model` receive the same selected source price, and users can edit their local rates independently.
- Sync asks for overwrite confirmation, fetches a fresh catalog, and updates only configured models using USD rates. Unmatched or ambiguous models, tiered or different reasoning rates, and invalid prices retain existing rates. Missing source cache prices retain existing cache prices. Changes made during sync cause a conflict rather than overwriting newer configuration.
- Configuration lives in `$DSH_HOME/dsh-cost-meter/config.json`, or `~/.dsh/dsh-cost-meter/config.json`.
- Projection state version 2 rebuilds older caches from session events. Turn disclosures retain roughly the latest 200 turns; session totals cover the full session.

## Configuration Access

The configuration page requires the DSH browser login cookie and uses DSH's Host/Origin trust checks. Open the authenticated URL printed by DSH. Remote access must also meet the host's binding and trusted-host configuration.

The HTTP configuration page requires `sessionQuery`, `webServer` and `connection`. Headless profiles still compute the projection. Desktop configuration access is not verified.
