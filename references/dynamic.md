# 动态操作

当前四个平台均接入图片或单段本地 MP4 视频：X、微博、即刻使用正文及行内话题，小红书使用正文、可选标题及原生话题。四平台视频动态均有真实草稿、独立回读和重复准备证据。

正常 `publisher.mjs run` 开始前完成本地检查并完整展示输入让用户确认。确认后在独立 Ego 空间先建齐并打开全部平台页，再顺序填写标题、正文、标签并提交媒体，立即一次交回用户查看。进度显示当前平台/步骤，当前页带到前台。配置成功为 `configured`，不代表服务器上传完成或已发布；不自动 inspect、轮询后台状态或要求上传/预览/时长通过强验收。字段不可填、登录、权限、限频与原关联未知逐项报告未完成。

下方 prepare、inspect、handoff 的强回读说明属于用户明确要求的维护入口，不用于正常 run 的完成判断。部分任务交回后，用户处理问题并明确要求继续，可用原 `publisher.mjs run --resume-control` 恢复同一空间、页面、内容与素材；已尝试上传不重传。普通内容交回前解除 Agent 保护；测试稿仍交回查看但保留保护。

## 整理输入

调用输入固定为四组：**内容、标签、媒体、平台**。README 的“类型、标题、内容”归入内容组：类型写“动态”，内容提供至少一个非空白字符的完整正文；标题只有小红书支持，可选，其他平台写“无”。标签按 `、` 分隔或写“无”；媒体提供一段本地 MP4 或至少一张图片，多张图片每行一个路径；平台用 `、` 列出目标，“所有平台”取配置 `platforms.dynamic`。只把用户提供的文字映射到仓库之外的 JSON；不得分析素材、从文件名或画面推断内容，也不得创作、扩写、改写、摘要、翻译或生成平台变体。非空正文必须由用户提供；未提供的标题和标签留空，不自动补齐。缺少四组输入或平台必填项时先询问，不运行预检查或准备。

| 平台 | 独立标题 | 话题/标签 | 媒体数量 |
| --- | --- | --- | --- |
| X | 不支持 | 用户提供后按 `#标签` 格式追加 | 1–4 张图片，或 1 段视频 |
| 微博 | 不支持 | 用户提供后按 `#标签#` 格式追加 | 1–9 张图片，或 1 段视频 |
| 小红书 | 可选，用户提供后使用；最多 20 个 UTF-16 单元 | 用户提供后按平台话题控件选择精确名称 | 1–18 张图片，或 1 段视频 |
| 即刻 | 不支持 | 用户提供后作为普通正文 `#标签` 追加，不代表圈子 | 1–9 张图片，或 1 段视频 |

当前接入中没有已由本地输入校验标记为必填的独立标题字段；小红书标题可选。若实际页面要求用户未提供的字段，停止并询问；不把标题或标签移入正文。新任务及没有匹配历史 state 的 `check` 要求非空白正文及一种媒体，纯文字和空正文均在页面操作前拒绝。已有历史任务的 `check`、`prepare`、`inspect`、`handoff` 可沿用原有缺项，但必须与原 Job ID、归一化内容包、输入指纹和媒体指纹完全一致；其他格式、账号、空间与发送保护校验仍保留。

先向用户展示逐平台的完整正文、用户提供的话题/标签与平台格式化结果、可选标题、素材顺序和 Profile，确认后运行准备。X 没有独立标题或封面，本阶段图片接受本地文件或公开 HTTPS 链接，支持 1–4 张 JPEG/PNG，每张最多 5 MiB；这是当前准备程序的限制，不代表平台的全部能力。

```json
{
  "type": "dynamic",
  "text": "用户提供的完整正文",
  "tags": ["软件"],
  "images": ["/absolute/path/first.png", "https://example.com/second.jpg"],
  "platforms": {
    "x": { "text": "仅当用户提供 X 专属正文时填写" },
    "xiaohongshu": { "title": "仅当用户提供小红书标题时填写" }
  }
}
```

`platforms.<platform>` 仅用于覆盖用户明确提供的平台专属字段；其他字段沿用用户提供的通用值。多平台内容包中的小红书标题放在 `platforms.xiaohongshu.title`，不要放在根级 `title`。图片相对路径以 JSON 所在目录为基准。`tags` 去掉开头的 `#` 后，按顺序以 `\n\n#话题 #话题` 追加到正文，必须把追加后的完整文字展示给用户。标签仅按 `、` 分隔，`AI、视频生成` 映射为 `["AI", "视频生成"]`，空格不作为分隔符；名称内部空格当前不支持，会拒绝并补问。未提供标签时不生成标签或话题。空内容、无媒体、重复话题、重复图片及不支持的字段会拒绝；不截断文字，不调整用户原文。

