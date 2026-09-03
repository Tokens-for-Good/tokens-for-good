// The pipeline PROMPT.md files ship in this package (local MCP contributors
// read them through get_methodology, and every scheduled routine embeds them
// at install time), while the server keeps its own copies under
// resources/pipeline/. Both stamp the same METHODOLOGY_VERSION, so when they
// drift the scorer stops matching what half the contributors were told, and
// QA cannot tell the two populations apart. The server copy is the source of
// truth; this test fails until the package copy is brought back in line.
//
// The server checkout is not part of this repo, so the test looks for it next
// to the package (or at TFG_SERVER_PIPELINE_DIR) and skips, loudly, when it
// is absent, so CI elsewhere keeps working.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const STEPS = ['01-research', '02-verify', '03-humanize', '04-validate', '05-consolidate'];

function serverPipelineDir() {
  // An explicit override is the only place looked at, so a wrong path skips
  // visibly instead of quietly checking against some other checkout.
  const candidates = process.env.TFG_SERVER_PIPELINE_DIR
    ? [process.env.TFG_SERVER_PIPELINE_DIR]
    : [
      // vibes/tokens-for-good next to vibes/Fierce Philanthropy
      join(REPO, '..', 'Fierce Philanthropy', 'site', 'resources', 'pipeline'),
      // a worktree under vibes/.wt-*/<name>
      join(REPO, '..', '..', 'Fierce Philanthropy', 'site', 'resources', 'pipeline'),
      'C:\\Users\\bluet\\vibes\\Fierce Philanthropy\\site\\resources\\pipeline',
    ];
  return candidates.find(p => existsSync(p)) ?? null;
}

// Line endings and the trailing newline are the only differences tolerated.
function normalise(text) {
  return text.replace(/\r\n/g, '\n').replace(/\s+$/, '') + '\n';
}

function firstDifference(a, b) {
  const al = a.split('\n');
  const bl = b.split('\n');
  const n = Math.max(al.length, bl.length);
  for (let i = 0; i < n; i++) {
    if (al[i] !== bl[i]) {
      const show = (l) => (l === undefined ? '<end of file>' : l.length > 120 ? l.slice(0, 120) + '…' : l);
      return `line ${i + 1}:\n    package: ${show(al[i])}\n    server:  ${show(bl[i])}`;
    }
  }
  return 'no line-level difference (whitespace?)';
}

const serverDir = serverPipelineDir();

for (const step of STEPS) {
  test(`pipeline/${step}/PROMPT.md matches the server copy`, (t) => {
    if (!serverDir) {
      t.skip('server pipeline directory not found; set TFG_SERVER_PIPELINE_DIR to resources/pipeline of the Fierce Philanthropy checkout to check prompt drift');
      return;
    }
    const packagePath = join(REPO, 'pipeline', step, 'PROMPT.md');
    const serverPath = join(serverDir, `${step}.md`);
    const ours = normalise(readFileSync(packagePath, 'utf-8'));
    const theirs = normalise(readFileSync(serverPath, 'utf-8'));
    assert.ok(
      ours === theirs,
      `${packagePath} differs from ${serverPath} (first difference at ${firstDifference(ours, theirs)}).\n` +
      'The server copy is the source of truth: copy it over, and bump METHODOLOGY_VERSION on both sides if the change is material.'
    );
  });
}
