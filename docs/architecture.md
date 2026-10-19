# Module Guide / 模块维护说明

## Entries / 入口

`src/index.js` connects the server services to DSH. `src/client.js` loads the host's React and ReactDOM and creates the client plugin. Both entries build to standalone JavaScript files in `dist/`.

后端入口只装配服务和注册插件。前端入口从 DSH 获取 React 和 ReactDOM；组件工厂显式接收该运行时，不另行打包 React。模块拆分不增加浏览器资源请求。

## Server / 后端

| Module | Responsibility / 职责 |
| --- | --- |
| `server/config-store.js` | Configuration paths, defaults, legacy copy, cached reads, atomic writes / 配置路径、默认值、旧文件复制、缓存读取和原子写入 |
| `server/schemas.js` | Config input, projection state and wire-view schemas / 配置输入和 projection 状态及输出校验 |
| `server/usage-events.js` | Event fields and token bucket operations / 事件字段读取、压缩、token 分桶和缓存归属恢复 |
| `server/projection.js` | Session totals, turn settlement, retention and wire-view caching / 会话累计、轮次结算、保留规则和输出缓存 |
| `server/config-handler.js` | Authentication, HTTP bodies, revisions, save and price sync / HTTP 认证、请求体、revision、保存和价格同步 |
| `server/holiday-store.js` | Annual holiday-cn downloads and local date caches / holiday-cn 年度下载、日期缓存和并发请求合并 |
| `server/price-service.js` | Selected price source and independent catalog services / 所选价格来源及独立缓存服务装配 |
| `price-sources/` | Source adapters, catalog caching, model matching and shared sync / 来源适配、目录缓存、模型匹配和共享同步 |
| `price-sources.js` | Client-safe source IDs and legacy default / 前后端共用来源标识及旧配置默认值 |
| `time-of-use.js` | Beijing clock windows, peak-rule lookup and provider eligibility / 北京时段分桶、峰谷规则查找及提供方判断，纯函数 |
| `peak-rules/` | One peak rule per file: DeepSeek, Alibaba Cloud, Zhipu GLM / 每个峰谷规则一个文件 |

`history.js` owns historical model discovery and missing-price initialization. `server/price-service.js` selects the source service. `price-sources/` owns fetching, caching and source price conversion. `peak-rules/` holds one file per peak rule; each rule decides its own windows and reads the holiday calendar only when it needs one. `models-dev.js` preserves the existing models.dev entry point. `pricing.js` is shared by server and client; it has no filesystem, HTTP or UI dependencies.

历史模型发现和初始化由 `history.js` 协调，各来源适配器统一输出 USD / 百万 token 单价。共享同步负责币种转换、模型来源标记和峰谷兼容检查；共享计价函数仍保持纯计算。各规则独立实现时段判断，计价时按模型条目自己所选的 `peakRule` 调用。

## Client / 前端

| Module | Responsibility / 职责 |
| --- | --- |
| `client/plugin.js` | One shared store, locale registration and slots / 创建唯一共享 store，注册语言和插槽 |
| `client/config-store.js` | Requests, save and sync, conflict checks and local refresh / 请求、保存与同步、冲突检查和本地状态刷新 |
| `client/config-draft.js` | Draft conversion and validation / 草稿转换及校验 |
| `client/config-controller.js` | Staged draft, validation, explicit save and sync preview / 暂存草稿、校验、显式保存和同步预览 |
| `client/config-page.js` | Settings page composition / 配置页面装配 |
| `client/pricing-table.js` | Provider/model price rows with per-model peak rules / 按提供方分组的价格表及每行的峰谷规则选择 |
| `client/cost-view.js` | Projection subscription and live repricing / projection 订阅和实时重新计价 |
| `client/cost-chips.js`, `client/cost-dialog.js` | Session/turn chips, peak/off-peak detail groups and formula popovers / 费用标签、峰价/谷价明细分组和公式弹层 |
| `client/icons.js` | Price tag glyph shared by both chips and both panel titles / 会话胶囊、本轮胶囊和两个面板标题共用的价格标签图标 |
| `client/format.js`, `client/locales.js` | Display formatting and bilingual text / 显示格式与中英文词典 |
| `client/styles.css`, `client/styles.js` | Stylesheet and idempotent injection / 样式文件及防重复注入 |

