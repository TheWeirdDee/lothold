// Landing-page demo video. Configured only through the environment (see docs/DEMO_VIDEO.md):
//   DEMO_VIDEO_URL       YouTube or Vimeo page/share URL, or an https/site-relative URL of an .mp4 or .webm file
//   DEMO_VIDEO_POSTER    optional poster image (https or site-relative)
//   DEMO_VIDEO_CAPTIONS  optional WebVTT captions for a video file (same origin, or a host that sends CORS headers)
// With no URL the landing page shows "Demo video coming soon". An unrecognised URL is refused (logged), never
// guessed at, so the page cannot end up with a broken player.

export type DemoVideo =
  | { status: 'coming_soon' }
  | { status: 'ready'; kind: 'youtube' | 'vimeo'; provider: string; embedUrl: string; poster: string | null }
  | { status: 'ready'; kind: 'file'; src: string; type: 'video/mp4' | 'video/webm'; poster: string | null; captions: string | null };

export type DemoVideoConfig = { video: DemoVideo; error: string | null; cspSources: { frame: string[]; media: string[]; img: string[] } };

/** Accepts https URLs and site-relative paths ("/media/x.mp4"); returns null for anything else. */
function safeUrl(raw: string | undefined): URL | 'relative' | null {
  const v = raw?.trim();
  if (!v) return null;
  if (/^\/(?!\/)[\w\-./%]+$/.test(v)) return 'relative';
  try {
    const u = new URL(v);
    return u.protocol === 'https:' ? u : null;
  } catch {
    return null;
  }
}

function youtubeId(u: URL): string | null {
  const host = u.hostname.replace(/^(www\.|m\.)/, '');
  let id: string | null = null;
  if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0] ?? null;
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (u.pathname === '/watch') id = u.searchParams.get('v');
    else id = u.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)/)?.[1] ?? null;
  }
  return id && /^[\w-]{11}$/.test(id) ? id : null;
}

function vimeo(u: URL): { id: string; hash: string | null } | null {
  const host = u.hostname.replace(/^www\./, '');
  if (host !== 'vimeo.com' && host !== 'player.vimeo.com') return null;
  // vimeo.com/123456789, vimeo.com/123456789/abcdef1234 (unlisted hash), player.vimeo.com/video/123456789?h=...
  const m = u.pathname.match(/^\/(?:video\/)?(\d{6,12})(?:\/([0-9a-f]{6,20}))?\/?$/);
  if (!m) return null;
  return { id: m[1]!, hash: m[2] ?? u.searchParams.get('h') };
}

export function demoVideoFromEnv(env: Record<string, string | undefined> = process.env): DemoVideoConfig {
  const none: DemoVideoConfig = { video: { status: 'coming_soon' }, error: null, cspSources: { frame: [], media: [], img: [] } };
  const rawUrl = env.DEMO_VIDEO_URL?.trim();
  if (!rawUrl) return none;
  const url = safeUrl(rawUrl);
  const posterUrl = safeUrl(env.DEMO_VIDEO_POSTER);
  const captionsUrl = safeUrl(env.DEMO_VIDEO_CAPTIONS);
  if (!url) return { ...none, error: 'DEMO_VIDEO_URL must be an https URL or a site-relative path; showing "coming soon".' };
  if (env.DEMO_VIDEO_POSTER?.trim() && !posterUrl) return { ...none, error: 'DEMO_VIDEO_POSTER must be an https URL or a site-relative path.' };
  if (env.DEMO_VIDEO_CAPTIONS?.trim() && !captionsUrl) return { ...none, error: 'DEMO_VIDEO_CAPTIONS must be an https URL or a site-relative path.' };
  const str = (u: URL | 'relative' | null, raw: string | undefined) => (u === null ? null : u === 'relative' ? raw!.trim() : u.toString());
  const poster = str(posterUrl, env.DEMO_VIDEO_POSTER);
  const img = posterUrl instanceof URL ? [posterUrl.origin] : [];

  if (url instanceof URL) {
    const yt = youtubeId(url);
    if (yt) {
      // Privacy-enhanced mode; the player loads only after the visitor presses play.
      const embedUrl = `https://www.youtube-nocookie.com/embed/${yt}?autoplay=1&rel=0&modestbranding=1&playsinline=1&cc_load_policy=1`;
      return { video: { status: 'ready', kind: 'youtube', provider: 'YouTube (youtube-nocookie.com)', embedUrl, poster }, error: null, cspSources: { frame: ['https://www.youtube-nocookie.com'], media: [], img } };
    }
    const vm = vimeo(url);
    if (vm) {
      const embedUrl = `https://player.vimeo.com/video/${vm.id}?autoplay=1&dnt=1&title=0&byline=0&portrait=0${vm.hash ? `&h=${vm.hash}` : ''}`;
      return { video: { status: 'ready', kind: 'vimeo', provider: 'Vimeo (player.vimeo.com, do-not-track)', embedUrl, poster }, error: null, cspSources: { frame: ['https://player.vimeo.com'], media: [], img } };
    }
  }
  const path = url instanceof URL ? url.pathname : rawUrl;
  const ext = path.toLowerCase().match(/\.(mp4|webm)$/)?.[1];
  if (!ext) return { ...none, error: 'DEMO_VIDEO_URL is not a recognised YouTube or Vimeo link or an .mp4/.webm file; showing "coming soon".' };
  if (captionsUrl && !(captionsUrl === 'relative' ? env.DEMO_VIDEO_CAPTIONS!.trim() : captionsUrl.pathname).toLowerCase().endsWith('.vtt'))
    return { ...none, error: 'DEMO_VIDEO_CAPTIONS must be a WebVTT (.vtt) file.' };
  const media = [url, captionsUrl].filter((u): u is URL => u instanceof URL).map((u) => u.origin);
  return {
    video: { status: 'ready', kind: 'file', src: str(url, rawUrl)!, type: ext === 'mp4' ? 'video/mp4' : 'video/webm', poster, captions: str(captionsUrl, env.DEMO_VIDEO_CAPTIONS) },
    error: null,
    cspSources: { frame: [], media: [...new Set(media)], img },
  };
}

/** Content-Security-Policy for HTML responses, widened only for the configured video host. */
export function contentSecurityPolicy(cfg: DemoVideoConfig): string {
  const list = (base: string, extra: string[]) => [base, ...extra].join(' ');
  return [
    "default-src 'self'",
    `img-src ${list("'self' data:", cfg.cspSources.img)}`,
    `media-src ${list("'self'", cfg.cspSources.media)}`,
    `frame-src ${cfg.cspSources.frame.length ? cfg.cspSources.frame.join(' ') : "'none'"}`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}
