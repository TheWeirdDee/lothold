# Landing-page demo video

The landing page has a **Product walkthrough** section. Until a real recording is configured, it shows **“Demo video coming soon”**, with no play button and no player. Screenshots are never presented as a video.

The video is configured on the server through environment variables, so you can add or change it without rebuilding.

| Variable | Required | Accepts |
|---|---|---|
| `DEMO_VIDEO_URL` | yes | A YouTube link (`youtube.com/watch?v=…`, `youtu.be/…`, `/embed/…`, `/shorts/…`), a Vimeo link (`vimeo.com/123456789`, or `vimeo.com/123456789/<hash>` for unlisted videos), or an `https://` or site-relative (`/media/…`) URL ending in `.mp4` or `.webm` |
| `DEMO_VIDEO_POSTER` | no | An `https://` or site-relative image URL for the still frame. Without one, a drawn LotHold title card is used. |
| `DEMO_VIDEO_CAPTIONS` | no | A WebVTT (`.vtt`) file for MP4/WebM videos. Serve it from the same site, or from a host that sends CORS headers. For YouTube and Vimeo, upload captions to the platform; the player shows them when they exist. |

`http://` URLs, `javascript:` and other schemes, and links that are neither a recognised provider nor a video file are refused. In those cases the server logs a `config_warning` and the page keeps showing “coming soon”.

## Behaviour

- **YouTube and Vimeo:** the visitor first sees a poster with a **Play demo video** button. It is a real `<button>`, works by keyboard, and is labelled with the provider it will load. The provider's player (`youtube-nocookie.com`, or Vimeo with do-not-track) loads only after the press, and then starts with sound because the visitor asked for it. Fullscreen and picture-in-picture are allowed.
- **MP4/WebM:** a native `<video>` element with controls (including fullscreen), `preload="none"` (nothing downloads until play) and `playsinline` for phones. Captions are shown by default when configured.
- **Nothing autoplays on page load.**
- **Content-Security-Policy** is widened only for the configured host: `frame-src` for the YouTube or Vimeo player, and `media-src` and `img-src` for an external file and poster.
- **Disclosure:** the section always states that the walkthrough uses engineering test records, and that the forest data and any testnet transactions shown are genuine.

## Examples

```bash
# YouTube (recommended: free hosting, captions managed on YouTube)
DEMO_VIDEO_URL=https://youtu.be/<video-id>

# A file shipped with the site: put it in web/public/media/ before `npm run build`
DEMO_VIDEO_URL=/media/lothold-demo.mp4
DEMO_VIDEO_POSTER=/media/lothold-demo-poster.jpg
DEMO_VIDEO_CAPTIONS=/media/lothold-demo.en.vtt
```

Restart the server after changing these.

## What the recording should show

Record the real application using the engineering test kit (`/test-kit`, see `docs/AUDIT_GUIDE.md`), so every case, supplier and plot on screen is visibly labelled `ENG-KIT-…`. Do not stage or edit results.

## Verification

`tests/e2e/demo-video.spec.ts` covers three configurations, each on its own throwaway server:

- **Video file, at 1440 px and 390 px:**
  - nothing is fetched before play;
  - the native player starts from the keyboard and its time advances;
  - captions load and show;
  - fullscreen is available;
  - the frame stays 16:9 inside the viewport.
- **YouTube link:**
  - no request goes to YouTube before the press;
  - the press works by keyboard;
  - the player URL is `youtube-nocookie.com/embed/…?autoplay=1`;
  - fullscreen is allowed and focus moves to the player;
  - the CSP allows only that frame host.
- **Nothing configured:** `workflow.spec.ts` checks the honest “coming soon” state.

The clip used in these tests is generated during the test: an animated card reading “ENGINEERING TEST CLIP — not the LotHold demo”. It is never shipped. Playback of a real YouTube or Vimeo video cannot be verified until a real link is configured.
