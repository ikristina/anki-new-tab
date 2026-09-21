// AnkiConnect client plus the small pure helpers around it.
// Kept free of browser globals at module scope so `node --test` can import it.

const ENDPOINT = 'http://127.0.0.1:8765';
const API_VERSION = 6;
const DEFAULT_TIMEOUT_MS = 2000;

/** Anki isn't running, AnkiConnect isn't installed, or the request timed out. */
export class AnkiUnreachable extends Error {
  constructor(cause) {
    super("Can't reach AnkiConnect");
    this.name = 'AnkiUnreachable';
    this.cause = cause;
  }
}

/** AnkiConnect answered, but with an error. */
export class AnkiError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AnkiError';
  }
}

export async function invoke(action, params = {}, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  let response;
  try {
    // A string body is sent as text/plain, which avoids a CORS preflight.
    response = await fetch(ENDPOINT, {
      method: 'POST',
      body: JSON.stringify({ action, version: API_VERSION, params }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new AnkiUnreachable(err);
  }
  if (!response.ok) throw new AnkiError(`AnkiConnect returned HTTP ${response.status}`);

  const { result, error } = await response.json();
  if (error) throw new AnkiError(error);
  return result;
}

// Anki search syntax: these are special even inside a quoted string.
function escapeSearchText(text) {
  return text.replace(/[\\"*_]/g, '\\$&');
}

// An empty deck list means every deck.
function deckClause(decks) {
  if (decks.length === 0) return '';
  return `(${decks.map((name) => `deck:"${escapeSearchText(name)}"`).join(' or ')}) `;
}

const ACTIVE = '-is:suspended -is:buried';

/** Review and learning cards that are due. */
export function buildDueQuery(decks) {
  return `${deckClause(decks)}is:due ${ACTIVE}`;
}

/** Every new card. Anki's own "new cards per day" limit does not apply to searches. */
export function buildNewQuery(decks) {
  return `${deckClause(decks)}is:new ${ACTIVE}`;
}

/** Cards whose first-ever review was today. */
export function buildIntroducedTodayQuery(decks) {
  return `${deckClause(decks)}introduced:1`;
}

/** Fraction of cards that are new while the daily allowance lasts and due cards remain. */
export const NEW_CARD_SHARE = 0.25;

export function newCardAllowance(dailyLimit, introducedToday) {
  return Math.max(0, dailyLimit - introducedToday);
}

/** Whether the next card should come from the new-card pool. */
export function shouldPickNew(dueCount, allowance, rand = Math.random) {
  if (allowance <= 0) return false;
  return dueCount === 0 || rand() < NEW_CARD_SHARE;
}

/**
 * True if the card was reviewed, suspended, buried or deleted after `shown` was fetched,
 * e.g. graded in another browser or in Anki itself. `reps` counts reviews and `queue`
 * changes when a card is suspended or buried. `cardsInfo` returns `{}` for a missing card.
 */
export function cardChanged(shown, fresh) {
  return !fresh?.cardId || fresh.reps !== shown.reps || fresh.queue !== shown.queue;
}

/** Uniform pick, avoiding `excludeId` unless it's the only candidate. */
export function pickRandom(ids, excludeId = null, rand = Math.random) {
  const pool = ids.length > 1 ? ids.filter((id) => id !== excludeId) : ids;
  return pool[Math.floor(rand() * pool.length)];
}

/** Sort comparator that keeps `Parent::Child` right after `Parent`. */
export function compareDeckNames(a, b) {
  const pa = a.split('::');
  const pb = b.split('::');
  for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
    const order = pa[i].localeCompare(pb[i]);
    if (order !== 0) return order;
  }
  return pa.length - pb.length;
}
