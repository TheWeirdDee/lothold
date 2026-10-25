// Engineering import-only profile. Never opens a database or accepts requests.
const root = process.env.PROFILE_ROOT ?? new URL('../', import.meta.url).href;
for (const file of ['server/db.ts','server/security.ts','server/env/forest.ts','server/dds/xml.ts','server/documents.ts','server/chain/registry.ts','server/ai/extract.ts','server/app.ts','server/handlers.ts']) {
 const t=performance.now(), cpu=process.cpuUsage();
 await import(new URL(file, root));
 console.log(JSON.stringify({event:'import_profile',module:file,ms:Math.round(performance.now()-t),cpuMicros:process.cpuUsage(cpu)}));
}
