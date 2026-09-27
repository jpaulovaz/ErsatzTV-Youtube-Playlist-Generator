const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { runLibraryAction, scanOnIdle, listErsatzTvChannels, listSmartCollections, getErsatzTvVersion, linkSmartCollection } = require('../src/ersatztvService');

async function withServer(handler, callback) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try {
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test('sends X-Etv-Api-Key on ErsatzTV scan requests', async () => {
  await withServer((req, res) => {
    assert.equal(req.method, 'POST');
    assert.equal(req.url, '/api/libraries/37/scan');
    assert.equal(req.headers['x-etv-api-key'], 'secret-test-key');
    res.writeHead(200).end();
  }, async (url) => {
    const result = await runLibraryAction({
      ersatztv: { url, apiKey: 'secret-test-key', apiTimeoutSeconds: 5 },
      downloads: {}
    }, { name: 'Teste', libraryId: 37 }, 'scan');

    assert.equal(result.ok, true);
    assert.equal(result.status, 200);
  });
});

test('does not send an empty API Key header', async () => {
  await withServer((req, res) => {
    assert.equal(req.headers['x-etv-api-key'], undefined);
    res.writeHead(200).end();
  }, async (url) => {
    const result = await runLibraryAction({
      ersatztv: { url, apiKey: '', apiTimeoutSeconds: 5 },
      downloads: {}
    }, { name: 'Teste', libraryId: 37 }, 'scan');

    assert.equal(result.ok, true);
  });
});

test('returns a useful message for ErsatzTV API authorization failures', async () => {
  await withServer((req, res) => {
    res.writeHead(401).end();
  }, async (url) => {
    const result = await runLibraryAction({
      ersatztv: { url, apiKey: 'invalid', apiTimeoutSeconds: 5 },
      downloads: {}
    }, { name: 'Teste', libraryId: 37 }, 'scan');

    assert.equal(result.ok, false);
    assert.equal(result.status, 401);
    assert.match(result.statusText, /API Key/);
  });
});


test('uses ErsatzTV v26.10.0 global maintenance endpoint to empty trash', async () => {
  await withServer((req, res) => {
    assert.equal(req.method, 'POST');
    assert.equal(req.url, '/api/maintenance/empty_trash');
    assert.equal(req.headers['x-etv-api-key'], 'secret-test-key');
    res.writeHead(204).end();
  }, async (url) => {
    const result = await runLibraryAction({
      ersatztv: { url, apiKey: 'secret-test-key', apiTimeoutSeconds: 5 },
      downloads: {}
    }, { name: 'Teste' }, 'empty-trash');

    assert.equal(result.ok, true);
    assert.equal(result.status, 204);
  });
});

test('resets playout by ErsatzTV channel number instead of Playout ID', async () => {
  await withServer((req, res) => {
    assert.equal(req.method, 'POST');
    assert.equal(req.url, '/api/channels/421/playout/reset');
    assert.equal(req.headers['x-etv-api-key'], 'secret-test-key');
    res.writeHead(200).end();
  }, async (url) => {
    const result = await runLibraryAction({
      ersatztv: { url, apiKey: 'secret-test-key', apiTimeoutSeconds: 5 },
      downloads: {}
    }, { name: 'Teste', channelNumber: 421 }, 'reset-playout');

    assert.equal(result.ok, true);
  });
});

test('refuses playout reset when ErsatzTV channel number is not configured', async () => {
  const result = await runLibraryAction({
    ersatztv: { url: 'http://127.0.0.1:1', apiKey: 'secret-test-key', apiTimeoutSeconds: 1 },
    downloads: {}
  }, { name: 'Teste', playoutId: 421 }, 'reset-playout');

  assert.equal(result.ok, false);
  assert.equal(result.status, 0);
  assert.match(result.statusText, /Numero do canal/);
});


test('idle ErsatzTV automation performs scan only and never resets playout', async () => {
  let requests = 0;
  await withServer((req, res) => {
    requests += 1;
    assert.equal(req.method, 'POST');
    assert.equal(req.url, '/api/libraries/37/scan');
    res.writeHead(200).end();
  }, async (url) => {
    const result = await scanOnIdle({
      ersatztv: { url, apiKey: 'secret-test-key', apiTimeoutSeconds: 5 },
      downloads: { scanOnQueueIdle: true }
    }, { name: 'Teste', libraryId: 37, channelNumber: 421 });

    assert.equal(result.ok, true);
    assert.equal(requests, 1);
    assert.equal(Object.hasOwn(result, 'rebuild'), false);
  });
});


test('lists ErsatzTV channels by name while keeping channel number internal', async () => {
  await withServer((req, res) => {
    assert.equal(req.method, 'GET');
    assert.equal(req.url, '/api/channels');
    assert.equal(req.headers['x-etv-api-key'], 'catalog-key');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify([
      { id: 9, number: '421', name: 'JohnFlix Favoritos', fFmpegProfile: 'x', language: 'pt', streamingMode: 'x' },
      { id: 3, number: '419', name: 'JohnFlix Terror', fFmpegProfile: 'x', language: 'pt', streamingMode: 'x' }
    ]));
  }, async (url) => {
    const result = await listErsatzTvChannels({ ersatztv: { url, apiKey: 'catalog-key', apiTimeoutSeconds: 5 } });
    assert.equal(result.ok, true);
    assert.deepEqual(result.items, [
      { id: 9, number: '421', name: 'JohnFlix Favoritos' },
      { id: 3, number: '419', name: 'JohnFlix Terror' }
    ]);
  });
});

