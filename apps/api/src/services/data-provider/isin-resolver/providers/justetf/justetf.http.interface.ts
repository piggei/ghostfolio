export interface JustEtfHttpResponse {
  status: number;
  url: string;
  headers: Headers;
  body: string;
}

export interface JustEtfHttpClient {
  request(url: string, options?: RequestInit): Promise<JustEtfHttpResponse>;
}

export class JustEtfFetchClient implements JustEtfHttpClient {
  public async request(
    url: string,
    options: RequestInit = {}
  ): Promise<JustEtfHttpResponse> {
    const response = await fetch(url, {
      ...options,
      redirect: 'manual'
    });

    return {
      status: response.status,
      url: response.url,
      headers: response.headers,
      body: await response.text()
    };
  }
}
