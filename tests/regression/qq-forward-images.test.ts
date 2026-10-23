import {afterEach, expect, it, vi} from 'vitest';
import {QQWorld} from '../../src/world.ts';
import {nullLogger} from 'cortico/core/util.ts';

afterEach(() => vi.unstubAllGlobals());
const png = Buffer.from('89504e470d0a1a0a', 'hex');
function setup(overrides: Record<string, unknown> = {}) {
  const q = new QQWorld({privates:'1', forwardExpandLimit:3, ...overrides} as any) as any;
  const events: any[] = [];
  q.log = nullLogger();
  q.host = {modelFacts:{accepts:(mime:string) => mime.startsWith('image/')}};
  q.pushIncomingMessage = async (event:any) => events.push(event);
  q.driver = {getForwardMessages:async () => [
    {type:'node', data:{name:'sender', uin:2, content:[
      {type:'text', data:{text:'first image'}},
      {type:'image', data:{url:'https://images.invalid/1.png'}},
      {type:'image', data:{url:'https://images.invalid/2.png'}},
    ]}},
    {sender:{user_id:3, nickname:'another sender'}, message:[{type:'image', data:{url:'https://images.invalid/3.png'}}]},
  ]};
  return {q, events, run:async () => {
    q.lookupForward('fixture-forward', {address:'private:1', kind:'private', id:1}, 5);
    await vi.waitFor(() => expect(events).toHaveLength(1));
    return events[0];
  }};
}

it('delivers merged-forward images with their actual MIME and original node labels', async () => {
  vi.stubGlobal('fetch', async (url:string) => {
    if (url.includes('1.png')) await new Promise(resolve => setTimeout(resolve,15));
    return new Response(png, {headers:{'content-type':'image/png'}});
  });
  const {q, run} = setup();
  const event = await run();
  expect(event.blobs).toHaveLength(3);
  expect(event.blobs.map((b:any) => b.name)).toEqual(['qq-forward-1-1','qq-forward-1-2','qq-forward-2-1']);
  for (const blob of event.blobs) {
    expect(blob.mime).toBe('image/png');
    expect(Buffer.from(blob.bytes)).toEqual(png);
  }
  expect(event.text).toContain('sender(2): first image');
  expect(event.text).toContain('转发第2条图片1已附在本事件中');
  expect(q.recentImages).toHaveLength(3);
});

it('keeps readable text and successful images when one image download fails', async () => {
  vi.stubGlobal('fetch', async (url:string) => url.includes('2.png') ? new Response('', {status:403}) : new Response(png));
  const event = await setup().run();
  expect(event.blobs).toHaveLength(2);
  expect(event.text).toContain('first image');
  expect(event.text).toContain('转发第1条图片2未读取：图片下载失败');
});

it.each([
  {config:{deliverImageAttachments:false}, supported:true, reason:'图片附件已关闭'},
  {config:{}, supported:false, reason:'当前模型不支持图片'},
])('reports $reason without downloading images', async ({config, supported, reason}) => {
  const fetcher = vi.fn();vi.stubGlobal('fetch', fetcher);
  const {q, run} = setup(config);q.host.modelFacts.accepts = () => supported;
  const event = await run();
  expect(event.blobs).toHaveLength(0);
  expect(event.text).toContain(reason);
  expect(fetcher).not.toHaveBeenCalled();
});

it('uses the configured expansion limit and reports omitted images', async () => {
  const fetcher = vi.fn(async () => new Response(png));vi.stubGlobal('fetch', fetcher);
  const event = await setup({forwardExpandLimit:1}).run();
  expect(event.blobs).toHaveLength(1);
  expect(fetcher).toHaveBeenCalledOnce();
  expect(event.text).toContain('另有2张图片超过转发展开上限');
});

it('does not read local paths from forwarded image segments', async () => {
  const fetcher = vi.fn();vi.stubGlobal('fetch', fetcher);
  const {q, run} = setup();
  q.driver.getForwardMessages = async () => [{message:[{type:'image',data:{file:'file:///C:/private.png'}}]}];
  const event = await run();
  expect(fetcher).not.toHaveBeenCalled();
  expect(event.blobs).toHaveLength(0);
  expect(event.text).toContain('协议端未提供可下载地址');
});

it('drops the expansion if the conversation is closed during image download', async () => {
  const {q, events} = setup();
  vi.stubGlobal('fetch', async () => {q.config.replyPrivates = false;return new Response(png);});
  q.lookupForward('fixture', {address:'private:1', kind:'private', id:1}, 5);
  await new Promise(resolve => setTimeout(resolve,30));
  expect(events).toHaveLength(0);
});

it('waits for forwarded pictures before delivering the card placeholder', async () => {
  const {q, events} = setup({privateAggregationWindow:0, contentReviewUrl:'', voice:{enabled:false}, call:{enabled:false}, affinity:{enabled:false}});
  let release!: () => void;
  const ready = new Promise<void>(resolve => {release=resolve;});
  const fetcher = vi.fn(async () => {await ready;return new Response(png);});
  vi.stubGlobal('fetch', fetcher);
  const work = q.handleMessage({message_id:5, time:Date.now()/1000, user_id:1, self_id:9,
    message:[{type:'forward',data:{id:'fixture-forward'}}]},
    {address:'private:1',kind:'private',id:1,label:'fixture'}, {userId:1,name:'viewer'});
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());
  expect(events).toHaveLength(0);
  release();await work;
  expect(events.map(e => e.type)).toEqual(['qq.forward','qq.message']);
  expect(events[0].blobs).toHaveLength(3);
});
