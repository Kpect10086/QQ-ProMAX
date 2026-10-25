import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,existsSync} from 'node:fs';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {WebSocketServer} from 'ws';
const log={debug(){},info(){},warn(){},error(){},child(){return this;}};
const pkgDir=process.argv[2] ?? fileURLToPath(new URL('..',import.meta.url));
const {default:def}=await import(pathToFileURL(join(pkgDir,'src/index.ts')).href);
const meta=JSON.parse(readFileSync(join(pkgDir,'package.json'),'utf8'));
assert.equal(meta.name,'cortico-world-qq-promax');assert.equal(meta.cortico.api,6);assert.equal(def.label,'QQ ProMAX');
assert.ok(readFileSync(join(pkgDir,meta.cortico.webUiClient)).length>0);
const wss=new WebSocketServer({host:'127.0.0.1',port:0});await new Promise(r=>wss.once('listening',r));
const requests=[],sent=[],saved=[],deferred=[],clients=[];let paused=false;
wss.on('connection',ws=>{clients.push(ws);ws.on('message',raw=>{
  const req=JSON.parse(raw.toString());requests.push(req.action);let data={};
  if(req.action==='get_login_info')data={user_id:90000001,nickname:'Fixture bot'};
  if(req.action==='get_group_list')data=[{group_id:90000002,group_name:'Fixture group'}];
  if(req.action==='get_friend_list')data=[{user_id:90000003,nickname:'Fixture peer',remark:'Peer'}];
  if(req.action==='send_msg'){sent.push(req.params);data={message_id:sent.length};}
  if(req.action==='get_qzone_msg_list')data={total:1,msglist:[{tid:'fixture-existing',content:'Existing fixture post'}]};
  if(req.action==='send_qzone_msg')data={tid:'fixture-new'};
  ws.send(JSON.stringify({echo:req.echo,status:'ok',retcode:0,data}));
});});
const cfg=def.defaults();Object.assign(cfg,{enabled:true,mode:'forward',wsUrl:`ws://127.0.0.1:${wss.address().port}`,
  groups:'90000002',privates:'90000003',sendIntervalMs:0,maxPrivateMessagesPerReply:2,privateAggregationWindow:0});
cfg.sticker.enabled=false;cfg.voice.enabled=false;
cfg.proactive.enabled=false;cfg.proactive.quietFrom=cfg.proactive.quietTo=0;cfg.emotion.enabled=false;cfg.affinity.enabled=false;cfg.routine.enabled=false;
cfg.qzone.enabled=true;cfg.qzone.tickSec=3600;cfg.qzone.chancePerTick=0;cfg.qzone.imageMode='none';
mkdirSync('fixture-data',{recursive:true});
const q=def.create({cfg,packageDir:pkgDir,dataDir:join(process.cwd(),'fixture-data'),timezone:'UTC',persist:()=>{}});
const store={range:filter=>saved.filter(e=>(!filter?.source||e.source===filter.source)&&(!filter?.senderKey||e.senderKey===filter.senderKey)).slice(-(filter?.limit??saved.length)),grep:()=>[]};
const host={log,store,isPaused:()=>paused,secret:()=>'',blob:()=>null,persist:()=>{},
  pushEvent:async(e,o={})=>{const row={...e,cursor:saved.length+1,contextDelivery:o.deliver===false?'archive-only':'deliver'};saved.push(row);return row;},
  pushDeferred:(e,o)=>deferred.push({e,o})};
