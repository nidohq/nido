import{readFileSync,writeFileSync}from'node:fs';
import{createHash}from'node:crypto';
const expected={perch_fee_budget:['__constructor','refill','pause','status'],demo_perch_budget_account:['__constructor','__check_auth','execute'],nido_demo_action:['__constructor','refill','touch'],perch_webauthn_verifier:['verify'],local_verifier_registry:['deploy']};
const artifacts={};
for(const[name,required]of Object.entries(expected)){
 const binary=readFileSync(`public/contracts/${name}.wasm`);
 const exports=WebAssembly.Module.exports(new WebAssembly.Module(binary)).map(e=>e.name);
 for(const fn of required)if(!exports.includes(fn))throw Error(`${name} lacks ${fn}; refuse client-only or stale artifact`);
 artifacts[name]={sha256:createHash('sha256').update(binary).digest('hex'),bytes:binary.length,exports};
}
const paths=['contracts/Cargo.lock','contracts/perch-budget-account/src/lib.rs','contracts/fee-budget/src/lib.rs','contracts/local-verifier-registry/src/lib.rs','.perch-src/crates/perch-smart-account/wasm/verifiers.path'];
writeFileSync('public/contracts/manifest.json',JSON.stringify({perch:JSON.parse(readFileSync('perch-source.json')),localOnly:true,artifacts,sources:Object.fromEntries(paths.map(p=>[p,createHash('sha256').update(readFileSync(p)).digest('hex')]))},null,2)+'\n');
