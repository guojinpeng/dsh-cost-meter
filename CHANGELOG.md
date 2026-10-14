# Changelog

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
