// Build-time public facts only. Never serialise process.env, local paths or availability.
import { mkdirSync, writeFileSync } from 'node:fs';
import { DATASETS, ANALYSIS_METHOD_VERSION, COVERAGE_BBOX, CUTOFF_YEAR } from '../server/env/forest.ts';
import { RULES_VERSION } from '../core/rules.ts';
import { SOURCE_COLUMNS, blankSourcesTemplate } from '../core/sources.ts';

mkdirSync('web/src/generated', { recursive: true });
mkdirSync('web/public/templates', { recursive: true });
writeFileSync('web/src/generated/method.json', JSON.stringify({ rulesVersion: RULES_VERSION, analysisMethod: ANALYSIS_METHOD_VERSION, coverageBbox: COVERAGE_BBOX, cutoffYear: CUTOFF_YEAR, datasets: Object.values(DATASETS).map(({ file, ...publicSpec }) => publicSpec), sourceColumns: SOURCE_COLUMNS }, null, 2) + '\n');
writeFileSync('web/public/templates/sources.csv', blankSourcesTemplate());
