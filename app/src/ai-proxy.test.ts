import { createServer } from 'node:http';
import { once } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import handler from '../api/ai.mjs';

async function withProxy(test: (request: (init?: RequestInit) => Promise<Response>) => Promise<void>) {
  const localFetch = globalThis.fetch;
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No TCP address');
  try {
    await test(init => localFetch(`http://127.0.0.1:${address.port}/api/ai`, init));
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('Vercel AI function', () => {
  it('reports no-key availability and returns JSON errors without contacting Anthropic', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    await withProxy(async request => {
      const status = await request();
      expect(status.status).toBe(200);
      expect(status.headers.get('cache-control')).toBe('no-store');
      expect(await status.json()).toMatchObject({ enabled: false });
      const post = await request({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      expect(post.status).toBe(503);
      expect(await post.json()).toMatchObject({ error: expect.stringContaining('no Anthropic API key') });
      const unsupported = await request({ method: 'PUT' });
      expect(unsupported.status).toBe(405);
      expect(await unsupported.json()).toEqual({ error: 'Method not allowed.' });
    });
  });

  it.each([['', 'claude-sonnet-4-6'], [' fictional-model ', 'fictional-model']])('uses the configured model (%j)', async (model, expected) => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-only');
    vi.stubEnv('ANTHROPIC_MODEL', model);
    await withProxy(async request => {
      const upstream = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ content: [{ type: 'text', text: 'Northwind draft' }] }));
      const headers = { 'Content-Type': 'application/json' };
      const invalid = await request({ method: 'POST', headers, body: '{' });
      expect(invalid.status).toBe(400);
      expect(await invalid.json()).toEqual({ error: 'Invalid request.' });
      expect(upstream).not.toHaveBeenCalled();
      const response = await request({ method: 'POST', headers, body: JSON.stringify({ task: 'post', facts: 'Northwind' }) });
      expect(await response.json()).toEqual({ draft: 'Northwind draft' });
      expect(upstream).toHaveBeenCalledOnce();
      expect(JSON.parse(String(upstream.mock.calls[0][1]?.body))).toMatchObject({ model: expected });
    });
  });
});
