import { cpSync, mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { demoConfig } from '../src/demo-config.mjs';
const number=process.env.FEE_PREVIEW_NUMBER;
if(!number)throw Error('FEE_PREVIEW_NUMBER is required');
const config=demoConfig(number);
const backup=mkdtempSync(join(tmpdir(),'nido-runtime-'));
cpSync('public/runtime',join(backup,'runtime'),{recursive:true});
try {
  execFileSync('node',['scripts/build-runtime.mjs'],{stdio:'inherit',env:{...process.env,FEE_PREVIEW_NUMBER:number}});
  execFileSync('node',['node_modules/vite/bin/vite.js','build'],{stdio:'inherit',env:{...process.env,VITE_FEE_PREVIEW_NUMBER:number}});
  const out=resolve(process.env.FEE_PREVIEW_OUT || '../../packages/frontend/dist/fee-demo');
  mkdirSync(out,{recursive:true});cpSync('dist',out,{recursive:true});
  writeFileSync(join(out,'budget-wallet.html'),`<!doctype html><html lang="en"><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${config.appOrigin}/fees/"><title>Continue in Nido</title><a href="${config.appOrigin}/fees/">Local fees now live in your Nido wallet. Continue in Nido.</a></html>`);
  console.log(`Testnet demo built for PR ${number}: ${out}`);
} finally {
  cpSync(join(backup,'runtime'),'public/runtime',{recursive:true});
  rmSync(backup,{recursive:true,force:true});
}
