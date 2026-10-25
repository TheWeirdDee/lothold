// Explicitly isolated engineering writes only. Never loads .env implicitly.
// --local measures real encrypted checkpoint sizes using a protocol double.
// --live verifies the actual service, including anon-key RLS/Storage denial.
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, get, type DB } from '../server/db.ts';
import { createApp } from '../server/app.ts';
import { DurableCheckpoint, supabaseTransport, type Checkpoint, type CheckpointTransport } from '../server/durability.ts';
import { readBytes } from '../server/security.ts';
import { client, CSV_HEADER } from '../tests/integration/harness.ts';
const live=process.argv.includes('--live');
if (!live && !process.argv.includes('--local')) throw new Error('Select --local or --live explicitly.');
const reportPath=live?'docs/evidence/supabase-live.json':'docs/evidence/checkpoint-usage.json';
const needed=['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_ANON_KEY'];
mkdirSync('docs/evidence',{recursive:true});
if(live && needed.some(n=>!process.env[n])) {
 writeFileSync(reportPath,JSON.stringify({status:'blocked',liveVerified:false,missing:needed.filter(n=>!process.env[n]),requiredAction:'Create a free Supabase project, apply deploy/render/supabase.sql, set the missing server-shell variables, then run node scripts/verify-supabase.ts --live.'},null,2));
 console.log('Live verification blocked: missing server-shell settings. No external request or write made.'); process.exit(2);
}
const namespace=`engineering-${randomUUID()}`, dir=mkdtempSync(join(tmpdir(),'lothold-cloud-engineering-'));
process.env.EVIDENCE_ENCRYPTION_KEY=randomBytes(32).toString('hex');
process.env.DOWNLOAD_SIGNING_KEY=randomBytes(32).toString('hex');
process.env.EVIDENCE_STORE='sqlite'; process.env.CHAIN_ANCHORING='off'; process.env.REGISTER_RATE_LIMIT='1000';
const bucket=process.env.SUPABASE_STORAGE_BUCKET ?? 'lothold-private';
let row:Checkpoint={owner:'',revision:0,object_key:null,sha256:null}; const objects=new Map<string,Buffer>();
const memory:CheckpointTransport={ async claim(owner){row={...row,owner};return {...row};},async status(){return {...row};},async put(k,b){objects.set(k,Buffer.from(b));},async read(k){return objects.get(k)!;},async commit(owner,revision,object_key,sha256){if(owner!==row.owner||revision!==row.revision)throw new Error('fenced'); const discarded_key=(row as Checkpoint & {previous?:string}).previous; row={owner,revision:revision+1,object_key,sha256,...{previous:row.object_key}};return {...row,discarded_key};},async remove(k){objects.delete(k);}};
const transport=live?supabaseTransport(process.env.SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,bucket,namespace):memory;
const keys:string[]=[],sizes:number[]=[],dbs:DB[]=[],checks:{name:string;pass:boolean}[]=[];
let downloaded=0;
const operations:{operation:string;ms:number;pass:boolean}[]=[];
let stage='initial RPC claim/recovery'; let failureStage:string|null=null; let failureHttpStatus:number|null=null;
async function measure<T>(operation:string,run:()=>Promise<T>):Promise<T>{const t=performance.now();try{const value=await run();operations.push({operation,ms:Math.round(performance.now()-t),pass:true});return value;}catch(e){operations.push({operation,ms:Math.round(performance.now()-t),pass:false});failureStage=operation;const matched=/HTTP (\d{3})/.exec(e instanceof Error?e.message:'');failureHttpStatus=matched?Number(matched[1]):null;throw e;}}
const measured:CheckpointTransport={...transport,claim:owner=>measure('RPC claim',()=>transport.claim(owner)),status:()=>measure('RPC status',()=>transport.status()),commit:(...args)=>measure('RPC conditional commit',()=>transport.commit(...args)),async put(k,b){keys.push(k);sizes.push(b.length);await measure('private immutable upload',()=>transport.put(k,b));},async read(k){const b=await measure('private checkpoint download',()=>transport.read(k));downloaded+=b.length;return b;}};
const check=(name:string,pass:boolean)=>{checks.push({name,pass});if(!pass)throw new Error(name);};
async function instance(){const store=new DurableCheckpoint(measured,namespace,join(dir,randomUUID()+'.sqlite'));await store.restore();const db=openDb(store.path);dbs.push(db);store.attach(db);await store.flush();return {db,store,app:createApp(db,{durability:store})};}
let outcome='failed';
try {
 const a=await instance(), c=client(a.app); await c.register('ENGINEERING CLOUD RESTORE');
 const email=(await c.req('GET','/api/auth/me')).json.user.email;
 const shipment=await c.req('POST','/api/shipments',{reference:'ENG-CLOUD-RESTORE'});
 check('create engineering case',shipment.status===201);
 const bytes=CSV_HEADER+'\nENG-S,ENGINEERING,ENG-L,100,10,kg,CI,ENG-P';
 const up=await c.upload(shipment.json.id,'sources_csv','ENGINEERING.csv',bytes,'text/csv');check('upload',up.status===201);
 const pdf=await c.req('POST',`/api/shipments/${shipment.json.id}/documents/supplier_request_pdf`);check('PDF',pdf.status===201);
 const evidence=get<{org_id:string;storage_key:string}>(a.db,'SELECT org_id,storage_key FROM uploads WHERE id=?',up.json.uploadId)!;
 const b=await instance(), second=client(b.app);
 check('same account after fresh-cache restore',(await second.req('POST','/api/auth/login',{email,password:'engineering-test-pw'})).status===200);
 check('same records',(await second.req('GET',`/api/shipments/${shipment.json.id}`)).status===200);
 check('evidence decrypts byte-identically',readBytes(evidence.org_id,evidence.storage_key,b.db).toString()===bytes);
 check('stale writer rejected',(await c.req('POST','/api/shipments',{reference:'ENG-STALE'})).status===503);
 const d=await instance();
 check('second replacement restores evidence',readBytes(evidence.org_id,evidence.storage_key,d.db).toString()===bytes);
 const doc=get<{org_id:string;storage_key:string;sha256:string}>(d.db,'SELECT s.org_id,d.storage_key,d.sha256 FROM documents d JOIN shipments s ON s.id=d.shipment_id WHERE d.id=?',pdf.json.id)!;
 check('stored PDF decrypts and hashes correctly',createHash('sha256').update(readBytes(doc.org_id,doc.storage_key,d.db)).digest('hex')===doc.sha256);
 if(live){
  stage='private bucket and anon permission checks';
  const headers={apikey:process.env.SUPABASE_ANON_KEY!,authorization:`Bearer ${process.env.SUPABASE_ANON_KEY!}`};
  const base=process.env.SUPABASE_URL!;
  const serviceHeaders={apikey:process.env.SUPABASE_SERVICE_ROLE_KEY!,authorization:`Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`};
  const settings=await fetch(`${base}/auth/v1/settings`,{headers,signal:AbortSignal.timeout(15000)});
  check('anon key is accepted by this project',settings.ok);
  const meta=await fetch(`${base}/storage/v1/bucket/${encodeURIComponent(bucket)}`,{headers:serviceHeaders,signal:AbortSignal.timeout(15000)});
  check('bucket metadata readable by service role',meta.ok);
  const bucketInfo=await meta.json();check('configured bucket is private',bucketInfo.public===false);
  check('bucket permits bounded encrypted checkpoints',Number(bucketInfo.file_size_limit)>=32*1024*1024+32);

  const denied=await fetch(`${base}/rest/v1/rpc/lothold_claim`,{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({p_namespace:namespace,p_owner:randomUUID()}),signal:AbortSignal.timeout(15000)});
  check('anon cannot claim checkpoint',[401,403,404].includes(denied.status));
  const table=await fetch(`${base}/rest/v1/lothold_checkpoint?namespace=eq.${namespace}`,{headers,signal:AbortSignal.timeout(15000)});
  check('anon cannot read checkpoint row',[401,403].includes(table.status) || (table.ok && JSON.stringify(await table.json())==='[]'));
  const pointer=await transport.status(); const path=`${encodeURIComponent(bucket)}/${pointer.object_key!.split('/').map(encodeURIComponent).join('/')}`;
  for(const [name,route,auth] of [['anonymous','public',{}],['anon-key','',headers]] as const){
   const r=await fetch(`${base}/storage/v1/object/${route?route+'/':''}${path}`,{headers:auth,signal:AbortSignal.timeout(15000)});check(`${name} cannot download private snapshot`,[400,401,403,404].includes(r.status));
  }
 }
 outcome='passed';
} catch { failureStage ??= stage; console.error('Engineering verification failed; inspect named checks/operations. No credentials logged.'); }
finally {
 dbs.forEach(db=>db.close());
 let cleanup='not external';
 if(live){try{for(const key of keys)await transport.remove(key);const r=await fetch(`${process.env.SUPABASE_URL}/rest/v1/lothold_checkpoint?namespace=eq.${namespace}`,{method:'DELETE',headers:{apikey:process.env.SUPABASE_SERVICE_ROLE_KEY!,authorization:`Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`},signal:AbortSignal.timeout(15000)});cleanup=r.ok?'isolated namespace removed':r.status===404&&keys.length===0&&failureHttpStatus===404?'claim RPC missing; no checkpoints uploaded':'manual cleanup required';}catch{cleanup='manual cleanup required';}}
 const last=sizes.at(-1)??0;
 writeFileSync(reportPath,JSON.stringify({status:outcome,liveVerified:live&&outcome==='passed',scope:live?'actual Supabase services; isolated engineering namespace':'LOCAL PROTOCOL DOUBLE; size/usage measurement only',namespace,checks,operations,failureStage,failureHttpStatus,checkpointCount:sizes.length,encryptedCheckpointBytes:sizes,totalUploadedBytes:sizes.reduce((a,b)=>a+b,0),totalReadBackAndRestoreBytes:downloaded,retainedTwoSnapshotsBytes:2*last,cleanup},null,2));
}
if(outcome!=='passed')process.exitCode=1;
