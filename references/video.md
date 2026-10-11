# 视频操作

模板在“类型”上方填写 `是否全自动：否`，省略也是“否”。本页原有确认、配置即交回及人工发送说明适用于默认“否”；“是”使用根 Skill 的全自动流程，由调度器连续预检、配置、等待核验、最终发布与回执检查，只有问题才暂停。底层 `handoff` 仍只交接控制，不发送。全自动开关只存当前请求；旧 JSON 入口不启用。

命令相对于本 Skill 目录。需要 macOS、Node.js、FFmpeg（提取视频首帧）和已可用的 Ego CLI；不安装额外 npm 依赖。

正常使用 `publisher.mjs run`：解析类型、平台与 Profile 后先 `preflight` 在一个空间建齐页面，自动识别登录状态并检查内容；缺项/不合格集中提示但不阻止只读登录检查。按 Skill 的三列表格（平台、登录状态、标题）与“发布内容与说明”让用户确认；正文、标签等统一列于表下，正文不用代码包裹；有实际待处理问题时，最后逐项列在加粗的“需要处理的问题”下，不使用引用块或警告框，末行写“完成后回复继续”；没有问题时省略问题区，末尾只写“目前没有需要处理的问题，回复‘继续’会继续执行。”，不追加确认规则、Skill 引用或未上传等状态说明。确认后复用原空间，再顺序填写与提交视频，立即交回查看。仅短等待页面/填写控件，不轮询上传、转码、服务端回执或 `duration`。`configured` 不表示服务器完成或已发布；未能配置的字段如实报告。下面的底层 prepare/inspect/repair/handoff 为显式维护入口，不是正常流程的完成条件。

## 配置与内容包

调用输入固定为四组：**内容、标签、媒体、平台**。README 的“类型、标题、内容”归入内容组：类型写“视频”，标题提供共享标题，内容填写所选平台要求的正文/简介或平台专属覆盖；标签只用用户给出的名称，以 `、` 分隔或写“无”；媒体提供一段视频；可选“封面 / Cover”填写“默认”或一张本地 JPEG/PNG 图片；平台用 `、` 列出目标，“所有平台”取配置 `platforms.video`。四组是入口分组：必填文案仍须完整；常规平台设置沿用程序与持久默认，不从媒体推断，也不逐次补问。

| 平台 | 内容组所需文字 | 标签 | 额外条件 |
| --- | --- | --- | --- |
| 小红书 | 标题必填；当前适配器没有普通正文写入路径 | 至少一个真实话题 | 原创声明需有依据；自定义封面 3:4 |
| 抖音 | 标题必填；简介可选 | 1–5 个真实话题 | 自定义封面需 3:4 与 4:3 |
| B站 | 标题与简介必填 | 1–10 个标签 | 当前声明固定为自制，非原创内容不适用；分区不会自动选择；自定义封面需 4:3 与 16:9 |
| 视频号 | 内容包标题用于任务身份；完整描述必填；界面短标题可留空 | 真实话题必填 | 原创声明需有依据；自定义封面需 3:4 与 4:3 |
| YouTube | 标题、无链接说明和儿童受众必填 | 可选 | 可见性默认公开；分类、语言可使用配置；自定义缩略图需 16:9 |

如果内容项没有包含所选平台所需的标题或简介，先让用户提供该文本；不把标题复制成简介，除非用户明确要求两个字段使用同一段文字。小红书视频不支持额外正文的现有限制要如实说明，不静默丢弃用户提供的正文。

## 默认设置

标准六字段视频输入不需要额外填写 YouTube 受众、推广或逼真合成选项。程序实际 `check/run/prepare` 使用：本次明确值 > `video.json` 的 `defaults` > 已有 `platforms.youtube` 偏好 > 内建默认值。显式 `false`、空分类/语言/播放列表、空视频号短标题与 `cover.uploadCustomCover:false` 都保留。

| 内容包/defaults 字段 | 内建默认 |
| --- | --- |
| `youtubeAudience` | `not_made_for_kids` |
| `youtubePaidPromotion`, `youtubeAlteredContent` | `false` |
| `youtubeVisibility` | `public` |
| `youtubeLicense` | `standard_youtube` |
| `youtubeAllowEmbedding`, `youtubeNotifySubscribers` | `true` |
| `youtubeCategory`, `youtubeLanguage`, `youtubePlaylist` | 空字符串 |
| `cover.uploadCustomCover` | `true`，未提供图片时提取视频首帧 |
| `wechatShortTitle` | 空字符串，不填写可选短标题 |
| `original` | `true`，支持原创的小红书/B站/视频号按原创/自制配置 |

