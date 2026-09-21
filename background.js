// Service worker: fires the Pomodoro alarm and notifies when a phase ends, even when
// no new tab is open. The page only writes timer state; this worker owns the alarm.
import { getSettings, getTimer, setTimer, TIMER_KEY } from './settings.js';
import { complete, initialTimer, phaseMs, PHASE_LABELS } from './pomodoro.js';

const ALARM = 'pomodoro';
// Alarms can fire a moment early relative to the stored end time.
const TOLERANCE_MS = 1000;

async function syncAlarm(timer) {
  if (timer.status === 'running') await chrome.alarms.create(ALARM, { when: timer.endsAt });
  else await chrome.alarms.clear(ALARM);
}

async function notifyPhaseEnded(finished, next) {
  const { pomodoro } = await getSettings();
  const minutes = Math.round(phaseMs(next.phase, pomodoro) / 60_000);
  const message =
    finished.phase === 'work'
      ? `Focus session done. Time for a ${minutes}-minute ${PHASE_LABELS[next.phase].toLowerCase()}.`
      : `Break's over. Ready for another ${minutes}-minute focus session?`;
  await chrome.notifications.create('pomodoro-done', {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: PHASE_LABELS[finished.phase] + ' finished',
    message,
    priority: 2,
  });
}

// Runs on alarm, browser start and install: finishes a phase that has ended (also one
// that ended while the browser was closed) or re-arms the alarm for one still running.
async function reconcile() {
  const timer = await getTimer();
  const next = complete(timer, Date.now() + TOLERANCE_MS);
  if (next === timer) {
    await syncAlarm(timer);
    return;
  }
  await setTimer(next);
  await notifyPhaseEnded(timer, next);
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) reconcile();
});
chrome.runtime.onStartup.addListener(reconcile);
chrome.runtime.onInstalled.addListener(reconcile);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && TIMER_KEY in changes) syncAlarm(changes[TIMER_KEY].newValue ?? initialTimer());
});