X 视频使用 `videoPath`，也可在 `platforms.x` 中覆盖；路径相对内容包解析，只接受本地 MP4，不与图片混选。当前准备范围为一段不超过 140 秒、512 MB 的视频，不自动裁剪或转码；更大文件或其他格式停止并说明。该范围参照 [X 视频说明](https://help.x.com/en/using-x/x-videos)，不代表 Premium 的全部能力。MP4 容器和文件 SHA-256 在上传前核对，实际解码、时长及上传完成状态在平台编辑器核验。

```json
{
  "type": "dynamic",
  "text": "用户确认的视频动态正文",
  "tags": ["软件"],
  "videoPath": "/absolute/path/video.mp4"
}
```

本阶段使用平台默认视频封面，不提供独立标题、自定义封面或字幕字段。视频链接输入尚未接入。

HTTPS 下载校验每次重定向和 DNS 地址，拒绝私网、凭据、自定义端口、超时和超限文件。下载图像留在 Job 私有目录，恢复用缓存并重新核对字节；不重新下载同一个链接来替换已确认的素材。

## 检查、准备与恢复

命令相对于 Skill 目录；无需 npm 安装。

```bash
node scripts/dynamic.mjs check --package /absolute/path/package.json --platform x
node scripts/dynamic.mjs prepare --package /absolute/path/package.json --platform x --profile "Profile name" --job-id example-x
node scripts/dynamic.mjs inspect --package /absolute/path/package.json --platform x --job-id example-x
```

`check` 校验并缓存输入素材，不操作页面。任务默认位于 `~/.168-publisher/dynamic-jobs/`，可用 `--state-root` 指定隔离目录。未指定 Profile 时沿用配置默认值，配置为空则使用 Ego 当前默认项；指定名称时先核对与当前项一致，不自动切换。

统一入口为一次多平台请求创建一个空间，每个平台保留独立页面；任务记录空间名称、数字 ID、pageLabel、Profile、账号和内容指纹。登录或权限提示后交给用户处理，用户明确继续后，原 prepare/inspect 命令追加 `--resume-control`。无法证明原空间和编辑器身份时停止，不重建页面或重传。

首次上传前检查已有正文并记录尝试标记。中断后仅回读已有素材；没有收到可靠证据时报告结果未知，不重复上传。首次准备自动清理历史文字、标题和媒体，保存私有快照并回读空编辑器；正常清理无需用户确认。多帖编辑器、清理结果未知或当前任务已上传后的内容变化仍停止，不重复上传。

正文通过 macOS 原生粘贴写入。按 DraftJS 文本块读取页面正文，保留真实空行，再与编辑器当前正文逐字比较。核验分别检查登录、账号、弹窗编辑器、正文、原生文件输入 SHA-256、原文件到可见媒体的关联与顺序、实际上传状态、平台按钮状态、阻塞弹窗及保护状态。编辑器状态无法读取时报告结果未知，不能仅凭页面文字认定成功。

X 可能在当前上传过程中把 PNG 转为 JPEG。核验使用已记录的原文件 SHA-256 和文件大小，再通过媒体组件当前状态将原文件关联到转换后的预览 URL；同时要求预览 Blob 的字节已记录、上传进度为 1、上传 ID 存在、没有失败或处理状态。不能以图片数、文件名或按钮可用代替这些证据。READY 只表示当前编辑页通过核验，永久保存和发送另行核对。

视频复用同一原文件关联核验，要求唯一视频、无图片混入、原生视频预览已解码、尺寸及有效时长可读、媒体类型为视频，再检查实际上传完成状态。`media` 门槛统一覆盖图片和视频；可播放的本地预览不等于服务器上传已完成。

显式维护入口中，X 首次视频预览尚未挂载时可能返回 `processing` / `waitingFor: "media_preview"`，这表示强媒体核验未通过。正常 `run` 只要求配置动作完成并交回，不因此继续等待或重复上传。

保存后重新打开的图片可能已被 X 压缩；原文件关联证据缺失时报告结果未知，不自动重传。正文保存与复开可以单独核对，不能替代完整素材核验。

最终发送、定时入口、表单提交以及 Cmd/Ctrl+Enter 保持保护。X 快捷发送行为见 [官方说明](https://help.x.com/en/using-x/how-to-post)。守卫被触发、页面刷新丢失素材证据或账号变更时停止并报告结果未知。

## 微博动态

使用同一入口，将 `--platform x` 换为 `--platform weibo`。内容包字段为 `text`、`tags`、`images` 或 `videoPath`；`platforms.weibo` 可分别覆盖。使用首页公开动态编辑器，支持最多 9 张有序 JPEG/PNG，每张 5 MiB 以内；这是本程序准备范围。两张本地图像、多行中英文、emoji、话题与纯文字已真实验收；九张图片及 HTTPS 来源尚未完成微博上传验收。

微博话题使用闭合格式，`tags: ["软件", "168Publisher"]` 追加为 `\n\n#软件# #168Publisher#`，应展示完整文字供用户确认。没有独立标题或封面，不提供未接入的投票、位置、定时、付费可见或内容声明字段，不自动设置原创/AI声明。用户要求这些字段时先说明尚未接入，不省略后继续准备。

正文同时比较 textarea、当前 Vue 输入组件和发布组件。图片核验当前媒体列表内原生 File 的 SHA-256/大小、同序可见预览、上传完成状态、上传 ID 及新浪图片服务器 URL。上传失败提示与结果未知分开报告；平台删掉失败素材而提示已经消失时仍不能判成功。页面刷新、永久保存及重开后的原文件关联尚未验收，不能重传来制造通过。

```bash
node scripts/dynamic.mjs check --package /absolute/path/package.json --platform weibo
node scripts/dynamic.mjs prepare --package /absolute/path/package.json --platform weibo --profile "Profile name" --job-id example-weibo
node scripts/dynamic.mjs inspect --package /absolute/path/package.json --platform weibo --job-id example-weibo
```

显式发送维护入口仍须明确请求并通过最新核验，将下方命令的平台改为 `weibo`；准备和测试保持发送、定时、提交与 Cmd/Ctrl+Enter 保护。测试稿不解除保护。


微博视频使用单段本地 MP4（本程序上限512 MB），不与图片混选，正文及闭合话题与图文相同；当前使用平台默认视频封面。原生上传完成后删除附件的 `file` 字段，核验改读该附件上传器保留的原生 `currFile`，核对完整SHA-256/大小、媒体ID成功回执、分组ID、服务端时长/尺寸、完成态和同一封面缩略图。显示进度可能在成功后滞留于100以下；完成核验要求服务器校验后的原生成功状态、完整上传字节，以及覆盖全文件的有序分片HTTP 200和成功回执，不单独依据显示百分比。正文、原文件、服务器ID及重复准备已真实通过，未重传。

## 小红书动态

同一入口使用 `--platform xiaohongshu`。内容包接受 `title`、`text`、`tags`、`images` 或 `videoPath`，`platforms.xiaohongshu` 可逐项覆盖。图文要求非空正文和至少一张图片，最多 18 张 JPEG/PNG，每张 5 MiB 以内；可选标题最多 20 个 UTF-16 单元，正文及话题以平台当前 1000 字计数为核验门槛。不截断文字，不重编码素材。最大图片数和 HTTPS 来源的小红书真实上传尚未验收。

```json
{
  "type": "dynamic",
  "text": "用户提供的完整正文\n保留真实换行",
  "images": ["/absolute/path/first.png", "/absolute/path/second.png"],
  "platforms": {
    "xiaohongshu": {
      "title": "用户提供的小红书标题",
      "tags": ["用户提供的话题"]
    }
  }
}
```

话题通过原生键盘逐项输入：聚焦编辑器后用 `Meta+ArrowDown` 定位文末，再键入 ` #名称` 触发候选。精确核对大小写和名称，只点击唯一可见的同名候选整行，不盲选当前高亮项；每项等待 Tiptap `topic` 节点按输入顺序生成且 ID 非空后，再处理下一项。查询不到精确名称、候选不唯一或只有普通 `#文字` 时停止；失败诊断包含当前标签、步骤和有限候选/实体摘要。字段操作共用 30 秒窗口，不无限重试。程序在正文后留一空行插入话题，需在确认内容时说明。完成后聚焦标题使正文失焦，再核对标题、Tiptap 正文/话题节点、平台 Vue/Pinia 序列化正文和字符计数；图片按原文件字节、Blob 预览、顺序、上传 ID、完成状态和进度核验。

0.0.8 的键入、整行选择、逐项实体确认与失焦回读路径有真实页面操作证据，生成脚本已有多话题和失败场景的行为回归。修改后的完整脚本尚未在真实平台执行或无操作复跑，不把这些证据称为新版端到端验收。

已真实验收两张图、多行中英文、emoji、真实“软件”话题，以及从空上传页首次上传一张原图。两组均通过独立核验、重复准备及失焦复查，原上传 ID 保持一致。当前使用公开、立即发布的默认设置，不自动设置原创、内容声明、合集、位置或图片编辑。小红书视频动态使用同一动态入口；原版五平台视频流程仍使用 `video.mjs`。

```bash
node scripts/dynamic.mjs check --package /absolute/path/package.json --platform xiaohongshu
node scripts/dynamic.mjs prepare --package /absolute/path/package.json --platform xiaohongshu --profile "Profile name" --job-id example-xhs
node scripts/dynamic.mjs inspect --package /absolute/path/package.json --platform xiaohongshu --job-id example-xhs
```

平台页底部发送/暂存控件位于封闭 Shadow DOM，准备期间保护整个 `xhs-publish-btn` 组件，包括“暂存离开”；只凭普通 DOM 按钮搜索无法保证保护。永久保存和重新打开未验收，READY 仍仅表示当前编辑页。人工发送按下方命令换平台为 `xiaohongshu`，测试稿保持保护。


小红书视频动态使用 `videoPath` 或 `platforms.xiaohongshu.videoPath`，接受本地MP4（本程序上限512 MB），不与图片混选；保留同一标题、正文和真实话题流程。核对当前Pinia草稿/账号/设置、原生 `videoFile` 完整字节、原文件Blob、解析尺寸与时长、服务器文件ID、100%上传完成及默认封面预览；转码进度0不单独代表失败，须以平台 `isVideoReady` 和服务器ID为准。已实测正文＋视频＋真实“软件”话题，独立回读与重复准备未新增上传。动态入口不提供独立封面、原创/AI声明或其他设置；自定义视频封面仍走已验收的视频入口，不能静默把动态正文丢掉。

## 即刻动态

即刻使用同一入口的 `--platform jike`，字段为 `text`、`tags`、`images` 或 `videoPath`，支持 `platforms.jike` 覆盖；本程序图片范围为最多 9 张 JPEG/PNG，每张 5 MiB 以内。两图及首次单图上传已真实验收；九图和 HTTPS 图片的即刻上传尚未验收。`tags` 和 X 一样追加为 `\n\n#标签 #标签`，是普通正文文字，不能当作真实圈子或话题 ID。

即刻正文同时核对可见文字、Lexical JSON、当前挂载 React 输入组件和表单状态；只读取 mounted 树，不接受过期 alternate 的正文。图片按当前 attachment.ids 顺序关联 File、原字节 SHA-256、Blob 预览及 CDN 成功回执和上传 ID。纯预览、可点发送或“正在上传”均不能认定完成。

不自动选择圈子，不提供独立标题、封面、链接卡片或原创声明。已有圈子或其他未确认字段会使核验不通过。已识别的“从草稿箱中恢复未发送的内容”引导可以通过原生关闭提示按钮关闭，程序不会点恢复旧草稿。其他阻塞提示报告需要处理；刷新/复开丢失原图证据时仍停为结果未知。

```bash
node scripts/dynamic.mjs check --package /absolute/path/package.json --platform jike
node scripts/dynamic.mjs prepare --package /absolute/path/package.json --platform jike --profile "Profile name" --job-id example-jike
node scripts/dynamic.mjs inspect --package /absolute/path/package.json --platform jike --job-id example-jike
```


即刻也可使用同一动态内容包的 `videoPath` 或 `platforms.jike.videoPath`，不与图片混选。当前范围为本地 MP4、最多100 MiB、3–360秒；上传前复用上游 ISO BMFF 时长读取，平台原生校验及预览再核对解码、尺寸与时长，长边最多1920、短边最多1080。程序不裁剪或转码。正向验收使用用户批准的录屏低分辨率副本，正文/原字节/可播放 Blob/原生VIDEO附件/上传完成态一致，独立回读及重复准备通过，未新增上传。

显式维护入口对即刻视频核对原 File、Blob、七牛 ETag 与服务端 `UPLOADED` 状态。正常 `run` 不以这些后台证据为结束条件；明确“操作过于频繁”立即报告 `needs_user` / `waitingFor: "rate_limit"` 并交回原页面，不进行15秒或30分钟回查。用户处理后明确继续，恢复原任务并只完成未完成动作；已尝试上传的媒体不重传，原关联未知仍停止。

## 人工发送交接

正常 `run` 已自动交回查看，无需再调用发送维护入口。用户明确要求旧强核验发送交接时，同一空间多平台用 `publisher.mjs handoff --platforms x,weibo --job-id REQUEST --package FILE --confirm-manual-send`；先全量核验，再统一交权。以下单平台底层入口仍可用，仅在用户明确准备自己点击发送后运行：

```bash
node scripts/dynamic.mjs handoff --package /absolute/path/package.json --platform x --job-id example-x --confirm-manual-send
```

入口独立核验后，在交接前再次回读。通过才解除保护并 `handOff()`，程序不点击发送。提前记录交接尝试；交接成功为 `awaiting_manual_send`，结果未知也不重复执行。交接后禁止准备、上传和草稿核验。用户表示已发送并要求检查时，按 Ego 接管规则在原数字空间只读查看明确回执。

标注“请勿发布”的测试稿保持保护，可以交还用户查看，但不执行上述解除保护命令。当前已实测两张本地图像、本地与 HTTPS 图片混合上传及顺序、纯文字、多行正文和话题，以及一段本地 MP4；纯文字与话题草稿保存/复开后也通过。视频及图片保存后的原文件关联恢复、其他视频编码和真实最终人工交接仍待对应平台用例验证。

新任务可用 `prepare --space 数字ID` 在当前 Agent 专用空间增加平台页面；已有任务仍只恢复原空间，不用该参数绕过登录、风控或未知结果。

## 第一环节审核

`publisher.mjs preflight` 并列报告内容与登录；动态 `check` 的 `audit.fields` 展示各目标的实际正文、原标签和小红书可选标题，已追加标签的平台正文按最终提交文本计。任一目标 `check` 失败，`run` 在页面准备与上传前阻断全部目标。缺内容不妨碍只读登录检查；`status:login_checked` 只说明登录，须同时查看 `contentStatus`、全部 `contentErrors` 和警告。

X 普通动态使用固定官方 twitter-text 3.1.0/v3 规则计数，上限280加权单位（中文与识别的emoji计2、URL计23，含实际标签文本）；图片本地/HTTPS/缓存回读均 ≤5,000,000 bytes；单视频须可核验 >0且≤140秒，沿用当前MP4/512,000,000 bytes程序入口。新计数器及许可见[第三方说明](third-party-notices.md)。这不接入Premium长帖/大视频。小红书动态正文先执行保守程序门≤1000 UTF-16单元；原生话题加入后的 `descLength≤1000` 仍需编辑器核验，不能称本地精确计数。即刻视频3–360秒/100MiB仍本地核验，短边≤1080/长边≤1920暂由原生页面核验，审核明确 `dimensionsVerified:false`。其他未知上限不代表无限。

匹配旧 state 的审核保留原身份/媒体合同，输出 `scope:historical_identity_review`，历史缺项单列警告；不得把它称为新内容全规则通过，或为修复缺项重写旧包。原内容/媒体指纹不匹配仍拒绝。X原图及缓存图的确定5MB硬门仍检查。

## 与独立视频共用的规则检查

动态附带视频同样走 `content-audit.mjs` 的共有媒体检查，按 `entry:dynamic` 选择适用约束；素材加载与第一环节使用同一检查helper。标题/图片数量/标签名称和追加文本由规范化与审核共用 `DYNAMIC_RULES` / helper，避免两处维护不同阈值。动态入口不套独立视频的自定义封面、原创/AI声明、受众或账号设置；小红书独立视频与动态仍保留不同标题计数和正文路径。数值与未知项见 [平台发布规则](platform-rules.md)。

`errors`、`warnings` 与带平台/入口/字段/媒体类型的 `issues` 一致呈现，素材加载失败同样进入第一环节问题清单。任何目标的确定错误阻断全体准备；未知规则在私有报告保留待原生页面核验状态，本次需要用户处理时才列入问题区；无问题时按 Skill 的简洁收尾句结束，不推测上限或改写文案。`recorded` 素材加载保留历史格式/大小/时长与原字节身份合同：旧X长视频不因新任务140秒门而重传或改包；旧X图的准备/核验加载仍沿原5MiB，第一环节 `check` 则保持此前已存在的5MB门。恢复阶段哈希、原路径及内容指纹仍严格比对。
