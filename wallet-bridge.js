(function(){
  'use strict';
  const share=document.getElementById('shareButton');
  const status=document.getElementById('shareStatus');
  const walletButton=document.getElementById('walletButton');
  const walletUrl='https://www-infinity4.github.io/Mint-For-Infinity/unified-wallet.html';
  let queue=Promise.resolve();

  function engine(){
    if(!window.InfinityUnifiedWallet?.UnifiedInfinityWallet)throw new Error('Unified wallet did not load.');
    return new window.InfinityUnifiedWallet.UnifiedInfinityWallet();
  }
  function current(w){
    const id=w.state.currentWalletId;
    return id&&w.state.wallets[id]?w.state.wallets[id]:null;
  }
  function render(){
    if(!walletButton)return;
    try{
      const w=engine(),connected=current(w);
      walletButton.textContent=connected?`Wallet · ${w.balance(connected.walletId,'STAR_COIN').toFixed(1)} ⭐`:'Connect Wallet';
      walletButton.dataset.unifiedWallet='1';
    }catch(_){walletButton.textContent='Wallet unavailable';}
  }
  function exclusive(fn){
    const run=()=>navigator.locks?navigator.locks.request('cbs-tv-unified-wallet',fn):fn();
    const p=queue.then(run,run);queue=p.catch(()=>{});return p;
  }
  async function rewardShare(method){
    return exclusive(async()=>{
      const w=engine();
      let connected=current(w);
      if(!connected)connected=w.createWallet({displayName:'Unified Infinity Wallet'});
      const rewardId='share-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,9);
      const result=await w.creditStarCoinReward({
        walletId:connected.walletId,
        gameId:'CBS',
        rewardKind:'GAME_SHARED',
        rewardId,
        proof:{method,url:location.href,title:document.getElementById('nowTitle')?.textContent||'CBS',verification:'DEVICE_LOCAL'}
      });
      render();
      return result;
    });
  }
  async function handleShare(event){
    if(!share||!event.target.closest('#shareButton'))return;
    event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();
    const now=document.getElementById('nowTitle');
    const title=now&&now.textContent&&!now.textContent.includes('Loading')?now.textContent:'CBS';
    const payload={title:`${title} · CBS`,text:`Watch ${title} on CBS.`,url:location.href};
    try{
      if(navigator.share){
        await navigator.share(payload);
        const result=await rewardShare('native-share');
        if(status)status.textContent=result.credited?`Shared · +0.1 StarCoin · Wallet ${Number(result.balance||0).toFixed(1)} ⭐`:'Shared · wallet already recorded this reward.';
      }else{
        await navigator.clipboard.writeText(payload.url);
        if(status)status.textContent='Link copied. A confirmed share is required before a StarCoin reward.';
      }
    }catch(error){
      if(status)status.textContent=error&&error.name==='AbortError'?'Share canceled. No reward added.':'Share or wallet save did not complete.';
    }
  }

  document.addEventListener('click',handleShare,true);
  if(walletButton){
    walletButton.addEventListener('click',function(){
      try{
        const w=engine();
        if(!current(w)){w.createWallet({displayName:'Unified Infinity Wallet'});render();return;}
        location.href=walletUrl;
      }catch(_){location.href=walletUrl;}
    });
  }
  window.addEventListener('storage',render);
  window.addEventListener('focus',render);
  render();
})();
