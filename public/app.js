import {TRACK,LIMITS,integrateMotion,angleDelta,validPosition,TACTICS,isActive,hazardStatus,progressScore} from '/physics.js';
const $=id=>document.getElementById(id);
const socket=io({forceNew:true,reconnectionAttempts:12,reconnectionDelay:500,reconnectionDelayMax:2000});
let state=null,myId=null,seat=null,offset=0,busy=false,keys=new Set(),touch=new Map(),lastPhase=null,predicted=null,seq=0,lastInput='',lastSent=0,lastRace=null,rendered=new Map(),tacticPending=false,actionSerial=0,lastFeedId=null,lastOwnStatus='',soundEnabled=false,audio=null;
const canvas=$('game'),ctx=canvas.getContext('2d');
const notify=text=>{$('message').textContent=text;};
const reduceMotion=window.matchMedia('(prefers-reduced-motion: reduce)');
const particles=[],hazardVisuals=new Map();let finishUntil=0,pickupUntil=0,lastCount=null;
const pickupToast=document.createElement('div');pickupToast.id='pickupToast';pickupToast.className='hidden';pickupToast.setAttribute('role','status');document.querySelector('.stage').append(pickupToast);
const now=()=>Date.now()+offset;
const format=ms=>{const s=Math.max(0,ms)/1000;return String(Math.floor(s/60)).padStart(2,'0')+':'+(s%60).toFixed(2).padStart(5,'0');};
try{seat=JSON.parse(sessionStorage.getItem('sprint-stage1-seat')||'null');$('name').value=sessionStorage.getItem('sprint-name')||'';}catch{}
$('code').value=(new URLSearchParams(location.search).get('room')||'').slice(0,6);
function remember(value){seat=value;try{value?sessionStorage.setItem('sprint-stage1-seat',JSON.stringify(value)):sessionStorage.removeItem('sprint-stage1-seat');}catch{}}
function request(event,data,callback=()=>{}){socket.timeout(5000).emit(event,data,(err,r)=>{if(err){notify('No response from the server. Check your connection and try again.');callback({error:'timeout'});return;}if(r?.error)notify(r.error);callback(r||{});});}
function reset(){state=null;myId=null;lastPhase=null;predicted=null;rendered.clear();stop();render();}
function persist(r,name){myId=r.id;remember({id:r.id,token:r.token,code:r.code,name:r.name||name});}
socket.on('connect',()=>{$('connection').textContent='● Connected';$('connection').className='live';$('retry').classList.add('hidden');seq=0;lastInput='';if(seat){request('enter',{name:seat.name,code:seat.code,token:seat.token},r=>{if(r.ok){persist(r,seat.name);notify(r.resumed?'Reconnected. Your racer is restored.':'Your previous seat expired. You joined the lobby with a new seat.');}else if(r.error!=='timeout'){remember(null);reset();}});}render();});
socket.on('disconnect',()=>{$('connection').textContent='○ Reconnecting';$('connection').className='';stop();notify('Connection lost. Reconnecting automatically; your seat is held for 15 seconds.');render();});
socket.on('connect_error',()=>{$('connection').textContent='○ Server unavailable';$('connection').className='';notify('Cannot reach the server. Check your connection.');});
socket.io.on('reconnect_failed',()=>{$('connection').textContent='○ Offline';$('retry').classList.remove('hidden');notify('Automatic reconnect stopped. Select Retry connection to try again.');});
$('retry').onclick=()=>socket.connect();
socket.on('expired',()=>{remember(null);reset();notify('This idle room expired. Create a new room.');});
function enter(create){if(busy)return;if(!socket.connected)return notify('Wait for the server connection.');const name=$('name').value.trim();if(!name)return $('name').reportValidity();busy=true;$('create').disabled=$('join').disabled=true;request('enter',{create,name,code:$('code').value},r=>{busy=false;$('create').disabled=$('join').disabled=false;if(r.ok){persist(r,name);try{sessionStorage.setItem('sprint-name',name);}catch{}notify(create?'Room created. Invite your crew.':'Joined the room. Your host can start the race.');}});}
$('create').onclick=()=>enter(true);$('joinForm').onsubmit=e=>{e.preventDefault();enter(false);};
$('start').onclick=()=>request('start',{});$('back').onclick=$('resultLobby').onclick=()=>request('lobby',{});
$('rematch').onclick=()=>request('lobby',{},r=>{if(r.ok)request('start',{});});
$('help').onclick=()=>{stop();$('helpDialog').showModal();};
$('closeHelp').onclick=$('readyHelp').onclick=()=>$('helpDialog').close();
$('leave').onclick=()=>{socket.emit('leave');remember(null);reset();notify('You left the room.');};
$('copy').onclick=async()=>{try{await navigator.clipboard.writeText($('invite').value);notify('Invite copied. Share it with your crew.');}catch{$('invite').focus();$('invite').select();notify('Copy the selected join URL, or share the room code.');}};
socket.on('state',next=>{
 if(!myId||next.code!==seat?.code||!next.players.some(p=>p.id===myId&&p.connected))return;
 offset=next.time-Date.now();polishEvents(state,next);const phaseChanged=lastPhase!==next.phase,raceChanged=lastRace!==next.raceId;state=next;lastPhase=next.phase;lastRace=next.raceId;
 const me=next.players.find(p=>p.id===myId);
 if(raceChanged){particles.length=0;hazardVisuals.clear();finishUntil=0;pickupUntil=0;lastCount=null;lastFeedId=null;lastOwnStatus='';$('tacticFeed').textContent='';$('effectNotice').textContent='';keys.clear();touch.clear();lastInput='';rendered.clear();}
 if(me){if(!predicted||raceChanged||next.phase!=='racing'||me.finishMs!==null||me.dnf||Math.hypot(predicted.x-me.x,predicted.y-me.y)>65)predicted={...me};else{predicted.x+=(me.x-predicted.x)*.3;predicted.y+=(me.y-predicted.y)*.3;predicted.angle+=angleDelta(predicted.angle,me.angle)*.25;predicted.speed=me.speed;if(!validPosition(predicted.x,predicted.y))predicted={...me};}}
 render();updateTacticUI();updateTacticAnnouncements();if(phaseChanged)window.scrollTo({top:0,left:0,behavior:'instant'});
});
function render(){
 const active=!!state;document.body.classList.toggle('in-room',active);document.body.classList.toggle('in-race',active&&state.phase!=='lobby');$('room').classList.toggle('hidden',!active);$('arena').classList.toggle('hidden',!active);$('leave').classList.toggle('hidden',!active);
 if(!active){$('countdown').classList.add('hidden');return;}
 const host=state.host===myId,online=state.players.filter(p=>p.connected).length,me=state.players.find(p=>p.id===myId);
 $('roomcode').textContent=state.code;$('count').textContent=online+' connected / '+state.players.length+' seats / 8 max';
 const url=new URL(location.href);url.search='';url.hash='';url.searchParams.set('room',state.code);$('invite').value=url.href;
 $('start').classList.toggle('hidden',!host||state.phase!=='lobby');$('start').disabled=online<2||!socket.connected;
 $('back').classList.toggle('hidden',!host||!['countdown','results'].includes(state.phase));$('back').disabled=!socket.connected;
 $('roomhelp').textContent=state.message||(host?(online<2?'Invite one more player to enable Start Race.':'You are the host. Start when everyone is here.'):'Your host controls the start.');
 $('progressBar').value=Math.min(10,Math.max(0,me?progressScore(me):0));
 $('phase').textContent={lobby:'Waiting in lobby',countdown:'On the starting grid',racing:'Race in progress',results:'Race complete'}[state.phase];
 $('controls').classList.toggle('hidden',!['countdown','racing'].includes(state.phase)||me?.finishMs!==null||me?.dnf);
 $('results').classList.toggle('hidden',state.phase!=='results');
 const signature=JSON.stringify(state.players.map(p=>[p.id,p.name,p.connected,p.color,state.host===p.id]));
 if($('players').dataset.signature!==signature){$('players').dataset.signature=signature;$('players').replaceChildren(...state.players.map(p=>{const li=document.createElement('li'),top=document.createElement('div'),dot=document.createElement('span'),name=document.createElement('span'),status=document.createElement('small');top.className='playerTop';dot.className='dot';dot.style.backgroundColor=racerColor(p.color);name.textContent=p.name+(p.id===myId?' (you)':'');status.textContent=(p.id===state.host?'HOST · ':'')+(p.connected?'Connected':'Disconnected · reconnecting');top.append(dot,name);li.append(top,status);return li;}));}
 $('position').textContent=(state.order.indexOf(myId)+1||'—')+' / '+state.players.length;$('lap').textContent=Math.min(TRACK.laps,(me?.lap??0)+1)+' / '+TRACK.laps;$('next').textContent=me?.finishMs!==null&&me?.finishMs!==undefined?'DONE':me?.checkpoint===4?'FINISH':String((me?.checkpoint??0)+1).padStart(2,'0');
 const rankSig=JSON.stringify(state.order.map(id=>{const p=state.players.find(p=>p.id===id);return[id,p.name,p.lap,p.checkpoint,p.finishMs,p.dnf,p.connected];}));
 if($('standings').dataset.signature!==rankSig){$('standings').dataset.signature=rankSig;$('standings').replaceChildren(...state.order.map((id,i)=>{const p=state.players.find(p=>p.id===id),el=document.createElement('div'),rank=document.createElement('b'),dot=document.createElement('span'),name=document.createElement('span'),small=document.createElement('small');el.className='standing'+(id===myId?' you':'')+(p.finishMs!==null?' finished':'');rank.className='rank';rank.textContent=String(i+1).padStart(2,'0');dot.className='dot';dot.style.backgroundColor=racerColor(p.color);name.className='racerName';name.textContent=p.name+(id===myId?' · YOU':'');small.textContent=p.finishMs!==null?'FINISHED · '+format(p.finishMs):p.dnf?'DID NOT FINISH':!p.connected?'RECONNECTING':'CAR '+(state.players.findIndex(q=>q.id===id)+1)+' · LAP '+(p.lap+1)+' · GATE '+p.checkpoint+'/4';el.append(rank,dot,name,small);return el;}));}
 if(state.phase==='results'){
  const winner=state.players.find(p=>p.finishPlace===1);$('winner').textContent=winner?winner.name+' wins!':'Time’s up';$('resultDetail').textContent=winner?'Winning time: '+format(winner.finishMs):'No finisher this round. Try a new racing line.';
  const resultSig=JSON.stringify(state.order.map(id=>{const p=state.players.find(p=>p.id===id);return[id,p.finishMs,p.finishPlace,p.dnf];}));
  if($('resultList').dataset.signature!==resultSig){$('resultList').dataset.signature=resultSig;$('resultList').replaceChildren(...state.order.map(id=>{const p=state.players.find(p=>p.id===id),li=document.createElement('li'),rank=document.createElement('span'),name=document.createElement('span'),time=document.createElement('b');rank.textContent=p.finishPlace??'—';name.className='resultname';name.textContent=p.name+(id===myId?' (you)':'');time.textContent=p.finishMs===null?'DNF':format(p.finishMs);li.append(rank,name,time);return li;}));}
  $('rematch').classList.toggle('hidden',!host);$('resultLobby').classList.toggle('hidden',!host);$('rematch').disabled=online<2||!socket.connected;$('rematchNote').textContent=host?(online<2?'Invite another racer from the lobby to race again.':'Race again starts a fresh countdown. Same crew. New chance.'):'Waiting for the host to start a rematch.';
 }
}
function controls(){if($('helpDialog').open)return{x:0,y:0,brake:true};const held=new Set(touch.values());return{x:(held.has('right')||keys.has('d')||keys.has('arrowright')?1:0)-(held.has('left')||keys.has('a')||keys.has('arrowleft')?1:0),y:(held.has('down')||keys.has('s')||keys.has('arrowdown')?1:0)-(held.has('up')||keys.has('w')||keys.has('arrowup')?1:0),brake:held.has('brake')||keys.has(' ')};}
function sendInput(force=false,input=controls()){if(!['racing','countdown'].includes(state?.phase)||!socket.connected)return;const signature=JSON.stringify(input),time=Date.now();if(!force&&signature===lastInput&&time-lastSent<100)return;$('controls').dataset.input=JSON.stringify(input);socket.emit('input',{...input,seq:++seq,raceId:state.raceId});lastInput=signature;lastSent=time;}
function stop(){keys.clear();touch.clear();for(const b of document.querySelectorAll('[data-key]'))b.classList.remove('pressed');if(predicted)predicted.speed=0;sendInput(true,{x:0,y:0,brake:true});}
window.addEventListener('keydown',e=>{if($('helpDialog').open||/INPUT|TEXTAREA/.test(e.target.tagName)||!['racing','countdown'].includes(state?.phase))return;const key=e.key.toLowerCase();if(['1','2','3'].includes(key)){e.preventDefault();if(!e.repeat)useAbility({1:'gate',2:'belt',3:'oil'}[key]);return;}if(['arrowup','arrowdown','arrowleft','arrowright','w','a','s','d',' '].includes(key)){e.preventDefault();keys.add(key);if(!e.repeat)sendInput(true);}});
window.addEventListener('keyup',e=>{keys.delete(e.key.toLowerCase());sendInput(true);});window.addEventListener('blur',stop);document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
for(const button of document.querySelectorAll('[data-key]')){button.onpointerdown=e=>{e.preventDefault();button.setPointerCapture(e.pointerId);touch.set(e.pointerId,button.dataset.key);button.classList.add('pressed');sendInput(true);};const up=e=>{touch.delete(e.pointerId);button.classList.toggle('pressed',[...touch.values()].includes(button.dataset.key));sendInput(true);};button.onpointerup=button.onpointercancel=button.onlostpointercapture=up;}
setInterval(()=>sendInput(),50);
function box(x,y,w,h,r,fill,stroke){ctx.beginPath();ctx.roundRect(x,y,w,h,r);if(fill){ctx.fillStyle=fill;ctx.fill();}if(stroke){ctx.strokeStyle=stroke;ctx.stroke();}}
function arrow(x,y,a){ctx.save();ctx.translate(x,y);ctx.rotate(a);ctx.strokeStyle='#93b4dd66';ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(-10,-9);ctx.lineTo(0,0);ctx.lineTo(-10,9);ctx.stroke();ctx.restore();}
const trackCache=document.createElement('canvas');trackCache.width=1000;trackCache.height=700;
function paintTrack(g){
 const t=TRACK,o=t.outer,i=t.inner;
 const rect=(x,y,w,h,r,fill,stroke)=>{g.beginPath();g.roundRect(x,y,w,h,r);if(fill){g.fillStyle=fill;g.fill();}if(stroke){g.strokeStyle=stroke;g.stroke();}};
 g.fillStyle='#0a1220';g.fillRect(0,0,1000,700);g.fillStyle='#25405b40';for(let x=15;x<1000;x+=30)for(let y=15;y<700;y+=30)g.fillRect(x,y,1.5,1.5);
 rect(o.x-9,o.y-9,o.w+18,o.h+18,26,'#050c16','#30516d');rect(o.x-3,o.y-3,o.w+6,o.h+6,20,'#50708a');rect(o.x,o.y,o.w,o.h,18,'#202e42');
 g.setLineDash([10,15]);g.strokeStyle='#8fb0cf38';g.lineWidth=2;g.strokeRect(o.x+22,o.y+22,o.w-44,o.h-44);g.setLineDash([]);
 for(let x=80;x<920;x+=38){g.fillStyle=(Math.floor(x/38)%2)?'#5ee1ff70':'#ff995b88';g.fillRect(x,55,20,5);g.fillRect(x,640,20,5);}for(let y=88;y<615;y+=38){g.fillStyle=(Math.floor(y/38)%2)?'#5ee1ff70':'#ff995b88';g.fillRect(45,y,5,20);g.fillRect(950,y,5,20);}
 rect(i.x-7,i.y-7,i.w+14,i.h+14,16,'#06111f','#375675');rect(i.x,i.y,i.w,i.h,10,'#101c30');g.lineWidth=2;g.strokeStyle='#5ee1ff70';g.strokeRect(i.x-2,i.y-2,i.w+4,i.h+4);
 g.save();g.beginPath();g.rect(i.x,i.y,i.w,i.h);g.clip();g.strokeStyle='#293b5944';g.lineWidth=1;for(let x=i.x-230;x<i.x+i.w;x+=24){g.beginPath();g.moveTo(x,i.y);g.lineTo(x+230,i.y+i.h);g.stroke();}g.restore();
 g.textAlign='center';g.font='800 9px system-ui';g.fillStyle='#6c89b4';g.fillText('SABOTAGE SPRINT / NIGHT CIRCUIT',500,300);
 const grad=g.createLinearGradient(320,0,700,0);grad.addColorStop(0,'#75e7ff');grad.addColorStop(1,'#bfa2ff');g.fillStyle=grad;g.font='italic 950 42px system-ui';g.fillText('SWITCHYARD',500,350);g.font='800 11px system-ui';g.fillStyle='#c7ff75';g.fillText('TWO LAPS. ONE WINNER.',500,382);g.fillStyle='#284263';g.fillRect(365,401,270,1);g.font='9px monospace';g.fillStyle='#637fa5';g.fillText('RACE THE LINE. READ YOUR RIVALS.',500,427);
 for(const b of t.obstacles){rect(b.x+4,b.y+6,b.w,b.h,4,'#02081399');rect(b.x,b.y,b.w,b.h,4,'#f09b50','#ffd2a5');g.save();g.beginPath();g.rect(b.x+2,b.y+2,b.w-4,b.h-4);g.clip();g.strokeStyle='#754823';g.lineWidth=7;for(let y=b.y-50;y<b.y+b.h+50;y+=18){g.beginPath();g.moveTo(b.x,y);g.lineTo(b.x+b.w,y+35);g.stroke();}g.restore();}
 for(const [x,y,a] of [[330,180,0],[600,180,0],[820,280,Math.PI/2],[820,420,Math.PI/2],[700,510,Math.PI],[330,510,Math.PI],[180,420,-Math.PI/2],[180,285,-Math.PI/2]]){g.save();g.translate(x,y);g.rotate(a);g.strokeStyle='#a4c3e64d';g.lineWidth=4;g.beginPath();g.moveTo(-10,-9);g.lineTo(0,0);g.lineTo(-10,9);g.stroke();g.restore();}
 const f=t.finish;for(let y=f.min;y<f.max;y+=12)for(let col=0;col<3;col++){g.fillStyle=(Math.floor((y-f.min)/12)+col)%2?'#e5f3ff':'#0b1426';g.fillRect(f.line+col*7,y,7,12);}g.strokeStyle='#5ee1ff';g.lineWidth=2;g.strokeRect(f.line-2,f.min,25,f.max-f.min);g.save();g.translate(226,148);g.rotate(-Math.PI/2);g.fillStyle='#b1d7f4';g.font='800 10px system-ui';g.fillText('START / FINISH',0,0);g.restore();
 g.font='800 8px system-ui';g.fillStyle='#6686b0';g.fillText('01 / NORTH STRAIGHT',355,99);g.fillText('03 / SOUTH CHICANE',460,616);g.save();g.translate(922,440);g.rotate(Math.PI/2);g.fillText('02 / EAST TURN',0,0);g.restore();g.save();g.translate(80,268);g.rotate(-Math.PI/2);g.fillText('04 / HOME BEND',0,0);g.restore();
}
paintTrack(trackCache.getContext('2d'));
function trackDraw(){ctx.drawImage(trackCache,0,0);drawTactics();const me=state?.players.find(p=>p.id===myId);for(let j=0;j<4;j++){const g=TRACK.gates[j],on=me?.checkpoint===j&&me.finishMs===null&&!me.dnf;ctx.strokeStyle=on?'#65e5ff':'#4f688d77';ctx.lineWidth=on?4:2;ctx.setLineDash([6,8]);ctx.beginPath();if(g.axis==='x'){ctx.moveTo(g.line,g.min+12);ctx.lineTo(g.line,g.max-12);}else{ctx.moveTo(g.min+12,g.line);ctx.lineTo(g.max-12,g.line);}ctx.stroke();ctx.setLineDash([]);ctx.fillStyle=on?'#0a2034':'#152740';ctx.beginPath();ctx.arc(g.target.x,g.target.y,19,0,Math.PI*2);ctx.fill();ctx.strokeStyle=on?'#5ee1ff':'#3b5778';ctx.lineWidth=2;ctx.stroke();ctx.fillStyle=on?'#9defff':'#6583ac';ctx.font='800 13px monospace';ctx.textAlign='center';ctx.fillText(String(j+1).padStart(2,'0'),g.target.x,g.target.y+5);}}
let lastFrame=performance.now();
function draw(time){const dt=Math.min(.05,(time-lastFrame)/1000);lastFrame=time;trackDraw();
 if(state){const me=state.players.find(p=>p.id===myId);if(predicted&&state.phase==='racing'&&socket.connected&&me?.finishMs===null&&!me.dnf)integrateMotion(predicted,controls(),dt,state,now());
 canvas.dataset.revision=String(state.revision);canvas.dataset.positions=JSON.stringify(state.players.map(p=>({id:p.id,x:Number(p.x.toFixed(2)),y:Number(p.y.toFixed(2)),lap:p.lap,checkpoint:p.checkpoint,finishPlace:p.finishPlace,finishMs:p.finishMs})));
 for(const p of state.players){let v;if(p.id===myId&&predicted)v=predicted;else{v=rendered.get(p.id)||{...p};const blend=1-Math.exp(-dt/0.045);v.x+=(p.x-v.x)*blend;v.y+=(p.y-v.y)*blend;v.angle+=angleDelta(v.angle,p.angle)*blend;v.speed=p.speed;rendered.set(p.id,v);}drawRacer(p,v,state.players.findIndex(q=>q.id===p.id)+1);}
 drawParticles(dt);polishTick();
 updateTacticUI();
 const clock=now(),counting=state.phase==='countdown'||(state.phase==='racing'&&clock-state.raceAt<700),count=state.phase==='countdown'?String(Math.max(1,Math.ceil((state.raceAt-clock)/1000))):'GO';$('countdown').classList.toggle('hidden',!counting);$('countdown').dataset.target=String(state.raceAt);$('countNum').textContent=count;$('countLabel').textContent=count==='GO'?'GREEN LIGHT':'LIGHTS OUT IN';if(counting&&count!==lastCount){lastCount=count;$('countNum').classList.remove('beat');void $('countNum').offsetWidth;$('countNum').classList.add('beat');beep(count==='GO'?880:450);}$('timer').textContent=format(state.phase==='lobby'?0:(state.finishedAt??Math.min(clock,state.endAt))-state.raceAt);$('speed').textContent=Math.round((predicted?.speed??0)/TRACK.maxSpeed*100)+'%';
 $('raceNotice').textContent=state.phase==='results'?'Results are final for this race.':me?.dnf?'DNF this round. Watch the finish and join the rematch.':me?.finishMs!==null&&me?.finishMs!==undefined?'Finished in position '+me.finishPlace+'! Others have up to '+Math.max(0,Math.ceil((state.endAt-clock)/1000))+' seconds to finish.':state.phase==='countdown'?'Get ready. You can hold your first direction before GO.':state.phase==='lobby'?'Follow the highlighted checkpoints clockwise.':'Next: '+(me?.checkpoint===4?'cross the checkered finish line':TRACK.gates[me?.checkpoint??0].label)+' · '+Math.max(0,Math.ceil((state.endAt-clock)/1000))+'s remaining';
 }requestAnimationFrame(draw);}
