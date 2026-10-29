import {TRACK,getTrack} from '../game.js';
// Test-only driver sends ordinary legal inputs; never a production opponent.
export const route=[...TRACK.route.slice(1),TRACK.route[0],[440,180],...TRACK.route.slice(1),TRACK.route[0],[440,180]];
export function drive(p,driver){const t=getTrack(p.trackId),route=[...t.route.slice(1),t.route[0],[440,180],...t.route.slice(1),t.route[0],[440,180]];let target=route[Math.min(driver.index,route.length-1)],dx=target[0]-p.x,dy=target[1]-p.y,d=Math.hypot(dx,dy);if(d<14&&driver.index<route.length-1){target=route[++driver.index];dx=target[0]-p.x;dy=target[1]-p.y;d=Math.hypot(dx,dy);}return{x:dx/Math.max(1,d),y:dy/Math.max(1,d),brake:d<90&&p.speed>Math.max(35,Math.sqrt(Math.max(0,d-6)*850))};}
