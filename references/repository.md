# 公开仓库与文件边界

本目录就是独立公开 Git 仓库的根目录，直接在此管理提交和远程地址；上级维护目录没有 Git，Pro 是相邻的独立私有仓库。本仓库的公开范围是下列源码和社区资料：

| 范围 | 内容 |
| --- | --- |
| 根目录 | .gitignore、LICENSE、README.md、README.en.md、SKILL.md |
| agents、references | Skill 入口、图文与视频说明、安装与仓库说明、更新记录 |
| scripts、tests | 公共运行代码、图文与视频实现、自有模拟测试 |
| assets/vendor | 不可修改的 MIT 上游快照及来源散列 |
| assets/twitter-text | X 字数计算 bundle、构建与来源清单，以及 Apache-2.0 / MIT 第三方许可；见[第三方说明](third-party-notices.md) |
| .github | 贡献、安全与行为准则、模板、CI 和 Actions 更新配置 |

提交前在本仓库检查 `git status --short`、`git diff` 和 `git diff --cached`，确认只包含公共源码与资料。168 同步发布 的运行和测试均不依赖 Pro。

版本来源为根 SKILL.md 的 `metadata.version`，使用带引号的 `主版本.次版本.修订号` 字符串；更新时同步 README 与更新记录，导出结果读取当前版本。

需要额外的源码副本时，在本仓库目录运行，将源码导出到一个不存在的新目录：

```bash
node scripts/distribution.mjs /absolute/path/public-source
```

导出入口仅复制明确范围，拒绝软链接、隐藏文件和意外文件类型；不覆盖已有输出，也不携带 Git 元数据。它是可选的源码副本工具，不是提交本仓库的前置步骤。导出检查不能识别所有写在代码里的私人内容，提交前仍需查看文件清单和 diff。

私人素材、内容包、配置、任务、日志、截图、验收证据、安装包及其提取代码不进入公开源码。168 同步发布 不导入 Pro 或依赖维护者私有路径。用户数据留在仓库外。

自有代码和文档使用根 MIT 许可。固定上游来源见 assets/vendor/upstream.json，不修改、删减或替换快照；散列证明文件一致，不证明没有漏洞。`assets/twitter-text` 保留独立的 Apache-2.0 / MIT 许可，来源、构建清单与许可文件见[第三方说明](third-party-notices.md)。只启用公共根 Skill，嵌套上游入口禁用方法见 README。
