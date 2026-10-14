import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeShowtime } from '../../site/js/models.js';
import { browseMovies, isConcert, screeningLabel, overnightLabel } from '../../site/js/browse.js';

const show = (title, day, time = '20:00', extra = {}) => makeShowtime({ movie_title: title, business_date: day, start: `${day}T${time}`, ...extra });
test('earliest sort uses booking day, today A–Z then advance dates A–Z', () => {
  const shows = [show('Zebra', '2026-10-14', '09:00'), show('Alpha', '2026-10-14', '23:00'), show('Later', '2026-12-16'), show('Beta', '2026-10-15'), show('Old', '2026-10-13')];
  assert.deepEqual(browseMovies(shows, { today: '2026-10-14', sort: 'time' }).map(m => m.title), ['Alpha', 'Zebra', 'Beta', 'Later']);
  assert.equal(screeningLabel('2026-10-14', '2026-10-14'), 'Showing now');
  assert.equal(screeningLabel('2026-12-16', '2026-10-14'), 'Next screening: 16 Dec 2026');
});
test('concert classification keeps musicals and ordinary live/fan events', () => {
  assert.equal(isConcert({ genres: ['Concert'] }), true);
  assert.equal(isConcert({ genres: ['Live Event'], tags: ['Concert / Live'] }), true);
  assert.equal(isConcert({ genres: ['Musical'] }), false);
  assert.equal(isConcert({ genres: ['Live Event', 'Action'], tags: ['Fans Party'] }), false);
});
test('midnight retains previous booking date and adds +1 in previews', () => {
  const late = show('Doomsday', '2026-12-16', '00:05', { start: '2026-12-17T00:05' });
  assert.equal(overnightLabel(late), '00:05 +1');
  assert.equal(browseMovies([late], { today: '2026-10-14' })[0].nextDate, '2026-12-16');
  assert.equal(overnightLabel(show('Day', '2026-12-16')), '20:00');
});
