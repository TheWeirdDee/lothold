// Produces a REVIEWABLE candidate only. Does not overwrite vercel.json or deploy.
// node scripts/prepare-vercel-routing.ts https://YOUR-BACKEND-HOST
import { writeFileSync } from 'node:fs';
const input = process.argv[2];
if (!input) throw new Error('Supply the HTTPS origin of an already provisioned persistent LotHold backend.');
const backend = new URL(input);
if (backend.protocol !== 'https:' || backend.username || backend.password || backend.search || backend.hash || backend.pathname !== '/' || /localhost|example\.|127\.0\.0\.1/.test(backend.hostname)) throw new Error('Use a real HTTPS origin, without credentials, path, query or fragment.');
writeFileSync('deploy/vercel.connected.json', JSON.stringify({ $schema: 'https://openapi.vercel.sh/vercel.json', rewrites: [ { source: '/api/:path*', destination: `${backend.origin}/api/:path*` }, { source: '/((?!api/).*)', destination: '/index.html' } ] }, null, 2) + '\n');
console.log('Prepared deploy/vercel.connected.json. Review it before replacing vercel.json. Set backend PUBLIC_ORIGIN to the frontend HTTPS origin. No deployment performed.');
