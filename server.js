const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static(path.join(__dirname, "public")));

const rooms = new Map();
const PORT = process.env.PORT || 3000;

const CARDS = {
  place: ["Biblioteka","Plesna sala","Kuhinja","Spavaća soba","Radna soba","Kupatilo","Staklenik","Dnevni boravak"],
  suspect: ["Vrtlar","Kuhar","Domaćica / Služavka","Batler","Vlasnik vile","Nasljednica","Advokat","Doktor"],
  weapon: ["Revolver","Nož","Svijećnjak","Čekić","Sjekira","Štap za hodanje","Satara","Lanac","Žarač","Otvarač pisama"],
  time: ["17:00–19:00 · Rano veče","19:00–21:00 · Sumrak","21:00–23:00 · Kasno veče","23:00–01:00 · Ponoć","01:00–03:00 · Duboka noć","03:00–05:00 · Pred zoru"]
};
const ROOMS = [
  {name:"Biblioteka", icon:"▤", color:"#806a9a", x:2,y:2,w:5,h:4},
  {name:"Plesna sala", icon:"♬", color:"#a77b54", x:17,y:2,w:5,h:4},
  {name:"Kuhinja", icon:"♨", color:"#9a6c50", x:2,y:18,w:5,h:4},
  {name:"Spavaća soba", icon:"☾", color:"#647c9d", x:17,y:18,w:5,h:4},
  {name:"Radna soba", icon:"✒", color:"#8a784e", x:2,y:10,w:5,h:4},
  {name:"Kupatilo", icon:"◇", color:"#588c91", x:17,y:10,w:5,h:4},
  {name:"Staklenik", icon:"❀", color:"#66865e", x:10,y:2,w:5,h:4},
  {name:"Dnevni boravak", icon:"♜", color:"#95636b", x:10,y:18,w:5,h:4}
];
const TOKENS = ["#d6a65d","#6fa5bd","#b97878","#8eaa77","#a18ac2","#d08b52","#6faaa0","#c18ca7"];
const shuffle = a => { const b=[...a]; for(let i=b.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[b[i],b[j]]=[b[j],b[i]];} return b; };
const uid = () => crypto.randomBytes(18).toString("hex");
const allCards = () => Object.entries(CARDS).flatMap(([type,items])=>items.map(name=>({id:type+":"+name,type,name})));
function newGame(room) {
  const deck=allCards(), solution={};
  for(const type of Object.keys(CARDS)){const i=deck.findIndex(c=>c.type===type);solution[type]=deck.splice(i,1)[0];}
  room.solution=solution;
  room.deck=shuffle(deck);
  room.discard=[];
  room.turnIndex=0; room.completedTurns=0; room.status="playing"; room.winner=null;
  room.log=[];
  room.players.forEach((p,i)=>{p.pos={x:12,y:12};p.energy=0;p.hand=[];p.seen=[];p.explored=[];p.roomCycle=0;p.questions=0;p.failedAccusation=false;p.canAccuse=true;p.token=TOKENS[i%TOKENS.length];p.stats={rooms:0,discoveries:0,questions:0,turns:0};p.notebook={};});
  addLog(room,"Slučaj je otvoren. Istražitelji, pronađite četiri karte koje čine rješenje.");
  beginTurn(room);
}
function addLog(room,msg){room.log.push({msg,at:Date.now()}); if(room.log.length>80)room.log.shift();}
function beginTurn(room){if(room.status!=="playing")return; const p=room.players[room.turnIndex];if(!p)return;p.energy=8;p.stats.turns++;addLog(room,`Na potezu je ${p.name}. Dobija 8 energije.`); }
function publicState(room){
  return {code:room.code,status:room.status,hostId:room.hostId,players:room.players.map(p=>({id:p.id,name:p.name,pos:p.pos,energy:p.energy,token:p.token,active:room.players[room.turnIndex]?.id===p.id,canAccuse:p.canAccuse,failedAccusation:p.failedAccusation,explored:p.explored,stats:p.stats})),turnIndex:room.turnIndex,completedTurns:room.completedTurns,maxTurns:80,log:room.log.slice(-35),rooms:ROOMS, winner:room.winner};
}
function privateState(room,p){return {hand:p.hand,seen:p.seen,explored:p.explored,energy:p.energy,notebook:p.notebook,canAccuse:p.canAccuse};}
function emitRoom(room){io.to(room.code).emit("state",publicState(room));room.players.forEach(p=>{const s=io.sockets.sockets.get(p.socketId);if(s)s.emit("private",privateState(room,p));});}
function playerBySocket(room,socketId){return room.players.find(p=>p.socketId===socketId);}
function current(room,p){return room.status==="playing"&&room.players[room.turnIndex]?.id===p.id;}
function cardById(id){return allCards().find(c=>c.id===id);}
function drawCard(room,p){
  if(room.deck.length===0){
    room.players.forEach(pl=>{room.discard.push(...pl.hand);pl.hand=[];});
    room.deck=shuffle(room.discard);room.discard=[];
    addLog(room,"Špil je obnovljen: svi su vratili karte i počinje novi ciklus izvlačenja.");
  }
  if(!room.deck.length)return null;
  // Never give a player a card already in their current hand; recycle safely if needed.
  let idx=room.deck.findIndex(c=>!p.hand.some(h=>h.id===c.id));
  if(idx<0){
    room.players.forEach(pl=>{room.discard.push(...pl.hand);pl.hand=[];});
    room.deck=shuffle(room.discard);room.discard=[];
    idx=room.deck.findIndex(c=>!p.hand.some(h=>h.id===c.id));
  }
  if(idx<0)return null;
  const [card]=room.deck.splice(idx,1);p.hand.push(card);
  if(!p.seen.some(c=>c.id===card.id)){p.seen.push(card);p.stats.discoveries++;}
  return card;
}
function roomAt(pos){return ROOMS.find(r=>pos.x>=r.x&&pos.x<r.x+r.w&&pos.y>=r.y&&pos.y<r.y+r.h);}
function isWalkable(x,y){
  if(x<0||y<0||x>=25||y>=25)return false;
  if(ROOMS.some(r=>x>=r.x&&x<r.x+r.w&&y>=r.y&&y<r.y+r.h))return true;
  // Cross-shaped corridors with branches connecting each room.
  return (x>=9&&x<=15)||(y>=7&&y<=17)||(x>=7&&x<=17&&y>=5&&y<=19);
}
function occupied(room,x,y,except){return room.players.some(p=>p.id!==except&&p.pos.x===x&&p.pos.y===y);}
function connected(room,x,y,except){
  return Math.abs(x-room.players.find(p=>p.id===except).pos.x)+Math.abs(y-room.players.find(p=>p.id===except).pos.y)===1 && isWalkable(x,y)&&!occupied(room,x,y,except);
}
function roomEntry(room,p){
  const r=roomAt(p.pos); if(!r)return;
  if(p.explored.includes(r.name)){addLog(room,`${p.name} se vratio u ${r.name}.`);return;}
  p.explored.push(r.name);p.stats.rooms++;
  const card=drawCard(room,p);
  addLog(room,`${p.name} je ušao/la u ${r.name}. Dokaz je pronađen.`);
  if(card){const s=io.sockets.sockets.get(p.socketId);if(s)s.emit("discovery",{card,room:r.name,bonus:false});}
  if(p.explored.length===8){
    const bonus=drawCard(room,p);
    p.explored=[];
    addLog(room,`${p.name} je istražio/la svih osam prostorija i osvojio/la bonus kartu. Novi krug istraživanja je otključan.`);
    const s=io.sockets.sockets.get(p.socketId);if(s&&bonus)s.emit("discovery",{card:bonus,room:"BONUS — svih 8 prostorija",bonus:true});
  }
}
function endTurn(room){
  room.completedTurns++;
  if(room.completedTurns>=80){room.status="ended";room.winner={type:"deadline",name:"Robot Detective"};addLog(room,"Isteklo je 80 ljudskih poteza. Robot Detective je aktivirao vremensko ograničenje — svi gube.");return;}
  room.turnIndex=(room.turnIndex+1)%room.players.length;beginTurn(room);
}
function roomFor(socket){for(const r of rooms.values())if(r.players.some(p=>p.socketId===socket.id))return r;return null;}
function fail(socket,msg){socket.emit("errorMsg",msg);}
io.on("connection",socket=>{
  socket.on("createRoom",({name})=>{
    if(roomFor(socket))return;
    const code=crypto.randomBytes(3).toString("hex").toUpperCase();
    const p={id:uid(),socketId:socket.id,name:String(name||"Detektiv").trim().slice(0,18),pos:{x:12,y:12},energy:0,hand:[],seen:[],explored:[],token:TOKENS[0],canAccuse:true,failedAccusation:false,stats:{rooms:0,discoveries:0,questions:0,turns:0},notebook:{}};
    const r={code,hostId:p.id,players:[p],status:"lobby",log:[],turnIndex:0,completedTurns:0};
    rooms.set(code,r);socket.join(code);socket.emit("joined",{code,playerId:p.id,token:p.id});emitRoom(r);
  });
  socket.on("joinRoom",({code,name})=>{
    const r=rooms.get(String(code||"").toUpperCase());if(!r)return fail(socket,"Soba ne postoji.");
    if(r.status!=="lobby")return fail(socket,"Igra je već počela.");
    if(r.players.length>=8)return fail(socket,"Soba je puna (maksimalno 8 igrača).");
    const clean=String(name||"Detektiv").trim().slice(0,18)||"Detektiv";
    if(r.players.some(p=>p.name.toLowerCase()===clean.toLowerCase()))return fail(socket,"To ime je već zauzeto.");
    const p={id:uid(),socketId:socket.id,name:clean,pos:{x:12,y:12},energy:0,hand:[],seen:[],explored:[],token:TOKENS[r.players.length%TOKENS.length],canAccuse:true,failedAccusation:false,stats:{rooms:0,discoveries:0,questions:0,turns:0},notebook:{}};
    r.players.push(p);socket.join(r.code);socket.emit("joined",{code:r.code,playerId:p.id,token:p.id});addLog(r,`${clean} se pridružio/la istrazi.`);emitRoom(r);
  });
  socket.on("startGame",()=>{
    const r=roomFor(socket);if(!r)return;const p=playerBySocket(r,socket.id);
    if(p.id!==r.hostId)return fail(socket,"Samo domaćin može pokrenuti igru.");
    if(r.players.length<2)return fail(socket,"Potrebna su najmanje dva igrača.");
    newGame(r);emitRoom(r);
  });
  socket.on("move",({x,y})=>{
    const r=roomFor(socket);if(!r)return;const p=playerBySocket(r,socket.id);
    if(!current(r,p))return fail(socket,"Nije tvoj potez.");
    if(p.energy<1)return fail(socket,"Nemaš dovoljno energije.");
    if(!Number.isInteger(x)||!Number.isInteger(y)||!connected(r,x,y,p.id))return fail(socket,"To polje nije dostupno.");
    p.pos={x,y};p.energy--;roomEntry(r,p);emitRoom(r);
  });
  socket.on("tunnel",()=>{
    const r=roomFor(socket);if(!r)return;const p=playerBySocket(r,socket.id);if(!current(r,p))return fail(socket,"Nije tvoj potez.");
    if(p.energy<4)return fail(socket,"Tunel košta 4 energije.");
    const ends=[{x:8,y:8},{x:16,y:16},{x:8,y:16},{x:16,y:8}];
    const i=ends.findIndex(e=>e.x===p.pos.x&&e.y===p.pos.y);if(i<0)return fail(socket,"Moraš stajati na ulazu u tunel.");
    const dest=ends[i%2===0?i+1:i-1];if(occupied(r,dest.x,dest.y,p.id))return fail(socket,"Izlaz tunela je zauzet.");
    p.pos=dest;p.energy-=4;addLog(r,`${p.name} je koristio/la tajni tunel.`);roomEntry(r,p);emitRoom(r);
  });
  socket.on("askQuestion",({targetId,cardId})=>{
    const r=roomFor(socket);if(!r)return;const p=playerBySocket(r,socket.id);
    if(!current(r,p))return fail(socket,"Nije tvoj potez.");if(p.energy<6)return fail(socket,"Pitanje košta 6 energije.");
    const target=r.players.find(x=>x.id===targetId);const card=cardById(cardId);
    if(!target||target.id===p.id||!card)return fail(socket,"Neispravan izbor.");
    p.energy-=6;p.stats.questions++;addLog(r,`${p.name} je postavio/la privatno pitanje igraču ${target.name}.`);
    const has=target.hand.some(c=>c.id===cardId)||target.seen.some(c=>c.id===cardId);
    socket.emit("answer",{target:target.name,card:card.name,has});
    emitRoom(r);
  });
  socket.on("accuse",({place,suspect,weapon,time})=>{
    const r=roomFor(socket);if(!r)return;const p=playerBySocket(r,socket.id);
    if(!current(r,p))return fail(socket,"Nije tvoj potez.");if(!p.canAccuse)return fail(socket,"Već si iskoristio/la svoju optužbu.");
    const guess={place,suspect,weapon,time};
    const valid=Object.values(guess).every(Boolean);if(!valid)return fail(socket,"Odaberi sve četiri kategorije.");
    const correct=r.solution.place.name===place&&r.solution.suspect.name===suspect&&r.solution.weapon.name===weapon&&r.solution.time.name===time;
    p.canAccuse=false;
    if(correct){r.status="ended";r.winner={type:"human",id:p.id,name:p.name};addLog(r,`${p.name} je riješio/la slučaj!`);}
    else{p.failedAccusation=true;addLog(r,`${p.name} je iznio/la pogrešnu završnu optužbu.`);}
    emitRoom(r);
    if(r.status==="ended")io.to(r.code).emit("reveal",{solution:r.solution,winner:r.winner,players:r.players.map(x=>({name:x.name,stats:x.stats,failed:x.failedAccusation}))});
  });
  socket.on("endTurn",()=>{
    const r=roomFor(socket);if(!r)return;const p=playerBySocket(r,socket.id);if(!current(r,p))return;
    addLog(r,`${p.name} je završio/la potez.`);endTurn(r);emitRoom(r);
    if(r.status==="ended")io.to(r.code).emit("reveal",{solution:r.solution,winner:r.winner,players:r.players.map(x=>({name:x.name,stats:x.stats,failed:x.failedAccusation}))});
  });
  socket.on("saveNotebook",data=>{const r=roomFor(socket);if(!r)return;const p=playerBySocket(r,socket.id);p.notebook=data||{};socket.emit("private",privateState(r,p));});
  socket.on("disconnect",()=>{
    const r=roomFor(socket);if(!r)return;const p=playerBySocket(r,socket.id);p.disconnected=true;addLog(r,`${p.name} se odspojio/la. Može se vratiti ponovnim ulaskom uz kod sobe.`);
    if(p.id===r.hostId){const next=r.players.find(x=>x.id!==p.id);if(next)r.hostId=next.id;}
    emitRoom(r);
  });
});

server.listen(PORT,()=>console.log(`Mystery Mansion running on ${PORT}`));
