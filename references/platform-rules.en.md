[简体中文](platform-rules.md)

New requests infer media from images or a video. Seven platforms share one default list; all seven have image and video entries. The video/dynamic/image entry names below describe existing adapters and legacy jobs, not a user-selected content type. New Xiaohongshu videos use the video entry; X and Weibo videos use their social adapters.


# Platform publishing rules

Checked on **2026-10-10**. This section covers all nine supported platform/content combinations. **Program limits** describe the current input validators and adapters. **Official rules** apply only to their stated entry point. **Unverified** means the target account's editor must still confirm the rule; it does not mean unlimited. Local length and file checks cannot establish account permissions, copyright status or moderation approval.

## Shared rules and handling

Rules are selected by **platform + publishing entry point + field + actual media type**. A video file can belong to either a video task or a post task; both use shared file, size and duration checks with the limits of the selected entry point. Text, topics, images, covers, accounts and declarations follow the same scope model. Shared checks are maintained together; scope differences are explicit below.

| Rule category | When it applies | Shared handling |
| --- | --- | --- |
| Title, body and short title | The target entry point supports or requires the field | Show the original value, counting unit, requirement and bounds; do not apply a field's limits to an entry point that does not use it |
| Tags and native topics | Tags are provided or required | Check names, counts and applicable final-body length; native topic selection and entity counts still require editor verification |
| Video assets | A video file is provided, including a video attached to a post | Check the local file and readable metadata, then apply format, size and duration limits for the platform/entry point; flag unverified pixels or account conditions |
| Images and covers | Images are used or a custom cover is enabled | Check actual files, counts and applicable byte, dimension and aspect-ratio limits; post images and covers retain their own purpose-specific limits |
| Login, accounts, declarations and permissions | Required by the target platform | Use supplied facts and confirmed values; leave login to the user, never guess declarations or infer account eligibility from a valid file |

Known errors and missing required inputs are reported together in stage one. Any target failure blocks all filling and uploading. Unknown or editor-only rules remain pending verification in private reports and appear in the issues section only when user action is needed, never as unlimited or passed; unused fields are marked not applicable. Changed inputs are checked again without rewriting text, cropping assets or switching entry points automatically. Login and content results are reported separately.

Applicability, checking and handling are shared. Existing entry-point differences remain: Xiaohongshu video and post titles currently use different counting units; YouTube account conditions do not apply to other platforms; the WeChat short title belongs only to WeChat Channels. Video/post labels below describe entry points, not whether an attached file requires video checks.

## Text and tags

