const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { runLibraryAction, scanOnIdle } = require('../src/ersatztvService');

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
