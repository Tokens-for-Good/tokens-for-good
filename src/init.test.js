import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeWebPermissions, WEB_TOOLS } from './init.js';

// init offers to give the agent standing permission for the two web tools a
// research run cannot work without. Without them a scheduled run stops to ask
// on every page it reads, which is the same as not running at all.

test('both web tools are added to an untouched settings file', () => {
  const { settings, added, skipped } = mergeWebPermissions({});

  assert.deepEqual(added, ['WebFetch', 'WebSearch']);
  assert.deepEqual(skipped, []);
  assert.deepEqual(settings.permissions.allow, ['WebFetch', 'WebSearch']);
});

test('existing settings are preserved, not replaced', () => {
  const { settings } = mergeWebPermissions({
    hooks: { SessionStart: [{ matcher: '' }] },
    permissions: { allow: ['Bash(git status)'], deny: ['Read(./.env)'] },
  });

  assert.deepEqual(settings.hooks.SessionStart, [{ matcher: '' }]);
  assert.deepEqual(settings.permissions.deny, ['Read(./.env)']);
  assert.deepEqual(settings.permissions.allow, ['Bash(git status)', 'WebFetch', 'WebSearch']);
});

test('re-running adds nothing the second time', () => {
  const first = mergeWebPermissions({});
  const second = mergeWebPermissions(first.settings);

  assert.deepEqual(second.added, []);
  assert.deepEqual(second.settings.permissions.allow, ['WebFetch', 'WebSearch']);
  assert.deepEqual(second.skipped.map(s => s.reason), ['already allowed', 'already allowed']);
});

test('a scoped entry is left as the user wrote it, not broadened', () => {
  const { settings, added, skipped } = mergeWebPermissions({
    permissions: { allow: ['WebFetch(domain:example.org)'] },
  });

  assert.deepEqual(added, ['WebSearch']);
  assert.deepEqual(settings.permissions.allow, ['WebFetch(domain:example.org)', 'WebSearch']);
  assert.equal(skipped[0].tool, 'WebFetch');
  assert.equal(skipped[0].reason, 'already allowed');
});

test('a denied tool is skipped rather than written into allow', () => {
  // deny beats allow in Claude Code, so writing it would look like it worked
  // and change nothing.
  const { settings, added, skipped } = mergeWebPermissions({
    permissions: { allow: [], deny: ['WebFetch'] },
  });

  assert.deepEqual(added, ['WebSearch']);
  assert.deepEqual(settings.permissions.allow, ['WebSearch']);
  assert.deepEqual(skipped, [{ tool: 'WebFetch', reason: 'you have it denied' }]);
});

test('a tool set to ask is skipped for the same reason', () => {
  const { added, skipped } = mergeWebPermissions({
    permissions: { ask: ['WebSearch(*)'] },
  });

  assert.deepEqual(added, ['WebFetch']);
  assert.deepEqual(skipped, [{ tool: 'WebSearch', reason: 'you have it set to ask' }]);
});

test('a malformed permissions block is repaired rather than crashing init', () => {
  const { settings, added } = mergeWebPermissions({ permissions: { allow: 'WebFetch' } });

  assert.deepEqual(added, WEB_TOOLS);
  assert.deepEqual(settings.permissions.allow, ['WebFetch', 'WebSearch']);
});
