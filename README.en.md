[简体中文](README.md) | **English**

# 168 Publisher

Current version: `0.0.23`.

A local AI Skill for developers and content creators: **prepare one set of text and assets for multiple platforms, use different accounts through Profiles, and publish manually after review.**

- **Less repeated work:** supply your title, body, tags, and assets once. After confirmation, the Skill fills in each platform and submits your files.
- **Multiple accounts through Profiles:** keep different account sessions in separate Ego Profiles. Switch to the target Profile in Ego, then run a separate task with `Profile: name`. The Skill checks the active Profile; it does not switch accounts automatically.
- **Checks before execution:** check login, required content, and supported media specifications together. Resolve reported issues and confirm before filling or uploading begins.
- **Manual control over publishing:** all prepared pages are handed back for you to review and adjust. The Skill never clicks the final publish button automatically.
- **Resume the original job:** after resolving login or field issues, continue in the original job and pages. Configured, handed-off platforms are skipped, and uncertain file submissions are not automatically retried.
- **Source you can customize:** first-party code uses the [MIT license](LICENSE), so you can adapt platform support and workflows. If you need automatic publishing, you can modify the source to add final submission; the current version has no automatic-publishing switch.

| Content | Supported platforms |
| --- | --- |
| [Video](references/video.md) | Xiaohongshu, Douyin, Bilibili, WeChat Channels, YouTube |
| [Posts](references/dynamic.md) | X, Weibo, Xiaohongshu, Jike |

It accepts prepared content and does not create titles, copy, tags, or videos; video covers default to the first frame. Article publishing is unsupported. A post can include one video and still uses the post entry point.

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

Replace `<...>` and send the whole block to your AI. Put one local absolute path per media line, without numbering or quotation marks. Add lines for multiple images.

```md
$168-publisher
Type: <post or video>
Title: <title, or none>
Body: <post text or video description>
Tags: <tags separated by 、, or none>
Media:
<full path to your video or image>
Cover: default
Platforms: <platform IDs separated by 、>
```

- **Title and body:** videos require a title. Only Xiaohongshu posts support a title; use `none` for other post platforms. Post text is required; use `none` for an unused video description.
- **Cover:** For videos, `default`, an empty value, or omission extracts the first frame and uploads it to each platform’s cover field. A supplied JPEG/PNG path takes priority and skips frame extraction. Posts do not support custom covers.
- **Media:** posts accept one or more JPEG/PNG images, or one MP4, never both. Standalone videos accept one MP4 / M4V / MOV. The standard template does not accept remote URLs.
- **Tags:** separate names only with `、`, not spaces. Post tag names cannot contain internal whitespace. Standalone Xiaohongshu, Douyin, Bilibili, and WeChat Channels videos require tags; `none` prompts you to supply them.
- **Platforms:** use `x`, `weibo`, `xiaohongshu`, `jike`, `douyin`, `bilibili`, `wechat_channels`, or `youtube`, separated by `、`, as applicable to the content type. `all platforms` uses that type's saved list; initially it includes every supported platform for that type.

Append optional fields only when needed:

| Field | Usage |
| --- | --- |
| `WeChat short title: …` | **Only add this for a video targeting WeChat Channels.** Omit the entire line for other tasks, even if empty. It defaults to empty and is never copied from the shared title |
| `Profile: default` or `Profile: name` | Omission uses the saved setting, or Ego's current default when unset. A name checks the current Profile; it does not switch Profiles |

**Example**

This post includes one video and targets X and Weibo. Replace the example path with your actual file:

```md
$168-publisher
Type: post
Title: none
Body: I turned my repeated publishing steps into a Skill to reduce form filling and uploads.
Tags: AI、VideoCreation
Media:
/absolute/path/to/demo.mp4
Cover: default
Platforms: x、weibo
```

Scripts parse the template directly and preserve your text and asset order. Missing fields, mixed media, invalid tag syntax, and unsupported platform combinations are reported before continuing.

## What happens next

1. **Check login and content:** open all target pages in one Ego space, check login, text, and assets, then show the confirmation list and issues. This stage does not fill in copy or upload files. You handle login, verification, and account selection.
2. **Configure after confirmation:** reply `继续` (continue) to reuse the original job, space, and pages. The Skill fills in confirmed content and submits assets for each platform.
3. **Review the pages:** once configuration actions finish, all pages are handed back. Uploading or processing may continue on the platforms. Review the content and click the final send button yourself.

`configured` means field and file-input actions completed. **It does not confirm upload completion, permanent storage, or publication.** Expired logins, permissions, or unavailable fields are reported with the incomplete steps. Resolve them and ask to continue the original job. Unknown file-submission outcomes are not automatically retried.

The current template and recovery flow has simulation tests; this does not establish a complete new-job upload test for every platform. See the [validation scope](references/workflow.md#验证范围) (Chinese) for evidence.

## Boundaries and defaults

- Only your supplied text, tags, and assets are used. Media and filenames are not analyzed to generate copy. Standalone Xiaohongshu video currently has no description-writing path; shared descriptions go only to other selected platforms that support them.
- Built-in video defaults include original/self-made content, not made for kids, no paid promotion, no realistic altered content, first-frame video covers, and an empty WeChat short title. **YouTube visibility defaults to public.** Explicit task values override saved settings, then program defaults; the confirmation list shows effective values. AI-generation declarations come only from facts you supply.
- Some video adapters only support original/self-made content and stop for explicit non-original input. Posts do not support custom covers, polls, scheduling, location, or circle selection. See [platform publishing rules](references/platform-rules.en.md).
- Preparing content submits the selected text and assets to the target platforms. Keep private assets, configuration, and job records outside the source directory.
- Local checks do not guarantee platform approval. Unknown specifications and account conditions still require editor checks. Final sending is always manual, and the AI does not poll background processing.

## Configuration and guides

```md
Use $168-publisher, 配置 (configuration).
```

The AI returns the configuration path, complete JSON, and field descriptions. Edit it yourself or ask the AI to set the default post platforms to X and Weibo; it validates and reads back the result. New settings affect new jobs only. Resuming preserves the original content, platforms, Profile, and settings.

[Platform publishing rules](references/platform-rules.en.md) are available in English. Detailed operational guides are in Chinese: [installation and entry verification](references/installation.md), [videos and covers](references/video.md), [post assets](references/dynamic.md), and [advanced input, recovery, and validation](references/workflow.md).

## License and contributing

First-party code and documentation use the [MIT license](LICENSE). The fixed upstream snapshot retains its own [license](assets/vendor/video-publisher/LICENSE); its source and SHA-256 hashes are listed in the [upstream manifest](assets/vendor/upstream.json). X counting uses official twitter-text (Apache-2.0) and its MIT dependencies; see the [third-party notices](references/third-party-notices.md) for sources and licenses. AI tools, Ego, platforms, and user assets remain subject to their respective terms.

[Contributing](.github/CONTRIBUTING.md) · [Code of conduct](.github/CODE_OF_CONDUCT.md) · [Security policy](.github/SECURITY.md) · [Repository guide](references/repository.md) · [Changelog](references/changelog.md)
