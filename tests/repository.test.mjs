import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const snapshot=path.join(root,'assets/vendor/video-publisher');
function files(directory) {
  return fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>{
    assert.equal(entry.isSymbolicLink(),false,'Public source must not depend on symlinks: '+entry.name);
    const file=path.join(directory,entry.name);
    return entry.isDirectory()?files(file):[file];
  });
}

test('Pinned upstream snapshot includes its license and matches every declared digest',()=>{
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'assets/vendor/upstream.json'),'utf8'));
  assert.equal(manifest.license,'MIT');
  assert.match(manifest.commit,/^[a-f0-9]{40}$/);
  assert.ok(manifest.files.LICENSE,'Upstream license must be included in provenance');
  assert.deepEqual(files(snapshot).map(file=>path.relative(snapshot,file)).sort(),Object.keys(manifest.files).sort());
  for(const [file,digest] of Object.entries(manifest.files)){
    assert.match(digest,/^[a-f0-9]{64}$/);
    assert.equal(createHash('sha256').update(fs.readFileSync(path.join(snapshot,file))).digest('hex'),digest,file);
  }
});

test('Public scripts only import repository modules and Node standard library',()=>{
  for(const file of files(path.join(root,'scripts')).filter(file=>file.endsWith('.mjs'))){
    const source=fs.readFileSync(file,'utf8');
    for(const match of source.matchAll(/^\s*import\s+(?:.+?\s+from\s+)?["']([^"']+)["']/gm)){
      const name=match[1];
      if(name.startsWith('node:'))continue;
      assert.ok(name.startsWith('.'),'Undeclared external import: '+name);
      const target=path.resolve(path.dirname(file),name);
      assert.ok(target.startsWith(root),'Import escapes public repository: '+name);
      assert.ok(fs.statSync(target).isFile(),'Missing public dependency: '+name);
    }
  }
});
