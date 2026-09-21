import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDueQuery,
  buildNewQuery,
  buildIntroducedTodayQuery,
  newCardAllowance,
  shouldPickNew,
  NEW_CARD_SHARE,
  cardChanged,
  pickRandom,
  compareDeckNames,
} from './anki.js';

const DUE = 'is:due -is:suspended -is:buried';

test('buildDueQuery: no decks means all decks', () => {
  assert.equal(buildDueQuery([]), DUE);
});

test('buildDueQuery: ORs several decks together', () => {
  assert.equal(buildDueQuery(['Spanish', 'Go::Concurrency']), `(deck:"Spanish" or deck:"Go::Concurrency") ${DUE}`);
});

test('buildDueQuery: escapes quotes, backslashes and wildcards', () => {
  assert.equal(buildDueQuery(['My "deck"']), `(deck:"My \\"deck\\"") ${DUE}`);
  assert.equal(buildDueQuery(['a_b*c']), `(deck:"a\\_b\\*c") ${DUE}`);
  assert.equal(buildDueQuery(['a\\b']), `(deck:"a\\\\b") ${DUE}`);
});

test('new and introduced queries share the deck clause', () => {
  assert.equal(buildNewQuery([]), 'is:new -is:suspended -is:buried');
  assert.equal(buildNewQuery(['Go']), '(deck:"Go") is:new -is:suspended -is:buried');
  assert.equal(buildIntroducedTodayQuery([]), 'introduced:1');
  assert.equal(buildIntroducedTodayQuery(['A', 'B']), '(deck:"A" or deck:"B") introduced:1');
});

test('newCardAllowance: never negative', () => {
  assert.equal(newCardAllowance(20, 13), 7);
  assert.equal(newCardAllowance(20, 20), 0);
  assert.equal(newCardAllowance(20, 35), 0);
});

test('shouldPickNew: respects the allowance and the share', () => {
  assert.equal(shouldPickNew(500, 0, () => 0), false); // limit reached
  assert.equal(shouldPickNew(0, 5, () => 0.99), true); // nothing due: always new
  assert.equal(shouldPickNew(500, 5, () => NEW_CARD_SHARE - 0.01), true);
  assert.equal(shouldPickNew(500, 5, () => NEW_CARD_SHARE), false);
});

test('cardChanged: detects a review, a suspend/bury, or a deleted card', () => {
  const shown = { cardId: 7, reps: 3, queue: 2 };
  assert.equal(cardChanged(shown, { cardId: 7, reps: 3, queue: 2 }), false);
  assert.equal(cardChanged(shown, { cardId: 7, reps: 4, queue: 2 }), true); // graded elsewhere
  assert.equal(cardChanged(shown, { cardId: 7, reps: 3, queue: -1 }), true); // suspended
  assert.equal(cardChanged(shown, { cardId: 7, reps: 3, queue: -2 }), true); // buried
  assert.equal(cardChanged(shown, {}), true); // AnkiConnect's answer for a missing card
  assert.equal(cardChanged(shown, undefined), true);
});

test('pickRandom: covers every index and avoids the excluded id', () => {
  const ids = [10, 20, 30];
  assert.equal(pickRandom(ids, null, () => 0), 10);
  assert.equal(pickRandom(ids, null, () => 0.999), 30);
  for (const r of [0, 0.4, 0.6, 0.999]) {
    assert.notEqual(pickRandom(ids, 20, () => r), 20);
  }
});

test('pickRandom: returns the excluded id when it is the only one', () => {
  assert.equal(pickRandom([7], 7), 7);
});

test('compareDeckNames: children follow their parent', () => {
  const sorted = ['B', 'A::Z', 'A B', 'A', 'A::Y'].sort(compareDeckNames);
  assert.deepEqual(sorted, ['A', 'A::Y', 'A::Z', 'A B', 'B']);
});
