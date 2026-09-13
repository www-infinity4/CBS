(function(){
  "use strict";

  const catalog = Array.isArray(window.CBS_CATALOG) ? window.CBS_CATALOG : [];
  const $ = id => document.getElementById(id);
  const els = {
    clock:$("stationClock"), title:$("nowTitle"), mode:$("modeLabel"), programTime:$("programTime"),
    player:$("player"), enter:$("enterButton"), card:$("stationCard"), cardLabel:$("stationCardLabel"),
    cardTitle:$("stationCardTitle"), cardCountdown:$("stationCardCountdown"), startOver:$("startOverButton"),
    rewind:$("rewindButton"), live:$("liveButton"), share:$("shareButton"), shareStatus:$("shareStatus"),
    progress:$("progressBar"), position:$("positionLabel"), remaining:$("remainingLabel"),
    next:$("nextCards"), guide:$("guideRows"), guideDate:$("guideDate"), premium:$("premiumTargets")
  };

  let player=null, playerReady=false, apiRequested=false, entered=false;
  let schedule=[], scheduleKey="", loadedKey="", mode="live", shiftBaseMs=0, shiftStartMs=0;
  let sourceEnded=false;

  function hash(text){
    let value=2166136261;
    for(let i=0;i<text.length;i++) value=Math.imul(value^text.charCodeAt(i),16777619);
    return value>>>0;
  }

  function seededShuffle(items,seedText){
    const copy=items.slice(); let seed=hash(seedText);
    const random=()=>{ seed+=0x6D2B79F5; let t=seed; t=Math.imul(t^(t>>>15),t|1); t^=t+Math.imul(t^(t>>>7),t|61); return ((t^(t>>>14))>>>0)/4294967296; };
    for(let i=copy.length-1;i>0;i--){ const j=Math.floor(random()*(i+1)); [copy[i],copy[j]]=[copy[j],copy[i]]; }
    return copy;
  }

  function dateKey(ms){
    const d=new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  }

  function localMidnight(ms){
    const d=new Date(ms); d.setHours(0,0,0,0); return d.getTime();
  }

  function weekKey(ms){
    const d=new Date(ms), first=new Date(d.getFullYear(),0,1);
    const day=Math.floor((localMidnight(ms)-first.getTime())/86400000);
    return `${d.getFullYear()}-W${Math.floor(day/7)}`;
  }

  function smartOrder(ms){
    const shuffled=seededShuffle(catalog.filter(x=>x.cleared&&x.videoId),`CBS:${weekKey(ms)}:${dateKey(ms)}`);
    const result=[];
    while(shuffled.length){
      const previous=result[result.length-1];
      let pick=0;
      if(previous){
        const different=shuffled.findIndex(item=>item.category!==previous.category);
        if(different>=0) pick=different;
      }
      result.push(shuffled.splice(pick,1)[0]);
    }
    return result;
  }

  function makeSchedule(ms){
    const start=localMidnight(ms), end=start+86400000, order=smartOrder(ms), out=[];
    if(!order.length) return out;
    let cursor=start, i=0;
    while(cursor<end && i<order.length){
      const program=order[i++];
      const requested=Math.max(600,Number(program.slotSeconds)||3600);
      const seconds=Math.min(requested,Math.floor((end-cursor)/1000));
      out.push({id:`${dateKey(ms)}-${String(out.length).padStart(2,"0")}`,program,startsAtMs:cursor,endsAtMs:cursor+seconds*1000,seconds});
      cursor+=seconds*1000;
    }
    // If an unusually short catalog ever leaves a gap, cycle only after every unique program aired once.
    let cycle=0;
    while(cursor<end && order.length){
      const program=order[cycle++%order.length];
      const requested=Math.max(600,Number(program.slotSeconds)||3600);
      const seconds=Math.min(requested,Math.floor((end-cursor)/1000));
      out.push({id:`${dateKey(ms)}-${String(out.length).padStart(2,"0")}`,program,startsAtMs:cursor,endsAtMs:cursor+seconds*1000,seconds});
      cursor+=seconds*1000;
    }
    return out;
  }

  function ensureSchedule(ms){
    const key=dateKey(ms);
    if(key===scheduleKey) return;
    scheduleKey=key; schedule=makeSchedule(ms); loadedKey=""; sourceEnded=false;
    renderGuide();
  }

  function activeMs(){ return mode==="live" ? Date.now() : shiftBaseMs+(Date.now()-shiftStartMs); }
  function currentBlock(ms){ return schedule.find(x=>ms>=x.startsAtMs&&ms<x.endsAtMs) || schedule[schedule.length-1]; }
  function fmtTime(ms){ return new Intl.DateTimeFormat("en-US",{hour:"numeric",minute:"2-digit"}).format(new Date(ms)); }
  function fmtDuration(sec){ const m=Math.max(0,Math.ceil(sec/60)); return m>=60?`${Math.floor(m/60)}h ${m%60}m`:`${m} min`; }
  function art(program){ return program.posterUrl || `https://i.ytimg.com/vi/${program.videoId}/maxresdefault.jpg`; }
  function esc(value){ return String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

  function renderGuide(){
    if(!schedule.length) return;
    els.guideDate.textContent=new Intl.DateTimeFormat("en-US",{weekday:"long",month:"long",day:"numeric"}).format(new Date(schedule[0].startsAtMs));
    els.guide.innerHTML=schedule.map(item=>`<article class="guide-row" data-id="${item.id}" style="--guide-art:url('${art(item.program)}')"><time>${fmtTime(item.startsAtMs)}</time><div><strong>${esc(item.program.title)}</strong><span>${esc(item.program.collection)} · ${esc(item.program.source)}</span></div></article>`).join("");
  }

  function renderNext(block){
    if(!block) return;
    const index=schedule.findIndex(x=>x.id===block.id);
    els.next.innerHTML=[1,2,3].map(step=>{
      const item=schedule[(index+step)%schedule.length];
      return `<article class="next-card" style="--card-art:url('${art(item.program)}')"><time>${fmtTime(item.startsAtMs)}</time><div><h3>${esc(item.program.title)}</h3><p>${esc(item.program.collection)}</p></div></article>`;
    }).join("");
  }

  function renderPremium(){
    const targets=Array.isArray(window.CBS_PREMIUM_TARGETS)?window.CBS_PREMIUM_TARGETS:[];
    if(!els.premium || !targets.length) return;
    els.premium.innerHTML=targets.map(t=>`<article><strong>${esc(t.title)}</strong><span>${esc(t.note)}</span></article>`).join("");
  }

  function showCard(label,title,countdown){
    els.card.hidden=false; els.cardLabel.textContent=label; els.cardTitle.textContent=title; els.cardCountdown.textContent=countdown||"";
  }

  function hideCard(){ els.card.hidden=true; }

  function loadProgram(block,elapsed){
    if(!entered || !block) return;
    const program=block.program;
    const key=`${block.id}:${program.videoId}:${program.sourceStart||0}`;
    if(!playerReady) return;
    if(loadedKey!==key){
      loadedKey=key; sourceEnded=false; hideCard();
      player.loadVideoById({videoId:program.videoId,startSeconds:(Number(program.sourceStart)||0)+elapsed});
      return;
    }
    if(sourceEnded){
      showCard("CBS",program.title,"The complete source ended. Next scheduled program starts soon.");
      return;
    }
    if(mode==="live" && player.getPlayerState && player.getPlayerState()===YT.PlayerState.PLAYING){
      const target=(Number(program.sourceStart)||0)+elapsed;
      const drift=target-player.getCurrentTime();
      if(Math.abs(drift)>3) player.seekTo(target,true);
    }
  }

  function tick(){
    const now=activeMs(); ensureSchedule(now); const block=currentBlock(now); if(!block) return;
    const elapsed=Math.max(0,Math.floor((now-block.startsAtMs)/1000));
    const remaining=Math.max(0,Math.floor((block.endsAtMs-now)/1000));
    els.clock.textContent=`${fmtTime(Date.now())} local`;
    els.mode.textContent=mode==="live"?"LIVE CBS":"TIME SHIFTED";
    els.title.textContent=block.program.title;
    els.programTime.textContent=`${fmtTime(block.startsAtMs)}–${fmtTime(block.endsAtMs)}`;
    els.position.textContent=mode==="live"?"Synced to the station clock":`${fmtDuration(elapsed)} from start`;
    els.remaining.textContent=`${fmtDuration(remaining)} remaining`;
    els.progress.style.width=`${Math.min(100,(elapsed/block.seconds)*100)}%`;
    document.body.style.setProperty("--program-art",`url('${art(block.program)}')`);
    document.querySelectorAll(".guide-row").forEach(row=>row.classList.toggle("current",row.dataset.id===block.id));
    renderNext(block); loadProgram(block,elapsed);
  }

  function loadYouTube(){
    if(apiRequested||playerReady) return; apiRequested=true;
    if(window.YT&&window.YT.Player){ window.onYouTubeIframeAPIReady(); return; }
    const script=document.createElement("script"); script.src="https://www.youtube.com/iframe_api"; script.referrerPolicy="strict-origin-when-cross-origin"; document.head.appendChild(script);
  }

  function enter(){ entered=true; els.enter.hidden=true; loadYouTube(); tick(); }
  function startOver(){ const live=currentBlock(Date.now()); if(!live)return; mode="shift"; shiftBaseMs=live.startsAtMs; shiftStartMs=Date.now(); loadedKey=""; tick(); }
  function rewind(){ mode="shift"; shiftBaseMs=Math.max(localMidnight(Date.now()),activeMs()-30000); shiftStartMs=Date.now(); loadedKey=""; tick(); }
  function joinLive(){ mode="live"; loadedKey=""; sourceEnded=false; tick(); }

  function localShareCredit(reference){
    const attemptId=`cbs-share-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
    if(window.StarQuestAuth&&typeof window.StarQuestAuth.recordShare==="function"){
      try{ const result=window.StarQuestAuth.recordShare(reference,{attemptId,confirmed:true,verified:true,method:"web_share_api",url:reference,showTitle:document.title}); if(result&&result.ok)return result; }catch(_){ }
    }
    const parse=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))||fallback}catch(_){return fallback}};
    const session=parse("starquest_session",null), users=parse("starquest_users",{}), signed=session&&session.key&&users[session.key];
    const profile=signed||parse("starquest_guest_profile_v1",{key:"__guest__",username:"Guest",tokens:0,shareCount:0,pendingShareCredits:0,shareEvents:[],ledger:[]});
    profile.tokens=Math.max(0,Number(profile.tokens)||0); profile.shareCount=Math.max(0,Number(profile.shareCount)||0)+1; profile.pendingShareCredits=Math.max(0,Number(profile.pendingShareCredits)||0)+1;
    profile.shareEvents=Array.isArray(profile.shareEvents)?profile.shareEvents:[]; profile.ledger=Array.isArray(profile.ledger)?profile.ledger:[];
    profile.shareEvents.push({id:attemptId,attemptId,contentId:reference,method:"web_share_api",confirmed:true,verified:true,createdAt:Date.now()});
    let awarded=0; while(profile.pendingShareCredits>=10){profile.pendingShareCredits-=10;profile.tokens+=1;awarded+=1;}
    profile.ledger.push({id:`tx-${attemptId}`,type:awarded?"share_reward":"share_credit",amount:awarded,balance:profile.tokens,pendingShareCredits:profile.pendingShareCredits,reason:awarded?"Share reward: 10 completed shares":`Confirmed CBS share ${profile.pendingShareCredits}/10`,referenceId:attemptId,createdAt:Date.now()});
    if(signed){users[session.key]=profile;localStorage.setItem("starquest_users",JSON.stringify(users));}else localStorage.setItem("starquest_guest_profile_v1",JSON.stringify(profile));
    window.dispatchEvent(new CustomEvent("starquest:share-progress",{detail:{progressToNextCoin:profile.pendingShareCredits,awarded,balance:profile.tokens}}));
    return {ok:true,progressToNextCoin:profile.pendingShareCredits,awarded,balance:profile.tokens};
  }

  async function share(){
    const block=currentBlock(Date.now()), title=block?block.program.title:"CBS";
    const payload={title:`${title} · CBS`,text:`Watch ${title} on CBS.`,url:location.href};
    if(!navigator.share){ try{await navigator.clipboard.writeText(payload.url);els.shareStatus.textContent="Link copied. Android Share confirms the 1/10 StarCoin credit.";}catch(_){els.shareStatus.textContent="Sharing is unavailable in this browser.";} return; }
    try{await navigator.share(payload);const result=localShareCredit(payload.url);els.shareStatus.textContent=result.awarded?"Shared · 1 StarCoin completed!":`Shared · StarCoin progress ${result.progressToNextCoin}/10`;}
    catch(error){if(!error||error.name!=="AbortError")els.shareStatus.textContent="Share did not complete.";}
  }

  window.onYouTubeIframeAPIReady=function(){
    player=new YT.Player("player",{
      width:"100%",height:"100%",playerVars:{playsinline:1,controls:1,enablejsapi:1,rel:0,origin:location.origin,widget_referrer:location.href},
      events:{
        onReady:()=>{playerReady=true;player.unMute();player.setVolume(100);tick();},
        onStateChange:event=>{if(event.data===YT.PlayerState.ENDED)sourceEnded=true;},
        onError:()=>{const block=currentBlock(activeMs());showCard("SOURCE UNAVAILABLE",block?block.program.title:"CBS","This official source cannot play in the embedded player right now. The station will continue with the next scheduled program.");}
      }
    });
  };

  els.enter.addEventListener("click",enter); els.startOver.addEventListener("click",startOver); els.rewind.addEventListener("click",rewind); els.live.addEventListener("click",joinLive); els.share.addEventListener("click",share);
  renderPremium(); ensureSchedule(Date.now()); tick(); setInterval(tick,1000);
})();
