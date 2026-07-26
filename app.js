/* ==========================================================================
   FREQUENCY OASIS // WORLD SIGNAL
   Vanilla JS. No frameworks. Real station data via the Radio Browser API.
   ========================================================================== */
'use strict';

/* -------------------------------------------------------------------------
   0. CONSTANTS & GLOBAL STATE
   ------------------------------------------------------------------------- */
const API_HOSTS = [
  'https://de1.api.radio-browser.info',
  'https://de2.api.radio-browser.info',
  'https://at1.api.radio-browser.info',
  'https://nl1.api.radio-browser.info'
];

const GENRES = {
  news:       { label:'News',       color:'#4f8ff7', energy:0.5, keys:['news','information'] },
  jazz:       { label:'Jazz',       color:'#d4af6a', energy:0.35,keys:['jazz','blues','swing'] },
  rnb:        { label:'R&B',        color:'#b072e0', energy:0.55,keys:['r&b','rnb','soul','hiphop','hip hop','rap'] },
  nature:     { label:'Nature',     color:'#5bd68f', energy:0.2, keys:['nature','ambient','chill','relax','meditation'] },
  talk:       { label:'Talk',       color:'#f0954a', energy:0.4, keys:['talk','community','culture','public radio'] },
  sports:     { label:'Sports',     color:'#ef5b5b', energy:0.75,keys:['sport','sports'] },
  classical:  { label:'Classical',  color:'#f4f2ea', energy:0.25,keys:['classical','opera','orchestra'] },
  pop:        { label:'Pop',        color:'#f07ab0', energy:0.6, keys:['pop','top 40','top40','chart'] },
  electronic: { label:'Electronic', color:'#4fd8f0', energy:0.85,keys:['electronic','dance','edm','house','techno','trance'] }
};
const GENRE_KEYS = Object.keys(GENRES);

const ISLAND_NATIONS = new Set(['IS','JP','GB','IE','NZ','MG','CU','JM','LK','TW','PH','ID','MT','CY','BH','SG','MU','SC','FJ']);
const MOUNTAIN_NATIONS = new Set(['CH','NP','BO','AT','PE','BT','AD','KG','TJ']);

const state = {
  stations: [],          // raw standardized stations
  clusters: [],          // grouped by geo cell
  rotY: 0.6,              // radians
  rotX: -0.18,
  autoRotate: true,
  dragging:false,
  lastPointer:null,
  zoom: 1,
  radius: 0,
  center:{x:0,y:0},
  hoverCluster:null,
  activeStation:null,
  audioCtx:null,
  analyserL:null,
  analyserR:null,
  analyserMono:null,
  simulatedScopes:false,
  discoveredKeys:new Set(),
  listenedCountries:new Set(JSON.parse(localStorage.getItem('fo_countries')||'[]')),
  achievements:JSON.parse(localStorage.getItem('fo_achv')||'{}'),
  jazzPlays: Number(localStorage.getItem('fo_jazzplays')||0),
  playCount: Number(localStorage.getItem('fo_playcount')||0),
  decade: 7,
  playing:false
};

/* -------------------------------------------------------------------------
   1. UTIL
   ------------------------------------------------------------------------- */
const $ = sel => document.querySelector(sel);
const $all = sel => Array.from(document.querySelectorAll(sel));
const clamp = (v,a,b) => Math.max(a, Math.min(b,v));
const rad = d => d*Math.PI/180;

function classifyGenre(tagsStr){
  const t = (tagsStr||'').toLowerCase();
  for(const key of GENRE_KEYS){
    if(GENRES[key].keys.some(k=>t.includes(k))) return key;
  }
  // deterministic fallback so unmatched stations still get a stable, varied color
  let h=0; for(let i=0;i<t.length;i++) h = (h*31 + t.charCodeAt(i))>>>0;
  return GENRE_KEYS[h % GENRE_KEYS.length];
}

function continentOf(lat, lon){
  if(lat>34 && lat<72 && lon>-25 && lon<45) return 'Europe';
  if(lat>-35 && lat<38 && lon>-20 && lon<52) return 'Africa';
  if(lat>5 && lat<75 && lon>-170 && lon<-50) return 'North America';
  if(lat>-57 && lat<13 && lon>-82 && lon<-34) return 'South America';
  if(lat>-50 && lat<0 && lon>110 && lon<180) return 'Oceania';
  if(lat>-10 && lat<77 && lon>45 && lon<=180) return 'Asia';
  return 'Other';
}

function toastRadar(msg){
  const host = $('#radarToastHost');
  const el = document.createElement('div');
  el.className='radar-toast';
  el.textContent = msg;
  host.appendChild(el);
  setTimeout(()=>el.remove(), 5100);
}

/* -------------------------------------------------------------------------
   2. STARFIELD (home)
   ------------------------------------------------------------------------- */
(function starfield(){
  const cvs = $('#starfield');
  const ctx = cvs.getContext('2d');
  let stars = [];
  function resize(){
    cvs.width = innerWidth*devicePixelRatio;
    cvs.height = innerHeight*devicePixelRatio;
    cvs.style.width = innerWidth+'px';
    cvs.style.height = innerHeight+'px';
    const n = Math.floor((innerWidth*innerHeight)/3200);
    stars = Array.from({length:n}, ()=>({
      x:Math.random()*cvs.width, y:Math.random()*cvs.height,
      r:Math.random()*1.4+0.2, s:Math.random()*0.4+0.05,
      p:Math.random()*Math.PI*2
    }));
  }
  window.addEventListener('resize', resize);
  resize();
  let t=0;
  function tick(){
    t+=0.016;
    ctx.clearRect(0,0,cvs.width,cvs.height);
    for(const st of stars){
      const alpha = 0.4+0.6*Math.sin(t*st.s+st.p);
      ctx.fillStyle = `rgba(230,230,240,${clamp(alpha,0,1)})`;
      ctx.beginPath(); ctx.arc(st.x, st.y, st.r*devicePixelRatio, 0, 7); ctx.fill();
    }
    requestAnimationFrame(tick);
  }
  tick();
})();

/* -------------------------------------------------------------------------
   3. HOME DECORATIVE GLOBE (small wireframe, spins slowly)
   ------------------------------------------------------------------------- */
(function homeGlobe(){
  const cvs = $('#homeGlobe');
  const ctx = cvs.getContext('2d');
  function size(){
    const s = Math.min(innerWidth, innerHeight)*0.5;
    cvs.width = s*devicePixelRatio; cvs.height = s*devicePixelRatio;
    cvs.style.width = s+'px'; cvs.style.height=s+'px';
  }
  window.addEventListener('resize', size); size();
  let a=0;
  function tick(){
    a += 0.0022;
    const w = cvs.width, h = cvs.height, r = w*0.42, cx=w/2, cy=h/2;
    ctx.clearRect(0,0,w,h);
    ctx.strokeStyle='rgba(212,175,106,0.28)';
    ctx.lineWidth=1;
    // outer rim
    ctx.beginPath(); ctx.arc(cx,cy,r,0,7); ctx.stroke();
    // latitude ellipses
    for(let i=-60;i<=60;i+=30){
      const rr = r*Math.cos(rad(i));
      const yy = cy - r*Math.sin(rad(i))*0.0 - 0; // flattened later
      ctx.beginPath();
      ctx.ellipse(cx, cy - r*Math.sin(rad(i)), rr, rr*0.28, 0, 0, 7);
      ctx.globalAlpha=0.35;
      ctx.stroke();
    }
    // longitude ellipses (rotating)
    ctx.globalAlpha=0.45;
    for(let i=0;i<6;i++){
      const ang = a + i*Math.PI/6;
      const rx = Math.abs(Math.cos(ang))*r;
      ctx.beginPath();
      ctx.ellipse(cx, cy, Math.max(rx,0.6), r, 0, 0, 7);
      ctx.stroke();
    }
    ctx.globalAlpha=1;
    requestAnimationFrame(tick);
  }
  tick();
})();

