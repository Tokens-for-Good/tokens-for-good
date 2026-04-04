// Local state management for contributor session tracking
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const STATE_DIR = join(homedir(), '.tokens-for-good');
const STATE_FILE = join(STATE_DIR, 'state.json');

const DEFAULT_STATE = {
  last_contributed: null,
  snooze_until: null,
  auto_schedule: false,
  platform: null,
  total_session_contributions: 0,
};

export function loadState() {
  try {
    if (existsSync(STATE_FILE)) {
      const raw = readFileSync(STATE_FILE, 'utf-8');
      return { ...DEFAULT_STATE, ...JSON.parse(raw) };
    }
  } catch {
    // Corrupted state file, reset
  }
  return { ...DEFAULT_STATE };
}

export function saveState(state) {
  if (!existsSync(STATE_DIR)) {
    mkdirSync(STATE_DIR, { recursive: true });
  }
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

export function updateState(updates) {
  const state = loadState();
  Object.assign(state, updates);
  saveState(state);
  return state;
}

export function isSnoozed() {
  const state = loadState();
  if (!state.snooze_until) return false;
  return new Date(state.snooze_until) > new Date();
}

export function snoozeUntil(date) {
  updateState({ snooze_until: date.toISOString() });
}

export function snoozeDays(days) {
  const until = new Date();
  until.setDate(until.getDate() + days);
  snoozeUntil(until);
}

export function hasContributedToday() {
  const state = loadState();
  if (!state.last_contributed) return false;
  const lastDate = new Date(state.last_contributed).toDateString();
  return lastDate === new Date().toDateString();
}

export function markContributed() {
  const state = loadState();
  state.last_contributed = new Date().toISOString();
  state.total_session_contributions = (state.total_session_contributions || 0) + 1;
  saveState(state);
}