A minimum of “1” means at least one non-whitespace character. UTF-16 means JavaScript `length`: common Chinese characters count as one unit and ordinary emoji usually as two. Unicode code points count ordinary emoji as one, but compound emoji can contain several points. For standalone Xiaohongshu video titles, the existing program gives ASCII points weight 0.5 and other points weight 1. X uses the pinned official [twitter-text v3 rules](https://github.com/twitter/twitter-text/blob/master/config/v3.json): common CJK characters weigh 2; each recognized emoji, including skin-tone and ZWJ sequences, weighs 2; each recognized URL counts as 23.

| Content / platform | Minimum / maximum title | Body, description or short title | Tags / topics |
| --- | --- | --- | --- |
| Video / Xiaohongshu | Required; non-whitespace text, at most 20 weighted units as above【program】 | The current adapter does not write a regular description. A shared description is used only by other supported platforms and shown as not applicable here. Official web body limit unverified | At least one real topic; `.` is rejected; maximum count unverified【program】 |
| Video / Douyin | Required, 1–30 Unicode code points【program】 | Optional description; inline hashtags in it are rejected by the program, so supply tags separately. Official web maximum unverified | 1–5 real topics【program】 |
| Video / Bilibili | Required, 1–80 Unicode code points【program】 | Nonempty description required; official web maximum unverified | 1–10 tags【program】, with automatic tag generation disabled. These are not universal official limits for every Bilibili entry point |
| Video / WeChat Channels | Shared title required for task identity; no encoded maximum | Nonempty description required. Optional `wechatShortTitle`: empty or at least 6 Unicode code points【program / existing editor path】. **Its maximum, the description maximum and official counting rules remain unverified**; “6–16 characters” is not presented as confirmed | At least one real topic; maximum count unverified【program】. The final description includes native topics |
| Video / YouTube | Required, 1–100 Unicode code points【program】; official maximum 100 characters | Program requires a nonempty description of at most 5,000 Unicode code points and rejects network links. Official maximum is 5,000 characters; the no-link rule is a tool restriction, not a general YouTube prohibition. [Upload guide](https://support.google.com/youtube/answer/57407?co=GENIE.Platform%3DDesktop) | Optional; comma-joined tags at most 500 UTF-16 units【program】. The tags field differs from description hashtags |
| Post / X | No separate title | Nonempty text; ordinary posts at most 280 platform-weighted units, including appended tags; each URL counts as 23. Premium long posts are unsupported. [Posts](https://help.x.com/en/using-x/how-to-post), [URL counting](https://help.x.com/en/using-twitter/how-to-tweet-a-link.html) | Optional, appended as `#tag`【program】; no separate topic ID |
| Post / Weibo | No separate title | Nonempty text; the official ordinary web-post maximum and counting method are unverified; no fixed program character maximum | Optional, appended as closed `#tag#` text【program】 |
| Post / Xiaohongshu | Optional, at most 20 UTF-16 units【program】 | Nonempty text, at most 1,000 UTF-16 units in stage one【conservative program limit】; after native topics are added, editor `descLength` must still be ≤1,000. Final topic entity counts require editor verification; this is not a universal official limit | Optional; select exact native topic candidates individually. Plain `#text` is not a confirmed native topic; maximum count unverified |

Separate user-supplied tags with `、`, not spaces. Post tags cannot be empty, duplicated or contain internal whitespace. Platform-specific title/body overrides must come from you; otherwise your shared text is retained. Shared input must satisfy all applicable checks for all selected platforms before any upload begins.

## Video assets: standalone videos and videos attached to posts

The standard template accepts one local MP4 / M4V / MOV file; official format lists below do not expand template support. Both entry types check an explicit, existing, nonempty local video file. Limits are selected from the applicable row below. Post video adapters accept MP4 only; remote video URLs, automatic transcoding, custom covers and subtitle files are unsupported. MiB = 1,048,576 bytes; MB = 1,000,000 bytes; GB = 1,000,000,000 bytes. Extension and container metadata checks do not prove full decoding.

| Publishing entry point | Verifiable formats / file limits | Minimum / maximum duration | Dimensions, account conditions and custom cover |
| --- | --- | --- | --- |
| Video / Xiaohongshu | Existing local file required; official web format list and maximum file size unverified | Both web duration bounds unverified, not unlimited | Video pixel/aspect-ratio limits unverified. Custom cover requires **3:4**【program】; standard templates use the video first frame by default |
| Video / Douyin | Program requires **MP4 / M4V / MOV** with readable duration; web byte ceiling unverified | Verifiable duration **>0** required; web maximum unverified | Video pixel/aspect limits unverified. Custom covers require both **3:4 and 4:3**【program】 |
| Video / Bilibili | Existing local file required; web format list and file ceiling unverified | Web minimum/maximum unverified | Video pixel/aspect limits unverified. Custom covers require both **4:3 and 16:9**【program】; category is not automatically selected |
| Video / WeChat Channels | Existing local file required; official web format list and byte ceiling unverified | Web minimum/maximum unverified | Video pixel/aspect limits unverified. Custom covers require both **3:4 and 4:3**【program】. Login and account selection are manual |
| Video / YouTube | [Supported formats](https://support.google.com/youtube/troubleshooter/2888402?hl=en) include MP4, MOV, MPEG, AVI, WMV, FLV, WebM and ProRes. Audio files cannot be uploaded as videos. Absolute file maximum **256 GB**, subject to duration too | Absolute maximum **12 hours**; both bounds apply. Unverified accounts default to **15 minutes**; longer videos require account verification. No general official minimum duration is stated. [Long-video guide](https://support.google.com/youtube/answer/71673?co=GENIE.Platform%3DDesktop) | The player adapts to landscape, portrait and square video; desktop's standard 16:9 is not the only accepted ratio. [Aspect ratios](https://support.google.com/youtube/answer/6375112?co=GENIE.Platform%3DDesktop). The tool uses **16:9** custom covers. Official guidance requires thumbnail eligibility, recommends JPG/PNG and 3840×2160, with minimum video-thumbnail width 640; **desktop <50 MB, mobile <2 MB**. The mobile cap is not a general desktop cap. [Thumbnails](https://support.google.com/youtube/answer/72431?hl=en) |
| Post / X | Local MP4, ≤512,000,000 bytes (512 MB)【program】 | Verifiable, **>0 and ≤140 seconds** | [Ordinary accounts](https://help.x.com/en/using-x/x-videos) also use 140 seconds / 512 MB; larger Premium limits are unsupported. Post custom covers are unsupported |
| Post / Weibo | Local MP4, ≤512,000,000 bytes【program】 | No program maximum duration; official web duration bounds unverified | [Official video help](https://kefu.weibo.com/faqdetail?id=21503) states 15 GB on PC and 4 GB on mobile. The tool is narrower and does not apply mobile's three-second minimum to web posts. Custom covers unsupported |
| Post / Xiaohongshu | Local MP4, ≤512,000,000 bytes【program】; official web maximum unverified | Web minimum/maximum duration unverified | Video pixel/aspect limits and native web specifications remain unverified; post custom covers unsupported. [Sharing SDK](https://agora.xiaohongshu.com/doc/android) video rules do not establish native web limits |

Standard templates use the video first frame as the cover; a supplied JPEG/PNG takes priority, and advanced JSON can explicitly disable custom covers. One supplied JPEG/PNG is fitted into each required ratio using downscaling and black padding, without cropping, upscaling or modifying the original. The program then checks the resulting files and dimensions; explicit ratio-specific covers retain their existing checks. Other platforms' cover byte/pixel bounds, video codecs, bitrates, frame rates and audio limits remain unverified in current public web documentation and must not be reported as passed. Recommendations are distinct from rejection thresholds.

## Image assets: counts, formats and sizes

Posts require nonempty text and one media type: images or a single video, never both. The standard template accepts local absolute paths only. Advanced JSON packages also support public HTTPS images; see [advanced input](workflow.md#输入与执行) (Chinese). Both paths require actual JPEG/PNG bytes; GIF is unsupported. A video's custom cover follows its own purpose and aspect-ratio requirements above, not post-image count rules.

| Post entry point | Image count【program】 | Bytes per image【program】 | Scope and official differences |
| --- | --- | --- | --- |
| X | 1–4 | ≤5,000,000 bytes (5 MB) | [Official photo help](https://help.x.com/en/using-x/posting-gifs-and-pictures) states 5 MB, stricter than the other entries' 5 MiB |
| Weibo | 1–9 | ≤5 MiB | [Official photo help](https://kefu.weibo.com/faqdetail?id=12483) states <20 MB and supports GIF/JPG/PNG; the tool is narrower |
| Xiaohongshu | 1–18 | ≤5 MiB | The [sharing SDK](https://agora.xiaohongshu.com/doc/android) count is not evidence of native web limits |

| Douyin | 1–35 | ≤5 MiB | [Native image entry](https://creator.douyin.com/creator-micro/content/upload?default-tab=3) displays 35 images and 50 MB each; the program uses JPEG/PNG ≤5 MiB. A user title is required, ≤30 UTF-16 units |
| Bilibili | 1–9 | ≤5 MiB | [Feed composer](https://t.bilibili.com/); optional title ≤20 UTF-16 units and nonempty body. Counts and sizes are program limits; complete official web limits remain unverified |
| WeChat Channels | 1–18 | ≤5 MiB | [Native image entry](https://channels.weixin.qq.com/platform/post/finderNewLifeCreate) displays 18 images, 20 MB each, optional title ≤22 characters and description ≤1000 characters. The program uses JPEG/PNG ≤5 MiB and counts description plus tags in UTF-16 units |
| YouTube | 1–10 | ≤5 MiB | [Official Community post help](https://support.google.com/youtube/answer/7124474?co=GENIE.Platform%3DDesktop&hl=en) allows 10 images, 16 MB each, JPG/PNG/GIF/WEBP. The program uses JPEG/PNG ≤5 MiB. A 1:1 ratio is suggested, not mandatory. Posts have no independent title |

Real uploading and final publishing on these four new image entries remain unverified. Verification requires the current account, original file hashes, ordered native previews and successful upload receipts. Compression, re-encoding or receipts without a matching URL stop automatic publishing for user review on the original page.

Unknown pixel/aspect-ratio requirements still need target-editor confirmation. Image order is preserved. Duplicate sources, mixed images/video and program size/count violations are rejected before preparation. HTTPS downloads reject private addresses, embedded credentials, custom ports, unsafe redirects, timeouts and oversized responses.

## Defaults and unsupported fields

- Video defaults: not made for kids, no paid promotion, no realistic altered content, public YouTube visibility, standard license, embedding and subscriber notifications enabled; empty category/language/playlist; original/self-made content, first-frame video cover, empty WeChat short title. Explicit task values override saved preferences, then built-in defaults. `aiGenerated` comes only from user facts or preferences, not titles, tags or filenames.
- Current standalone Xiaohongshu/Bilibili/WeChat adapters use an originality/self-made path. Explicit non-original content is rejected, not silently changed. Posts have no shared originality/AI-declaration interface.
- You manually log into WeChat Channels and select the account in the first stage. Captchas, permissions, risk-control prompts and unsupported required fields stop the workflow. The program does not invent facts, guess accounts or select a Bilibili category automatically.
- Post location, polls, scheduling, paid visibility, circle selection and standalone content declarations are unsupported. Final publication is manual by default; `Auto publish: yes` authorizes verified final submission for this request.
- Recovery preserves the original content, media, platform, account association and effective settings. Changed identity or unknown upload outcomes stop the workflow; new defaults do not rewrite old tasks and no replacement copy is created automatically.

## Sources and their scope

The YouTube and X links support the stated public entry-point rules. Complete web specifications for Xiaohongshu, Douyin, WeChat Channels and several post/article fields require authenticated editors; unverified fields are identified above. Actual entry points: [Xiaohongshu Creator](https://creator.xiaohongshu.com/), [Douyin Creator](https://creator.douyin.com/), [Bilibili Creator](https://member.bilibili.com/), and [WeChat Channels](https://channels.weixin.qq.com/).

[Douyin upload API](https://open.douyin.com/platform/resource/docs/openapi/video-management/douyin/create/upload/) direct/chunked upload limits, [Bilibili API error codes](https://open.bilibili.com/doc/4/8673959e-f7bb-56e6-6e68-d225f971b81b), and Xiaohongshu sharing SDK specifications do not replace web-editor rules. Historical page evidence only establishes that entry point and account at that time.

This catalog covers supported publishing inputs and media, not every moderation policy. Unpublished rules, account restrictions and new editor requirements remain identified as pending confirmation. Passing local checks does not guarantee platform approval.