/* -------------------------------------------------------------------------
   4. LAND SILHOUETTES (rough continent polygons, lon/lat degrees)
   ------------------------------------------------------------------------- */
const LANDMASSES = [
  [[-165,68],[-155,60],[-130,55],[-125,48],[-124,40],[-117,32],[-105,20],[-97,18],
   [-90,16],[-97,26],[-95,29],[-81,25],[-80,32],[-75,35],[-70,42],[-67,45],[-60,50],
   [-65,60],[-80,65],[-100,70],[-130,70],[-150,70],[-165,68]],
  [[-80,10],[-77,5],[-70,-5],[-70,-18],[-71,-30],[-73,-40],[-68,-52],[-65,-55],
   [-58,-52],[-56,-38],[-48,-25],[-40,-15],[-35,-8],[-45,2],[-60,8],[-72,10],[-80,10]],
  [[-17,15],[-16,25],[10,37],[20,33],[32,31],[35,28],[43,12],[51,12],[45,0],
   [40,-15],[35,-25],[30,-33],[20,-34],[15,-27],[12,-15],[10,-2],[8,4],[-5,5],[-10,7],[-17,15]],
  [[-10,43],[-9,36],[0,38],[10,36],[18,40],[27,41],[30,45],[28,50],[20,54],
   [25,60],[20,64],[10,63],[5,58],[-2,58],[-5,50],[-10,48],[-10,43]],
  [[27,41],[35,45],[50,45],[55,50],[65,52],[80,50],[95,45],[110,45],[125,42],
   [135,45],[140,35],[130,25],[110,20],[100,15],[95,20],[85,20],[70,25],[60,25],[50,30],[40,35],[27,41]],
  [[113,-22],[120,-18],[130,-12],[142,-11],[145,-16],[150,-25],[150,-35],[140,-38],
   [132,-32],[122,-34],[114,-30],[113,-22]]
];

/* -------------------------------------------------------------------------
   5. THE WORLD GLOBE
   ------------------------------------------------------------------------- */
const globeCvs = $('#globeCanvas');
const gctx = globeCvs.getContext('2d');

function resizeGlobe(){
  globeCvs.width = innerWidth*devicePixelRatio;
  globeCvs.height = innerHeight*devicePixelRatio;
  globeCvs.style.width = innerWidth+'px';
  globeCvs.style.height = innerHeight+'px';
  state.center.x = globeCvs.width/2;
  state.center.y = globeCvs.height/2;
  state.radius = Math.min(globeCvs.width, globeCvs.height)*0.34;
}
window.addEventListener('resize', resizeGlobe);
resizeGlobe();

// 3D projection helpers ------------------------------------------------
function project(lon, lat){
  const phi = rad(lat), theta = rad(lon) + state.rotY;
  let x = Math.cos(phi)*Math.sin(theta);
  let y = Math.sin(phi);
  let z = Math.cos(phi)*Math.cos(theta);
  // tilt around X axis
  const cx = Math.cos(state.rotX), sx = Math.sin(state.rotX);
  const y2 = y*cx - z*sx;
  const z2 = y*sx + z*cx;
  const R = state.radius*state.zoom;
  return {
    x: state.center.x + x*R,
    y: state.center.y - y2*R,
    z: z2,
    visible: z2 > -0.02
  };
}

// subsolar point (rough approximation, good enough for a day/night mood)
function subsolar(){
  const now = new Date();
  const startOfYear = Date.UTC(now.getUTCFullYear(),0,0);
  const dayOfYear = Math.floor((now - startOfYear)/86400000);
  const decl = 23.44*Math.sin(rad(360/365*(dayOfYear-81)));
  const utcHours = now.getUTCHours() + now.getUTCMinutes()/60;
  const lon = 180 - utcHours*15; // sun over lon where local solar noon
  return { lat: decl, lon: ((lon+180)%360)-180 };
}

function isNightAt(lon,lat){
  const s = subsolar();
  const p1 = [Math.cos(rad(lat))*Math.cos(rad(lon)), Math.cos(rad(lat))*Math.sin(rad(lon)), Math.sin(rad(lat))];
  const p2 = [Math.cos(rad(s.lat))*Math.cos(rad(s.lon)), Math.cos(rad(s.lat))*Math.sin(rad(s.lon)), Math.sin(rad(s.lat))];
  const dot = p1[0]*p2[0]+p1[1]*p2[1]+p1[2]*p2[2];
  return dot < -0.05;
}

