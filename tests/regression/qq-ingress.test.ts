import {afterEach,expect,it,vi} from 'vitest';
import {nullLogger} from 'cortico/core/util.ts';
import {sourceEventTime} from '../event-time.mjs';
const spec='../../src/world.ts';
const {QQWorld}=await import(spec);
afterEach(()=>vi.useRealTimers());

function fixture(config:any={}) {
  const q=new QQWorld({groups:'2',privates:'1',contentReviewUrl:'',privateAggregationWindow:0,
    voice:{enabled:false},call:{enabled:false},affinity:{enabled:false},...config}) as any;
  const archived:any[]=[],queued:any[]=[],delivered:any[]=[],calls:any[]=[];
  q.log=nullLogger();q.connected=true;
  q.driver={connected:true,callApi:async(...args:any[])=>{calls.push(args);return {};}};
  q.host={isPaused:()=>false,store:{range:()=>archived,grep:()=>[]},
    pushEvent:async(event:any,opts:any)=>{
      const saved={...event,cursor:archived.length+1,contextDelivery:opts?.deliver===false?'archive-only':'deliver'};
      archived.push(saved);if(opts?.deliver!==false)delivered.push(saved);return saved;
    },pushDeferred:(event:any,opts:any)=>queued.push({event,opts})};
  const flush=()=>{for(const {event}of queued.splice(0)){
    const value=event.render();if(value!==null)delivered.push({...event,ts:new Date().toISOString(),text:typeof value==='string'?value:value.text});
  }};
  return {q,archived,queued,delivered,calls,flush};
}
function message(id:number,time=Date.now()/1000,kind='private',conv=kind==='group'?2:1) {
  return {post_type:'message',message_type:kind,message_id:id,time,user_id:kind==='private'?conv:3,
    group_id:kind==='group'?conv:undefined,self_id:99,sender:{nickname:'fixture'},message:[{type:'text',data:{text:`消息${id}`}}]};
}
async function settle(q:any){await q.msgChain;await q.msgChain;}

it('startup takes only the first ten old messages, never wakes or sends, and a fresh input restores replies',async()=>{
  const {q,archived,queued,delivered,calls,flush}=fixture();
  const old=q.connectedAtSec-3600;
  for(let i=1;i<=25;i++)q.handleEvent(message(i,old+i));
  await settle(q);
  expect(archived).toHaveLength(10);expect(q.startupHistoryCount).toBe(10);
  expect(queued.filter(x=>x.event.type==='qq.message').every(x=>x.opts.trigger==='piggyback')).toBe(true);
  expect(q._pendingReplyConvs.size).toBe(0);expect(q.knownMessages.size).toBe(0);expect(calls).toEqual([]);
  flush();const history=delivered.filter(x=>x.type==='qq.message');
  expect(history).toHaveLength(10);expect(history.every(x=>x.meta.history&&!x.meta.replyAllowed)).toBe(true);
  expect(history[0].text).toContain(new Date((old+1)*1000).toISOString());
  expect(sourceEventTime(history[0])).toBe((old+1)*1000);
  expect(await q.sendTo('private:1','不得补回旧消息')).toContain('启动历史补读');expect(calls).toEqual([]);
  q.handleEvent(message(100));await settle(q);flush();
  expect(q.historyOnlyConvs.has('private:1')).toBe(false);
  expect(delivered.at(-1).meta.replyAllowed).toBe(true);expect(q._pendingReplyConvs.has('private:1')).toBe(true);
});

it('closed channels and unlisted groups stop before indexing, media, notices and requests',async()=>{
  const {q,archived,queued,calls}=fixture({replyGroups:false,replyPrivates:false});
  for(const e of [message(1),message(2,undefined,'group'),
    {post_type:'notice',notice_type:'group_recall',group_id:2,time:Date.now()/1000},
    {post_type:'request',request_type:'group',group_id:2,user_id:3,flag:'closed',time:Date.now()/1000}])q.handleEvent(e);
  await settle(q);expect(archived).toEqual([]);expect(queued).toEqual([]);expect(calls).toEqual([]);
  expect(q.knownMessages.size).toBe(0);expect(q.convs.size).toBe(0);expect(q.pendingJoinRequests.size).toBe(0);
  q.config.replyGroups=true;
  for(const group of [3,999]){
    q.handleEvent(message(group,undefined,'group',group));
    q.handleEvent({post_type:'notice',notice_type:'group_increase',group_id:group,user_id:3});
    q.handleEvent({post_type:'request',request_type:'group',group_id:group,user_id:3,flag:String(group)});
  }
  q.config.groups='';q.handleEvent(message(9,undefined,'group',2));await settle(q);
  expect(archived).toEqual([]);expect(calls).toEqual([]);expect(q.convs.size).toBe(0);
});

it('delivery rechecks switches and roster after a message was accepted',async()=>{
  for(const mutation of [(q:any)=>q.config.replyPrivates=false,(q:any)=>q.config.privates='9']){
    const {q,archived,delivered,flush}=fixture();q.handleEvent(message(1));await settle(q);
    expect(archived).toHaveLength(1);mutation(q);flush();
    expect(delivered.filter(x=>x.type==='qq.message')).toEqual([]);expect(q._pendingReplyConvs.size).toBe(0);
  }
});

