import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {configuration} from '../scripts/settings.mjs';
import {main} from '../scripts/publisher.mjs';
import {entries} from '../scripts/registry.mjs';

test('Configuration creates private defaults and reads manual changes without replacing them', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), '168-settings-'));
  try {
    const file = path.join(temp, 'settings.json');
    const initial = configuration(file, entries);
    assert.deepEqual(initial.configuration.platforms.dynamic, entries.dynamic.platforms);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    const changed = {...initial.configuration, profile: 'my-profile', platforms: {...initial.configuration.platforms, dynamic: ['x']}, waitTimeout: 600};
    const text = JSON.stringify(changed);
    fs.writeFileSync(file, text);
    assert.deepEqual(configuration(file, entries).configuration, changed);
    assert.equal(fs.readFileSync(file, 'utf8'), text);
    for (const invalid of [
      {...changed, waitTimeout: 0},
      {...changed, profile: 'two\nlines'},
      {...changed, platforms: {...changed.platforms, dynamic: ['x', 'x']}},
      {...changed, platforms: {...changed.platforms, dynamic: ['zhihu']}},
      {...changed, platforms: {dynamic: ['x']}},
      {...changed, token: 'fixture-only'},
    ]) {
      fs.writeFileSync(file, JSON.stringify(invalid));
      assert.throws(() => configuration(file, entries));
      assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), invalid);
    }
  } finally {fs.rmSync(temp, {recursive: true, force: true});}
});

test('Config entry requires no package or browser and validates each injected registry independently', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), '168-settings-pro-'));
  const original = console.log;
  const output = [];
  console.log = text => output.push(JSON.parse(text));
  try {
    const registry = {...entries, additional: {platforms: ['example']}};
    const options = {registry, configFile: path.join(temp, 'pro', 'settings.json'), stateHome: path.join(temp, 'jobs')};
    await main(['config'], options);
    assert.deepEqual(output[0].configuration.platforms.additional, registry.additional.platforms);
    assert.equal(fs.existsSync(options.stateHome), false);
    await assert.rejects(() => main(['config', '--confirm-manual-send'], options), /Usage/);
    assert.throws(() => configuration(options.configFile, entries));
  } finally {console.log = original; fs.rmSync(temp, {recursive: true, force: true});}
});
