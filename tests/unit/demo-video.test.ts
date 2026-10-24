// Demo-video configuration: only recognised providers or video files are accepted; anything else falls back to the
// honest "coming soon" state, and the Content-Security-Policy is widened only for the configured host.
import { describe, expect, it } from 'vitest';
import { demoVideoFromEnv, contentSecurityPolicy } from '../../server/demo-video.ts';

describe('demo video configuration', () => {
  it('shows "coming soon" when nothing is configured', () => {
    const c = demoVideoFromEnv({});
    expect(c.video).toEqual({ status: 'coming_soon' });
    expect(c.error).toBeNull();
    expect(contentSecurityPolicy(c)).toContain("frame-src 'none'");
  });

  it.each([
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtu.be/dQw4w9WgXcQ',
    'https://www.youtube.com/embed/dQw4w9WgXcQ',
    'https://youtube.com/shorts/dQw4w9WgXcQ',
    'https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=10s',
  ])('recognises the YouTube link %s and embeds it in privacy-enhanced mode', (url) => {
    const c = demoVideoFromEnv({ DEMO_VIDEO_URL: url });
    expect(c.video).toMatchObject({ status: 'ready', kind: 'youtube' });
    expect((c.video as any).embedUrl).toMatch(/^https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ\?/);
    expect(contentSecurityPolicy(c)).toContain('frame-src https://www.youtube-nocookie.com');
  });

  it('recognises public and unlisted Vimeo links', () => {
    expect((demoVideoFromEnv({ DEMO_VIDEO_URL: 'https://vimeo.com/123456789' }).video as any).embedUrl).toBe('https://player.vimeo.com/video/123456789?autoplay=1&dnt=1&title=0&byline=0&portrait=0');
    expect((demoVideoFromEnv({ DEMO_VIDEO_URL: 'https://vimeo.com/123456789/abc123def4' }).video as any).embedUrl).toContain('&h=abc123def4');
    expect(contentSecurityPolicy(demoVideoFromEnv({ DEMO_VIDEO_URL: 'https://vimeo.com/123456789' }))).toContain('frame-src https://player.vimeo.com');
  });

  it('accepts a hosted or site-relative MP4/WebM file with poster and WebVTT captions', () => {
    const rel = demoVideoFromEnv({ DEMO_VIDEO_URL: '/media/lothold-demo.mp4', DEMO_VIDEO_POSTER: '/media/poster.jpg', DEMO_VIDEO_CAPTIONS: '/media/lothold-demo.en.vtt' });
    expect(rel.video).toEqual({ status: 'ready', kind: 'file', src: '/media/lothold-demo.mp4', type: 'video/mp4', poster: '/media/poster.jpg', captions: '/media/lothold-demo.en.vtt' });
    expect(contentSecurityPolicy(rel)).toContain("media-src 'self';");
    const hosted = demoVideoFromEnv({ DEMO_VIDEO_URL: 'https://cdn.example.org/v/demo.webm', DEMO_VIDEO_POSTER: 'https://img.example.org/p.jpg' });
    expect(hosted.video).toMatchObject({ kind: 'file', type: 'video/webm' });
    const csp = contentSecurityPolicy(hosted);
    expect(csp).toContain("media-src 'self' https://cdn.example.org");
    expect(csp).toContain("img-src 'self' data: https://img.example.org");
  });

  it.each([
    ['http://example.org/demo.mp4', 'https'],
    ['javascript:alert(1)', 'https'],
    ['//evil.example/demo.mp4', 'https'],
    ['https://example.org/watch-this', 'recognised'],
    ['https://www.youtube.com/watch?v=short', 'recognised'],
  ])('refuses %s and keeps "coming soon"', (url, msg) => {
    const c = demoVideoFromEnv({ DEMO_VIDEO_URL: url });
    expect(c.video).toEqual({ status: 'coming_soon' });
    expect(c.error).toContain(msg);
    expect(contentSecurityPolicy(c)).toContain("frame-src 'none'");
  });

  it('refuses captions that are not WebVTT and posters that are not https', () => {
    expect(demoVideoFromEnv({ DEMO_VIDEO_URL: '/media/d.mp4', DEMO_VIDEO_CAPTIONS: '/media/d.srt' }).video.status).toBe('coming_soon');
    expect(demoVideoFromEnv({ DEMO_VIDEO_URL: '/media/d.mp4', DEMO_VIDEO_POSTER: 'http://x.example/p.jpg' }).video.status).toBe('coming_soon');
  });
});
