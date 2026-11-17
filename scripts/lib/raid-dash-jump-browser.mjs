/** Native dash -> jump cancel, short/full arcs, then dash -> platform descent. */
import fs from 'node:fs';
import path from 'node:path';
export async function checkRaidDashJump(sourcePage,problems){
  for(const mobile of [false,true])for(const short of [false,true]){
    const context=await sourcePage.browser().createBrowserContext(),page=await context.newPage(),held=new Map();
    const label=(mobile?'touch-320':'keyboard-1280')+(short?'-short':'-full');
    const keys={right:'d',jump:'w',dash:'Shift',fire:'j',down:'s'};let step='initialization';
    const require=(ok,message,detail)=>{if(!ok)throw new Error(message+' '+JSON.stringify(detail??''));};
    const wait=async(name,predicate)=>{step=name;await page.waitForFunction(predicate,{polling:'raf',timeout:6000});};
    const down=async action=>{
      if(held.has(action))return;
      if(mobile){const p=await page.$eval(`[data-action="${action}"]`,el=>{
        el.closest('.controls').scrollIntoView({block:'end',behavior:'instant'});const r=el.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};
      });held.set(action,await page.touchscreen.touchStart(p.x,p.y));}
      else{await page.keyboard.down(keys[action]);held.set(action,true);}
    };
    const up=async action=>{if(!held.has(action))return;if(mobile)await held.get(action).end();else await page.keyboard.up(keys[action]);held.delete(action);};
    const file=suffix=>path.join(process.cwd(),'.shots',`pixelraid-dash-jump-${label}-${suffix}`);
    try{
      await page.setViewport({width:mobile?320:1280,height:mobile?844:960,isMobile:mobile,hasTouch:mobile,deviceScaleFactor:1});
      await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:mobile?'reduce':'no-preference'}]);
      await page.evaluateOnNewDocument(()=>{
        const proof=window.__dashJumpProof={inputs:[],dash:null,cancel:null,flight:[],landed:null,drop:null,dropLanding:null};
        const images=window.__dashJumpImages={};let previous;
        const capture=name=>{images[name]=document.getElementById('field').toDataURL('image/png').split(',')[1];};
        for(const type of ['keydown','keyup','pointerdown','pointerup','pointercancel'])document.addEventListener(type,event=>{
          const target=event.target.closest?.('[data-action]');proof.inputs.push({type,key:event.key,action:target?.dataset.action,trusted:event.isTrusted});
        },true);
        const observe=()=>{
          const s=window.__raidState;
          if(s?.phase==='playing'&&previous?.phase==='playing'){
            if(!proof.dash&&s.dashTime>0&&s.ground)proof.dash=s;
            if(!proof.cancel&&previous.dashTime>0&&s.dashTime===0&&s.vy<0&&s.jumpCutEligible){proof.cancel={before:previous,after:s};capture('cancel');}
            if(proof.cancel&&!proof.landed){
              proof.flight.push({clock:s.clock,y:s.y,height:s.playerHeight,vy:s.vy,dashTime:s.dashTime,ground:s.ground});
              if(previous.vy<0&&s.vy>=0)capture('apex');if(s.ground){proof.landed=s;capture('landing');}
            }
            if(proof.landed&&!proof.drop&&previous.dashTime>0&&s.dashTime===0&&s.dropTime>0){proof.drop={before:previous,after:s};capture('drop');}
            if(proof.drop&&!proof.dropLanding&&s.ground){proof.dropLanding=s;capture('drop-landing');}
          }
          previous=s;requestAnimationFrame(observe);
        };requestAnimationFrame(observe);
      });
      await page.goto(sourcePage.url(),{waitUntil:'domcontentloaded'});await page.bringToFront();await wait('ready',()=>window.__raidReady);
      const start=await page.$('#start');await start.scrollIntoView();if(mobile)await start.tap();else{await start.focus();await page.keyboard.press('Enter');}
      await wait('playing',()=>window.__raidState.phase==='playing');
      await down('right');await down('dash');await wait('active ground dash',()=>window.__raidState.dashTime>0&&window.__raidState.ground);
      await down('jump');await wait('jump cancels active dash',()=>window.__dashJumpProof.cancel);
      if(short)await up('jump');await up('dash');await up('right');
      await wait('ordinary landing',()=>window.__dashJumpProof.landed);await up('jump');
      const first=await page.evaluate(()=>window.__dashJumpProof),{before,after}=first.cancel;
      require(first.dash.dashCooldown>2.2&&before.ground&&before.dashTime>0&&after.dashTime===0&&!after.dashDive&&!after.ground&&after.vy<0,'not an active ground dash cancel',first.cancel);
      require(Math.abs(after.dashCooldown-(before.dashCooldown-(after.clock-before.clock)))<.00001&&after.dashCooldown>2&&after.protectionTime<=before.protectionTime,'cancel changed spent cooldown or protection',first.cancel);
      for(const key of ['hp','lives','score','grenades','shots','stomps','reflections'])require(before[key]===after[key],'cancel changed '+key,first.cancel);
      const feet=Math.min(...first.flight.map(s=>s.y+s.height)),rise=425-feet;
      require(short?rise>20&&rise<70:rise>100&&rise<110,'short/full arc incorrect',{short,rise});
      require(first.flight.every(s=>s.dashTime===0)&&first.landed.y+first.landed.playerHeight===425&&first.landed.stomps===0,'dash restarted or wrong landing',first.landed);
      // Only full-hop runs continue to the platform; short-hop runs independently
      // cover both input methods without making their timing depend on combat.
      if(!short){
        await down('fire');await down('right');await wait('platform approach',()=>window.__raidState.x>=440);await down('jump');
        await wait('over platform',()=>window.__raidState.x>=520);await up('right');
        await wait('land on platform',()=>window.__raidState.ground&&window.__raidState.y+window.__raidState.playerHeight===325);await up('jump');
        await wait('dash cooled',()=>window.__raidState.dashCooldown===0);await down('down');await down('dash');
        await wait('active platform dash',()=>window.__raidState.dashTime>0&&window.__raidState.ground);await down('jump');
        await wait('cancel into descent',()=>window.__dashJumpProof.drop);await up('jump');await up('dash');await up('down');await up('fire');
        await wait('descent landing',()=>window.__dashJumpProof.dropLanding);
        const proof=await page.evaluate(()=>window.__dashJumpProof),a=proof.drop.before,b=proof.drop.after;
        require(a.y+a.playerHeight===325&&b.dropTime>0&&b.vy>0&&b.dashTime===0&&!b.dashDive&&!b.jumpCutEligible,'platform cancel did not descend',proof.drop);
        require(Math.abs(b.dashCooldown-a.dashCooldown+b.clock-a.clock)<.00001&&b.dashCooldown>2&&b.lives===a.lives,'platform cancel changed cooldown/lives',proof.drop);
        require(proof.dropLanding.y+proof.dropLanding.playerHeight===425,'descent returned to ignored ledge',proof.dropLanding);
      }
      require(await page.evaluate(()=>window.__dashJumpProof.inputs.every(e=>e.trusted)),'synthetic gameplay input');
      await page.screenshot({path:file('page.png'),fullPage:true});
    }catch(error){problems.push(`Pixel Raid 冲刺接跳 ${label} / ${step}: ${error.message}`);}
    finally{
      const data=await page.evaluate(()=>({proof:window.__dashJumpProof,images:window.__dashJumpImages,state:window.__raidState})).catch(()=>null);
      if(data){for(const[name,image]of Object.entries(data.images||{}))fs.writeFileSync(file(name+'.png'),Buffer.from(image,'base64'));delete data.images;fs.writeFileSync(file('route.json'),JSON.stringify(data,null,2));}
      for(const action of [...held.keys()])await up(action).catch(()=>{});await context.close();
    }
  }
}