The build loads CSS as text and embeds it into `dist/client.js`. Keep `.css=text` in the build command. The DSH module loader does not need to serve a separate stylesheet.

The configuration page loads `@deepseek-ai/dsh-client-ui-primitives` with the module loader's `load()` in `src/client.js`. The shell provides that package as a static module, so the plugin shares the host instances and theme tokens of `SettingsForm`, `SettingsValueField`, `Switch`, `Button` and `Tag`. Never bundle it and never declare it as a dependency.

配置页通过 `src/client.js` 的 `load()` 取用 `@deepseek-ai/dsh-client-ui-primitives`。该包由 shell 以静态模块提供，插件与宿主共享 `SettingsForm`、`SettingsValueField`、`Switch`、`Button`、`Tag` 的同一实例和主题变量。不要把它打包进本包，也不要声明为依赖。

`src/client-store.js` and the named exports from `src/index.js` remain compatibility entry points. New code should import the module that owns the responsibility directly.

## Contracts / 行为约束

- Keep the plugin ID, projection key, locale namespace and slots from `identity.js` unchanged.
- Keep the configuration and sync route paths stable. GET can return the local configuration before history discovery finishes; `historyPending` and `calendarPending` request bounded local refreshes while those operations run.
- Use exact local `provider/model` prices. Third-party price matching uses only the model ID.
- Keep official token/retry folds and turn retention. Projection state version 4 preserves `event.time` and partitions tokens by route, Beijing date and one of seven clock windows. DSH replays old checkpoint data from the durable log.
- Keep revision checks and the re-read after network initialization. Manual prices must win over delayed initialization.
- Keep the staged sync contract: POST `pricing/sync` with a `config` body prices that staged config and returns `preview` plus `report` without writing; without `config` it keeps saving the synced configuration.
- 保持暂存同步契约：POST `pricing/sync` 带 `config` 体时只对该草稿计价并返回 `preview` 与 `report`，不写盘；不带 `config` 时保持同步并写盘的旧行为。
- Keep draft values as strings while editing. Validate and convert them before saving.
- Keep chip ordering and money precision stable. Native model-currency totals are grouped in `amounts`; every amount group and route also carries `periodMicros` and `tokensByPeriod` for the peak, off-peak, fixed and unknown windows. Legacy `micros` fields remain expressed in USD for compatibility. Rows and groups with zero money stay hidden in the client.
- Preserve current error strings. Error localization is a separate behavior change.

## Pricing And Cache / 价格与缓存

Model entries append optional `currency`, `autoOffPeak` and `peakRule` fields. Missing currency means USD; missing off-peak settings preserve fixed legacy rates. New model entries explicitly use USD and keep off-peak pricing off. `peakRule` accepts `deepseek`, `aliyun` or `glm`; a missing or unknown value means `deepseek`. The old global currency field is retained if present but is not used for display. No new configuration format version or migration step is required.

模型条目追加字段即可，读取旧配置不会补写文件。币种切换转换四项单价并作为一次写入；修改汇率不重写模型单价。源价格始终从 models.dev 的 USD 原始数据计算，已确认的原厂 DeepSeek 谷价先乘以 2。无法确认峰谷口径时保留原价，避免重复折扣。每个模型按自身的 `peakRule` 计费，三套规则的谷价系数统一为 0.5。

Only manual price sync downloads a catalog. Missing or broken catalogs do not trigger an automatic request. Initialization uses the selected source's catalog already on disk or keeps zero prices. GET does not wait for a complete history scan; writes reconcile history before revision checks.

