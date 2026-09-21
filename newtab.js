import {
  invoke,
  buildDueQuery,
  buildNewQuery,
  buildIntroducedTodayQuery,
  newCardAllowance,
  shouldPickNew,
  pickRandom,
  compareDeckNames,
  AnkiUnreachable,
  AnkiError,
} from './anki.js';
import { getSettings, updateSettings, getTimer, setTimer, TIMER_KEY } from './settings.js';
import { buildCardDocument } from './render.js';
import * as pomodoro from './pomodoro.js';

const $ = (id) => document.getElementById(id);
const els = {
  deckLabel: $('deck-label'),
  cardKind: $('card-kind'),
  dueCount: $('due-count'),
  settingsBtn: $('settings-btn'),
  status: $('status'),
  statusMessage: $('status-message'),
  retryBtn: $('retry-btn'),
  chooseDecksBtn: $('choose-decks-btn'),
  cardView: $('card-view'),
  frame: $('card-frame'),
  notice: $('notice'),
  showAnswerBtn: $('show-answer'),
  grades: $('grades'),
  skipBtn: $('skip-btn'),
  settings: $('settings'),
  deckList: $('deck-list'),
  clearDecksBtn: $('clear-decks-btn'),
  includeNew: $('include-new'),
  newLimit: $('new-limit'),
  pomoWork: $('pomo-work'),
  pomoBreak: $('pomo-break'),
  pomoLong: $('pomo-long'),
  doneBtn: $('done-btn'),
  pomo: $('pomodoro'),
  pomoPhase: $('pomo-phase'),
  pomoTime: $('pomo-time'),
  pomoDots: $('pomo-dots'),
  pomoToggle: $('pomo-toggle'),
  pomoSkip: $('pomo-skip'),
  pomoReset: $('pomo-reset'),
  pomoProgress: $('pomo-progress'),
};

const state = {
  settings: null,
  timer: null,
  card: null,
  revealed: false,
  busy: false,
  loadToken: 0,
  studyChanged: false, // a setting that affects which cards are drawn was changed
};

// ---------- views ----------

function showStatus(message, { retry = false, chooseDecks = false } = {}) {
  els.statusMessage.textContent = message;
  els.retryBtn.hidden = !retry;
  els.chooseDecksBtn.hidden = !chooseDecks;
  els.status.hidden = false;
  els.cardView.hidden = true;
}

function describeError(err) {
  if (err instanceof AnkiUnreachable) {
    return "Can't reach Anki. Open Anki (with the AnkiConnect add-on installed), then retry.";
  }
  if (err instanceof AnkiError && err.message.includes('not at top of queue')) {
    return "Anki only accepts an answer for the next card in its own study queue right now, and this wasn't it. Skip to try another card.";
  }
  if (err instanceof AnkiError) return `Anki returned an error: ${err.message}`;
  return `Something went wrong: ${err.message}`;
}

function showError(err) {
  els.deckLabel.textContent = '';
  els.cardKind.hidden = true;
  els.dueCount.textContent = '';
  showStatus(describeError(err), { retry: true });
}

function setNotice(message) {
  els.notice.textContent = message ?? '';
  els.notice.hidden = !message;
}

function setBusy(busy) {
  state.busy = busy;
  for (const button of [els.showAnswerBtn, els.skipBtn, ...els.grades.querySelectorAll('button')]) {
    button.disabled = busy;
  }
}

// ---------- card display ----------

function fitFrame() {
  const doc = els.frame.contentDocument;
  if (!doc) return;
  const fit = () => {
    // Collapse first so the frame can shrink as well as grow.
    els.frame.style.height = '0px';
    els.frame.style.height = `${doc.documentElement.scrollHeight}px`;
  };
  fit();
  doc.querySelectorAll('img').forEach((img) => img.addEventListener('load', fit, { once: true }));
}
els.frame.addEventListener('load', fitFrame);

