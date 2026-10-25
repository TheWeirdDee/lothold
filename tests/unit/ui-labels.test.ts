// Source labels shown next to every finding. A dataset-level reference has no plot, and used to render
// "Land evidence for undefined" in the interface.
import { describe, expect, it } from 'vitest';
import { refText, refToFocus } from '../../web/src/refs.ts';

describe('finding source labels', () => {
  it('names the plot when the reference has one', () => {
    expect(refText({ kind: 'environment', plotRef: 'ENG-PLOT-A' })).toBe('Land evidence for ENG-PLOT-A');
    expect(refToFocus({ kind: 'environment', plotRef: 'ENG-PLOT-A' })).toEqual({ tab: 'plots', plotRef: 'ENG-PLOT-A' });
  });

  it('never renders "undefined" for a dataset-level reference', () => {
    const label = refText({ kind: 'environment' });
    expect(label).toBe('Land evidence: forest data recency');
    expect(label).not.toContain('undefined');
    expect(refToFocus({ kind: 'environment' })).toEqual({ tab: 'plots', plotRef: undefined });
  });

  it('keeps file, row, column and field references readable', () => {
    expect(refText({ kind: 'sources_csv', filename: 'sources.csv', row: 3, column: 'plot_refs' })).toBe('sources.csv · row 3 · plot_refs');
    expect(refText({ kind: 'sources_csv' })).toBe('Upload a source table');
    expect(refText({ kind: 'plots_geojson', filename: 'plots.geojson', featureIndex: 1, plotRef: 'ENG-PLOT-B' })).toBe('plots.geojson · feature 2 (ENG-PLOT-B)');
    expect(refText({ kind: 'plots_geojson' })).toBe('Upload a plot file');
    expect(refText({ kind: 'shipment_field', field: 'hsCode' })).toBe('Field: hsCode');
    expect(refText({ kind: 'ledger' })).toBe('Allocation ledger');
  });
});