test('lists Smart Collections with id, name and query', async () => {
  await withServer((req, res) => {
    assert.equal(req.method, 'GET');
    assert.equal(req.url, '/api/collections/smart');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify([
      { id: 31, name: '420 - BASTILLE', query: 'library_id:47' },
      { id: 30, name: '420 - TWENTY ONE PILOTS', query: 'library_id:45' }
    ]));
  }, async (url) => {
    const result = await listSmartCollections({ ersatztv: { url, apiKey: '', apiTimeoutSeconds: 5 } });
    assert.equal(result.ok, true);
    assert.equal(result.items[0].name, '420 - BASTILLE');
    assert.equal(result.items[0].query, 'library_id:47');
  });
});

test('validates ErsatzTV API Key with GET /api/version and returns the app version', async () => {
  await withServer((req, res) => {
    assert.equal(req.method, 'GET');
    assert.equal(req.url, '/api/version');
    assert.equal(req.headers['x-etv-api-key'], 'version-key');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ apiVersion: 1, appVersion: '26.10.0' }));
  }, async (url) => {
    const result = await getErsatzTvVersion({ ersatztv: { url, apiKey: 'version-key', apiTimeoutSeconds: 5 } });
    assert.equal(result.ok, true);
    assert.deepEqual(result.version, { apiVersion: 1, appVersion: '26.10.0' });
  });
});

test('GET /api/version reports an invalid ErsatzTV API Key without exposing it', async () => {
  await withServer((req, res) => {
    assert.equal(req.method, 'GET');
    assert.equal(req.url, '/api/version');
    res.writeHead(401).end();
  }, async (url) => {
    const result = await getErsatzTvVersion({ ersatztv: { url, apiKey: 'wrong-key', apiTimeoutSeconds: 5 } });
    assert.equal(result.ok, false);
    assert.equal(result.status, 401);
    assert.match(result.statusText, /API Key/);
    assert.equal(result.version, null);
    assert.doesNotMatch(result.statusText, /wrong-key/);
  });
});

test('creates a Smart Collection from Library ID', async () => {
  await withServer(async (req, res) => {
    assert.equal(req.method, 'POST');
    assert.equal(req.url, '/api/collections/smart/new');
    let body = '';
    for await (const chunk of req) body += chunk;
    assert.deepEqual(JSON.parse(body), { name: '420 - NOVA', query: 'library_id:47' });
    res.writeHead(200).end();
  }, async (url) => {
    const result = await linkSmartCollection({ ersatztv: { url, apiKey: 'key', apiTimeoutSeconds: 5 } }, {
      mode: 'create', libraryId: 47, name: '420 - NOVA'
    });
    assert.equal(result.created, true);
    assert.equal(result.query, 'library_id:47');
  });
});

test('aggregates Library ID into the latest Smart Collection query', async () => {
  let requestCount = 0;
  await withServer(async (req, res) => {
    requestCount += 1;
    if (requestCount === 1) {
      assert.equal(req.method, 'GET');
      assert.equal(req.url, '/api/collections/smart');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify([{ id: 15, name: 'Premium', query: 'type:movie AND tag:premium' }]));
      return;
    }
    assert.equal(req.method, 'PUT');
    assert.equal(req.url, '/api/collections/smart/update');
    let body = '';
    for await (const chunk of req) body += chunk;
    assert.deepEqual(JSON.parse(body), {
      id: 15,
      name: 'Premium',
      query: '(type:movie AND tag:premium) OR (library_id:47)'
    });
    res.writeHead(200).end();
  }, async (url) => {
    const result = await linkSmartCollection({ ersatztv: { url, apiKey: '', apiTimeoutSeconds: 5 } }, {
      mode: 'aggregate', libraryId: 47, collectionId: 15
    });
    assert.equal(result.changed, true);
    assert.equal(result.query, '(type:movie AND tag:premium) OR (library_id:47)');
  });
  assert.equal(requestCount, 2);
});

test('aggregate does not duplicate a Library ID already present in Smart Collection query', async () => {
  let requests = 0;
  await withServer((req, res) => {
    requests += 1;
    assert.equal(req.method, 'GET');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify([{ id: 31, name: 'BASTILLE', query: '(type:episode) OR (library_id:47)' }]));
  }, async (url) => {
    const result = await linkSmartCollection({ ersatztv: { url, apiKey: '', apiTimeoutSeconds: 5 } }, {
      mode: 'aggregate', libraryId: 47, collectionId: 31
    });
    assert.equal(result.changed, false);
    assert.equal(result.alreadyPresent, true);
  });
  assert.equal(requests, 1);
});

test('replace overwrites Smart Collection query with only the selected Library ID', async () => {
  let requestCount = 0;
  await withServer(async (req, res) => {
    requestCount += 1;
    if (requestCount === 1) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify([{ id: 31, name: 'BASTILLE', query: 'type:movie' }]));
      return;
    }
    let body = '';
    for await (const chunk of req) body += chunk;
    assert.deepEqual(JSON.parse(body), { id: 31, name: 'BASTILLE', query: 'library_id:47' });
    res.writeHead(200).end();
  }, async (url) => {
    const result = await linkSmartCollection({ ersatztv: { url, apiKey: '', apiTimeoutSeconds: 5 } }, {
      mode: 'replace', libraryId: 47, collectionId: 31
    });
    assert.equal(result.query, 'library_id:47');
  });
  assert.equal(requestCount, 2);
});
