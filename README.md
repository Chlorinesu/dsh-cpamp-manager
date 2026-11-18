# DSH CPAMP Manager · Beta

[English](#english) · [简体中文](#简体中文)

> Unofficial community integration. Not an official DeepSeek Harness or CPA Manager Plus release.
> 非官方社区适配项目，与 DeepSeek 或 CPA Manager Plus 官方没有隶属关系。

## 简体中文

将 **CPA Manager Plus v1.14.10 的完整前端**原生适配到 DeepSeek Harness。复用原版页面、组件与业务交互，不是 iframe，也不是独立仿画的精简看板。现有 CPAMP Full Mode 服务仍负责数据、凭据与后端业务。

### 这是测试版

首个公开版本为 `0.1.0-beta.1`，功能基线来自本地开发版 2.1.0。建议先在非生产环境测试。代码构建、自动化测试及静态体验审查不等于全部页面已经完成真实浏览器验收；供应商修改、账户删除、OAuth、导入导出等操作未在测试者的真实服务上逐项验证。

### 安装预构建版本

1. 在本仓库 **Releases** 页面下载 `dsh-cpamp-manager-0.1.0-beta.1.tgz`。
2. 通过 Harness 插件管理安装本地包；如果当前 GUI 不接受 `.tgz`，可以使用 CLI：

   ```sh
   dsh plugin --profile desktop add ./dsh-cpamp-manager-0.1.0-beta.1.tgz
   ```

   将 `desktop` 替换为你实际使用的 profile。安装后重启 Harness，并重新打开页面。
3. 在与「插件」「自动化任务」同级的 **CPAMP 管理** 页面中填写你自己的完整模式 CPAMP 地址和 **CPAMP Admin Key**。
4. 预构建包不需要编译工具，不包含安装/prepare 脚本。请核对同一 Release 的 `SHA256SUMS.txt`，并仅安装你信任的代码。

**不要与开发版 `@local/cpamp-monitor` 同时启用。** 两者共享插件行、页面入口、Host 路由和只读工具。若迁移开发版，请先禁用/卸载旧包，不要点击断开连接；保留逻辑凭据记录 `cpamp-monitor/connection`，以便新包继续使用原连接。该逻辑键不是密钥，公开包不包含任何实际连接凭据。

### 能力

- 仪表盘、请求监控、用量分析和模型价格。
- 供应商、模型、账户/凭据、额度与健康检查、账户处理队列。
- OAuth、可视化配置、YAML/差异编辑、API Key 配置、日志。
- 插件商店与管理、系统页、请求历史导入导出、数据维护和更新页面。
- 页面顶部可切换 **雾灰（默认）、冰蓝、暖砂、跟随 Harness**；明暗模式跟随 Harness。选择只在当前浏览器 origin 内保存，不含服务地址或密钥。

菜单和实际功能由远程 CPA/CPAMP 的版本、配置和功能标志决定。费用是 CPAMP 按模型价格计算的估算，不是实际账单或剩余额度。

### 兼容性与边界

- 已按 DSH `0.2.2-rc.3` 的插件接口开发，manifest 声明 `>=0.2.2-rc.3 <0.3.0`；其他版本仍需验证。
- 前端固定在 CPAMP `v1.14.10`；较新或较旧后端的全部接口不保证兼容。
- 远程连接要求 HTTPS；HTTP 仅允许本机 loopback。不关闭 TLS 校验。
- 第三方 CPAMP 插件自带 HTML/JS 页面在原站打开，不加载到 Harness 同源环境。
- 任意外域直连模型发现、私网 provider helper 等受限路径可能需要原站。已核实的固定管理接口通过 Host 桥接，不提供任意 URL/路径代理。
- 安装后有变更时重启 Harness。上游业务行为或界面差异请在此仓库提交 issue，不要把本适配错误直接当成上游问题。

### 安全提示

CPAMP Admin Key 保存在 Harness Host 凭据记录，不回传给页面、不写入插件配置或浏览器持久化存储。页面仍然具有完整管理员界面：它可能按用户操作显示供应商密钥、下载凭据或修改服务，请只在你授权管理的环境使用。

写操作与敏感导出需要界面确认；这是人类交互门槛，不应当作对任意恶意本地插件的安全沙箱。**未新增 Agent 写工具**；`cpamp_monitor` 仅查询状态与脱敏用量。

提交 issue 时请清理截图、请求正文、API Key、账户快照和服务地址中的敏感信息。

### 从源码构建

仓库含源码和预构建产物。Release `.tgz` 仅含运行文件与许可证，不是开发环境。

```sh
# 在 build-tools 目录；使用符合依赖要求的当前 Node.js / pnpm
pnpm install --frozen-lockfile --ignore-scripts --node-linker=hoisted
# 返回仓库根目录
node build-tools/build.mjs
node --test --test-isolation=none test/*.test.js
```

本次验证环境为 Node `24.21.0`，依赖安装禁用 scripts。Windows 限制子进程管道的沙箱可能阻止 esbuild，需要在你明确允许的构建环境中运行；不要全局关闭安全措施。

`upstream/src` 是未改动的上游源码，适配位于 `frontend` 与 `build-tools`。`dist/build-report.json` 记录实际构建输入和哈希；`upstream/SOURCE_SHA256.json` 用于独立校验上游源码。

## English

A native adaptation of the **CPA Manager Plus v1.14.10 frontend** for DeepSeek Harness. It retains upstream routes/components and connects to your existing CPAMP Full Mode server through a Host-owned bridge.

- Download the prebuilt `.tgz` from Releases, install it into your Harness profile, restart Harness, then configure your own CPAMP server URL and Admin Key in **CPAMP manager**.
- The package has no install scripts and no embedded server URL or credentials.
- Do not enable it alongside `@local/cpamp-monitor`; shared row IDs, routes and the read-only tool would conflict.
- Four local page palettes are available. Appearance preferences are non-secret and browser/origin-local.
- Third-party plugin-provided HTML/JS pages open on the original CPAMP site. Some external/private-network provider tests remain intentionally restricted.
- Agent tools remain read-only. Human writes require confirmation, but this is not a sandbox against malicious local code.
- This is a beta, not an official product of DeepSeek or CPA Manager Plus. Browser visual verification and production writes are not fully validated. Start in a non-production environment.

## License & attribution

- Original adaptation code: MIT, see `LICENSE`.
- CPA Manager Plus: MIT, Copyright 2026 Seakee; see `upstream/LICENSE` and [upstream project](https://github.com/seakee/CPA-Manager-Plus).
- Bundled dependency licenses and notices are retained in `upstream/DEPENDENCY_LICENSES.txt`.
- See `THIRD_PARTY_NOTICES.md` for provenance and additional details.
