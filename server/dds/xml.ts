// DDS V3 "SubmitDdsRequest" body, mapped from reviewed records and validated against the official XSD set
// (retrieved from the EUDR Information System WSDL; see server/dds/schema/MANIFEST.json).
// The XML contains only official elements. Draft status lives in the filename and the sidecar manifest,
// never inside the official envelope. No reference or verification numbers are ever produced.
import { readFileSync } from 'node:fs';
import { gramsToKgDecimal } from '../../core/quantity.ts';
import { SUPPORTED_PRODUCT } from '../../core/reference.ts';

const SCHEMA_DIR = new URL('./schema/', import.meta.url);
const read = (n: string) => ({ fileName: n, contents: readFileSync(new URL(n, SCHEMA_DIR), 'utf8') });
export const DDS_NAMESPACE = 'http://ec.europa.eu/tracesnt/certificate/eudr/due-diligence-statement/v3';
export const COMMON_NAMESPACE = 'http://ec.europa.eu/tracesnt/certificate/eudr/common/v3';
export const SCHEMA_ID = 'EUDR DDS V3 (EUDRDueDiligenceStatementServiceV3 WSDL, retrieved 2026-10-23)';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export type DdsInput = {
  internalReference: string;
  activityType: 'IMPORT' | 'EXPORT' | 'DOMESTIC';
  operatorRole: 'OPERATOR';
  countryOfActivity: string | null;
  descriptionOfGoods: string;
  hsHeading: string;
  netWeightGrams: number;
  geoLocationConfidential: boolean;
  producers: { country: string; name: string | null; geometry: unknown; properties: Record<string, string | number> }[];
};

export function buildSubmitDdsRequest(d: DdsInput): string {
  const producers = d.producers
    .map(
      (p, i) => `      <dds:producers>
        <dds:position>${i + 1}</dds:position>
        <dds:country>${esc(p.country)}</dds:country>${p.name ? `\n        <dds:name>${esc(p.name.slice(0, 500))}</dds:name>` : ''}
        <dds:geometryGeojson>${Buffer.from(JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: p.properties, geometry: p.geometry }] })).toString('base64')}</dds:geometryGeojson>
      </dds:producers>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<dds:SubmitDdsRequest xmlns:dds="${DDS_NAMESPACE}" xmlns:eudrCommon="${COMMON_NAMESPACE}">
  <dds:operatorRole>${d.operatorRole}</dds:operatorRole>
  <dds:statement>
    <dds:internalReferenceNumber>${esc(d.internalReference.slice(0, 50))}</dds:internalReferenceNumber>
    <dds:activityType>${d.activityType}</dds:activityType>${d.countryOfActivity ? `\n    <dds:countryOfActivity>${esc(d.countryOfActivity)}</dds:countryOfActivity>` : ''}
    <dds:commodities>
      <dds:position>1</dds:position>
      <dds:descriptors>
        <eudrCommon:descriptionOfGoods>${esc(d.descriptionOfGoods)}</eudrCommon:descriptionOfGoods>
        <eudrCommon:goodsMeasure>
          <eudrCommon:netWeight>${gramsToKgDecimal(d.netWeightGrams)}</eudrCommon:netWeight>
        </eudrCommon:goodsMeasure>
      </dds:descriptors>
      <dds:hsHeading>${esc(d.hsHeading)}</dds:hsHeading>
      <dds:speciesInfo>
        <dds:scientificName>${SUPPORTED_PRODUCT.scientificName}</dds:scientificName>
        <dds:commonName>${SUPPORTED_PRODUCT.commonName}</dds:commonName>
      </dds:speciesInfo>
${producers}
    </dds:commodities>
    <dds:geoLocationConfidential>${d.geoLocationConfidential ? 'true' : 'false'}</dds:geoLocationConfidential>
  </dds:statement>
</dds:SubmitDdsRequest>
`;
}

export type XsdValidation = { valid: boolean; schema: string; errors: string[]; validator: string; validatedAt: string };

export async function validateDdsXml(xml: string): Promise<XsdValidation> {
  const r = await (await import('xmllint-wasm')).validateXML({
    xml: [{ fileName: 'dds.xml', contents: xml }],
    schema: [read('eudr-dds-v3.xsd')],
    preload: [read('eudr-common-v3.xsd'), read('tracesnt-error-v01.xsd'), read('uncefact-udt-21.xsd')],
  });
  return {
    valid: r.valid,
    schema: SCHEMA_ID,
    errors: r.errors.map((e) => e.rawMessage ?? e.message).slice(0, 50),
    validator: 'libxml2 2.13.8 via xmllint-wasm 5.3.0',
    validatedAt: new Date().toISOString(),
  };
}