requestAnimationFrame(draw);

function beep(freq=500){if(!soundEnabled)return;try{audio??=new AudioContext();audio.resume();const o=audio.createOscillator(),g=audio.createGain();o.frequency.value=freq;o.connect(g);g.connect(audio.destination);g.gain.setValueAtTime(.04,audio.currentTime);g.gain.exponentialRampToValueAtTime(.001,audio.currentTime+.12);o.start();o.stop(audio.currentTime+.13);}catch{}}
$('sound').onclick=()=>{soundEnabled=!soundEnabled;$('sound').textContent=soundEnabled?'Sound on':'Sound off';$('sound').setAttribute('aria-pressed',String(soundEnabled));if(soundEnabled)beep();};
function useAbility(kind){
 const button=document.querySelector('[data-ability="'+kind+'"]');if(tacticPending||!state||!button||button.disabled||!socket.connected)return;
 tacticPending=true;const requestId='a-'+Date.now().toString(36)+'-'+(++actionSerial);
 request('sabotage',{kind,raceId:state.raceId,requestId},r=>{tacticPending=false;if(r.ok&&!r.duplicate){notify(TACTICS.abilities[kind].name+' triggered. Watch the marked zone.');button.classList.add('success');setTimeout(()=>button.classList.remove('success'),600);beep(320);}});
}
for(const button of document.querySelectorAll('[data-ability]'))button.onclick=()=>useAbility(button.dataset.ability);
function updateTacticAnnouncements(){
 const event=state?.tacticEvents?.at(-1);if(event&&event.eventId!==lastFeedId){lastFeedId=event.eventId;$('tacticFeed').textContent=event.text;beep(event.eventId.startsWith('pickup')?760:380);}
 const me=state?.players.find(p=>p.id===myId),status=me?.hazardStatus||'';if(status!==lastOwnStatus){lastOwnStatus=status;$('effectNotice').textContent=status;if(status)beep(190);}
}
function updateTacticUI(){
 if(!state)return;const clock=now(),me=state.players.find(p=>p.id===myId),eligible=state.phase==='racing'&&socket.connected&&me?.connected&&me.finishMs===null&&!me.dnf,rival=state.players.some(p=>p.id!==myId&&p.connected&&p.finishMs===null&&!p.dnf),cooldown=Math.max(0,(me?.nextSabotageAt??0)-clock);
 $('charges').textContent=(me?.charges??0)+' / '+TACTICS.maxCharges;
 $('tacticCooldown').textContent=!eligible?'Available to active racers only':!rival?'No eligible rivals still racing':cooldown?'Your cooldown: '+(cooldown/1000).toFixed(1)+'s':'Ready · hazards affect everyone';
 for(const [kind,spec] of Object.entries(TACTICS.abilities)){
  const h=state.hazards?.[kind],warning=state.phase==='racing'&&h&&clock<h.activeAt,active=isActive(state,kind,clock),busy=state.phase==='racing'&&h&&clock<h.unlockAt,button=document.querySelector('[data-ability="'+kind+'"]');
  button.disabled=!eligible||!rival||!me?.charges||cooldown>0||busy||tacticPending;button.classList.toggle('pending',!!warning);button.classList.toggle('active',!!active);
  button.dataset.eventId=h?.eventId??'';button.dataset.activeAt=String(h?.activeAt??0);button.dataset.endsAt=String(h?.endsAt??0);
  const target=$(kind+'Status');target.textContent=warning?'WARNING · '+((h.activeAt-clock)/1000).toFixed(1)+'s':active?'ACTIVE · '+((h.endsAt-clock)/1000).toFixed(1)+'s':busy?'Zone recovering · '+((h.unlockAt-clock)/1000).toFixed(1)+'s':kind==='gate'?'Lower bypass stays open':kind==='belt'?'Go above or below the strip':'22% slow · drive around the patch';
 }
}
function stripe(zone,fill,stroke){ctx.save();ctx.beginPath();ctx.rect(zone.x,zone.y,zone.w,zone.h);ctx.clip();ctx.fillStyle=fill;ctx.fillRect(zone.x,zone.y,zone.w,zone.h);ctx.strokeStyle=stroke;ctx.lineWidth=4;for(let x=zone.x-100;x<zone.x+zone.w;x+=16){ctx.beginPath();ctx.moveTo(x,zone.y);ctx.lineTo(x+zone.h,zone.y+zone.h);ctx.stroke();}ctx.restore();ctx.strokeStyle=stroke;ctx.lineWidth=2;ctx.strokeRect(zone.x,zone.y,zone.w,zone.h);}
function drawTactics(){
 const clock=now(),phase=state?.phase,pulse=reduceMotion.matches?1:.75+.25*Math.sin(clock/180);
 for(const [kind,spec] of Object.entries(TACTICS.abilities)){
  const h=state?.hazards?.[kind],warning=phase==='racing'&&h&&clock<h.activeAt,active=isActive(state,kind,clock),z=spec.zone;
  const accent=warning?'#ffd18a':kind==='gate'?'#ff995b':kind==='belt'?'#5ee1ff':'#b294ff';
  ctx.save();ctx.globalAlpha=warning?pulse:1;
  if(kind==='gate'){
   stripe(z,active?'#e17f35':'#ff995b0d',active?'#ffe0b4':accent+'88');
   if(active){ctx.strokeStyle='#352312';ctx.lineWidth=6;for(let y=z.y+12;y<z.y+z.h;y+=20){ctx.beginPath();ctx.moveTo(z.x+3,y);ctx.lineTo(z.x+z.w-3,y+10);ctx.stroke();}}
   ctx.fillStyle=accent;ctx.font='800 9px system-ui';ctx.textAlign='center';ctx.fillText(warning?'GATE IN '+Math.max(0,(h.activeAt-clock)/1000).toFixed(1)+'s':active?'CLOSED '+Math.max(0,(h.endsAt-clock)/1000).toFixed(1)+'s':'1 / GATE SLAM',z.x+12,z.y+z.h+17);ctx.fillStyle='#5ee1ff99';ctx.font='8px system-ui';ctx.fillText('BYPASS ↓',z.x+12,213);
  }else if(kind==='belt'){
   stripe(z,active?'#7e57b155':'#41b9db14',accent+'99');
   ctx.save();ctx.beginPath();ctx.rect(z.x+4,z.y+4,z.w-8,z.h-8);ctx.clip();const drift=reduceMotion.matches?0:(clock/50)%38;for(let x=z.x-25;x<z.x+z.w+40;x+=38)arrow(x+(active?drift:-drift),z.y+z.h/2,active?0:Math.PI);ctx.restore();
   ctx.font='800 9px system-ui';ctx.fillStyle=accent;ctx.fillText(warning?'BELT: INCOMING':active?'REVERSED → '+Math.max(0,(h.endsAt-clock)/1000).toFixed(1)+'s':'2 / BELT ASSIST ←',z.x+z.w/2,z.y-10);
  }else{
   stripe(z,active?'#150d2bed':'#ae8bff0d',accent+'99');
   if(active){ctx.fillStyle='#392358';ctx.beginPath();ctx.ellipse(z.x+z.w/2,z.y+z.h/2,23,35,.15,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#ba8bff';ctx.lineWidth=2;ctx.beginPath();ctx.ellipse(z.x+z.w/2,z.y+z.h/2,15,24,.15,0,Math.PI*2);ctx.stroke();ctx.strokeStyle='#62e1ff88';ctx.beginPath();ctx.arc(z.x+z.w/2,z.y+z.h/2,11,.2,2.6);ctx.stroke();}
   ctx.fillStyle=accent;ctx.font='800 8px system-ui';ctx.fillText(warning?'OIL: INCOMING':active?'SLICK '+Math.max(0,(h.endsAt-clock)/1000).toFixed(1)+'s':'3 / OIL ZONE',z.x+z.w/2,z.y-10);
  }
  if(warning){ctx.strokeStyle='#ffce8b';ctx.lineWidth=2;ctx.setLineDash([4,5]);ctx.strokeRect(z.x-5,z.y-5,z.w+10,z.h+10);ctx.setLineDash([]);}
  ctx.restore();
 }
 for(const location of TACTICS.pickups){const status=state?.pickups?.find(p=>p.id===location.id);if(status?.claimedBy)continue;const x=location.x,y=location.y,pop=reduceMotion.matches?0:1.5*Math.sin(clock/260);ctx.save();ctx.translate(x,y);ctx.rotate(Math.PI/4);ctx.fillStyle='#d4ff7014';ctx.fillRect(-24-pop,-24-pop,48+pop*2,48+pop*2);ctx.fillStyle='#d4ff70';ctx.strokeStyle='#eaffae';ctx.lineWidth=2;ctx.fillRect(-12,-12,24,24);ctx.strokeRect(-16,-16,32,32);ctx.restore();ctx.font='900 23px system-ui';ctx.textAlign='center';ctx.fillStyle='#102420';ctx.fillText('ϟ',x,y+8);}
}
function racerColor(color){return({'#f5684c':'#ff995b','#708cff':'#5ee1ff','#d99b20':'#d4ff70','#a36bce':'#b398ff','#29967e':'#5df2b7','#d75281':'#ff7ac0','#4587bd':'#91bcff','#ba7150':'#ffdb8a'})[color]||color;}
function drawRacer(p,v,number){
 const color=racerColor(p.color),small=canvas.clientWidth<600;ctx.globalAlpha=p.connected?1:.35;ctx.fillStyle='#02071088';ctx.beginPath();ctx.ellipse(v.x+2,v.y+12,18,7,0,0,Math.PI*2);ctx.fill();
 ctx.save();ctx.translate(v.x,v.y);ctx.rotate(v.angle);if(v.speed>150&&!reduceMotion.matches){ctx.strokeStyle=color+'55';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(-24,-5);ctx.lineTo(-34,-5);ctx.moveTo(-25,5);ctx.lineTo(-39,5);ctx.stroke();}ctx.fillStyle='#030b17';ctx.fillRect(-11,-14,10,5);ctx.fillRect(6,-14,10,5);ctx.fillRect(-11,9,10,5);ctx.fillRect(6,9,10,5);box(-17,-10,34,20,6,color);box(-1,-7,9,14,2,'#102039');ctx.fillStyle='#dff9ff';ctx.fillRect(13,-7,3,4);ctx.fillRect(13,3,3,4);ctx.fillStyle='#ff6871';ctx.fillRect(-17,-7,2,4);ctx.fillRect(-17,3,2,4);ctx.fillStyle='#ffffff88';ctx.fillRect(-11,-8,4,16);ctx.restore();
 if(p.id===myId){ctx.strokeStyle='#edfaff';ctx.lineWidth=2;ctx.beginPath();ctx.arc(v.x,v.y,24,0,Math.PI*2);ctx.stroke();ctx.fillStyle='#edfaff';ctx.beginPath();ctx.moveTo(v.x-4,v.y+28);ctx.lineTo(v.x+4,v.y+28);ctx.lineTo(v.x,v.y+33);ctx.fill();}
 const label=small?'#'+number:p.name+' · '+number,fontsize=small?26:14;ctx.font='800 '+fontsize+'px system-ui';ctx.textAlign='center';const width=ctx.measureText(label).width+12,y=Math.max(fontsize+4,v.y-30);box(v.x-width/2,y-fontsize,width,fontsize+6,4,'#081426dd');ctx.fillStyle=p.finishMs!==null?'#d4ff70':color;ctx.fillText(label,v.x,y);ctx.globalAlpha=1;
}
function burst(x,y,color,count=8){if(reduceMotion.matches)return;for(let i=0;i<count&&particles.length<56;i++){const angle=i/count*Math.PI*2;particles.push({x,y,vx:Math.cos(angle)*(35+(i%3)*15),vy:Math.sin(angle)*(35+(i%3)*15),life:.7,max:.7,color,size:2+(i%2)});}}
function polishEvents(previous,next){
 if(!previous||previous.raceId!==next.raceId)return;
 for(const token of next.pickups??[]){const old=previous.pickups?.find(t=>t.id===token.id);if(old&&!old.claimedBy&&token.claimedBy){const position=TACTICS.pickups.find(t=>t.id===token.id);burst(position.x,position.y,'#d4ff70',10);if(token.claimedBy===myId){pickupUntil=now()+1100;pickupToast.textContent='+1 CHARGE';$('charges').classList.remove('collectPulse');void $('charges').offsetWidth;$('charges').classList.add('collectPulse');}}}
 const old=previous.players.find(p=>p.id===myId),me=next.players.find(p=>p.id===myId);
 if(old&&old.finishMs===null&&me?.finishMs!==null&&me?.finishMs!==undefined){finishUntil=now()+1500;$('finishPlace').textContent='P'+me.finishPlace+' · '+format(me.finishMs);burst(me.x,me.y,'#d4ff70',16);beep(880);}
 if(previous.phase!=='results'&&next.phase==='results'&&next.players.some(p=>p.finishPlace===1)){burst(400,280,'#5ee1ff',12);burst(600,280,'#af8bff',12);beep(760);}
}
function drawParticles(dt){for(let i=particles.length-1;i>=0;i--){const p=particles[i];p.life-=dt;if(p.life<=0){particles.splice(i,1);continue;}p.x+=p.vx*dt;p.y+=p.vy*dt;ctx.globalAlpha=p.life/p.max;ctx.fillStyle=p.color;ctx.fillRect(p.x,p.y,p.size,p.size);}ctx.globalAlpha=1;}
function polishTick(){
 const clock=now(),me=state?.players.find(p=>p.id===myId);$('finishToast').classList.toggle('hidden',clock>=finishUntil||state?.phase!=='racing');pickupToast.classList.toggle('hidden',clock>=pickupUntil);$('arena').dataset.affected=me?.hazardStatus||'';
 if(state?.phase!=='racing')return;
 for(const [kind,h] of Object.entries(state.hazards??{})){const status=clock<h.activeAt?'warning':clock<h.endsAt?'active':'expired',old=hazardVisuals.get(h.eventId);if(status!==old){hazardVisuals.set(h.eventId,status);if(status==='active'){const z=TACTICS.abilities[kind].zone;burst(z.x+z.w/2,z.y+z.h/2,kind==='gate'?'#ff995b':kind==='belt'?'#5ee1ff':'#b398ff',6);}if(status==='expired'&&old&&old!=='expired'){$('tacticFeed').textContent=TACTICS.abilities[kind].name+' cleared · zone safe.';beep(600);}}}
}
