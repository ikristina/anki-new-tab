import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  initialTimer,
  DEFAULT_DURATIONS as D,
  remainingMs,
  start,
  pause,
  complete,
  skip,
  cycleProgress,
  formatClock,
} from './pomodoro.js';

const MIN = 60_000;

test('idle timer shows the full phase length', () => {
  assert.equal(remainingMs(initialTimer(), D, 0), 25 * MIN);
});

test('start then pause keeps the time that was left', () => {
  const running = start(initialTimer(), D, 1000);
  assert.equal(running.status, 'running');
  assert.equal(running.endsAt, 1000 + 25 * MIN);

  const paused = pause(running, D, 1000 + 10 * MIN);
  assert.equal(paused.status, 'paused');
  assert.equal(remainingMs(paused, D, 999_999_999), 15 * MIN);

  const resumed = start(paused, D, 5_000_000);
  assert.equal(resumed.endsAt, 5_000_000 + 15 * MIN);
});

test('start on a running timer and pause on an idle one are no-ops', () => {
  const running = start(initialTimer(), D, 0);
  assert.equal(start(running, D, 500), running);
  const idle = initialTimer();
  assert.equal(pause(idle, D, 0), idle);
});

test('complete: does nothing before the end, or when not running (idempotent)', () => {
  const running = start(initialTimer(), D, 0);
  assert.equal(complete(running, 25 * MIN - 1), running);
  assert.equal(complete(initialTimer(), 10 ** 12).status, 'idle');

  const done = complete(running, 25 * MIN);
  assert.deepEqual([done.phase, done.status, done.completedWork], ['break', 'idle', 1]);
  assert.equal(complete(done, 10 ** 12), done);
});

test('complete: the fourth focus session earns the long break', () => {
  let timer = initialTimer();
  const phases = [];
  for (let i = 0; i < 4; i++) {
    timer = complete(start(timer, D, 0), 10 ** 12); // finish focus
    phases.push(timer.phase);
    timer = complete(start(timer, D, 0), 10 ** 12); // finish the break
    assert.equal(timer.phase, 'work');
  }
  assert.deepEqual(phases, ['break', 'break', 'break', 'longBreak']);
  assert.equal(timer.completedWork, 4);
});

test('skip: moves to the next phase without counting the session', () => {
  const skipped = skip(initialTimer());
  assert.deepEqual([skipped.phase, skipped.status, skipped.completedWork], ['break', 'idle', 0]);
  assert.equal(skip(skipped).phase, 'work');
});

test('cycleProgress fills the dots, and all four on the long break', () => {
  assert.equal(cycleProgress({ ...initialTimer(), completedWork: 2 }), 2);
  assert.equal(cycleProgress({ ...initialTimer(), phase: 'longBreak', completedWork: 4 }), 4);
  assert.equal(cycleProgress({ ...initialTimer(), completedWork: 5 }), 1);
});

test('formatClock rounds up to whole seconds', () => {
  assert.equal(formatClock(25 * MIN), '25:00');
  assert.equal(formatClock(61_001), '01:02');
  assert.equal(formatClock(1), '00:01');
  assert.equal(formatClock(0), '00:00');
});
