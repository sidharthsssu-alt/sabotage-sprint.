// Shared geometry and deterministic motion. Only the server awards progress/finishes.
export const TRACK={width:1200,height:800,radius:12,laps:2,maxSpeed:210,acceleration:500,coast:360,braking:1050,turnRate:9,
 outer:{x:50,y:60,w:1100,h:680},inner:{x:345,y:285,w:510,h:230},
 obstacles:[{x:480,y:60,w:42,h:95},{x:675,y:650,w:42,h:90},{x:50,y:350,w:100,h:36},{x:1050,y:415,w:100,h:36}],
 gates:[{axis:'x',line:1000,direction:1,min:60,max:285,label:'NORTH STRAIGHT',target:{x:1030,y:185}},{axis:'y',line:600,direction:1,min:855,max:1150,label:'EAST TURN',target:{x:1030,y:640}},{axis:'x',line:200,direction:-1,min:515,max:740,label:'SOUTH CHICANE',target:{x:180,y:640}},{axis:'y',line:200,direction:-1,min:50,max:345,label:'HOME BEND',target:{x:180,y:185}}],
 finish:{axis:'x',line:240,direction:1,min:60,max:285,target:{x:240,y:160}}};
export const TACTICS={initialCharges:2,maxCharges:3,cooldown:3000,recovery:1200,
 abilities:{
  gate:{name:'Gate Slam',zone:{x:640,y:60,w:24,h:95},warning:1200,duration:2200},
  belt:{name:'Belt Flip',zone:{x:440,y:585,w:160,h:65},warning:1000,duration:3000},
  oil:{name:'Oil Slick',zone:{x:980,y:465,w:58,h:90},warning:1000,duration:3200}
 },pickups:[{id:'north',x:380,y:185},{id:'east',x:1030,y:620},{id:'west',x:180,y:300}]};
