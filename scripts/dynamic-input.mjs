import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import https from "node:https";
import dns from "node:dns";
import { BlockList, isIP } from "node:net";
import {DYNAMIC_RULES,dynamicBody,dynamicTagErrors,inspectUploadVideo,reviewMedia} from './content-audit.mjs';
import { getImageDimensions } from "../assets/vendor/video-publisher/scripts/lib/content-package.mjs";

export const sha256 = value => crypto.createHash("sha256").update(value).digest("hex");
const MAX_IMAGE = 5 * 1024 * 1024;
const blocked = new BlockList();
for (const [ip, prefix] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.168.0.0", 16], ["100.64.0.0", 10], ["224.0.0.0", 3]]) blocked.addSubnet(ip, prefix, "ipv4");
for (const [ip, prefix] of [["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8]]) blocked.addSubnet(ip, prefix, "ipv6");
export function publicAddress(address) {
  if (address.startsWith("::ffff:")) return publicAddress(address.slice(7));
  return !!isIP(address) && !blocked.check(address, isIP(address) === 6 ? "ipv6" : "ipv4");
}
export function validateImageURL(source) {
  const url = new URL(source);
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) throw new Error("Images require a public HTTPS URL without credentials or custom port");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || (isIP(host) && !publicAddress(host))) throw new Error("Private image URL refused");
  return url;
}
export function downloadImage(source, redirects = 0) {
  const url = validateImageURL(source);
  if (redirects > 3) throw new Error("Too many image redirects");
  return new Promise((resolve, reject) => {
    const request = https.get(url, { signal: AbortSignal.timeout(30000), lookup(host, options, callback) {
      dns.lookup(host, { all: true }, (error, addresses) => {
        if (error) return callback(error);
        if (!addresses.length || addresses.some(item => !publicAddress(item.address))) return callback(new Error("Private image host refused"));
        callback(null, options.all ? addresses : addresses[0].address, addresses[0].family);
      });
    } }, response => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        response.resume();
        try { resolve(downloadImage(new URL(response.headers.location, url).href, redirects + 1)); } catch (error) { reject(error); }
        return;
      }
      if (response.statusCode !== 200) { response.resume(); reject(new Error(`Image HTTP ${response.statusCode}`)); return; }
      let size = 0;
      const chunks = [];
      response.on("data", chunk => {
        size += chunk.length;
        if (size > MAX_IMAGE) request.destroy(new Error("Image exceeds 5 MiB preparation limit"));
        else chunks.push(chunk);
      });
      response.on("error", reject);
      response.on("end", () => resolve(Buffer.concat(chunks)));
    });
    request.setTimeout(20000, () => request.destroy(new Error("Image download timed out")));
    request.on("error", reject);
  });
}
export function normalizeDynamic(raw, directory, platform = "x", { allowIncomplete = false, rules = DYNAMIC_RULES, videoPlatforms = ["x","weibo","xiaohongshu"] } = {}) {
  const allowed = ["type", "text", "tags", "images", "videoPath", "platforms", ...(["xiaohongshu","douyin","bilibili","wechat_channels"].includes(platform) ? ["title"] : [])];
  if (!Object.hasOwn(rules,platform)) throw new Error("Unsupported dynamic platform: "+platform);
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).some(key => !allowed.includes(key))) throw new Error("Unsupported dynamic fields; use text, tags, images or a supported local videoPath");
  if (raw.type !== (["douyin","bilibili","wechat_channels","youtube"].includes(platform)?"image":"dynamic")) throw new Error('type must be "dynamic"');
  if (raw.platforms && (typeof raw.platforms !== "object" || Array.isArray(raw.platforms) || Object.keys(raw.platforms).some(key => !Object.hasOwn(rules,key)))) throw new Error("Unsupported platform override");
  const override = raw.platforms?.[platform] ?? {};
  if (!override || typeof override !== "object" || Array.isArray(override)) throw new Error(`${platform} override must be an object`);
  if (Object.keys(override).some(key => !["text", "tags", "images", "videoPath", ...(["xiaohongshu","douyin","bilibili","wechat_channels"].includes(platform) ? ["title"] : [])].includes(key))) throw new Error(`Unsupported ${platform} override`);
  const chosen = { ...raw, ...override };
  if (typeof chosen.text !== "string" || chosen.text.includes("\0")) throw new Error("text must be a string without NUL");
  if (!allowIncomplete && !chosen.text.trim()) throw new Error("Dynamic body requires at least one non-whitespace character supplied by the user");
  const tags = chosen.tags ?? [];
  const tagErrors=dynamicTagErrors(tags);if(tagErrors.length)throw new Error(tagErrors.join("; "));
  const normalizedTags = tags.map(tag => tag.replace(/^#/, ""));

  const images = chosen.images ?? [];
  const maxImages = rules[platform]?.maxImages??4;
  if (!Array.isArray(images) || images.length > maxImages || images.some(source => typeof source !== "string" || !source)) throw new Error(`${platform} preparation accepts up to ${maxImages} ordered JPEG/PNG images`);
  const sources = images.map(source => {
    if (/^https?:/i.test(source)) return validateImageURL(source).href;
    if (/^[a-z][a-z0-9+.-]*:/i.test(source)) throw new Error("Unsupported image URL scheme");
    return path.resolve(directory, source);
  });
  if (new Set(sources).size !== sources.length) throw new Error("Duplicate images");
  let videoPath;
  if (chosen.videoPath !== undefined) {
    if (!videoPlatforms.includes(platform)) throw new Error(`${platform} video dynamics are not yet implemented`);
    if (typeof chosen.videoPath !== "string" || !chosen.videoPath || /^[a-z][a-z0-9+.-]*:/i.test(chosen.videoPath)) throw new Error("videoPath must be a local file path");
    if (sources.length) throw new Error("Choose images or one video, not both");
    videoPath = path.resolve(directory, chosen.videoPath);
  }
  if (!allowIncomplete && !sources.length && !videoPath) throw new Error("Dynamic media requires one local MP4 or at least one JPEG/PNG image");
  if (platform === "xiaohongshu") {
    if (!sources.length && !videoPath) throw new Error("Xiaohongshu requires images or one video; automatic text-to-image is not implemented");
    if (!chosen.text.trim()) throw new Error("Xiaohongshu graphic preparation currently requires a nonempty body");
    if (chosen.title !== undefined && (typeof chosen.title !== "string" || chosen.title.includes("\0") || chosen.title.length > DYNAMIC_RULES.xiaohongshu.maxTitle)) throw new Error(`Xiaohongshu preparation accepts a title up to ${DYNAMIC_RULES.xiaohongshu.maxTitle} UTF-16 units`);
    return { type: "dynamic", platform, text: chosen.text, title: chosen.title ?? "", tags: normalizedTags, sources, ...(videoPath?{videoPath}:{}) };
  }
  if (["douyin","bilibili","wechat_channels"].includes(platform) && chosen.title !== undefined && (typeof chosen.title!=="string" || chosen.title.includes("\0") || chosen.title.length>DYNAMIC_RULES[platform].maxTitle)) throw new Error("Image title exceeds native limit");
  if(platform==='douyin'&&!allowIncomplete&&!chosen.title?.trim())throw new Error('Douyin image post requires the user title');
  const text = dynamicBody(platform,chosen.text,normalizedTags);
  if(platform==='wechat_channels'&&text.length>1000)throw new Error('WeChat image description exceeds 1000 characters');
  if (!text.trim() && !sources.length && !videoPath) throw new Error("Empty dynamic");
  return { type: raw.type, platform, text, ...(["douyin","bilibili","wechat_channels"].includes(platform)?{title:chosen.title??""}:{}),sources, ...(videoPath ? { videoPath } : {}) };
}
export async function materializeVideo(pkg, recorded, {videoRules={}}={}) {
  const file=pkg.videoPath,media=inspectUploadVideo(file),review=reviewMedia(pkg.platform,'dynamic','video',media,{requireDuration:videoRules.requireDuration??false,ruleOverrides:videoRules,legacy:!!recorded});
  if(review.errors.length)throw new Error(review.errors.join('; '));
  const size=media.sizeBytes;
  const digest = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) digest.update(chunk);
  const duration=videoRules.requireDuration?media.durationSeconds:null;
  const asset = { ...(videoRules.requireDuration?{duration}:{}),source: file, path: file, size, sha256: digest.digest("hex"), format: "mp4", kind: "video" };
  if (recorded && (recorded.length !== 1 || recorded[0].source !== file || recorded[0].size !== size || recorded[0].sha256 !== asset.sha256)) throw new Error("Existing draft video changed; refusing reupload");
  return [asset];
}
export async function materializeImages(pkg, directory, recorded) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const assets = [];
  for (const [index, source] of pkg.sources.entries()) {
    const remote = source.startsWith("https:");
    const previous = recorded?.[index];
    const file = remote && previous ? previous.path : source;
    let buffer;
    if (remote && !previous) buffer = await downloadImage(source);
    else {
      if (!fs.statSync(file).isFile() || fs.statSync(file).size > MAX_IMAGE) throw new Error("Image missing or exceeds 5 MiB preparation limit");
      buffer = fs.readFileSync(file);
    }
    if (!buffer.length || buffer.length > MAX_IMAGE) throw new Error("Image empty or exceeds 5 MiB preparation limit");
    if(DYNAMIC_RULES[pkg.platform]){const review=reviewMedia(pkg.platform,"dynamic","image",{exists:true,sizeBytes:buffer.length,path:file},{field:`images[${index}]`,legacy:!!recorded});if(review.errors.length)throw new Error(review.errors.join("; "));}
    const hash = sha256(buffer);
    if (previous && (previous.source !== source || previous.sha256 !== hash)) throw new Error("Existing draft image changed; refusing reupload");
    const target = remote ? (previous?.path || path.join(directory, hash + ".image")) : source;
    if (remote && !previous) fs.writeFileSync(target, buffer, { mode: 0o600 });
    const dimensions = getImageDimensions(target);
    if (!dimensions.width || !dimensions.height || !["png", "jpeg"].includes(dimensions.format)) {
      if (remote && !previous) fs.rmSync(target, { force: true });
      throw new Error("Only readable PNG/JPEG images are currently implemented");
    }
    const finalPath = remote ? (previous?.path || path.join(directory, hash + (dimensions.format === "png" ? ".png" : ".jpg"))) : target;
    if (target !== finalPath && !previous) fs.renameSync(target, finalPath);
    assets.push({ source, path: finalPath, sha256: hash, size: buffer.length, ...dimensions });
  }
  return assets;
}
