import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import serverModule from '../server.js';

const { app, server } = serverModule;

afterAll(() => {
  server.close();
});

describe('GET /health', () => {
  it('returns ok with uptime', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(typeof res.body.uptime).toBe('number');
  });
});

describe('GET /metrics', () => {
  it('returns Prometheus text format', async () => {
    const res = await request(app).get('/metrics');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(res.text).toMatch(/^# HELP /m);
  });
});

describe('POST /info validation', () => {
  it('rejects missing URL', async () => {
    const res = await request(app).post('/info').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/URL is required/);
  });

  it('rejects non-YouTube URL', async () => {
    const res = await request(app).post('/info').send({ url: 'https://example.com/foo' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/YouTube domain/);
  });
});

describe('GET /download-file traversal protection', () => {
  it('rejects filename with path traversal', async () => {
    const res = await request(app).get('/download-file/..%2Fetc%2Fpasswd');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid filename/);
  });
});

describe('GET /download-caption validation', () => {
  it('rejects invalid lang code', async () => {
    const res = await request(app)
      .get('/download-caption')
      .query({ url: 'https://youtu.be/abc', lang: '../evil', format: 'srt' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/language code/);
  });

  it('rejects invalid format', async () => {
    const res = await request(app)
      .get('/download-caption')
      .query({ url: 'https://youtu.be/abc', lang: 'en', format: 'bad' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/srt.*vtt/);
  });
});
