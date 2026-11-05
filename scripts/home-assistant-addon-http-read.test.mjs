import assert from 'node:assert/strict';
import { test } from 'node:test';

import { httpRead } from './home-assistant-addon-http-read.mjs';

const context = {
  service: 'GHCR',
  operation: 'read manifest',
  sleep: async () => {}
};

test('successful JSON GET returns parsed data', async () => {
  const result = await httpRead(
    async () => new Response(JSON.stringify({ valid: true })),
    'https://example.invalid',
    {},
    context
  );

  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { valid: true });
});

test('binary GET preserves exact bytes', async () => {
  const bytes = Buffer.from([0, 1, 2, 127, 255]);

  const result = await httpRead(
    async () => new Response(bytes),
    'https://example.invalid',
    {},
    { ...context, mode: 'bytes' }
  );

  assert.deepEqual(result.body, bytes);
});

test('transport failures retry three attempts', async () => {
  let calls = 0;

  const result = await httpRead(
    async () => {
      calls++;
      if (calls < 3) throw new TypeError('fetch failed');
      return new Response('{}');
    },
    'https://example.invalid',
    {},
    context
  );

  assert.equal(result.status, 200);
  assert.equal(calls, 3);
});

test('body transport failure retries the complete GET', async () => {
  let calls = 0;

  const result = await httpRead(
    async () => {
      calls++;

      if (calls === 1) {
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          async arrayBuffer() {
            throw new TypeError('connection reset');
          }
        };
      }

      return new Response(Buffer.from('valid'));
    },
    'https://example.invalid',
    {},
    { ...context, mode: 'bytes' }
  );

  assert.equal(calls, 2);
  assert.equal(result.body.toString(), 'valid');
});

test('timeout exhaustion reports safe diagnostics', async () => {
  let calls = 0;

  await assert.rejects(
    httpRead(
      async () => {
        calls++;
        throw new DOMException('secret', 'TimeoutError');
      },
      'https://example.invalid?token=private',
      {},
      context
    ),
    (error) => {
      assert.match(error.message, /timeout failure/);
      assert.doesNotMatch(error.message, /secret|private/);
      assert.equal(error.cause, undefined);
      return true;
    }
  );

  assert.equal(calls, 3);
});

test('HTTP failures never retry', async () => {
  for (const status of [401, 403, 404, 429, 500, 503]) {
    let calls = 0;

    const result = await httpRead(
      async () => {
        calls++;
        return new Response('error', { status });
      },
      'https://example.invalid',
      {},
      context
    );

    assert.equal(result.status, status);
    assert.equal(result.body, null);
    assert.equal(calls, 1);
  }
});

test('invalid JSON does not retry', async () => {
  let calls = 0;

  await assert.rejects(
    httpRead(
      async () => {
        calls++;
        return new Response('invalid json');
      },
      'https://example.invalid',
      {},
      context
    ),
    /invalid response body/
  );

  assert.equal(calls, 1);
});

test('write methods are rejected', async () => {
  let calls = 0;

  await assert.rejects(
    httpRead(
      async () => {
        calls++;
        return new Response('{}');
      },
      'https://example.invalid',
      { method: 'PATCH' },
      context
    ),
    /only supports GET/
  );

  assert.equal(calls, 0);
});

test('unsupported modes are rejected', async () => {
  await assert.rejects(
    httpRead(
      async () => new Response('{}'),
      'https://example.invalid',
      {},
      { ...context, mode: 'stream' }
    ),
    /Unsupported HTTP read mode/
  );
});

test('external cancellation prevents the request', async () => {
  const controller = new AbortController();
  controller.abort();

  let calls = 0;

  await assert.rejects(
    httpRead(
      async () => {
        calls++;
        return new Response('{}');
      },
      'https://example.invalid',
      { signal: controller.signal },
      context
    ),
    /request cancelled/
  );

  assert.equal(calls, 0);
});

test('AbortError is not retried', async () => {
  let calls = 0;

  await assert.rejects(
    httpRead(
      async () => {
        calls++;
        throw new DOMException('Cancelled', 'AbortError');
      },
      'https://example.invalid',
      {},
      context
    ),
    { name: 'AbortError' }
  );

  assert.equal(calls, 1);
});

test('external cancellation during fetch is not retried', async () => {
  const controller = new AbortController();
  let calls = 0;

  await assert.rejects(
    httpRead(
      async () => {
        calls++;
        controller.abort();
        throw new DOMException('Cancelled', 'AbortError');
      },
      'https://example.invalid',
      { signal: controller.signal },
      context
    ),
    /request cancelled/
  );

  assert.equal(calls, 1);
});

test('timeout signal remains active while reading response body', async () => {
  let calls = 0;

  // Keep the event loop alive while AbortSignal.timeout() expires.
  const keepAlive = setInterval(() => {}, 100);

  try {
    const result = await httpRead(
      async (_url, options) => {
        calls++;

        if (calls === 1) {
          return {
            ok: true,
            status: 200,
            headers: new Headers(),
            arrayBuffer: () =>
              new Promise((_resolve, reject) => {
                options.signal.addEventListener(
                  'abort',
                  () => reject(options.signal.reason),
                  { once: true }
                );
              })
          };
        }

        return new Response(Buffer.from('recovered'));
      },
      'https://example.invalid',
      {},
      { ...context, mode: 'bytes', timeout: 20 }
    );

    assert.equal(calls, 2);
    assert.equal(result.body.toString(), 'recovered');
  } finally {
    clearInterval(keepAlive);
  }
});

test('cancellation during backoff prevents another request', async () => {
  const controller = new AbortController();
  let calls = 0;

  await assert.rejects(
    httpRead(
      async () => {
        calls++;
        throw new TypeError('fetch failed');
      },
      'https://example.invalid',
      { signal: controller.signal },
      {
        ...context,
        sleep: async () => {
          controller.abort();
        }
      }
    ),
    /request cancelled/
  );

  assert.equal(calls, 1);
});
