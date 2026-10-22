import {expect, it} from 'vitest';
import {nullLogger} from 'cortico/core/util.ts';
const spec = '../../src/world.ts';
const {QQWorld} = await import(spec);

function fixture() {
  const q = new QQWorld({privates:'1',contentReviewUrl:'',sendIntervalMs:0,voice:{enabled:false},
    antiLoop:{enabled:false},quietReply:{enabled:false},proactive:{quietFrom:0,quietTo:0}}) as any;
  const sent:any[] = [];
  q.log = nullLogger(); q.host = {isPaused:()=>false};
  q.driver = {connected:true,callApi:async(_action:string,args:any)=>{sent.push(args);return {message_id:sent.length};}};
  q._pendingReplyConvs.add('private:1');
  return {q,sent,tap:q.outputTap()};
}
function response(text:string, phase?:string) {
  return {type:'response.completed',response:{status:'completed',output:[{type:'message',role:'assistant',status:'completed',phase,
    content:[{type:'output_text',text}]}]}};
}

it.each(['commentary',undefined])('never forwards %s text or raw deltas as a QQ reply', async(phase) => {
  const {q,sent,tap} = fixture();
  tap.onEvent({type:'response.created'});
  tap.onEvent({type:'response.output_text.delta',delta:'他这声知道了，我先不追着解释。'});
  tap.onEvent(response('他这声知道了，我先不追着解释。',phase));
  q.onTurnEnded();
  await Promise.resolve();
  expect(sent).toEqual([]);
});

it('preserves final-answer fallback without mixing commentary into the reply', async() => {
  const {q,sent,tap} = fixture();
  tap.onEvent({type:'response.created'});
  tap.onEvent({type:'response.output_text.delta',delta:'内部想法'});
  const event = response('好，你先歇一会儿。','final_answer');
  event.response.output.unshift({...event.response.output[0],phase:'commentary',content:[{type:'output_text',text:'内部想法'}]});
  tap.onEvent(event);
  q.onTurnEnded();
  await Promise.resolve();
  expect(sent).toHaveLength(1);
  expect(JSON.stringify(sent)).toContain('好，你先歇一会儿。');
  expect(JSON.stringify(sent)).not.toContain('内部想法');
});

it('an aborted final response cannot be forwarded later', async() => {
  const {q,sent,tap} = fixture();
  tap.onEvent(response('未完成的答复','final_answer'));
  tap.onAbort(); q.onTurnEnded();
  await Promise.resolve();
  expect(sent).toEqual([]);
});
