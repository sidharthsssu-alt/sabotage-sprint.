import {test} from 'node:test';
import assert from 'node:assert/strict';
import {io as client} from 'socket.io-client';
import {createGameServer} from '../server.js';
import {TACTICS} from '../game.js';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const emit=(s,event,data)=>new Promise((resolve,reject)=>s.timeout(1500).emit(event,data,(err,value)=>err?reject(err):resolve(value)));
async function setup(t){let now=1000000;const game=createGameServer({clock:()=>now,tickMs:2});await new Promise(r=>game.server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+game.server.address().port,clients=[],latest=[];
 t.after(async()=>{clients.forEach(s=>s.disconnect());await game.close();});for(let i=0;i<2;i++){const s=client(url,{forceNew:true,reconnection:false});clients.push(s);s.on('state',state=>latest[i]=state);await new Promise(r=>s.once('connect',r));}
 const sa=await emit(clients[0],'enter',{create:true,name:'Alice'}),sb=await emit(clients[1],'enter',{code:sa.code,name:'Ben'});await emit(clients[0],'start',{});const room=game.rooms.get(sa.code);now=room.raceAt;await wait(20);
 return{clients,latest,room,a:room.players.get(sa.id),b:room.players.get(sb.id),setClock:v=>now=v,advance:v=>now+=v,clock:()=>now};}
test('weapons and Nitro replicate identical events, charge consumption and hits across independent clients',async t=>{
 const f=await setup(t),[a,b]=f.clients;
 for(const kind of ['shot','bomb','boost']){
  f.a.charges=3;f.a.nextSabotageAt=0;Object.assign(f.a,{x:600,y:180,angle:0,speed:0});Object.assign(f.b,{x:790,y:180,speed:0,slowUntil:0,immuneUntil:0});
  const data={kind,raceId:f.room.raceId,requestId:'net-'+kind},accepted=await emit(a,'sabotage',data);assert.ok(accepted.ok);assert.equal(f.a.charges,2);assert.ok((await emit(a,'sabotage',data)).duplicate);assert.equal(f.a.charges,2);await wait(20);
  assert.deepEqual(f.latest[0].hazards,f.latest[1].hazards);const h=f.room.hazards[accepted.eventId];assert.equal(h.activeAt-h.warningAt,TACTICS.abilities[kind].warning);assert.equal(h.endsAt-h.activeAt,TACTICS.abilities[kind].duration);assert.ok(f.latest[0].players.every(p=>!('actions'in p)&&!('token'in p)));
  if(kind==='bomb')Object.assign(f.b,{x:h.x,y:h.y});
  for(let i=0;i<100;i++){f.advance(20);await wait(3);}
  if(kind!=='boost')assert.ok(f.b.slowUntil>0);else assert.ok(f.a.boostUntil>0);
  await wait(20);assert.deepEqual(f.latest[0].players,f.latest[1].players);assert.deepEqual(f.latest[0].hazards,f.latest[1].hazards);f.advance(5000);await wait(20);assert.equal(Object.keys(f.room.hazards).length,0);
 }
 f.a.finishMs=123;const before=f.a.charges;assert.match((await emit(a,'sabotage',{kind:'shot',raceId:f.room.raceId,requestId:'finished'})).error,/active racers/);assert.equal(f.a.charges,before);
 const l=TACTICS.pickups[0];Object.assign(f.b,{x:l.x,y:l.y,charges:1});f.advance(50);await wait(20);assert.equal(f.room.pickups[0].claimedBy,f.b.id);b.emit('pickup',{id:l.id});f.advance(50);await wait(20);assert.equal(f.b.charges,2);assert.deepEqual(f.latest[0].pickups,f.latest[1].pickups);
});