function drawGlobe(ts){
  const w = globeCvs.width, h = globeCvs.height;
  gctx.clearRect(0,0,w,h);

  const R = state.radius*state.zoom;
  const cx = state.center.x, cy = state.center.y;

  // ocean sphere
  const grad = gctx.createRadialGradient(cx-R*0.35, cy-R*0.35, R*0.1, cx, cy, R*1.05);
  grad.addColorStop(0,'#132038');
  grad.addColorStop(0.55,'#0b1526');
  grad.addColorStop(1,'#050912');
  gctx.beginPath(); gctx.arc(cx,cy,R,0,7); gctx.fillStyle=grad; gctx.fill();

  // subtle rim light
  gctx.beginPath(); gctx.arc(cx,cy,R,0,7);
  gctx.strokeStyle='rgba(212,175,106,0.35)'; gctx.lineWidth=1.2; gctx.stroke();

  // graticule
  gctx.lineWidth=1;
  for(let lat=-60; lat<=60; lat+=30){
    gctx.beginPath();
    let started=false;
    for(let lon=-180; lon<=180; lon+=4){
      const p = project(lon,lat);
      if(p.visible){
        if(!started){ gctx.moveTo(p.x,p.y); started=true; } else gctx.lineTo(p.x,p.y);
      } else started=false;
    }
    gctx.strokeStyle='rgba(127,216,232,0.10)';
    gctx.stroke();
  }
  for(let lon=-150; lon<=180; lon+=30){
    gctx.beginPath();
    let started=false;
    for(let lat=-90; lat<=90; lat+=4){
      const p = project(lon,lat);
      if(p.visible){
        if(!started){ gctx.moveTo(p.x,p.y); started=true; } else gctx.lineTo(p.x,p.y);
      } else started=false;
    }
    gctx.strokeStyle='rgba(127,216,232,0.10)';
    gctx.stroke();
  }

  // landmasses
  for(const poly of LANDMASSES){
    gctx.beginPath();
    let started=false; let anyVisible=false;
    for(const [lon,lat] of poly){
      const p = project(lon,lat);
      if(p.visible) anyVisible=true;
      if(!started){ gctx.moveTo(p.x,p.y); started=true; } else gctx.lineTo(p.x,p.y);
    }
    gctx.closePath();
    if(anyVisible){
      gctx.fillStyle='rgba(212,175,106,0.10)';
      gctx.fill();
      gctx.strokeStyle='rgba(212,175,106,0.30)';
      gctx.lineWidth=1;
      gctx.stroke();
    }
  }

  // night shading
  for(let lat=-84; lat<=84; lat+=6){
    for(let lon=-180; lon<180; lon+=6){
      if(!isNightAt(lon,lat)) continue;
      const p = project(lon,lat);
      if(!p.visible) continue;
      gctx.fillStyle='rgba(2,4,10,0.30)';
      gctx.beginPath(); gctx.arc(p.x,p.y, R*0.052, 0, 7); gctx.fill();
    }
  }

  // polar aurora hint
  [ -85, 85 ].forEach(latp=>{
    const p = project(state.auroraLon||0, latp);
    if(p.visible){
      const ag = gctx.createRadialGradient(p.x,p.y,0,p.x,p.y,R*0.5);
      ag.addColorStop(0, latp>0? 'rgba(127,216,232,0.22)':'rgba(176,114,224,0.18)');
      ag.addColorStop(1,'rgba(0,0,0,0)');
      gctx.fillStyle=ag;
      gctx.beginPath(); gctx.arc(p.x,p.y,R*0.5,0,7); gctx.fill();
    }
  });

  // constellations (connect same-genre nearby clusters)
  drawConstellations(R);

  // beacons
  const visibleClusters = [];
  for(const c of state.clusters){
    const p = project(c.lon, c.lat);
    c._proj = p;
    if(!p.visible) continue;
    visibleClusters.push(c);
    const g = GENRES[c.genre];
    const baseR = clamp(2.4 + Math.sqrt(c.stations.length)*1.6, 2.4, 13) * (R/260);
    const speed = 1.4 + g.energy*2.6;
    const pulse = 0.65 + 0.35*Math.sin((ts||0)/1000*speed + c.seed);
    const night = isNightAt(c.lon,c.lat);
    const glowR = baseR * (1.8+pulse*0.9);

    const rg = gctx.createRadialGradient(p.x,p.y,0,p.x,p.y,glowR);
    rg.addColorStop(0, g.color);
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    gctx.globalAlpha = night? 0.95 : 0.55+pulse*0.25;
    gctx.fillStyle = rg;
    gctx.beginPath(); gctx.arc(p.x,p.y,glowR,0,7); gctx.fill();

    gctx.globalAlpha=1;
    gctx.fillStyle = g.color;
    gctx.beginPath(); gctx.arc(p.x,p.y, baseR*0.55, 0, 7); gctx.fill();
  }
  state._visibleClusters = visibleClusters;

  // global heartbeat pulse ring traveling along the rim
  drawHeartbeatRing(ts, R, cx, cy);

  // hover highlight
  if(state.hoverCluster && state.hoverCluster._proj && state.hoverCluster._proj.visible){
    const p = state.hoverCluster._proj;
    gctx.strokeStyle='rgba(240,220,171,0.9)';
    gctx.lineWidth=1.4;
    gctx.beginPath(); gctx.arc(p.x,p.y,10*(R/260)+6,0,7); gctx.stroke();
  }
}

function drawConstellations(R){
  const list = state._visibleClusters || [];
  if(list.length<2) return;
  gctx.lineWidth=1;
  for(let i=0;i<list.length;i++){
    const a = list[i];
    let links=0;
    for(let j=0;j<list.length;j++){
      if(i===j || links>=2) break;
      const b = list[j];
      if(a.genre!==b.genre) continue;
      const dx=a._proj.x-b._proj.x, dy=a._proj.y-b._proj.y;
      const d = Math.hypot(dx,dy);
      if(d < R*0.5 && d>4){
        gctx.strokeStyle = hexToRgba(GENRES[a.genre].color, 0.10);
        gctx.beginPath(); gctx.moveTo(a._proj.x,a._proj.y); gctx.lineTo(b._proj.x,b._proj.y); gctx.stroke();
        links++;
      }
    }
  }
}
function hexToRgba(hex,a){
  const n = parseInt(hex.slice(1),16);
  return `rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${a})`;
}

let heartbeatPhase=0;
function drawHeartbeatRing(ts,R,cx,cy){
  const speed = 0.35 + Math.min(state.stations.length,600)/600*0.9;
  heartbeatPhase = ((ts||0)/1000*speed) % (Math.PI*2);
  const p = { x: cx + Math.cos(heartbeatPhase)*R, y: cy + Math.sin(heartbeatPhase)*R*0.98 };
  const rg = gctx.createRadialGradient(p.x,p.y,0,p.x,p.y,R*0.09);
  rg.addColorStop(0,'rgba(212,175,106,0.9)');
  rg.addColorStop(1,'rgba(212,175,106,0)');
  gctx.fillStyle=rg;
  gctx.beginPath(); gctx.arc(p.x,p.y,R*0.09,0,7); gctx.fill();
}

function globeLoop(ts){
  if(state.autoRotate && !state.dragging){
    state.rotY += 0.00035;
  }
  state.auroraLon = ((ts||0)/4000)%360 - 180;
  drawGlobe(ts||0);
  requestAnimationFrame(globeLoop);
}
requestAnimationFrame(globeLoop);

/* pointer interaction: drag to rotate, wheel to zoom, click to select */
(function globeInteraction(){
  let downPos=null, moved=false;
  globeCvs.addEventListener('pointerdown', e=>{
    state.dragging=true; downPos={x:e.clientX,y:e.clientY}; moved=false;
    state.lastPointer={x:e.clientX,y:e.clientY};
  });
  window.addEventListener('pointermove', e=>{
    if(!state.dragging) { handleHover(e); return; }
    const dx = e.clientX - state.lastPointer.x;
    const dy = e.clientY - state.lastPointer.y;
    if(Math.abs(dx)+Math.abs(dy) > 3) moved=true;
    state.rotY += dx*0.005;
    state.rotX = clamp(state.rotX + dy*0.004, -1.2, 1.2);
    state.lastPointer={x:e.clientX,y:e.clientY};
  });
  window.addEventListener('pointerup', e=>{
    if(state.dragging && !moved){
      handleClick(e);
    }
    state.dragging=false;
  });
  globeCvs.addEventListener('wheel', e=>{
    e.preventDefault();
    state.zoom = clamp(state.zoom * (1 - e.deltaY*0.001), 0.6, 3.2);
  }, {passive:false});

  let pinchDist=null;
  globeCvs.addEventListener('touchmove', e=>{
    if(e.touches.length===2){
      const d = Math.hypot(e.touches[0].clientX-e.touches[1].clientX, e.touches[0].clientY-e.touches[1].clientY);
      if(pinchDist) state.zoom = clamp(state.zoom*(d/pinchDist), 0.6, 3.2);
      pinchDist = d;
    }
  }, {passive:true});
  globeCvs.addEventListener('touchend', ()=>{ pinchDist=null; });

  function nearestCluster(clientX, clientY){
    const rect = globeCvs.getBoundingClientRect();
    const x = (clientX-rect.left)*devicePixelRatio, y=(clientY-rect.top)*devicePixelRatio;
    let best=null, bestD=26*devicePixelRatio;
    for(const c of (state._visibleClusters||[])){
      const d = Math.hypot(c._proj.x-x, c._proj.y-y);
      if(d<bestD){ bestD=d; best=c; }
    }
    return best;
  }
  function handleHover(e){
    state.hoverCluster = nearestCluster(e.clientX, e.clientY);
    globeCvs.style.cursor = state.hoverCluster? 'pointer':'grab';
  }
  function handleClick(e){
    const c = nearestCluster(e.clientX, e.clientY);
    if(c) openCluster(c);
  }
})();

