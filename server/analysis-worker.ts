// CPU-heavy TIFF decoding belongs to this child process, never the HTTP event loop.
import { analysePlot, setDatasetHashes, markVerificationDone, DATASETS } from './env/forest.ts';
setDatasetHashes(Object.fromEntries(Object.entries(DATASETS).map(([id, d]) => [id, d.sha256])));
markVerificationDone();
process.on('disconnect', () => process.exit(0));
process.on('message', async (message) => {
 const {geometry}=message as {geometry:Parameters<typeof analysePlot>[0]};
  try { const result=await analysePlot(geometry, { geometryValid: true }); if(result.error) console.error(JSON.stringify({event:'analysis.read_failed',message:result.error})); process.send!({ result }); }
  catch { process.send!({ error: 'Raster analysis failed. No environmental conclusion was produced.' }); }
});