`aiGenerated` 没有内建内容事实；仅用户明确内容包值或持久默认值可配置 B站的 AI 声明，不从标题、标签或文件名推断。`original:false` 与当前小红书/B站/视频号固定原创适配器不相容时，检查直接报错；不会偷偷覆盖为原创。抖音沿平台当前常规设置，不新增未支持的声明选项。

```bash
node scripts/video.mjs config status
node scripts/video.mjs config set-defaults --json '{"youtubeAudience":"not_made_for_kids","youtubePaidPromotion":false,"youtubeAlteredContent":false,"youtubeVisibility":"public","cover":{"uploadCustomCover":true},"wechatShortTitle":""}' --originality-policy all_videos_original
```

`set-defaults` 合并保存到原 `video.json`，保留账号/平台/素材目录等既有偏好，并回读 `effectiveDefaults`；未知字段、错误类型或无效现有配置直接拒绝，原文件不变。`publisher.mjs config` 也显示视频配置实际路径及有效默认。已有配置的 `declarations.originalityPolicy: ask_each_run` 不会被静默改写：采用上述迁移命令设为 `all_videos_original` 后无需逐次权利确认；用户仍可显式改回 `ask_each_run`，此时每次上传需 `--confirm-original-rights`。缺少该字段的新配置使用 `all_videos_original`。

新任务在私有状态保存完整有效内容包与原创策略；之后修改持久默认不影响该任务恢复。旧任务无快照时仍用原解析规则并核对原指纹；不能因升级套入新默认、改原标题正文标签或新建上传。原设置无法重建时明确停止。

```bash
node scripts/video.mjs config status
node scripts/video.mjs config onboard --source-dir /absolute/path/videos --available-platform bilibili --platform bilibili --originality-policy all_videos_original --check-concurrency 1 --upload-concurrency 1
node scripts/video.mjs config add-platform youtube
```

`onboard` 会写入新配置；已有配置用 `add-platform` 追加，避免重置。可配置的平台：`xiaohongshu`、`douyin`、`bilibili`、`wechat_channels`、`youtube`。配置“可用”不证明登录或发布能力已验收。

默认配置 `~/.config/168-publisher/video.json`，任务 `~/.168-publisher/video-jobs/`。排查时可用 `PUBLISHER_VIDEO_CONFIG` 和 `--state-root` 指定隔离路径。浏览器发布锁与原版共享，防止同时操作。

内容包存放在仓库之外；只写所选平台字段。标题、简介和标签均由用户提供；封面默认取视频首帧，用户提供图片时优先使用；不分析视频画面、音轨、文件名或字幕来创作或改写内容。媒体只做准备所需的技术核验。必填文案缺失时先询问，不从视频补写。B站 `bilibiliAllowedAutoTags` 保持空数组，只使用用户提供的 `bilibiliTags`。最小 B站例子：

```json
{
  "videoPath": "/absolute/path/video.mp4",
  "title": "用户确认的标题",
  "bilibiliDescription": "用户确认的简介",
  "bilibiliTags": ["工具", "教程"],
  "bilibiliAllowedAutoTags": [],
  "cover": { "uploadCustomCover": true }
}
```

类型字段决定视频工作流；动态里的 MP4 仍走动态入口。标题与正文长度按 [平台发布规则](platform-rules.md)及现有预检查，不使用统一上限。视频和封面必须为绝对路径，真实换行使用 JSON 的 `\n` 编码。`uploadCustomCover=false` 使用平台默认封面；设为 `true` 时可提供单张 `sourcePath`，或沿用完整比例和槽位；没有提供封面图片时提取视频首帧。详见 [内容包](../assets/vendor/video-publisher/references/content-package.md) 与 [封面流程](../assets/vendor/video-publisher/references/cover-workflow.md)。

```bash
node scripts/video.mjs check bilibili /absolute/path/package.json
```

## 单张自定义封面

视频模板的 `封面：默认`（英文 `Cover: default`）、留空或省略字段均使用首帧，覆盖已保存的封面开关。程序用 FFmpeg 解码第一帧，缓存为 PNG，再上传到各平台封面项。用户提供图片时优先使用原图，不提取首帧；高级 JSON 的显式 `uploadCustomCover:false` 和历史任务保持兼容。提供一张图片时映射为：

