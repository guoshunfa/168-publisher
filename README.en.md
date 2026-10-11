[简体中文](README.md) | **English**

# 168 Publisher

Current version: `0.0.28`.

A local AI Skill for developers and content creators: **prepare one set of text and assets for multiple platforms, use different accounts through Profiles, and publish manually by default or enable automatic publication for this request.**

- **Less repeated work:** supply your title, body, tags, and assets once. After confirmation, the Skill fills in each platform and submits your files.
- **Multiple accounts through Profiles:** keep different account sessions in separate Ego Profiles. Switch to the target Profile in Ego, then run a separate task with `Profile: name`. The Skill checks the active Profile; it does not switch accounts automatically.
- **Checks before execution:** check login, required content, and supported media specifications together. Resolve reported issues and confirm before filling or uploading begins.
- **Two publishing modes:** `Auto publish: no` keeps review and manual final submission. `yes` continues through verification and final publication, pausing only for problems.
- **Resume the original job:** after resolving login or field issues, continue in the original job and pages. Configured, handed-off platforms are skipped, and uncertain file submissions are not automatically retried.
- **Source you can customize:** first-party code uses the [MIT license](LICENSE), so you can adapt platform support and workflows. The template includes a per-request automatic-publishing switch, disabled by default.

| Platform | Images with text | Video |
| --- | --- | --- |
| X | ✓ | ✓ |
| Weibo | ✓ | ✓ |
| Xiaohongshu | ✓ | ✓ |
| Jike | ✓ | ✓ |
| Douyin | ✓ | ✓ |
| Bilibili | ✓ | ✓ |
| WeChat Channels | ✓ | ✓ |
| YouTube | ✓ | ✓ |

Images select the image workflow; a video selects the video workflow. No Type field is needed. One `platforms.media` list stores defaults; image and video requests use the same default targets.

It accepts prepared content and does not create titles, copy, tags, or videos; video covers default to the first frame. Article publishing is unsupported.

New image entries use Douyin image posts, Bilibili feed posts, WeChat Channels image posts and YouTube Community posts. Local file checks, simulated safety checks and read-only page inspection are complete; real uploads and publishing on these new entries remain unverified. Platform changes, account permissions or unproven upload identity pause the task on the original page.

## Installation

