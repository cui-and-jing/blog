/** A real rifle hit -> spent dash -> lethal stomp -> chosen air dash, no hooks. */
import fs from 'node:fs';
import path from 'node:path';
import { campaignStompDamageAllowed } from './raid-campaign-stomp-browser.mjs';
export async function checkRaidStompRefill(sourcePage, problems) {
  for (const mobile of [false,true]) {
    const context=await sourcePage.browser().createBrowserContext(),page=await context.newPage(),held=new Map();
    const label=mobile?'touch-320':'keyboard-1280',keys={left:'a',right:'d',jump:'w',fire:'j',dash:'Shift'};
    let step='initialization';
    const require=(ok,message,detail)=>{if(!ok)throw new Error(message+' '+JSON.stringify(detail??''));};
    const wait=async(name,predicate)=>{step=name;await page.waitForFunction(predicate,{polling:'raf',timeout:6000});};
    const down=async action=>{
      if(held.has(action))return;
      if(mobile){
        const p=await page.$eval(`[data-action="${action}"]`,el=>{
          el.closest('.controls').scrollIntoView({block:'end',behavior:'instant'});const r=el.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};
        });held.set(action,await page.touchscreen.touchStart(p.x,p.y));
      }else{await page.keyboard.down(keys[action]);held.set(action,true);}
    };
    const up=async action=>{if(!held.has(action))return;if(mobile)await held.get(action).end();else await page.keyboard.up(keys[action]);held.delete(action);};
    const file=suffix=>path.join(process.cwd(),'.shots',`pixelraid-stomp-refill-${label}-${suffix}`);
    try {
      await page.setViewport({width:mobile?320:1280,height:mobile?844:960,isMobile:mobile,hasTouch:mobile,deviceScaleFactor:1});
      await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
      await page.evaluateOnNewDocument(()=>{
        const proof=window.__refillProof={inputs:[],spent:null,impact:null,followup:null},canvases=window.__refillCanvases={};let previous;
        for(const type of ['keydown','keyup','pointerdown','pointerup','pointercancel'])document.addEventListener(type,event=>{
          const target=event.target.closest?.('[data-action]');proof.inputs.push({type,key:event.key,action:target?.dataset.action,trusted:event.isTrusted});
        },true);
        const capture=name=>{if(!canvases[name])canvases[name]=document.getElementById('field').toDataURL('image/png').split(',')[1];};
        const observe=()=>{
          const s=window.__raidState;
          if(s?.phase==='playing'&&previous?.phase==='playing'){
            if(!proof.spent&&s.dashTime>0)proof.spent=s;
            if(!proof.impact&&s.stomps>previous.stomps){
              const burst=s.stompBurst,canvas=document.getElementById('field');let labelPixels=0;
              if(burst){
                const pixels=canvas.getContext('2d').getImageData(Math.floor(burst.x-s.cam+30),Math.floor(burst.y+10),95,17).data;
                for(let i=0;i<pixels.length;i+=4)if(pixels[i]===185&&pixels[i+1]===255&&pixels[i+2]===226)labelPixels++;
              }
              proof.impact={before:previous,after:s,labelPixels,hud:document.getElementById('dash-status').textContent,ready:document.getElementById('dash-control').dataset.ready};capture('impact');
            }
            if(proof.impact&&!proof.followup&&s.dashTime>0){proof.followup=s;capture('followup');}
          }
          previous=s;requestAnimationFrame(observe);
        };requestAnimationFrame(observe);
      });
      await page.goto(sourcePage.url(),{waitUntil:'domcontentloaded'});await page.bringToFront();await wait('ready',()=>window.__raidReady);
      const start=await page.$('#start');await start.scrollIntoView();if(mobile)await start.tap();else{await start.focus();await page.keyboard.press('Enter');}
      await wait('playing',()=>window.__raidState.phase==='playing');
      await down('fire');await wait('single rifle shot',()=>window.__raidState.shots>=1);await up('fire');
      await wait('rifle weakens walker',()=>window.__raidState.enemies[0].type==='walker'&&window.__raidState.enemies[0].hp===2);
      await down('dash');await wait('spend dash',()=>window.__refillProof.spent);await up('dash');
      await wait('dash ends',()=>window.__raidState.dashTime===0);
      await down('right');await wait('takeoff position',()=>window.__raidState.x>=280);await down('jump');
      const deadline=Date.now()+6000;
      for(;;){
        step='native alignment for lethal stomp';require(Date.now()<deadline,'alignment timed out');
        const direction=held.has('right')?'right':held.has('left')?'left':null;
        const handle=await page.waitForFunction(current=>{
          const s=window.__raidState;if(window.__refillProof.impact)return{impact:true};if(s.phase!=='playing')return{error:s.phase};
          const e=s.enemies[0],dx=e.x+e.w/2-s.x-13.5,desired=dx>10?'right':dx< -10?'left':null;
          return desired!==current?{desired}:false;
        },{polling:'raf',timeout:5000},direction);
        const next=await handle.jsonValue();await handle.dispose();require(!next.error,'left combat',next);
        if(next.impact)break;
        if(next.desired!=='left')await up('left');if(next.desired!=='right')await up('right');
        if(await page.evaluate(()=>window.__raidState.stomps>0))break;if(next.desired)await down(next.desired);
      }
      await up('left');await down('right');await down('dash');await wait('fresh air dash',()=>window.__refillProof.followup);
      await up('dash');await up('right');await up('jump');
      const proof=await page.evaluate(()=>window.__refillProof),{before,after,labelPixels,hud,ready}=proof.impact,follow=proof.followup;
      require(proof.spent.dashCooldown>2.2&&before.dashCooldown>.2&&after.dashCooldown===0&&after.dashTime===0&&after.dashBuffer===0,'no earned cooldown refill',proof);
      require(before.enemies[0].type==='walker'&&before.enemies[0].hp===2&&after.enemies.length===before.enemies.length-1&&after.stomps===1&&after.stompBurst?.dashRefilled,'not a lethal physical stomp',proof.impact);
      require(after.vy<0&&!after.ground&&after.score===before.score+100&&after.shots===1&&after.lives===before.lives&&after.grenades===before.grenades&&after.reflections===before.reflections&&campaignStompDamageAllowed(before,after,.28-after.stompBurst.time),'stomp altered rewards damage or protection',proof.impact);
      require(hud==='就绪'&&ready==='true'&&labelPixels>=20,'missing actual refill feedback',{hud,ready,labelPixels});
      require(!follow.ground&&follow.dashTime>0&&follow.dashCooldown>2.2&&follow.face===1&&follow.x>after.x&&follow.stomps===1,'fresh input did not spend one new air dash',follow);
      require(proof.inputs.every(e=>e.trusted),'untrusted gameplay input');
      await page.screenshot({path:file('page.png'),fullPage:true});
    }catch(error){problems.push(`Pixel Raid 踏击回充 ${label} / ${step}: ${error.message}`);}
    finally{
      const data=await page.evaluate(()=>({proof:window.__refillProof,canvases:window.__refillCanvases,state:window.__raidState})).catch(()=>null);
      if(data){for(const[name,image]of Object.entries(data.canvases||{}))fs.writeFileSync(file(name+'.png'),Buffer.from(image,'base64'));delete data.canvases;fs.writeFileSync(file('route.json'),JSON.stringify(data,null,2));}
      for(const action of [...held.keys()])await up(action).catch(()=>{});await context.close();
    }
  }
}
