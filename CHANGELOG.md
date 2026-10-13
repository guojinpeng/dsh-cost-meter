# Changelog

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
