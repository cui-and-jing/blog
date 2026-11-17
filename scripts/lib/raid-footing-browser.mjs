/** Observe real jumps, platform descent and pit approach through native inputs. */
import fs from 'node:fs';
import path from 'node:path';
export async function checkRaidFooting(sourcePage, problems) {
  for (const mobile of [false, true]) {
    const context = await sourcePage.browser().createBrowserContext(), page = await context.newPage();
    const held = new Map(), label = mobile ? 'touch-320-reduced' : 'keyboard-1280';
    const keys = { jump: 'w', right: 'd', down: 's', shoot: 'j' };
    let step = 'initialization';
    const wait = async (name, predicate) => { step = name;await page.waitForFunction(predicate, { polling: 'raf', timeout: 7000 }); };
    const down = async action => {
      if (held.has(action)) return;
      if (mobile) {
        const p = await page.$eval(`[data-action="${action}"]`, el => {
          el.scrollIntoView({ block: 'end' });const r = el.getBoundingClientRect();return { x:r.x+r.width/2,y:r.y+r.height/2 };
        });held.set(action, await page.touchscreen.touchStart(p.x,p.y));
      } else { await page.keyboard.down(keys[action]);held.set(action,true); }
    };
    const up = async action => {
      if (!held.has(action)) return;
      if (mobile) await held.get(action).end();else await page.keyboard.up(keys[action]);held.delete(action);
    };
    const activate = async selector => {
      const button=await page.$(selector);await button.scrollIntoView();
      if(mobile)await button.tap();else{await button.focus();await page.keyboard.press('Enter');}
    };
    try {
      await page.setViewport({width:mobile?320:1280,height:mobile?844:960,isMobile:mobile,hasTouch:mobile,deviceScaleFactor:1});
      await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:mobile?'reduce':'no-preference'}]);
      await page.evaluateOnNewDocument(() => {
        window.__footingEvidence=[];
        const observe=()=>{
          const s=window.__raidState,t=s?.footingGuide;
          if(t){
            const canvas=document.getElementById('field'),c=canvas.getContext('2d');
            const x=Math.round(t.x-s.cam)-14,y=t.y-14;
            if(x>=0&&x+28<=canvas.width){
              const pixels=c.getImageData(x,y,28,14).data;let blue=0,orange=0;
              for(let i=0;i<pixels.length;i+=4){
                if(pixels[i]===162&&pixels[i+1]===233&&pixels[i+2]===255)blue++;
                if(pixels[i]===255&&pixels[i+1]===208&&pixels[i+2]===154)orange++;
              }
              const samples=window.__footingEvidence;
              samples.push({x:s.x,y:s.y,h:s.playerHeight,ground:s.ground,drop:s.dropTime,guide:t,blue,orange});
              if(samples.length>2500)samples.shift();
            }
          }
          requestAnimationFrame(observe);
        };requestAnimationFrame(observe);
      });
      await page.goto(sourcePage.url(),{waitUntil:'domcontentloaded'});await page.bringToFront();
      await wait('ready',()=>window.__raidReady);await activate('#start');
      await down('jump');await wait('floor projection',()=>window.__footingEvidence.some(s=>s.guide.kind==='floor'&&s.blue>=80));
      await page.screenshot({path:path.join(process.cwd(),'.shots',`pixelraid-footing-${label}.png`),fullPage:true});
      await up('jump');await wait('first landing',()=>window.__raidState.ground&&!window.__raidState.footingGuide);
      await down('shoot');await down('right');await wait('approach platform',()=>window.__raidState.x>=440);await down('jump');
      await wait('over platform',()=>window.__raidState.x>=520);await up('right');
      await wait('platform projection',()=>window.__footingEvidence.some(s=>s.guide.kind==='platform'&&s.guide.y===325&&s.blue>=80));
      await up('jump');await wait('land on platform',()=>window.__raidState.ground&&window.__raidState.y+window.__raidState.playerHeight===325);
      await down('down');await down('jump');
      await wait('drop-through projection',()=>window.__footingEvidence.some(s=>s.drop>0&&s.guide.kind==='floor'&&s.blue>=80));
      await up('jump');await up('down');await wait('floor after descent',()=>window.__raidState.ground&&window.__raidState.y+window.__raidState.playerHeight===425);
      await down('right');await wait('approach pit',()=>window.__raidState.x>=790);await down('jump');
      await wait('above pit',()=>window.__raidState.x>=844);await up('right');
      await wait('pit warning',()=>window.__footingEvidence.some(s=>s.guide.kind==='gap'&&s.orange>=30));
      await up('jump');await up('shoot');
      const evidence=await page.evaluate(()=>window.__footingEvidence);
      fs.writeFileSync(path.join(process.cwd(),'.shots',`pixelraid-footing-${label}.json`),JSON.stringify(evidence,null,2));
      // A real pause clears the marker immediately, without changing the floor.
      await activate('#pause');await wait('pause hides projection',()=>window.__raidState.phase==='pause'&&!window.__raidState.footingGuide);
    } catch(error){problems.push(`Pixel Raid 脚下地形 ${label} / ${step}: ${error.message}`);}
    finally {for(const action of [...held.keys()])await up(action).catch(()=>{});await context.close();}
  }
}