/* -------------------------------------------------------------------------
   6. DATA LAYER — Radio Browser API
   ------------------------------------------------------------------------- */
async function apiFetch(path){
  let lastErr;
  for(const host of API_HOSTS){
    try{
      const res = await fetch(host+path, { headers:{'User-Agent':'FrequencyOasis/1.0'} });
      if(!res.ok) throw new Error('bad status '+res.status);
      return await res.json();
    }catch(err){ lastErr = err; }
  }
  throw lastErr;
}

function standardize(raw){
  return raw
    .filter(s=>s.geo_lat && s.geo_long && s.url_resolved)
    .map(s=>({
      id: s.stationuuid,
      name: s.name?.trim() || 'Unnamed Signal',
      country: s.country || 'Unknown',
      countrycode: (s.countrycode||'').toUpperCase(),
      state: s.state || '',
      lat: parseFloat(s.geo_lat),
      lon: parseFloat(s.geo_long),
      tags: s.tags || '',
      genre: classifyGenre(s.tags),
      bitrate: s.bitrate || 0,
      votes: s.votes || 0,
      clicks: s.clickcount || 0,
      url: s.url_resolved,
      homepage: s.homepage || '',
      favicon: s.favicon || '',
      language: (s.language||'').split(',')[0] || 'unknown'
    }));
}

function buildClusters(stations){
  const cells = new Map();
  const CELL = 3.2;
  for(const s of stations){
    const key = Math.round(s.lat/CELL)+'_'+Math.round(s.lon/CELL);
    if(!cells.has(key)) cells.set(key, []);
    cells.get(key).push(s);
  }
  const clusters = [];
  let seed=0;
  for(const [key, list] of cells){
    const lat = list.reduce((a,s)=>a+s.lat,0)/list.length;
    const lon = list.reduce((a,s)=>a+s.lon,0)/list.length;
    const genreCounts = {};
    list.forEach(s=>genreCounts[s.genre]=(genreCounts[s.genre]||0)+1);
    const genre = Object.entries(genreCounts).sort((a,b)=>b[1]-a[1])[0][0];
    const stateNames = {};
    list.forEach(s=>{ const k=s.state||s.country; stateNames[k]=(stateNames[k]||0)+1; });
    const label = Object.entries(stateNames).sort((a,b)=>b[1]-a[1])[0][0];
    clusters.push({ key, lat, lon, stations:list, genre, label, seed: (seed++ * 0.7)%6.28, country:list[0].country, countrycode:list[0].countrycode });
  }
  return clusters;
}

async function loadStations(){
  setLoading(true, 'Sweeping the ionosphere for live signals…');
  try{
    const raw = await apiFetch('/json/stations/search?has_geo_info=true&hidebroken=true&order=clickcount&reverse=true&limit=900');
    state.stations = standardize(raw);
    state.clusters = buildClusters(state.stations);
    updateTopbarStats();
    renderLegend();
    setLoading(false);
  }catch(err){
    console.error(err);
    setLoading(true, 'Signal weak — retrying station sweep…');
    setTimeout(loadStations, 3000);
  }
}

function updateTopbarStats(){
  $('#statStations').textContent = state.stations.length.toLocaleString();
  const countries = new Set(state.stations.map(s=>s.countrycode).filter(Boolean));
  $('#statCountries').textContent = countries.size;
}

function renderLegend(){
  const host = $('#legend');
  host.innerHTML = GENRE_KEYS.map(k=>{
    const g = GENRES[k];
    return `<div class="lg-item"><span class="lg-dot" style="background:${g.color}"></span>${g.label}</div>`;
  }).join('');
}

/* -------------------------------------------------------------------------
   7. PANELS — cluster stream / facts / weather / archive / badges
   ------------------------------------------------------------------------- */
function openPanel(id){ $('#'+id).classList.remove('hidden'); }
function closePanel(id){ $('#'+id).classList.add('hidden'); }

function openCluster(cluster){
  state.hoverCluster = cluster;
  $('#clusterEyebrow').textContent = `${cluster.stations.length} SIGNAL${cluster.stations.length>1?'S':''} · ${cluster.country.toUpperCase()}`;
  $('#clusterTitle').textContent = cluster.label || cluster.country;
  const list = $('#streamList');
  list.innerHTML = cluster.stations.slice(0,60).map(s=>streamItemHTML(s)).join('');
  openPanel('streamPanel');
  list.querySelectorAll('.stream-item').forEach((el,i)=>{
    el.addEventListener('click', ()=>playStation(cluster.stations[i]));
  });
}

