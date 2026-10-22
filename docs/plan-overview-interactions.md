# 费用统计页三项交互增强：完整开发方案

日期：2026-10-22　基线版本：0.4.6　发布版本：0.4.7　状态：已实施，待验证

本版范围：四项需求中保留三项。需求 2（时段分布按小时）取消，时段分布只跟随“总费用 / 总 Token”切换。文中行号基于 0.4.6 当前 HEAD。

## 0. 结论与范围

| # | 需求 | 服务端 | 客户端 | 风险 |
| --- | --- | --- | --- | --- |
| 1 | 构成、时段、模型三处跟随“总费用 / 总 Token”重算占比与进度条（原需求 1） | 不改 | 3 处口径 + 文案 | 低 |
| 2 | 柱状图点击，按该柱时段回填日期并查询（原需求 3） | 不改 | 柱容器可点击 + 纯函数 | 低 |
| 3 | 模型费用默认散点图，可切回占比列表（原需求 4） | 不改 | 新图表 + 弹窗 + 切换 | 低 |

要点：

1. 三项全部是客户端改动。服务端接口、查询参数、投影状态版本（4）、overview 磁盘缓存格式（1）都不变。因此没有数据迁移，也没有升级后的重算。
2. 需求 2（原需求 2）取消：不做小时统计，不加切换按钮，不加滚动。时段卡片高度与现在一致，只按指标切换进度条与数值。
3. 已确认口径：散点横轴用综合单价；月柱点击按该月首末日查询；气泡大小固定按费用，不随指标切换。
4. 工作量约 2.5 人日。

## 1. 改动文件清单

| 文件 | 改动 |
| --- | --- |
| `src/client/cost-overview.js` | 指标跟随 3 处、柱状图点击、散点图与切换 |
| `src/client/overview-charts.js`（新增） | 纯函数：`trendBarRange`、`monthEnd`、`modelPoints`、`pointDiameter` |
| `src/client/locales.js` | 新增 6 个键，把 3 个提示键改成费用 / Token 两版（净增 9 个，中英各一份） |
| `src/client/styles.css` | 柱容器按钮复位与焦点、散点图样式 |
| `tests/overview-charts.test.js`（新增） | 纯函数单测 |
| `CHANGELOG.md`、`package.json`、`README.md`、`README.zh-CN.md`、`docs/architecture.md` | 版本、文案、模块表 |
| `docs/images/cost-overview.png` | 上线后按新页面重出 |

不改：`src/server/*`、`src/pricing.js`、`src/time-of-use.js`、`src/client/cost-view.js`、现有测试的 fixture。

## 2. 指标跟随：三个统计区域跟随“总费用 / 总 Token”（原需求 1）

### 2.1 现状

- `metric` 状态已存在（`cost-overview.js:68`），但只在 `trendCard` 内使用（332-334、348-350）。
- 构成卡硬编码费用口径（506-510）。
- 时段卡硬编码费用口径：进度条宽度 624-636、右侧数值 635、弹窗 570-589。
- 模型卡占比硬编码费用口径（683-687）。
- 三处提示文案写死“费用占比”（`locales.js:117、126、128`）。

### 2.2 数据（已核实，服务端不用改）

| 区域 | 可用字段 | 来源 |
| --- | --- | --- |
| 构成 | `view.tokens{4}`、`view.bucketMicros{4}`、`view.totalTokens`、`view.totalMicros` | `pricing.js:212-230` |
| 时段 | 每行 `tokens{4}`、`bucketMicros{4}`、`totalTokens`、`totalMicros` | `overview-data.js:128-132、171-183` |
| 模型 | 每行 `tokens{4}`、`bucketMicros{4}`、`totalTokens`、`micros` | `overview-data.js:186-209` |

### 2.3 口径

| 区域 | 费用模式 | Token 模式 |
| --- | --- | --- |
| 构成：圆环角度、百分比 | 每项 `micros` ÷ `totalMicros` | 每项 `tokens` ÷ `totalTokens` |
| 时段：进度条宽度、数值、弹窗占比 | 行内 `bucketMicros` ÷ 行 `totalMicros` | 行内 `tokens` ÷ 行 `totalTokens` |
| 模型：占比条与百分比 | `micros` ÷ 所有模型 `micros` 之和 | `totalTokens` ÷ 所有模型 `totalTokens` 之和 |

