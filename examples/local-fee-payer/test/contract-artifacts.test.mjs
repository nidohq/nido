import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root=new URL('../',import.meta.url);
test('deployed contract artifacts match their source pin and include callable entry points',()=>{
 const manifest=JSON.parse(readFileSync(new URL('public/contracts/manifest.json',root)));
 assert.deepEqual(manifest.perch,JSON.parse(readFileSync(new URL('perch-source.json',root))));
 for(const[name,record]of Object.entries(manifest.artifacts)){
  const binary=readFileSync(new URL(`public/contracts/${name}.wasm`,root));
  assert.equal(createHash('sha256').update(binary).digest('hex'),record.sha256);
  assert.deepEqual(WebAssembly.Module.exports(new WebAssembly.Module(binary)).map(e=>e.name),record.exports);
 }
 for(const[path,expected]of Object.entries(manifest.sources)){
  if(path.startsWith('.perch-src/'))continue; // Generated overlay checked by build:contract.
  assert.equal(createHash('sha256').update(readFileSync(new URL(path,root))).digest('hex'),expected,path);
 }
 assert.ok(manifest.artifacts.perch_fee_budget.exports.includes('__constructor'));
 assert.ok(manifest.artifacts.perch_fee_budget.exports.includes('refill'));
});
