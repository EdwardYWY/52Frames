import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeShowtime } from '../../site/js/models.js';
import { summarizeMovies } from '../../site/js/aggregator.js';

test('same-title language versions split while chain language aliases merge', () => {
  const show = (chain, language) => makeShowtime({ chain, movie_title: 'Jailer 2', language, start: '2026-10-15T20:00', business_date: '2026-10-15' });
  const movies = summarizeMovies([show('GSC', 'TAM'), show('TGV', 'Tamil'), show('TGV', 'Hindi')]);
  assert.equal(movies.length, 2);
  assert.deepEqual(movies.map(m => [m.language, m.showCount]).sort(), [['Hindi', 1], ['Tamil', 2]]);
  assert.notEqual(movies[0].key, movies[1].key);
});