const wait=async(test,msg)=>{const until=Date.now()+7000;while(!test()&&Date.now()<until)await new Promise(r=>setTimeout(r,25));assert.ok(test(),msg);};
try {
  await q.start(host);await wait(()=>q.connected&&q.identity?.friends.size===1,'QQ startup and identity');
  const tools=q.tools(),recent=tools.find(t=>t.name==='qq_history'),send=tools.find(t=>t.name==='qq_send');
  const history=await recent.handler({mode:"recent",peer:90000003},{});assert.match(history,/读取已开放/);assert.match(history,/不代表会话关闭/);
  const input={post_type:'message',message_type:'private',self_id:90000001,user_id:90000003,message_id:301,time:Math.floor(Date.now()/1000)+1,sender:{nickname:'Peer'},message:[{type:'text',data:{text:'Fresh fixture input'}}]};
  clients[0].send(JSON.stringify(input));await wait(()=>deferred.some(x=>x.e.type==='qq.message'),'New private input enters deferred context');
  const deliveries=deferred.splice(0).map(x=>({type:x.e.type,value:x.e.render?.()})).filter(x=>x.value);
  assert.ok(deliveries.some(x=>JSON.stringify(x.value).includes('Fresh fixture input')));
  const reply=await send.handler({to:'private:90000003',text:'One!Two!Three!Four!'},{});assert.match(String(reply),/已发送/);
  assert.ok(sent.length<=2);assert.equal(sent.flatMap(p=>p.message).filter(s=>s.type==='text').map(s=>s.data.text).join(''),'One!Two!Three!Four!');
  const before=saved.length;clients[0].send(JSON.stringify({...input,user_id:90000004,message_id:302}));await new Promise(r=>setTimeout(r,100));assert.equal(saved.length,before,'Unlisted peers are not read');
  cfg.replyPrivates=false;assert.match(String(await send.handler({to:'private:90000003',text:'Must not send'},{})),/私聊回复已关闭/);cfg.replyPrivates=true;
  const feeds=await tools.find(t=>t.name==='qq_qzone_read').handler({view:"feeds",num:1},{});assert.ok(String(feeds).includes('fixture-existing'));
  const posted=await tools.find(t=>t.name==='qq_qzone_post').handler({content:'Fixture post only on local mock'},{});assert.ok(String(posted).includes('fixture-new'));
  paused=true;assert.ok(String(await tools.find(t=>t.name==='qq_qzone_post').handler({content:'Blocked'},{})).includes('暂停'));paused=false;
  const ui=q.webUi('zh');assert.equal(ui.label,'QQ ProMAX');assert.ok(ui.panels.length>=16);assert.ok(ui.config.every(g=>g.owner==='world:qqbot'));
  assert.ok(!('desktopPet' in def.defaults()));
  assert.ok(!('desktopPet' in q.config));
  assert.ok(tools.every(t=>t.name.startsWith('qq_')));
  assert.ok(ui.panels.every(p=>!/^pet/.test(p.id)));
  assert.ok(ui.config.every(g=>!JSON.stringify(g).includes('desktopPet')));
  assert.ok(def.describe.events.every(e=>!e.type.startsWith('desktop-pet.')));
  assert.ok(!existsSync(join(pkgDir,'src/desktop-pet')));
  assert.ok(!existsSync(join(pkgDir,'src/cua')));
  assert.ok(!existsSync(join(pkgDir,'web')));
  assert.ok(!existsSync(join(pkgDir,'host')));
  assert.ok(!/desktop-pet|pet-voice|pet-dressframe/.test(readFileSync(join(pkgDir,meta.cortico.webUiClient),'utf8')));
  assert.deepEqual(JSON.parse(readFileSync(join(pkgDir,'describe.json'),'utf8')).tools,JSON.parse(JSON.stringify(def.describe.tools)));
  assert.ok(def.describe.tools.length>=tools.length);assert.ok(requests.includes('send_msg'));
  console.log(JSON.stringify({passed:true,package:meta.name,version:meta.version,hostSourceRequired:false,transport:'real localhost WebSocket / OneBot v11',tools:tools.length,declaredTools:def.describe.tools.length,panels:ui.panels.length,privateInput:true,replyLimit:true,whitelist:true,replySwitch:true,qzoneRead:true,qzoneReceipt:true,pauseGate:true}));
} finally {await q.stop();for(const ws of clients)ws.terminate();await new Promise(r=>wss.close(r));}
