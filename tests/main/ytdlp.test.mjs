import { describe, it, expect } from 'vitest';

describe('ytdlp patterns', () => {
  describe('YouTube URL detection', () => {
    const isYouTube = (url) => /youtu\.?be/i.test(url);

    it('should detect youtube.com URLs', () => {
      expect(isYouTube('https://www.youtube.com/watch?v=abc123')).toBe(true);
      expect(isYouTube('https://youtube.com/watch?v=abc123')).toBe(true);
    });

    it('should detect youtu.be short URLs', () => {
      expect(isYouTube('https://youtu.be/abc123')).toBe(true);
    });

    it('should not match non-YouTube URLs', () => {
      expect(isYouTube('https://vimeo.com/123456')).toBe(false);
      expect(isYouTube('https://example.com')).toBe(false);
    });
  });

  describe('progress parsing', () => {
    const parseProgress = (output) => {
      const match = output.match(/\[download\]\s+(\d+\.?\d*)%/);
      return match ? parseFloat(match[1]) : null;
    };

    it('should parse integer progress', () => {
      expect(parseProgress('[download]  45% of 123.45MiB')).toBe(45);
    });

    it('should parse decimal progress', () => {
      expect(parseProgress('[download]  45.5% of 123.45MiB at 1.23MiB/s ETA 00:45')).toBe(45.5);
    });

    it('should parse 100%', () => {
      expect(parseProgress('[download] 100% of 123.45MiB')).toBe(100);
    });

    it('should return null for non-progress output', () => {
      expect(parseProgress('[info] Extracting URL')).toBeNull();
    });
  });

  describe('destination parsing', () => {
    const parseDest = (output) => {
      const match = output.match(/\[download\] Destination: (.+)/);
      return match ? match[1].trim() : null;
    };

    it('should parse destination path', () => {
      expect(parseDest('[download] Destination: /tmp/My Video.mp4')).toBe('/tmp/My Video.mp4');
    });

    it('should return null for non-destination output', () => {
      expect(parseDest('[download] 50%')).toBeNull();
    });
  });

  describe('already downloaded parsing', () => {
    it('should detect already downloaded files', () => {
      const output = '[download] /tmp/video.mp4 has already been downloaded';
      const match = output.match(/\[download\] (.+) has already been downloaded/);
      expect(match[1].trim()).toBe('/tmp/video.mp4');
    });
  });
});
