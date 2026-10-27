import {readFileSync} from 'node:fs';
import {afterEach,expect,it,vi} from 'vitest';
import {nullLogger} from 'cortico/core/util.ts';
const spec='../../src/world.ts';
const {QQWorld}=await import(spec);
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
function world(config:any={}) {
  const q=new QQWorld({groups:'2',privates:'1',sendIntervalMs:0,contentReviewUrl:'',antiLoop:{enabled:false},...config}) as any;
  const sent:any[]=[],events:any[]=[];
  q.host={isPaused:()=>false,pushEvent:async(e:any)=>events.push(e)};q.log=nullLogger();
  q.driver={callApi:async(action:string,args:any)=>{sent.push({action,args});return {};}};
  return {q,sent,events};
}
it('old configuration keeps both reply channels enabled and either channel can be disabled independently',async()=>{
  const {q,sent}=world();
  expect(q.config.replyGroups).toBe(true);expect(q.config.replyPrivates).toBe(true);
  q.config.replyGroups=false;
  expect(await q.sendTo('group:2','群消息')).toContain('群聊回复已关闭');
  await q.sendTo('private:1','私聊仍开启');expect(sent).toHaveLength(1);
  q.config.replyPrivates=false;
  expect(await q.sendTo('private:1','filtered')).toContain('私聊回复已关闭');
  expect(await q.sendTo('group:2','[CQ:image,file=base64://test]')).toContain('群聊回复已关闭');
  expect(sent).toHaveLength(1);
  q.config.replyGroups=true;await q.sendTo('group:2','群聊恢复');expect(sent).toHaveLength(2);
});
it('disabling during content review stops the final send including filtered fallback',async()=>{
  const {q,sent}=world({contentReviewUrl:'http://review.invalid'});
  vi.stubGlobal('fetch',async()=>{q.config.replyPrivates=false;return Response.json({allow:false});});
  expect(await q.sendTo('private:1','尚未发送的回复')).toContain('私聊回复已关闭');expect(sent).toHaveLength(0);
});
it('audio attachment and poke tools cannot bypass disabled channels',async()=>{
  const {q,sent}=world({replyGroups:false,replyPrivates:false});
  const tools=q.tools();
  for(const address of ['group:2','private:1']) {
    const audio=await tools.find((t:any)=>t.name==='qq_send').handler({to:address,audio_handle:'mem:clip.wav'},{});
    expect(audio).toContain('回复已关闭');
    const poke=await tools.find((t:any)=>t.name==='qq_poke').handler({target:address,user:'1'},{});
    expect(poke).toContain('回复已关闭');
  }
  expect(sent).toHaveLength(0);
});
it('proactive events exclude muted targets and never send directly',async()=>{
  const {q,sent,events}=world({proactive:{enabled:true,mode:'both'}});
  for(const [address,kind] of [['private:1','private'],['group:2','group']])q.convs.set(address,{address,kind,active:true,label:'fixture'});
  q.config.replyGroups=false;expect(q.proactiveTargets().map((t:any)=>t.address)).toEqual(['private:1']);
  q.initProactive();
  try {
    await q.proactive.trigger('private:1');expect(sent).toHaveLength(0);expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({type:'qq.proactive',origin:'internal',senderKey:'private:1'});
    q.config.replyPrivates=false;
    await q.proactive.trigger('private:1');expect(events).toHaveLength(1);
    expect(q.tools().some((t:any)=>t.name==='qq_proactive_trigger')).toBe(false);
  }finally{q.proactive.stop();}
});
it('a built-in console form exposes both editable switches without rebuilding the web client',async()=>{
  const clientSpec=new URL(JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).cortico.webUiClient, new URL('../../', import.meta.url)).href;
  const uiSpec='cortico/web/client/ui/index.ts';const domSpec='jsdom';
  const {default:client}=await import(clientSpec),{createWebUi}=await import(uiSpec),{JSDOM}=await import(domSpec);
  const dom=new JSDOM('<body></body>'),doc=dom.window.document;vi.stubGlobal('document',doc);
  const controller=new dom.window.AbortController();
  const ui=createWebUi({doc,overlayHost:doc.body,signal:controller.signal,memo:{get:(_k:string,f:any)=>f,set(){}}});
  const {q}=world();q.reminders={list:()=>[]};const surface=q.webUi();const root=doc.createElement('div');doc.body.appendChild(root);
  client.panels.general.mount({root,ui,invoke:(m:string,args:any[])=>surface.invoke('general',m,args),
    setConfig:async(_group:string,values:Record<string,any>)=>{for(const [key,value]of Object.entries(values))q.config[key.split('.').at(-1)!]=value;}});
  try {
    await vi.waitFor(()=>expect(root.textContent).toContain('回复群聊'));
    const field=[...root.querySelectorAll('div')].find((e:any)=>e.firstElementChild?.textContent==='回复群聊');
    const group=field?.querySelector('input[type=checkbox]') as any;
    expect(group).toBeDefined();expect(group.checked).toBe(true);
    expect(root.textContent).toContain('回复私聊');
    expect(root.textContent).toContain('私聊每次回复最多条数');
    group.checked=false;group.dispatchEvent(new dom.window.Event('change'));
    await vi.waitFor(()=>expect(q.config.replyGroups).toBe(false));expect(q.config.replyPrivates).toBe(true);
    await vi.waitFor(()=>{
      const updated=[...root.querySelectorAll('div')].find((e:any)=>e.firstElementChild?.textContent==='回复群聊')?.querySelector('input[type=checkbox]') as any;
      expect(updated).not.toBe(group);expect(updated.checked).toBe(false);
    });
  }finally{controller.abort();dom.window.close();}
});