it('fresh input released from the live queue clears the history-only restriction and bypasses re-deferral',async()=>{
  const {q,delivered,flush}=fixture();
  q.handleEvent(message(1,q.connectedAtSec-100));await settle(q);flush();
  expect(q.historyOnlyConvs.has('private:1')).toBe(true);
  const defer=vi.fn(()=>true);q.streamGate={defer,blocked:()=>false};
  await q.handleEvent(message(2),true);flush();
  expect(defer).not.toHaveBeenCalled();expect(q.historyOnlyConvs.has('private:1')).toBe(false);
  expect(q.lastUserMsgAt.get('private:1')).toBeGreaterThanOrEqual(q.connectedAtSec*1000);
  expect(delivered.at(-1).meta.replyAllowed).toBe(true);expect(q._pendingReplyConvs.has('private:1')).toBe(true);
});

it('a failed live-queue delivery remains retryable instead of being mistaken for an already delivered message',async()=>{
  const {q,delivered,flush}=fixture(),original=q.handleMessage.bind(q),ev=message(42);
  q.handleMessage=async()=>{throw Error('Temporary processing failure');};
  await expect(q.handleEvent(ev,true)).rejects.toThrow('Temporary processing failure');
  expect(q.processedIds.has('42')).toBe(false);
  q.handleMessage=original;await q.handleEvent(ev,true);flush();
  expect(delivered.filter(e=>e.type==='qq.message')).toHaveLength(1);
  expect(q.processedIds.has('42')).toBe(true);
});

it('listed fresh group messages are delivered and an unknown source time is read-only history',async()=>{
  const {q,delivered,flush}=fixture();
  q.handleEvent(message(1,undefined,'group'));await settle(q);flush();
  expect(delivered.find(e=>e.type==='qq.message'&&e.senderKey==='group:2')?.meta.replyAllowed).toBe(true);
  q.handleEvent({...message(2),time:undefined});await settle(q);flush();
  const unknown=delivered.at(-1);expect(unknown.meta.history).toBe(true);
  expect(unknown.meta.sourceTimeKnown).toBe(false);expect(unknown.text).toContain('原发送时间未知');
  expect(unknown.meta.replyAllowed).toBe(false);
});

it('private aggregation retains the first source time and each original line time',async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-16T10:00:00.000Z'));
  const {q,delivered,flush}=fixture({privateAggregationWindow:1000});
  const first=Date.now();q.handleEvent(message(1,first/1000));await settle(q);
  await vi.advanceTimersByTimeAsync(300);q.handleEvent(message(2,Date.now()/1000));await settle(q);
  await vi.advanceTimersByTimeAsync(1001);flush();
  const events=delivered.filter(e=>e.type==='qq.message');expect(events).toHaveLength(1);
  expect(sourceEventTime(events[0])).toBe(first);expect(events[0].text).toContain('消息1');expect(events[0].text).toContain('消息2');
  expect(events[0].text).toContain('.300');
});

it('legacy pending startup events are capped and closed records are discarded',async()=>{
  const {q,archived,delivered,flush}=fixture({replyGroups:false});
  const old=new Date((q.connectedAtSec-100)*1000).toISOString();
  let pending=Array.from({length:30},(_,i)=>({cursor:i+1,source:'qqbot',type:'qq.message',ts:old,
    senderKey:i%2?'group:2':'private:1',text:`旧消息${i}`}));
  q.host.drainPendingEvents=async(filter:any)=>{const taken=pending.filter(filter);pending=pending.filter(e=>!filter(e));return taken;};
  await q.prunePendingIncoming();await settle(q);flush();
  expect(pending).toEqual([]);expect(archived).toHaveLength(10);
  expect(delivered.filter(e=>e.type==='qq.message').every(e=>e.senderKey==='private:1'&&e.meta.history)).toBe(true);
});

it('history tools and cached pictures cannot expose closed or unlisted conversations',async()=>{
  const {q}=fixture({replyGroups:false});
  const row=(cursor:number,senderKey:string,text:string)=>({cursor,senderKey,text,ts:new Date().toISOString(),source:'qqbot',type:'qq.message'});
  const allowed=row(1,'private:1','允许内容'),closed=row(2,'group:2','关闭群秘密'),unlisted=row(3,'group:9','名单外秘密');
  q.host.store.range=()=>[allowed,closed,unlisted];
  q.host.store.grep=()=>[{hitCursor:1,events:[allowed,closed]},{hitCursor:3,events:[closed,unlisted]}];
  const tools=q.tools();const search=tools.find((t:any)=>t.name==='qq_history');
  const result=await search.handler({mode:'search',keyword:'内容'},{});
  expect(result).toContain('允许内容');expect(result).not.toContain('秘密');
  expect(await tools.find((t:any)=>t.name==='qq_history').handler({mode:'recent',group:2},{})).toContain('未开放读取');
  expect(q.recentContextFor('group:2')).toBe('');
  q.recentImages.push({url:'http://closed.invalid/pic',conv:'group:2'});q.config.vision.enabled=true;
  expect(await tools.find((t:any)=>t.name==='qq_view_image').handler({},{})).toContain('未开放读取');
});
