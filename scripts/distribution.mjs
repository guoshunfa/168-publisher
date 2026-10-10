import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {isMain} from './runtime.mjs';

const rootFiles = ['.gitignore', 'LICENSE', 'README.md', 'README.en.md', 'SKILL.md'];
const directories = ['agents', 'assets', 'references', 'scripts', 'tests', '.github'];
const extensions = new Set(['.md', '.mjs', '.json', '.yaml', '.yml', '.toml', '.sh', '.swift']);

export function skillVersion(root) {
  const file = path.join(root,'SKILL.md');
  if (fs.lstatSync(file).isSymbolicLink()) throw new Error('Skill version source cannot be a symlink');
  const frontmatter = fs.readFileSync(file,'utf8').replaceAll('\r\n','\n').match(/^---\n([\s\S]*?)\n---(?:\n|$)/)?.[1] || '';
  // shortcut: reads the maintained two-space metadata.version format; use a YAML parser if metadata syntax expands.
  const metadata = frontmatter.match(/^metadata:\n((?:[ \t]+.*(?:\n|$))*)/m)?.[1] || '';
  const version = metadata.match(/^  version: (["'])([^"'\n]+)\1[ \t]*$/m)?.[2];
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version || '')) throw new Error('SKILL.md metadata.version must be a quoted major.minor.patch string');
  return version;
}

export function inventory(root) {
  const result = {};
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, {withFileTypes: true}).sort((a,b) => a.name.localeCompare(b.name))) {
      if (entry.isSymbolicLink()) throw new Error('Distribution cannot contain symlinks: '+entry.name);
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile()) result[path.relative(root, file).split(path.sep).join('/')] = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
      else throw new Error('Unsupported distribution file: '+file);
    }
  }
  visit(root);
  return result;
}

export function copyCommunity(source, destination, {runtimeOnly = false} = {}) {
  source = fs.realpathSync(source);
  destination = path.resolve(destination);
  let parent = destination;
  while (!fs.existsSync(parent)) parent = path.dirname(parent);
  const canonical = path.resolve(fs.realpathSync(parent),path.relative(parent,destination));
  if (canonical === source || canonical.startsWith(source+path.sep)) throw new Error('Output must be outside the community source');
  if (destination === source || destination.startsWith(source+path.sep)) throw new Error('Output must be outside the community source');
  if (fs.existsSync(destination)) throw new Error('Output already exists; choose a new directory');
  skillVersion(source);
  const files = runtimeOnly ? ['LICENSE'] : rootFiles;
  const folders = runtimeOnly ? ['scripts', 'references', 'assets'] : directories;
  const selected = [...files, ...folders];
  // Validate before creating output: neither hidden credentials nor unexpected files are shipped.
  for (const item of selected) {
    const target = path.join(source, item);
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink()) throw new Error('Source cannot contain symlinks: '+item);
    const candidates = stat.isDirectory() ? Object.keys(inventory(target)) : [item];
    for (const name of candidates) {
      const basename = path.basename(name);
      if (basename !== 'LICENSE' && !extensions.has(path.extname(name)) && basename !== '.gitignore') throw new Error('Unexpected distribution file: '+name);
      if (name.split('/').some(part => part.startsWith('.') && part !== '.github' && part !== '.gitignore')) throw new Error('Hidden file is not distributable: '+name);
    }
  }
  try {
    fs.mkdirSync(destination, {recursive: true});
    for (const item of selected) fs.cpSync(path.join(source,item), path.join(destination,item), {
      recursive:true,
      filter:file => !runtimeOnly || !file.endsWith('.test.mjs'),
    });
    return inventory(destination);
  } catch (error) {
    fs.rmSync(destination, {recursive:true, force:true});
    throw error;
  }
}

if (isMain(import.meta.url)) {
  const [destination, ...extra] = process.argv.slice(2);
  try {
    if (!destination || extra.length) throw new Error('Usage: node scripts/distribution.mjs OUTPUT_DIRECTORY');
    const source = fileURLToPath(new URL('../', import.meta.url));
    const version = skillVersion(source);
    const files = copyCommunity(source, destination);
    console.log(JSON.stringify({edition:'community', version, directory:path.resolve(destination), files:Object.keys(files).length}, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