function streamItemHTML(s){
  const g = GENRES[s.genre];
  return `<div class="stream-item">
    <span class="stream-dot" style="background:${g.color}; box-shadow:0 0 8px ${g.color}"></span>
    <div class="stream-info">
      <p class="si-name">${escapeHTML(s.name)}</p>
      <p class="si-meta">${escapeHTML(s.state||s.country)} · ${g.label} · ${s.bitrate||'—'}kbps</p>
    </div>
    <span class="stream-live">LIVE</span>
  </div>`;
}
function escapeHTML(str){ return (str||'').replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

/* search ------------------------------------------------------------- */
let searchTimer=null;
$('#searchInput').addEventListener('input', e=>{
  clearTimeout(searchTimer);
  const q = e.target.value.trim();
  if(!q){ $('#searchResults').classList.add('hidden'); return; }
  searchTimer = setTimeout(()=>runSearch(q), 260);
});
function runSearch(q){
  const ql = q.toLowerCase();
  const localHits = state.stations.filter(s=>
    s.name.toLowerCase().includes(ql) ||
    s.country.toLowerCase().includes(ql) ||
    (s.state||'').toLowerCase().includes(ql) ||
    s.tags.toLowerCase().includes(ql)
  ).slice(0,18);
  const box = $('#searchResults');
  if(!localHits.length){
    box.innerHTML = `<div class="sr-item"><span>No local matches — try Enter to search the network</span></div>`;
  } else {
    box.innerHTML = localHits.map((s,i)=>`<div class="sr-item" data-i="${i}"><span>${escapeHTML(s.name)}</span><small>${escapeHTML(s.state||s.country)}</small></div>`).join('');
    box.querySelectorAll('.sr-item').forEach((el,i)=>{
      el.addEventListener('click', ()=>{ playStation(localHits[i]); box.classList.add('hidden'); flyTo(localHits[i].lon, localHits[i].lat); });
    });
  }
  box.classList.remove('hidden');
}
$('#searchInput').addEventListener('keydown', async e=>{
  if(e.key!=='Enter') return;
  const q = e.target.value.trim();
  if(!q) return;
  try{
    const raw = await apiFetch(`/json/stations/search?name=${encodeURIComponent(q)}&limit=40&hidebroken=true`);
    const results = standardize(raw);
    if(results.length){
      const cluster = { key:'search', lat:results[0].lat, lon:results[0].lon, stations:results, genre:results[0].genre, label:q, country:results[0].country };
      openCluster(cluster);
      flyTo(results[0].lon, results[0].lat);
    } else {
      toastRadar(`No live signal found for "${q}."`);
    }
  }catch(err){ console.error(err); }
});
document.addEventListener('click', e=>{
  if(!e.target.closest('.search-wrap')) $('#searchResults').classList.add('hidden');
});

function flyTo(lon,lat){
  // simplest smooth approach: animate rotY toward -lon
  const targetY = -rad(lon) - Math.PI/2 * 0; // align so lon faces viewer (theta=0)
  const target = -rad(lon);
  const targetX = clamp(rad(lat)*0.6, -1.1, 1.1);
  animateRotation(target, targetX);
}
function animateRotation(targetY, targetX){
  state.autoRotate=false;
  const startY = state.rotY, startX = state.rotX;
  // normalize shortest path
  let dy = ((targetY-startY+Math.PI)%(2*Math.PI))-Math.PI;
  const dur=1400, t0=performance.now();
  function step(now){
    const t = clamp((now-t0)/dur,0,1);
    const e = 1-Math.pow(1-t,3);
    state.rotY = startY + dy*e;
    state.rotX = startX + (targetX-startX)*e;
    if(t<1) requestAnimationFrame(step);
    else setTimeout(()=>state.autoRotate=true, 2500);
  }
  requestAnimationFrame(step);
}

/* close buttons */
$all('[data-close]').forEach(btn=>{
  btn.addEventListener('click', ()=>closePanel(btn.dataset.close));
});
$all('[data-panel]').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    const map = {lab:'weatherPanel', weather:'weatherPanel', archive:'archivePanel', badges:'badgesPanel'};
    if(btn.dataset.panel==='lab'){ openAudioLab(); return; }
    if(btn.dataset.panel==='weather'){ renderWeatherPanel(); openPanel('weatherPanel'); return; }
    if(btn.dataset.panel==='archive'){ renderArchivePanel(); openPanel('archivePanel'); return; }
    if(btn.dataset.panel==='badges'){ renderBadgesPanel(); openPanel('badgesPanel'); return; }
  });
});

/* Sound Weather panel -------------------------------------------------- */
function renderWeatherPanel(){
  const s = state.stations;
  if(!s.length){ $('#weatherBody').innerHTML='Gathering the network…'; return; }
  const byGenre = {};
  GENRE_KEYS.forEach(k=>byGenre[k]=0);
  let gospel=0;
  const byCluster = {};
  const byCountry = {};
  const byContinent = {};
  s.forEach(st=>{
    byGenre[st.genre]++;
    if((st.tags||'').toLowerCase().includes('gospel')) gospel++;
    byCountry[st.country] = (byCountry[st.country]||0)+1;
    const cont = continentOf(st.lat, st.lon);
    byContinent[cont] = (byContinent[cont]||0)+1;
  });
  state.clusters.forEach(c=>{
    const avgBitrate = c.stations.reduce((a,x)=>a+(x.bitrate||0),0)/c.stations.length;
    byCluster[c.key] = { label:c.label, country:c.country, avg:avgBitrate };
  });
  const loudest = Object.values(byCluster).sort((a,b)=>b.avg-a.avg)[0];
  const quietestCountry = Object.entries(byCountry).sort((a,b)=>a[1]-b[1])[0];
  const activeContinent = Object.entries(byContinent).sort((a,b)=>b[1]-a[1])[0];
  const topGenre = Object.entries(byGenre).sort((a,b)=>b[1]-a[1])[0];

  $('#weatherBody').innerHTML = `
    <div class="uw-row"><label>Loudest signal cluster</label><span>${escapeHTML(loudest? (loudest.label+', '+loudest.country) : '—')}</span></div>
    <div class="uw-row"><label>Quietest territory</label><span>${escapeHTML(quietestCountry? quietestCountry[0] : '—')}</span></div>
    <div class="uw-row"><label>Most Jazz right now</label><span>${byGenre.jazz}</span></div>
    <div class="uw-row"><label>Most News right now</label><span>${byGenre.news}</span></div>
    <div class="uw-row"><label>Most Gospel right now</label><span>${gospel}</span></div>
    <div class="uw-row"><label>Most Electronic right now</label><span>${byGenre.electronic}</span></div>
    <div class="uw-row"><label>Most active continent</label><span>${activeContinent? activeContinent[0]:'—'}</span></div>
    <div class="uw-row"><label>Dominant frequency overall</label><span>${GENRES[topGenre[0]].label}</span></div>
    <p style="margin-top:12px; color:var(--muted-2); font-size:11px;">Computed live from the ${s.length.toLocaleString()} signals currently tracked by World Signal.</p>
  `;
}

/* Archive panel --------------------------------------------------------- */
function renderArchivePanel(){
  const byCountry = {};
  state.stations.forEach(s=>{ byCountry[s.country]=(byCountry[s.country]||0)+1; });
  const top = Object.entries(byCountry).sort((a,b)=>b[1]-a[1]).slice(0,24);
  $('#archiveBody').innerHTML = `
    <div class="archive-group">
      <h4>BY GENRE</h4>
      ${GENRE_KEYS.map(k=>`<span class="archive-tag" data-genre="${k}">${GENRES[k].label}</span>`).join('')}
    </div>
    <div class="archive-group">
      <h4>BY TERRITORY</h4>
      ${top.map(([c,n])=>`<span class="archive-tag" data-country="${escapeHTML(c)}">${escapeHTML(c)} · ${n}</span>`).join('')}
    </div>
  `;
  $('#archiveBody').querySelectorAll('[data-genre]').forEach(el=>{
    el.addEventListener('click', ()=>{
      const g = el.dataset.genre;
      const matches = state.stations.filter(s=>s.genre===g).slice(0,60);
      if(matches.length){
        openCluster({ key:'genre', lat:matches[0].lat, lon:matches[0].lon, stations:matches, genre:g, label:GENRES[g].label, country:'' });
        closePanel('archivePanel');
      }
    });
  });
  $('#archiveBody').querySelectorAll('[data-country]').forEach(el=>{
    el.addEventListener('click', ()=>{
      const c = el.dataset.country;
      const matches = state.stations.filter(s=>s.country===c).slice(0,60);
      if(matches.length){
        openCluster({ key:'country', lat:matches[0].lat, lon:matches[0].lon, stations:matches, genre:matches[0].genre, label:c, country:c });
        flyTo(matches[0].lon, matches[0].lat);
        closePanel('archivePanel');
      }
    });
  });
}

