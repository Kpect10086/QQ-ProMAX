import {afterEach, expect, it, vi} from 'vitest';
import {nullLogger} from 'cortico/core/util.ts';
const spec = '../../src/world.ts';
const {QQWorld} = await import(spec);

afterEach(() => vi.useRealTimers());

function fixture(mode: 'system' | 'simulated', quiet: boolean) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`2026-10-18T${quiet ? '02' : '10'}:00:00+08:00`));
  const q = new QQWorld({privates:'1', privateAggregationWindow:0, contentReviewUrl:'',
    timezone:'Asia/Singapore', voice:{enabled:false}, affinity:{enabled:false},
    quietReply:{enabled:true, privates:'1'}, call:{enabled:true, mode, triggerWords:'打电话,call me'},
    routine:{enabled:true, sleepStart:'23:00', sleepEnd:'07:00', lazyStart:'12:00', lazyEnd:'13:00'}}) as any;
  const events:any[] = [], queued:any[] = [];
  q.log = nullLogger();
  q.driver = {connected:true};
  q.host = {isPaused:()=>false, store:{range:()=>events},
    pushEvent:async(event:any) => {const saved = {...event, cursor:events.length+1}; events.push(saved); return saved;},
    pushDeferred:(event:any, options:any) => queued.push({event, options})};
  const start = vi.fn();
  const receive = async(text:string) => {
    await q.handleMessage({message_id:1, time:Date.now()/1000, message:[{type:'text', data:{text}}]},
      {address:'private:1', kind:'private', label:'fixture'}, {userId:1, name:'fixture'});
    return queued.splice(0).filter(item=>item.event.type==='qq.message').map(item=>({
      ...item.event, rendered:item.event.render(), trigger:item.options.trigger}));
  };
  return {q, start, receive};
}

it.each(['system', 'simulated'] as const)('%s keeps ordinary phone conversation replyable during quiet hours', async(mode) => {
  const {q, start, receive} = fixture(mode, true);
  const text = '我正在和朋友打电话，等会儿再和你聊';
  const messages = await receive(text);
  expect(start).not.toHaveBeenCalled();
  expect(messages).toHaveLength(1);
  expect(messages[0].rendered.text).toContain(text);
  expect(messages[0].meta.replyAllowed).toBe(true);
  expect(messages[0].trigger).toBe('debounce');
  expect(q._pendingReplyConvs.has('private:1')).toBe(true);
});

it('native mode also delivers a bare call keyword as a normal chat message', async() => {
  const {start, receive} = fixture('system', false);
  expect(await receive('打电话')).toHaveLength(1);
  expect(start).not.toHaveBeenCalled();
});

it('legacy simulated keywords stay normal text after input separation', async() => {
  const {start, receive} = fixture('simulated', false);
  expect(await receive('我和朋友打电话')).toHaveLength(1);
  expect(start).not.toHaveBeenCalled();
  expect(await receive(' CALL ME ')).toHaveLength(1);
  expect(start).not.toHaveBeenCalled();
});

it('a simulated command blocked before acceptance still reaches normal quiet private chat', async() => {
  const {q, start, receive} = fixture('simulated', true);
  expect(q.checkQuiet('private:1')).toContain('不主动发送');
  const messages = await receive('打电话');
  expect(messages).toHaveLength(1);
  expect(messages[0].meta.replyAllowed).toBe(true);
  expect(q.pendingCall).toBeUndefined();
  expect(q.inCall).toBeUndefined();
});
