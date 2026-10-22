# @guojinpeng/dsh-cost-meter

[English](README.md) | [简体中文](README.zh-CN.md)

This plugin shows estimated session and turn costs in DSH.
Use DSH 0.2.0-rc.2 or later.
Tests use DSH 0.2.0-rc.2.

![Session and turn cost overview](docs/images/overview.png)

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

Install published versions from npm. npm provides the built package.
GitHub contains the source code and release notes.

## Features

- Shows session and completed-turn cost estimates. The session chip sits in the composer, and the turn chip follows the official turn usage pill, with the clock last. Both use the price tag icon.
- Adds a **Cost statistics** entry to the sidebar **Plugins** area. Select it to open the cost overview page.
- Shows a short initialization message when model prices are not ready.
- Groups the details by peak price, off-peak price and fixed price. Hides price rows that cost zero and shows no peak or off-peak token counts.
- The session panel groups the four prices by peak, off-peak and fixed price, then lists each model's group sums. The turn panel lists the four prices of every group for each model.
- Each price has an info button: hover it to see the calculation formula for that price. The popover closes when the pointer leaves.
- Groups used models by provider. The list comes from DSH session history and models declared in the configuration.
- Supports separate prices for each full `provider/model` name.
- Selects models.dev, openrouter.ai or api.deepinfra.com as the price source.
- Initializes new model prices from the selected source's local cache. Uses zero if there is no matching price.
- Downloads model prices only when you select **Sync prices**. The source controls, the Sync prices button and the sync report stay above the model rates table.
- Syncs only configured models. The sync result is staged in the draft and written to the configuration when you select **Save**.
- Matches source prices by model ID. models.dev prefers manufacturer prices; OpenRouter and DeepInfra supply their own platform prices. Keeps existing prices if matching is unclear.
- Keeps existing prices when the source cannot supply a supported rate.
- Supports USD or CNY for each model. Converts all four rates when you change its currency.
- Shows separate USD and CNY totals when a session or turn uses both currencies.
- Keeps edits in a page draft. The **Save** button at the end of the page writes the configuration. Leaving the page discards unsaved edits. A failed save shows the error and keeps the draft.
- Shows two flat sections, **Model rates** and **General**, with all content visible. **General** contains the exchange rate, the session/turn visibility controls, the **Show cost statistics in the sidebar** switch (on by default) and the **Refresh cost statistics on a timer** switch (on by default). Turn the sidebar switch off to remove the sidebar entry; the overview page keeps its data. The timer switch has an interval list of 1, 3, 5, 10, 15, 30 or 60 minutes, with 5 minutes as the default. While it is on, the plugin loads the five preset ranges in parallel at that interval, so the overview page opens from the cache.
- Shows the cost overview page for today, 7, 30, 90 days, all history or a custom start and end date. It shows four summary figures, a stacked daily cost or token trend, the cost and token mix, cost by model, the top sessions and the current rate, totals and generation time. The trend uses daily bars; above 20 bars it merges neighbouring dates, and only the all-history range above 60 days with data switches to months. The model table lists every priced model. Amounts use the configured currency and `cnyPerUsd` rate. The trend toggle also picks the basis of the mix, the time-of-day bars and the model shares. Select a bar to query its span. Cost by model opens as a scatter plot (total spend on a log scale against tokens, names fixed at the top right of each bubble, bubble colour following the blended price per 1M tokens from pale teal (cheap) to deep indigo (dear)) with a clickable provider-grouped legend, and switches to the share table.
- Caps the cost trend at 20 bars. Above 20 days it merges neighbouring dates and shows the merged span. The **Plugin settings** button opens the plugin page. Preset ranges cache their result for 15 minutes; **Refresh** or a price change recomputes it. The toolbar shows the cache state and the statistics time. Custom date ranges are not cached.
- Follows the DSH light or dark theme and the DSH Chinese or English language.
- Expands **More rates** on each model row to show its cache-write price and the automatic off-peak switch. The switch reveals that model's peak rule selector, and the info icon shows the windows of the selected rule.
- Adds a model by entering `provider/model` next to the **Model rates** title and selecting **Add model**. Declared models are saved with the configuration; models that history has not discovered can be removed.
- Marks invalid rates and exchange rates with a red border and a message, and disables **Save** and **Sync prices**.
- Reuses the DSH host controls (settings form, value field, switch, button and tag), so sizes, borders and colors match the host settings pages.
- Applies half the peak rate in each off-peak window. Each model selects one peak rule:
- **DeepSeek peak rule** (default): peak on Beijing weekday 09:00–12:00 and 14:00–18:00; off-peak on weekends, Chinese public holidays and all other windows.
- **Alibaba Cloud peak rule**: off-peak 22:00–08:00 Beijing time; peak at all other times.
- **Zhipu GLM peak rule**: peak on Beijing Monday to Friday 14:00–18:00; off-peak at all other times, including the whole weekend.
- Uses holiday-cn annual calendars, cached under `data/holidays/`. Fetches a missing year in the background.
- Stores configuration at `~/.dsh/guojinpeng/dsh-cost-meter/config.json`. Uses `DSH_HOME` when set.
- Copies the old `~/.dsh/dsh-cost-meter/config.json` on first start if the new file does not exist. Keeps the old file.
- Uses isolated plugin, client, API, projection, style and configuration identifiers.

