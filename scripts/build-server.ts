// Bundle the module graph at build time; no TS stripping or barrel-file walk at cold startup.
import { build } from 'esbuild';
import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
const result = await build({ entryPoints: { bootstrap:'server/bootstrap.ts', main:'server/main.ts', 'analysis-worker':'server/analysis-worker.ts' }, outdir:'server-dist', outExtension:{'.js':'.mjs'}, bundle:true, splitting:true, platform:'node', format:'esm', target:'node24', sourcemap:true, metafile:true, external:['pdfkit','geotiff','xmllint-wasm','pdfjs-dist/*','@anthropic-ai/sdk'], banner:{js:"import { createRequire as __makeRequire } from 'node:module'; const require = __makeRequire(import.meta.url);"} });
mkdirSync('server-dist/schema',{recursive:true});
cpSync('server/dds/schema','server-dist/schema',{recursive:true});
cpSync('server/chain/artifact.json','server-dist/artifact.json');
writeFileSync('server-dist/build-meta.json',JSON.stringify(result.metafile));
