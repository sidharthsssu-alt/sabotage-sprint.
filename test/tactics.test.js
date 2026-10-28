import {test} from 'node:test';
import assert from 'node:assert/strict';
import {TRACK,TACTICS,spawn,resetTactics,activateTactic,collectPickups,integrateMotion,isActive,hazardStatus} from '../game.js';
function setup(){const a={id:'a',name:'Alice',connected:true},b={id:'b',name:'Ben',connected:true};spawn(a,0);spawn(b,1);const room={phase:'racing',raceAt:1000,raceId:9,endAt:121000,players:new Map([['a',a],['b',b]])};resetTactics(room);return{room,a,b};}
const request=(kind,id='req')=>({kind,requestId:id,raceId:9});
test('trusted activation validates race, charge, cooldown, rivals and idempotency',()=>{
 const {room,a,b}=setup();assert.equal(a.charges,2);const r=activateTactic(room,a,request('gate'),1000);assert.ok(r.ok);assert.equal(a.charges,1);assert.equal(room.hazards.gate.activeAt,2200);assert.equal(room.hazards.gate.endsAt,4400);
 assert.ok(activateTactic(room,a,request('gate'),1000).duplicate);assert.equal(a.charges,1);assert.match(activateTactic(room,a,request('oil'),1000).error,/already used/);
 assert.match(activateTactic(room,a,request('oil','new'),1001).error,/cooling/);assert.equal(a.charges,1);assert.match(activateTactic(room,b,request('gate','b1'),1001).error,/busy/);assert.equal(b.charges,2);
 assert.match(activateTactic(room,a,{...request('oil','invalid'),raceId:8},5000).error,/old race/);assert.match(activateTactic(room,a,request('__proto__','invalid'),5000).error,/Invalid/);
 a.finishMs=100;assert.match(activateTactic(room,a,request('oil','done'),5000).error,/active racers/);a.finishMs=null;b.connected=false;assert.match(activateTactic(room,a,request('oil','alone'),5000).error,/eligible rival/);b.connected=true;a.charges=0;assert.match(activateTactic(room,a,request('oil','empty'),5000).error,/No charges/);a.charges=2;room.phase='countdown';assert.match(activateTactic(room,a,request('oil','early'),5000).error,/active racers/);
});
test('shared pickup is awarded once to an eligible racer, respects cap and does not reset on a lap',()=>{
 const {room,a,b}=setup(),token=TACTICS.pickups[0];a.x=token.x;a.y=token.y;b.x=token.x+5;b.y=token.y;collectPickups(room,1100);assert.equal(a.charges,3);assert.equal(b.charges,2);assert.equal(room.pickups[0].claimedBy,a.id);
 a.charges=0;a.lap=1;collectPickups(room,1200);assert.equal(a.charges,0);assert.equal(b.charges,2);
 const t=TACTICS.pickups[1];a.x=t.x;a.y=t.y;a.charges=3;b.x=t.x+10;b.y=t.y;collectPickups(room,1300);assert.equal(b.charges,3);assert.equal(room.pickups[1].claimedBy,b.id);
 resetTactics(room);spawn(a,0);assert.equal(room.pickups[0].claimedBy,null);assert.equal(a.charges,2);assert.equal(a.actions.length,0);
});
test('gate warns before closure, blocks only the marked segment and reopens exactly on time',()=>{
 const {room,a,b}=setup();activateTactic(room,a,request('gate'),1000);const input={x:1,y:0,brake:false};
 const place=()=>Object.assign(b,{x:620,y:110,angle:0,speed:210});place();integrateMotion(b,input,.05,room,2199);assert.ok(b.x>628);place();integrateMotion(b,input,.05,room,2200);assert.equal(b.x,620);assert.match(hazardStatus(b,room,2200),/Gate closed/);
 place();b.y=190;integrateMotion(b,input,.05,room,2200);assert.ok(b.x>628,'lower bypass remains passable');place();integrateMotion(b,input,.05,room,4400);assert.ok(b.x>628);assert.equal(isActive(room,'gate',4400),false);
});
test('a car inside a gate at closure can escape, but cannot re-enter after clearing it',()=>{
 const {room,a,b}=setup();activateTactic(room,a,request('gate'),1000);Object.assign(b,{x:650,y:110,angle:0,speed:210});for(let i=0;i<15;i++)integrateMotion(b,{x:1,y:0,brake:false},.02,room,2300+i*20);assert.ok(b.x>676);
 b.angle=Math.PI;b.speed=210;for(let i=0;i<20;i++)integrateMotion(b,{x:-1,y:0,brake:false},.02,room,2700+i*20);assert.ok(b.x>=676,'cannot pass back into the closed gate');
});
test('belt reverses only during its active interval, remains escapable, and brake anchors the car',()=>{
 const {room,a,b}=setup();activateTactic(room,a,request('belt'),1000);const place=()=>Object.assign(b,{x:520,y:615,angle:Math.PI,speed:0}),idle={x:0,y:0,brake:false};
 place();integrateMotion(b,idle,.1,room,1999);assert.ok(b.x<520);place();integrateMotion(b,idle,.1,room,2000);assert.ok(b.x>520);assert.match(hazardStatus(b,room,2000),/headwind/);place();integrateMotion(b,idle,.1,room,5000);assert.ok(b.x<520);
 place();integrateMotion(b,{x:0,y:0,brake:true},.1,room,2500);assert.equal(b.x,520);place();b.speed=210;integrateMotion(b,{x:-1,y:0,brake:false},.1,room,2500);assert.ok(b.x<505,'forward driving beats the headwind');
});
test('oil provides warning, a mild area-limited slowdown and exact expiry; finished racers get no effect',()=>{
 const {room,a,b}=setup();activateTactic(room,a,request('oil'),1000);const place=()=>Object.assign(b,{x:1000,y:490,angle:Math.PI/2,speed:210}),input={x:0,y:1,brake:false};
 place();integrateMotion(b,input,.05,room,1999);assert.equal(b.speed,210);place();integrateMotion(b,input,.05,room,2000);assert.equal(b.speed,TRACK.maxSpeed*.78);assert.match(hazardStatus(b,room,2000),/22%/);
 place();b.x=1090;integrateMotion(b,input,.05,room,2500);assert.equal(b.speed,210);place();integrateMotion(b,input,.05,room,5200);assert.equal(b.speed,210);b.finishMs=1;assert.equal(hazardStatus(b,room,2500),'');room.phase='results';assert.equal(isActive(room,'oil',2500),false);
});
