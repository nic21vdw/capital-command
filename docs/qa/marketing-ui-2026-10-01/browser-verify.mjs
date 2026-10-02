import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {writeFile,mkdir,readFile,mkdtemp} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname,resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
const qaDir=dirname(fileURLToPath(import.meta.url));
const marketingRoot=resolve(process.env.MARKETING_CHECKOUT||qaDir+'/../../..');
const hostRoot=resolve(process.env.COLATERAL_CHECKOUT||marketingRoot+'/../colateral');
const root=process.env.QA_OUTPUT_DIR||await mkdtemp(join(tmpdir(),'marketing-ui-review-'));
console.log('Verification output: '+root+'/evidence');
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright':'playwright'));
const fixtures=JSON.parse(await readFile(qaDir+'/workflow-fixtures.json','utf8'));
// The offline UI matrix needs valid fonts for the unchanged presentation route.
// These explicit fixtures cover resource availability, not typography fidelity.
// Every other external request is still refused, and page errors remain fatal.
const fixtureFonts=new Map(),appRequire=createRequire(resolve(marketingRoot,'package.json'));
const interFont=await readFile(resolve(marketingRoot,'public/fonts/InterVariable.woff2'));
for(const weight of ['400','600','800'])fixtureFonts.set(appRequire('@remotion/google-fonts/Inter').getInfo().fonts.normal[weight].latin,{body:interFont,contentType:'font/woff2'});
for(const weight of ['400','500','600','700','800','900']){
 const body=await readFile(resolve(marketingRoot,'public/fonts/captions/'+(weight==='900'?'Poppins-Black.ttf':'Poppins-ExtraBold.ttf')));
 fixtureFonts.set(appRequire('@remotion/google-fonts/Poppins').getInfo().fonts.normal[weight].latin,{body,contentType:'font/ttf'});
}
const results=[],errors=[],consoleErrors=[];const processes=[];let browser;
function start(cwd,args,marker){
 const child=spawn(process.execPath,args,{cwd,env:{PATH:'',NODE_OPTIONS:'--require='+qaDir+'/qa-network-guard.cjs',CAPITAL_COMMAND_DATA_DIR:root+'/test-data',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']});processes.push(child);
 child.stderr.on('data',b=>process.stderr.write(b));child.stdout.on('data',b=>{if(/Compiled|Ready|serving/.test(b.toString()))process.stderr.write(b)});
 return new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error('Server startup timed out')),60000);child.stdout.on('data',b=>{if(b.toString().includes(marker)){clearTimeout(t);resolve(child);}});child.on('exit',c=>{clearTimeout(t);reject(new Error('Server exited '+c));});});
}
async function check(name,fn){if(process.env.QA_CHECK_FILTER && !new RegExp(process.env.QA_CHECK_FILTER).test(name))return;await fn();results.push({name,passed:true});console.log('PASS '+name);}
function monitor(page){page.route('**/*',r=>{const u=new URL(r.request().url()),font=fixtureFonts.get(u.href);if(font&&r.request().resourceType()==='font')return r.fulfill({...font,headers:{'access-control-allow-origin':'*'}});return ['127.0.0.1','localhost'].includes(u.hostname)||['data:','blob:'].includes(u.protocol)?r.continue():r.abort('blockedbyclient');});page.on('pageerror',e=>{errors.push(e.message);console.error('PAGE_EXCEPTION '+JSON.stringify({message:e.message,stack:e.stack,url:page.url()}));});page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());});}
async function appPage(route='/',width=400,height=640){const page=await browser.newPage({viewport:{width,height}});monitor(page);await page.goto('http://127.0.0.1:3100'+route+'?theme=light',{waitUntil:'domcontentloaded',timeout:60000});await page.getByRole('region',{name:'Marketing assistant'}).waitFor({timeout:60000});return page;}
try{
 await mkdir(root+'/evidence',{recursive:true});
 await start(marketingRoot,['node_modules/next/dist/bin/next',process.env.QA_APP_MODE==='production'?'start':'dev','--hostname','127.0.0.1','--port','3100'],process.env.QA_APP_MODE==='production'?'Ready in':'Ready in');
 await start(hostRoot,['scripts/serve.mjs','5296','--csp=off'],'serving');
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE_PATH,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 // Every run owns new disposable data. Initialize only its local first-run screen.
 const setupPage=await browser.newPage();monitor(setupPage);
 await setupPage.goto('http://127.0.0.1:3100/?theme=light',{waitUntil:'domcontentloaded',timeout:60000});
 const skip=setupPage.getByRole('button',{name:'Skip for now',exact:true});
 await skip.or(setupPage.getByRole('region',{name:'Marketing assistant'})).first().waitFor({timeout:60000});
 if(await skip.isVisible())await skip.click();
 await setupPage.getByRole('region',{name:'Marketing assistant'}).waitFor({timeout:60000});await setupPage.close();
 await check('Initial bootstrap failures stay visible and recover without fresh-install controls',async()=>{
  const p=await browser.newPage({viewport:{width:400,height:420}});monitor(p);await p.route('**/api/bootstrap',r=>r.fulfill({status:500,contentType:'application/json',body:'{"error":"Unavailable"}'}));
  await p.goto('http://127.0.0.1:3100/?theme=light',{waitUntil:'domcontentloaded',timeout:60000});await p.getByRole('heading',{name:'CoLateral Marketing could not load'}).waitFor({timeout:60000});assert.equal(await p.getByRole('button',{name:'Start',exact:true}).count(),0);await p.screenshot({path:root+'/evidence/after-startup-error.png'});
  await p.unroute('**/api/bootstrap');await p.getByRole('button',{name:'Try again',exact:true}).click();await p.getByRole('region',{name:'Marketing assistant'}).waitFor({timeout:60000});await p.close();
 });
 await check('Malformed successful bootstrap responses are refused',async()=>{
  const p=await browser.newPage();await p.route('**/api/bootstrap',r=>r.fulfill({status:200,contentType:'application/json',body:'{"data":{"settings":{}}}'}));await p.goto('http://127.0.0.1:3100/',{waitUntil:'domcontentloaded',timeout:60000});await p.getByText('The app server returned an incomplete data response.').waitFor({timeout:60000});await p.close();
 });
 await check('First-run Settings opens and failed profile save cannot finish setup',async()=>{
  const p=await browser.newPage({viewport:{width:400,height:640}});monitor(p);
  await p.route('**/api/bootstrap',async r=>{const response=await r.fetch();const body=await response.json();delete body.data.settings.setupCompletedAt;body.data.creatorProfile.channelName='';body.data.creatorProfile.handle='';await r.fulfill({json:body});});
  await p.goto('http://127.0.0.1:3100/?theme=light',{waitUntil:'domcontentloaded',timeout:60000});await p.getByRole('link',{name:'Open Settings',exact:true}).waitFor({timeout:60000});await p.getByRole('link',{name:'Open Settings',exact:true}).click();await p.getByRole('heading',{name:'Settings',exact:true}).waitFor({timeout:60000});
  await p.goto('http://127.0.0.1:3100/?theme=light',{waitUntil:'domcontentloaded'});await p.getByRole('button',{name:'Start',exact:true}).waitFor({timeout:60000});const actions=[];await p.route('**/api/data',async r=>{actions.push(r.request().postDataJSON().action);await r.fulfill({status:500,json:{error:'Test profile save failed'}});});await p.getByRole('button',{name:'Start',exact:true}).click();await p.getByRole('alert').filter({hasText:'Test profile save failed'}).waitFor();assert.deepEqual(actions,['updateCreatorProfile']);await p.screenshot({path:root+'/evidence/after-setup-error.png'});await p.close();
 });
 await check('Marketing screens fit a 400px pane and finish loading',async()=>{
  for(const route of ['/','/clips','/longform','/carousels','/uploading-center','/master-calendar','/settings']){
   const p=await appPage(route,400,420);await p.waitForTimeout(1400);
   const geom=await p.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,overlay:!!document.querySelector('[data-nextjs-dialog]')}));assert.ok(geom.scroll<=geom.width+1,route+' overflows '+JSON.stringify(geom));assert.equal(geom.overlay,false);await p.screenshot({path:root+'/evidence/after-'+(route==='/'?'pipeline':route.slice(1))+'-small.png'});await p.close();
  }
 });
 await check('Keyboard navigation identifies Settings and restores trigger focus on Escape',async()=>{
  const p=await appPage('/settings',400,640);const trigger=p.getByRole('button',{name:/Settings.*open navigation/});await trigger.focus();await p.keyboard.press('ArrowDown');await p.getByRole('navigation',{name:'Marketing navigation'}).waitFor();assert.equal(await p.evaluate(()=>document.activeElement.getAttribute('aria-current')),'page');await p.keyboard.press('Escape');assert.equal(await trigger.getAttribute('aria-expanded'),'false');assert.equal(await trigger.evaluate(el=>el===document.activeElement),true);await p.close();
 });
 await check('Desktop assistant aligns to content and collapsed sidebar remains reachable',async()=>{
  const p=await appPage('/',1440,900);const main=await p.locator('main').boundingBox(),bar=await p.getByRole('region',{name:'Marketing assistant'}).boundingBox();assert.ok(Math.abs((main.x+main.width/2)-(bar.x+bar.width/2))<2);await p.screenshot({path:root+'/evidence/after-pipeline-light.png'});await p.getByRole('button',{name:/Collapse sidebar/i}).click();await p.waitForTimeout(350);const collapsed=await p.locator('main').boundingBox(),bar2=await p.getByRole('region',{name:'Marketing assistant'}).boundingBox();assert.ok(Math.abs((collapsed.x+collapsed.width/2)-(bar2.x+bar2.width/2))<2);await p.setViewportSize({width:1100,height:520});await p.getByRole('link',{name:'Master Calendar',exact:true}).scrollIntoViewIfNeeded();assert.ok(await p.getByRole('link',{name:'Master Calendar',exact:true}).isVisible());await p.close();
 });
 await check('Workflow HTTP failures offer Retry and never claim an empty library',async()=>{
  const cases=[['/','**/api/pipeline','Pipeline could not refresh'],['/clips','**/api/clips','Short clips could not load'],['/longform','**/api/longform/projects','Long-form videos could not load'],['/carousels','**/api/longform/projects','Video sources could not refresh'],['/uploading-center','**/api/publish','Uploading Center could not load'],['/master-calendar','**/api/master-calendar?*','Calendar could not refresh']];
  for(const [route,pattern]of cases){const p=await browser.newPage({viewport:{width:400,height:640}});monitor(p);await p.route(pattern,r=>r.fulfill({status:503,json:{error:'Temporary test outage'}}));await p.goto('http://127.0.0.1:3100'+route+'?theme=light',{waitUntil:'domcontentloaded',timeout:60000});await p.getByRole('button',{name:'Retry',exact:true}).first().waitFor({timeout:60000});await p.screenshot({path:root+'/evidence/after-error-'+(route==='/'?'pipeline':route.slice(1))+'.png'});await p.unroute(pattern);await p.getByRole('button',{name:'Retry',exact:true}).first().click();await p.getByRole('button',{name:'Retry',exact:true}).first().waitFor({state:'hidden',timeout:60000});await p.close();}
 });
 await check('Real card and app agree on routes, input values, live theme and responsive chrome',async()=>{
  const p=await browser.newPage({viewport:{width:1500,height:1000}});monitor(p);await p.goto('http://127.0.0.1:5296/docs/qa/marketing-card-harness.html',{waitUntil:'domcontentloaded'});await p.waitForFunction(()=>window.widget?.capitalCommand.status().connected,{timeout:60000});let frame=p.frameLocator('.cv-capcmd-frame');await frame.getByRole('heading',{name:/Drop in a stream/i}).waitFor({timeout:60000});assert.equal(await frame.getByRole('button',{name:/open navigation/}).count(),0);await p.screenshot({path:root+'/evidence/after-card-bare.png'});
  await p.locator('.cv-capcmd-route').selectOption('/settings');await frame.getByRole('heading',{name:'Settings',exact:true}).waitFor({timeout:60000});await p.waitForFunction(()=>window.savedCard.route==='/settings'&&window.widget.capitalCommand.status().route==='/settings');await p.locator('.cv-capcmd-note').waitFor({state:'hidden',timeout:10000});
  await p.locator('.cv-capcmd-route').selectOption('/');await frame.getByRole('textbox',{name:'Stream or VOD link'}).waitFor({timeout:60000});const {surface}=await p.evaluate(()=>window.widget.capitalCommand.read());assert.equal(surface.route,'/');const urlField=surface.fields.find(f=>f.kind==='text'&&/link|url/i.test(f.label));assert.ok(urlField);await p.evaluate(id=>window.widget.capitalCommand.setFields({[id]:'https://example.org/disposable-vod'}),urlField.id);await frame.getByRole('textbox',{name:'Stream or VOD link'}).evaluate(el=>{if(el.value!=='https://example.org/disposable-vod')throw new Error('Input not delivered');});
  for(const [w,h,chrome]of [[400,420,'bare'],[720,560,'compact'],[1200,850,'full'],[1100,300,'bare']]){await p.evaluate(([w,h])=>window.resizeCard(w,h),[w,h]);await frame.locator('html[data-colateral-chrome="'+chrome+'"]').waitFor({timeout:10000});if(chrome==='compact'||chrome==='bare')assert.equal(await frame.getByRole('button',{name:/open navigation/}).count(),0);}
  for(const theme of ['dark','nord','light']){await p.evaluate(t=>{document.documentElement.dataset.theme=t;document.documentElement.classList.toggle('light',t==='light');window.dispatchEvent(new CustomEvent('colateral:theme',{detail:{theme:t}}));},theme);await frame.locator('html[data-theme="'+theme+'"]').waitFor({timeout:10000});const palette=await p.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--blue').trim());await frame.locator('html').evaluate((el,colour)=>{if(getComputedStyle(el).getPropertyValue('--accent').trim()!==colour)throw new Error('Accent differs: '+getComputedStyle(el).getPropertyValue('--accent').trim()+' expected '+colour);},palette);}
  await p.evaluate(()=>window.resizeCard(720,560));await p.screenshot({path:root+'/evidence/after-card-compact.png'});await p.close();
 });
 await check('All Marketing routes fit compact panes without runtime or reconciliation errors',async()=>{
  const routes=['/','/pipeline','/longform','/clips','/editor','/carousels','/podcast','/x-posts','/facebook','/launch','/uploading-center','/distribution','/master-calendar','/day-summary','/agents','/ideas','/scripts','/outliers','/execution','/presentation','/voiceover','/music','/finance','/settings','/automations','/creator','/goals','/holdings','/insights','/notes','/thumbnails','/watchlist','/youtube'];
  for(const route of routes){
   const p=await appPage(route,400,640);await p.waitForTimeout(1400);
   const geometry=await p.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,title:document.querySelector('main h1')?.textContent}));
   if(geometry.scroll>geometry.width+1){console.log('OVERFLOW ELEMENTS',await p.evaluate(()=>[...document.querySelectorAll('main *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).slice(0,8).map(e=>({tag:e.tagName,text:e.textContent.slice(0,100),class:e.className,right:e.getBoundingClientRect().right}))));}
   assert.ok(geometry.scroll<=geometry.width+1,route+' overflows '+JSON.stringify(geometry));
   console.log('ROUTE '+route+' '+JSON.stringify(geometry));
   await p.screenshot({path:root+'/evidence/route-'+(route==='/'?'home':route.slice(1))+'.png'});await p.close();
  }
 });
 await check('Retained streams stay visible during failed refreshes and recover',async()=>{
  const p=await browser.newPage({viewport:{width:400,height:640}});monitor(p);let fail=false;
  await p.route('**/api/clips',r=>r.fulfill(fail?{status:503,json:{error:'Synthetic outage'}}:{json:fixtures.clips}));
  await p.goto('http://127.0.0.1:3100/clips?theme=light',{waitUntil:'domcontentloaded'});
  await p.getByRole('button',{name:/Open stream UI fixture/}).waitFor({timeout:60000});fail=true;
  await p.getByRole('button',{name:'Refresh',exact:true}).click();await p.getByText(/Your last loaded data is still shown/).waitFor();
  assert.ok(await p.getByRole('button',{name:/Open stream UI fixture/}).isVisible());await p.screenshot({path:root+'/evidence/after-retained-clips.png'});
  fail=false;await p.getByRole('button',{name:'Retry',exact:true}).click();await p.getByText(/Your last loaded data is still shown/).waitFor({state:'hidden'});await p.close();
 });
 await check('Calendar period failures hide old events and recover without false empty states',async()=>{
  const p=await browser.newPage({viewport:{width:400,height:640}});monitor(p);let firstStart=null,fail=true;
  await p.route('**/api/master-calendar?*',r=>{
   const url=new URL(r.request().url()),start=url.searchParams.get('start'),days=Number(url.searchParams.get('days'));firstStart??=start;
   if(start!==firstStart&&fail)return r.fulfill({status:503,json:{error:'Synthetic new-period outage'}});
   const body=structuredClone(start===firstStart?fixtures.calendarOld:fixtures.calendarNew);body.start=start;body.days=days;body.events.forEach(e=>e.dateKey=start);
   return r.fulfill({json:body});
  });
  await p.goto('http://127.0.0.1:3100/master-calendar?theme=light',{waitUntil:'domcontentloaded'});
  await p.getByRole('link',{name:/old period marker/}).waitFor({timeout:60000});await p.getByRole('button',{name:'Next period',exact:true}).click();
  await p.getByText('Calendar data is unavailable for this period. Retry above to load it.').waitFor();assert.equal(await p.getByRole('link',{name:/old period marker/}).count(),0);assert.equal(await p.getByText(/Nothing scheduled/).count(),0);
  await p.screenshot({path:root+'/evidence/after-calendar-period-error.png'});fail=false;await p.getByRole('button',{name:'Retry',exact:true}).click();
  await p.getByRole('link',{name:/new period marker/}).waitFor();assert.equal(await p.getByRole('link',{name:/old period marker/}).count(),0);await p.screenshot({path:root+'/evidence/after-calendar-populated.png'});
  for(const title of ['Hide Scheduled shorts uploads','Hide Threads daily packs','Hide Carousel upload schedules'])await p.getByTitle(title,{exact:true}).click();
  await p.getByRole('button',{name:'Show all sources',exact:true}).first().waitFor();assert.equal(await p.getByRole('link',{name:/new period marker/}).count(),0);
  await p.getByRole('button',{name:'Show all sources',exact:true}).first().click();await p.getByRole('link',{name:/new period marker/}).waitFor();await p.close();
 });
 await check('Populated Longform and Uploading Center layouts fit compact panes',async()=>{
  for(const route of ['/longform','/longform?open=ui-review-processing','/uploading-center?platform=instagram']){
   const p=await browser.newPage({viewport:{width:400,height:640}});monitor(p);
   await p.route('**/api/**',r=>r.request().method()==='GET'?r.continue():r.fulfill({status:405,json:{error:'Read-only UI review'}}));
   await p.route('**/api/clips',r=>r.fulfill({json:fixtures.clips}));await p.route('**/api/longform/projects',r=>r.fulfill({json:fixtures.longformProjects}));
   await p.route('**/api/publish',r=>r.fulfill({json:fixtures.normalInstagramImageQueue}));await p.route('**/api/publish/accounts',r=>r.fulfill({json:fixtures.accounts}));await p.route('**/api/publish/overview',r=>r.fulfill({json:fixtures.overview}));await p.route('**/api/publish/youtube-channel?*',r=>r.fulfill({json:fixtures.youtubeChannel}));
   await p.goto('http://127.0.0.1:3100'+route+(route.includes('?')?'&':'?')+'theme=light',{waitUntil:'domcontentloaded'});await p.getByRole('region',{name:'Marketing assistant'}).waitFor({timeout:60000});
   if(route.startsWith('/longform'))await p.getByText(/UI fixture/).first().waitFor();else await p.getByText('UI fixture — eight-image carousel with compact actions',{exact:true}).first().waitFor();
   await p.waitForTimeout(700);if(route.includes('uploading')){await p.setViewportSize({width:400,height:420});await p.waitForTimeout(150);assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=401),'Populated short upload pane overflows');await p.screenshot({path:root+'/evidence/after-populated-uploading-short.png'});await p.setViewportSize({width:400,height:640});}const geom=await p.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));if(geom.scroll>geom.width+1){await p.screenshot({path:root+'/evidence/populated-overflow.png',fullPage:true});console.log('POPULATED OVERFLOW',await p.evaluate(()=>[...document.querySelectorAll('main *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).slice(0,20).map(e=>({tag:e.tagName,text:e.textContent.slice(0,100),class:e.className,right:e.getBoundingClientRect().right,width:e.getBoundingClientRect().width}))));}assert.ok(geom.scroll<=geom.width+1,route+' overflows '+JSON.stringify(geom));await p.screenshot({path:root+'/evidence/after-populated-'+(route.includes('uploading')?'uploading-center':route.includes('open=')?'longform-processing':'longform-library')+'.png'});await p.close();
  }
 });
 await check('Native iframe reload reconnects and zoomed array stages keep suitable chrome',async()=>{
  const p=await browser.newPage({viewport:{width:1500,height:1000}});monitor(p);await p.goto('http://127.0.0.1:5296/docs/qa/marketing-card-harness.html',{waitUntil:'domcontentloaded'});await p.waitForFunction(()=>window.widget?.capitalCommand.status().connected,{timeout:60000});
  await p.evaluate(()=>window.widget.capitalCommand.navigate('/settings'));let frame=p.frameLocator('.cv-capcmd-frame');await frame.getByRole('heading',{name:'Settings',exact:true}).waitFor();
  await Promise.all([p.waitForEvent('framenavigated',{predicate:f=>f.url().includes('/settings'),timeout:60000}),frame.locator('html').evaluate(()=>location.reload())]);await frame.getByRole('heading',{name:'Settings',exact:true}).waitFor({timeout:60000});
  await p.waitForFunction(()=>window.widget.capitalCommand.status().connected&&window.widget.capitalCommand.status().route==='/settings',{timeout:60000});const {surface}=await p.evaluate(()=>window.widget.capitalCommand.read());assert.equal(surface.route,'/settings');
  await p.evaluate(()=>{document.querySelector('.qa-board').style.zoom='0.55';document.querySelector('.cv-card-body').style.zoom=String(1/0.55);window.resizeCard(1200,850);});
  await frame.locator('html[data-colateral-chrome="compact"]').waitFor({timeout:10000});await p.screenshot({path:root+'/evidence/after-card-zoomed.png'});await p.close();
 });
 assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors.filter(x=>/two children|Hydration|TypeError|Unhandled|Maximum update/.test(x)),[]);console.log('ALL CHECKS PASS '+results.length);
}catch(e){console.error(e);results.push({name:'Verification stopped at first failure',passed:false,error:e.message});process.exitCode=1;
}finally{await writeFile(root+'/evidence/verification.json',JSON.stringify({results,errors,consoleErrors},null,2));await browser?.close();for(const child of processes)child.kill('SIGTERM');}
