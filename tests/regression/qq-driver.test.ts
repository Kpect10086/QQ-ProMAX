import {expect, it} from 'vitest';
import {once} from 'node:events';
import {WebSocket, WebSocketServer} from 'ws';
import {nullLogger} from 'cortico/core/util.ts';
import {OneBotDriver, type DriverOptions} from '../../src/driver.ts';

function options(overrides: Partial<DriverOptions> = {}): DriverOptions {
  return {mode: 'reverse', wsHost: '', wsPort: 0, wsPath: '/onebot', wsUrl: '', token: '',
    log: nullLogger(), onEvent: () => {}, ...overrides};
}

async function connect(url: string): Promise<WebSocket> {
  const socket = new WebSocket(url);
  await once(socket, 'open');
  return socket;
}

async function forward(overrides: Partial<DriverOptions> = {}) {
  const server = new WebSocketServer({host: '127.0.0.1', port: 0});
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No listener');
  const driver = new OneBotDriver(options({mode: 'forward', wsUrl: `ws://127.0.0.1:${address.port}`, ...overrides}));
  const connected = once(server, 'connection');
  await driver.start();
  const [, request] = await connected;
  const client: WebSocket = (driver as any).client;
  if (client.readyState !== WebSocket.OPEN) await once(client, 'open');
  return {driver, client, server, request, stop: async () => {
    await driver.stop();
    for (const socket of server.clients) socket.terminate();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }};
}

it('binds an empty reverse host to loopback and ignores non-object frames', async () => {
  const events: unknown[] = [];
  const driver = new OneBotDriver(options({onEvent: event => {events.push(event);}}));
  await driver.start();
  try {
    const address = (driver as any).server.address();
    expect(address.address).toBe('127.0.0.1');
    const socket = await connect(`ws://127.0.0.1:${address.port}/onebot`);
    socket.send('null'); socket.send('[]'); socket.send('17');
    socket.send(JSON.stringify({post_type: 'message', user_id: 7}));
    await expect.poll(() => events).toEqual([{post_type: 'message', user_id: 7}]);
    socket.close();
  } finally {await driver.stop();}
});

it('rejects a nonzero OneBot retcode and releases calls immediately on disconnect', async () => {
  const app = await forward();
  try {
    const remote = [...app.server.clients][0];
    remote.once('message', raw => {
      const {echo} = JSON.parse(raw.toString());
      remote.send(JSON.stringify({echo, status: 'ok', retcode: 100, message: 'unavailable'}));
    });
    await expect(app.driver.callApi('get_status')).rejects.toThrow('retcode=100');
    const result = expect(app.driver.callApi('send_private_msg')).rejects.toThrow('连接已断开');
    remote.terminate();
    await result;
    expect((app.driver as any).pending.size).toBe(0);
  } finally {await app.stop();}
});

it('keeps ownership of a forward socket until close and reconnects only once', async () => {
  const app = await forward();
  try {
    app.client.emit('error', new Error('fixture transport failure'));
    expect((app.driver as any).client).toBe(app.client);
    expect((app.driver as any).reconnectTimer).toBeUndefined();
  } finally {await app.stop();}
});

it('ignores old forward close events after a restart', async () => {
  const app = await forward();
  try {
    await app.driver.stop();
    const connected = once(app.server, 'connection');
    await app.driver.start();
    const current: WebSocket = (app.driver as any).client;
    await connected;
    if (current.readyState !== WebSocket.OPEN) await once(current, 'open');
    app.client.emit('close', 1006, Buffer.alloc(0));
    expect(app.driver.connected).toBe(true);
    expect((app.driver as any).client).toBe(current);
    expect((app.driver as any).reconnectTimer).toBeUndefined();
  } finally {await app.stop();}
});

it('ignores a late open event from a stopped forward connection', async () => {
  const app = await forward();
  try {
    await app.driver.stop();
    app.client.emit('open');
    expect((app.driver as any).active).toBeNull();
    expect((app.driver as any).sockets.size).toBe(0);
  } finally {await app.stop();}
});

it('reconnects after an established transport closes and completes API calls on the new socket', async () => {
  const app = await forward();
  try {
    const next = once(app.server, 'connection');
    [...app.server.clients][0].terminate();
    const [remote] = await next as [WebSocket];
    const client: WebSocket = (app.driver as any).client;
    if (client.readyState !== WebSocket.OPEN) await once(client, 'open');
    remote.once('message', raw => {
      const {echo} = JSON.parse(raw.toString());
      remote.send(JSON.stringify({echo, status: 'ok', retcode: 0, data: {online: true}}));
    });
    expect(await app.driver.callApi('get_status')).toEqual({online: true});
    expect(app.server.clients.size).toBe(1);
  } finally {await app.stop();}
});

it('cleans up a failed reverse startup and permits retry after the port is released', async () => {
  const occupied = new WebSocketServer({host: '127.0.0.1', port: 0});
  await once(occupied, 'listening');
  const address = occupied.address();
  if (!address || typeof address === 'string') throw new Error('No listener');
  const driver = new OneBotDriver(options({wsPort: address.port}));
  try {
    await expect(driver.start()).rejects.toHaveProperty('code', 'EADDRINUSE');
    await new Promise<void>(resolve => occupied.close(() => resolve()));
    await driver.start();
    await expect(driver.start()).rejects.toThrow('已启动');
  } finally {
    await driver.stop();
    await new Promise<void>(resolve => occupied.close(() => resolve()));
  }
});

it('sends Bearer authentication while retaining query compatibility without logging the token', async () => {
  const token = 'fixture-secret&token=+value';
  const logs: unknown[] = [];
  const app = await forward({token, log: {...nullLogger(), info: (...args) => {logs.push(args);}}});
  try {
    expect(app.request.headers.authorization).toBe(`Bearer ${token}`);
    expect(new URL(app.request.url, 'http://localhost').searchParams.get('access_token')).toBe(token);
    expect(app.driver.connected).toBe(true);
    expect(logs.length).toBeGreaterThan(0);
    expect(JSON.stringify(logs)).not.toContain(token);
    expect(JSON.stringify(logs)).not.toContain('access_token');
  } finally {await app.stop();}
});

it('retries a rejected opening handshake without leaving duplicate connections', async () => {
  let attempts = 0;
  const server = new WebSocketServer({host: '127.0.0.1', port: 0, verifyClient: () => ++attempts > 1});
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No listener');
  const driver = new OneBotDriver(options({mode: 'forward', wsUrl: `ws://127.0.0.1:${address.port}`}));
  (driver as any).reconnectDelay = 20;
  try {
    const connected = once(server, 'connection');
    await driver.start();
    await connected;
    const client: WebSocket = (driver as any).client;
    if (client.readyState !== WebSocket.OPEN) await once(client, 'open');
    expect(attempts).toBe(2);
    expect(driver.connected).toBe(true);
    expect(server.clients.size).toBe(1);
    expect((driver as any).reconnectTimer).toBeUndefined();
  } finally {
    await driver.stop();
    for (const socket of server.clients) socket.terminate();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