These screenshots use example model prices. They do not show a billing statement.

Existing model prices without a currency remain USD. Existing entries without an off-peak setting keep fixed rates until you switch it on. The switch is off by default for every new entry. Confirmed original-vendor DeepSeek off-peak rates from models.dev are multiplied by two to store peak rates. Every model applies its own selected rule; the default is the DeepSeek peak rule.

The configuration file stays at the same path. No configuration migration is required. Historical usage is replayed to restore dates and seven Beijing clock windows under projection state version 5; the inherited transcript that a side thread or a forked subagent copies into its own log is skipped, so those turns are billed once. Requests that cross a price boundary are estimated from the recorded usage settlement time. Only the DeepSeek peak rule reads the holiday calendar; the Alibaba Cloud and GLM rules never need it. If a holiday calendar is unavailable, uncertain weekday windows use the peak rate until the calendar is loaded.

`priceSource` selects the cache for new models. Existing configuration without this field uses models.dev. Each model's `source` records its last price import; edits to rates on the configuration page set it to `manual`. Changing the selected source does not change existing rates or fetch prices. Cost calculation uses only the saved rates.

Caches are separate: `data/models.dev.json`, `data/openrouter.ai.json` and `data/api.deepinfra.com.json`. OpenRouter and DeepInfra prices are not multiplied by two. DeepSeek entries with automatic off-peak pricing keep their rates when the source cannot confirm an official peak rate. Sync reports show skipped models and cache-write rates that were kept because the cache duration is unclear. Conditional prices and non-token charges are outside this fixed-rate estimate.

Session cost details:

![Session cost card](docs/images/session-cost-en.png)

Turn cost details:

![Turn cost card](docs/images/turn-cost-en.png)

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
Install the generated file in your DSH profile. For version 0.4.4:

```powershell
dsh plugin --profile web add -w ./guojinpeng-dsh-cost-meter-0.4.4.tgz
```

Restart DSH and check the plugin. Repeat the build, package and install steps after changes.
Tests use the global DSH installation. Set `DSH_RUNTIME_ROOT` to the DSH package directory if its location is different.
Commit source files and `pnpm-lock.yaml`. Do not commit generated files or local configuration.
See [the module guide](docs/architecture.md) for source boundaries and verification commands.

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
npm run pack:release
```

Check the package file list. `pack:release` runs `npm pack` and creates the versioned
npm tarball. Commit and push the version change. Then publish that tarball.
For example, replace `<version>` with the new version number:

```powershell
npm publish ./guojinpeng-dsh-cost-meter-<version>.tgz --access public --registry=https://registry.npmjs.org/
npm view @guojinpeng/dsh-cost-meter version --registry=https://registry.npmjs.org/
```

Complete npm's authentication steps when prompted.
Each package version can be published only once.
After npm publication succeeds, create the matching Git tag and GitHub Release:

```powershell
git tag v<version>
git push origin v<version>
gh release create v<version> --verify-tag --title "<version>" --generate-notes --latest
```

Replace `<version>` before you run these commands. GitHub Releases contain release
notes; uploading a tarball is optional. npm hosts the installation package.
The plugin catalog links the npm package through its `repository` field.

Users can then install the package:

```powershell
dsh plugin --profile web add -w @guojinpeng/dsh-cost-meter
```
