# Changelog

## 0.3.2

- 配置页复用 DSH 官方控件（保存表单、数值字段、开关、按钮、标记）；输入框、按钮、开关的尺寸、圆角、边框与字号同宿主设置页一致，深色模式跟随宿主主题。
- 取消自动保存：修改先保留在页面草稿中，点击页尾“保存”后写入配置；离开页面丢弃未保存的修改；保存失败显示错误并保留草稿，版本冲突时重新读取并提示再次保存。
- “基础配置”“高级配置”折叠区改为“模型单价”“通用”两个平铺分区，进入页面即显示全部内容。
- “同步价格”改为预览：结果先并入草稿并显示同步报告，保存后生效；不再弹出确认对话框。
- 无效的单价或汇率在对应输入框显示红色边框和说明文字，并禁用“保存”和“同步价格”。
- 增加“添加模型”输入框，可为没有调用历史的模型声明单价；声明的模型随配置保存，未被历史发现的模型可以删除。
- 单价数字右对齐并使用等宽数字；手动编辑过的单价显示“已手动设置”标记；切换币种不再改变价格来源。
- 配置页宽度限制为 760px，与宿主内置插件设置页一致。

## 0.3.1

- 会话费用和本轮费用明细改为峰价、谷价二级分组；没有峰谷字段的模型单独显示“固定价”组。
- 金额为 0 的价格行和整组不显示；移除高峰 token、谷期 token 行。
- 会话明细用横向分隔线代替“按模型”标题，按模型改为顶格显示 `provider/model` 名称，其下显示该模型各峰谷组的汇总金额；本轮明细按模型列出峰价、谷价各组的四项价格。
- 每个价格后有感叹号按钮：鼠标悬停只显示该价格的计算公式，点击不固定提示。
- 未确认时段的金额计入峰价组，仍保留“时段未确认 token”提示。

## 0.3.0

- 增加三套峰谷规则：DeepSeek 峰谷规则（默认）、阿里云峰谷规则、智谱 GLM 峰谷规则；每套规则单独一个文件，互不耦合。
- 每个模型行单独选择峰谷规则，三套规则的谷价系数统一为高峰价的 50%。
- 每个模型行都显示“自动计算谷价”开关（原“自动计算峰谷”改名）；打开后才显示“峰谷计费规则”，点击感叹号可查看所选规则的时段说明。
- 新模型条目的“自动计算谷价”默认关闭；同步价格不再自动开启该开关。
- 时段分桶由高峰/谷时两段细分为北京时间七个时钟段；projection 状态版本升到 4，回放历史日志重算费用。
- 基础配置和高级配置默认收起。
- 价格来源和“同步价格”控件及同步报告移到“模型单价”表格上方。
- 保存状态行移到两个配置区下方，插件详情页简介与“基础配置”之间不再留空。

## 0.2.0

- 增加 OpenRouter 和 DeepInfra 价格来源选择、独立缓存、单位转换及同步结果说明。
- 配置记录新模型的缓存来源和模型价格来源；切换来源不改已有价格，手动编辑单价标记为自定义。
- 同步等待前序自动保存成功，防止来源选择保存失败后误用旧来源。
- 按模型配置 USD 或 CNY，切换币种时按汇率转换单价；混合币种费用分别汇总。
- 配置页分为基础配置和高级配置，将缓存写入及峰谷开关放入模型行的高级配置。
- 删除价格归零、保存和重新加载按钮，改为串行自动保存并保留失败重试。
- 仅手动同步访问 models.dev；首次安装及新模型初始化只读取本地价格缓存。
- 将已确认的 DeepSeek 原厂谷价转换为高峰基准价，按北京时间和消费记录时间计算峰谷。
- 使用 holiday-cn 年度数据，缓存节假日和周末日期；缺少日历时异步获取并更新估算。
- 直接扩展原配置，不增加配置迁移程序；旧模型缺少币种时按 USD 读取，旧 DeepSeek 条目同步前保持固定价。
- 升级计费 projection 缓存版本，回放历史日志以恢复日期和时间段。

## 0.1.5

- 修复已有模型价格时，重启 DSH 仍显示“初始化中”的问题。
- 配置接口返回前，直接展示后端根据本地配置计算的会话费用和本轮费用。
- 所有历史模型已有价格时，跳过 models.dev 价格初始化；零价格也视为有效配置。
- 保留首次安装和新模型缺价时的价格初始化与提示。
- 增加重启、零价格、首次安装和配置请求延迟的回归检查。

## 0.1.4

- Use npm as the installation channel and GitHub Releases for release notes.
- Simplify `pack:release` to create only the versioned npm tarball.
- Separate server configuration storage, schemas, usage events, projection, and HTTP handling.
- Separate client styles, locale dictionaries, formatting, cost dialogs, configuration state, and page components.
- Keep the existing HTTP payloads, pricing rules, configuration paths, and desktop layout.
- Test client modules through imports instead of rewriting their source text.

## 0.1.3

- Add `npm run pack:release` to create a versioned npm tarball and an identical, fixed-name GitHub Release asset.
- Use a stable latest-release download URL in the English and Chinese installation instructions.
- Document the npm and GitHub Release publishing steps.
