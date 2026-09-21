// Pomodoro state machine. Pure functions over a plain state object so the page and
// the background worker can share it through chrome.storage, and so it can be tested.
//
// state = { phase, status, endsAt, remainingMs, completedWork }
//   phase:  'work' | 'break' | 'longBreak'
//   status: 'idle' | 'running' | 'paused'
//   endsAt: epoch ms while running; remainingMs: ms left while paused

export const PHASE_LABELS = { work: 'Focus', break: 'Break', longBreak: 'Long break' };
export const SESSIONS_PER_CYCLE = 4;

export const DEFAULT_DURATIONS = { workMin: 25, breakMin: 5, longBreakMin: 15 };

const MINUTES_KEY = { work: 'workMin', break: 'breakMin', longBreak: 'longBreakMin' };

export function initialTimer() {
  return { phase: 'work', status: 'idle', endsAt: null, remainingMs: null, completedWork: 0 };
}

export function phaseMs(phase, durations) {
  return durations[MINUTES_KEY[phase]] * 60_000;
}

export function remainingMs(timer, durations, now) {
  if (timer.status === 'running') return Math.max(0, timer.endsAt - now);
  if (timer.status === 'paused') return timer.remainingMs;
  return phaseMs(timer.phase, durations);
}

export function start(timer, durations, now) {
  if (timer.status === 'running') return timer;
  return { ...timer, status: 'running', endsAt: now + remainingMs(timer, durations, now), remainingMs: null };
}

export function pause(timer, durations, now) {
  if (timer.status !== 'running') return timer;
  return { ...timer, status: 'paused', endsAt: null, remainingMs: remainingMs(timer, durations, now) };
}

function idleAt(phase, completedWork) {
  return { phase, status: 'idle', endsAt: null, remainingMs: null, completedWork };
}

/** Every fourth finished focus session earns the long break. */
function breakAfter(completedWork) {
  return completedWork > 0 && completedWork % SESSIONS_PER_CYCLE === 0 ? 'longBreak' : 'break';
}

/**
 * Called when a running phase runs out. Counts a finished focus session and moves to
 * the next phase, waiting for the user to start it. Safe to call twice: it does
 * nothing unless the timer is running and due, so the page and the worker can race.
 */
export function complete(timer, now) {
  if (timer.status !== 'running' || timer.endsAt > now) return timer;
  if (timer.phase === 'work') {
    const completedWork = timer.completedWork + 1;
    return idleAt(breakAfter(completedWork), completedWork);
  }
  return idleAt('work', timer.completedWork);
}

/** Move on without counting the session. */
export function skip(timer) {
  return timer.phase === 'work' ? idleAt('break', timer.completedWork) : idleAt('work', timer.completedWork);
}

/** How many of the cycle's dots are filled. */
export function cycleProgress(timer) {
  if (timer.phase === 'longBreak') return SESSIONS_PER_CYCLE;
  return timer.completedWork % SESSIONS_PER_CYCLE;
}

/** mm:ss, rounding up so the display never reads 00:00 while time remains. */
export function formatClock(ms) {
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