```json
{"cover":{"uploadCustomCover":true,"sourcePath":"/absolute/path/cover.png"}}
```

`check` 自动用 macOS 自带 `sips` 解码 JPEG/PNG，生成 1080×1440、1440×1080、1920×1080 三种比例副本，供现有五平台槽位使用。自定义图片适配不需要 FFmpeg。图片完整居中，按需等比例缩小并补黑边，不放大、不裁切、不修改源文件。回报封面原路径与适配方式，生成副本不算额外媒体。

首帧按视频 SHA-256 缓存，提取失败或 FFmpeg 不可用时停止并提示提供图片或安装 FFmpeg，不回退到平台封面。

副本以源图片 SHA-256 缓存到 `~/.168-publisher/cover-cache/`，与 Skill 源码分离。重用前核对副本散列；旧任务保留原副本和源图片指纹，源图或已确认素材改变时停止。不要删除仍被任务引用的封面副本。`PUBLISHER_COVER_CACHE` 仅用于隔离测试或自定义缓存位置。

仍支持原有 `vertical3x4Path`、`horizontal4x3Path`、`horizontal16x9Path` 及平台覆盖；它们与单张 `sourcePath` 互斥。动态自定义封面尚未接入，不能将封面图片当动态素材追加。

## 正常配置与恢复

```bash
node scripts/publisher.mjs run --package /absolute/path/package.json --platforms bilibili,youtube --job-id example-video --resume-control
```

先执行 `publisher.mjs preflight --package FILE --platforms bilibili,youtube --job-id REQUEST`。它先调用各目标现有 `check`，随后只读检查登录，不上传/清理/填字段/一键登录；正文等未齐也可运行，但 `contentStatus:needs_input` 会列出缺项。顶层 `status` 保留登录状态合同，必须同时解释 `contentStatus` 与每平台 `contentAudit`，不能把登录成功说成内容全部通过。结果保留原 Job ID 与 pageLabel；确认完整内容后使用同 Job ID 的 `run --resume-control` 复用原空间。进度显示当前平台与步骤，并把当前页面带到前台。后台上传继续时即可结束配置；缺少必需控件时最多短等15秒，字段及封面原生动作共用30秒操作窗口。YouTube填写详情后仅推进当前可用的“下一步”并设置可见性；按钮因后台状态不可用时立即报告可见性未配置，不等待转码。普通内容交回前解除Agent保护，用户无需再次请求交接。测试稿保留保护但仍交回查看。

部分任务交回后，用户处理登录/字段阻塞并明确继续，使用原 `publisher.mjs run --resume-control` 和原Job/内容/空间；已经派发且结果未知的媒体不重复上传；控件准备失败且未派发文件可重试。恢复要有当前原文件输入、精确文件名或上传开始关联，不能用 attempted 标记证明文件已提交。已 configured 且已交回的平台整项跳过。已全部配置并交回的任务不再次自动准备。

## 显式维护：准备、恢复和独立核验

```bash
node scripts/video.mjs prepare --package /absolute/path/package.json --platform bilibili --profile "Profile name" --job-id example-video
node scripts/video.mjs prepare --package /absolute/path/package.json --platform bilibili --job-id example-video --operation resume
node scripts/video.mjs inspect --package /absolute/path/package.json --platform bilibili --job-id example-video
```

启用 `ask_each_run` 时，`--confirm-original-rights` 只能在用户确认本次权利后使用；默认长期原创策略无需此标记。它不授权发送。可选 `--task-suffix` 描述任务。多平台使用 `--platforms bilibili,youtube`，允许只选一个；各平台单独核验。首次指定 Profile 会记在 Job 控制记录，恢复时再次检查该 Profile 仍为默认。

统一入口通过 `--space 数字ID` 将视频平台放在同一空间，固定上游的原生 `--space-name` 能力沿用同一名称，各平台按独立标签页恢复。新任务首次进入编辑器通过自有兼容层清理历史编辑内容；恢复原任务不清理本次素材。prepare 复用上游上传、字段、封面和恢复逻辑，始终保留页面并禁止清理旧空间选项。READY 任务不重复创建。换封面沿用 `--operation replace-cover --job-id`，必须仍处于未交接的原草稿；需要新的副本时必须先明确确认并指定新的 Job ID，再使用 `--operation repost --confirm-new-copy`。

inspect 只核验已记录的原空间和唯一平台页，不创建页面，不上传或改写正文；仅维护最终按钮保护。核验结果写入 `manual-verify-<platform>.json`，草稿变更导致缺项时报告 blocker，不自动修复。

