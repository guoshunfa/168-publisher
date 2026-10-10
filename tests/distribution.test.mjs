import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {copyCommunity, inventory, skillVersion} from '../scripts/distribution.mjs';

const source = fileURLToPath(new URL('../',import.meta.url));

test('Public export is self-contained, preserves upstream and excludes private workspace',()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'168-public-export-'));
  try {
    const output=path.join(temp,'public'),files=copyCommunity(source,output);
    assert.ok(files['SKILL.md']);
    assert.ok(files['README.md']);
    assert.ok(files['README.en.md']);
    assert.equal(Object.hasOwn(files,'AGENTS.md'),false);
    assert.ok(files['scripts/registry.mjs']);
    assert.ok(files['tests/repository.test.mjs']);
    assert.ok(files['references/installation.md']);
    assert.ok(files['references/changelog.md']);
    assert.ok(files['.github/CONTRIBUTING.md']);
    assert.ok(files['assets/vendor/video-publisher/LICENSE']);
    assert.equal(files['assets/vendor/upstream.json'],inventory(source)['assets/vendor/upstream.json']);
    assert.ok(!Object.keys(files).some(name=>name.includes('article') || name.startsWith('pro/')));
    const runtime=copyCommunity(source,path.join(temp,'runtime'),{runtimeOnly:true});
    assert.ok(runtime['references/installation.md']);
    assert.ok(runtime['assets/vendor/video-publisher/LICENSE']);
    assert.ok(!Object.keys(runtime).some(name=>name.startsWith('tests/') || name.startsWith('.github/') || name.endsWith('.test.mjs')));
    const report=JSON.parse(execFileSync(process.execPath,[path.join(source,'scripts/distribution.mjs'),path.join(temp,'cli')],{encoding:'utf8'}));
    assert.equal(report.version,skillVersion(source));
    const imports=Object.keys(files).filter(name=>name.endsWith('.mjs'));
    for(const name of imports) {
      const text=fs.readFileSync(path.join(output,name),'utf8');
      for(const match of text.matchAll(/^\s*(?:import|export)\s+.*?from\s+['"]([^'"]+)['"]/gm)) {
        if(match[1].startsWith('node:'))continue;
        const target=path.resolve(path.dirname(path.join(output,name)),match[1]);
        assert.ok(target.startsWith(output+path.sep),name);
        assert.ok(fs.existsSync(target),name+': '+match[1]);
      }
    }
    fs.writeFileSync(path.join(output,'keep.txt'),'existing');
    assert.throws(()=>copyCommunity(source,output),/already exists/);
    assert.equal(fs.readFileSync(path.join(output,'keep.txt'),'utf8'),'existing');
    const alias=path.join(temp,'source-alias');fs.symlinkSync(source,alias);
    assert.throws(()=>copyCommunity(source,path.join(alias,'private-output')),/outside the community source/);
    assert.equal(fs.existsSync(path.join(source,'private-output')),false);
  } finally { fs.rmSync(temp,{recursive:true,force:true}); }
});

test('Export rejects missing or invalid Skill versions before creating output',()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'168-public-version-'));
  try {
    const fixture=path.join(temp,'source');copyCommunity(source,fixture);
    const skill=path.join(fixture,'SKILL.md'),original=fs.readFileSync(skill,'utf8');
    for(const value of ['', '  version: "0.0"', '  version: 0.0.1', '  version: "00.0.1"']) {
      fs.writeFileSync(skill,original.replace(/^  version: .+$/m,value));
      const output=path.join(temp,'out');
      assert.throws(()=>copyCommunity(fixture,output),/metadata.version/);
      assert.equal(fs.existsSync(output),false);
    }
  } finally {fs.rmSync(temp,{recursive:true,force:true});}
});

test('Export refuses symlinks and accidental credentials before creating output',()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'168-public-refusal-'));
  try {
    const fixture=path.join(temp,'source');copyCommunity(source,fixture);
    const output=path.join(temp,'out');
    fs.writeFileSync(path.join(fixture,'scripts','.env'),'TEST_ONLY');
    assert.throws(()=>copyCommunity(fixture,output),/Unexpected|Hidden/);
    assert.equal(fs.existsSync(output),false);
    fs.rmSync(path.join(fixture,'scripts','.env'));
    fs.symlinkSync(path.join(temp,'absent'),path.join(fixture,'scripts','private.mjs'));
    assert.throws(()=>copyCommunity(fixture,output),/symlink/);
    assert.equal(fs.existsSync(output),false);
  } finally { fs.rmSync(temp,{recursive:true,force:true}); }
});
