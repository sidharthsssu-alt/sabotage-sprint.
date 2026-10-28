import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {Server} from 'socket.io';
import {TRACK,LIMITS,spawn,advanceRace,orderPlayers,resetTactics,activateTactic,hazardStatus} from './game.js';
const root=fileURLToPath(new URL('./public/',import.meta.url));
const files=new Map([['/',['index.html','text/html']],['/app.js',['app.js','text/javascript']],['/style.css',['style.css','text/css']]]);
export function createGameServer({clock=Date.now,tickMs=50}={}){
 const rooms=new Map();
 const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');
  res.setHeader('Content-Security-Policy',"default-src 'self'; connect-src 'self' ws: wss:; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'");
  const path=new URL(req.url,'http://localhost').pathname;
  if(path==='/health'){res.writeHead(200,{'Content-Type':'application/json'});return res.end('{"ok":true}');}
  if(path==='/physics.js'){res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store'});return res.end(await readFile(new URL('./game.js',import.meta.url)));}
  const entry=files.get(path);if(!entry){res.writeHead(404);return res.end('Not found');}
  try{const bytes=await readFile(root+entry[0]);res.writeHead(200,{'Content-Type':entry[1]+'; charset=utf-8','Cache-Control':'no-store'});res.end(bytes);}catch{res.writeHead(500);res.end('Unable to load game');}
 });
 const io=new Server(server,{maxHttpBufferSize:2048,serveClient:true,pingTimeout:10000});
 const colors=['#f5684c','#708cff','#d99b20','#a36bce','#29967e','#d75281','#4587bd','#ba7150'];
 function snapshot(r){return{code:r.code,host:r.host,phase:r.phase,raceAt:r.raceAt,raceId:r.raceId,endAt:r.endAt,finishedAt:r.finishedAt,hazards:r.hazards,pickups:r.pickups,tacticEvents:r.tacticEvents,order:orderPlayers(r.players.values()),revision:r.revision,message:r.message,players:[...r.players.values()].map(p=>({id:p.id,name:p.name,color:p.color,connected:p.connected,x:p.x,y:p.y,angle:p.angle,speed:p.speed,lap:p.lap,checkpoint:p.checkpoint,finishMs:p.finishMs,finishPlace:p.finishPlace,dnf:p.dnf,lastSeq:p.lastSeq,charges:p.charges,nextSabotageAt:p.nextSabotageAt,hazardStatus:hazardStatus(p,r,clock())})),time:clock()};}
 const broadcast=r=>{r.revision++;io.to(r.code).emit('state',snapshot(r));};
 const roomFor=s=>rooms.get(s.data.code);
 const playerFor=(s,r)=>r?.players.get(s.data.playerId);
 const connected=r=>[...r.players.values()].filter(p=>p.connected);
 function reconcile(r){
  if(!r.players.get(r.host)?.connected)r.host=connected(r)[0]?.id??null;
  if(r.phase==='countdown'&&connected(r).length<LIMITS.minPlayers){r.phase='lobby';r.raceAt=0;r.message='Countdown canceled. At least two connected players are needed.';}
 }
 function remove(s,explicit=false){
  const r=roomFor(s),p=playerFor(s,r);if(!p||p.socketId!==s.id)return;
  p.connected=false;p.input={x:0,y:0,brake:true};p.speed=0;p.disconnectedAt=clock();s.leave(r.code);s.data.code=null;s.data.playerId=null;
  if(explicit){p.token=null;if(r.phase==='lobby')r.players.delete(p.id);else p.dnf=p.finishMs===null;}
  reconcile(r);if(!r.players.size)rooms.delete(r.code);else broadcast(r);
 }
 io.on('connection',s=>{
  if(io.engine.clientsCount>800)return s.disconnect(true);
  const reply=(ack,value)=>{if(typeof ack==='function')ack(value);};
  s.on('enter',(data,ack)=>{
   const now=clock();if(now-(s.data.lastEnter??-Infinity)<500)return reply(ack,{error:'Please wait a moment before trying again.'});s.data.lastEnter=now;
   if(roomFor(s))return reply(ack,{error:'Leave your current room first.'});
   if(!data||typeof data.name!=='string'||!data.name.trim()||data.name.length>20)return reply(ack,{error:'Enter a nickname (1–20 characters).'});
   let r;
   if(data.create===true){
    if(rooms.size>=100)return reply(ack,{error:'Server busy. Try again shortly.'});
    let code;do{code=randomBytes(4).toString('hex').slice(0,6).toUpperCase();}while(rooms.has(code));
    r={code,host:null,phase:'lobby',players:new Map(),raceAt:0,lastActivity:now,revision:0,message:'',raceId:0,endAt:0,finishedAt:null,finishCount:0};resetTactics(r);rooms.set(code,r);
   }else{
    if(typeof data.code!=='string'||!/^([A-Fa-f0-9]{6})$/.test(data.code.trim()))return reply(ack,{error:'Enter a valid six-character room code.'});
    r=rooms.get(data.code.trim().toUpperCase());if(!r)return reply(ack,{error:'Room not found or expired. Check the code.'});
   }
   let p=typeof data.token==='string'?[...r.players.values()].find(p=>p.token===data.token&&!p.connected&&now-p.disconnectedAt<=LIMITS.reconnectGrace):null;
   const resumed=!!p;
   if(!p){
    if(r.phase!=='lobby')return reply(ack,{error:'Race in progress. Ask the host to return to the lobby.'});
    if(r.players.size>=LIMITS.maxPlayers)return reply(ack,{error:'Room full (8 players). Disconnected seats are held for 15 seconds.'});
    const used=new Set([...r.players.values()].map(p=>p.color));
    p={id:randomBytes(8).toString('hex'),token:randomBytes(24).toString('hex'),name:data.name.trim(),color:colors.find(c=>!used.has(c))};spawn(p,r.players.size);r.players.set(p.id,p);
   }
   Object.assign(p,{connected:true,socketId:s.id,disconnectedAt:0,input:{x:0,y:0,brake:true},inputAt:0,lastSeq:-1});s.data.code=r.code;s.data.playerId=p.id;if(!r.host)r.host=p.id;r.lastActivity=now;r.message='';s.join(r.code);
   reply(ack,{ok:true,id:p.id,token:p.token,code:r.code,name:p.name,resumed});broadcast(r);
  });
  s.on('start',(_,ack)=>{
   const r=roomFor(s);if(!r||r.host!==s.data.playerId)return reply(ack,{error:'Only the host can start.'});
   if(r.phase!=='lobby')return reply(ack,{error:'A countdown or race is already running.'});
   if(connected(r).length<LIMITS.minPlayers)return reply(ack,{error:'Need at least 2 connected players to start.'});
   for(const [id,p] of r.players)if(!p.connected)r.players.delete(id);
   resetTactics(r);r.phase='countdown';r.raceId++;r.finishedAt=null;r.finishCount=0;r.raceAt=clock()+LIMITS.countdown;r.endAt=r.raceAt+LIMITS.raceLimit;r.lastActivity=clock();r.message='';let i=0;for(const p of r.players.values())spawn(p,i++);broadcast(r);reply(ack,{ok:true,raceAt:r.raceAt});
  });
  s.on('lobby',(_,ack)=>{
   const r=roomFor(s);if(!r||r.host!==s.data.playerId)return reply(ack,{error:'Only the host can return everyone to the lobby.'});
   if(r.phase==='racing')return reply(ack,{error:'Wait for the race to finish before returning to the lobby.'});
   for(const [id,p] of r.players)if(!p.connected)r.players.delete(id);
   resetTactics(r);r.phase='lobby';r.raceId++;r.raceAt=0;r.endAt=0;r.finishedAt=null;r.message='';r.lastActivity=clock();let i=0;for(const p of r.players.values())spawn(p,i++);broadcast(r);reply(ack,{ok:true});
  });
  s.on('input',data=>{
   const r=roomFor(s),p=playerFor(s,r);if(!['countdown','racing'].includes(r?.phase)||!p||!p.connected||p.finishMs!==null||p.dnf||!data||data.raceId!==r.raceId||!Number.isFinite(data.x)||!Number.isFinite(data.y)||typeof data.brake!=='boolean'||!Number.isSafeInteger(data.seq)||data.seq<0||data.seq>1e12||data.seq<=p.lastSeq)return;
   const now=clock();if(now-(s.data.inputWindow??-Infinity)>=1000){s.data.inputWindow=now;s.data.inputCount=0;}if((s.data.inputCount=(s.data.inputCount??0)+1)>60)return;p.input={x:Math.max(-1,Math.min(1,data.x)),y:Math.max(-1,Math.min(1,data.y)),brake:data.brake};p.inputAt=now;p.lastSeq=data.seq;
  });
  s.on('sabotage',(data,ack)=>{
   const now=clock();if(now-(s.data.tacticWindow??-Infinity)>=1000){s.data.tacticWindow=now;s.data.tacticCount=0;}if((s.data.tacticCount=(s.data.tacticCount??0)+1)>8)return reply(ack,{error:'Too many requests. Please wait.'});
   const r=roomFor(s),p=playerFor(s,r),result=activateTactic(r,p,data,now);reply(ack,result);if(result.ok&&!result.duplicate)broadcast(r);
  });
  s.on('leave',()=>remove(s,true));s.on('disconnect',()=>remove(s));
 });
 let last=clock();
 const tick=setInterval(()=>{
  const now=clock(),dt=Math.max(0,Math.min((now-last)/1000,.08));last=now;
  for(const r of rooms.values()){
   let changed=false;
   for(const [id,p] of r.players)if(!p.connected&&p.token!==null&&now-p.disconnectedAt>LIMITS.reconnectGrace){p.token=null;if(r.phase==='lobby')r.players.delete(id);else p.dnf=p.finishMs===null;changed=true;}
   if(!r.players.size||![...r.players.values()].some(p=>p.connected||now-p.disconnectedAt<=LIMITS.reconnectGrace)){rooms.delete(r.code);continue;}
   if(['lobby','results'].includes(r.phase)&&now-r.lastActivity>LIMITS.idleLobby){io.to(r.code).emit('expired');for(const s of io.sockets.sockets.values())if(s.data.code===r.code){s.leave(r.code);s.data.code=null;s.data.playerId=null;}rooms.delete(r.code);continue;}
   reconcile(r);
   if(r.phase==='countdown'&&now>=r.raceAt){r.phase='racing';changed=true;}
   if(r.phase==='racing'){const before=r.phase;advanceRace(r,Math.min(dt,Math.max(0,(now-r.raceAt)/1000)),now);if(r.phase!==before)changed=true;}
   if(changed||['racing','countdown'].includes(r.phase)||now%1000<60)broadcast(r);
  }
 },tickMs);
 return{server,io,rooms,close:()=>new Promise(resolve=>{clearInterval(tick);io.close(()=>server.close(()=>resolve()));})};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){const game=createGameServer(),flag=process.argv.indexOf('--port'),port=Number(process.env.PORT)||Number(flag>=0?process.argv[flag+1]:0)||3000;game.server.listen(port,'0.0.0.0',()=>console.log(`Sabotage Sprint foundation listening on ${port}`));process.on('SIGTERM',async()=>{await game.close();process.exit(0);});}
