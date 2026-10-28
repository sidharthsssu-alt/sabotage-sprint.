// Release QA only: two independent real clients, never presented as game opponents.
// Run against your own deployment: npm run smoke -- https://YOUR-VERIFIED-GAME-URL
import assert from 'node:assert/strict';
import {io} from 'socket.io-client';
import {drive} from '../test/driver.js';
const base=new URL(process.argv[2]||'http://127.0.0.1:3000');
assert.ok(['http:','https:'].includes(base.protocol)&&!base.username&&!base.password,'Use an HTTP(S) game URL without credentials.');
const wait=ms=>new Promise(r=>setTimeout(r,ms)),sockets=[],latest=[],history=[new Map(),new Map()];
const emit=(s,event,data)=>new Promise((resolve,reject)=>s.timeout(7000).emit(event,data,(err,value)=>err?reject(err):resolve(value)));
let samples=0;
try{
 const health=await fetch(new URL('/health',base),{signal:AbortSignal.timeout(90000)});assert.equal(health.status,200);assert.equal((await health.json()).ok,true);
 for(let i=0;i<2;i++){
  const s=io(base.origin,{forceNew:true,reconnection:false,transports:['websocket'],timeout:15000});sockets.push(s);
  s.on('state',v=>{latest[i]=v;history[i].set(v.revision,JSON.stringify(v));if(history[i].size>30)history[i].delete(history[i].keys().next().value);});
  await new Promise((resolve,reject)=>{s.once('connect',resolve);s.once('connect_error',reject);});
 }
 const host=await emit(sockets[0],'enter',{create:true,name:'Release QA A'});assert.ok(host.ok);
 const guest=await emit(sockets[1],'enter',{code:host.code,name:'Release QA B'});assert.ok(guest.ok);
 assert.match((await emit(sockets[1],'start',{})).error,/host/);
 assert.ok((await emit(sockets[0],'start',{})).ok);
 const drivers=[{index:0},{index:0}],ids=[host.id,guest.id],seq=[0,0],fired=new Set(),deadline=Date.now()+140000;
 while(Date.now()<deadline){
  const state=latest[0];
  if(state?.phase==='results')break;
  if(state?.phase==='racing'){
   const elapsed=state.time-state.raceAt;
   for(const [after,index,kind] of [[0,0,'gate'],[0,1,'belt'],[3200,0,'oil']])if(elapsed>=after&&!fired.has(kind)){
    assert.ok((await emit(sockets[index],'sabotage',{kind,raceId:state.raceId,requestId:'smoke-'+kind})).ok);fired.add(kind);
   }
   for(let i=0;i<2;i++){const p=latest[i]?.players.find(p=>p.id===ids[i]);if(p&&p.finishMs===null)sockets[i].emit('input',{...drive(p,drivers[i]),seq:++seq[i],raceId:state.raceId});}
   const shared=[...history[0].keys()].filter(r=>history[1].has(r)).pop();if(shared!==undefined){assert.equal(history[0].get(shared),history[1].get(shared));samples++;}
  }
  await wait(50);
 }
 await wait(150);assert.equal(latest[0]?.phase,'results');assert.equal(latest[1]?.phase,'results');assert.equal(fired.size,3);
 assert.deepEqual(latest[0].players,latest[1].players);assert.deepEqual(latest[0].order,latest[1].order);assert.ok(latest[0].players.every(p=>p.finishMs!==null&&p.lap===2&&!p.dnf));assert.ok(samples>10);
 const results=latest[0].order.map(id=>{const p=latest[0].players.find(p=>p.id===id);return{name:p.name,place:p.finishPlace,timeMs:p.finishMs};});
 assert.ok((await emit(sockets[0],'lobby',{})).ok);assert.ok((await emit(sockets[0],'start',{})).ok);await wait(150);
 assert.ok(latest.every(s=>s.phase==='countdown'&&s.players.every(p=>p.charges===2)));
 console.log(JSON.stringify({status:'PASS',origin:base.origin,transport:'websocket',clients:2,abilities:[...fired],matchingStateSamples:samples,results,rematch:'PASS'},null,2));
}catch(error){console.error('Release smoke FAILED:',error.message);process.exitCode=1;}
finally{for(const s of sockets){s.emit('leave');s.disconnect();}}
