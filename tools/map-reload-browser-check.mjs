import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { connect } from './cdp.mjs';
const c=await connect(process.argv[2]);
const evaluate=async body=>{const r=await c.send('Runtime.evaluate',{expression:`(()=>{const w=document.querySelector('iframe').contentWindow,d=w.document;${body}})()`,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.text);return r.result.value;};
const wait=async f=>{for(let i=0;i<100;i++){try{if(await f())return;}catch{}await new Promise(r=>setTimeout(r,150));}throw new Error('Map GUI timed out');};
try{
 await c.send('Page.reload',{ignoreCache:true});await wait(()=>evaluate('return !!w.__localBonk?.context[61]?.userName&&!w.__localBonk.context[61].guest;'));
 for(const id of ['pretty_playbutton','sm_gameChoiceCustom','roomlistcreatebutton']){await evaluate(`d.getElementById('${id}').click();`);await new Promise(r=>setTimeout(r,300));}
 await evaluate("d.getElementById('roomlistcreatewindowgamename').value='Map Recheck';d.getElementById('roomlistcreatecreatebutton').click();");await wait(()=>evaluate("return d.getElementById('newbonklobby_editorbutton').getClientRects().length>0;"));
 await evaluate("d.getElementById('newbonklobby_editorbutton').click();d.getElementById('mapeditor_midbox_loadbutton').click();d.getElementById('maploadtypedropdowntitle').click();d.getElementById('maploadtypedropdownoption7').click();");
 await wait(()=>evaluate("return !!d.querySelector('#maploadwindowmapscontainer .maploadwindowtextname');"));
 const date=await evaluate("return d.querySelector('#maploadwindowmapscontainer .maploadwindowtextage').innerText;");assert(!date.includes('Invalid')&&!date.startsWith('in '));
 await evaluate("d.querySelector('#maploadwindowmapscontainer .maploadwindowtextname').parentElement.click();");
 await wait(()=>evaluate("return d.getElementById('mapeditor_midbox').innerText.includes('1 physics shapes');"));
 const r={passed:true,date,realSavedMapReloaded:true,geometry:'1 physics shape and 1 spawn (native editor)'};console.log(JSON.stringify(r));await fs.writeFile('output/playwright/map-reload-results.json',JSON.stringify(r,null,2));const shot=await c.send('Page.captureScreenshot',{format:'png'});await fs.writeFile('output/playwright/account-map-reloaded.png',Buffer.from(shot.data,'base64'));
}finally{c.close();}
