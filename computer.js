// Server-only computer opponent. It submits ordinary direction/brake inputs;
// shared physics, checkpoints, pickups and finish rules remain the referee.
const route=[[175,185],[820,185],[820,510],[180,510],[180,185],[320,185],[820,185],[820,510],[180,510],[180,185],[320,185]];
export function computerInput(p){
 const driver=p.computerDriver??(p.computerDriver={index:0});
 let target=route[Math.min(driver.index,route.length-1)],dx=target[0]-p.x,dy=target[1]-p.y,distance=Math.hypot(dx,dy);
 if(distance<11&&driver.index<route.length-1){driver.index++;target=route[driver.index];dx=target[0]-p.x;dy=target[1]-p.y;distance=Math.hypot(dx,dy);}
 const cornerBrake=distance<80&&p.speed>Math.max(35,Math.sqrt(Math.max(0,distance-6)*650));
 // A steady, beatable practice pace. No teleporting, hidden speed boost or rubber banding.
 return{x:dx/Math.max(1,distance),y:dy/Math.max(1,distance),brake:cornerBrake||p.speed>155};
}
export function computerAbility(room,p,now){
 if(now<(p.computerAbilityAt??room.raceAt+6000))return null;
 p.computerAbilityAt=now+8000;
 const rival=[...room.players.values()].find(q=>!q.isBot&&q.connected&&!q.dnf&&q.finishMs===null);
 if(!rival)return null;
 const kind=rival.checkpoint===1?'oil':rival.checkpoint===2?'belt':'gate';
 return{kind,raceId:room.raceId,requestId:'cpu-'+room.raceId+'-'+now};
}
