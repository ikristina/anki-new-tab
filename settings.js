import { DEFAULT_DURATIONS, initialTimer } from './pomodoro.js';

const DEFAULTS = {
  selectedDecks: [], // empty means every deck
  includeNew: false,
  newCardLimit: 20,
  pomodoro: DEFAULT_DURATIONS,
};

// The timer counts down on this device only, so it lives in local storage, not sync.
export const TIMER_KEY = 'pomodoroTimer';

export async function getSettings() {
  const stored = await chrome.storage.sync.get(Object.keys(DEFAULTS));
  return { ...DEFAULTS, ...stored, pomodoro: { ...DEFAULT_DURATIONS, ...stored.pomodoro } };
}

/** `patch` holds top-level keys only, e.g. `{ pomodoro: { ...settings.pomodoro, workMin: 50 } }`. */
export async function updateSettings(patch) {
  await chrome.storage.sync.set(patch);
}

export async function getTimer() {
  const { [TIMER_KEY]: timer } = await chrome.storage.local.get(TIMER_KEY);
  return timer ?? initialTimer();
}

export async function setTimer(timer) {
  await chrome.storage.local.set({ [TIMER_KEY]: timer });
}