Requires **macOS, Node.js 24, FFmpeg (for first-frame extraction), [Ego](https://lite.ego.app/), the ego-browser Skill and CLI**. Your AI assistant must support loading local Skills, reading local files, running commands, and operating Ego pages. No `npm install` or build is needed. Complete Ego onboarding and platform login yourself.

Download the source from the [GitHub repository](https://github.com/guoshunfa/168-publisher), or run `git clone https://github.com/guoshunfa/168-publisher.git`. Replace the path below with the local directory containing the root `SKILL.md`, then send it to your AI:

```md
Please install /absolute/path/to/168-publisher as a global Skill.
First read references/installation.md in that directory, check runtime prerequisites, follow this AI tool's installation rules, and verify that the root entry is loaded and the nested dependency entry is disabled.
```

After installation, you should be able to call `$168-publisher`. Tools without this syntax should read the entry as described in the [installation guide](references/installation.md) (Chinese). Codex remote installations use its built-in `skill-installer`; local maintenance symlinks follow the user's explicitly chosen setup.

## Usage

**Template**

Replace `<...>` and send the whole block to your AI. Put one local absolute path per media line, without numbering; matching outer single or double quotes are accepted. Add lines for multiple images.

```md
$168-publisher
Auto publish: no
Title: <title, or none>
Body: <text or video description>
Tags: <tags separated by 、, or none>
Media:
<full path to your video or image>
Cover: default
Platforms: <platform IDs separated by 、>
```

- **Title and body:** Platforms with title fields use the shared title. Image requests on Xiaohongshu, Douyin, Bilibili and WeChat Channels use titles; YouTube posts have no separate title. X, Weibo and Jike do not use an independent title. Image text is required; use `none` for an unused video description.
- **Cover:** For videos, `default`, an empty value, or omission extracts the first frame and uploads it to supported platform cover fields. A supplied JPEG/PNG path takes priority and skips frame extraction. Image requests do not support custom covers; X, Weibo and Jike videos also have no separate cover field.
- **Auto publish:** put this first. Use `yes` or `no`; omission means `no`. It applies only to the current request and is preserved on resume.
- **Media:** one or more JPEG/PNG images select the image workflow; one MP4 / M4V / MOV selects video. Do not mix them. Actual formats and specifications are checked per platform. The standard template does not accept remote URLs.
- **Tags:** separate names only with `、`, not spaces. Social adapter tag names cannot contain internal whitespace. Standalone Xiaohongshu, Douyin, Bilibili, and WeChat Channels videos require tags; `none` prompts you to supply them.
- **Platforms:** use `x`, `weibo`, `xiaohongshu`, `jike`, `douyin`, `bilibili`, `wechat_channels`, or `youtube`, separated by `、`, as applicable to the content type. `all platforms` uses the unified `platforms.media` list; image requests filter out unsupported image targets.

Append optional fields only when needed:

| Field | Usage |
| --- | --- |
| `WeChat short title: …` | **Only add this for a video targeting WeChat Channels.** Omit the entire line for other tasks, even if empty. It defaults to empty and is never copied from the shared title |
| `Profile: default` or `Profile: name` | Omission uses the saved setting, or Ego's current default when unset. A name checks the current Profile; it does not switch Profiles |

**Example**

This image request targets X and Weibo. Replace the example path with your actual file:

```md
$168-publisher
Auto publish: no
Title: none
Body: I turned my repeated publishing steps into a Skill to reduce form filling and uploads.
Tags: AI、VideoCreation
Media:
/absolute/path/to/demo.png
Cover: default
Platforms: x、weibo
```

Scripts parse the template directly and preserve your text and asset order. Missing fields, mixed media, invalid tag syntax, and unsupported platform combinations are reported before continuing.

## What happens next

The steps below describe the default `no` mode. With `yes`, successful preflight continues automatically without another confirmation. Login, captchas, missing facts, required rights confirmations and failures pause the request. X may retry once after a pointer interception only when no click reached the unchanged, verified button. Xiaohongshu accepts re-encoded images only when original file receipts and decoded pixels match exactly. Sent or unknown outcomes are not automatically retried.

1. **Check login and content:** open all target pages in one Ego space, check login, text, and assets, then show the confirmation list and issues. This stage does not fill in copy or upload files. You handle login, verification, and account selection.
2. **Configure after confirmation:** reply `继续` (continue) to reuse the original job, space, and pages. The Skill fills in confirmed content and submits assets for each platform.
3. **Review the pages:** once configuration actions finish, all pages are handed back. Uploading or processing may continue on the platforms. Review the content and click the final send button yourself.

`configured` means field and file-input actions completed. **It does not confirm upload completion, permanent storage, or publication.** Expired logins, permissions, or unavailable fields are reported with the incomplete steps. Resolve them and ask to continue the original job. Unknown file-submission outcomes are not automatically retried.

An earlier four-platform post completed with success receipts, including user-confirmed recovery for X and Xiaohongshu. The updated code has simulation coverage and local Ego browser verification; it has not published another live post. See the [validation scope](references/workflow.md#验证范围) (Chinese) for evidence.

## Boundaries and defaults

- Only your supplied text, tags, and assets are used. Media and filenames are not analyzed to generate copy. Standalone Xiaohongshu video currently has no description-writing path; shared descriptions go only to other selected platforms that support them.
- Built-in video defaults include original/self-made content, not made for kids, no paid promotion, no realistic altered content, first-frame video covers, and an empty WeChat short title. **YouTube visibility defaults to public.** Explicit task values override saved settings, then program defaults; the confirmation list shows effective values. AI-generation declarations come only from facts you supply.
- Some video adapters only support original/self-made content and stop for explicit non-original input. Image requests do not support custom covers, polls, scheduling, location, or circle selection. See [platform publishing rules](references/platform-rules.en.md).
- Preparing content submits the selected text and assets to the target platforms. Keep private assets, configuration, and job records outside the source directory.
- Local checks do not guarantee platform approval. Unknown specifications and account conditions still require editor checks. With `no`, final sending remains manual without processing waits. With `yes`, the script waits within a deadline, verifies the original draft, clicks publish, and checks platform feedback. A click alone is not publication success; unknown outcomes are never retried automatically.

## Configuration and guides

```md
Use $168-publisher, 配置 (configuration).
```

The AI returns the configuration path, complete JSON, and field descriptions. Edit it yourself or ask the AI to set the default publishing platforms to X and Weibo; it validates and reads back the result. New settings affect new jobs only. Resuming preserves the original content, platforms, Profile, and settings.

[Platform publishing rules](references/platform-rules.en.md) are available in English. Detailed operational guides are in Chinese: [installation and entry verification](references/installation.md), [videos and covers](references/video.md), [images and social video assets](references/dynamic.md), and [advanced input, recovery, and validation](references/workflow.md).

## License and contributing

First-party code and documentation use the [MIT license](LICENSE). The fixed upstream snapshot retains its own [license](assets/vendor/video-publisher/LICENSE); its source and SHA-256 hashes are listed in the [upstream manifest](assets/vendor/upstream.json). X counting uses official twitter-text (Apache-2.0) and its MIT dependencies; see the [third-party notices](references/third-party-notices.md) for sources and licenses. AI tools, Ego, platforms, and user assets remain subject to their respective terms.

[Contributing](.github/CONTRIBUTING.md) · [Code of conduct](.github/CODE_OF_CONDUCT.md) · [Security policy](.github/SECURITY.md) · [Repository guide](references/repository.md) · [Changelog](references/changelog.md)