async function renderSide(card, side) {
  els.frame.srcdoc = await buildCardDocument(card, side);
}

function setRevealed(revealed) {
  state.revealed = revealed;
  els.showAnswerBtn.hidden = revealed;
  els.grades.hidden = !revealed;
}

async function reveal() {
  if (!state.card || state.revealed || state.busy) return;
  try {
    await renderSide(state.card, 'answer');
    setRevealed(true);
  } catch (err) {
    setNotice(describeError(err));
  }
}

// AnkiConnect card types: 0 new, 1 learning, 2 review, 3 relearning.
function cardKindLabel(card) {
  if (card.type === 0) return 'New';
  if (card.type === 1 || card.type === 3) return 'Learning';
  return '';
}

function showCard(card) {
  state.card = card;
  els.deckLabel.textContent = card.deckName;
  const kind = cardKindLabel(card);
  els.cardKind.textContent = kind;
  els.cardKind.hidden = !kind;
  els.grades.querySelectorAll('button').forEach((button, i) => {
    // Anki wraps each number in invisible bidi-isolate characters; strip them.
    button.querySelector('small').textContent = (card.nextReviews?.[i] ?? '').replace(/[⁦-⁩]/g, '');
  });
  setNotice('');
  setRevealed(false);
  els.status.hidden = true;
  els.cardView.hidden = false;
}

// ---------- loading ----------

// Saved deck names can go stale (renamed or deleted in Anki), so prune them.
async function resolveSelectedDecks(settings) {
  const saved = settings.selectedDecks;
  if (saved.length === 0) return [];
  const existing = new Set(await invoke('deckNames'));
  const kept = saved.filter((name) => existing.has(name));
  if (kept.length !== saved.length) {
    await updateSettings({ selectedDecks: kept });
    settings.selectedDecks = kept;
  }
  return kept;
}

async function loadNext(excludeId = null) {
  const token = ++state.loadToken;
  state.card = null;
  showStatus('Loading…');
  els.dueCount.textContent = '';
  els.cardKind.hidden = true;

  try {
    const settings = (state.settings = await getSettings());
    const decks = await resolveSelectedDecks(settings);
    const dueIds = await invoke('findCards', { query: buildDueQuery(decks) });

    // New cards are capped per day; cards first studied today (anywhere) count against it.
    let allowance = 0;
    if (settings.includeNew) {
      const introduced = await invoke('findCards', { query: buildIntroducedTodayQuery(decks) });
      allowance = newCardAllowance(settings.newCardLimit, introduced.length);
    }

    let pool = dueIds;
    if (shouldPickNew(dueIds.length, allowance)) {
      const newIds = await invoke('findCards', { query: buildNewQuery(decks) });
      if (newIds.length > 0) pool = newIds;
    }
    if (token !== state.loadToken) return;

    els.dueCount.textContent = settings.includeNew
      ? `${dueIds.length} due · ${allowance} new left`
      : `${dueIds.length} due`;

    if (pool.length === 0) {
      els.deckLabel.textContent = decks.length ? decks.join(', ') : 'All decks';
      const limitReached = settings.includeNew && allowance === 0;
      showStatus(
        limitReached
          ? `All caught up. You've reached today's limit of ${settings.newCardLimit} new cards.`
          : 'All caught up. Nothing is due.',
        { retry: true, chooseDecks: true },
      );
      return;
    }

    const [card] = await invoke('cardsInfo', { cards: [pickRandom(pool, excludeId)] });
    if (token !== state.loadToken) return;
    if (!card?.question) throw new AnkiError('The card could not be loaded (it may have just changed).');

    await renderSide(card, 'question');
    if (token !== state.loadToken) return;

    showCard(card);
  } catch (err) {
    if (token === state.loadToken) showError(err);
  }
}

// ---------- grading ----------