不变量：

1. 构成卡的费用列、Token 列同时保留，只换圆环角度与百分比。
2. 模型表的“Token”“费用”两列不换，只换“占比”列。
3. 时段卡右侧数值换成当前指标：费用显示金额，Token 显示紧凑数。
4. 不做独立切换按钮：三处直接读页面级 `metric`，与趋势卡共用同一个状态。

### 2.4 实现

三个卡片都是页面组件的内层函数，直接读 `metric`，不新增参数。

构成卡（498-549）：

```js
const total = entries.reduce((sum, entry) => sum + entry.value, 0);
const cost = entries.reduce((sum, entry) => sum + entry.micros, 0);
// 费用模式在全部未定价时退回 Token 占比，保留现有兜底。
const byMoney = metric === 'money' && cost > 0;
const basis = (entry) => (byMoney ? entry.micros : entry.value);
const whole = byMoney ? cost : total;
```

- 圆环 `stops` 与图例百分比都改用 `basis(entry) / whole`。
- 圆环中心（528-532）改为两行：主行是当前指标，次行是另一项。费用模式主行金额，Token 模式主行 `compactTokens(total)`。

时段卡（551-643）：

```js
const byMoney = metric === 'money';
const rowTotal = (row) => (byMoney ? row.totalMicros : row.totalTokens);
const rowValue = (row, key) =>
  byMoney ? (row.bucketMicros?.[key] ?? 0) : (row.tokens?.[key] ?? 0);
const format = (value) => (byMoney ? money(value) : compactTokens(value));
```

- 进度条宽度：`share(rowValue(row, series.key), rowTotal(row))`。
- 右侧数值：`format(rowTotal(row))`。
- 弹窗：每行 `format(rowValue(hovered, series.key))` 与 `percent(share(...))`，合计行 `format(rowTotal(hovered))`。
- 卡片结构、行数、高度都不变。

模型卡（645-692）：

```js
const byMoney = metric === 'money';
const basis = (route) => (byMoney ? route.micros : route.totalTokens);
const total = routes.reduce((sum, route) => sum + basis(route), 0);
```

- 占比条宽度与百分比都改用 `basis(route) / total`。
- 有未定价模型时仍优先显示 `modelsUnpriced` 提示；否则提示按指标切换。

### 2.5 文案

改写 3 个键（中英各一份），键名带 Cost / Tokens 后缀：

| 键 | zh | en |
| --- | --- | --- |
| `compositionHintCost` | 环形图为费用占比 | Ring shows the cost share |
| `compositionHintTokens` | 环形图为 Token 占比 | Ring shows the token share |
| `timeOfDayHintCost` | 按费用占比 · 北京时间 | Share of cost · Beijing time |
| `timeOfDayHintTokens` | 按 Token 占比 · 北京时间 | Share of tokens · Beijing time |
| `modelsHintCost` | 按费用占比 | Share of cost |
| `modelsHintTokens` | 按 Token 占比 | Share of tokens |

删除旧键 `compositionHint`、`timeOfDayHint`、`modelsHintShare`。`tests/client-modules.test.js:8-14` 校验 zh/en 键与插值参数一致，两本字典必须同步。

### 2.6 验收

- 切到“总 Token”：圆环角度、图例百分比、时段进度条与数值、模型占比条与百分比同时按 Token 重算。
- 切回“总费用”恢复原值。
- 两种模式下，构成卡的 token/金额列、模型表的 Token/费用列都不变。
- 有 Token 但无费用的范围：Token 模式能画出占比；费用模式保留兜底，不出现空环。

## 3. 柱状图点击反查日期（原需求 3）

### 3.1 现状与可行性

- 列容器是无点击的 div（`cost-overview.js:351-358`），只有 hover。
- 每根柱子已带 `fromKey`、`toKey`、`merged`（`overview-data.js:151-168`）。
- 粒度只有日与月两种，没有周粒度。日键是 `YYYY-MM-DD`，可直接作自定义起止日期（服务端校验 `overview.js:182-186`，客户端校验 `cost-overview.js:57-60`）。

### 3.2 规则（已确认）

