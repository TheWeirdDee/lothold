import { Fragment, useEffect, useRef, useState } from 'react';
import { api, download, fmtBytes, fmtDate } from '../api.ts';
import { useAuth } from '../main.tsx';
import { Badge, Dialog, ENV_STATUS, useAsync, useToast, TableWrap } from '../components/ui.tsx';
import { PixelMap } from '../components/PixelMap.tsx';
import { LossYears } from './Public.tsx';
import type { Focus, View } from './Shipment.tsx';

type Reload = () => Promise<unknown>;

// ---------------- generic upload with parse → preview → confirm ----------------
function UploadBox({ view, kind, accept, label, hint, reload, onUploaded }: { view: View; kind: string; accept: string; label: string; hint: string; reload: Reload; onUploaded?: (id: string) => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  return (
    <form
      className="file-drop"
      onSubmit={async (e) => {
        e.preventDefault();
        const file = input.current?.files?.[0];
        if (!file) return setErr('Choose a file first.');
        setErr(null);
        setBusy(true);
        try {
          const fd = new FormData();
          fd.append('file', file);
          const r = await api<{ uploadId: string; duplicate: boolean; parseStatus: string; error: string | null }>('POST', `/api/shipments/${view.shipment.id}/uploads?kind=${kind}`, fd);
          if (r.duplicate) toast('This exact file was already uploaded; the existing upload is shown.');
          if (r.parseStatus === 'rejected') setErr(`The file was stored but could not be used: ${r.error}`);
          if (input.current) input.current.value = '';
          onUploaded?.(r.uploadId);
          await reload();
        } catch (er) {
          setErr((er as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="field">
        {label}
        <span className="hint">{hint}</span>
        <input ref={input} type="file" accept={accept} />
      </label>
      <div className="btn-row">
        <button className="btn small" disabled={busy}>
          {busy ? 'Uploading and parsing…' : 'Upload'}
        </button>
      </div>
      {err && <p className="callout rust small" role="alert">{err}</p>}
    </form>
  );
}

function PendingUploads({ view, kind, reload }: { view: View; kind: string; reload: Reload }) {
  const pending = view.uploads.filter((u: any) => u.kind === kind && !u.active && !u.superseded);
  const [open, setOpen] = useState<string | null>(null);
  if (!pending.length) return null;
  return (
    <div className="stack">
      {pending.map((u: any) => (
        <div key={u.id} className={`callout ${u.parseStatus === 'rejected' ? 'rust' : 'amber'}`}>
          <div className="row">
            <span className="break">
              <strong>{u.filename}</strong> · {fmtBytes(u.bytes)} · uploaded {fmtDate(u.uploadedAt)} by {u.uploadedBy}
            </span>
            <span className="spacer" />
            {u.parseStatus === 'parsed' ? (
              <button className="btn small" onClick={() => setOpen(open === u.id ? null : u.id)} aria-expanded={open === u.id}>
                {open === u.id ? 'Hide preview' : 'Preview and confirm'}
              </button>
            ) : (
              <Badge cls="hold">Rejected</Badge>
            )}
          </div>
          {u.parseStatus === 'rejected' && <p className="small" style={{ marginTop: 6 }}>{u.parseError} Fix the file and upload it again.</p>}
          {open === u.id && <UploadPreview uploadId={u.id} reload={reload} onDone={() => setOpen(null)} replaces={view.uploads.find((x: any) => x.kind === kind && x.active)?.filename} />}
        </div>
      ))}
    </div>
  );
}

function UploadPreview({ uploadId, reload, onDone, replaces }: { uploadId: string; reload: Reload; onDone: () => void; replaces?: string }) {
  const toast = useToast();
  const { data, error, loading } = useAsync(() => api('GET', `/api/uploads/${uploadId}`), [uploadId]);
  const [busy, setBusy] = useState(false);
  if (loading) return <p className="small">Loading parsed preview…</p>;
  if (error) return <p className="small" role="alert">{error.message}</p>;
  const p = data.parsed;
  const holdCount = data.kind === 'sources_csv' ? p.rows.reduce((s: number, r: any) => s + r.issues.filter((i: any) => i.severity === 'hold').length, 0) : p.features.reduce((s: number, f: any) => s + f.issues.filter((i: any) => i.severity === 'hold').length + f.report.issues.filter((i: any) => i.severity === 'hold').length, 0);
  return (
    <div className="stack" style={{ marginTop: 10 }}>
      <p className="small" style={{ margin: 0 }}>
        Parsed by <code>{data.parser}</code> ({data.parserVersion}). SHA-256 <code className="break">{data.sha256}</code>. {data.kind === 'sources_csv' ? `${p.rows.length} rows` : `${p.features.length} features`}; {holdCount} problem(s) found. Confirming makes this the active source{replaces ? `, replacing ${replaces}` : ''}. Existing sign-offs and documents become out of date.
      </p>
      {data.kind === 'sources_csv' ? (
        <TableWrap stack label="Source rows preview">
          <table className="data">
            <thead>
              <tr>
                <th>Row</th>
                <th>Supplier</th>
                <th>Source lot</th>
                <th className="num">Declared</th>
                <th className="num">Allocated</th>
                <th>Country</th>
                <th>Plots</th>
                <th>Problems</th>
              </tr>
            </thead>
            <tbody>
              {p.rows.slice(0, 200).map((r: any) => (
                <tr key={r.row} className={r.issues.some((i: any) => i.severity === 'hold') ? 'issue' : ''}>
                  <td className="num">{r.row}</td>
                  <td className="break">{r.raw.supplier_id || <em className="muted">empty</em>}</td>
                  <td className="break">{r.raw.source_lot_ref || <em className="muted">empty</em>}</td>
                  <td className="num">{r.raw.source_lot_declared_quantity} {r.raw.quantity_unit}</td>
                  <td className="num">{r.raw.allocated_quantity} {r.raw.quantity_unit}</td>
                  <td>{r.raw.producer_country}</td>
                  <td className="break">{r.raw.plot_refs}</td>
                  <td className="small">{r.issues.map((i: any, k: number) => <span key={k} className="cell-issue">{i.message}</span>)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      ) : (
        <TableWrap stack label="Plot features preview">
          <table className="data">
            <thead>
              <tr>
                <th>#</th>
                <th>plot_ref</th>
                <th>Type</th>
                <th className="num">Area</th>
                <th>Problems</th>
              </tr>
            </thead>
            <tbody>
              {p.features.slice(0, 200).map((f: any) => (
                <tr key={f.featureIndex} className={!f.report.valid || f.issues.some((i: any) => i.severity === 'hold') ? 'issue' : ''}>
                  <td className="num">{f.featureIndex + 1}</td>
                  <td className="break">{f.plotRef ?? <em className="muted">missing</em>}</td>
                  <td>{f.report.geometryType ?? '—'}</td>
                  <td className="num">{f.report.areaHa !== null ? `${f.report.areaHa} ha` : f.report.declaredAreaHa !== null ? `${f.report.declaredAreaHa} ha (declared)` : '—'}</td>
                  <td className="small">{[...f.issues, ...f.report.issues].map((i: any, k: number) => <span key={k} className="cell-issue" style={i.severity === 'warning' ? { color: 'var(--muted)' } : undefined}>{i.message}</span>)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
      <div className="btn-row">
        <button
          className="btn small"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await api('POST', `/api/uploads/${uploadId}/confirm`);
              toast('Confirmed as the active source. Findings were recalculated.');
              onDone();
              await reload();
            } catch (e) {
              toast((e as Error).message, 'error');
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Confirming…' : holdCount ? `Confirm with ${holdCount} problem(s) recorded as findings` : 'Confirm as active source'}
        </button>
        <button className="btn small secondary" onClick={onDone}>
          Not now
        </button>
      </div>
    </div>
  );
}

function ActiveFile({ upload, label }: { upload: any; label: string }) {
  const toast = useToast();
  return (
    <p className="small" style={{ margin: 0 }}>
      Active {label}: <strong className="break">{upload.filename}</strong> · <span className="mono">sha256 {upload.sha256.slice(0, 16)}…</span> · parser {upload.parserVersion} ·{' '}
      <button className="source-link" onClick={() => download(`/api/uploads/${upload.id}/download-link`).catch((e) => toast(e.message, 'error'))}>
        download original
      </button>
    </p>
  );
}

function useScrollTo(focus: Focus, selector: string | null) {
  useEffect(() => {
    if (!selector) return;
    const el = document.querySelector(selector);
    if (el) el.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [focus, selector]);
}

// ---------------- details ----------------
const FIELD_DEFS: { key: string; label: string; hint: string; type?: 'select'; options?: string[] }[] = [
  { key: 'activityType', label: 'Activity type', hint: 'As in the DDS: IMPORT, EXPORT or DOMESTIC', type: 'select', options: ['', 'IMPORT', 'EXPORT', 'DOMESTIC'] },
  { key: 'hsCode', label: 'HS code', hint: 'Only cocoa beans (1801) are supported' },
  { key: 'description', label: 'Description of goods', hint: 'Max 150 characters' },
  { key: 'netMassValue', label: 'Net mass', hint: 'Digits with optional "." decimal; no thousands separators' },
  { key: 'netMassUnit', label: 'Net mass unit', hint: 'kg, t or g', type: 'select', options: ['kg', 't', 'g'] },
  { key: 'countryOfActivity', label: 'Country of activity (EU)', hint: 'ISO code of the EU Member State, e.g. BE, NL, DE' },
  { key: 'operatorName', label: 'Operator name', hint: 'Legal name of the operator' },
  { key: 'operatorEori', label: 'Operator EORI', hint: 'Required by the EU system for IMPORT/EXPORT' },
];

export function DetailsTab({ view, reload, focus }: { view: View; reload: Reload; focus: Focus }) {
  const toast = useToast();
  const initial = Object.fromEntries(FIELD_DEFS.map((d) => [d.key, view.fields[d.key]?.value ?? (d.key === 'netMassUnit' ? 'kg' : '')]));
  const [vals, setVals] = useState<Record<string, string>>(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useScrollTo(focus, focus?.field ? `#field-${focus.field}` : null);
  const dirty = FIELD_DEFS.some((d) => (vals[d.key] ?? '') !== (initial[d.key] ?? ''));
  return (
    <div className="split">
      <form
        className="panel stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setErr(null);
          setBusy(true);
          try {
            const changed = Object.fromEntries(FIELD_DEFS.filter((d) => (vals[d.key] ?? '') !== (initial[d.key] ?? '')).map((d) => [d.key, vals[d.key] || null]));
            const r = await api<{ changed: string[] }>('PATCH', `/api/shipments/${view.shipment.id}/fields`, changed);
            toast(r.changed.length ? `Saved ${r.changed.length} field(s) as a new revision.` : 'Nothing changed.');
            await reload();
          } catch (er) {
            setErr((er as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <h2 style={{ margin: 0 }}>Shipment details</h2>
        <p className="small muted" style={{ margin: 0 }}>Each save creates a new revision. The previous value is kept in the activity log.</p>
        <div className="form-grid">
          {FIELD_DEFS.map((d) => {
            const v = view.fields[d.key];
            return (
              <label key={d.key} className="field" id={`field-${d.key}`} style={focus?.field === d.key ? { outline: '2px solid var(--amber)', outlineOffset: 4, borderRadius: 2 } : undefined}>
                {d.label}
                <span className="hint">
                  {d.hint}
                  {v ? ` · ${v.source === 'extraction' ? `confirmed from ${v.extractionRef?.filename ?? 'extraction'}` : 'entered manually'}, rev. ${v.revision}` : ''}
                </span>
                {d.type === 'select' ? (
                  <select value={vals[d.key]} onChange={(e) => setVals({ ...vals, [d.key]: e.target.value })}>
                    {d.options!.map((o) => (
                      <option key={o} value={o}>
                        {o || 'Not set'}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input type="text" value={vals[d.key]} maxLength={d.key === 'description' ? 150 : 200} onChange={(e) => setVals({ ...vals, [d.key]: e.target.value })} />
                )}
              </label>
            );
          })}
        </div>
        {err && <p className="callout rust small" role="alert">{err}</p>}
        <div className="btn-row">
          <button className="btn" disabled={busy || !dirty}>
            {busy ? 'Saving…' : 'Save details'}
          </button>
          {dirty && (
            <button type="button" className="btn secondary" onClick={() => setVals(initial)}>
              Discard changes
            </button>
          )}
        </div>
      </form>
      <ExtractionPanel view={view} reload={async () => { await reload(); }} onAccepted={(f) => setVals((s) => ({ ...s, ...f }))} />
    </div>
  );
}

function ExtractionPanel({ view, reload, onAccepted }: { view: View; reload: Reload; onAccepted: (f: Record<string, string>) => void }) {
  const toast = useToast();
  const status = useAsync(() => api('GET', `/api/shipments/${view.shipment.id}/extraction`), [view.shipment.id]);
  const docs = view.uploads.filter((u: any) => u.kind === 'document');
  const [docId, setDocId] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const s = status.data;
  const latest = s?.latest;
  useEffect(() => {
    if (!docId && docs[0]) setDocId(docs[0].id);
  }, [docs, docId]);
  return (
    <div className="panel stack">
      <h2 style={{ margin: 0, fontSize: '1rem' }}>Propose fields from a document</h2>
      {s && (
        <p className="small" style={{ margin: 0 }}>
          {s.configured ? (
            <>
              Model extraction is configured (<code>{s.provider}</code>, <code>{s.model}</code>). If a model call fails, the label parser is used and labelled as such.
            </>
          ) : (
            <>
              <strong>No AI model is configured on this server.</strong> Proposals come from the deterministic <em>label parser (not AI)</em>, which reads lines such as <code>HS code: 1801</code>.
            </>
          )}{' '}
          Every proposal must quote text found in the document, and nothing is used until you accept it.
        </p>
      )}
      <UploadBox view={view} kind="document" accept=".pdf,.txt,application/pdf,text/plain" label="Shipping or supplier document" hint="PDF with a text layer, or .txt; max 10 MB. Scanned images are not supported (no OCR)." reload={reload} onUploaded={(id) => setDocId(id)} />
      {docs.length > 0 && (
        <div className="row">
          <label className="field" style={{ flex: '1 1 200px' }}>
            Document
            <select value={docId} onChange={(e) => setDocId(e.target.value)}>
              {docs.map((d: any) => (
                <option key={d.id} value={d.id}>
                  {d.filename}
                </option>
              ))}
            </select>
          </label>
          <button
            className="btn small"
            style={{ alignSelf: 'flex-end' }}
            disabled={busy || !docId}
            onClick={async () => {
              setBusy(true);
              try {
                await api('POST', `/api/shipments/${view.shipment.id}/extract`, { uploadId: docId });
                setSel({});
                await status.reload();
              } catch (e) {
                toast((e as Error).message, 'error');
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Reading document…' : 'Propose fields'}
          </button>
        </div>
      )}
      {latest && (
        <div className="stack">
          <p className="small" style={{ margin: 0 }}>
            <Badge cls={latest.provider === 'label-parser' ? 'neutral' : 'review'}>{latest.method}</Badge> on <strong className="break">{latest.filename}</strong>, {fmtDate(latest.createdAt)} · config {latest.configVersion}
          </p>
          {latest.error && <p className="callout amber small" style={{ margin: 0 }}>{latest.error}</p>}
          <TableWrap stack label="Proposed fields">
            <table className="data">
              <thead>
                <tr>
                  <th>Use</th>
                  <th>Field</th>
                  <th>Proposed value</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {latest.candidates.map((c: any) => (
                  <tr key={c.field}>
                    <td>
                      <input type="checkbox" aria-label={`Accept ${c.field}`} disabled={!c.accepted} checked={!!sel[c.field]} onChange={(e) => setSel({ ...sel, [c.field]: e.target.checked })} />
                    </td>
                    <td>{c.field}</td>
                    <td className="break">{c.value ?? <span className="muted">not found</span>}</td>
                    <td className="small break">
                      {c.quote ? (
                        <>
                          p.{c.page}: <code>“{c.quote}”</code>
                        </>
                      ) : (
                        '—'
                      )}
                      {c.reason && <span className="cell-issue">{c.reason}</span>}
                      {c.accepted && <span className="small" style={{ color: 'var(--forest)', display: 'block' }}>Quote found in document</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          <div>
            <button
              className="btn small"
              disabled={!Object.values(sel).some(Boolean)}
              onClick={async () => {
                const fields = Object.keys(sel).filter((k) => sel[k]);
                try {
                  await api('POST', `/api/extractions/${latest.id}/accept`, { fields });
                  onAccepted(Object.fromEntries(fields.map((f) => [f, latest.candidates.find((c: any) => c.field === f).value])));
                  toast(`Accepted ${fields.length} field(s); they are recorded with this document as provenance.`);
                  setSel({});
                  await reload();
                } catch (e) {
                  toast((e as Error).message, 'error');
                }
              }}
            >
              Accept selected fields
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------- sources ----------------
export function SourcesTab({ view, reload, focus }: { view: View; reload: Reload; focus: Focus }) {
  useScrollTo(focus, focus?.row ? `#src-row-${focus.row}` : null);
  const s = view.sources;
  return (
    <div className="stack">
      <div className="split even">
        <UploadBox view={view} kind="sources_csv" accept=".csv,text/csv" label="Source-lot table (CSV, UTF-8)" hint="Columns: supplier_id, supplier_name, source_lot_ref, source_lot_declared_quantity, allocated_quantity, quantity_unit, producer_country, plot_refs. Max 2 MB." reload={reload} />
        <div className="small">
          <p>
            <a href="/api/templates/sources.csv">Download the blank template</a>. Quantities must use digits with an optional “.” decimal point. Commas are rejected because <code>1,000</code> is ambiguous. LotHold never rounds or converts silently: tonnes and grams are converted exactly, and the original value is kept.
          </p>
          <p className="muted">Uploading the same file again is recognised and not duplicated.</p>
        </div>
      </div>
      <PendingUploads view={view} kind="sources_csv" reload={reload} />
      {!s ? (
        <div className="empty small muted">No confirmed source table. Upload one above and confirm it after reviewing the preview.</div>
      ) : (
        <>
          <ActiveFile upload={s.upload} label="source table" />
          <TableWrap stack label="Source rows">
            <table className="data">
              <caption className="sr-only">Confirmed source rows</caption>
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Supplier</th>
                  <th>Source lot</th>
                  <th className="num">Declared lot total</th>
                  <th className="num">Allocated here</th>
                  <th>Country</th>
                  <th>Plots</th>
                </tr>
              </thead>
              <tbody>
                {s.rows.map((r: any) => {
                  const hl = focus?.row === r.row;
                  const issue = (col: string) => r.issues.filter((i: any) => i.column === col);
                  const cell = (col: string, content: React.ReactNode) => (
                    <>
                      {content}
                      {issue(col).map((i: any, k: number) => (
                        <span key={k} className="cell-issue">
                          {i.message}
                        </span>
                      ))}
                    </>
                  );
                  return (
                    <tr key={r.row} id={`src-row-${r.row}`} className={`${hl ? 'highlight' : ''} ${r.issues.some((i: any) => i.severity === 'hold') ? 'issue' : ''}`}>
                      <td className="num">{r.row}</td>
                      <td className="break">{cell('supplier_id', <>{r.supplierId ?? <em className="muted">missing</em>}{r.supplierName && <span className="small muted" style={{ display: 'block' }}>{r.supplierName}</span>}</>)}</td>
                      <td className="break">{cell('source_lot_ref', r.sourceLotRef ?? <em className="muted">missing</em>)}</td>
                      <td className="num">
                        {cell('source_lot_declared_quantity', r.declared.display ?? <em className="muted">invalid</em>)}
                        <span className="orig">as received: {r.raw.source_lot_declared_quantity || '(empty)'} {r.raw.quantity_unit}</span>
                      </td>
                      <td className="num">
                        {cell('allocated_quantity', r.allocated.display ?? <em className="muted">invalid</em>)}
                        <span className="orig">as received: {r.raw.allocated_quantity || '(empty)'} {r.raw.quantity_unit}</span>
                        {issue('quantity_unit').map((i: any, k: number) => <span key={k} className="cell-issue">{i.message}</span>)}
                      </td>
                      <td>{cell('producer_country', r.producerCountry ?? <code>{r.raw.producer_country || '(empty)'}</code>)}</td>
                      <td className="break">{cell('plot_refs', r.plotRefs.join(', ') || <em className="muted">none</em>)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        </>
      )}
    </div>
  );
}

// ---------------- plots ----------------
export function PlotsTab({ view, reload, focus, onReview }: { view: View; reload: Reload; focus: Focus; onReview: (k: string) => void }) {
  const toast = useToast();
  const p = view.plots;
  const declared = new Map<string, number[]>();
  for (const r of view.sources?.rows ?? []) for (const ref of r.plotRefs) declared.set(ref, [...(declared.get(ref) ?? []), r.row]);
  const features = p?.features ?? [];
  const missing = [...declared.keys()].filter((ref) => !features.some((f: any) => f.plotRef === ref));
  const initial = focus?.featureIndex ?? features.find((f: any) => focus?.plotRef && f.plotRef === focus.plotRef)?.featureIndex ?? features[0]?.featureIndex ?? null;
  const [sel, setSel] = useState<number | null>(initial);
  useEffect(() => {
    if (initial !== null) setSel(initial);
  }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps
  // Falls back to the initial plot when nothing valid is selected (e.g. the first upload arrived after mount).
  const f = features.find((x: any) => x.featureIndex === sel) ?? features.find((x: any) => x.featureIndex === initial);
  const envKey = f?.plotRef ? `ENV:${f.plotRef}` : null;
  const envFinding = view.evaluation.findings.find((x: any) => x.key === envKey);
  const decision = view.decisions.find((d: any) => d.active && d.findingKey === envKey);
  const statusOf = (x: any) => (!x.report.valid ? 'PLOT_GEOMETRY_INVALID' : x.env?.status ?? x.env?.state ?? 'not_started');
  const swap = f?.report.issues.find((i: any) => i.code === 'possible_lat_lon_swap' && i.proposedCorrection);
  return (
    <div className="stack">
      <div className="split even">
        <UploadBox view={view} kind="plots_geojson" accept=".geojson,.json,application/geo+json,application/json" label="Plot boundaries (GeoJSON FeatureCollection)" hint="WGS 84 longitude, latitude. One Feature per plot with a plot_ref (or ProductionPlace) property; ProducerCountry and, for points, Area in hectares. Max 25 MB." reload={reload} />
        <div className="small">
          <p>Geometry is checked against the EUDR Information System GeoJSON rules: closed rings, no self-intersection, no holes, coordinates in range, a polygon for any plot over 4 ha. Valid plots are then analysed against the local forest datasets.</p>
          <p className="muted">LotHold never swaps axes, closes rings or creates geometry on its own. If a swap looks likely, it offers a correction for you to preview and confirm.</p>
        </div>
      </div>
      <PendingUploads view={view} kind="plots_geojson" reload={reload} />
      {missing.length > 0 && (
        <div className="callout rust small">
          <p>
            <strong>Declared without geometry:</strong> {missing.map((m) => `${m} (row ${declared.get(m)!.join(', ')})`).join('; ')}.
          </p>
        </div>
      )}
      {!p ? (
        <div className="empty small muted">No confirmed plot file.</div>
      ) : (
        <>
          <ActiveFile upload={p.upload} label="plot file" />
          <div className="split">
            <div className="stack">
              {f ? (
                <>
                  <div className="row">
                    <h2 style={{ margin: 0 }} className="break">{f.plotRef ?? `Feature ${f.featureIndex + 1}`}</h2>
                    <Badge cls={ENV_STATUS[statusOf(f)]?.cls ?? 'neutral'}>{ENV_STATUS[statusOf(f)]?.label ?? statusOf(f)}</Badge>
                  </div>
                  {envFinding?.ruleId === 'ENV-LOSS' && !decision && (
                    <div className="callout amber">
                      <p>
                        <strong>This plot has a land-change signal after the cut-off. Request review.</strong> {envFinding.message}
                      </p>
                      <div className="btn-row">
                        <button className="btn small" onClick={() => onReview(envFinding.key)}>
                          Record investigation
                        </button>
                      </div>
                    </div>
                  )}
                  {decision && (
                    <div className="callout green small">
                      <p>
                        <strong>{decision.decision === 'investigated_not_blocking' ? 'Investigated — not blocking' : 'Kept on hold'}</strong> by {decision.reviewer}, {fmtDate(decision.at)}: “{decision.rationale}”
                      </p>
                    </div>
                  )}
                  {!f.report.valid && (
                    <div className="callout rust small">
                      {f.report.issues.filter((i: any) => i.severity === 'hold').map((i: any) => (
                        <p key={i.code}>{i.message}</p>
                      ))}
                      {swap && (
                        <SwapPreview view={view} feature={f} issue={swap} reload={reload} toast={toast} />
                      )}
                    </div>
                  )}
                  {f.env?.grid ? (
                    <PixelMap grid={f.env.grid} geometry={f.geometry} label={f.plotRef ?? 'plot'} />
                  ) : f.report.valid ? (
                    <div className="empty small">
                      {ENV_STATUS[statusOf(f)]?.explain}
                      {f.env?.summary ? ` ${f.env.summary}` : ''}
                      {statusOf(f) === 'failed' && f.plotRef && (
                        <div style={{ marginTop: 10 }}>
                          <button
                            className="btn secondary small"
                            onClick={async () => {
                              try {
                                await api('POST', `/api/shipments/${view.shipment.id}/plots/${encodeURIComponent(f.plotRef)}/retry-analysis`);
                                toast('Analysis queued again.');
                                reload();
                              } catch (e) {
                                toast((e as Error).message, 'error');
                              }
                            }}
                          >
                            Retry analysis
                          </button>
                        </div>
                      )}
                    </div>
                  ) : null}
                  {f.env?.summary && f.env?.grid && envFinding?.ruleId !== 'ENV-LOSS' && <p>{f.env.summary}</p>}
                  {f.env?.lossByYear && <LossYears lossByYear={f.env.lossByYear} />}
                  <dl className="kv small">
                    <dt>Geometry source</dt>
                    <dd className="break">
                      {p.upload.filename}, feature {f.featureIndex + 1} (as submitted; not edited)
                    </dd>
                    <dt>Type and area</dt>
                    <dd>
                      {f.report.geometryType ?? '—'} · {f.report.areaHa !== null ? `${f.report.areaHa} ha computed` : f.report.declaredAreaHa !== null ? `${f.report.declaredAreaHa} ha declared` : 'area unknown'} · {f.report.vertexCount} vertices
                    </dd>
                    <dt>Bounding box</dt>
                    <dd className="mono break">{f.report.bbox ? f.report.bbox.map((n: number) => n.toFixed(6)).join(', ') : '—'}</dd>
                    <dt>Declared in rows</dt>
                    <dd>{f.plotRef && declared.get(f.plotRef) ? declared.get(f.plotRef)!.join(', ') : 'not referenced by any source row'}</dd>
                    {f.env?.analysedAt && (
                      <>
                        <dt>Analysis</dt>
                        <dd>
                          {fmtDate(f.env.analysedAt)} (computed from a locally pinned snapshot, not live monitoring) · {f.env.methodVersion} · sampling {f.env.sampling.replace(/_/g, ' ')}
                        </dd>
                        <dt>Coverage</dt>
                        <dd>
                          {f.env.hansenPixels.total} pixels: {f.env.hansenPixels.land} land, {f.env.hansenPixels.water} water, {f.env.hansenPixels.noData} no data · {f.env.coveredInterval}
                        </dd>
                        <dt>Datasets</dt>
                        <dd className="break">{f.env.datasets.map((d: any) => `${d.id} ${d.version}`).join('; ')}</dd>
                      </>
                    )}
                    {f.report.issues.filter((i: any) => i.severity === 'warning').map((i: any) => (
                      <Fragment key={i.code}>
                        <dt>Note</dt>
                        <dd>{i.message}</dd>
                      </Fragment>
                    ))}
                  </dl>
                  {f.env?.limitations && (
                    <details>
                      <summary className="small">What this evidence cannot show</summary>
                      <ul className="small">
                        {f.env.limitations.map((l: string) => (
                          <li key={l}>{l}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </>
              ) : (
                <p className="muted">Select a plot.</p>
              )}
            </div>
            <div className="table-wrap plot-list" style={{ alignSelf: 'start' }}>
              <table className="data">
                <caption className="sr-only">Plots in the active file</caption>
                <thead>
                  <tr>
                    <th>Plot</th>
                    <th>Evidence</th>
                  </tr>
                </thead>
                <tbody>
                  {features.map((x: any) => {
                    const st = ENV_STATUS[statusOf(x)];
                    return (
                      <tr key={x.featureIndex} className={x.featureIndex === f?.featureIndex ? 'highlight' : ''}>
                        <td>
                          <button className="source-link" onClick={() => setSel(x.featureIndex)} aria-pressed={x.featureIndex === f?.featureIndex}>
                            <span className="break">{x.plotRef ?? `Feature ${x.featureIndex + 1}`}</span>
                          </button>
                          <span className="small muted" style={{ display: 'block' }}>
                            {x.report.geometryType ?? 'no geometry'}
                            {x.report.areaHa !== null ? ` · ${x.report.areaHa} ha` : ''}
                          </span>
                        </td>
                        <td>
                          <Badge cls={st?.cls ?? 'neutral'}>{st?.label ?? statusOf(x)}</Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function SwapPreview({ view, feature, issue, reload, toast }: { view: View; feature: any; issue: any; reload: Reload; toast: (t: string, k?: 'info' | 'error') => void }) {
  const [busy, setBusy] = useState(false);
  const first = (g: any) => (g.type === 'Point' ? g.coordinates : g.type === 'Polygon' ? g.coordinates[0][0] : g.coordinates[0][0][0]);
  const a = first(feature.geometry), b = first(issue.proposedCorrection.geometry);
  return (
    <div className="stack" style={{ marginTop: 8 }}>
      <div className="compare">
        <div>
          <span>First coordinate as submitted</span>
          <code>[{a.join(', ')}]</code>
        </div>
        <div>
          <span>After exchanging axes</span>
          <code>[{b.join(', ')}]</code>
        </div>
      </div>
      <p style={{ margin: 0 }}>{issue.proposedCorrection.explanation}</p>
      <div>
        <button
          className="btn small secondary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await api('POST', `/api/shipments/${view.shipment.id}/plots/${feature.featureIndex}/swap-correction`);
              toast('A corrected copy was created. Preview and confirm it above to use it.');
              await reload();
            } catch (e) {
              toast((e as Error).message, 'error');
            } finally {
              setBusy(false);
            }
          }}
        >
          Create corrected copy for review
        </button>
      </div>
    </div>
  );
}

// ---------------- allocation ----------------
export function AllocationTab({ view, reload, goTo }: { view: View; reload: Reload; goTo: (f: Focus) => void }) {
  const toast = useToast();
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [rejected, setRejected] = useState<any[] | null>(null);
  const chain = useAsync(() => api('GET', `/api/shipments/${view.shipment.id}/chain`), [view.shipment.id, view.digest]);
  const r = view.evaluation.readiness;
  useEffect(() => {
    const pending = chain.data?.jobs?.some((j: any) => j.status === 'queued' || j.status === 'running') || chain.data?.transactions?.some((t: any) => t.status === 'pending');
    if (!pending) return;
    const t = window.setTimeout(() => void chain.reload(), 4000);
    return () => window.clearTimeout(t);
  }, [chain.data]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!view.sources) return <div className="empty small muted">Confirm a source table to see allocation balances.</div>;
  return (
    <div className="stack">
      <p className="small muted" style={{ maxWidth: '80ch', margin: 0 }}>
        Each source lot’s first confirmed declared total is kept in your organisation’s ledger and never overwritten. A reservation must fit inside that total minus what other shipments already hold. The check runs inside a database transaction, so concurrent reservations cannot both succeed. It only covers allocations recorded in LotHold; it cannot see sales recorded elsewhere.
      </p>
      {view.allocation.map((a: any) => {
        const declared = a.declaredGrams ?? 0;
        const pct = (g: number) => (declared ? Math.min(100, (g / declared) * 100) : 0);
        return (
          <div key={a.sourceLotKey} className="panel stack">
            <div className="row">
              <h3 style={{ margin: 0 }} className="break">
                Source lot {a.sourceLotRef}
              </h3>
              <span className="small muted break">supplier {a.supplierId}</span>
              <span className="spacer" />
              {a.excessGrams > 0 ? <Badge cls="hold">Exceeds by {a.display.excess}</Badge> : a.reservedHereGrams === a.requestedGrams ? <Badge cls="ready">Reserved</Badge> : <Badge cls="review">Not reserved</Badge>}
            </div>
            <div className="balance">
              <div className="bar" aria-hidden="true">
                <span style={{ width: `${pct(a.reservedByOthersGrams)}%`, background: '#8c958f' }} />
                <span style={{ width: `${pct(Math.min(a.requestedGrams, Math.max(0, a.availableGrams ?? 0)))}%`, background: a.reservedHereGrams ? 'var(--forest)' : '#9bb5a6' }} />
                {a.excessGrams > 0 && <span style={{ width: `${Math.min(100, pct(a.excessGrams))}%`, background: 'repeating-linear-gradient(45deg, var(--rust), var(--rust) 4px, #e8bdb6 4px, #e8bdb6 8px)' }} />}
              </div>
              <div className="legend">
                <span><i style={{ background: '#8c958f' }} />Other shipments {a.display.others}</span>
                <span><i style={{ background: a.reservedHereGrams ? 'var(--forest)' : '#9bb5a6' }} />This shipment {a.display.requested} {a.reservedHereGrams ? '(reserved)' : '(requested, not reserved)'}</span>
                {a.excessGrams > 0 && <span><i style={{ background: 'var(--rust)' }} />Excess {a.display.excess}</span>}
              </div>
            </div>
            <p className="math" style={{ margin: 0 }}>
              Declared {a.display.declared ?? 'unknown'} − held by other shipments {a.display.others} = available {a.display.available ?? 'unknown'} → this shipment requests {a.display.requested}
              {a.excessGrams > 0 ? ` → exceeds the declared balance by ${a.display.excess} → reservation blocked` : ''}
            </p>
            <div className="row small">
              {a.rows.map((row: number) => (
                <button key={row} className="source-link" onClick={() => goTo({ tab: 'sources', row })}>
                  row {row}
                </button>
              ))}
            </div>
          </div>
        );
      })}
      <div className="btn-row">
        <button
          className="btn"
          disabled={busy || r.allocation === 'RESERVED'}
          onClick={async () => {
            setBusy(true);
            setRejected(null);
            try {
              const res = await api('POST', `/api/shipments/${view.shipment.id}/reserve`);
              toast(res.created.length ? `Reserved: ${res.created.join('; ')}` : 'Already reserved; nothing was reserved twice.');
            } catch (e: any) {
              if (e.status === 409) {
                const body = await fetch(`/api/shipments/${view.shipment.id}`).then((x) => x.json());
                setRejected(body.evaluation.findings.filter((f: any) => f.dimension === 'allocation' && f.severity === 'hold'));
              } else toast(e.message, 'error');
            } finally {
              setBusy(false);
              await reload();
            }
          }}
        >
          {r.allocation === 'RESERVED' ? 'Allocations reserved' : busy ? 'Reserving…' : 'Reserve allocations in ledger'}
        </button>
      </div>
      {rejected && (
        <div className="callout rust" role="alert">
          <p><strong>Reservation rejected. No balance was changed.</strong></p>
          <ul className="small">{rejected.map((f) => <li key={f.key}>{f.message}</li>)}</ul>
        </div>
      )}

      <section className="section">
        <h2>Testnet anchoring (optional)</h2>
        {chain.loading && !chain.data && <p className="small">Checking registry…</p>}
        {chain.error && <p className="small" role="alert">{chain.error.message}</p>}
        {chain.data && (
          <div className="stack">
            <p className="small" style={{ margin: 0, maxWidth: '80ch' }}>
              Mirrors this shipment’s ledger reservations on the {chain.data.network === 'sepolia' ? 'Ethereum Sepolia' : chain.data.network} test network (chain {chain.data.chainId}) at{' '}
              {chain.data.registryExplorer ? <a className="mono break" href={chain.data.registryExplorer}>{chain.data.registryAddress}</a> : 'an unconfigured address'}. In this pilot the server signs with shared test keys (declarant <code className="break">{chain.data.signers.declarant ?? '—'}</code>, reserver <code className="break">{chain.data.signers.reserver ?? '—'}</code>), so on-chain addresses identify the pilot signers, not you. Only hashes and gram quantities are written.
            </p>
            {!chain.data.configured ? (
              <p className="callout small">Testnet anchoring is not configured on this server.</p>
            ) : !user?.chainEnabled ? (
              <p className="callout small">Testnet anchoring is not enabled for your organisation. An administrator enables it per organisation to protect the shared test signer from abuse.</p>
            ) : (
              <div>
                <button
                  className="btn secondary"
                  disabled={r.allocation !== 'RESERVED'}
                  title={r.allocation !== 'RESERVED' ? 'Reserve in the ledger first' : undefined}
                  onClick={async () => {
                    try {
                      await api('POST', `/api/shipments/${view.shipment.id}/chain/anchor`);
                      toast('Anchoring queued. Transactions appear below once submitted.');
                      await chain.reload();
                    } catch (e) {
                      toast((e as Error).message, 'error');
                    }
                  }}
                >
                  Anchor reservations on testnet
                </button>
                {r.allocation !== 'RESERVED' && <span className="small muted" style={{ marginLeft: 10 }}>Reserve in the ledger first.</span>}
              </div>
            )}
            {chain.data.jobs.some((j: any) => j.status === 'failed') && <p className="callout rust small">Anchoring stopped: {chain.data.jobs.find((j: any) => j.status === 'failed').error}. The ledger reservation is unaffected.</p>}
            {chain.data.transactions.length > 0 && (
              <TableWrap stack label="Testnet transactions">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Step</th>
                      <th>Status</th>
                      <th>Transaction</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chain.data.transactions.map((t: any, i: number) => (
                      <tr key={i}>
                        <td>{t.action}</td>
                        <td>
                          {t.status === 'confirmed' && <Badge cls="ready">Confirmed{t.blockNumber ? ` · block ${t.blockNumber}` : ''}</Badge>}
                          {t.status === 'pending' && <Badge cls="neutral">Submitted, awaiting confirmation</Badge>}
                          {t.status === 'queued' && <Badge cls="neutral">Queued</Badge>}
                          {t.status === 'reverted' && <Badge cls="hold">Mined, reverted</Badge>}
                          {t.status === 'preflight_rejected' && <Badge cls="review">Preflight rejected (not mined)</Badge>}
                          {t.status === 'rpc_error' && <Badge cls="unavailable">RPC error; will reconcile</Badge>}
                          {t.detail?.message && <span className="small muted" style={{ display: 'block' }}>{t.detail.message}</span>}
                          {t.detail?.note && <span className="small muted" style={{ display: 'block' }}>{t.detail.note}</span>}
                        </td>
                        <td className="mono small break">{t.txHash ? (t.explorer ? <a href={t.explorer}>{t.txHash.slice(0, 18)}…</a> : t.txHash) : <span className="muted">no transaction</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
            {chain.data.onChain.length > 0 && (
              <p className="small" style={{ margin: 0 }}>
                Read back from the contract:{' '}
                {chain.data.onChain.map((o: any) => (o.matches ? `${o.dbGrams} g confirmed on-chain` : o.chainGrams === null ? `not found on-chain${o.error ? ` (${o.error})` : ''}` : `MISMATCH: ledger ${o.dbGrams} g vs chain ${o.chainGrams} g`)).join('; ')}
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

// ---------------- documents ----------------
const DOC_LABEL: Record<string, string> = { supplier_request_pdf: 'Supplier evidence request (PDF)', review_draft_pdf: 'Review draft (PDF)', dds_xml: 'DDS V3 XML draft' };

export function DocumentsTab({ view, reload }: { view: View; reload: Reload }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const approved = view.approval.state === 'current';
  async function gen(kind: string) {
    setErr(null);
    setBusy(kind);
    try {
      const d = await api('POST', `/api/shipments/${view.shipment.id}/documents/${kind}`);
      toast(`${DOC_LABEL[kind]} created.`);
      await reload();
      const a = document.createElement('a');
      a.href = d.url;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="stack">
      <div className="cols3">
        <div className="panel stack">
          <h3 style={{ margin: 0 }}>Supplier evidence request</h3>
          <p className="small" style={{ margin: 0 }}>One page: each missing or contradictory item with its file/row reference, the requested action, and citations for any land-change signal. Titled “NOT a regulatory determination”.</p>
          <div><button className="btn small" disabled={!!busy} onClick={() => gen('supplier_request_pdf')}>{busy === 'supplier_request_pdf' ? 'Generating…' : 'Create and download PDF'}</button></div>
        </div>
        <div className="panel stack">
          <h3 style={{ margin: 0 }}>Review draft</h3>
          <p className="small" style={{ margin: 0 }}>Human-readable statement fields with provenance, source rows, plots and land evidence, allocation, findings and reviewer decisions. Marked DRAFT — NOT SUBMITTED.</p>
          <div><button className="btn small" disabled={!!busy} onClick={() => gen('review_draft_pdf')}>{busy === 'review_draft_pdf' ? 'Generating…' : 'Create and download PDF'}</button></div>
        </div>
        <div className="panel stack">
          <h3 style={{ margin: 0 }}>EUDR DDS V3 XML draft</h3>
          <p className="small" style={{ margin: 0 }}>
            The <code>SubmitDdsRequest</code> body, validated against the official XSD set before you can download it. No reference or verification number exists: only the EU system assigns those after an authorised submission, which LotHold never performs.
          </p>
          <div>
            <button className="btn small" disabled={!!busy || !approved} onClick={() => gen('dds_xml')}>
              {busy === 'dds_xml' ? 'Validating…' : 'Create and download XML'}
            </button>
          </div>
          {!approved && <p className="small muted" style={{ margin: 0 }}>{view.approval.state === 'stale' ? 'Available again after you sign off the current evidence (the previous sign-off is out of date).' : 'Available after reviewer sign-off of the current evidence snapshot.'}</p>}
        </div>
      </div>
      {err && <p className="callout rust small" role="alert">{err}</p>}
      <SupplierEmail view={view} />
      <section className="section">
        <h2>Generated documents</h2>
        <p className="small muted">A document marked out of date was built from earlier evidence. Copies already downloaded or sent cannot be recalled; send a new version.</p>
        {view.documents.length === 0 ? (
          <p className="small muted">None yet.</p>
        ) : (
          <TableWrap stack label="Generated documents">
            <table className="data">
              <thead>
                <tr>
                  <th>Document</th>
                  <th>Created</th>
                  <th>Evidence snapshot</th>
                  <th>Checks</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {view.documents.map((d: any) => (
                  <tr key={d.id}>
                    <td>
                      {DOC_LABEL[d.kind]}
                      <span className="small muted break" style={{ display: 'block' }}>{d.filename}</span>
                    </td>
                    <td className="small">{fmtDate(d.createdAt)}<span className="muted" style={{ display: 'block' }}>{d.createdBy}</span></td>
                    <td>{d.stale ? <Badge cls="stale">Out of date</Badge> : <Badge cls="ready">Current</Badge>}<span className="mono small muted" style={{ display: 'block' }}>{d.snapshotDigest.slice(0, 12)}</span></td>
                    <td className="small">
                      {d.kind === 'dds_xml' && d.validation ? `${d.validation.valid ? 'XSD valid' : 'XSD invalid'} · base64 round-trip ${d.validation.base64RoundTrip ? 'ok' : 'failed'} · ${d.validation.producers} producer(s)` : null}
                      {d.kind !== 'dds_xml' && d.validation ? `${d.validation.pages} page(s)${d.validation.itemsOmitted ? ` · ${d.validation.itemsOmitted} item(s) only in review draft` : ''}` : null}
                    </td>
                    <td>
                      <button className="btn small secondary" onClick={() => download(`/api/documents/${d.id}/download-link`).catch((e) => toast(e.message, 'error'))}>
                        Download
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </section>
    </div>
  );
}

// ---------------- activity ----------------
export function ActivityTab({ view }: { view: View }) {
  const { data, error, loading } = useAsync(() => api('GET', `/api/shipments/${view.shipment.id}/audit`), [view.shipment.id, view.digest]);
  if (loading && !data) return <p>Loading activity…</p>;
  if (error) return <p role="alert">{error.message}</p>;
  return (
    <TableWrap stack label="Activity">
      <table className="data">
        <caption className="sr-only">Append-only activity log</caption>
        <thead>
          <tr>
            <th>When</th>
            <th>Who</th>
            <th>Event</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          {data.events.map((e: any) => (
            <tr key={e.seq}>
              <td className="small nowrap">{fmtDate(e.at)}</td>
              <td className="small">{e.actor ?? 'system'}</td>
              <td className="small">{e.type}</td>
              <td className="small mono break">{JSON.stringify(e.data).slice(0, 220)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

// ---------------- review & sign-off ----------------
export function ReviewDialog({ view, findingKey, onClose, onDone }: { view: View; findingKey: string | null; onClose: () => void; onDone: () => Promise<void> }) {
  const f = view.evaluation.findings.find((x: any) => x.key === findingKey);
  const [decision, setDecision] = useState<'investigated_not_blocking' | 'keep_on_hold'>('keep_on_hold');
  const [rationale, setRationale] = useState('');
  const [evidenceId, setEvidenceId] = useState<string>('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setDecision('keep_on_hold');
    setRationale('');
    setEvidenceId('');
    setErr(null);
  }, [findingKey]);
  const evidence = view.uploads.filter((u: any) => u.kind === 'review_evidence');
  const needsEvidence = decision === 'investigated_not_blocking';
  return (
    <Dialog
      open={!!f}
      onClose={onClose}
      title="Record investigation"
      footer={
        <>
          <button className="btn secondary" onClick={onClose}>Cancel</button>
          <button
            className="btn"
            disabled={busy}
            onClick={async () => {
              setErr(null);
              setBusy(true);
              try {
                let ev = evidenceId || null;
                const file = fileRef.current?.files?.[0];
                if (file) {
                  const fd = new FormData();
                  fd.append('file', file);
                  ev = (await api('POST', `/api/shipments/${view.shipment.id}/uploads?kind=review_evidence`, fd)).uploadId;
                }
                await api('POST', `/api/shipments/${view.shipment.id}/decisions`, { findingKey, decision, rationale, evidenceUploadId: ev });
                await onDone();
              } catch (e) {
                setErr((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Saving…' : 'Record decision'}
          </button>
        </>
      }
    >
      {f && (
        <>
          <p className="small" style={{ margin: 0 }}><strong>{f.title}.</strong> {f.message}</p>
          <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 8 }}>
            <legend className="small" style={{ fontWeight: 600, marginBottom: 6 }}>Decision</legend>
            <label className="row small"><input type="radio" name="dec" checked={decision === 'keep_on_hold'} onChange={() => setDecision('keep_on_hold')} /> Keep on hold: evidence is insufficient or the change is unexplained</label>
            <label className="row small"><input type="radio" name="dec" checked={decision === 'investigated_not_blocking'} onChange={() => setDecision('investigated_not_blocking')} /> Investigated: supporting evidence explains the observation, so it does not block this draft</label>
          </fieldset>
          <label className="field">
            Rationale
            <span className="hint">{needsEvidence ? 'Explain what you checked and why it resolves the observation (at least 40 characters).' : 'Why it stays on hold (at least 10 characters).'} {rationale.trim().length} characters.</span>
            <textarea value={rationale} onChange={(e) => setRationale(e.target.value)} maxLength={4000} />
          </label>
          <div className="field">
            <span>Supporting evidence {needsEvidence ? '(required)' : '(optional)'}</span>
            <span className="hint">For example a supplier land-use record, dated field photos or an inspection report. Stored privately and encrypted.</span>
            {evidence.length > 0 && (
              <select value={evidenceId} onChange={(e) => setEvidenceId(e.target.value)} aria-label="Previously uploaded evidence">
                <option value="">Upload a new file below</option>
                {evidence.map((u: any) => <option key={u.id} value={u.id}>{u.filename}</option>)}
              </select>
            )}
            <input ref={fileRef} id="evidence-file" type="file" accept=".pdf,.png,.jpg,.jpeg,.txt,.csv,.geojson,.json" aria-label="Evidence file" />
          </div>
          <p className="small muted" style={{ margin: 0 }}>Your decision applies only to the current analysis result. If the plot geometry or the dataset result changes, it lapses and the item reopens.</p>
          {err && <p className="callout rust small" role="alert">{err}</p>}
        </>
      )}
    </Dialog>
  );
}

export function SignOff({ view, reload }: { view: View; reload: Reload }) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const ready = view.evaluation.readiness.overall === 'READY_FOR_SIGN_OFF';
  const a = view.approval;
  return (
    <div className="panel stack">
      <h2 style={{ fontSize: '1rem', margin: 0 }}>Reviewer sign-off</h2>
      {a.state === 'current' && (
        <p className="callout green small" style={{ margin: 0 }}>
          Signed off by {a.approvedBy} on {fmtDate(a.approvedAt)} for evidence snapshot <code>{a.digest.slice(0, 12)}</code>. Any change to sources, geometry, quantities, allocations, land evidence or decisions will make this out of date.
        </p>
      )}
      {a.state === 'stale' && (
        <p className="callout amber small" style={{ margin: 0 }}>
          The sign-off by {a.approvedBy} ({fmtDate(a.approvedAt)}) is out of date: the evidence has changed since snapshot <code>{a.digest.slice(0, 12)}</code>. Documents built from it are marked out of date.
        </p>
      )}
      {a.state !== 'current' && (
        <>
          <p className="small" style={{ margin: 0 }}>
            {ready ? 'All holds are resolved and land-change signals have been investigated with evidence. Sign-off records that you reviewed exactly this evidence snapshot.' : 'Sign-off becomes available once there are no holds and every land-change signal or coverage gap has a recorded investigation with evidence.'}
          </p>
          {ready && (
            <label className="field">
              Note (optional)
              <input type="text" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
            </label>
          )}
          <div>
            <button
              className="btn small"
              disabled={!ready || busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api('POST', `/api/shipments/${view.shipment.id}/approve`, { digest: view.digest, note: note || null });
                  toast('Signed off. The DDS V3 XML draft can now be exported.');
                  await reload();
                } catch (e) {
                  toast((e as Error).message, 'error');
                  await reload();
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? 'Signing off…' : `Sign off snapshot ${view.digest.slice(0, 8)}`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** Audited correction of a source lot's recorded total to the value in the confirmed source table. */
export function LotCorrectionDialog({ view, findingKey, onClose, onDone }: { view: View; findingKey: string | null; onClose: () => void; onDone: () => Promise<void> }) {
  const f = view.evaluation.findings.find((x: any) => x.key === findingKey);
  const [rationale, setRationale] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setRationale('');
    setErr(null);
  }, [findingKey]);
  const [supplierId, sourceLotRef] = (findingKey ?? '').replace(/^ALLOC-REG-MISMATCH:/, '').split('::');
  return (
    <Dialog
      open={!!f}
      onClose={onClose}
      title="Correct the recorded total"
      footer={
        <>
          <button className="btn secondary" onClick={onClose}>Cancel</button>
          <button
            className="btn"
            disabled={busy}
            onClick={async () => {
              setErr(null);
              const file = fileRef.current?.files?.[0];
              if (!file) return setErr('Attach the document that supports the corrected total.');
              setBusy(true);
              try {
                const fd = new FormData();
                fd.append('file', file);
                const ev = (await api('POST', `/api/shipments/${view.shipment.id}/uploads?kind=review_evidence`, fd)).uploadId;
                await api('POST', `/api/shipments/${view.shipment.id}/source-lots/correct`, { supplierId, sourceLotRef, rationale, evidenceUploadId: ev });
                await onDone();
              } catch (e) {
                setErr((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Saving…' : 'Record correction'}
          </button>
        </>
      }
    >
      {f && (
        <>
          <p className="small" style={{ margin: 0 }}>
            The recorded total for source lot <strong>{sourceLotRef}</strong> becomes <strong>{f.original}</strong> (now {f.normalized}). The first total and this correction both stay in the history. Sign-offs in other cases that used the old total become out of date. Not possible once the lot is on the testnet registry.
          </p>
          <label className="field">
            Why is the earlier total wrong? <span className="muted">(at least 40 characters)</span>
            <textarea rows={3} value={rationale} onChange={(e) => setRationale(e.target.value)} />
          </label>
          <label className="field">
            Supporting document
            <input type="file" ref={fileRef} accept=".pdf,.png,.jpg,.jpeg,.txt,.csv" />
          </label>
          {err && <p className="callout rust small" role="alert">{err}</p>}
        </>
      )}
    </Dialog>
  );
}

/** Editable, copyable supplier email built from the outstanding supplier actions (nothing is sent by LotHold). */
function supplierEmailText(view: View): string {
  const items = view.evaluation.findings.filter((f: any) => f.supplierActionable && f.severity !== 'warning' && f.requestedAction);
  const resolved = view.evaluation.findings.filter((f: any) => f.reviewedWithEvidence);
  const lines = [
    `Subject: Evidence needed for shipment ${view.shipment.reference}`,
    '',
    'Hello,',
    '',
    items.length
      ? `While reviewing the records for shipment ${view.shipment.reference}, we found ${items.length} item${items.length === 1 ? '' : 's'} that we need you to correct or support with evidence:`
      : `We have reviewed the records for shipment ${view.shipment.reference} and currently need nothing further from you.`,
    '',
    ...items.map((f: any, i: number) => `${i + 1}. ${f.requestedAction}`),
    ...(resolved.length ? ['', `Already reviewed with your evidence (no action needed): ${resolved.map((f: any) => f.title).join('; ')}.`] : []),
    '',
    'Forest-change observations come from published satellite datasets (Hansen Global Forest Change, https://glad.earthengine.app/view/global-forest-change; JRC Global Forest Cover 2020, https://forobs.jrc.ec.europa.eu/GFC). A recorded loss is a reason to ask for evidence, not a finding of deforestation.',
    '',
    'This is a request for information, not a regulatory determination.',
    '',
    'Kind regards,',
  ];
  return lines.join('\n');
}

function SupplierEmail({ view }: { view: View }) {
  const toast = useToast();
  const generated = supplierEmailText(view);
  const [text, setText] = useState(generated);
  const [edited, setEdited] = useState(false);
  useEffect(() => {
    if (!edited) setText(generated);
  }, [generated, edited]);
  return (
    <section className="section" aria-labelledby="supplier-email-title">
      <h2 id="supplier-email-title">Supplier email</h2>
      <p className="small muted">Built from the items still outstanding. Edit it, then copy it into your own email; LotHold does not send anything.</p>
      <label className="field">
        <span className="sr-only">Supplier email text</span>
        <textarea
          rows={12}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setEdited(true);
          }}
          style={{ fontFamily: 'var(--mono)', fontSize: '0.82rem' }}
        />
      </label>
      <div className="row" style={{ gap: 8 }}>
        <button
          className="btn small"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              toast('Email text copied.');
            } catch {
              toast('Copy failed; select the text and copy it manually.', 'error');
            }
          }}
        >
          Copy email text
        </button>
        {edited && (
          <button
            className="btn secondary small"
            onClick={() => {
              setEdited(false);
              setText(generated);
            }}
          >
            Reset to current findings
          </button>
        )}
      </div>
    </section>
  );
}
