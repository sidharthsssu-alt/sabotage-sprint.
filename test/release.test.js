import {test} from 'node:test';
import assert from 'node:assert/strict';
import {io as client} from 'socket.io-client';
import {createGameServer} from '../server.js';
import {spawn,advanceRace,validPosition,TRACK} from '../game.js';
import {drive} from './driver.js';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const emit=(s,event,data)=>new Promise((resolve,reject)=>s.timeout(2000).emit(event,data,(err,value)=>err?reject(err):resolve(value)));
async function setup(t,n=2){
 let now=1000000;const game=createGameServer({clock:()=>now,tickMs:2});
 await new Promise(r=>game.server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+game.server.address().port;
 const sockets=[],seats=[],latest=[];t.after(async()=>{sockets.forEach(s=>s.disconnect());await game.close();});
 async function connect(){const s=client(url,{forceNew:true,reconnection:false,transports:['websocket']});sockets.push(s);await new Promise(r=>s.once('connect',r));return s;}
 for(let i=0;i<n;i++){const s=await connect();s.on('state',v=>latest[i]=v);const seat=await emit(s,'enter',{name:'QA '+i,...(i?{code:seats[0].code}:{create:true})});assert.ok(seat.ok);seats.push(seat);}
 const room=game.rooms.get(seats[0].code);
 return{game,url,sockets,seats,latest,room,connect,advance:v=>now+=v,setClock:v=>now=v};
}
test('eight independent WebSocket clients finish a legal race with all abilities and identical replicated results',async t=>{
 const f=await setup(t,8);const history=f.sockets.map(()=>new Map());
 f.sockets.forEach((s,i)=>s.on('state',v=>{history[i].set(v.revision,JSON.stringify(v));if(history[i].size>20)history[i].delete(history[i].keys().next().value);}));
 await emit(f.sockets[0],'start',{});f.setClock(f.room.raceAt);await wait(20);
 const drivers=f.seats.map(()=>({index:0})),seq=f.seats.map(()=>0),abilities=new Set();let compared=0;
 for(let step=0;step<11000&&f.room.phase==='racing';step++){
  f.advance(20);
  for(const [at,index,kind] of [[0,0,'shot'],[1,1,'bomb'],[155,2,'boost']])if(step===at){assert.ok((await emit(f.sockets[index],'sabotage',{kind,raceId:f.room.raceId,requestId:'qa-'+kind})).ok);abilities.add(kind);}
  for(let i=0;i<8;i++){const p=f.latest[i]?.players.find(p=>p.id===f.seats[i].id);if(p&&p.finishMs===null)f.sockets[i].emit('input',{...drive(p,drivers[i]),seq:++seq[i],raceId:f.room.raceId});}
  await wait(5);
  if(step%25===0){const common=[...history[0].keys()].filter(r=>history.every(h=>h.has(r))).pop();if(common!==undefined){assert.ok(history.every(h=>h.get(common)===history[0].get(common)));compared++;}}
  for(const p of f.room.players.values())assert.ok(validPosition(p.x,p.y));
 }
 await wait(25);assert.equal(f.room.phase,'results');assert.equal(abilities.size,3);assert.ok(compared>10);
 const result=f.latest[0];assert.equal(result.players.length,8);assert.ok(result.players.every(p=>p.finishMs!==null&&p.lap===2&&!p.dnf));
 assert.deepEqual([...result.players.map(p=>p.finishPlace)].sort((a,b)=>a-b),[1,2,3,4,5,6,7,8]);
 for(const s of f.latest){assert.deepEqual(s.players,result.players);assert.deepEqual(s.order,result.order);assert.deepEqual(s.pickups,result.pickups);assert.deepEqual(s.hazards,result.hazards);}
 assert.ok(result.pickups.some(p=>p.claimedBy!==null));assert.ok(result.players.every(p=>p.charges>=0&&p.charges<=5));
 console.log('Eight-client places/times:',JSON.stringify(result.order.map(id=>{const p=result.players.find(p=>p.id===id);return[p.name,p.finishPlace,p.finishMs];})), 'matching snapshot checks:',compared);
 assert.ok((await emit(f.sockets[0],'lobby',{})).ok);assert.ok((await emit(f.sockets[0],'start',{})).ok);await wait(20);
 assert.ok(f.latest.every(s=>s.phase==='countdown'&&s.players.every(p=>p.charges===3)&&s.pickups.every(p=>p.claimedBy===null)));
});
test('malformed ability payloads and forged movement/scoring do not crash authority or change state',async t=>{
 const f=await setup(t);await emit(f.sockets[0],'start',{});f.setClock(f.room.raceAt);await wait(20);const p=f.room.players.get(f.seats[0].id),before=[p.x,p.y,p.lap,p.charges];
 for(const data of [null,[],{kind:{toString:null}},{kind:['boost']},{kind:'__proto__'},{kind:'boost',requestId:{}},{kind:'boost',requestId:'x',raceId:-1}]){
  const payload=data&&typeof data==='object'?{raceId:f.room.raceId,requestId:'bad',...data}:data;
  assert.ok((await emit(f.sockets[0],'sabotage',payload)).error);
 }
 for(const data of [null,{}, {x:null,y:0,brake:false,seq:1}, {x:1,y:0,brake:'no',seq:2}, {x:1,y:0,brake:false,seq:-1}])f.sockets[0].emit('input',{...data,raceId:f.room.raceId});
 f.sockets[0].emit('finish',{time:0,place:1});f.sockets[0].emit('pickup',{id:'east'});f.sockets[0].emit('position',{x:9999,y:9999,lap:2});
 f.advance(50);await wait(30);assert.deepEqual([p.x,p.y,p.lap,p.charges],before);assert.equal(p.finishMs,null);assert.equal((await fetch(f.url+'/health')).status,200);
});
test('mid-race host departure, reserved reconnect and grace expiry preserve ongoing race and scoring',async t=>{
 const f=await setup(t,3);await emit(f.sockets[0],'start',{});f.setClock(f.room.raceAt);await wait(20);
 const host=f.room.players.get(f.seats[0].id);f.sockets[0].disconnect();await wait(20);assert.equal(f.room.phase,'racing');assert.equal(f.room.host,f.seats[1].id);
 f.advance(600);const returned=await f.connect();const seat=await emit(returned,'enter',{code:f.room.code,name:'Host return',token:f.seats[0].token});assert.equal(seat.id,host.id);assert.ok(seat.resumed);assert.equal(f.room.host,f.seats[1].id);
 returned.disconnect();await wait(20);f.advance(15001);await wait(25);assert.equal(host.dnf,true);assert.equal(f.room.phase,'racing');assert.equal(host.finishMs,null);
 f.setClock(f.room.endAt+1);await wait(25);assert.equal(f.room.phase,'results');assert.ok([...f.room.players.values()].every(p=>p.dnf));
 assert.ok((await emit(f.sockets[1],'lobby',{})).ok);assert.equal(f.room.players.size,2);
});
test('exact simultaneous finishes use stable ID tiebreak and unique immutable places',()=>{
 const r={players:new Map(),phase:'racing',raceAt:1000,endAt:121000,finishCount:0};
 for(const id of ['z','a']){const p={id,connected:true};spawn(p,0);Object.assign(p,{lap:1,checkpoint:TRACK.gates.length,x:358,y:180,speed:210,input:{x:1,y:0,brake:false},inputAt:1000});r.players.set(id,p);}
 advanceRace(r,.05,1050);assert.equal(r.players.get('a').finishPlace,1);assert.equal(r.players.get('z').finishPlace,2);assert.equal(r.players.get('a').finishMs,r.players.get('z').finishMs);
 const results=JSON.stringify([...r.players.values()]);advanceRace(r,1,2050);assert.equal(JSON.stringify([...r.players.values()]),results);
});
test('explicit departures from a full countdown free seats after cancellation so a new rival can join',async t=>{
 const f=await setup(t,8);await emit(f.sockets[0],'start',{});assert.equal(f.room.phase,'countdown');
 for(let i=0;i<7;i++){f.sockets[i].emit('leave');await wait(10);}
 assert.equal(f.room.phase,'lobby');assert.equal(f.room.players.size,1);assert.equal(f.room.host,f.seats[7].id);
 const newRival=await f.connect();const joined=await emit(newRival,'enter',{code:f.room.code,name:'New rival'});assert.ok(joined.ok);assert.equal(f.room.players.size,2);
 assert.ok((await emit(f.sockets[7],'start',{})).ok);assert.equal(f.room.phase,'countdown');
});
