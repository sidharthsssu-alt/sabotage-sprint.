// Shared geometry and deterministic motion. The server alone awards hits and finishes.
const route=[[260,180],[2100,180],[2100,500],[1450,500],[1450,900],[2200,900],[2200,1250],[400,1250],[400,850],[850,850],[850,550],[260,550]];
const gates=route.map((a,i)=>{const b=route[(i+1)%route.length],horizontal=a[1]===b[1],direction=Math.sign(horizontal?b[0]-a[0]:b[1]-a[1]),line=(horizontal?a[0]:a[1])*.35+(horizontal?b[0]:b[1])*.65;return{axis:horizontal?'x':'y',line,direction,min:(horizontal?a[1]:a[0])-75,max:(horizontal?a[1]:a[0])+75,label:['LAUNCH STRAIGHT','DOCKSIDE DROP','SWITCHBACK','FOUNDRY DESCENT','TURBO ALLEY','LAST DROP','BACK STRAIGHT','WAREHOUSE BEND','S-BEND ENTRY','S-BEND EXIT','HOME STRAIGHT','FINAL TURN'][i],target:{x:horizontal?line+direction*35:a[0],y:horizontal?a[1]:line+direction*35}};});
export const TRACK={width:2420,height:1430,radius:12,laps:2,maxSpeed:300,acceleration:650,coast:600,braking:1400,turnRate:15,roadWidth:150,route,gates,
 outer:{x:80,y:50,w:2260,h:1320},inner:{x:0,y:0,w:0,h:0},
 obstacles:[],
 finish:{axis:'x',line:360,direction:1,min:105,max:255,target:{x:360,y:180}}};
