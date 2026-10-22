import {afterEach,expect,it} from 'vitest';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {nullLogger} from 'cortico/core/util.ts';
import {JsonlEventStore} from 'cortico/core/event-store.ts';
const packageRoot='../../src/';
const {QQWorld}=await import(packageRoot+'world.ts');
const {Notebook}=await import(packageRoot+'notebook.ts');
const {ReminderStore}=await import(packageRoot+'reminder.ts');
const {AffinityStore}=await import(packageRoot+'affinity.ts');

const cleanup:Array<()=>void>=[];
afterEach(()=>{for(const close of cleanup.splice(0))close();});
function fixture(){
  const dir=mkdtempSync(join(tmpdir(),'qq-tools-'));
  const q=new QQWorld({groups:'654321',privates:'123456',contentReviewUrl:'',sendIntervalMs:0,
    voice:{enabled:false},quietReply:{enabled:false},antiLoop:{enabled:false},proactive:{quietFrom:0,quietTo:0}},undefined,dir) as any;
  const log=nullLogger();q.log=log;
  q.notebook=new Notebook(dir,log);q.reminders=new ReminderStore(dir,log);q.affinity=new AffinityStore(dir,log);
  q.aliasesFile=join(dir,'qqbot-aliases.json');q.loadAliases();
  const store=new JsonlEventStore({dataDir:dir,run:'fixture'});
  q.host={isPaused:()=>false,store,pushEvent:async(e:any)=>store.append({...e,origin:'internal'})};
  const calls:any[]=[];
  q.connected=true;q.driver={connected:true,callApi:async(action:string,args:any)=>{calls.push({action,args});return {message_id:1};}};
  const ctx={role:'private:123456',log};
  const tools=q.tools();
  const call=(name:string,args:Record<string,unknown>={})=>tools.find((t:any)=>t.name===name)!.handler(args,ctx);
  cleanup.push(()=>{q.reminders.flush();clearTimeout(q.reminders.flushTimer);rmSync(dir,{recursive:true,force:true});});
  return {q,dir,tools,store,calls,call};
}

it('exposes 30 tools with distinct read/write policies and keeps send scheduling semantics',()=>{
  const {tools}=fixture();expect(tools).toHaveLength(30);expect(new Set(tools.map((t:any)=>t.name)).size).toBe(30);
  for(const name of ['qq_confirm_send','qq_send_audio','qq_note_save','qq_alias_set','qq_recent','qq_search','qq_admin_join_approve'])
    expect(tools.some((t:any)=>t.name===name)).toBe(false);
  for(const name of ['qq_note_read','qq_affinity_read','qq_history','qq_qzone_read'])expect(tools.find((t:any)=>t.name===name).tags).toEqual(['read']);
  for(const name of ['qq_note_update','qq_alias_update','qq_admin_join_decide'])expect(tools.find((t:any)=>t.name===name).tags).toEqual(['write']);
  expect(tools.find((t:any)=>t.name==='qq_send')).toMatchObject({tags:['speak'],barrierAfter:true,endsTurn:true});
  expect(tools.find((t:any)=>t.name==='qq_admin_join_decide').barrierAfter).toBe(true);
});

it('round-trips notebook content through the current backend and deletes only the selected id',async()=>{
  const {call,dir}=fixture();const saved=await call('qq_note_update',{action:'save',text:'约定一起看流星。'}) as any;
  expect(saved.ok).toBe(true);const list=await call('qq_note_read',{view:'list'}) as any;
  expect(list.entries).toHaveLength(1);const id=list.entries[0].id;
  expect((await call('qq_note_read',{view:'get',id}) as any).content).toBe('约定一起看流星。');
  expect(readFileSync(join(dir,'notebook.jsonl'),'utf8')).toContain('约定一起看流星');
  expect((await call('qq_note_update',{action:'forget',id}) as any).ok).toBe(true);
  expect((await call('qq_note_read',{view:'list'}) as any).count).toBe(0);
});

it('persists alias updates and retains list and forget behavior',async()=>{
  const {call,dir}=fixture();await call('qq_alias_update',{action:'set',alias:'星星',qq:'123456'});
  expect(readFileSync(join(dir,'qqbot-aliases.json'),'utf8')).toContain('星星');
  expect(JSON.stringify(await call('qq_alias_list'))).toContain('123456');
  await call('qq_alias_update',{action:'forget',alias:'星星'});
  expect(JSON.stringify(await call('qq_alias_list'))).not.toContain('星星');
});

it('adds and cancels a reminder without changing its destination or persistence',async()=>{
  const {q,call,dir}=fixture();const saved=await call('qq_reminder_update',{action:'add',text:'看流星',when:'in 30m'}) as any;
  expect(saved.ok).toBe(true);expect(saved.address).toBe('private:123456');q.reminders.flush();
  expect(JSON.parse(readFileSync(join(dir,'reminders.json'),'utf8'))).toHaveLength(1);
  expect((await call('qq_reminder_list') as any).count).toBe(1);
  await call('qq_reminder_update',{action:'cancel',id:saved.id});expect((await call('qq_reminder_list') as any).count).toBe(0);
});