当前 B站实测中，旧 `execCommand` 多行简介可能在页面重绘后丢失部分内容，标签键盘提交也可能不持久化。上游快照不改动；仅这两个字段失败且其他门槛通过时，可使用新增兼容入口：

```bash
node scripts/video.mjs repair-metadata --package /absolute/path/package.json --platform bilibili --job-id example-video
```

入口先核验原视频与保护状态，再调用当前可见 Quill 编辑器和 B站原生标签组件，最后由原版核验器独立回读。标签仍未保留就继续报告缺项，不删除标签或修改文案。它不上传视频、换封面或点击最终按钮。

用户明确修改已确认的 B站简介或标签时，保留原内容包，另存新 JSON，再在 repair-metadata 命令追加 `--accept-metadata-revision`。当前只允许单平台 B站 Job：比对原包身份，确认视频字节和封面不变，其他字段不得变更；原草稿核验通过后才记录内容修订。未确认的改写、其他平台字段和素材变化均拒绝。旧失败证据和内容包保留。

YouTube 当前页面的文件名和付费宣传控件与固定上游不同。新入口的独立核验在上传弹窗内读取 `#original-filename`，兼容付费宣传单选项；上游文件保持不变。若 prepare 已上传却返回 `FOREIGN_DRAFT`，先执行 inspect，不直接重传。原视频身份、上传/转码完成、登录和保护门槛全部通过后，可恢复详情与可见性步骤：

```bash
node scripts/video.mjs repair-youtube --package /absolute/path/package.json --platform youtube --job-id example-video
node scripts/video.mjs inspect --package /absolute/path/package.json --platform youtube --job-id example-video
```

该入口复用原版元数据、缩略图和可见性流程，仅在原任务内修复，不上传视频或点击最终保存。正在转码时保留处理中，完成后再恢复；原素材或内容包变化会拒绝。当前实测包括默认缩略图和16:9自定义缩略图，使用私享、非儿童和不含付费宣传设置；其他设置须单独实测。

五平台自定义封面已有实际页面和独立核验：小红书3:4、抖音3:4/4:3、B站4:3/16:9、视频号3:4/4:3、YouTube 16:9。兼容代码位于自有 `scripts/ego-video.mjs`，固定上游不改动。B站覆盖空槽和待确认原图的恢复；视频号封面确认使用原生页面点击，可通过保留的原生画布、原文件像素和卡片 URL 关联恢复已接受封面。未知待确认封面弹窗停止，不直接取消后重传。实际使用的新素材仍须逐任务核验。

需要登录时在原空间 `handOff()` 让用户操作；它不解除最终发送保护，也不属于最终发送交接。用户完成登录并明确回复继续后，在上述 prepare/resume 命令追加 `--resume-control`，取回同一数字空间。没有明确继续要求时不使用该选项。登录后的落地页可能不是创作者页，prepare 会沿用原版逻辑在同一空间恢复入口。

## 人工发送

仅在用户明确准备接管发送后运行：

```bash
node scripts/video.mjs handoff --package /absolute/path/package.json --platform bilibili --job-id example-video --confirm-manual-send
```

该命令重新回读平台必需字段、视频、封面和按钮保护，确认原空间与内容身份，解除当前页保护后 `handOff()`。不点击最终按钮。底层入口每次交接一个平台；同一空间多平台使用 `publisher.mjs handoff --platforms bilibili,youtube --job-id REQUEST --package FILE --confirm-manual-send`，先全部核验、逐页解除保护，再一次交权供用户依次手动发送。控制记录写为 `awaiting_manual_send`。交接中断则保留 `result_unknown`，两者都禁止该 Job 后续自动准备、换封面和草稿核验。

用户手动发送后要求查看结果：按 Ego 的接管规则恢复**原数字空间 ID**，只观察页面回执。记录成功 URL/ID或结果未确认，不以消失的表单、按钮点击或网络请求派发判断成功。测试稿标注“请勿发布”时，正常流程保留保护并交回查看；显式发送维护入口不解除其保护。

## 当前页面兼容动作

