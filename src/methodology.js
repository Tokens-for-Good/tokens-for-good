// Single source of truth for the shipped methodology: the pipeline PROMPT.md
// files bundled with this package, plus the version stamps that ride along
// with every scheduled-routine prompt and report submission.
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const PIPELINE_DIR = join(__dirname, '..', 'pipeline');

// Bump when the pipeline PROMPT.md files change materially. Must be kept in
// sync with ResearchMethodology::VERSION on the backend — the two repos ship
// synced copies of the same files, and the server compares this value at
// submit time (see /api/research/parameters).
export const METHODOLOGY_VERSION = '3.0';

// prompt_version stamp for reports produced by the embedded scheduled prompt
// (prompt format v2: methodology inlined at setup, no runtime instruction
// fetches). The server treats scheduled submits without an "-embed" stamp as
// legacy curl-loader routines. Max 20 chars (API column limit).
export const SCHEDULE_PROMPT_VERSION = `v${METHODOLOGY_VERSION}-embed`;

const STEP_FILES = {
  research: '01-research/PROMPT.md',
  verify: '02-verify/PROMPT.md',
  humanize: '03-humanize/PROMPT.md',
  validate: '04-validate/PROMPT.md',
  consolidate: '05-consolidate/PROMPT.md',
};

export function methodologySteps() {
  return Object.keys(STEP_FILES);
}

export function readMethodology(step) {
  const file = STEP_FILES[step];
  if (!file) return null;
  try {
    return readFileSync(join(PIPELINE_DIR, file), 'utf-8').trim();
  } catch {
    return null;
  }
}
