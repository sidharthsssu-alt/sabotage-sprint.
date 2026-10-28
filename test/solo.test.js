import {test} from 'node:test';
import assert from 'node:assert/strict';
import {io as client} from 'socket.io-client';
import {createGameServer} from '../server.js';
import {validPosition} from '../game.js';
import {drive} from './driver.js';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const emit=(s,event,data)=>new Promise((resolve,reject)=>s.timeout(2000).emit(event,data,(err,value)=>err?reject(err):resolve(value)));
async function setup(t){
 let now=1000000;const game=createGameServer({clock:()=>now,tickMs:2});await new Promise(r=>game.server.listen(0,'127.0.0.1',r));
 const url='http://127.0.0.1:'+game.server.address().port,sockets=[];
 t.after(async()=>{sockets.forEach(s=>s.disconnect());await game.close();});
 async function connect(){const s=client(url,{forceNew:true,reconnection:false});sockets.push(s);await new Promise(r=>s.once('connect',r));return s;}
 const human=await connect(),latest={};human.on('state',s=>latest.state=s);
 const seat=await emit(human,'enter',{create:true,mode:'solo',name:'Human'});assert.ok(seat.ok);await wait(10);
 const room=game.rooms.get(seat.code),bot=[...room.players.values()].find(p=>p.isBot);
 return{game,room,seat,bot,human,latest,connect,advance:v=>now+=v,setClock:v=>now=v};
}
test('solo is explicitly labeled, private to one human, and cannot insert computers in multiplayer',async t=>{
 const f=await setup(t);assert.equal(f.latest.state.mode,'solo');assert.equal(f.latest.state.players.length,2);assert.equal(f.latest.state.players.filter(p=>p.isBot).length,1);assert.match(f.bot.name,/CPU/);assert.equal(f.room.host,f.seat.id);
 assert.ok(f.latest.state.players.every(p=>!('token'in p)&&!('computerDriver'in p)));
 const other=await f.connect();assert.match((await emit(other,'enter',{code:f.room.code,name:'Intruder'})).error,/single-player/);f.advance(600);
 const multi=await emit(other,'enter',{create:true,mode:'multiplayer',name:'Friend',isBot:true,bots:7});assert.ok(multi.ok);
 const room=f.game.rooms.get(multi.code);assert.equal(room.players.size,1);assert.equal([...room.players.values()][0].isBot,false);assert.match((await emit(other,'start',{})).error,/2 connected/);
 const forged=await f.connect();assert.ok((await emit(forged,'enter',{create:true,mode:'unknown',name:'Bad'})).error);
 assert.ok((await emit(f.human,'start',{})).ok);assert.equal(f.room.phase,'countdown');
});
test('one real client and a computer finish a fair complete race with sabotage and reset for rematch',async t=>{
 const f=await setup(t);await emit(f.human,'start',{});f.setClock(f.room.raceAt);await wait(15);let seq=0;const driver={index:0},seen=new Set();
 for(let i=0;i<5000&&f.room.phase==='racing';i++){
  f.advance(20);
  for(const [at,kind] of [[0,'gate'],[155,'oil'],[340,'belt']])if(i===at)assert.ok((await emit(f.human,'sabotage',{kind,raceId:f.room.raceId,requestId:'solo-'+kind})).ok);
  const p=f.latest.state?.players.find(p=>p.id===f.seat.id);
  if(p&&p.finishMs===null)f.human.emit('input',{...drive(p,driver),raceId:f.room.raceId,seq:++seq});
  await wait(5);for(const kind of Object.keys(f.room.hazards))seen.add(kind);
  for(const p of f.room.players.values()){assert.ok(validPosition(p.x,p.y));assert.ok(p.speed<=210);assert.ok(p.charges>=0&&p.charges<=3);}
 }
 assert.equal(f.room.phase,'results');const human=f.room.players.get(f.seat.id);assert.ok(human.finishMs!==null&&f.bot.finishMs!==null);assert.equal(human.lap,2);assert.equal(f.bot.lap,2);assert.equal(human.finishPlace,1,'practice opponent is beatable with legal inputs');assert.equal(f.bot.finishPlace,2);assert.equal(seen.size,3);assert.ok(f.bot.actions.length>0,'CPU uses authority-validated sabotage');assert.ok(f.room.pickups.some(p=>p.claimedBy!==null));
 console.log('Solo finish times:',JSON.stringify({human:human.finishMs,cpu:f.bot.finishMs,cpuActions:f.bot.actions.length}));
 await emit(f.human,'lobby',{});assert.ok((await emit(f.human,'start',{})).ok);assert.equal(f.room.players.size,2);assert.equal(f.bot.computerDriver.index,0);assert.equal(f.bot.actions.length,0);assert.equal(f.bot.charges,2);assert.ok(f.room.pickups.every(p=>p.claimedBy===null));
});
test('solo reconnect restores the same human and CPU, never promotes CPU, and expires abandoned rooms',async t=>{
 const f=await setup(t);await emit(f.human,'start',{});f.setClock(f.room.raceAt);await wait(15);const botId=f.bot.id;f.human.disconnect();await wait(15);assert.equal(f.room.host,null);assert.equal(f.room.phase,'racing');f.advance(600);
 const back=await f.connect(),restored=await emit(back,'enter',{name:'Human',code:f.seat.code,token:f.seat.token});assert.equal(restored.id,f.seat.id);assert.ok(restored.resumed);assert.equal(f.room.host,f.seat.id);assert.equal(f.room.players.size,2);assert.equal([...f.room.players.values()].find(p=>p.isBot).id,botId);
 back.disconnect();await wait(15);f.advance(15001);await wait(20);assert.equal(f.game.rooms.size,0,'CPU cannot keep an abandoned room alive');
});
test('leaving a solo race removes the computer room immediately',async t=>{
 const f=await setup(t);await emit(f.human,'start',{});f.human.emit('leave');await wait(20);assert.equal(f.game.rooms.size,0);
});