| 柱型 | 判定 | 起始 | 结束 |
| --- | --- | --- | --- |
| 单日柱 | 键长 10 | `fromKey` | `toKey` |
| 合并日柱 | 键长 10，`merged > 1` | `fromKey` | `toKey` |
| 月柱 | 键长 7 | `YYYY-MM-01` | 该月最后一天 |
| 合并月柱 | 键长 7，有 `fromKey`/`toKey` | `fromKey` 月初 | `toKey` 月末 |

### 3.3 实现

新增纯函数（`src/client/overview-charts.js`）：

```js
const MONTH_KEY = /^\d{4}-\d{2}$/;

/** Last calendar day of a YYYY-MM month. */
export function monthEnd(key) {
  const [year, month] = key.split('-').map(Number);
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

/** Date range a trend bar stands for. */
export function trendBarRange(unit) {
  const from = unit.fromKey ?? unit.key;
  const to = unit.toKey ?? unit.key;
  if (!MONTH_KEY.test(from)) return { start: from, end: to };
  return { start: from + '-01', end: monthEnd(to) };
}
```

列容器改为 `<button type="button">`，点击执行：

```js
const range = trendBarRange(unit);
setRange('');
setCustom({ start: range.start, end: range.end });
setHover(null);
```

现有请求 effect（`cost-overview.js:86-107`）依赖 `custom.start`/`custom.end`，同一次批处理只发一次请求。

CSS 复位与焦点样式：

```css
.gdcc_ovBarColumn {
  box-sizing: border-box;
  width: 100%;
  padding: 0;
  font: inherit;
  background: 0 0;
  border: 0;
  cursor: pointer;
}
.gdcc_ovBarColumn:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid
    var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 2px;
}
```

- `aria-label` 与 `title` 用 `t('trendBarFilter', { label: tipLabel(unit) })`。
- 趋势副标题末尾追加 `t('trendClickHint')`。
- 现有 hover 逻辑不动：`onMouseEnter` 在列上，`onMouseMove`/`onMouseLeave` 在容器上。
- 现有重置 effect（108-111）的依赖补上 `custom.start`/`custom.end`，点击柱后清空 hover，避免弹窗指向新列表的旧索引。

### 3.4 边界

| 情况 | 行为 |
| --- | --- |
| 点击后 | `range` 置空，预设按钮取消选中，两个日期框显示新值，请求带 `start/end`（`overview-request.js:15-23`） |
| 请求进行中点击 | 旧请求被 `alive` 标记丢弃（104-106），只保留最后一次 |
| 重复点击同一柱 | 依赖不变，不重发；需强制刷新用右上角“刷新” |
| 月粒度 | 得到整月区间，查询后粒度按新范围重算 |

### 3.5 验收

- 点 10-08 单日柱：日期框填 10-08 ~ 10-08，页面重新统计。
- 点合并柱：填合并区间首末日期。
- “全部”按月时点月柱：填该月首末日。
- 键盘可聚焦，Enter 可触发，焦点环可见。

## 4. 模型费用散点图（原需求 4）

### 4.1 数据

`data.models` 每行（`overview-data.js:197-207`、`pricing.js:141-151`）带 `route`、`micros`、`totalTokens`、`priced`、`bucketMicros{4}`、`tokens{4}`。服务端不改。

### 4.2 坐标轴

- 横轴（已确认）：综合单价 = `micros ÷ totalTokens × 1e6`，即每 1M token 的费用，用 `formatMoney`（`format.js:22-30`）按配置币种显示。
- 纵轴：`totalTokens`。
- 量程：`0 ~ 最大值 × 1.15`。横轴 4 个刻度，纵轴 3 个刻度。刻度的横轴标签用 `shortMoneyText(money(v), false)`，纵轴用 `compactTokens`。
- 为什么不用配置单价：一个模型有 4 个单价，落不成 1 个点；缓存命中率也会扭曲成本。综合单价反映真实花费。

### 4.3 气泡

- 直径 `pointDiameter(micros, maxMicros) = 8 + 16 × sqrt(micros / maxMicros)`，范围 8-24px。
- 气泡大小只按费用，不随指标切换（已确认）。
- 标签：模型名去掉 provider 前缀，超 12 字截断，放在圆右侧。
- 点数大于 8 时只标费用占比 ≥5% 的点，其余靠悬停识别。

