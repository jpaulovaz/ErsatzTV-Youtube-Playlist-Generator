const test = require('node:test');
const assert = require('node:assert/strict');
const client = require('../src/integrations/bazarrClient');

function bazarr() {
  return { enabled: true, url: 'http://bazarr:6767', apiKey: 'secret', timeoutSeconds: 5, pathMappings: [{ localRoot: '/mnt/media', bazarrRoot: '/media' }] };
}

test('Bazarr path mapping usa a raiz mais específica sem expor API key', () => {
  const cfg = bazarr();
  cfg.pathMappings.push({ localRoot: '/mnt/media/tv', bazarrRoot: '/tv' });
  assert.equal(client.mapLocalToBazarr('/mnt/media/tv/Show/E01.mkv', cfg), '/tv/Show/E01.mkv');
  assert.equal(client.mapLocalToBazarr('/mnt/media/movies/A.mkv', cfg), '/media/movies/A.mkv');
});

test('Bazarr encontra filme por caminho e pesquisa candidatos', async () => {
  const previousFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('/api/movies')) return new Response(JSON.stringify({ data: [{ radarrId: 11, title: 'Movie', path: '/media/movies/Movie.mkv' }] }), { status: 200 });
    if (String(url).includes('/api/providers/movies')) return new Response(JSON.stringify({ data: [{ subtitle: 'abc', provider: 'opensubtitlescom', language: 'Portuguese (Brazil)', score: 98, forced: 'False', hearing_impaired: 'False', release_info: ['WEB-DL'] }] }), { status: 200 });
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  };
  try {
    const match = await client.findMediaByPath(bazarr(), '/mnt/media/movies/Movie.mkv');
    assert.equal(match.type, 'movie');
    assert.equal(match.radarrId, 11);
    const results = await client.searchSubtitles(bazarr(), match);
    assert.equal(results[0].candidateId, 'abc');
    assert.equal(results[0].score, 98);
    assert.equal(calls[0].options.headers['X-API-KEY'], 'secret');
  } finally { global.fetch = previousFetch; }
});

test('Bazarr download manual envia candidato e força SRT', async () => {
  const previousFetch = global.fetch;
  let request = null;
  global.fetch = async (url, options = {}) => { request = { url: String(url), options }; return new Response(null, { status: 204 }); };
  try {
    await client.downloadCandidate(bazarr(), { type: 'episode', seriesId: 7, episodeId: 9 }, { candidateId: 'sid', provider: 'p', hearingImpaired: false, forced: false });
    assert.match(request.url, /\/api\/providers\/episodes$/);
    assert.match(request.options.body, /seriesid=7/);
    assert.match(request.options.body, /episodeid=9/);
    assert.match(request.options.body, /original_format=False/);
  } finally { global.fetch = previousFetch; }
});

test('Bazarr HTTP 401 vira erro de autenticação específico', async () => {
  const previousFetch = global.fetch;
  global.fetch = async () => new Response('Unauthorized', { status: 401 });
  try {
    await assert.rejects(() => client.testConnection(bazarr()), (error) => error.code === 'BAZARR_AUTH_REQUIRED' && error.statusCode === 401);
  } finally { global.fetch = previousFetch; }
});
