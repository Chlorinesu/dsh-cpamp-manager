# v0.1.0-beta.1 · First public beta

This is an **unofficial community integration** of CPA Manager Plus v1.14.10 into DeepSeek Harness, based on the private development baseline 2.1.0. It is not an official DeepSeek or CPAMP release.

## Included

- Native Harness global panel beside Plugins and Scheduled tasks.
- Original CPAMP routes and components for monitoring, providers, accounts, OAuth, configuration, logs, plugins and maintenance.
- Host-owned connection credentials and fixed management-interface bridge; no embedded server URL or credentials.
- Four local appearance presets: Mist gray, Ice blue, Warm sand and Follow Harness, with Host light/dark synchronization.
- Existing read-only `cpamp_monitor` Agent tool; no Agent write tools.
- Prebuilt runtime installation package with upstream/dependency licenses and a SHA256 checksum file.

## Installation

Download `dsh-cpamp-manager-0.1.0-beta.1.tgz`, verify `SHA256SUMS.txt`, then install into your Harness profile:

```sh
dsh plugin --profile desktop add ./dsh-cpamp-manager-0.1.0-beta.1.tgz
```

Restart Harness and configure your own CPAMP Full Mode URL and Admin Key inside the panel. Do not enable this package alongside `@local/cpamp-monitor`; they use the same row IDs, routes and tool. See README for migration instructions.

## Tested baseline and limitations

- Developed against DSH 0.2.2-rc.3 and CPAMP frontend v1.14.10. The manifest declares the DSH range, not a guarantee that every release in that range has been tested.
- Automated and static checks do not constitute complete browser visual verification or validation of production management writes.
- Start in a non-production environment. Human write confirmations are not a sandbox against malicious local software.
- Third-party plugin-provided HTML/JS opens on the original CPAMP site. Some external/private-network provider tests remain intentionally restricted.
- Costs are upstream estimates, not bills or balances.

## 中文摘要

首个公开测试版，原生适配 CPAMP v1.14.10 完整前端，包含预构建安装包、四套页面配色、Host 凭据保存和管理桥接。请先在非生产环境测试；不要与本地开发版同时启用。界面写操作需确认，Agent 工具仍只读。完整安装、权限及限制说明见 README。
