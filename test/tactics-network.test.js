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
test('all three abilities synchronize economy and timing across independent clients; duplicates, forged pickups and late activations fail',async t=>{
 const f=await setup(t),[a,b]=f.clients;let serial=0;
 for(const kind of ['gate','belt','oil']){
  // Controlled server fixtures isolate exact hazard timing from driving accuracy.
  f.a.charges=2;f.a.nextSabotageAt=0;f.setClock(f.clock()+7000);await wait(10);const before=f.a.charges;
  const data={kind,raceId:f.room.raceId,requestId:'net-'+(++serial)};const accepted=await emit(a,'sabotage',data);assert.ok(accepted.ok);assert.equal(f.a.charges,before-1);
  assert.ok((await emit(a,'sabotage',data)).duplicate);assert.equal(f.a.charges,before-1);
  assert.match((await emit(b,'sabotage',{...data,requestId:'busy-'+serial})).error,/busy/);assert.equal(f.b.charges,2);
  await wait(20);assert.deepEqual(f.latest[0].hazards,f.latest[1].hazards);const h=f.room.hazards[kind];assert.equal(h.activeAt-h.warningAt,TACTICS.abilities[kind].warning);assert.equal(h.endsAt-h.activeAt,TACTICS.abilities[kind].duration);
  assert.equal(f.latest[0].hazards[kind].eventId,accepted.eventId);assert.ok(f.latest[0].players.every(p=>!('actions'in p)&&!('token'in p)));
  const z=TACTICS.abilities[kind].zone;Object.assign(f.b,{x:z.x+z.w/2,y:z.y+z.h/2,speed:0,input:{x:0,y:0,brake:true}});
  f.setClock(h.activeAt);await wait(20);assert.deepEqual(f.latest[0].hazards,f.latest[1].hazards);if(kind!=='gate')assert.ok(f.latest[0].players.find(p=>p.id===f.b.id).hazardStatus.length>0);
  f.setClock(h.endsAt);await wait(20);assert.equal(f.latest[0].players.find(p=>p.id===f.b.id).hazardStatus,'');
  f.setClock(h.unlockAt);await wait(20);assert.equal(f.latest[0].hazards[kind],undefined);assert.deepEqual(f.latest[0].hazards,f.latest[1].hazards);
 }
 f.a.charges=1;const location=TACTICS.pickups[0];Object.assign(f.a,{x:location.x,y:location.y,speed:0});Object.assign(f.b,{x:location.x+10,y:location.y,speed:0});f.advance(50);await wait(20);assert.equal(f.room.pickups[0].claimedBy,f.a.id);assert.equal(f.a.charges,2);assert.equal(f.b.charges,2);
 a.emit('pickup',{id:location.id});b.emit('pickup',{id:location.id});f.advance(50);await wait(20);assert.equal(f.a.charges,2);assert.equal(f.b.charges,2);assert.deepEqual(f.latest[0].pickups,f.latest[1].pickups);
 f.a.finishMs=123;f.a.finishPlace=1;const held=f.a.charges;assert.match((await emit(a,'sabotage',{kind:'oil',raceId:f.room.raceId,requestId:'finished'})).error,/active racers/);assert.equal(f.a.charges,held);assert.match((await emit(b,'sabotage',{kind:'oil',raceId:f.room.raceId,requestId:'no-rival'})).error,/eligible rival/);
});
