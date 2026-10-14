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
  assert.deepEqual(movies.map(m => m.title).sort(), ['Jailer 2 (Hindi)', 'Jailer 2 (Tamil)']);
});
test('existing language suffixes are not duplicated and single-language titles stay unchanged', () => {
  const show = (title, language) => makeShowtime({ movie_title: title, language, start: '2026-10-15T20:00' });
  assert.deepEqual(summarizeMovies([show('Jailer 2', 'TAM'), show('Jailer 2 (Hindi)', 'Hindi')]).map(m => m.title).sort(), ['Jailer 2 (Hindi)', 'Jailer 2 (Tamil)']);
  assert.equal(summarizeMovies([show('Street Fighter', 'ENG')])[0].title, 'Street Fighter');
});
