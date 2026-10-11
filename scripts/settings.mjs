import fs from 'node:fs';
import path from 'node:path';
import {readJson, writeJson} from './runtime.mjs';

export function configuration(file, registry) {
  const supported=Object.fromEntries(Object.entries(registry).filter(([type])=>!registry.media||!['video','dynamic'].includes(type)));
  const defaults = {profile: '', platforms: Object.fromEntries(Object.entries(supported).map(([type, entry]) => [type, [...entry.platforms]])), waitTimeout: 1800};
  const saved = fs.existsSync(file);
  let config = saved ? readJson(file) : defaults;
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  if (!object(config) || Object.keys(config).length !== 3 || !['profile', 'platforms', 'waitTimeout'].every(key => Object.hasOwn(config, key))) throw new Error('Configuration requires profile, platforms and waitTimeout');
  if (typeof config.profile !== 'string' || /[\r\n\0]/.test(config.profile)) throw new Error('Configuration profile must be a single-line name or empty string');
  if (!Number.isSafeInteger(config.waitTimeout) || config.waitTimeout < 1) throw new Error('Configuration waitTimeout must be positive integer seconds');
  const legacy=registry.media&&object(config.platforms)&&!Object.hasOwn(config.platforms,'media');
  if(legacy){
    const old=Object.fromEntries(Object.entries(registry).filter(([type])=>type!=='media'));
    if(Object.keys(config.platforms).length!==Object.keys(old).length)throw new Error('Configuration platforms must include each supported content type');
    for(const [type,entry] of Object.entries(old)){
      const selected=config.platforms[type];
      if(!Array.isArray(selected)||new Set(selected).size!==selected.length||selected.some(p=>!entry.platforms.includes(p)))throw new Error('Unsupported or duplicate configured platform for '+type);
    }
    const {video,dynamic,...rest}=config.platforms;
    config={...config,platforms:{media:[...new Set([...video,...dynamic])],...rest}};
  }
  if (!object(config.platforms) || Object.keys(config.platforms).length !== Object.keys(supported).length) throw new Error('Configuration platforms must include each supported content type');
  for (const [type, entry] of Object.entries(supported)) {
    const selected = config.platforms[type];
    if (!Object.hasOwn(config.platforms, type) || !Array.isArray(selected) || new Set(selected).size !== selected.length || selected.some(platform => !entry.platforms.includes(platform))) throw new Error('Unsupported or duplicate configured platform for '+type);
  }
  if (!saved||legacy) writeJson(file, config);
  return {configurationPath: path.resolve(file), configuration: config};
}
