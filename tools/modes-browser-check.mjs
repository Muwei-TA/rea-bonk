import assert from 'node:assert/strict';
import { createAccountCheck } from './account-browser-check.mjs';
let current;
const check = await createAccountCheck('modes');
try {
 for(const mode of ['classic','arrow','deatharrows','grapple','vtol','football']) {
  const a=await check.newPage(), b=await check.newPage();current={a,b};
  async function guest(c,name){await check.click(c,'guestOrAccountContainer_guestButton');await check.fill(c,'guest_nametext',name);await check.click(c,'guestPlayButton');await check.wait(()=>check.evaluate(c,`return w.__localBonk.context[61].userName===${JSON.stringify(name)};`),'guest');}
  await guest(a,'Mode_'+mode+'_A');await guest(b,'Mode_'+mode+'_B');
  for(const id of ['pretty_playbutton','sm_gameChoiceCustom','roomlistcreatebutton'])await check.click(a,id);
  const roomName='Mode '+mode+' '+Date.now().toString(36);await check.fill(a,'roomlistcreatewindowgamename',roomName);await check.click(a,'roomlistcreatecreatebutton');await check.wait(()=>check.evaluate(a,"return w.getComputedStyle(d.getElementById('newbonklobby')).visibility==='visible';"),'host lobby');await check.delay(500);
  await check.click(b,'pretty_playbutton');await check.click(b,'sm_gameChoiceCustom');await check.click(b,'roomlistrefreshbutton');
  await check.wait(async()=>{await check.click(b,'roomlistrefreshbutton');return check.evaluate(b,`return [...d.querySelectorAll('#roomlisttable tr')].some(e=>e.innerText.includes(${JSON.stringify(roomName)}));`);},'room listed');
  await check.evaluate(b,`[...d.querySelectorAll('#roomlisttable tr')].find(e=>e.innerText.includes(${JSON.stringify(roomName)})).click();`);await check.click(b,'roomlistjoinbutton');
  await check.click(a,'newbonklobby_modebutton');await check.click(a,'newbonklobby_mode_'+mode);
  const label=await check.evaluate(a,"return d.getElementById('newbonklobby_modetext').textContent;");
  await check.wait(()=>check.evaluate(b,`return d.getElementById('newbonklobby_modetext').textContent===${JSON.stringify(label)};`),'mode synced');
  if(mode==='football'){await check.click(a,'newbonklobby_bluebutton');await check.click(b,'newbonklobby_redbutton');}
  if(mode!=='football'){await check.click(a,'newbonklobby_mapbutton');await check.click(a,'maploadtypedropdowntitle');await check.click(a,'maploadtypedropdownoption11');await check.wait(()=>check.evaluate(a,"return [...d.querySelectorAll('#maploadwindowmapscontainer .maploadwindowtextname_picks')].some(e=>e.textContent==='Classic');"),'stable map');await check.evaluate(a,"[...d.querySelectorAll('#maploadwindowmapscontainer .maploadwindowtextname_picks')].find(e=>e.textContent==='Classic').parentElement.click();");}
  await check.click(a,'newbonklobby_startbutton');
  for(const c of [a,b])await check.wait(()=>check.evaluate(c,'return w.__localBonk.simulation?.frame>150;'),'simulation running');
  await a.send('Page.bringToFront');await check.delay(250);await check.evaluate(a,'w.focus();');await a.send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});await check.delay(450);await a.send('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});await check.delay(200);
  const frame=Math.min(await check.evaluate(a,'return w.__localBonk.simulation.frame;'),await check.evaluate(b,'return w.__localBonk.simulation.frame;'))-2;
  const x=await check.evaluate(a,`return w.__localBonk.simulation.history[${frame}];`),y=await check.evaluate(b,`return w.__localBonk.simulation.history[${frame}];`);
  assert.equal(x.discs.filter(Boolean).length,2);assert.deepEqual(x.discs,y.discs,mode+' divergence');
  if(mode==='football'){assert(x.ball&&y.ball);assert.deepEqual(x.ball,y.ball);}
  for(const c of [a,b])assert(await check.evaluate(c,'return w.__localPeers.every(p=>Object.keys(p.connections).length===0);'),'Direct peers disabled');
  await check.screenshot(a,mode);await check.step('mode_multiplayer',{mode,label,frame,players:2,synchronized:true,footballBall:!!x.ball,serverRelay:true,directPeers:0,afterCountdown:true,realArrowInput:true});await a.dispose();await b.dispose();
 }
 await check.finish();console.log(JSON.stringify(check.result));
}catch(error){check.result.failure=error.stack;check.result.lastUI={a:await check.inspect(current.a),b:await check.inspect(current.b)};await check.screenshot(current.a,'failure-a');await check.screenshot(current.b,'failure-b');throw error;}finally{await check.close();}
