import {test} from 'node:test';
import assert from 'node:assert/strict';
import {io as client} from 'socket.io-client';
import {createGameServer} from '../server.js';
import {drive} from './driver.js';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const once=(s,event)=>new Promise(resolve=>s.once(event,resolve));
function waitState(s,predicate){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{s.off('state',handler);reject(new Error('Expected state not received'));},1500);function handler(state){if(predicate(state)){clearTimeout(timer);s.off('state',handler);resolve(state);}}s.on('state',handler);});}
const emit=(s,event,data)=>new Promise((resolve,reject)=>s.timeout(1500).emit(event,data,(err,value)=>err?reject(err):resolve(value)));
async function setup(t){let now=1000000;const game=createGameServer({clock:()=>now,tickMs:2});await new Promise(r=>game.server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+game.server.address().port,clients=[];t.after(async()=>{clients.forEach(s=>s.disconnect());await game.close();});return{game,url,setClock:v=>now=v,advance:v=>now+=v,async connect(){const s=client(url,{forceNew:true,reconnection:false});clients.push(s);await once(s,'connect');return s;}};}
test('two players share server countdown; host authority, movement lock, isolation and lobby reset',async t=>{
 const f=await setup(t),host=await f.connect(),guest=await f.connect(),other=await f.connect();
 const a=await emit(host,'enter',{create:true,name:'Host'});assert.ok(a.ok);const room=f.game.rooms.get(a.code);
 assert.match((await emit(host,'start',{})).error,/2 connected/);
 const b=await emit(guest,'enter',{code:a.code.toLowerCase(),name:'Guest'});assert.ok(b.ok);
 const c=await emit(other,'enter',{create:true,name:'Other'});assert.ok(c.ok);assert.notEqual(c.code,a.code);
 assert.match((await emit(guest,'start',{})).error,/host/);
 const hostState=waitState(host,s=>s.phase==='countdown'),guestState=waitState(guest,s=>s.phase==='countdown');assert.ok((await emit(host,'start',{})).ok);
 const [sa,sb]=await Promise.all([hostState,guestState]);assert.equal(sa.phase,'countdown');assert.equal(sa.raceAt,sb.raceAt);assert.deepEqual(sa.players,sb.players);
 const p=room.players.get(a.id),x=p.x;host.emit('input',{x:1000,y:0,brake:false,raceId:room.raceId,seq:1});await wait(60);assert.equal(p.x,x);
 f.setClock(room.raceAt);await wait(60);assert.equal(room.phase,'racing');
 for(let i=0;i<5;i++){f.advance(50);host.emit('input',{x:1000,y:0,brake:false,raceId:room.raceId,seq:i+2,position:9999});await wait(55);}
 assert.ok(p.x>x&&p.x-x<=60,'speed capped by server');
 f.advance(500);await wait(60);const stopped=p.x;f.advance(500);await wait(60);assert.ok(p.x-stopped<30);
 assert.equal(f.game.rooms.get(c.code).phase,'lobby');assert.match((await emit(guest,'lobby',{})).error,/host/);
 assert.match((await emit(host,'lobby',{})).error,/finish/);f.setClock(room.endAt+1);await wait(25);assert.ok((await emit(host,'lobby',{})).ok);assert.equal(room.phase,'lobby');assert.equal(room.raceAt,0);
 assert.equal((await fetch(f.url+'/health')).status,200);assert.equal((await fetch(f.url+'/server.js')).status,404);
});
test('invalid names/codes, eight-player cap, private reconnect credential and reserved-seat recovery',async t=>{
 const f=await setup(t),host=await f.connect();assert.match((await emit(host,'enter',{create:true,name:''})).error,/nickname/);f.advance(600);
 const a=await emit(host,'enter',{create:true,name:'Host'}),room=f.game.rooms.get(a.code),seats=[a],players=[host];
 for(let i=1;i<8;i++){const s=await f.connect();players.push(s);seats.push(await emit(s,'enter',{code:a.code,name:'Player '+i}));}
 assert.equal(room.players.size,8);const extra=await f.connect();assert.match((await emit(extra,'enter',{code:'bad',name:'Extra'})).error,/six/);f.advance(600);assert.match((await emit(extra,'enter',{code:'FFFFFF',name:'Extra'})).error,/not found/);f.advance(600);assert.match((await emit(extra,'enter',{code:a.code,name:'Extra'})).error,/full/);
 players[2].disconnect();await wait(60);assert.equal(room.players.get(seats[2].id).connected,false);f.advance(600);assert.match((await emit(extra,'enter',{code:a.code,name:'Extra'})).error,/full/);
 const returned=await f.connect(),statePromise=once(returned,'state');const restored=await emit(returned,'enter',{code:a.code,name:'Player 2',token:seats[2].token});assert.equal(restored.id,seats[2].id);assert.equal(room.players.size,8);
 const state=await statePromise;assert.ok(state.players.every(p=>!('token'in p)&&!('socketId'in p)&&!('input'in p)));
 returned.disconnect();await wait(60);f.advance(16000);await wait(60);assert.equal(room.players.size,7);assert.ok((await emit(extra,'enter',{code:a.code,name:'Extra'})).ok);
});
test('host leaving cancels underfilled countdown, transfers control, and reconnect preserves identity',async t=>{
 const f=await setup(t),a=await f.connect(),b=await f.connect();const host=await emit(a,'enter',{create:true,name:'Host'}),guest=await emit(b,'enter',{code:host.code,name:'Guest'}),room=f.game.rooms.get(host.code);
 await emit(a,'start',{});a.disconnect();await wait(60);assert.equal(room.host,guest.id);assert.equal(room.phase,'lobby');assert.match(room.message,/canceled/);
 const restored=await f.connect();assert.equal((await emit(restored,'enter',{name:'Host',code:host.code,token:host.token})).id,host.id);assert.equal(room.host,guest.id,'host authority stays with the new host');assert.ok((await emit(b,'start',{})).ok);
 f.setClock(room.raceAt);await wait(60);restored.disconnect();await wait(60);assert.equal(room.phase,'racing','movement test continues for remaining player');
 b.emit('leave');await wait(60);f.advance(16000);await wait(60);assert.equal(f.game.rooms.size,0);
});

test('two independent network clients drive two full laps and agree on final order; late/duplicate events cannot change it',async t=>{
 const f=await setup(t),a=await f.connect(),b=await f.connect();const sa=await emit(a,'enter',{create:true,name:'Alice'}),sb=await emit(b,'enter',{code:sa.code,name:'Ben'}),room=f.game.rooms.get(sa.code);
 const latest=new Map();a.on('state',s=>latest.set('a',s));b.on('state',s=>latest.set('b',s));await emit(a,'start',{});f.setClock(room.raceAt);await wait(20);
 const drivers=[{index:0},{index:0}],seqs=[0,0];
 for(let i=0;i<11000&&room.phase==='racing';i++){
  f.advance(20);
  if(i===0){assert.ok((await emit(a,'sabotage',{kind:'shot',raceId:room.raceId,requestId:'race-gate'})).ok);assert.ok((await emit(b,'sabotage',{kind:'bomb',raceId:room.raceId,requestId:'race-belt'})).ok);}
  if(i===155)assert.ok((await emit(a,'sabotage',{kind:'boost',raceId:room.raceId,requestId:'race-oil'})).ok);
  for(const [j,s] of [a,b].entries()){
   const snap=latest.get(j?'b':'a'),p=snap?.players.find(p=>p.id===(j?sb.id:sa.id));if(!p||p.finishMs!==null)continue;
   const input=drive(p,drivers[j]);s.emit('input',{...input,seq:++seqs[j],raceId:room.raceId});
  }
  await wait(5);
 }
 assert.equal(room.phase,'results');await wait(20);const left=latest.get('a'),right=latest.get('b');
 assert.equal(left.phase,'results');assert.equal(right.phase,'results');assert.deepEqual(left.order,right.order);
 assert.deepEqual(left.players.map(p=>[p.id,p.finishPlace,p.finishMs,p.lap]),right.players.map(p=>[p.id,p.finishPlace,p.finishMs,p.lap]));
 assert.ok(left.players.every(p=>p.finishMs!==null&&p.lap===2));assert.deepEqual(new Set(left.players.map(p=>p.finishPlace)),new Set([1,2]));
 const result=JSON.stringify(left.players.map(p=>[p.id,p.finishMs,p.finishPlace]));
 a.emit('finish',{time:0});a.emit('input',{x:10000,y:0,brake:false,raceId:room.raceId,seq:999999});await wait(10);
 assert.equal(JSON.stringify([...room.players.values()].map(p=>[p.id,p.finishMs,p.finishPlace])),result);
 const oldRace=room.raceId;await emit(a,'lobby',{});await emit(a,'start',{});f.setClock(room.raceAt);await wait(10);const x=room.players.get(sa.id).x;
 a.emit('input',{x:1,y:0,brake:false,raceId:oldRace,seq:1000000});f.advance(80);await wait(15);assert.equal(room.players.get(sa.id).x,x,'old-race input is ignored');
});

test('rapid control edges are accepted, stale sequences and disconnected finish claims are ignored',async t=>{
 const f=await setup(t),a=await f.connect(),b=await f.connect();const sa=await emit(a,'enter',{create:true,name:'A'});await emit(b,'enter',{code:sa.code,name:'B'});await emit(a,'start',{});const room=f.game.rooms.get(sa.code),p=room.players.get(sa.id);
 a.emit('input',{x:1,y:0,brake:false,raceId:room.raceId,seq:1});a.emit('input',{x:0,y:1,brake:false,raceId:room.raceId,seq:2});a.emit('input',{x:0,y:0,brake:true,raceId:room.raceId,seq:3});await wait(20);assert.equal(p.input.brake,true);assert.equal(p.lastSeq,3);
 a.emit('input',{x:1,y:0,brake:false,raceId:room.raceId,seq:2});await wait(10);assert.equal(p.input.brake,true);
 f.setClock(room.raceAt);await wait(15);a.disconnect();await wait(15);assert.equal(p.connected,false);assert.equal(p.finishMs,null);f.setClock(room.raceAt+16000);await wait(20);assert.equal(p.dnf,true);
});