/* Badges panel ----------------------------------------------------------- */
const BADGES = [
  { id:'first', icon:'📡', name:'First Contact', desc:'Play your first station' },
  { id:'night', icon:'🌙', name:'Night Owl', desc:'Play a station in the dark hours' },
  { id:'traveller', icon:'🌍', name:'World Traveller', desc:'Listen across 10 countries' },
  { id:'collector', icon:'💠', name:'Signal Collector', desc:'Listen across 25 countries' },
  { id:'jazzhunter', icon:'🎷', name:'Jazz Hunter', desc:'Play 5 jazz stations' },
  { id:'ocean', icon:'🌊', name:'Ocean Listener', desc:'Tune into an island nation' },
  { id:'mountain', icon:'⛰️', name:'Mountain Frequencies', desc:'Tune into a mountain nation' }
];
function renderBadgesPanel(){
  $('#badgesBody').innerHTML = `<div class="badge-grid">${BADGES.map(b=>{
    const un = state.achievements[b.id];
    return `<div class="badge ${un?'unlocked':''}"><div class="b-icon">${b.icon}</div><div class="b-name">${b.name}</div><div class="b-desc">${b.desc}</div></div>`;
  }).join('')}</div>`;
}
function unlock(id){
  if(state.achievements[id]) return;
  state.achievements[id]=true;
  localStorage.setItem('fo_achv', JSON.stringify(state.achievements));
  const b = BADGES.find(x=>x.id===id);
  if(b) toastRadar(`Achievement unlocked — ${b.name}.`);
}
function checkAchievements(station){
  unlock('first');
  const hourLocal = new Date().getHours();
  if(hourLocal>=0 && hourLocal<5) unlock('night');
  if(state.listenedCountries.size>=10) unlock('traveller');
  if(state.listenedCountries.size>=25) unlock('collector');
  if(station.genre==='jazz' && state.jazzPlays>=5) unlock('jazzhunter');
  if(ISLAND_NATIONS.has(station.countrycode)) unlock('ocean');
  if(MOUNTAIN_NATIONS.has(station.countrycode)) unlock('mountain');
}

/* -------------------------------------------------------------------------
   8. PLAYER
   ------------------------------------------------------------------------- */
const audioEl = $('#audioEl');

function ensureAudioGraph(){
  if(state.audioCtx) return;
  try{
    const Ctx = window.AudioContext || window.webkitAudioContext;
    state.audioCtx = new Ctx();
    const src = state.audioCtx.createMediaElementSource(audioEl);
    const splitter = state.audioCtx.createChannelSplitter(2);
    const merger = state.audioCtx.createGain();
    state.analyserL = state.audioCtx.createAnalyser();
    state.analyserR = state.audioCtx.createAnalyser();
    state.analyserMono = state.audioCtx.createAnalyser();
    [state.analyserL,state.analyserR,state.analyserMono].forEach(a=>{ a.fftSize=1024; a.smoothingTimeConstant=0.8; });
    src.connect(splitter);
    splitter.connect(state.analyserL,0);
    splitter.connect(state.analyserR,1);
    src.connect(state.analyserMono);
    src.connect(state.audioCtx.destination);
  }catch(err){
    console.warn('Audio graph unavailable, using simulated scopes.', err);
    state.simulatedScopes = true;
  }
}

async function playStation(station){
  state.activeStation = station;
  closePanel('streamPanel'); closePanel('factsPanel');
  openPanel_player();
  $('#playerName').textContent = station.name;
  $('#playerLoc').textContent = `${station.state? station.state+', ':''}${station.country}`;
  $('#playerFlag').textContent = flagEmoji(station.countrycode) || '📡';
  $('#metaGenre').textContent = GENRES[station.genre].label;
  $('#metaBitrate').textContent = station.bitrate? station.bitrate+' kbps' : '—';
  $('#metaLang').textContent = station.language || '—';
  $('#stationSite').href = station.homepage || station.url || '#';
  $('#nowPlayingText').textContent = 'Tuning in…';
  $('#metaSignal').textContent = signalBars(station.bitrate);
  $('#metaLatency').textContent = '—';

  audioEl.src = station.url;
  audioEl.volume = ($('#volumeRange').value)/100;
  ensureAudioGraph();
  if(state.audioCtx && state.audioCtx.state==='suspended') state.audioCtx.resume();

  const t0 = performance.now();
  audioEl.oncanplay = ()=>{ $('#metaLatency').textContent = Math.round(performance.now()-t0)+' ms'; };
  try{
    await audioEl.play();
    state.playing = true;
    $('#playPauseBtn').textContent='❚❚';
    $('#nowPlayingText').textContent = 'Live from ' + station.name;
  }catch(err){
    $('#nowPlayingText').textContent = 'Unable to connect to this signal — try another.';
  }

  // weather / time / sun via Open-Meteo (real, free, no key)
  fetchStationEnvironment(station);

  // bookkeeping for achievements
  state.playCount++; localStorage.setItem('fo_playcount', state.playCount);
  if(station.genre==='jazz'){ state.jazzPlays++; localStorage.setItem('fo_jazzplays', state.jazzPlays); }
  if(station.countrycode){ state.listenedCountries.add(station.countrycode); localStorage.setItem('fo_countries', JSON.stringify([...state.listenedCountries])); }
  checkAchievements(station);

  toastRadar(`Now tuned — ${station.name}, ${station.country}.`);
}

function openPanel_player(){ $('#player').classList.remove('hidden'); }
$('#playerClose').addEventListener('click', ()=>{
  $('#player').classList.add('hidden');
  audioEl.pause();
  state.playing=false;
});
$('#playPauseBtn').addEventListener('click', ()=>{
  if(state.playing){ audioEl.pause(); state.playing=false; $('#playPauseBtn').textContent='▶'; }
  else { audioEl.play(); state.playing=true; $('#playPauseBtn').textContent='❚❚'; }
});
$('#volumeRange').addEventListener('input', e=>{ audioEl.volume = e.target.value/100; });

function flagEmoji(cc){
  if(!cc || cc.length!==2) return '';
  const A = 127397;
  return String.fromCodePoint(...[...cc.toUpperCase()].map(c=>c.charCodeAt(0)+A));
}
function signalBars(bitrate){
  if(!bitrate) return '▂▄▆';
  if(bitrate>=192) return '▂▄▆█';
  if(bitrate>=128) return '▂▄▆';
  if(bitrate>=64) return '▂▄';
  return '▂';
}