### 4.4 悬停弹窗

复用 `.gdcc_ovTip`（`styles.css:850-907`）与四列网格 `.gdcc_ovTipRow`（点、名称、费用、Token）：

```
头行：模型名 · ¥0.89/1M
● 未缓存输入   ¥194.91    35.21M
● 输出         ¥156.89    10.69M
● 缓存读取     ¥18.60    710.72M
● 缓存写入     ¥0          0
合计           ¥670.39   756.62M
```

- 定位与趋势弹窗相同（`cost-overview.js:464-469` 的 clamp 逻辑），新代码复用同一个位置函数。
- 悬停状态是模型 id。切换视图、或数据范围变化时清空：把 `modelHover` 加入重置 effect（108-111），依赖同样补上 `custom.start`/`custom.end`。

### 4.5 切换与空态

- 新增 `modelView` 状态，默认 `'scatter'`。
- 标题右侧 `.gdcc_ovSegmented`（`styles.css:668-698`）两个按钮：`t('modelViewScatter')`、`t('modelViewShare')`。
- `'share'` 模式就是现有表格（645-692），代码保留不动。
- `priced === false` 的模型不进散点；有未定价模型时保留 `modelsUnpriced` 提示。
- 全部未定价时，绘图区显示 `t('scatterEmpty')`。
- 只有 1 个模型时单点居中，不报错。

### 4.6 DOM 与 CSS

不用 SVG：卡片宽度随窗口变化，SVG 要么把圆压扁，要么留白。div + 百分比定位可直接复用现有 tooltip 与主题变量。

```
.gdcc_ovScatter            定位容器，左侧 52px 留给纵轴标签，底部 22px 留给横轴标签
├─ .gdcc_ovScatterPlot     高 180px，左、下轴线
│  ├─ .gdcc_ovScatterGrid  3 条虚线（0% / 50% / 100%）
│  ├─ .gdcc_ovPointAnchor  absolute，left x%、bottom y%，0 尺寸
│  │  ├─ .gdcc_ovPoint        圆，translate(-50%, 50%)
│  │  └─ .gdcc_ovPointLabel   标签，left = 半径 + 6px
│  └─ .gdcc_ovTip          悬停弹窗
└─ .gdcc_ovScatterTick     横轴 4 个 + 纵轴 3 个刻度
```

关键样式约 40 行：

```css
.gdcc_ovScatter { position: relative; margin-top: 16px; padding: 0 8px 22px 52px; }
.gdcc_ovScatterPlot {
  position: relative;
  height: 180px;
  border-left: 0.5px solid var(--dsw-alias-border-l2);
  border-bottom: 0.5px solid var(--dsw-alias-border-l2);
}
.gdcc_ovPointAnchor { position: absolute; width: 0; height: 0; }
.gdcc_ovPoint {
  position: absolute;
  left: 0;
  top: 0;
  box-sizing: border-box;
  transform: translate(-50%, 50%);
  background: color-mix(in srgb, var(--gdcc-ov-input) 35%, transparent);
  border: 1px solid var(--gdcc-ov-input);
  border-radius: 50%;
}
.gdcc_ovPoint--on { background: var(--gdcc-ov-input); }
.gdcc_ovPointLabel {
  position: absolute;
  top: 0;
  transform: translateY(-50%);
  color: var(--dsw-alias-label-tertiary);
  font-size: 10px;
  line-height: 14px;
  white-space: nowrap;
  pointer-events: none;
}
.gdcc_ovScatterTick {
  position: absolute;
  color: var(--dsw-alias-label-tertiary);
  font-size: 10px;
  line-height: 14px;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.gdcc_ovScatterTick--y { left: 0; transform: translate(calc(-100% - 6px), 50%); }
.gdcc_ovScatterTick--x { top: 100%; margin-top: 4px; transform: translateX(-50%); }
```

### 4.7 验收

- 默认显示散点图：横轴综合单价、纵轴 Token，圆圈大小反映费用。
- 悬停任一圆点：显示 4 项费用与 Token、合计费用与 Token、综合单价。
- 切回“占比列表”与当前表格一致。
- 未定价模型不出现，并有提示。
- 切到“总 Token”不影响散点（横纵轴与气泡都不变）。