async function grade(ease) {
  if (!state.card || !state.revealed || state.busy) return;
  const { cardId } = state.card;
  setBusy(true);
  setNotice('');
  try {
    const [accepted] = await invoke('answerCards', { answers: [{ cardId, ease }] }, { timeoutMs: 5000 });
    if (!accepted) throw new AnkiError('the card may have changed in Anki. Skip it to load another.');
  } catch (err) {
    const { deckName, queue, type } = state.card;
    console.warn('answerCards failed', { cardId, ease, deckName, queue, type, error: err.message });
    setNotice(describeError(err));
    setBusy(false);
    return;
  }
  setBusy(false);
  await loadNext(cardId);
}

// ---------- pomodoro ----------

function renderTimer() {
  const { timer, settings } = state;
  if (!timer || !settings) return;
  const now = Date.now();

  // The background worker normally ends a phase. If its alarm was late, don't sit at 00:00.
  if (timer.status === 'running' && now > timer.endsAt + 3000) {
    commitTimer(pomodoro.complete(timer, now));
    return;
  }

  const left = pomodoro.remainingMs(timer, settings.pomodoro, now);
  const total = pomodoro.phaseMs(timer.phase, settings.pomodoro);
  const label = pomodoro.PHASE_LABELS[timer.phase];

  els.pomo.dataset.phase = timer.phase;
  els.pomo.dataset.status = timer.status;
  els.pomoPhase.textContent = label;
  els.pomoTime.textContent = pomodoro.formatClock(left);
  els.pomoToggle.textContent = { running: 'Pause', paused: 'Resume', idle: 'Start' }[timer.status];
  const elapsed = timer.status === 'idle' ? 0 : 1 - left / total;
  els.pomoProgress.style.width = `${Math.min(100, Math.max(0, elapsed * 100))}%`;
  const filled = pomodoro.cycleProgress(timer);
  [...els.pomoDots.children].forEach((dot, i) => dot.classList.toggle('on', i < filled));
  document.title = timer.status === 'running' ? `${pomodoro.formatClock(left)} ${label}` : 'Anki';
}

function commitTimer(next) {
  state.timer = next;
  renderTimer();
  return setTimer(next);
}

// Clicking leaves focus on the button, which would make Space press it again instead of
// revealing the card, so let go of focus.
function timerAction(makeNext) {
  return (event) => {
    event.currentTarget.blur();
    commitTimer(makeNext(state.timer, state.settings.pomodoro, Date.now()));
  };
}
els.pomoToggle.addEventListener('click', timerAction((t, d, now) => (t.status === 'running' ? pomodoro.pause(t, d, now) : pomodoro.start(t, d, now))));
els.pomoSkip.addEventListener('click', timerAction((t) => pomodoro.skip(t)));
els.pomoReset.addEventListener('click', timerAction(() => pomodoro.initialTimer()));

// The timer is shared through storage, so every open tab and the worker stay in step.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && TIMER_KEY in changes) {
    state.timer = changes[TIMER_KEY].newValue ?? pomodoro.initialTimer();
    renderTimer();
  } else if (area === 'sync' && 'pomodoro' in changes && state.settings) {
    state.settings.pomodoro = { ...state.settings.pomodoro, ...changes.pomodoro.newValue };
    renderTimer();
  }
});

// ---------- settings panel ----------

async function saveSetting(patch, { affectsStudy = false } = {}) {
  await updateSettings(patch);
  Object.assign(state.settings, patch);
  if (affectsStudy) state.studyChanged = true;
}

function renderDeckList(names, selected) {
  els.deckList.replaceChildren(
    ...names.map((name) => {
      const parts = name.split('::');
      const label = document.createElement('label');
      label.className = 'deck';
      label.style.setProperty('--depth', parts.length - 1);

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = name;
      checkbox.checked = selected.has(name);

      const text = document.createElement('span');
      text.textContent = parts.at(-1);

      label.append(checkbox, text);
      return label;
    }),
  );
}