let envTimer=null;
async function fetchStationEnvironment(station){
  clearInterval(envTimer);
  try{
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${station.lat}&longitude=${station.lon}&current=temperature_2m,weather_code&daily=sunrise,sunset&timezone=auto`;
    const res = await fetch(url);
    const data = await res.json();
    const temp = data.current?.temperature_2m;
    const code = data.current?.weather_code;
    $('#metaWeather').textContent = temp!=null? `${Math.round(temp)}°C, ${weatherCodeLabel(code)}` : '—';
    const sunrise = data.daily?.sunrise?.[0], sunset = data.daily?.sunset?.[0];
    $('#metaSun').textContent = sunrise&&sunset? `${fmtTime(sunrise)} / ${fmtTime(sunset)}` : '—';
    const offsetSec = data.utc_offset_seconds || 0;
    const updateClock = ()=>{
      const nowUtc = Date.now() + (new Date().getTimezoneOffset()*60000);
      const local = new Date(nowUtc + offsetSec*1000);
      $('#metaTime').textContent = local.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
    };
    updateClock();
    envTimer = setInterval(updateClock, 15000);
  }catch(err){
    $('#metaWeather').textContent = '—';
    $('#metaSun').textContent = '—';
  }
}
function fmtTime(iso){ const d=new Date(iso); return d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}); }
function weatherCodeLabel(code){
  const map = {0:'clear',1:'mostly clear',2:'partly cloudy',3:'overcast',45:'fog',48:'fog',
    51:'drizzle',61:'rain',63:'rain',65:'heavy rain',71:'snow',73:'snow',75:'heavy snow',
    80:'showers',95:'storms'};
  return map[code] || 'mild';
}

/* -------------------------------------------------------------------------
   9. SCOPES — real Web Audio analysis with graceful simulated fallback
   ------------------------------------------------------------------------- */
const scopeCanvases = {
  wheel: $('#wheelCanvas'), spec: $('#specCanvas'), osc: $('#scopeCanvas'), vec: $('#vectorCanvas')
};
function fitCanvas(cvs){
  const rect = cvs.getBoundingClientRect();
  cvs.width = rect.width*devicePixelRatio;
  cvs.height = rect.height*devicePixelRatio;
}
function fitAllScopes(){ Object.values(scopeCanvases).forEach(fitCanvas); }
window.addEventListener('resize', fitAllScopes);

let simPhase=0;
function scopesLoop(ts){
  requestAnimationFrame(scopesLoop);
  if($('#player').classList.contains('hidden')) return;
  if(!scopeCanvases.wheel.width) fitAllScopes();

  let freqData, timeData, freqL, freqR;
  const useSim = state.simulatedScopes || !state.analyserMono;
  if(!useSim){
    freqData = new Uint8Array(state.analyserMono.frequencyBinCount);
    timeData = new Uint8Array(state.analyserMono.fftSize);
    state.analyserMono.getByteFrequencyData(freqData);
    state.analyserMono.getByteTimeDomainData(timeData);
    freqL = new Uint8Array(state.analyserL.fftSize); state.analyserL.getByteTimeDomainData(freqL);
    freqR = new Uint8Array(state.analyserR.fftSize); state.analyserR.getByteTimeDomainData(freqR);
    // detect silence -> likely CORS-tainted stream, fall back gracefully
    const sum = freqData.reduce((a,b)=>a+b,0);
    if(sum===0){ simPhase+=0.02; }
  }
  if(useSim || (freqData && freqData.reduce((a,b)=>a+b,0)===0)){
    simPhase += 0.05;
    const n=128;
    freqData = new Uint8Array(n); timeData = new Uint8Array(n); freqL=new Uint8Array(n); freqR=new Uint8Array(n);
    for(let i=0;i<n;i++){
      freqData[i] = 80+80*Math.abs(Math.sin(i*0.2+simPhase))*Math.random();
      timeData[i] = 128+60*Math.sin(i*0.4+simPhase*2);
      freqL[i] = 128+50*Math.sin(i*0.3+simPhase*1.7);
      freqR[i] = 128+50*Math.sin(i*0.3+simPhase*1.7+0.4);
    }
  }

  drawWheel(scopeCanvases.wheel, freqData, ts);
  drawSpectrum(scopeCanvases.spec, freqData);
  drawOscilloscope(scopeCanvases.osc, timeData);
  drawVector(scopeCanvases.vec, freqL, freqR);
  drawVU(freqL, freqR);
}
requestAnimationFrame(scopesLoop);

function drawWheel(cvs, freqData, ts){
  const ctx = cvs.getContext('2d');
  const w=cvs.width,h=cvs.height,cx=w/2,cy=h/2,R=Math.min(w,h)*0.42;
  ctx.clearRect(0,0,w,h);
  ctx.strokeStyle='rgba(212,175,106,0.25)'; ctx.lineWidth=1;
  ctx.beginPath(); ctx.arc(cx,cy,R,0,7); ctx.stroke();
  const bars=48;
  for(let i=0;i<bars;i++){
    const v = freqData[Math.floor(i/bars*freqData.length)]/255;
    const a1 = (i/bars)*Math.PI*2 + (ts||0)/6000;
    const r1 = R*0.55, r2 = r1 + v*R*0.42;
    ctx.strokeStyle = `rgba(240,220,171,${0.35+v*0.6})`;
    ctx.lineWidth = 2*devicePixelRatio;
    ctx.beginPath();
    ctx.moveTo(cx+Math.cos(a1)*r1, cy+Math.sin(a1)*r1);
    ctx.lineTo(cx+Math.cos(a1)*r2, cy+Math.sin(a1)*r2);
    ctx.stroke();
  }
  ctx.fillStyle='rgba(212,175,106,0.9)';
  ctx.beginPath(); ctx.arc(cx,cy,3*devicePixelRatio,0,7); ctx.fill();
}
function drawSpectrum(cvs, freqData){
  const ctx = cvs.getContext('2d');
  const w=cvs.width,h=cvs.height;
  ctx.clearRect(0,0,w,h);
  const n = freqData.length, bw = w/n*2.2;
  for(let i=0;i<n/2.2;i++){
    const v = freqData[i]/255;
    const bh = v*h*0.92;
    const hue = 40 - v*40;
    ctx.fillStyle = `rgba(212,175,106,${0.35+v*0.6})`;
    ctx.fillRect(i*bw, h-bh, bw*0.72, bh);
  }
}
function drawOscilloscope(cvs, timeData){
  const ctx = cvs.getContext('2d');
  const w=cvs.width,h=cvs.height;
  ctx.clearRect(0,0,w,h);
  ctx.strokeStyle='rgba(127,216,232,0.85)'; ctx.lineWidth=1.6*devicePixelRatio;
  ctx.beginPath();
  for(let i=0;i<timeData.length;i++){
    const x = i/timeData.length*w;
    const y = h/2 + ((timeData[i]-128)/128)*(h/2*0.85);
    if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  }
  ctx.stroke();
}
function drawVector(cvs, L, R){
  const ctx = cvs.getContext('2d');
  const w=cvs.width,h=cvs.height,cx=w/2,cy=h/2;
  ctx.fillStyle='rgba(4,6,10,0.28)'; ctx.fillRect(0,0,w,h);
  ctx.strokeStyle='rgba(79,216,240,0.5)'; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(cx,0); ctx.lineTo(cx,h); ctx.moveTo(0,cy); ctx.lineTo(w,cy); ctx.stroke();
  ctx.fillStyle='rgba(240,220,171,0.85)';
  for(let i=0;i<L.length;i++){
    const x = cx + ((L[i]-128)/128)*(w/2*0.85);
    const y = cy - ((R[i]-128)/128)*(h/2*0.85);
    ctx.fillRect(x,y,1.4*devicePixelRatio,1.4*devicePixelRatio);
  }
}
function drawVU(L,R){
  const peakL = Math.max(...Array.from(L).map(v=>Math.abs(v-128)))/128;
  const peakR = Math.max(...Array.from(R).map(v=>Math.abs(v-128)))/128;
  $('#vuL').style.width = (peakL*100).toFixed(0)+'%';
  $('#vuR').style.width = (peakR*100).toFixed(0)+'%';
  const db = 20*Math.log10(Math.max(peakL,peakR,0.0001));
  $('#peakVal').textContent = isFinite(db)? db.toFixed(1) : '-∞';
}

function openAudioLab(){
  if($('#player').classList.contains('hidden')){
    toastRadar('Tune into a station first to open the Audio Lab.');
    return;
  }
  toastRadar('Audio Lab is live in the player scopes below.');
}

/* -------------------------------------------------------------------------
   10. DISCOVER MODE — "I FEEL CURIOUS"
   ------------------------------------------------------------------------- */
$('#curiousBtn').addEventListener('click', discoverRandom);
function discoverRandom(){
  if(!state.clusters.length) return;
  const c = state.clusters[Math.floor(Math.random()*state.clusters.length)];
  const station = c.stations[Math.floor(Math.random()*c.stations.length)];
  flyTo(station.lon, station.lat);
  setTimeout(()=>{
    playStation(station);
    showFacts(station);
  }, 1500);
}

async function showFacts(station){
  $('#factsTitle').textContent = `${station.state? station.state+', ':''}${station.country}`;
  $('#factsBody').innerHTML = `<p>Gathering coordinates…</p>`;
  openPanel('factsPanel');
  const cont = continentOf(station.lat, station.lon);
  const nearby = state.clusters
    .map(c=>({c, d:Math.hypot(c.lat-station.lat,c.lon-station.lon)}))
    .sort((a,b)=>a.d-b.d).slice(1,4).map(x=>x.c.label);
  let weatherLine = '—', timeLine='—';
  try{
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${station.lat}&longitude=${station.lon}&current=temperature_2m,weather_code&timezone=auto`;
    const res = await fetch(url); const data = await res.json();
    weatherLine = `${Math.round(data.current.temperature_2m)}°C, ${weatherCodeLabel(data.current.weather_code)}`;
    const offsetSec = data.utc_offset_seconds||0;
    const nowUtc = Date.now() + (new Date().getTimezoneOffset()*60000);
    timeLine = new Date(nowUtc + offsetSec*1000).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
  }catch(e){}

  $('#factsBody').innerHTML = `
    <div class="fact-row"><label>Continent</label><span>${cont}</span></div>
    <div class="fact-row"><label>Coordinates</label><span>${station.lat.toFixed(1)}°, ${station.lon.toFixed(1)}°</span></div>
    <div class="fact-row"><label>Language</label><span>${escapeHTML(station.language)}</span></div>
    <div class="fact-row"><label>Local time</label><span>${timeLine}</span></div>
    <div class="fact-row"><label>Weather</label><span>${weatherLine}</span></div>
    <div class="fact-row"><label>Dominant style</label><span>${GENRES[station.genre].label}</span></div>
    <div class="fact-row"><label>Nearby signals</label><span>${escapeHTML(nearby.join(', ')||'—')}</span></div>
    <p class="fact-blurb">"${randomTravelLine(station)}"</p>
  `;
}
function randomTravelLine(station){
  const lines = [
    `The airwaves of ${station.country} carry something worth stopping for.`,
    `Somewhere near ${station.lat.toFixed(1)}°, ${station.lon.toFixed(1)}°, a station keeps its city company.`,
    `${GENRES[station.genre].label} travels further than you'd think.`,
    `A small transmitter, a whole territory listening.`
  ];
  return lines[Math.floor(Math.random()*lines.length)];
}

