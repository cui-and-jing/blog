/** Real browser: skill controls, live mobile layout and combat, no state writes. */
import path from 'node:path';
import { survivalTactics } from './raid-survival-tactics.mjs';

export async function checkRaidTactical(page, problems) {
  const read=()=>page.evaluate(()=>({...window.__raidState}));
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const check=(ok,message,state)=>{if(!ok)problems.push('Pixel Raid 主动技：'+message+(state?' '+JSON.stringify(state):''));};
  const phase=value=>page.waitForFunction(value=>window.__raidState?.phase===value,{timeout:4000},value);
  const activate=async selector=>{
    await page.$eval(selector,e=>e.scrollIntoView({block:'center'}));
    if((await page.viewport()).hasTouch)await (await page.$(selector)).tap();else await page.click(selector);
  };
  for(const [kit,width,height] of [['assault',1280,960],['counter',390,844],['demolition',844,390]]) {
    await page.setViewport({width,height,isMobile:width!==1280,hasTouch:width!==1280});
    await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__raidReady===true);
    await activate('#mode-survival');await activate('#loadout-'+kit);await activate('#start');await phase('playing');
    const records=(await read()).progress;
    await page.keyboard.press('e');await wait(80);
    check((await read()).tacticalUses===0,'增援预告提前释放技能');
    await page.keyboard.press('p');await phase('pause');
    for(const w of [320,360,375,390,844]) {
      await page.setViewport({width:w,height:w===844?390:844,isMobile:true,hasTouch:true});
      const boxes=await page.evaluate(()=>({
        width:innerWidth,scroll:document.documentElement.scrollWidth,
        controls:[...document.querySelectorAll('#tactical-use,.controls button')].map(e=>{
          const r=e.getBoundingClientRect();return {id:e.id||e.dataset.action,w:r.width,h:r.height,x:r.x,right:r.right};
        }),text:document.querySelector('#tactical-status').textContent,
      }));
      check(boxes.scroll<=boxes.width+1&&boxes.controls.every(r=>r.w>=42&&r.h>=44&&r.x>=0&&r.right<=boxes.width+1),
        '窄屏或横屏技能条、原有操作键溢出/过小：'+w,boxes);
      check(boxes.text.includes('能量保留'),'暂停时技能状态文案错误',boxes);
      if(kit==='counter'&&w===320)await page.screenshot({path:path.join(process.cwd(),'.shots','pixelraid-tactical-layout-320.png'),fullPage:true});
    }
    await page.setViewport({width,height,isMobile:width!==1280,hasTouch:width!==1280});
    await activate('#start');await phase('playing');
    await page.waitForFunction(()=>window.__raidState?.spawnTime===0,{timeout:5000});
    if(kit==='assault')await page.keyboard.press('e');
    else {
      // A second touch on the skill must work while fire remains held. This
      // exercises real pointer capture and touch cancellation, not DOM clicks.
      await page.$eval('#tactical-use',e=>e.scrollIntoView({block:'center'}));
      const points=await page.evaluate(()=>['[data-action="fire"]','#tactical-use'].map((s,id)=>{
        const r=document.querySelector(s).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,id:id+1};
      }));
      const client=await page.createCDPSession();
      try {
        await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[points[0]]});
        await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:points});
        await wait(100);
        await client.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
      } finally {await client.detach();}
    }
    await page.waitForFunction(()=>window.__raidState?.tacticalUses===1,{timeout:3000});
    const used=await read();check(used.tacticalCharge===0&&used.touchCount===0,'消费能量或取消多点触摸未释放',used);
    check(used.tacticalTime>(kit==='assault'?5:kit==='counter'?2: -1),'持续技能未激活',used);
    await page.screenshot({path:path.join(process.cwd(),'.shots','pixelraid-tactical-'+kit+'-'+width+'.png'),fullPage:true});
    await page.keyboard.press('p');await phase('pause');
    const frozen=await read();await wait(200);await activate('#tactical-use');await page.keyboard.press('e');
    check(JSON.stringify(await read())===JSON.stringify(frozen),'暂停后技能耗时、重复释放或残留触控');
    await activate('#restart');await phase('confirmRestart');await activate('#cancel-restart');await phase('pause');
    check(JSON.stringify(await read())===JSON.stringify(frozen),'取消重开丢失技能状态');
    await activate('#start');await phase('playing');
    const decide=survivalTactics();let moving='',jumping=false;
    await page.keyboard.down('j');const deadline=Date.now()+45000;
    try {
      while(Date.now()<deadline) {
        const state=await read();if(state.phase!=='playing')break;
        const input=decide(state);
        if(moving!==input.move){if(moving)await page.keyboard.up(moving);moving=input.move;if(moving)await page.keyboard.down(moving);}
        if(input.jump&&state.ground){if(jumping)await page.keyboard.up('w');await page.keyboard.down('w');jumping=true;}
        else if(!input.jump&&jumping){await page.keyboard.up('w');jumping=false;}
        if(input.dash)await page.keyboard.press('l');if(input.grenade)await page.keyboard.press('k');
        await wait(80);
      }
    }finally{for(const key of ['j','a','d','w','e'])await page.keyboard.up(key);}
    const cleared=await read();
    check(cleared.phase==='waveClear'&&cleared.survivalCleared===1&&cleared.tacticalUses===1&&cleared.tacticalTime===0,
      '使用技能后真实操作未完成首波或效果跨越清场：'+kit,cleared);
    check(Object.keys(records).filter(key=>key!=='survival').every(key=>JSON.stringify(records[key])===JSON.stringify(cleared.progress[key])),
      '技能污染其他玩法的记录');
    if(cleared.phase!=='waveClear')continue;
    await activate('#supply-0');await activate('#start');await phase('playing');
    check((await read()).tacticalCharge===cleared.tacticalCharge,'波间丢失或凭空补满能量');
    await activate('#restart');await phase('confirmRestart');await activate('#start');await phase('playing');
    const restarted=await read();check(restarted.tacticalCharge===100&&restarted.tacticalUses===0,'重开没有重置技能');
  }
  await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__raidReady===true);
}
