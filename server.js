
'use strict';
// Self-hosted Hexagonal Alliance multiplayer. Node.js 20+, no packages required.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 8000);
const HOST = process.env.HOST || '0.0.0.0';
const DATA_FILE = path.resolve(process.env.DATA_FILE || path.join(__dirname, 'world.json'));
const W = 20, H = 20;
const countries = [
  {id:'portugal',name:'Portugal',home:[2,3]},
  {id:'japan',name:'Japan',home:[16,3]},
  {id:'iceland',name:'Iceland',home:[2,16]},
  {id:'kenya',name:'Kenya',home:[16,16]},
  {id:'canada',name:'Canada',home:[9,9]}
];
const key = (q,r) => `${q},${r}`;
const nation = id => countries.find(c=>c.id===id);
const dist = (a,b) => {
  const aq=a[0]-Math.floor(a[1]/2), ar=a[1], bq=b[0]-Math.floor(b[1]/2), br=b[1];
  const dq=aq-bq,dr=ar-br;
  return (Math.abs(dq)+Math.abs(dr)+Math.abs(dq+dr))/2;
};
const dateKey = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const count = id => Object.values(state.owners).filter(x=>x===id).length;

function fresh() {
  const now = new Date();
  const s={
    owners:{},
    points:Object.fromEntries(countries.map(c=>[c.id,1])),
    units:Object.fromEntries(countries.map(c=>[c.id,[...c.home]])),
    claims:{},
    lastAward:now.getHours()<17?dateKey(now):'',
    events:[{time:'NOW',html:'The alliance is founded. Five countries enter the world.'}],
    version:0
  };
  for(let r=0;r<H;r++)for(let q=0;q<W;q++){
    let selected=countries[0],best=Infinity;
    for(let i=0;i<countries.length;i++){
      const c=countries[i],noise=Math.sin(q*7.31+r*2.17+i*11.4)*.8;
      const value=dist([q,r],c.home)+noise;
      if(value<best){best=value;selected=c;}
    }
    s.owners[key(q,r)]=selected.id;
  }
  return s;
}

let state;
try { state=JSON.parse(fs.readFileSync(DATA_FILE,'utf8')); }
catch { state=fresh(); }
if (!state || !state.owners || !state.points || !state.units || !state.claims)
  throw Error('Invalid world.json');

const clients=new Set();
function publicState(){
  const {claims,...publicFields}=state;
  return {...publicFields,claimed:Object.keys(claims)};
}
function sendEvents(){
  const message=`data: ${JSON.stringify(publicState())}\n\n`;
  for(const res of clients){
    try{res.write(message);}catch{clients.delete(res);}
  }
}
function save(){
  state.version=(state.version||0)+1;
  fs.mkdirSync(path.dirname(DATA_FILE),{recursive:true});
  const tmp=DATA_FILE+'.tmp';
  fs.writeFileSync(tmp,JSON.stringify(state,null,2));
  fs.renameSync(tmp,DATA_FILE);
  sendEvents();
}
function event(html){
  state.events.unshift({
    time:new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}),
    html
  });
  state.events=state.events.slice(0,12);
}
function spend(id){state.points[id]=Math.max(0,(state.points[id]||0)-1);}

function botAct(id){
  if(!state.points[id]||!count(id))return;
  const unit=state.units[id],targets=[];
  for(let r=0;r<H;r++)for(let q=0;q<W;q++)
    if(state.owners[key(q,r)]!==id&&dist(unit,[q,r])<=2)
      targets.push([q,r]);

  if(targets.length){
    const target=targets[Math.floor(Math.random()*Math.min(3,targets.length))];
    const old=nation(state.owners[key(...target)]);
    state.owners[key(...target)]=id;
    spend(id);
    event(`<strong>${nation(id).name}</strong> captured land from <strong>${old?.name||'the frontier'}</strong>.`);
    return;
  }
  let best=null,score=Infinity;
  for(let r=0;r<H;r++)for(let q=0;q<W;q++)if(state.owners[key(q,r)]===id){
    let enemyDistance=Infinity;
    for(let y=0;y<H;y++)for(let x=0;x<W;x++)
      if(state.owners[key(x,y)]!==id)
        enemyDistance=Math.min(enemyDistance,dist([q,r],[x,y]));
    if(dist(unit,[q,r])===1&&enemyDistance<score){
      score=enemyDistance;best=[q,r];
    }
  }
  if(best){
    state.units[id]=best;spend(id);
    event(`<strong>${nation(id).name}</strong> repositioned its commander.`);
  }
}

function award(){
  const now=new Date(),today=dateKey(now);
  if(now.getHours()<17||state.lastAward===today)return;
  const due=[];
  if(!state.lastAward)due.push(today);
  else{
    const cursor=new Date(`${state.lastAward}T12:00:00`);
    cursor.setDate(cursor.getDate()+1);
    while(dateKey(cursor)<=today&&due.length<3660){
      due.push(dateKey(cursor));cursor.setDate(cursor.getDate()+1);
    }
  }
  if(!due.length)return;
  for(const day of due){
    state.lastAward=day;
    for(const c of countries){
      if(!count(c.id))continue;
      state.points[c.id]=(state.points[c.id]||0)+1;
      if(!state.claims[c.id])botAct(c.id);
    }
  }
  event(due.length===1?'Daily point received. Unclaimed countries acted.':`${due.length} daily awards processed.`);
  save();
}