/* -------------------------------------------------------------------------
   11. DISCOVERY RADAR — periodic toasts of "newly discovered" signals
   ------------------------------------------------------------------------- */
setInterval(()=>{
  if(!state.clusters.length) return;
  const pool = state.clusters.filter(c=>!state.discoveredKeys.has(c.key));
  const source = pool.length? pool : state.clusters;
  const c = source[Math.floor(Math.random()*source.length)];
  state.discoveredKeys.add(c.key);
  const templates = [
    `New signal discovered in ${c.country}.`,
    `Hidden ${GENRES[c.genre].label} station found in ${c.label||c.country}.`,
    `Community radio detected in ${c.country}.`
  ];
  toastRadar(templates[Math.floor(Math.random()*templates.length)]);
}, 8000);

/* -------------------------------------------------------------------------
   12. HEARTBEAT READOUT LABEL
   ------------------------------------------------------------------------- */
setInterval(()=>{
  if(!state.stations.length) return;
  const countries = new Set(state.stations.map(s=>s.countrycode)).size;
  const byGenre = {};
  state.stations.forEach(s=>byGenre[s.genre]=(byGenre[s.genre]||0)+1);
  const top = Object.entries(byGenre).sort((a,b)=>b[1]-a[1])[0];
  $('#heartbeatLabel').textContent = `Pulses arriving from ${countries} territories · dominant frequency: ${GENRES[top[0]].label}`;
}, 6000);

/* -------------------------------------------------------------------------
   12b. MOBILE FILTERS DRAWER (legend + time machine live here on small screens)
   ------------------------------------------------------------------------- */
(function filtersDrawer(){
  const btn = $('#filtersToggle');
  if(!btn) return;
  function setOpen(open){
    document.body.classList.toggle('show-filters', open);
    btn.classList.toggle('active', open);
  }
  btn.addEventListener('click', e=>{
    e.stopPropagation();
    setOpen(!document.body.classList.contains('show-filters'));
  });
  document.addEventListener('click', e=>{
    if(!document.body.classList.contains('show-filters')) return;
    if(e.target.closest('.legend') || e.target.closest('.timemachine') || e.target===btn) return;
    setOpen(false);
  });
  globeCvs.addEventListener('pointerdown', ()=>setOpen(false));
})();

/* -------------------------------------------------------------------------
   13. TIME MACHINE (cosmetic decade filter)
   ------------------------------------------------------------------------- */
const DECADE_LABELS=['1950','1960','1970','1980','1990','2000','2010','Today'];
const DECADE_ERA = ['era-vintage','era-vintage','era-vintage','era-crt','era-crt','era-neon','era-neon',''];
$('#decadeSlider').addEventListener('input', e=>{
  const idx = +e.target.value;
  state.decade = idx;
  document.body.classList.remove('era-crt','era-neon','era-vintage');
  if(DECADE_ERA[idx]) document.body.classList.add(DECADE_ERA[idx]);
  toastRadar(`Time Machine: visual aesthetic set to ${DECADE_LABELS[idx]}. Live signals shown regardless of era.`);
});

/* -------------------------------------------------------------------------
   14. UTC CLOCK + NIGHT MODE BODY CLASS
   ------------------------------------------------------------------------- */
setInterval(()=>{
  const now = new Date();
  $('#statUTC').textContent = now.toUTCString().slice(17,22);
  const h = now.getUTCHours();
  document.body.classList.toggle('night', h<6 || h>19);
}, 1000);

/* -------------------------------------------------------------------------
   15. LOADING SCREEN HELPER
   ------------------------------------------------------------------------- */
function setLoading(on, text){
  const el = $('#loadingScreen');
  if(text) $('#loadingText').textContent = text;
  el.classList.toggle('hidden', !on);
}

/* -------------------------------------------------------------------------
   16. HOME -> WORLD TRANSITION
   ------------------------------------------------------------------------- */
$('#enterBtn').addEventListener('click', ()=>{
  $('#home').classList.add('leaving');
  $('#world').classList.remove('hidden');
  setTimeout(()=>{ $('#home').style.display='none'; }, 1200);
  fitAllScopes();
  if(!state.stations.length) loadStations();
});

/* -------------------------------------------------------------------------
   17. SERVICE WORKER (PWA / offline shell)
   ------------------------------------------------------------------------- */
if('serviceWorker' in navigator){
  window.addEventListener('load', ()=>{
    navigator.serviceWorker.register('sw.js').catch(()=>{});
  });
}
