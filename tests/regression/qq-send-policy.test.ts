import {afterEach, expect, it, vi} from 'vitest';
import {nullLogger} from 'cortico/core/util.ts';
const spec = '../../src/world.ts';
const {QQWorld} = await import(spec);
afterEach(() => vi.useRealTimers());
const routine = {enabled:true, sleepStart:'23:00', sleepEnd:'07:00', lazyStart:'12:00', lazyEnd:'13:00'};
function fixture(config: any = {}) {
  const q = new QQWorld({groups:'2', privates:'1', contentReviewUrl:'', privateAggregationWindow:0, ...config}) as any;
  const events: any[] = [], deferred: any[] = [], sent: any[] = [];
  q.log = nullLogger(); q.connected = true;
  q.driver = {connected:true, callApi:async (...args:any[]) => {sent.push(args); return {};}};
  q.host = {isPaused:()=>false, pushEvent:async (event:any, opts:any) => {if(opts?.deliver!==false)events.push({event, opts}); return event;},
    pushDeferred:(event:any, opts:any) => {
      if(event.type==='qq.send_policy'){deferred.push({event,opts});return;}
      const value=event.render();if(value!==null)events.push({event:{...event,text:typeof value==='string'?value:value.text},opts});
    }};
  return {q, events, deferred, sent};
}
const incoming = (address:string) => ({type:'qq.message', source:'qqbot', ts:new Date().toISOString(), senderKey:address,
  text:'【QQ消息】听见了吗', meta:{conv:address, atMe:true}});

it('closed channels discard incoming content without waking, drafting, or fallback sending', async () => {
  const {q, events, sent} = fixture({replyGroups:false, replyPrivates:false});
  for (const address of ['group:2', 'private:1']) await q.pushIncomingMessage(incoming(address), 'flush');
  expect(events).toHaveLength(0);
  expect(q._pendingReplyConvs.size).toBe(0);
  q._tapBuf = '其他渠道的输出'; q.onTurnEnded(); expect(sent).toHaveLength(0);
  q.config.replyPrivates = true; await q.pushIncomingMessage(incoming('private:1'), 'flush');
  expect(events.at(-1).opts.trigger).toBe('flush'); expect(q._pendingReplyConvs.has('private:1')).toBe(true);
});

it('ordinary private input through the real handler keeps its message id and cannot start a reply while disabled', async () => {
  const {q, events} = fixture({replyPrivates:false, voice:{enabled:false}, call:{enabled:false}, affinity:{enabled:false}});
  await q.handleMessage({message_id:42, message_type:'private', time:Date.now()/1000, message:[{type:'text',data:{text:'请回复'}}]},
    {address:'private:1',kind:'private',id:1,label:'fixture'}, {userId:1,name:'fixture'});
  expect(events).toHaveLength(0);expect(q.knownMessages.size).toBe(0);expect(q._pendingReplyConvs.size).toBe(0);
});

it('quiet input uses independent allowlists and a reply switch still overrides them', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-13T12:30:00+08:00'));
  const {q, events} = fixture({groups:'2,4',privates:'1,3',timezone:'Asia/Singapore', routine, quietReply:{enabled:true,groups:'2',privates:'1'}});
  for (const address of ['private:1','private:3','group:2','group:4']) await q.pushIncomingMessage(incoming(address));
  expect(events.map(row=>row.event.meta.replyAllowed)).toEqual([true,false,true,false]);
  q.config.replyGroups = false; await q.pushIncomingMessage(incoming('group:2'));expect(events).toHaveLength(4);
  expect(q.routineSegmentText()).toContain('群号 2');
  expect(q.routineSegmentText()).toContain('私聊 QQ 1');
});

it('queued policy renders current settings, coalesces changes, and never wakes by itself', () => {
  const {q, deferred} = fixture(); q.publishSendPolicy(); q.publishSendPolicy();
  expect(deferred).toHaveLength(1); expect(deferred[0].opts.trigger).toBe('piggyback');
  q.config.replyGroups = false;
  expect(deferred.shift().event.render()).toContain('群聊关闭');
  q.publishSendPolicy(); expect(deferred.shift().event.render()).toBeNull();
  q.connected = false; q.publishSendPolicy(); expect(deferred.shift().event.render()).toContain('未连接');
});

it('an aggregation already waiting rechecks the switch when its timer fires', async () => {
  vi.useFakeTimers(); const {q, events, sent} = fixture({privateAggregationWindow:100});
  const conv = {address:'private:1',kind:'private',label:'fixture'};
  q.aggregatePrivate(conv, {name:'fixture',userId:1}, '窗口内消息', [], {conv:conv.address});
  q.config.replyPrivates = false; await vi.advanceTimersByTimeAsync(101);
  expect(events).toHaveLength(0);
  expect(q._pendingReplyConvs.size).toBe(0); q._tapBuf = '回复'; q.onTurnEnded(); expect(sent).toHaveLength(0);
});

it('a switch changing after delivery prevents fallback and disconnected sends make no API call', async () => {
  const {q, sent} = fixture(); await q.pushIncomingMessage(incoming('private:1'));
  q.config.replyPrivates = false; q._tapBuf = '不应发送'; q.onTurnEnded(); expect(sent).toHaveLength(0);
  q.config.replyPrivates = true; q.driver.connected = false;
  const send = q.tools().find((tool:any)=>tool.name === 'qq_send');
  const receipt = await send.handler({to:'private:1',text:'离线不重试'}, {});
  expect(receipt).toContain('未能发送'); expect(receipt).toContain('等待连接恢复'); expect(sent).toHaveLength(0);
  expect([...q.pendingSends.values()].every((draft:any)=>!draft.sent)).toBe(true);
});
