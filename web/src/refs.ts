// Pure helpers for turning a finding's source reference into a human label and a destination tab.
// Kept free of React and router imports so they can be unit-tested directly.
export type Focus = { tab: string; row?: number; column?: string; featureIndex?: number; plotRef?: string; field?: string } | null;

export function refToFocus(ref: any): Focus {
  if (ref.kind === 'sources_csv') return { tab: 'sources', row: ref.row, column: ref.column };
  if (ref.kind === 'plots_geojson') return { tab: 'plots', featureIndex: ref.featureIndex, plotRef: ref.plotRef };
  if (ref.kind === 'environment') return { tab: 'plots', plotRef: ref.plotRef };
  if (ref.kind === 'shipment_field') return { tab: 'details', field: ref.field };
  if (ref.kind === 'ledger') return { tab: 'allocation' };
  return null;
}

export function refText(ref: any): string {
  if (ref.kind === 'sources_csv') return ref.row ? `${ref.filename ?? 'source table'} · row ${ref.row}${ref.column ? ` · ${ref.column}` : ''}` : 'Upload a source table';
  if (ref.kind === 'plots_geojson') return ref.featureIndex !== undefined ? `${ref.filename ?? 'plot file'} · feature ${ref.featureIndex + 1}${ref.plotRef ? ` (${ref.plotRef})` : ''}` : 'Upload a plot file';
  // A dataset-level finding (e.g. ENV-RECENCY) names no single plot, so it must not render "for undefined".
  if (ref.kind === 'environment') return ref.plotRef ? `Land evidence for ${ref.plotRef}` : 'Land evidence: forest data recency';
  if (ref.kind === 'shipment_field') return `Field: ${ref.field}${ref.filename ? ` (from ${ref.filename})` : ''}`;
  return 'Allocation ledger';
}