- 小红书：无视频 file input 时仅刷新原页面一次并重新挂保护；使用原生上传按钮的 FileChooser，不新建副本。刷新后恢复出历史媒体时停止。
- B站：原上传首页的未提交视频提示使用“不用了”。回读视频与分P列表仍有历史媒体时停止；不得因文件名不匹配而追加新分P。自定义标签被平台判为话题专用时，在“搜索更多话题”搜索，选择唯一精确同名候选并确认，最后核对真实标签 chip。缺失或歧义不替换标签名。`aiGenerated: true` 仅来自用户明确确认的AI生成事实，选择“含AI生成内容”；原创权利确认另用于自制声明。没有该事实不从标题或素材推断。创作声明和自制授权是两个独立选项：分别回读 `.creation-statement-container .bcc-option.selected` 与 `.auth-content .option-text-selected`。折叠输入框可能只显示自制授权文字，不能要求它等于“内容无需标注”或“含AI生成内容”。两项已正确时直接跳过；不重复点击已选自制授权，避免取消。
- 视频号：第一环节发现未登录或需选账号时交回原页，由用户手动完成登录与选择；明确继续后复用原空间。执行阶段登录失效也停止交回，不自动点击任何登录按钮；多视频号须按用户明确选择继续。正文保留原文，先输入正文与一个分隔空格；每个标签单独输入 `#名称`，再用原生 `Space` 按键提交，末尾空格必须保留。每项最多短等5秒（计入共用30秒字段窗口），确认 `[data-type=topic]` 的名称与顺序后再输入下一项；最后聚焦短标题控件使正文失焦，再回读完整正文、全部真实话题与末尾空格。不得在最后一次键入后立即判失败，也不把普通 `#文字` 算真实话题。已匹配的正文和话题不重复填写；失败时报告具体标签与步骤。内容包共享 `title` 是任务身份；`wechatShortTitle` 是独立可选界面短标题，默认留空，非空至少6个Unicode码点，最大长度未确认；第一环节根据 `audit.fields.shortTitle` 在标题列显示“留空”或用户原文，仅有问题时在表下说明相关计数和限制。不能因共享标题过短而擅自扩写。
- YouTube：从实际“创建→上传视频”打开弹窗后选择文件，只对所需控件作有界等待；版权/检查提示反馈用户，不申诉或自动点击最终保存。

已预检的平台页保持原位。预检单页导航或读取失败会记录具体平台并继续其他页；已取回的空间最终仍交回，交回结果未知时不盲重试。用户修复连接后，显式恢复只重开此前失败的原页面。

## 第一环节内容审核

`video.mjs check` 输出 `audit`：`fields` 保留各字段实际值、`length/min/max/unit/required/applicable/source/errors`，这些字段保留在私有报告，用户表格不展示计数或限制；`max:null` 表示当前没有已确认上限，不表示无限。媒体回读 `sizeBytes/durationSeconds`，无法核验时显示警告。`publisher.mjs preflight` 将它放入每平台 `contentAudit.audit`，独立给出 `contentStatus` 和集中 `contentErrors`。标准内容可先不完整，随后补齐并使用原 Job ID / `run --resume-control`；`run` 在建页、填写或提交文件前重查全部目标，任一失败即全体停止。

视频号共享标题与可选短标题分别审核，默认空值不能补写。小红书独立视频的正文标记 `applicable:false`，因为当前适配器不写正文。YouTube 当前网页绝对媒体门为 ≤256,000,000,000 bytes 和 ≤43,200秒；超过15分钟提示需账号验证，不假定已验证。自定义缩略图按桌面入口要求 <50,000,000 bytes、宽度至少640；程序仍要求精确16:9。其他未知格式/时长/像素规则显示待平台核验，完整入口区别见 [平台发布规则](platform-rules.md)。

## 与动态共用的规则检查

视频 `check` 与动态 `check`/素材加载复用 `content-audit.mjs` 中的媒体检查；选择依据是平台、`entry:video|dynamic`、字段和 `kind:video|image|cover`，不是仅凭素材扩展名。文件存在、非空、适用格式/大小/可信时长共用实际检查，入口特有的文字、标签、封面和声明仍各自处理。共有逻辑不对未知平台上限设猜测值。完整数值与入口差异只以 [平台发布规则](platform-rules.md)为准。

审核的 `errors`、`warnings` 与 `issues` 对应同一问题；`issues` 携带平台、入口、字段、媒体类型、严重程度及已知来源/限值。已知错误阻断全部目标的填写/上传，集中提示用户提供的字段或素材问题；未知/账号条件在私有报告保留待原页核验状态，本次需要用户处理时才列入问题区，不能说全规则已通过。不应用的字段不能静默复制到另一个入口。恢复保持原内容、默认值及素材指纹，不能用新规则改写旧任务。
