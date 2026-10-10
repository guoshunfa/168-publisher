# 第三方计数实现

公共根 MIT 许可不替代以下第三方许可。固定视频上游保持原文件和原 MIT 许可，来源及散列见 `assets/vendor/upstream.json`。

`assets/twitter-text/bundle.mjs` 是从官方 npm 精确版本构建的独立 ESM，仅导出 `parseTweet`，用于 X 普通动态的官方 v3 加权字符、URL 和 emoji 识别规则，无运行时 npm 依赖。原版权与许可证完整保留：

| 纳入包 | 固定版本 | 许可文件 |
| --- | --- | --- |
| twitter-text | 3.1.0 | [Apache-2.0 / Twitter](../assets/twitter-text/twitter-text-LICENSE.md) |
| core-js | 2.6.12 | [MIT / Denis Pushkarev](../assets/twitter-text/core-js-LICENSE.md) |
| punycode | 1.4.1 | [MIT / Mathias Bynens](../assets/twitter-text/punycode-LICENSE.md) |
| twemoji-parser | 11.0.2 | [MIT / Twitter](../assets/twitter-text/twemoji-parser-LICENSE.md) |

[构建与来源清单](../assets/twitter-text/manifest.json)记录官方 registry tarball、各输入 integrity、固定 esbuild 版本/完整性、关闭生命周期脚本的临时安装命令、构建命令和输出 SHA-256。使用 npm 官方版本，不修改既有 `assets/vendor/`，不引入项目 node_modules 或构建链。构建时的 Babel/runtime 工具包未进入最终依赖闭包。

上游：[twitter/twitter-text](https://github.com/twitter/twitter-text)、[v3 config](https://github.com/twitter/twitter-text/blob/master/config/v3.json)。此固定版本的识别规则不等同后续所有新 emoji、Premium 字段或所有账号能力，仍保留原生编辑器门及未知规则提示。
