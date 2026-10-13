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

`history.js` owns historical model discovery and missing-price initialization. `models-dev.js` owns catalog fetching, disk caching and source price selection. `pricing.js` is shared by server and client; it has no filesystem, HTTP or UI dependencies.

历史模型发现和初始化仍由 `history.js` 协调，models.dev 的获取、缓存和价格选择仍由 `models-dev.js` 负责。共享计价函数保持纯计算，不引入前后端运行时依赖。

## Client / 前端

| Module | Responsibility / 职责 |
| --- | --- |
| `client/plugin.js` | One shared store, locale registration and slots / 创建唯一共享 store，注册语言和插槽 |
| `client/config-store.js` | Requests, snapshots, subscriptions and response ordering / 请求、快照、订阅和响应顺序保护 |
| `client/config-draft.js` | Draft conversion and validation / 草稿转换及校验 |
| `client/config-controller.js` | Load, edit, save, sync, reload and notices / 读取、编辑、保存、同步、重载和提示流程 |
| `client/config-page.js` | Settings page composition / 配置页面装配 |
| `client/form-controls.js`, `client/pricing-table.js` | Form controls and provider/model price rows / 表单控件和按提供方分组的价格表 |
| `client/cost-view.js` | Projection subscription and live repricing / projection 订阅和实时重新计价 |
| `client/cost-chips.js`, `client/cost-dialog.js` | Session/turn chips and popover interactions / 费用标签、明细弹层和定位交互 |
| `client/format.js`, `client/locales.js` | Display formatting and bilingual text / 显示格式与中英文词典 |
| `client/styles.css`, `client/styles.js` | Stylesheet and idempotent injection / 样式文件及防重复注入 |

The build loads CSS as text and embeds it into `dist/client.js`. Keep `.css=text` in the build command. The DSH module loader does not need to serve a separate stylesheet.

`src/client-store.js` and the named exports from `src/index.js` remain compatibility entry points. New code should import the module that owns the responsibility directly.

## Contracts / 行为约束

- Keep the plugin ID, projection key, locale namespace and slots from `identity.js` unchanged.
- Keep `GET/HEAD/POST /guojinpeng/dsh-cost-meter/config` and `POST /guojinpeng/dsh-cost-meter/pricing/sync`, response fields and status codes unchanged.
- Use exact local `provider/model` prices. Third-party price matching uses only the model ID.
- Keep rounding, retry handling, cache recovery and retention rules unchanged during structural changes.
- Keep revision checks and the re-read after network initialization. Manual prices must win over delayed initialization.
- Keep draft values as strings while editing. Validate and convert them before saving.
- Keep DOM classes, CSS rule order, chip ordering and money precision stable.
- Preserve current error strings. Error localization is a separate behavior change.

## Verify / 验证

```powershell
npm test
npm run pack:release
node tests/install-smoke.mjs
```

Tests use the installed DSH runtime. `DSH_RUNTIME_ROOT` can select a different runtime. The install smoke test uses an isolated `DSH_HOME` and tests the package version from `package.json`. It does not change the user's profiles.

Set `PLAYWRIGHT_MODULE` to an installed Playwright module to include desktop configuration checks. `node tests/screenshot-cards.mjs` creates desktop session and turn screenshots from the actual components; it also requires Playwright. Set `SCREENSHOT_DIR` to keep verification images outside `docs/images`.
Set `SCREENSHOT_LOCALE=en` to check the English cards. If React is not exposed by the global DSH package, set `REACT_MODULE_ROOT` to a directory that can resolve React and ReactDOM.
