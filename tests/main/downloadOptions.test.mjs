import { describe, it, expect } from 'vitest';
import path from 'node:path';
import optionsModule from '../../src/main/downloadOptions.js';

const { normalizeOptions, validateUrl, validateExtraArgs, QUALITY_PRESETS } = optionsModule;

describe('download option trust boundary', () => {
  it('normalizes concrete formats, subtitle policy and bounded numeric rate limits', () => {
    expect(
      normalizeOptions({
        formatId: '137+140',
        rateLimitKbps: 2048,
        subtitles: true,
        subtitleAuto: true,
        subtitleLang: 'en,fi',
      }),
    ).toMatchObject({
      formatId: '137+140',
      rateLimitKbps: 2048,
      subtitles: true,
      subtitleAuto: true,
    });
    expect(normalizeOptions({ rateLimitKbps: 0 }).rateLimitKbps).toBe(0);
    expect(normalizeOptions({ formatId: 'mp4' }).formatId).toBe('mp4');
  });
  it.each([
    '137/22',
    '137+140/22',
    '137[height<=1080]',
    '137,140',
    '--exec',
    '137+137',
    'a+b+c',
    '',
  ])('rejects nonconcrete format expressions: %s', (formatId) => {
    if (!formatId) expect(normalizeOptions({ formatId })).not.toHaveProperty('formatId');
    else expect(() => normalizeOptions({ formatId })).toThrow();
  });
  it.each([-1, 1.5, '100', 1000001, NaN, Infinity])(
    'rejects an invalid rate: %s',
    (rateLimitKbps) => {
      expect(() => normalizeOptions({ rateLimitKbps })).toThrow();
    },
  );
  it('accepts literal query metacharacters without shell interpretation', () => {
    expect(validateUrl('https://example.com/watch?a=1&b=$(value)')).toBe(
      'https://example.com/watch?a=1&b=$(value)',
    );
  });

  it.each([
    'file:///tmp/movie',
    'javascript:alert(1)',
    '--exec=command',
    'https://user:password@example.com/',
    'https://example.com/\ncommand',
  ])('rejects unsafe URL %s', (url) => {
    expect(() => validateUrl(url)).toThrow();
  });

  it('strictly validates keys and types', () => {
    expect(() => normalizeOptions({ forceIpv4: 'true' })).toThrow();
    expect(() => normalizeOptions({ output: '/tmp/elsewhere' })).toThrow();
    expect(() => normalizeOptions({ cookiesFromBrowser: 'firefox:custom' })).toThrow();
    expect(() => normalizeOptions({ userAgent: 'agent\r\nCookie: secret' })).toThrow();
    expect(() => normalizeOptions({ cookieFile: 'relative.txt' })).toThrow();
    expect(() => normalizeOptions({ jsRuntime: 'node:/untrusted/executable' })).toThrow();
    expect(() => normalizeOptions({ jsRuntime: 'bun' })).toThrow();
  });

  it('normalizes safe fields and legacy presets', () => {
    expect(normalizeOptions({ format: 'bestaudio/best', forceIpv4: true })).toEqual({
      quality: 'audio',
      forceIpv4: true,
    });
    expect(normalizeOptions({ format: 'bestvideo[height<=4320]+bestaudio/best' }).quality).toBe(
      '2160',
    );
    expect(normalizeOptions({ cookieFile: path.resolve('cookies.txt') }).cookieFile).toBe(
      path.resolve('cookies.txt'),
    );
    expect(normalizeOptions({ jsRuntime: 'quickjs' }).jsRuntime).toBe('quickjs');
  });

  it('restricts both video branches to their advertised quality and audio to audio', () => {
    for (const height of ['2160', '1440', '1080', '720', '480']) {
      expect(QUALITY_PRESETS[height]).toBe(
        `bestvideo[height<=${height}]+bestaudio/best[height<=${height}]`,
      );
    }
    expect(QUALITY_PRESETS.audio).toBe('bestaudio');
  });

  it.each([
    '--exec "command"',
    '--config-locations file',
    '--plugin-dirs file',
    '--remote-components ejs:github',
    '-o elsewhere',
    '--alias x command',
    '--downloader command',
    '--enable-file-urls',
    '-- --exec',
    '--retries infinity',
    '--sleep-interval 999',
    '--limit-rate 0',
    '--retries 2.2',
    'constructor 5',
    '__proto__ 5',
  ])('rejects advanced option %s', (input) => {
    expect(() => validateExtraArgs(input)).toThrow();
  });

  it('supports quoted safe values without expanding shell constructs', () => {
    expect(validateExtraArgs('--geo-bypass --sleep-interval "5" --limit-rate \'2M\'')).toEqual([
      '--geo-bypass',
      '--sleep-interval',
      '5',
      '--limit-rate',
      '2M',
    ]);
    expect(() => validateExtraArgs('--sleep-interval "5')).toThrow(/quote/u);
    expect(() => validateExtraArgs('--sleep-interval "5 & command"')).toThrow();
    expect(() => validateExtraArgs(['--exec', 'command'])).toThrow();
  });
});
