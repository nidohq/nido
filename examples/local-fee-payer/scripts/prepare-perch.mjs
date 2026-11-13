// Materialize the exact review pin; never modify Nido's or Perch's checkout.
import {readFileSync,writeFileSync,existsSync,mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const pin=JSON.parse(readFileSync('perch-source.json'));
const testnet=process.env.FEE_BUILD_NETWORK==='testnet';
const registry=testnet?JSON.parse(readFileSync('testnet-source.json')).verifierRegistry:pin.localVerifierRegistry;
const destination=testnet?'.perch-testnet-src':'.perch-src';
const marker=JSON.stringify(testnet?{pin,registry}:pin);
if(existsSync(`${destination}/.fee-pin`) && readFileSync(`${destination}/.fee-pin`,'utf8')===marker)process.exit(0);
if(existsSync(destination))throw Error('Existing .perch-src differs from pin. Remove that generated directory explicitly before rebuilding.');
const temp=mkdtempSync(join(tmpdir(),'nido-fee-perch-'));
try {
 let source=process.env.NIDO_FEE_PERCH_DIR;
 if(!source){source=join(temp,'source');execFileSync('git',['init','-q',source]);execFileSync('git',['-C',source,'fetch','--depth=1',pin.repository,pin.revision],{stdio:'inherit'});}
 const actual=execFileSync('git',['-C',source,'rev-parse',`${pin.revision}^{commit}`],{encoding:'utf8'}).trim();
 if(actual!==pin.revision)throw Error('Wrong Perch revision');
 const archive=join(temp,'perch.tar');
 execFileSync('git',['-C',source,'archive','--format=tar',`--output=${archive}`,pin.revision]);
 mkdirSync(destination);execFileSync('tar',['-xf',archive,'-C',destination]);
 // Local-chain registry only. Real Perch still checks a verifier's code hash
 // and its derived address; no runtime verifier-check bypass is introduced.
 writeFileSync(`${destination}/crates/perch-smart-account/wasm/verifiers.path`,
 `# Fee demo registry; production manifest and Nido parent pins unchanged.\nroot-deployer ${registry.rootDeployer}\nroot-salt ${registry.salt}\npath /\n`);
 writeFileSync(`${destination}/.fee-pin`,marker);
} finally {rmSync(temp,{recursive:true,force:true});}
