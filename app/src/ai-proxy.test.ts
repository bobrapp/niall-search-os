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

  it('keeps AI off if a key exists but no access code is configured', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-only');
    vi.stubEnv('AI_ACCESS_CODE', ' ');
    await withProxy(async request => {
      const upstream = vi.spyOn(globalThis, 'fetch');
      expect(await (await request()).json()).toMatchObject({ enabled: false, reason: expect.stringMatching(/access code not configured/) });
      expect((await request({ method: 'POST', headers: { 'X-AI-Access-Code': 'fictional-code' } })).status).toBe(401);
      expect(upstream).not.toHaveBeenCalled();
    });
  });

  it.each([['', 'claude-sonnet-5-5'], [' fictional-model ', 'fictional-model']])('uses the configured model (%j)', async (model, expected) => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-only');
    vi.stubEnv('AI_ACCESS_CODE', 'fictional-code');
    vi.stubEnv('ANTHROPIC_MODEL', model);
    await withProxy(async request => {
      const upstream = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ content: [{ type: 'text', text: 'Northwind draft' }] }));
      expect(await (await request()).json()).toEqual({ enabled: true, accessCodeRequired: true, reason: '' });
      const body = JSON.stringify({ task: 'post', facts: 'Northwind' });
      for (const code of ['', 'incorrect-code']) {
        const forbidden = await request({ method: 'POST', headers: { 'Content-Type': 'application/json', ...(code && { 'X-AI-Access-Code': code }) }, body });
        expect(forbidden.status).toBe(401);
      }
      const headers = { 'Content-Type': 'application/json', 'X-AI-Access-Code': 'fictional-code' };
      const invalid = await request({ method: 'POST', headers, body: '{' });
      expect(invalid.status).toBe(400);
      expect(await invalid.json()).toEqual({ error: 'Invalid request.' });
      expect((await request({ method: 'POST', headers, body: 'x'.repeat(180_001) })).status).toBe(413);
      expect(upstream).not.toHaveBeenCalled();
      const response = await request({ method: 'POST', headers, body });
      expect(await response.json()).toEqual({ draft: 'Northwind draft' });
      expect(upstream).toHaveBeenCalledOnce();
      expect(JSON.parse(String(upstream.mock.calls[0][1]?.body))).toMatchObject({ model: expected });
      expect(new Headers(upstream.mock.calls[0][1]?.headers).has('X-AI-Access-Code')).toBe(false);
    });
  });

  it('limits authenticated drafts per instance and resets after one minute', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-only');
    vi.stubEnv('AI_ACCESS_CODE', 'fictional-code');
    const now = Date.now() + 60_001;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    await withProxy(async request => {
      const upstream = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ content: [{ type: 'text', text: 'Northwind draft' }] }));
      const draft = { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-AI-Access-Code': 'fictional-code' }, body: '{"task":"post","facts":"Northwind"}' };
      for (let i = 0; i < 20; i++) expect((await request(draft)).status).toBe(200);
      const limited = await request(draft);
      expect(limited.status).toBe(429);
      expect(limited.headers.get('retry-after')).toBe('60');
      expect(upstream).toHaveBeenCalledTimes(20);
      clock.mockReturnValue(now + 60_000);
      expect((await request(draft)).status).toBe(200);
    });
  });
});