`priceSource` selects `models.dev`, `openrouter.ai` or `api.deepinfra.com`; missing values default to models.dev. Each source uses `data/<source>.json`, so existing models.dev caches remain valid. Source selection is saved before sync. Model `source` records the last import, while manual rate edits set it to `manual`; currency conversion preserves provenance. Neither field changes the cost calculation.

OpenRouter converts USD/token strings by multiplying by 1,000,000. DeepInfra converts cents/token by multiplying by 10,000, then applies supported cache multipliers and a valid promotion at import time. Standard service-tier prices are used. Conditional rates are skipped; ambiguous cache-write TTLs preserve the local write price. Bare model IDs use a unique namespace-suffix match, without dropping version or service suffixes. Enabled official DeepSeek off-peak entries require a confirmed peak basis and otherwise keep their prices.

holiday-cn data is stored under `data/holidays/<year>.json`. Files contain holiday/weekend dates and source metadata. Under the DeepSeek peak rule, weekends and holidays remain off-peak even on adjusted working days; the Alibaba Cloud and GLM rules never read this calendar. Date and clock buckets stay in the projection, so calendars can reprice past usage without rewriting token counts. The configuration response carries loaded calendars; the shared client store polls the local endpoint only while discovery or calendar requests are pending.

日历缺失时异步获取，不阻塞界面。只对无法确认的工作日高峰窗口暂用高峰价，未确认时段的金额暂计入“峰价”组显示，并在费用明细中记录未确认 token。未知时间不能用当前时间补算。日历到齐后，前端使用原有计费分桶重新计算；不通过大模型调用峰谷工具。

Source references / 数据来源：

- [models.dev catalog / 模型价格接口](https://models.dev/api.json)
- [OpenRouter model API / 平台报价字段](https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties)
- [DeepInfra API schema / 平台报价接口定义](https://api.deepinfra.com/openapi.json)
- [DeepInfra cache pricing / 缓存倍率与时长](https://docs.deepinfra.com/chat/prompt-cache-retention)
- [DeepSeek pricing / 官方峰谷计价规则](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)
- [holiday-cn / 中国节假日年度数据](https://github.com/NateScarlet/holiday-cn)

`DEEPSEEK_OFF_PEAK_IDS` lists the source model IDs with confirmed off-peak rates. Check the source rate basis before you add an ID. Enabled DeepSeek entries keep their existing prices when that basis cannot be confirmed. The `aliyun` and `glm` rules use the window definitions and the 50% factor confirmed for this plugin; they do not read the holiday calendar.

`DEEPSEEK_OFF_PEAK_IDS` 仅列出已确认使用谷价的来源模型 ID。后续增加 ID 前应核对来源价格口径；无法确认时，已开启峰谷的 DeepSeek 条目保留原价。`aliyun` 与 `glm` 规则使用本插件确认的时段口径和 50% 系数，不读取节假日日历。

## Verify / 验证

```powershell
npm test
npm run pack:release
node tests/install-smoke.mjs
```

Tests use the installed DSH runtime. `DSH_RUNTIME_ROOT` can select a different runtime. The install smoke test uses an isolated `DSH_HOME` and tests the package version from `package.json`. It does not change the user's profiles.

Set `PLAYWRIGHT_MODULE` to an installed Playwright module to include desktop configuration checks. `node tests/screenshot-cards.mjs` creates desktop session and turn screenshots from the actual components; `node tests/screenshot-overview.mjs` draws the overview image with both panels, both chips and one price formula popover. Both scripts require Playwright and the same `REACT_MODULE_ROOT` and `PLAYWRIGHT_MODULE` variables. Set `SCREENSHOT_DIR` to keep verification images outside `docs/images`.

The repository root holds `screenshots.json`. It lists the overview, turn and session images as relative paths, so the plugin registry picks them up for the market card and the detail dialog. Keep the paths relative to the repository root and use PNG files.
Set `SCREENSHOT_LOCALE=en` to check the English cards. If React is not exposed by the global DSH package, set `REACT_MODULE_ROOT` to a directory that can resolve React and ReactDOM.
