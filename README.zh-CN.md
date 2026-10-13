# @guojinpeng/dsh-cost-meter

[English](README.md) | [简体中文](README.zh-CN.md)

此插件用于估算 DSH 的会话费用和每轮费用。
需要 DSH 0.2.0-rc.2 或更高版本。
已在 DSH 0.2.0-rc.2 上测试。

## 安装

1. 安装 npm 包：

```powershell
dsh plugin --profile web add -w @guojinpeng/dsh-cost-meter
```

2. 重启 DSH。
3. 打开**插件**页面。
4. 选择 **@guojinpeng/dsh-cost-meter**，修改模型单价。

将 `web` 替换为你使用的 profile 名称。
如果已安装旧版无 scope 的插件，请先禁用旧版，再安装此插件。

通过 npm 安装已发布版本，npm 提供构建后的安装包。
GitHub 用于保存源码和发布说明。

## 功能

- 显示会话费用和已完成轮次的费用估算。
- 加载价格时显示简短的“初始化中”提示。
- 显示输入、输出、缓存读取和缓存写入的费用明细。
- 按提供方分组显示模型。模型列表来自 DSH 调用历史。
- 按完整的 `provider/model` 名称分别设置单价。
- 从 models.dev 初始化价格。优先读取本地目录缓存。
- 仅同步当前配置中的模型。覆盖价格前要求确认。
- 按模型 ID 匹配第三方价格。优先使用原厂按量价格。匹配不明确时保留已有价格。
- 第三方数据无法提供受支持的单价时，保留已有价格。
- 模型单价使用 USD / 百万 token。费用支持 USD 和 CNY 显示。
- 保存或同步价格后，立即更新费用估算。
- 支持价格归零，以及分别控制会话和轮次费用标签的显示。
- 配置保存在 `~/.dsh/guojinpeng/dsh-cost-meter/config.json`。设置 `DSH_HOME` 后，使用该目录。
- 新配置不存在时，首次启动会复制旧的 `~/.dsh/dsh-cost-meter/config.json`。保留旧文件。
- 插件、客户端、接口、费用 projection、样式和配置使用独立命名空间。

以下截图使用示例模型价格，不代表实际账单。

会话费用明细：

![会话费用卡片](docs/images/session-cost.png)

本轮费用明细：

![本轮费用卡片](docs/images/turn-cost.png)

模型单价配置：

![桌面端模型单价配置](docs/images/model-prices-desktop.png)

## 从源码开发

安装 Node.js、pnpm 9 和 Git。运行测试前，先全局安装 DSH：

```powershell
npm install -g @deepseek-ai/dsh@0.2.0-rc.2
git clone https://github.com/guojinpeng/dsh-cost-meter.git
cd dsh-cost-meter
pnpm install --frozen-lockfile
```

修改 `src/` 中的代码。运行测试并生成安装包：

```powershell
npm test
npm run build
npm pack
```

`npm pack` 也会执行构建，生成 `guojinpeng-dsh-cost-meter-<版本号>.tgz`。
将生成的文件安装到你的 DSH profile。以 0.1.4 为例：

```powershell
dsh plugin --profile web add -w ./guojinpeng-dsh-cost-meter-0.1.4.tgz
```

重启 DSH，检查插件。每次修改后，重新构建、打包并安装。
测试使用全局安装的 DSH。如果安装位置不同，将 `DSH_RUNTIME_ROOT` 设置为 DSH 包目录。
提交源码和 `pnpm-lock.yaml`。不要提交生成文件或本地配置。
模块职责、依赖边界和验证命令见[模块维护说明](docs/architecture.md)。

## 发布到 npm

使用有权发布 `@guojinpeng/dsh-cost-meter` 的 npm 账号。
在项目目录执行：

```powershell
npm login --registry=https://registry.npmjs.org/
npm whoami --registry=https://registry.npmjs.org/
npm view @guojinpeng/dsh-cost-meter version --registry=https://registry.npmjs.org/
```

包尚未发布时，`npm view` 可能返回 `E404`。
更新已发布的包时，新版本必须高于已发布版本。
修改 `package.json`。也可以用以下命令递增补丁版本，不自动创建 Git 标签：

```powershell
npm version patch --no-git-tag-version
pnpm install --lockfile-only
npm test
npm run pack:release
```

检查安装包的文件列表。`pack:release` 执行 `npm pack`，生成带版本号的 npm 安装包。
提交并推送版本变更，然后发布该安装包。
执行前，将 `<version>` 替换为本次的新版本号：

```powershell
npm publish ./guojinpeng-dsh-cost-meter-<version>.tgz --access public --registry=https://registry.npmjs.org/
npm view @guojinpeng/dsh-cost-meter version --registry=https://registry.npmjs.org/
```

根据提示完成 npm 身份验证。
同一包版本只能发布一次。
npm 发布成功后，创建对应的 Git 标签和 GitHub Release：

```powershell
git tag v<version>
git push origin v<version>
gh release create v<version> --verify-tag --title "v<version>" --generate-notes --latest
```

执行前替换 `<version>`。GitHub Release 用于发布说明，无需上传安装包。
npm 托管安装包，插件市场通过 npm 包的 `repository` 字段关联仓库。

发布后，用户可执行以下命令安装：

```powershell
dsh plugin --profile web add -w @guojinpeng/dsh-cost-meter
```