## 5. 代码结构与复用

- 新增 `src/client/overview-charts.js`，只放纯函数，便于单测：`trendBarRange`、`monthEnd`、`modelPoints`、`pointDiameter`。
- `modelPoints(routes)` 只收 `priced` 且有用量的模型，返回 `{ route, micros, totalTokens, priceMicros, tokens, bucketMicros }`，按费用降序。
- 复用现有构件：`.gdcc_ovSegmented`、`.gdcc_ovTip`、`share()`、`formatMoney`、`compactTokens`、`shortMoneyText`、`placeTip()`。
- 不新增依赖；不改 `pricing.js`；不改接口参数。

新增文案键（8 个，中英各一份）：

| 键 | 用途 | zh | en |
| --- | --- | --- | --- |
| `trendClickHint` | 趋势副标题后缀 | · 点击柱子按该时段筛选 | · Select a bar to filter by that span |
| `trendBarFilter` | 柱子 title 与 aria-label | 按 {label} 筛选 | Filter by {label} |
| `modelViewScatter` | 模型卡切换 | 散点图 | Scatter |
| `modelViewShare` | 模型卡切换 | 占比列表 | Share list |
| `scatterHint` | 散点模式提示 | 圆圈面积表示费用 | Circle area shows the cost |
| `scatterAxisX` | 散点横轴名 | 综合单价 / 1M token | Blended price per 1M tokens |
| `scatterAxisY` | 散点纵轴名 | Token 消耗 | Tokens |
| `scatterEmpty` | 散点空态 | 范围内没有可定价的模型 | No priced model in range |

## 6. 测试计划

新增 `tests/overview-charts.test.js`：

| 用例 | 断言 |
| --- | --- |
| 单日柱 | `trendBarRange({ fromKey: '2026-10-08', toKey: '2026-10-08' })` → 同日区间 |
| 合并日柱 | `fromKey/toKey` 原样返回 |
| 月柱 | `2026-02` → `2026-02-01` ~ `2026-02-28` |
| 闰年 2 月 | `2028-02` → `2028-02-29` |
| 合并月柱 | `2025-11` ~ `2026-02` → `2025-11-01` ~ `2026-02-28` |
| 综合单价 | `micros/totalTokens×1e6` 的数值 |
| 过滤与排序 | 排除未定价与零用量；按费用降序 |
| 气泡直径 | 0 → 8，最大 → 24，单调递增 |

现有测试不改。`tests/client-modules.test.js:8-14` 自动覆盖新增文案的 zh/en 一致性。`npm test` 的命令是 `node --test tests/*.test.js`，新文件会被自动执行。

浏览器验证（真实页面，浅色与深色、中英文各一遍）：

1. 打开费用统计页，保持默认 30 天。
2. 趋势切“总 Token”：构成圆环与百分比、时段进度条与数值、模型占比条与百分比同时变化；切回恢复。
3. 点单日柱：日期框填该日 ~ 该日，页面重新统计，预设按钮取消选中。
4. 90 天范围点合并柱：起止为合并区间首末。
5. “全部”且数据超过 60 天：点月柱，得到该月首末日。
6. 模型费用默认散点；悬停显示 4 项与合计；切“占比列表”与旧表一致。
7. 含未定价模型时：散点不含该模型，显示提示。
8. 键盘 Tab 到柱子，Enter 触发查询，焦点环可见。
9. 控制台无 pageerror。

## 7. 文档与发布

- `package.json:3` 版本 0.4.7；`npm run build` 重建 `dist/`（构建产物，已在 `.gitignore`）。
- `CHANGELOG.md:3` 前新增 0.4.7 段落，一项需求一条。
- `README.md:49`、`README.zh-CN.md:48` 功能段落补充三项能力。
- `docs/architecture.md` 前端模块表（44-52 行附近）新增 `client/overview-charts.js` 一行。
- 投影状态版本与缓存格式不变，`README.md:69`、`README.zh-CN.md:68`、`docs/architecture.md:71` 不用改。
- `docs/images/cost-overview.png` 是页面截图，上线后重出；`screenshots.json:2-6` 路径不变。
- 本方案文档入库 `docs/`。
- 验证命令：`npm test`、`npm run build`、`npm pack`、`node tests/install-smoke.mjs`；有 Playwright 时跑两个现有截图脚本，确认没有 pageerror。