function saveCheckedDecks() {
  const checked = [...els.deckList.querySelectorAll('input:checked')].map((input) => input.value);
  return saveSetting({ selectedDecks: checked }, { affectsStudy: true });
}

function fillSettingsForm() {
  const { includeNew, newCardLimit, pomodoro: durations } = state.settings;
  els.includeNew.checked = includeNew;
  els.newLimit.value = newCardLimit;
  els.newLimit.disabled = !includeNew;
  els.pomoWork.value = durations.workMin;
  els.pomoBreak.value = durations.breakMin;
  els.pomoLong.value = durations.longBreakMin;
}

async function openSettings() {
  els.settings.hidden = false;
  els.settingsBtn.setAttribute('aria-expanded', 'true');
  state.settings = await getSettings();
  fillSettingsForm();
  els.deckList.textContent = 'Loading decks…';
  try {
    const names = await invoke('deckNames');
    renderDeckList(names.sort(compareDeckNames), new Set(state.settings.selectedDecks));
  } catch (err) {
    els.deckList.textContent = describeError(err);
  }
}

function closeSettings() {
  els.settings.hidden = true;
  els.settingsBtn.setAttribute('aria-expanded', 'false');
  if (state.studyChanged) {
    state.studyChanged = false;
    loadNext();
  }
}

// Whole-number inputs: ignore anything outside the field's min/max and restore the old value.
function bindNumberInput(input, current, save) {
  input.addEventListener('change', async () => {
    const value = Number(input.value);
    const valid = Number.isInteger(value) && value >= Number(input.min) && value <= Number(input.max);
    if (!valid) {
      input.value = current();
      return;
    }
    await save(value);
  });
}

const savePomodoro = async (key, value) => {
  await saveSetting({ pomodoro: { ...state.settings.pomodoro, [key]: value } });
  renderTimer();
};

bindNumberInput(els.newLimit, () => state.settings.newCardLimit, (value) =>
  saveSetting({ newCardLimit: value }, { affectsStudy: true }));
bindNumberInput(els.pomoWork, () => state.settings.pomodoro.workMin, (value) => savePomodoro('workMin', value));
bindNumberInput(els.pomoBreak, () => state.settings.pomodoro.breakMin, (value) => savePomodoro('breakMin', value));
bindNumberInput(els.pomoLong, () => state.settings.pomodoro.longBreakMin, (value) => savePomodoro('longBreakMin', value));

els.includeNew.addEventListener('change', async () => {
  els.newLimit.disabled = !els.includeNew.checked;
  await saveSetting({ includeNew: els.includeNew.checked }, { affectsStudy: true });
});

// ---------- events ----------

els.retryBtn.addEventListener('click', () => loadNext());
els.chooseDecksBtn.addEventListener('click', openSettings);
els.showAnswerBtn.addEventListener('click', reveal);
els.skipBtn.addEventListener('click', () => loadNext(state.card?.cardId));
els.grades.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-ease]');
  if (button) grade(Number(button.dataset.ease));
});

els.settingsBtn.addEventListener('click', () => (els.settings.hidden ? openSettings() : closeSettings()));
els.doneBtn.addEventListener('click', closeSettings);
els.deckList.addEventListener('change', saveCheckedDecks);
els.clearDecksBtn.addEventListener('click', async () => {
  els.deckList.querySelectorAll('input:checked').forEach((input) => (input.checked = false));
  await saveCheckedDecks();
});

document.addEventListener('keydown', (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey || !els.settings.hidden) return;
  if (event.key === ' ' || event.key === 'Enter') {
    if (state.card && !state.revealed && event.target === document.body) {
      event.preventDefault();
      reveal();
    }
  } else if (['1', '2', '3', '4'].includes(event.key)) {
    grade(Number(event.key));
  }
});

// ---------- start ----------

async function init() {
  [state.settings, state.timer] = await Promise.all([getSettings(), getTimer()]);
  renderTimer();
  setInterval(renderTimer, 500);
  loadNext();
}
init();
