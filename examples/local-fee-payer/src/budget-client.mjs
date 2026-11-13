import { APP_ORIGIN, WALLET_ORIGIN, expectedMessage } from './wallet-protocol.mjs';
let current;
const status=document.getElementById('local-budget-message');
document.getElementById('open-budget-wallet').onclick=()=>{
  if(location.origin!==APP_ORIGIN){status.textContent='Open the app at http://localhost:5198/';return;}
  if(current&&!current.window.closed){current.window.focus();return;}
  const requestId=crypto.randomUUID();
  const windowRef=window.open(`${WALLET_ORIGIN}/budget-wallet.html#${requestId}`,`nido-budget-${requestId}`,'popup,width=780,height=980');
  if(!windowRef){status.textContent='Allow the wallet popup to continue.';return;}
  current={requestId,window:windowRef};status.textContent='The wallet is reviewing the fixed intent. Keys and refill decisions stay there.';
};
window.addEventListener('message',event=>{
  if(!current||!expectedMessage(event,WALLET_ORIGIN,current.window,current.requestId))return;
  if(event.data.kind==='wallet-ready')current.window.postMessage({kind:'wallet-request',requestId:current.requestId,request:{kind:'try-local-budget'}},WALLET_ORIGIN);
  if(event.data.kind==='budget-result'&&event.data.ok){status.textContent='Confirmed on the isolated local ledger. Open the wallet for the refill ledger and receipts.';status.dataset.confirmed='true';}
});
