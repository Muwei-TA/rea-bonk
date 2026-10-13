import assert from 'node:assert/strict';
import { createAccountCheck } from './account-browser-check.mjs';
const check = await createAccountCheck('invite-replay');
try {
  const a = await check.newPage(), b = await check.newPage();
  const guest = async (c,name) => { await check.click(c,'guestOrAccountContainer_guestButton'); await check.fill(c,'guest_nametext',name); await check.click(c,'guestPlayButton'); await check.wait(()=>check.evaluate(c,`return w.__localBonk.context[61].userName==='${name}';`),'guest identity'); };
  await guest(a,'Invite_A');
  await check.click(a,'pretty_playbutton'); await check.click(a,'sm_gameChoiceCustom'); await check.click(a,'roomlistcreatebutton'); await check.fill(a,'roomlistcreatewindowgamename','Invite Replay Test'); await check.click(a,'roomlistcreatecreatebutton');
  await check.wait(()=>check.evaluate(a,"return d.getElementById('newbonklobby_startbutton').getClientRects().length>0;"),'created lobby');
  await check.click(a,'newbonklobby_linkbutton');
  const link=await check.evaluate(a,"return d.getElementById('newbonklobby_chat_content').innerText.split(' ').find(s=>s.startsWith('http://127.0.0.1:3210/?room='));");
  await b.send('Page.navigate',{url:link}); await check.wait(()=>check.evaluate(b,'return w.__localBonk?.context[61]?.version===49;'),'invited client'); await guest(b,'Invite_B');
  await check.wait(()=>check.evaluate(b,"return d.body.innerText.includes('Game Settings')&&d.body.innerText.includes('Invite_A');"),'native invite join');
  await check.step('local_invite_link',{url:link,originalJoinFlow:true}); await check.screenshot(b,'invited-lobby');
  await check.click(a,'newbonklobby_mapbutton'); await check.click(a,'maploadtypedropdowntitle'); await check.click(a,'maploadtypedropdownoption11');
  await check.wait(()=>check.evaluate(a,"return [...d.querySelectorAll('#maploadwindowmapscontainer .maploadwindowtextname_picks')].some(e=>e.textContent==='Classic');"),'Classic map card');
  await check.evaluate(a,"[...d.querySelectorAll('#maploadwindowmapscontainer .maploadwindowtextname_picks')].find(e=>e.textContent==='Classic').parentElement.click();");
  await check.click(a,'newbonklobby_startbutton'); await check.wait(()=>check.evaluate(a,'return w.__localBonk.simulation?.frame>360;'),'twelve seconds including countdown',25000);
  await check.click(a,'pretty_top_replay');
  await check.step('record_button_response',await check.evaluate(a,"return {chat:d.getElementById('ingamechatcontent').innerText,frame:w.__localBonk.simulation.frame};"));
  const replays=await check.wait(async()=>{const r=await check.evaluate(a,"return w.$.post('/scripts/replay_get.php',{version:49,offset:0}).then(r=>r); ");return r.replays?.length?r.replays:false;},'real recorded replay');
  assert(replays[0].replaydata.length>100); await check.step('record_real_match',{id:replays[0].id,encodedBytes:replays[0].replaydata.length});
  const viewer=await check.newPage(); await guest(viewer,'Replay_View');
  await check.wait(()=>check.evaluate(viewer,"return d.getElementById('pretty_top_replay_text').textContent.includes('Classic')&&d.querySelector('#bgreplay canvas')?.width>0;"),'recorded replay loaded in main menu');
  // WebGL does not preserve its drawing buffer; capture the actual composited canvas.
  const clip=await check.evaluate(viewer,"const r=d.querySelector('#bgreplay canvas').getBoundingClientRect(),f=document.querySelector('iframe').getBoundingClientRect();return {x:r.x+f.x,y:r.y+f.y,width:r.width,height:r.height,scale:1};");
  const image=async()=> (await viewer.send('Page.captureScreenshot',{format:'png',clip})).data;
  const before=await image(); await check.wait(async()=>{await check.delay(300);return (await image())!==before;},'replay canvas animation');
  await check.step('replay_main_menu_playback',{title:await check.evaluate(viewer,"return d.getElementById('pretty_top_replay_text').textContent;"),canvasAnimated:true});
  await check.screenshot(viewer,'recorded-main-menu'); await check.finish(); console.log(JSON.stringify(check.result));
} finally { await check.close(); }
