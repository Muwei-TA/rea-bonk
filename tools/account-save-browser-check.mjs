import assert from 'node:assert/strict';
import { createAccountCheck } from './account-browser-check.mjs';
const check = await createAccountCheck('account');
let a;
// Remembered login can restore the original classic menu instead of the pretty menu.
const visibleMenuButton = (c, ids) => check.evaluate(c, `return ${JSON.stringify(ids)}.find(id=>{const e=d.getElementById(id);if(!e)return false;const r=e.getBoundingClientRect(),hit=d.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return r.width>0&&r.height>0&&!!hit&&(hit===e||e.contains(hit));});`);
const openSkins = async c => check.click(c, await check.wait(()=>visibleMenuButton(c,['pretty_skinsbutton','classic_mid_skins']),'visible skins menu'));
const openCustom = async c => {
 const classic=await visibleMenuButton(c,['classic_mid_customgame']);
 if(classic)await check.click(c,classic);
 else {await check.click(c,'pretty_playbutton');await check.click(c,'sm_gameChoiceCustom');}
 await check.click(c,'roomlistcreatebutton');
};
try {
 a = await check.newPage();
 const account=await check.register(a,'Save');
 const b=await check.newPage();await check.login(b,account);
 await openSkins(a);await check.click(a,'skinmanager_skin1');await check.click(a,'skinmanager_edit');
 await check.click(a,'skineditor_layerbox_colorrect');
 const rect=await check.evaluate(a,"const r=d.getElementById('skineditor_colorpicker_canvas').getBoundingClientRect(),f=document.querySelector('iframe').getBoundingClientRect();return {x:r.x+f.x+55,y:r.y+f.y+100};");
 await a.send('Input.dispatchMouseEvent',{type:'mousePressed',...rect,button:'left',clickCount:1});
 await a.send('Input.dispatchMouseEvent',{type:'mouseReleased',...rect,button:'left',clickCount:1});
 await check.click(a,'skineditor_colorpicker_savebutton');await check.click(a,'skineditor_savebutton');
 const color=await check.evaluate(a,"return d.getElementById('skineditor_layerbox_colorrect').style.backgroundColor;");
 await a.send('Page.reload',{ignoreCache:true});await check.wait(()=>check.evaluate(a,'return !!w.__localBonk?.context[61]?.userName&&!w.__localBonk.context[61].guest;'),'remembered account');
 await openSkins(a);await check.click(a,'skinmanager_skin1');await check.click(a,'skinmanager_edit');
 const savedColor=await check.evaluate(a,"return d.getElementById('skineditor_layerbox_colorrect').style.backgroundColor;");assert.equal(savedColor,color);assert(color);
 await check.step('skin_saved_reloaded',{color,savedColor});await check.screenshot(a,'skin-reloaded');
 await check.click(a,'skineditor_cancelbutton');await check.click(a,'skinmanager_close');
 await openCustom(a);
 await check.fill(a,'roomlistcreatewindowgamename','Account Map Test');await check.click(a,'roomlistcreatecreatebutton');await check.click(a,'newbonklobby_editorbutton');
 await check.click(a,'mapeditor_midbox_newbutton');await check.click(a,'mapeditor_midbox_newbutton');await check.delay(650);
 const beforeShapes=await check.evaluate(a,"return Number(d.getElementById('mapeditor_midbox_shapecount').textContent.match(/\\d+/)[0]);");
 for(const id of ['mapeditor_leftbox_addbutton','mapeditor_leftbox_createmenu_platform_s','mapeditor_leftbox_createmenu_platform_rectangle']) await check.click(a,id);
 const canvas=await check.evaluate(a,"const r=[...d.querySelectorAll('#mapeditor_midbox_previewcontainer canvas')].find(e=>e.getBoundingClientRect().width>0).getBoundingClientRect(),f=document.querySelector('iframe').getBoundingClientRect();return {x:r.x+f.x,y:r.y+f.y,width:r.width,height:r.height};");
 const start={x:canvas.x+canvas.width*.3,y:canvas.y+canvas.height*.3},end={x:canvas.x+canvas.width*.6,y:canvas.y+canvas.height*.4};
 await a.send('Page.bringToFront');await check.delay(300);
 for(const point of [start,end,{x:end.x,y:canvas.y+canvas.height*.55}]){await a.send('Input.dispatchMouseEvent',{type:'mouseMoved',...point});await check.delay(150);await a.send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});await a.send('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});await check.delay(200);}
 await check.wait(()=>check.evaluate(a,`return Number(d.getElementById('mapeditor_midbox_shapecount').textContent.match(/\\d+/)[0])===${beforeShapes+1};`),'rectangle drawn');
 await check.step('native_rectangle_drawn',{beforeShapes,afterShapes:beforeShapes+1});
 await check.click(a,'mapeditor_leftbox_addbutton');await check.click(a,'mapeditor_leftbox_createmenu_spawn');
 const spawn={x:canvas.x+canvas.width*.45,y:canvas.y+canvas.height*.2};await a.send('Input.dispatchMouseEvent',{type:'mouseMoved',...spawn});await check.delay(150);await a.send('Input.dispatchMouseEvent',{type:'mousePressed',...spawn,button:'left',clickCount:1});await a.send('Input.dispatchMouseEvent',{type:'mouseReleased',...spawn,button:'left',clickCount:1});await check.delay(350);
 const geometry=await check.evaluate(a,"return d.getElementById('mapeditor_midbox_shapecount').textContent;");
 await check.click(a,'mapeditor_midbox_savebutton');
 const mapName='GUI Map '+Date.now().toString(36);await check.fill(a,'mapeditor_save_window_field',mapName);await check.click(a,'mapeditor_save_window_save');
 await check.wait(()=>check.evaluate(a,"return !d.getElementById('mapeditor_save_window').getClientRects().length;"),'map saved');
 await check.step('map_saved_gui',{mapName,geometry});
 await a.send('Page.reload',{ignoreCache:true});await check.wait(()=>check.evaluate(a,'return !!w.__localBonk?.context[61]?.userName&&!w.__localBonk.context[61].guest;'),'reload login');
 await openCustom(a);
 await check.fill(a,'roomlistcreatewindowgamename','Map Recheck');await check.click(a,'roomlistcreatecreatebutton');await check.click(a,'newbonklobby_editorbutton');
 await check.click(a,'mapeditor_midbox_loadbutton');await check.click(a,'maploadtypedropdowntitle');await check.click(a,'maploadtypedropdownoption7');
 await check.wait(()=>check.evaluate(a,`return [...d.querySelectorAll('#maploadwindowmapscontainer .maploadwindowtextname')].some(e=>e.textContent===${JSON.stringify(mapName)});`),'saved map card');
 await check.evaluate(a,`[...d.querySelectorAll('#maploadwindowmapscontainer .maploadwindowtextname')].find(e=>e.textContent===${JSON.stringify(mapName)}).parentElement.click();`);
 const reloadedGeometry=await check.evaluate(a,"return d.getElementById('mapeditor_midbox_shapecount').textContent;");assert.equal(reloadedGeometry,geometry);
 await check.step('map_saved_reload',{mapName,geometry,reloadedGeometry});await check.screenshot(a,'map-reloaded');await check.finish();console.log(JSON.stringify(check.result));
} catch(error){check.result.failure=error.stack;if(a){await check.screenshot(a,'failure');check.result.lastUI=await check.inspect(a);}throw error;}finally{await check.close();}