export function resetTactics(room){room.hazards={};room.pickups=TACTICS.pickups.map(p=>({id:p.id,claimedBy:null}));room.tacticSerial=0;room.tacticEvents=[];}
export function isActive(room,kind,now){const h=room?.hazards?.[kind];return room?.phase==='racing'&&!!h&&now>=h.activeAt&&now<h.endsAt;}
export function hazardStatus(p,room,now){
 if(room?.phase!=='racing'||p.finishMs!==null||p.dnf)return '';
 if(isActive(room,'oil',now)&&circleRect(p.x,p.y,TRACK.radius,TACTICS.abilities.oil.zone))return 'Oil Slick · speed reduced 22%';
 if(isActive(room,'belt',now)&&circleRect(p.x,p.y,TRACK.radius,TACTICS.abilities.belt.zone))return 'Belt Flip · headwind on the strip';
 if(p.gateHitAt&&now-p.gateHitAt<800&&isActive(room,'gate',now))return 'Gate closed · take the lower bypass';
 return '';
}
export function activateTactic(room,p,data,now){
 if(!room||room.phase!=='racing'||now>=room.endAt||!p?.connected||p.finishMs!==null||p.dnf)return {error:'Abilities are only available to active racers.'};
 if(!data||data.raceId!==room.raceId||typeof data.kind!=='string'||!Object.hasOwn(TACTICS.abilities,data.kind)||typeof data.requestId!=='string'||!/^[-a-zA-Z0-9_]{1,64}$/.test(data.requestId))return {error:'Invalid ability request or old race.'};
 const previous=p.actions.find(a=>a.requestId===data.requestId);
 if(previous)return previous.kind===data.kind?{ok:true,duplicate:true,eventId:previous.eventId}:{error:'That request ID was already used.'};
 if(![...room.players.values()].some(q=>q.id!==p.id&&q.connected&&q.finishMs===null&&!q.dnf))return {error:'No eligible rival is still racing.'};
 if(p.charges<1)return {error:'No charges. Collect a lightning pickup.'};
 if(now<p.nextSabotageAt)return {error:'Your abilities are cooling down.'};
 const old=room.hazards[data.kind];if(old&&now<old.unlockAt)return {error:'That track hazard is busy or cooling down. Your charge is saved.'};
 const spec=TACTICS.abilities[data.kind],eventId=room.raceId+'-'+(++room.tacticSerial);
 p.charges--;p.nextSabotageAt=now+TACTICS.cooldown;
 const h={kind:data.kind,eventId,owner:p.id,ownerName:p.name,warningAt:now,activeAt:now+spec.warning,endsAt:now+spec.warning+spec.duration,unlockAt:now+spec.warning+spec.duration+TACTICS.recovery};
 room.hazards[data.kind]=h;p.actions.push({requestId:data.requestId,kind:data.kind,eventId});
 room.tacticEvents.push({eventId,text:p.name+' triggered '+spec.name+'. Watch the marked zone!',at:now});room.tacticEvents=room.tacticEvents.slice(-6);
 return {ok:true,eventId};
}
export function collectPickups(room,now){
 if(room.phase!=='racing')return;
 for(const token of room.pickups??[]){if(token.claimedBy!==null)continue;const location=TACTICS.pickups.find(p=>p.id===token.id);
  const eligible=[...room.players.values()].filter(p=>p.connected&&!p.dnf&&p.finishMs===null&&p.charges<TACTICS.maxCharges).map(p=>({p,d:Math.hypot(p.x-location.x,p.y-location.y)})).filter(a=>a.d<28).sort((a,b)=>a.d-b.d||a.p.id.localeCompare(b.p.id));
  if(eligible.length){const p=eligible[0].p;token.claimedBy=p.id;p.charges++;room.tacticEvents.push({eventId:'pickup-'+token.id,text:p.name+' collected a charge.',at:now});room.tacticEvents=room.tacticEvents.slice(-6);}
 }
}
export const LIMITS={minPlayers:2,maxPlayers:8,countdown:5000,reconnectGrace:15000,idleLobby:20*60*1000,raceLimit:120000,finishWindow:45000};
export function spawn(p,index){Object.assign(p,{x:175-Math.floor(index/4)*40,y:100+(index%4)*33,angle:0,speed:0,input:{x:0,y:0,brake:false},inputAt:0,lastSeq:-1,lap:0,checkpoint:0,finishMs:null,finishPlace:null,dnf:false,hit:false,charges:TACTICS.initialCharges,nextSabotageAt:0,actions:[],gateHitAt:0});}
export function circleRect(x,y,r,b){const cx=Math.max(b.x,Math.min(x,b.x+b.w)),cy=Math.max(b.y,Math.min(y,b.y+b.h));return(x-cx)**2+(y-cy)**2<r*r;}
export function validPosition(x,y){const {outer:o,inner:i,radius:r}=TRACK;return x-r>=o.x&&x+r<=o.x+o.w&&y-r>=o.y&&y+r<=o.y+o.h&&!circleRect(x,y,r,i)&&!TRACK.obstacles.some(b=>circleRect(x,y,r,b));}
export const angleDelta=(a,b)=>Math.atan2(Math.sin(b-a),Math.cos(b-a));
export function integrateMotion(p,input,dt,room=null,now=0){
 p.hit=false;const throttle=!input.brake&&Math.hypot(input.x,input.y)>.01;
 const oil=isActive(room,'oil',now)&&circleRect(p.x,p.y,TRACK.radius,TACTICS.abilities.oil.zone);
 const maxSpeed=TRACK.maxSpeed*(oil?.78:1),turnRate=TRACK.turnRate*(oil?.9:1);
 if(throttle){const desired=Math.atan2(input.y,input.x),delta=angleDelta(p.angle,desired);p.angle+=Math.max(-turnRate*dt,Math.min(turnRate*dt,delta));p.speed=Math.min(maxSpeed,p.speed+TRACK.acceleration*dt*(oil?.8:1));}
 else p.speed=Math.max(0,Math.min(maxSpeed,p.speed-(input.brake?TRACK.braking:TRACK.coast)*dt));
 const belt=room?.phase==='racing'&&circleRect(p.x,p.y,TRACK.radius,TACTICS.abilities.belt.zone);
 const drift=belt&&!input.brake?(isActive(room,'belt',now)?38:-22):0;
 const dx=(Math.cos(p.angle)*p.speed+drift)*dt,dy=Math.sin(p.angle)*p.speed*dt;
 const gate=TACTICS.abilities.gate.zone,closed=isActive(room,'gate',now),insideGate=circleRect(p.x,p.y,TRACK.radius,gate);
 // A car caught in the warning zone when the gate closes may leave in any direction.
 const allowed=(x,y)=>validPosition(x,y)&&(!closed||insideGate||!circleRect(x,y,TRACK.radius,gate));
 if(allowed(p.x+dx,p.y))p.x+=dx;else{p.hit=true;p.speed*=.2;if(closed&&!insideGate&&circleRect(p.x+dx,p.y,TRACK.radius,gate))p.gateHitAt=now;}
 if(allowed(p.x,p.y+dy))p.y+=dy;else{p.hit=true;p.speed*=.2;if(closed&&!insideGate&&circleRect(p.x,p.y+dy,TRACK.radius,gate))p.gateHitAt=now;}
}
export function crosses(before,after,g){const a=g.axis==='x'?before.x:before.y,b=g.axis==='x'?after.x:after.y;if(!(g.direction>0?a<g.line&&b>=g.line:a>g.line&&b<=g.line))return false;const t=(g.line-a)/(b-a),cross=g.axis==='x'?before.y+(after.y-before.y)*t:before.x+(after.x-before.x)*t;return cross>=g.min&&cross<=g.max;}
export function progressScore(p){if(p.finishMs!==null)return Infinity;const g=TRACK.gates[p.checkpoint]||TRACK.finish,target=g.target,prev=p.checkpoint?TRACK.gates[p.checkpoint-1].target:TRACK.finish.target;const distance=Math.hypot(target.x-prev.x,target.y-prev.y)||1;return p.lap*5+p.checkpoint+Math.max(0,Math.min(.99,1-Math.hypot(p.x-target.x,p.y-target.y)/distance));}
export function orderPlayers(players){return [...players].sort((a,b)=>{if(a.finishMs!==null||b.finishMs!==null)return(a.finishPlace??Infinity)-(b.finishPlace??Infinity);if(a.dnf!==b.dnf)return a.dnf?1:-1;return progressScore(b)-progressScore(a)||a.id.localeCompare(b.id);}).map(p=>p.id);}
export function advanceRace(room,dt,now){
 if(room.phase!=='racing')return;
 // Small physics steps prevent cars tunneling through walls on a delayed tick.
 const steps=Math.max(1,Math.ceil(dt/(1/60))),step=dt/steps,finishers=[];
 for(const p of room.players.values()){
  if(!p.connected||p.dnf||p.finishMs!==null){p.speed=0;continue;}
  const input=now-p.inputAt<=250?p.input:{x:0,y:0,brake:true};
  for(let i=0;i<steps;i++){
   const before={x:p.x,y:p.y};integrateMotion(p,input,step,room,now-dt*1000+(i+1)*step*1000);
   if(p.checkpoint<4&&crosses(before,p,TRACK.gates[p.checkpoint]))p.checkpoint++;
   if(p.checkpoint===4&&crosses(before,p,TRACK.finish)){
    p.lap++;p.checkpoint=0;
    if(p.lap===TRACK.laps){const f=(TRACK.finish.line-before.x)/(p.x-before.x);finishers.push({p,elapsed:Math.max(0,now-room.raceAt-dt*1000+(i+f)*step*1000)});p.speed=0;break;}
   }
  }
 }
 // Sub-tick crossing time determines ties, never the iteration order or a client claim.
 finishers.sort((a,b)=>a.elapsed-b.elapsed||a.p.id.localeCompare(b.p.id));
 for(const {p,elapsed} of finishers){if(p.finishMs!==null||elapsed>room.endAt-room.raceAt)continue;p.finishMs=Math.round(elapsed);p.finishPlace=++room.finishCount;room.endAt=Math.min(room.endAt,now+LIMITS.finishWindow);}
 collectPickups(room,now);
 for(const [kind,h] of Object.entries(room.hazards??{}))if(now>=h.unlockAt)delete room.hazards[kind];
 if(now>=room.endAt||[...room.players.values()].every(p=>p.finishMs!==null||p.dnf)){
  room.phase='results';room.finishedAt=now;room.lastActivity=now;for(const p of room.players.values())if(p.finishMs===null)p.dnf=true;
 }
}
