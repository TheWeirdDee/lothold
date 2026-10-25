import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';

// These files ship with the frontend. No API request or third-party player is required.
const MEDIA = '/media/lothold';
export function Walkthrough() {
  const preview = useRef<HTMLVideoElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const [short, setShort] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [full, setFull] = useState(false);
  const [error, setError] = useState(false);
  // The muted preview plays on its own, in a loop, whenever it is on screen (no click needed). It pauses offscreen,
  // stays paused once the visitor pauses it, and does not start by itself under reduced motion or data saving.
  const userPaused = useRef(false);
  const start = () => {
    setShort(true);
    requestAnimationFrame(() => {
      const v = preview.current;
      if (!v) return;
      if (!v.currentSrc) v.load();
      void v.play().catch(() => { /* autoplay refused: the play button stays available */ });
    });
  };
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const saveData = !!(navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
    const pause = () => { preview.current?.pause(); setPlaying(false); };
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) pause();
      else if (!media.matches && !saveData && !userPaused.current) start();
    }, { threshold: 0.35 });
    if (frame.current) observer.observe(frame.current);
    const onMotion = () => { if (media.matches) pause(); };
    media.addEventListener('change', onMotion);
    return () => { observer.disconnect(); media.removeEventListener('change', onMotion); };
  }, []);
  return <section className="demo" aria-labelledby="demo-heading" id="walkthrough">
    <div className="demo-head"><h2 id="demo-heading">Product walkthrough</h2><span className="eng-tag">Engineering test records</span></div>
    <div ref={frame} className="video-frame">
      {full ? <video key="full" controls autoPlay playsInline preload="none" poster={`${MEDIA}-poster.jpg`} aria-label="LotHold full walkthrough" onError={() => setError(true)}>
        <source src={`${MEDIA}-full.webm`} type="video/webm" /><track kind="captions" src={`${MEDIA}.en.vtt`} srcLang="en" label="English" default />
      </video> : <video ref={preview} key="short" muted loop playsInline autoPlay preload="none" poster={`${MEDIA}-poster.jpg`} aria-label="LotHold short walkthrough" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onError={() => setError(true)}>
        {short && <source src={`${MEDIA}-short.webm`} type="video/webm" />}
      </video>}
      {!full && <div className="walkthrough-controls">
        <button className="btn light" onClick={() => setFull(true)}>Play full walkthrough <span aria-hidden="true">↗</span></button>
        <button className="btn ghost-dark" onClick={() => {
          if (playing) { userPaused.current = true; preview.current?.pause(); }
          else { userPaused.current = false; start(); }
        }}>{playing ? 'Pause preview' : 'Play muted preview'}</button>
      </div>}
    </div>
    {error && <p role="alert" className="demo-note">The recording could not play. <a href={`${MEDIA}-full.webm`}>Download the recording</a> or read the transcript below.</p>}
    <p className="demo-note">Recorded in a separate engineering instance using labelled <strong>engineering test records</strong>. Boundaries are coordinate probe boxes, not farms; quantities are invented. Environmental readings use the real pinned Hansen and JRC rasters. No physical shipment or regulatory submission is shown.</p>
    <details className="walkthrough-transcript"><summary>Read the walkthrough transcript</summary>
      <ol><li>Create an engineering review case. Upload a labelled shipping document and run the deterministic label parser. Confirm the proposed fields against their quoted source text.</li>
        <li>Upload the source-lot CSV and GeoJSON. Review each parsed preview and confirm it as the active evidence.</li>
        <li>Open a finding and follow its source link to the spreadsheet row. Inspect real forest-loss pixels for the declared coordinate probe box.</li>
        <li>Generate the supplier evidence request and open the resulting PDF. It lists outstanding actions with their sources.</li>
        <li>Attach engineering evidence and record an investigation. Reserve the declared allocations, then sign off the reviewed snapshot.</li>
        <li>Export the schema-validated XML draft. Change the goods description: the sign-off and generated documents become out of date and XML export is blocked until a new sign-off.</li></ol>
      <p><a href={`${MEDIA}-full.webm`}>Download full recording</a> · <Link to="/test-kit">Get the engineering test kit</Link></p>
    </details>
  </section>;
}