## 8. 排期

| 步骤 | 内容 | 人日 |
| --- | --- | --- |
| 1 | 指标跟随 3 处、文案、单测 | 0.5 |
| 2 | 柱状图点击、纯函数、单测 | 0.5 |
| 3 | 散点图、弹窗、切换 | 1.0 |
| 4 | 文档、版本、打包、浏览器验证 | 0.5 |
| 合计 | | 2.5 |

## 9. 已确认口径

1. 散点横轴用综合单价（每 1M token 的费用）。
2. 时段分布不做小时统计，不加滚动，只跟随“总费用 / 总 Token”切换。
3. 月柱点击按该月首末日查询。
4. 气泡大小固定按费用。

## 10. 风险与取舍

| 风险 | 影响 | 处理 |
| --- | --- | --- |
| 柱容器改成按钮 | 默认内边距与边框会改变柱宽 | CSS 复位；上线前对比柱宽截图 |
| 散点标签重叠 | 模型多时拥挤 | 超过 8 个点只标费用占比 ≥5% 的点 |
| 趋势副标题变长 | 窄屏换行 | 文案控制在 10 字内 |
| 页面截图过时 | 插件市场展示旧界面 | 上线后重出 `cost-overview.png` |
| 文案键改名 | zh/en 不一致会让测试失败 | 两本字典同步改，测试会拦住 |

取消项说明：需求 2 原计划把投影时间桶从“7 个时段”改为“24 个小时”，需要 `stateVersion` 4→5、overview 缓存格式 1→2、42 处测试 fixture，并按小时重算。本版不做，代码保持现状，对该需求的结论保留在讨论记录中。

## 12. 实施记录（0.4.7）

已按本方案实现，无服务端与接口改动。

实现结构：

1. 新增 `src/client/overview-charts.js`：`trendBarRange`、`monthEnd`、`modelPoints`、`pointDiameter`、`modelName`、`shortModelName`，附 `tests/overview-charts.test.js`。
2. 悬停弹窗头行用完整模型名，图上标签用尾部片段（`shortModelName`）。
3. 散点轴名用 `scatterAxisX` / `scatterAxisY` 两个键，放在独立留白区。

### 12.1 散点图返工（0.4.7 内修订）

