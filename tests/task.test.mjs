import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDynamicOptions,assertManualSendContent} from '../scripts/task.mjs';

test('Repeated control flags fail rather than ambiguously resuming or releasing',()=>{
  for(const flag of ['--resume-control','--confirm-manual-send','--defer-handoff']) {
    assert.throws(()=>parseDynamicOptions(['handoff','--package','fixture.json','--platform','x','--job-id','fixture',flag,flag]),/Duplicate flag/);
  }
});

test('Manual handoff protects resolved content, including text loaded from a file',()=>{
  assertManualSendContent({text:'Confirmed user content'});
  for(const content of [{title:'请勿发布'},{description:'fixture 请勿发布'},{blocks:[{text:'请勿发布'}]}]) assert.throws(()=>assertManualSendContent(content),/Test content stays protected/);
});
