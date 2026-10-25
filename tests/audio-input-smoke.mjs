import assert from 'node:assert/strict';
import {once} from 'node:events';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const directory=process.argv[2];
const {default:definition}=await import(pathToFileURL(join(directory,'src/index.ts')));
const {WebSocketServer}=await import(pathToFileURL(join(directory,'node_modules/ws/wrapper.mjs')).href).catch(()=>import('ws'));
const server=new WebSocketServer({host:'127.0.0.1',port:0});await once(server,'listening');
const requests=[];const cfg=definition.defaults();Object.assign(cfg,{enabled:true,wsUrl:`ws://127.0.0.1:${server.address().port}`,privates:'1'});
const q=definition.create({cfg,packageDir:directory,dataDir:'',secret:()=> 'fixture-token'});
const log={info(){},warn(){},error(){},debug(){},child(){return this;}};
try {
 const connecting=once(server,'connection');await q.start({log,isPaused:()=>false});const [socket,req]=await connecting;
 assert.equal(req.headers.authorization,'Bearer fixture-token');
 socket.on('message',bytes=>{const msg=JSON.parse(String(bytes));requests.push(msg.action);socket.send(JSON.stringify({status:'ok',retcode:0,data:{text:'fixture voice'},echo:msg.echo}));});
 socket.send(JSON.stringify({post_type:'message',message_type:'private',message_id:123,user_id:1,message:[{type:'record',data:{file:'fixture-record'}}]}));
 for(let i=0;i<100&&!q.recent.size;i++)await new Promise(resolve=>setTimeout(resolve,10));
 const tool=q.tools()[0];const result=await tool.handler({conv:'private:1',message_id:'123'},{});
 assert.equal(JSON.parse(result.text).transcript,'fixture voice');assert.deepEqual(requests,['translate_record']);
 const blocked=await tool.handler({conv:'private:2',message_id:'123'},{});assert.equal(blocked.failed,true);
 assert.deepEqual(JSON.parse(readFileSync(join(directory,'describe.json'),'utf8')).tools,JSON.parse(JSON.stringify(definition.describe.tools)));
 console.log(JSON.stringify({package:'cortico-world-qq-audio-input',hostSourceRequired:false,transport:'real localhost WebSocket',observedVoiceOnly:true,whitelist:true,microphoneCapture:false}));
} finally {await q.stop();for(const socket of server.clients)socket.terminate();await new Promise(resolve=>server.close(resolve));}