散点图首次上线后发现六个问题：提示在指针离开圆圈后仍停留；刻度文字小且与气泡标签互相压住；没有指针位置的数值指引；多个同族模型标签都截断成同一段文字；十字准线读的是鼠标位置，悬停气泡时两轴数值与提示里的价格、Token 对不上；低价格或低用量模型贴着坐标轴，圆点画到了刻度区里。对照 Chart.js 的默认交互（`interaction.mode = 'nearest'`、`intersect = true`，即指针必须命中数据项才出现提示，应用 `mouseout` 收起；参见 [Chart.js Interactions](https://www.chartjs.org/docs/latest/configuration/interactions.html)）与散点图通行的“十字准线 + 轴端数值”做法（ECharts `axisPointer` 交叉线带轴标签），返工为：

1. 每个圆点带 26px 透明热区，`mouseenter` 显示提示、`mouseleave` 立即隐藏；移出绘图区同时清空悬停并收起准线。
2. 十字准线：悬停某个气泡时，横纵线与两轴数值块吸附到该气泡（显示它的综合单价与 Token，与提示一致）；不悬停时跟随指针，并换算成数值。数值写入直接操作 DOM，不触发重渲染。
3. 坐标轴改为独立留白区：左侧 56px、底部 40px；刻度 11px、次级文字色；新增两个轴名。
4. 坐标映射统一留出 12px 内边距（`calc(12px + (100% - 12px) × 比例)`），刻度、网格线、气泡、准线用同一条轨道，最大圆半径 12px，因此圆点不会画到坐标轴外；指针数值也按同一条轨道换算。
5. 标签规则：保留尾部片段、最多标注费用最高的 5 个、按位置距离避让重叠、靠近右边缘翻到左侧、靠近底部移到圆点上方。
6. 圆点居中修正：锚点就是数据点，圆用 `translate(-50%, -50%)` 居中；此前写成 `translate(-50%, 50%)`，圆被整体下移了一个直径，于是准线与数据点对齐、气泡却偏下。已用 Edge 无头渲染核对：十字准线交点与圆心重合，0/0 的圆完整落在坐标轴内。

验证：

- `npm test`：105 项全部通过（含新增 4 项纯函数测试）。
- 临时渲染脚本（不入库）覆盖：热区进入/离开的 `modelHover` 变化、无悬停时不渲染提示、吸附后两轴数值与气泡数据一致（¥14.40 / 300M）、指针模式下读数随位置换算、所有气泡与刻度的 12px 内边距轨道、标签尾部与翻转/上移、7 个模型只标 5 个。
- `npm run build`、`npm pack`、`node tests/install-smoke.mjs` 通过，产物为 `guojinpeng-dsh-cost-meter-0.4.7.tgz`。

### 12.2 散点图定稿（0.4.7 内二次修订，取代 4.2–4.5 与 12.1 的标签规则）

按评审意见调整口径与版式，仍不改服务端：

1. 横轴改为模型总消费（`micros`，按配置币种显示），对数刻度，刻度由 `logTicks(min, max)` 生成：十倍程 1–2 个用 1/2/5 倍数，2–4 个用 1/5，超过 4 个只取 1；刻度值四舍五入到 12 位有效数字，非法区间返回空数组。
2. 气泡大小固定 16px，颜色用 `--gdcc-ov-input`（与“未缓存输入”同色）；不再按费用缩放，`pointDiameter` 从纯函数模块删除。
3. `modelPoints` 不再返回 `priceMicros`（横轴已不用综合单价），返回 `{ route, micros, totalTokens, tokens, bucketMicros }`。
4. 标签：每个气泡旁显示模型名，候选位置为左右两侧、上下各 4 行（行高 15px）；按 x 从左到右依次占用，取第一个不压住已放置标签的位置，靠近右边缘（x 比例 > 0.82）优先标在左侧；标签宽按字符数 × 5.9px 估算，全部占用时允许重叠但不移出图内。
5. 绘图区高度 260px（内联样式，与标签布局共用同一常量）；容器上留白 30px，避免纵轴轴名与顶部刻度重叠；纵轴 4 个刻度。
6. 图例：绘图区下方按供应商分组，每个模型一个按钮，`aria-pressed` 表示是否显示，点击隐藏或显示气泡；隐藏不改变坐标轴范围。`toggleModel` 改为函数声明，修复首次渲染时模型卡早于常量初始化、点击图例抛 `Cannot access 'toggleModel' before initialization` 的问题。
7. 坐标映射统一为 `calc(12px + (100% - 24px) × 比例)`，左右各留 12px，最大圆半径 12px 时不出轴；十字准线与指针换算用同一条轨道。

渲染核验（Edge 无头，1.5 倍缩放）：1080px 与 700px 两种宽度下标签互不遮挡，最右模型名标在左侧；悬停提示与准线数值一致；图例点击隐藏两个模型后气泡消失、坐标轴不变；切换“总 Token”后构成、时段、模型三处百分比与数值同步切换。

### 12.3 散点图三次修订（0.4.7 内，取代 12.1.2 与 12.2.4）

按使用反馈再调整版式与配色，仍不改服务端：

1. 名称固定显示在气泡右上角（`left: GAP`、`bottom: 半径 + 2px`），不再左右挪动或上下避让；名称取模型名尾部片段，最多 20 字。
2. 横轴量程为标签预留空间：`labelRoom = min(0.35, (最宽标签 + GAP + INSET) / 800)`，`logSpan = (log10(花费上限) - log10(花费下限)) / (1 - labelRoom)`，再用新增的 `logAxisMax` 把右端抬到 1/2/5 的整数档（如 286.7 → 500），因此最右侧名称不会被裁。
3. 去掉十字准线吸附：准线与两轴数值始终按指针位置换算；读数块改到绘图区内侧（`.gdcc_ovCrossX{bottom:2px}`、`.gdcc_ovCrossY{left:2px}`），不再压住刻度文字。
4. 气泡颜色按位置渐变：`shade = 8 + 92 × (x 比例 + (1 - y 比例)) / 2`，与 `--gdcc-ov-input` / `--gdcc-ov-write` 做 `color-mix`，左上浅、右下深；气泡加 1px 同色系描边，最浅的圆点在浅色卡片上仍有轮廓。
5. 悬停提示新增“每 1M token 均价”一行（`tipAverage`，合计费用 ÷ 合计 token × 1e6）；提示框按自身尺寸夹在绘图区内，右侧或下方不足时翻到另一侧。

### 12.4 散点图安装后修复（0.4.7 内）

用户安装产物后浅色主题看不到气泡。根因：气泡背景写的是 `var(--gdcc-ov-cache-write)`，而样式表里实际变量是 `--gdcc-ov-write`；未定义的变量让整条 `color-mix` 在计算值阶段失效，`background` 回退成透明。此前的无头渲染在预览 HTML 里额外声明了 `--gdcc-ov-cache-write`，因此掩盖了问题。修复与顺带调整：

1. 背景改用 `var(--gdcc-ov-write)`，删掉预览里的同义变量后重新渲染，计算色为不透明蓝色。
2. 气泡加 1px `color-mix(in srgb, var(--gdcc-ov-input) 45%, transparent)` 描边，最浅的圆点在浅色卡片上仍有轮廓。
3. 纵轴顶端改用 `logAxisMax(maxTokens)`（353.31M → 500M），4 个刻度为 125M/250M/375M/500M，不再出现 88.33M 这类小数。
4. 横轴相邻刻度间距小于 5.5% 时，用靠右的刻度替换靠左的，避免右侧两个标签叠在一起。

5. 气泡配色（用户 m01509 要求）改为按每 1M token 均价着色，不再跟随位置或未缓存输入/缓存写入色：逐点计算 `oklch(L C H)` 写成 inline `background`，色相 185°→265°（青→靛）、明度 0.90→0.42、彩度 0.06→0.18，比例用均价对数归一化（`priceLogMin/priceLogSpan`）。CSS 的 `.gdcc_ovPoint` 只保留 `background: var(--gdcc-ov-read)` 作兜底。选它的理由：只改明度的单色相蓝在中段挤成一团（此前用户两次反馈“看着相近”），同时改色相与明度有两个独立通道，浅色和深色卡片上都可分辨，也不依赖红绿这种色觉缺陷敏感的对比。

验证：深色与浅色各渲染 1125px 与 700px 宽度，气泡计算色不透明且按均价由浅青到深靛；横轴刻度 ¥0.10/¥1/¥10/¥100/¥1000/¥10000 不重叠；悬停提示四行明细、合计与均价正常。

### 12.5 重叠气泡的合并提示（0.4.7 内）

用户要求：指针落在多个重叠气泡上时，提示同时列出每个模型的明细，上下排列。

1. 删掉每个圆点各自的 26px 透明热区（`.gdcc_ovPointHit`）：叠在一起时只有最上层能收到 `mouseenter`，其余永远触发不了。
2. 命中改在 `.gdcc_ovScatterPlot` 的 `mousemove` 里做：用与画点相同的 `INSET + span * fraction` 换算每个可见气泡的圆心像素，取与指针距离 ≤ `BUBBLE / 2 + 5`（13px）的全部气泡，按距离升序、同距离按 route 排序。
3. `modelHover` 由单个 route 改为 route 数组，`sameHoverRoutes` 做逐项比较后只在变化时 `setState`，指针在同一个气泡上移动不触发重渲染；同一数组同时驱动圆点高亮（`--on` 环）与提示。
4. 提示内每个模型一个 `.gdcc_ovTipGroup`（模型名 + 四行明细 + 合计 + 均价），相邻组之间 8px 间距加 0.5px 分隔线；组数 ≥ 3 时提示会高过绘图区，位置仍按原来的“默认在指针右下、越界翻面、最后夹紧”规则贴住绘图区左上角，允许向下溢出到坐标轴区域。
5. 图例隐藏的模型先被 `visible` 过滤，不参与命中和提示。

验证（Edge 无头渲染 1125px 深色与浅色）：三个几乎重合的气泡（消费 ¥100.0M/¥99.8M/¥100.2M、token 300M/299M/301M）悬停得到 3 组明细、3 个圆点高亮，组序为距离由近到远；单独悬停一个孤立气泡仍是 1 组；`npm test` 106 项通过。
