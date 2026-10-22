import {afterEach, expect, it, vi} from 'vitest';
import {nullLogger} from 'cortico/core/util.ts';
const spec = '../../src/world.ts';
const {QQWorld} = await import(spec);
afterEach(() => vi.useRealTimers());

function fixture(cap = 0) {
  const q = new QQWorld({privates:'1', contentReviewUrl:'', sendIntervalMs:0, maxPrivateMessagesPerReply:cap,
    voice:{enabled:false}, antiLoop:{enabled:false}, quietReply:{enabled:false}, proactive:{quietFrom:0,quietTo:0}}) as any;
  const inputs = [{source:'qqbot', origin:'external', type:'qq.message', senderKey:'private:1', cursor:1}];
  const sent:any[] = [];
  q.log = nullLogger();
  q.host = {isPaused:()=>false, store:{range:()=>inputs}};
  q.driver = {connected:true, callApi:async(_action:string, args:any) => {sent.push(args); return {message_id:sent.length};}};
  const send = (text:string) => q.tools().find((t:any)=>t.name==='qq_send').handler({to:'private:1',text}, {});
  return {q, inputs, sent, send};
}

it('packs a three-sentence reply within the private cap and removes a forbidden native face', async() => {
  const {sent, send} = fixture(2);
  const receipt = await send('晚上播挺好，白天先把自己养回来。\n第二句。\n第三句。[旺柴]');
  expect(typeof receipt).toBe('string');
  expect(receipt).toContain('已发送');
  expect(sent.length).toBeLessThanOrEqual(2);
  expect(sent.flatMap(row=>row.message).filter(s=>s.type==='text').map(s=>s.data.text).join(''))
    .toBe('晚上播挺好，白天先把自己养回来。第二句。第三句。');
  expect(sent.flatMap(row=>row.message).filter(s=>s.type==='face')).toHaveLength(0);
});

it('reports a partial protocol failure truthfully and confirmation never replays successful segments', async() => {
  vi.useFakeTimers();
  const {q, sent, send} = fixture();
  let attempt = 0;
  q.driver.callApi = async(_action:string, args:any) => {
    if (++attempt === 3) throw Error('protocol unavailable');
    sent.push(args); return {message_id:attempt};
  };
  const receipt = await send('第一句。第二句。第三句。');
  expect(receipt.text).toContain('部分已发送');
  expect(receipt.text).toContain('2/3');
  expect(receipt.text).not.toContain('QQ 上没有收到这条消息');
  expect(receipt.text).toContain('不要整段重发');
  await vi.advanceTimersByTimeAsync(15000);
  expect(q.tools().some((t:any)=>t.name==='qq_confirm_send')).toBe(false);
  expect(attempt).toBe(3);
  expect(sent).toHaveLength(2);
});

it('prevents a later-round replay of the same reply until a new incoming message arrives', async() => {
  vi.useFakeTimers();
  const {q, inputs, sent, send} = fixture();
  await send('第一句。\n第二句。');
  expect(sent).toHaveLength(2);
  q.onTurnEnded();
  await vi.advanceTimersByTimeAsync(15000);
  expect(await send('第一句。第二句。')).toContain('去重');
  expect(sent).toHaveLength(2);
  inputs.push({...inputs[0], cursor:2});
  await send('第一句。第二句。');
  expect(sent).toHaveLength(4);
});

it('keeps confirmed segments in the receipt if the connection drops before the next segment', async() => {
  const {q, send} = fixture();
  q.driver.callApi = async() => {q.driver.connected = false; return {message_id:42};};
  const receipt = await send('第一句。第二句。第三句。');
  expect(receipt.text).toContain('部分已发送');
  expect(receipt.text).toContain('1/3');
  expect(receipt.text).toContain('message_id: 42');
});

it('does not retry or leave a replayable draft when no protocol result was confirmed', async() => {
  const {q, send} = fixture();
  let attempts = 0;
  q.driver.callApi = async() => {attempts++; throw Error('response lost');};
  const receipt = await send('一条消息');
  expect(receipt.text).toContain('发送结果未确认');
  expect(receipt.text).toContain('不能断言对方未收到');
  expect(q.tools().some((t:any)=>t.name==='qq_confirm_send')).toBe(false);
  expect(attempts).toBe(1);
});