it('reads a single affinity and ranking from the existing relationship store',async()=>{
  const {q,call}=fixture();q.affinity.adjust('123456',7,'一起看流星');
  expect((await call('qq_affinity_read',{view:'person'}) as any).score).toBe(7);
  const list=await call('qq_affinity_read',{view:'ranking'}) as any;expect(list.entries[0].score).toBe(7);
});

it.each([
  ['qq_note_update',{action:'save',id:'wrong'}],['qq_note_update',{action:'forget',text:'wrong'}],
  ['qq_alias_update',{action:'forget',alias:'星星',qq:'123456'}],['qq_reminder_update',{action:'cancel',id:'wrong',when:'in 30m'}],
  ['qq_admin_join_decide',{decision:'approve',flag:'request',reason:'wrong'}],['qq_admin_join_decide',{decision:'unknown',flag:'request'}],
  ['qq_note_read',{view:'get'}],['qq_history',{mode:'search'}],['qq_qzone_read',{view:'status',num:5}],
])('rejects mismatched or incomplete operation arguments for %s before side effects',async(name,args)=>{
  const {call,calls,q}=fixture();expect(await call(name,args)).toMatchObject({failed:true});expect(calls).toHaveLength(0);
  expect(await q.notebook.list()).toHaveLength(0);expect(q.reminders.list()).toHaveLength(0);
});

it('history modes preserve archive-only, listening and reply-switch boundaries',async()=>{
  const {store,call,q}=fixture();const now=new Date().toISOString();
  for(const [address,text,archive] of [['private:123456','公开星星',false],['private:999999','隐藏星星',false],['private:123456','归档星星',true]] as const)
    store.append({source:'qqbot',type:'qq.message',ts:now,origin:'external',senderKey:address,text,...(archive?{contextDelivery:'archive-only' as const}:{})});
  const recent=String(await call('qq_history',{mode:'recent',peer:123456}));expect(recent).toContain('公开星星');expect(recent).not.toContain('归档星星');
  const search=String(await call('qq_history',{mode:'search',keyword:'星星'}));expect(search).toContain('公开星星');expect(search).not.toMatch(/隐藏星星|归档星星/);
  q.config.replyPrivates=false;expect(String(await call('qq_history',{mode:'recent',peer:123456}))).toContain('未开放读取');
});

it('group-join decisions retain disabled gates, exact request flags and one-time processing',async()=>{
  const {q,call,calls}=fixture();q.pendingJoinRequests.set('request',{groupId:654321,userId:123456,subType:'add'});
  q.config.admin.enabled=false;expect(String(await call('qq_admin_join_decide',{decision:'approve',flag:'request'}))).toContain('未开启');expect(calls).toHaveLength(0);
  q.config.admin.enabled=true;q.config.admin.allowJoin=false;expect(String(await call('qq_admin_join_decide',{decision:'reject',flag:'request'}))).toContain('未开启');expect(calls).toHaveLength(0);
  q.config.admin.allowJoin=true;await call('qq_admin_join_decide',{decision:'reject',flag:'#request',reason:'暂不接收'});
  expect(calls[0]).toEqual({action:'set_group_add_request',args:{flag:'request',sub_type:'add',approve:false,reason:'暂不接收'}});
  await call('qq_admin_join_decide',{decision:'approve',flag:'request'});expect(calls).toHaveLength(1);
});

it('audio attachment selection refuses mixed payloads and preserves source and pause checks',async()=>{
  const {q,call,calls}=fixture();expect(await call('qq_send',{to:'private:123456',audio_handle:'mem:clip',text:'wrong'})).toMatchObject({failed:true});
  q.host.blob=()=>({mime:'audio/wav',bytes:Buffer.from('fixture')});
  expect(String(await call('qq_send',{to:'private:123456',audio_handle:'mem:clip'}))).toContain('未找到对应');
  q.host.isPaused=()=>true;expect(String(await call('qq_send',{to:'private:123456',audio_handle:'mem:clip'}))).toContain('暂停');expect(calls).toHaveLength(0);
});

it('QZone selectors distinguish local status from protocol feeds and retain errors',async()=>{
  const {q,call,calls}=fixture();
  expect(String(await call('qq_qzone_read',{view:'feeds'}))).toContain('未启用');
  const counts:number[]=[];
  q.qzone={status:()=>({enabled:true,dailyCount:1,dailyQuota:5,autoReply:false,replyDailyCount:0,lastPosts:[{tid:'local-id',text:'本地记录'}]}),
    getFeeds:async(num:number)=>{counts.push(num);return {ok:true,feeds:[{text:'实时动态'}]};}};
  expect(String(await call('qq_qzone_read',{view:'status'}))).toContain('本地记录');expect(counts).toEqual([]);
  expect(String(await call('qq_qzone_read',{view:'feeds',num:100}))).toContain('实时动态');expect(counts).toEqual([50]);
  q.qzone.getFeeds=async()=>({ok:false,error:'协议不支持'});
  expect(String(await call('qq_qzone_read',{view:'feeds'}))).toContain('协议不支持');expect(calls).toHaveLength(0);
});