export const TACTICS={initialCharges:3,maxCharges:5,cooldown:3000,recovery:0,abilities:{shot:{name:'Pulse Shot',warning:100,duration:1500,description:'Shoot straight ahead · slows one rival'},bomb:{name:'Drop Bomb',warning:1400,duration:350,description:'Drop behind · flashes before exploding'},boost:{name:'Nitro',warning:0,duration:1800,description:'Your car gets a short speed boost'}},pickups:[{id:'launch',x:850,y:180},{id:'dock',x:2100,y:400},{id:'foundry',x:1450,y:740},{id:'turbo',x:1850,y:900},{id:'back',x:1100,y:1250},{id:'esses',x:850,y:700}]};
export function resetTactics(room){room.hazards={};room.pickups=TACTICS.pickups.map(p=>({id:p.id,claimedBy:null}));room.tacticSerial=0;room.tacticEvents=[];}
export function feed(room,text,now){room.tacticEvents??=[];room.tacticEvents.push({eventId:'event-'+room.raceId+'-'+(++room.tacticSerial),text,at:now});room.tacticEvents=room.tacticEvents.slice(-6);}
export function isActive(room,kind,now){return room?.phase==='racing'&&Object.values(room.hazards??{}).some(h=>h.kind===kind&&now>=h.activeAt&&now<h.endsAt);}
export function hazardStatus(p,room,now){if(room?.phase!=='racing'||p.finishMs!==null||p.dnf)return '';return now<(p.slowUntil??0)?'HIT! Recovering…':now<(p.boostUntil??0)?'NITRO! +30% speed':'';}
export function segmentDistance(x,y,a,b){const dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/(dx*dx+dy*dy||1)));return Math.hypot(x-a[0]-t*dx,y-a[1]-t*dy);}
export function circleRect(x,y,r,b){const cx=Math.max(b.x,Math.min(x,b.x+b.w)),cy=Math.max(b.y,Math.min(y,b.y+b.h));return(x-cx)**2+(y-cy)**2<r*r;}
export function validPosition(x,y,r=TRACK.radius){return Number.isFinite(x)&&Number.isFinite(y)&&TRACK.route.some((a,i)=>segmentDistance(x,y,a,TRACK.route[(i+1)%TRACK.route.length])<=TRACK.roadWidth/2-r)&&!TRACK.obstacles.some(b=>circleRect(x,y,r,b));}
export function activateTactic(room,p,data,now){
 if(!room||room.phase!=='racing'||now>=room.endAt||!p?.connected||p.finishMs!==null||p.dnf)return{error:'Abilities are only available to active racers.'};
 if(!data||data.raceId!==room.raceId||typeof data.kind!=='string'||!Object.hasOwn(TACTICS.abilities,data.kind)||typeof data.requestId!=='string'||!/^[-a-zA-Z0-9_]{1,64}$/.test(data.requestId))return{error:'Invalid ability request or old race.'};
 const previous=p.actions.find(a=>a.requestId===data.requestId);if(previous)return previous.kind===data.kind?{ok:true,duplicate:true,eventId:previous.eventId}:{error:'That request ID was already used.'};
 if(data.kind!=='boost'&&![...room.players.values()].some(q=>q.id!==p.id&&q.connected&&q.finishMs===null&&!q.dnf))return{error:'No eligible rival is still racing.'};
 if(p.charges<1)return{error:'No charges. Collect a lightning pickup.'};if(now<p.nextSabotageAt)return{error:'Your abilities are cooling down.'};
 const spec=TACTICS.abilities[data.kind],eventId=room.raceId+'-'+(++room.tacticSerial),h={kind:data.kind,eventId,owner:p.id,ownerName:p.name,warningAt:now,activeAt:now+spec.warning,endsAt:now+spec.warning+spec.duration,unlockAt:now+spec.warning+spec.duration,x:p.x,y:p.y,angle:p.angle,hitIds:[]};
 if(data.kind==='shot'){h.x+=Math.cos(p.angle)*28;h.y+=Math.sin(p.angle)*28;h.vx=Math.cos(p.angle)*650;h.vy=Math.sin(p.angle)*650;}
 if(data.kind==='bomb'){const x=p.x-Math.cos(p.angle)*36,y=p.y-Math.sin(p.angle)*36;if(validPosition(x,y)){h.x=x;h.y=y;}h.radius=95;}
 if(data.kind==='boost')p.boostUntil=h.endsAt;
 room.hazards[eventId]=h;p.charges--;p.nextSabotageAt=now+TACTICS.cooldown;p.actions.push({requestId:data.requestId,kind:data.kind,eventId});
 feed(room,p.name+(data.kind==='shot'?' fired a Pulse Shot!':data.kind==='bomb'?' dropped a bomb! Watch the flashing ring.':' used Nitro!'),now);return{ok:true,eventId};
}
function applyHit(room,h,p,now){if(p.id===h.owner||!p.connected||p.dnf||p.finishMs!==null||h.hitIds.includes(p.id)||now<(p.immuneUntil??0))return false;h.hitIds.push(p.id);p.slowUntil=now+1100;p.immuneUntil=now+2400;p.speed*=.6;feed(room,h.ownerName+' hit '+p.name+' with '+(h.kind==='shot'?'a Pulse Shot!':'a bomb!'),now);return true;}
export function advanceWeapons(room,dt,now){
 for(const [id,h] of Object.entries(room.hazards??{})){
  if(now>=h.endsAt){delete room.hazards[id];continue;}
  if(h.kind==='shot'&&now>=h.activeAt){const travel=Math.min(dt,Math.max(0,(now-h.activeAt)/1000)),steps=Math.max(1,Math.ceil(travel/.01));let removed=false;for(let i=0;i<steps&&!removed;i++){h.x+=h.vx*travel/steps;h.y+=h.vy*travel/steps;if(!validPosition(h.x,h.y,3)){removed=true;break;}for(const p of room.players.values())if(Math.hypot(p.x-h.x,p.y-h.y)<TRACK.radius+7&&applyHit(room,h,p,now)){removed=true;break;}}if(removed)delete room.hazards[id];}
  if(h.kind==='bomb'&&now>=h.activeAt)for(const p of room.players.values())if(Math.hypot(p.x-h.x,p.y-h.y)<h.radius)applyHit(room,h,p,now);
 }
}
export function collectPickups(room,now){if(room.phase!=='racing')return;for(const token of room.pickups??[]){if(token.claimedBy!==null)continue;const l=TACTICS.pickups.find(p=>p.id===token.id);const eligible=[...room.players.values()].filter(p=>p.connected&&!p.dnf&&p.finishMs===null&&p.charges<TACTICS.maxCharges).map(p=>({p,d:Math.hypot(p.x-l.x,p.y-l.y)})).filter(a=>a.d<28).sort((a,b)=>a.d-b.d||a.p.id.localeCompare(b.p.id));if(eligible.length){const p=eligible[0].p;token.claimedBy=p.id;p.charges++;feed(room,p.name+' collected a charge.',now);}}}
export const LIMITS={minPlayers:2,maxPlayers:8,countdown:5000,reconnectGrace:15000,idleLobby:20*60*1000,raceLimit:240000,finishWindow:150000};
export function spawn(p,index){Object.assign(p,{x:260-Math.floor(index/4)*44,y:140+(index%4)*27,angle:0,speed:0,input:{x:0,y:0,brake:false},inputAt:0,lastSeq:-1,lap:0,checkpoint:0,finishMs:null,finishPlace:null,dnf:false,hit:false,charges:TACTICS.initialCharges,nextSabotageAt:0,actions:[],slowUntil:0,immuneUntil:0,boostUntil:0});}
export const angleDelta=(a,b)=>Math.atan2(Math.sin(b-a),Math.cos(b-a));
export function integrateMotion(p,input,dt,room=null,now=0){
 p.hit=false;const throttle=!input.brake&&Math.hypot(input.x,input.y)>.01,slow=now<(p.slowUntil??0),boost=now<(p.boostUntil??0),maxSpeed=TRACK.maxSpeed*(slow?.6:boost?1.3:1);
 if(throttle){const desired=Math.atan2(input.y,input.x),delta=angleDelta(p.angle,desired);p.angle+=Math.max(-TRACK.turnRate*dt,Math.min(TRACK.turnRate*dt,delta));p.speed=Math.min(maxSpeed,p.speed+TRACK.acceleration*dt);if(Math.abs(delta)>.65)p.speed=Math.min(p.speed,maxSpeed*.6);}
 else p.speed=Math.max(0,Math.min(maxSpeed,p.speed-(input.brake?TRACK.braking:TRACK.coast)*dt));
 const dx=Math.cos(p.angle)*p.speed*dt,dy=Math.sin(p.angle)*p.speed*dt;
 if(validPosition(p.x+dx,p.y))p.x+=dx;else{p.hit=true;p.speed*=.25;}
 if(validPosition(p.x,p.y+dy))p.y+=dy;else{p.hit=true;p.speed*=.25;}
}
export function crosses(before,after,g){const a=g.axis==='x'?before.x:before.y,b=g.axis==='x'?after.x:after.y;if(!(g.direction>0?a<g.line&&b>=g.line:a>g.line&&b<=g.line))return false;const t=(g.line-a)/(b-a),cross=g.axis==='x'?before.y+(after.y-before.y)*t:before.x+(after.x-before.x)*t;return cross>=g.min&&cross<=g.max;}
export function progressScore(p){if(p.finishMs!==null)return Infinity;const n=TRACK.gates.length,g=TRACK.gates[p.checkpoint]||TRACK.finish,target=g.target,prev=p.checkpoint?TRACK.gates[p.checkpoint-1].target:TRACK.finish.target;return p.lap*(n+1)+p.checkpoint+Math.max(0,Math.min(.99,1-Math.hypot(p.x-target.x,p.y-target.y)/Math.max(1,Math.hypot(target.x-prev.x,target.y-prev.y))));}
export function orderPlayers(players){return[...players].sort((a,b)=>{if(a.finishMs!==null||b.finishMs!==null)return(a.finishPlace??Infinity)-(b.finishPlace??Infinity);if(a.dnf!==b.dnf)return a.dnf?1:-1;return progressScore(b)-progressScore(a)||a.id.localeCompare(b.id);}).map(p=>p.id);}
export function advanceRace(room,dt,now){
 if(room.phase!=='racing')return;advanceWeapons(room,dt,now);
 const steps=Math.max(1,Math.ceil(dt/(1/60))),step=dt/steps,finishers=[],n=TRACK.gates.length;
 for(const p of room.players.values()){
  if(!p.connected||p.dnf||p.finishMs!==null){p.speed=0;continue;}const input=now-p.inputAt<=250?p.input:{x:0,y:0,brake:true};
  for(let i=0;i<steps;i++){const before={x:p.x,y:p.y};integrateMotion(p,input,step,room,now-dt*1000+(i+1)*step*1000);if(p.checkpoint<n&&crosses(before,p,TRACK.gates[p.checkpoint]))p.checkpoint++;if(p.checkpoint===n&&crosses(before,p,TRACK.finish)){p.lap++;p.checkpoint=0;if(p.lap===TRACK.laps){const f=(TRACK.finish.line-before.x)/(p.x-before.x);finishers.push({p,elapsed:Math.max(0,now-room.raceAt-dt*1000+(i+f)*step*1000)});p.speed=0;break;}}}
 }
 finishers.sort((a,b)=>a.elapsed-b.elapsed||a.p.id.localeCompare(b.p.id));for(const {p,elapsed}of finishers){if(p.finishMs!==null||elapsed>room.endAt-room.raceAt)continue;p.finishMs=Math.round(elapsed);p.finishPlace=++room.finishCount;room.endAt=Math.min(room.endAt,now+LIMITS.finishWindow);}
 collectPickups(room,now);if(now>=room.endAt||[...room.players.values()].every(p=>p.finishMs!==null||p.dnf)){room.phase='results';room.finishedAt=now;room.lastActivity=now;room.hazards={};for(const p of room.players.values())if(p.finishMs===null)p.dnf=true;}
}
