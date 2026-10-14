import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { collectCatalogue } from '../../site/js/catalog.js';
import { parseXml } from '../../scripts/xml.mjs';
const fixture = name => JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));

test('GSC movie-date collection preserves overnight date, genre and premium hall', async () => {
  const venues = fixture('gsc_locations.json');
  const first = venues.Response.Body.Locations.find(c => !c.IsEpayHidden);
  const date = '2099-12-16';
  const fetch = async url => ({ ok: true, json: async () => venues, text: async () => url.includes('getEpaymentMovie')
    ? `<films><parent code="42" title="Test"><child><show opsdate="${date}"/></child></parent></films>`
    : `<locations parent_code="42" parent_title="Test"><location id="${first.CinemaCode}" hallgroup="${first.HallGroup || ''}"><child genre="Concert" lang="ENG"><show date="2099-12-17" time="0005"/></child></location></locations>` });
  const result = await collectCatalogue({ fetch, parseXml, chains: ['GSC'] });
  assert.deepEqual(result.errors, []);
  assert.equal(result.showtimes[0].business_date, date);
  assert.equal(result.showtimes[0].start, '2099-12-17T00:05');
  assert.deepEqual(result.showtimes[0].genres, ['Concert']);
});
test('TGV discovers advance dates and fetches each cinema-day once across movies', async () => {
  const calls = [];
  const fetch = async (url, options = {}) => {
    const body = JSON.parse(options.body || '{}');
    calls.push({ url, body });
    let data;
    if (url.includes('getstatecinema')) data = fixture('tgv_states.json');
    else if (url.endsWith('getmoviepagemovielist')) data = { results: { movielistinfo: [{ key: 'nowselling' }] } };
    else if (url.endsWith('/nowselling')) data = { results: { movies: [{ recid: 'a', name: 'A' }, { recid: 'b', name: 'B' }] } };
    else if (url.endsWith('getsessionbusinessdates')) data = { results: { businessdates: ['2099-12-16'] } };
    else if (url.endsWith('getmoviecinemas')) data = { results: { locations: [{ cinemaids: [{ cinemaid: 'PKL' }] }] } };
    else data = { success: true, results: { movies: [], businessday: { cinemas: [] } } };
    return { ok: true, json: async () => data };
  };
  const result = await collectCatalogue({ fetch, parseXml, chains: ['TGV'] });
  assert.deepEqual(result.errors, []);
  const sessions = calls.filter(c => c.url.endsWith('/moviesession_get'));
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].body.businessdate, '2099-12-16');
});
