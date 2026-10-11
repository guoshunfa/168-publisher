# 安装说明（供 AI 读取）

安装根 `$168-publisher` 到当前 AI 工具的全局 Skills，遵守该工具和用户已有的安装规则。远程来源必须是真实且有权访问的地址，不推测尚未建立的仓库 URL。已有同名安装先核对内容，不覆盖用户修改。

本公开源码可独立运行，不下载或导入相邻的 Pro 目录。

## 运行依赖

仅支持 macOS 和 Node.js 24；默认视频首帧封面另需 PATH 中可用的 FFmpeg（可通过 `brew install ffmpeg` 安装），无需 npm install 或构建。页面操作使用已安装的 ego-browser Skill 和 Ego CLI；首次引导与平台登录由用户完成。AI 可以检查缺失项，但安装期间不准备草稿或点击发布。

提供已完成的图文和视频文案；视频默认提取首帧作为封面，也可提供自己的封面图片。本 Skill 不创作视频或设计封面。单张视频封面可用 macOS 自带 sips 缩小、补边适配所需比例，不改原图。

## 依赖入口隔离

`assets/vendor/video-publisher/SKILL.md` 是固定上游依赖，原规则与本项目不同。只启用本项目根入口，不安装或调用嵌套 Skill；保持上游字节不变。按当前 AI 工具的入口发现与禁用机制隔离，然后验证根入口加载成功且嵌套入口未启用。不能完成隔离时明确报告，不声称安装完成。

Codex 的远程安装使用其内置 skill-installer；本地维护沿用用户指定的全局软链接。Codex 的嵌套禁用配置位于 ~/.codex/config.toml，路径必须替换为安装后的实际绝对路径：

```toml
[[skills.config]]
path = "/absolute/path/168-publisher/assets/vendor/video-publisher/SKILL.md"
enabled = false
```

已有同路径条目时更新，不重复添加。其他 AI 工具使用各自机制，不照搬此配置路径。

## 安装验证

使用当前 AI 工具的加载检查或刷新机制核对根入口。工具不支持 `$名称` 调用时，明确读取已安装目录的 SKILL.md 并按其流程执行；能读文件不等于已接入全局发现。检查 `node --version`、`command -v ego-browser`，说明尚需用户处理的首次引导或登录。

配置入口为 `node scripts/publisher.mjs config`，只读回或首次创建用户配置，不操作平台。普通调用时由 AI 读取配置并显式传入请求参数。配置、素材和任务留在源码外，不随安装包分发私人数据。
