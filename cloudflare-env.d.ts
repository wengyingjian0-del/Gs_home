declare module "cloudflare:workers" {
  export const env: unknown;
}

interface Fetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

interface D1Database {
  prepare(query: string): unknown;
}

interface R2Bucket {
  get(key: string): Promise<unknown>;
  put(key: string, value: ArrayBuffer | ReadableStream, options?: unknown): Promise<unknown>;
  delete(key: string): Promise<void>;
}
