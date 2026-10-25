// Earliest process milestone, before loading application/dependency modules.
console.log(JSON.stringify({event:'startup.process',at:new Date().toISOString()}));
await import('./main.ts');
export {};