function reply(res,status,data){
  res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});
  res.end(JSON.stringify(data));
}
function readBody(req){
  return new Promise((resolve,reject)=>{
    let body='';
    req.on('data',chunk=>{
      body+=chunk;
      if(body.length>4096){reject(Error('Request too large'));req.destroy();}
    });
    req.on('end',()=>{
      try{resolve(JSON.parse(body||'{}'));}
      catch{reject(Error('Invalid JSON'));}
    });
    req.on('error',reject);
  });
}
function identity(token){
  if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))return null;
  return countries.find(c=>state.claims[c.id]===token)?.id||null;
}

function takeAction(id,kind,q,r){
  if(!count(id))throw Error('Your country has no remaining territory.');
  if(!state.points[id])throw Error('No action points available.');
  if(!Number.isInteger(q)||!Number.isInteger(r)||q<0||r<0||q>=W||r>=H)
    throw Error('Invalid hex.');

  const owner=state.owners[key(q,r)],from=state.units[id],player=nation(id);
  let message;
  if(kind==='attack'){
    if(owner===id||dist(from,[q,r])>2)
      throw Error('Choose a rival territory within 2 hexes.');
    const previous=nation(owner);
    state.owners[key(q,r)]=id;
    event(`<strong>${player.name}</strong> took a territory from <strong>${previous?.name||'the frontier'}</strong>.`);
    message='Territory captured.';
  }else if(kind==='move'){
    if(owner!==id||dist(from,[q,r])!==1)
      throw Error('Move one hex into your own territory.');
    state.units[id]=[q,r];
    event(`<strong>${player.name}</strong> moved its commander.`);
    message='Commander moved.';
  }else if(kind==='give'){
    if(!nation(owner)||owner===id||!state.units[owner]||dist(from,state.units[owner])>2)
      throw Error('Choose a nearby country commander.');
    state.points[owner]=(state.points[owner]||0)+1;
    event(`<strong>${player.name}</strong> gave 1 point to <strong>${nation(owner).name}</strong>.`);
    message=`1 point sent to ${nation(owner).name}.`;
  }else throw Error('Invalid action.');

  spend(id);save();return message;
}

function serveIndex(req,res){
  if(req.url!=='/'&&req.url!=='/index.html'){
    res.writeHead(404);res.end('Not found');return;
  }
  res.writeHead(200,{
    'content-type':'text/html; charset=utf-8',
    'cache-control':'no-store',
    'x-content-type-options':'nosniff'
  });
  fs.createReadStream(path.join(__dirname,'index.html')).pipe(res);
}

const server=http.createServer(async(req,res)=>{
  try{
    award();
    const url=new URL(req.url,'http://localhost');

    if(req.method==='GET'&&url.pathname==='/api/state')
      return reply(res,200,publicState());

    if(req.method==='GET'&&url.pathname==='/api/events'){
      res.writeHead(200,{
        'content-type':'text/event-stream',
        'cache-control':'no-cache, no-transform',
        'connection':'keep-alive',
        'x-accel-buffering':'no'
      });
      clients.add(res);
      res.write(`data: ${JSON.stringify(publicState())}\n\n`);
      req.on('close',()=>clients.delete(res));
      return;
    }

    if(req.method==='POST'&&url.pathname==='/api/join'){
      const body=await readBody(req),id=body.country;
      if(!nation(id))return reply(res,400,{error:'Unknown country.'});
      if(state.claims[id])
        return reply(res,409,{error:'Country already claimed. Choose another.'});
      if(!count(id))
        return reply(res,409,{error:'That country has been eliminated.'});
      const token=crypto.randomBytes(32).toString('hex');
      state.claims[id]=token;
      event(`<strong>${nation(id).name}</strong> now has a human commander.`);
      save();
      return reply(res,200,{token,country:id});
    }

    if(req.method==='POST'&&url.pathname==='/api/action'){
      const body=await readBody(req),id=identity(body.token);
      if(!id)return reply(res,401,{error:'Your player token is missing or invalid. Rejoin with an unclaimed country.'});
      try{
        return reply(res,200,{message:takeAction(id,body.action,body.q,body.r)});
      }catch(e){
        return reply(res,400,{error:e.message});
      }
    }

    if(req.method==='POST'&&url.pathname==='/api/identity'){
      const body=await readBody(req);
      return reply(res,200,{country:identity(body.token)});
    }

    if(req.method==='POST'&&url.pathname==='/api/reset'){
      const expected=process.env.ADMIN_TOKEN;
      if(!expected||req.headers.authorization!==`Bearer ${expected}`)
        return reply(res,403,{error:'Admin token required.'});
      state=fresh();save();
      return reply(res,200,{ok:true});
    }

    if(req.method==='GET')return serveIndex(req,res);
    reply(res,404,{error:'Not found'});
  }catch(e){
    if(!res.headersSent)reply(res,500,{error:'Request failed.'});
    console.error(e);
  }
});

setInterval(award,30_000);
setInterval(()=>{
  for(const res of clients){
    try{res.write(': keepalive\n\n');}
    catch{clients.delete(res);}
  }
},20_000);

server.listen(PORT,HOST,()=>{
  console.log(`Hexagonal Alliance: http://localhost:${PORT} (server timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone})`);
});
