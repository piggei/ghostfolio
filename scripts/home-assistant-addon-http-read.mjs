const delays = [250, 750];

function category(error) {
  if (error?.name === 'TimeoutError') {
    return 'timeout';
  }

  if (error instanceof TypeError) {
    return 'transport';
  }

  return null;
}

export async function httpRead(
  fetcher,
  url,
  options = {},
  {
    service,
    operation,
    mode = 'json',
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    timeout = 30000
  }
) {
  if (options.method && options.method !== 'GET') {
    throw new Error('httpRead only supports GET');
  }

  if (!['json', 'bytes'].includes(mode)) {
    throw new Error('Unsupported HTTP read mode');
  }

  if (
    typeof service !== 'string' ||
    !service ||
    typeof operation !== 'string' ||
    !operation
  ) {
    throw new Error('Missing HTTP diagnostic context');
  }

  const externalSignal = options.signal;

  for (let attempt = 0; attempt <= delays.length; attempt++) {
    if (externalSignal?.aborted) {
      throw new Error(`${service} ${operation}: request cancelled`);
    }

    const signal = externalSignal
      ? AbortSignal.any([externalSignal, AbortSignal.timeout(timeout)])
      : AbortSignal.timeout(timeout);

    let response;

    try {
      response = await fetcher(url, {
        ...options,
        method: 'GET',
        signal
      });
    } catch (error) {
      if (externalSignal?.aborted) {
        throw new Error(`${service} ${operation}: request cancelled`);
      }

      const kind = category(error);

      if (!kind) throw error;

      const diagnostic =
        `${service} ${operation}: ${kind} failure ` +
        `(attempt ${attempt + 1}/${delays.length + 1})`;

      if (attempt === delays.length) {
        throw new Error(diagnostic);
      }

      console.warn(`${diagnostic}; retrying`);
      await sleep(delays[attempt]);

      if (externalSignal?.aborted) {
        throw new Error(`${service} ${operation}: request cancelled`);
      }
      continue;
    }

    if (!response.ok) {
      return {
        status: response.status,
        headers: response.headers,
        body: null
      };
    }

    let body;

    try {
      body =
        mode === 'json'
          ? await response.json()
          : Buffer.from(await response.arrayBuffer());
    } catch (error) {
      if (externalSignal?.aborted) {
        throw new Error(`${service} ${operation}: request cancelled`);
      }

      const kind = category(error);

      if (!kind) {
        throw new Error(`${service} ${operation}: invalid response body`);
      }

      const diagnostic =
        `${service} ${operation}: ${kind} failure ` +
        `(attempt ${attempt + 1}/${delays.length + 1})`;

      if (attempt === delays.length) {
        throw new Error(diagnostic);
      }

      console.warn(`${diagnostic}; retrying`);
      await sleep(delays[attempt]);

      if (externalSignal?.aborted) {
        throw new Error(`${service} ${operation}: request cancelled`);
      }
      continue;
    }

    return {
      status: response.status,
      headers: response.headers,
      body
    };
  }
}
