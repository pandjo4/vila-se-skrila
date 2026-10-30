const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true }, pingInterval: 25000, pingTimeout: 20000 });
app.use(express.static(path.join(__dirname, "public")));

const rooms = new Map();
const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 8;
const MAX_TURNS = 80;
const QUESTION_COST = 6;
const TUNNEL_COST = 4;
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
const TUNNELS = [{x:8,y:8},{x:16,y:16}];
const TOKENS = ["#d6a65d","#6fa5bd","#b97878","#8eaa77","#a18ac2","#d08b52","#6faaa0","#c18ca7"];
const shuffle = a => { const b=[...a]; for(let i=b.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[b[i],b[j]]=[b[j],b[i]];} return b; };
const uid = () => crypto.randomBytes(18).toString("hex");
const allCards = () => Object.entries(CARDS).flatMap(([type,items])=>items.map(name=>({id:type+":"+name,type,name})));
function cleanName(value){return String(value||"").replace(/[<>]/g,"").trim().slice(0,18)||"Detektiv";}
function addLog(room,msg){room.log.push({msg,at:Date.now()});if(room.log.length>80)room.log.shift();}
function beginTurn(room){if(room.status!=="playing")return;const p=room.players[room.turnIndex];if(!p)return;p.energy=8;p.stats.turns++;p.questionUsed=false;addLog(room,`Na potezu je ${p.name}. Dobija 8 energije.`);}
function newGame(room){
  const deck=allCards(),solution={};
  for(const type of Object.keys(CARDS)){const candidates=deck.map((c,i)=>c.type===type?i:-1).filter(i=>i>=0);const i=candidates[Math.floor(Math.random()*candidates.length)];solution[type]=deck.splice(i,1)[0];}
  room.solution=solution;room.deck=shuffle(deck);room.discard=[];room.pendingQuestion=null;
  room.turnIndex=0;room.completedTurns=0;room.status="playing";room.winner=null;room.log=[];
  room.players.forEach((p,i)=>{p.pos={x:12,y:12};p.energy=0;p.hand=[];p.seen=[];p.explored=[];p.roomCycle=0;p.questionUsed=false;p.failedAccusation=false;p.canAccuse=true;p.token=TOKENS[i%TOKENS.length];p.stats={rooms:0,discoveries:0,questions:0,turns:0};p.notebook={};p.confirmedCards=[];});
  addLog(room,"Slučaj je otvoren. Istražitelji, pronađite četiri karte koje čine rješenje.");beginTurn(room);
}
function publicState(room){
 return {code:room.code,status:room.status,hostId:room.hostId,players:room.players.map(p=>({id:p.id,name:p.name,pos:p.pos,energy:p.energy,token:p.token,active:room.players[room.turnIndex]?.id===p.id,connected:!!p.socketId,canAccuse:p.canAccuse,failedAccusation:p.failedAccusation,explored:p.explored,stats:p.stats})),turnIndex:room.turnIndex,completedTurns:room.completedTurns,maxTurns:MAX_TURNS,log:room.log.slice(-35),rooms:ROOMS,tunnels:TUNNELS,winner:room.winner};
}
function privateState(room,p){return {hand:p.hand,seen:p.seen,explored:p.explored,energy:p.energy,notebook:p.notebook,confirmedCards:p.confirmedCards||[],canAccuse:p.canAccuse,pendingQuestion:room.pendingQuestion?.targetId===p.id?{id:room.pendingQuestion.id,asker:room.players.find(x=>x.id===room.pendingQuestion.askerId)?.name,card:room.pendingQuestion.card}:null};}
function emitRoom(room){io.to(room.code).emit("state",publicState(room));room.players.forEach(p=>{const s=p.socketId&&io.sockets.sockets.get(p.socketId);if(s)s.emit("private",privateState(room,p));});}
function playerBySocket(room,id){return room.players.find(p=>p.socketId===id);}
function roomFor(socket){for(const r of rooms.values())if(r.players.some(p=>p.socketId===socket.id))return r;return null;}
function current(room,p){return !!p&&room.status==="playing"&&room.players[room.turnIndex]?.id===p.id;}
function fail(socket,msg){socket.emit("errorMsg",msg);}
function cardById(id){return allCards().find(c=>c.id===id);}
function drawCard(room,p){
 if(room.deck.length===0){room.players.forEach(pl=>{room.discard.push(...pl.hand);pl.hand=[];});room.deck=shuffle(room.discard);room.discard=[];addLog(room,"Špil je obnovljen: karte iz prethodnog ciklusa ponovo su promiješane.");}
 if(!room.deck.length)return null;
 let idx=room.deck.findIndex(c=>!p.hand.some(h=>h.id===c.id));
 if(idx<0){room.players.forEach(pl=>{room.discard.push(...pl.hand);pl.hand=[];});room.deck=shuffle(room.discard);room.discard=[];idx=room.deck.findIndex(c=>!p.hand.some(h=>h.id===c.id));}
 if(idx<0)return null;
 const [card]=room.deck.splice(idx,1);p.hand.push(card);
 if(!p.seen.some(c=>c.id===card.id)){p.seen.push(card);p.stats.discoveries++;p.notebook=p.notebook||{};p.notebook[card.id]="known";p.confirmedCards=p.confirmedCards||[];if(!p.confirmedCards.includes(card.id))p.confirmedCards.push(card.id);}
 return card;
}
function roomAt(pos){return ROOMS.find(r=>pos.x>=r.x&&pos.x<r.x+r.w&&pos.y>=r.y&&pos.y<r.y+r.h);}
function isWalkable(x,y){
 if(x<0||y<0||x>=25||y>=25)return false;
 if(ROOMS.some(r=>x>=r.x&&x<r.x+r.w&&y>=r.y&&y<r.y+r.h))return true;
 return (x>=9&&x<=15)||(y>=7&&y<=17)||(x>=7&&x<=17&&y>=5&&y<=19);
}
function occupied(room,x,y,except){return room.players.some(p=>p.id!==except&&p.pos.x===x&&p.pos.y===y);}
function connected(room,x,y,p){return Math.abs(x-p.pos.x)+Math.abs(y-p.pos.y)===1&&isWalkable(x,y)&&!occupied(room,x,y,p.id);}
function roomEntry(room,p){
 const r=roomAt(p.pos);if(!r)return;
 if(p.explored.includes(r.name)){addLog(room,`${p.name} se vratio/la u ${r.name}.`);return;}
 p.explored.push(r.name);p.stats.rooms++;const card=drawCard(room,p);
 addLog(room,`${p.name} je ušao/la u ${r.name}. Dokaz je pronađen.`);
 if(card){const s=p.socketId&&io.sockets.sockets.get(p.socketId);if(s)s.emit("discovery",{card,room:r.name,bonus:false});}
 if(p.explored.length===8){const bonus=drawCard(room,p);p.explored=[];addLog(room,`${p.name} je istražio/la svih osam prostorija i osvojio/la bonus kartu. Novi krug istraživanja je otključan.`);const s=p.socketId&&io.sockets.sockets.get(p.socketId);if(s&&bonus)s.emit("discovery",{card:bonus,room:"BONUS — svih 8 prostorija",bonus:true});}
}
function endTurn(room){
 room.pendingQuestion=null;room.completedTurns++;
 if(room.completedTurns>=MAX_TURNS){room.status="ended";room.winner={type:"deadline",name:"Vrijeme"};addLog(room,"Isteklo je 80 ljudskih poteza. Vrijeme je isteklo — svi gube.");return;}
 room.turnIndex=(room.turnIndex+1)%room.players.length;beginTurn(room);
}
function reveal(room){io.to(room.code).emit("reveal",{solution:room.solution,winner:room.winner,players:room.players.map(x=>({name:x.name,stats:x.stats,failed:x.failedAccusation}))});}
io.on("connection",socket=>{
 socket.on("createRoom",payload=>{
  if(roomFor(socket))return fail(socket,"Već si u sobi.");
  const code=crypto.randomBytes(3).toString("hex").toUpperCase(),p={id:uid(),socketId:socket.id,name:cleanName(payload?.name),pos:{x:12,y:12},energy:0,hand:[],seen:[],explored:[],token:TOKENS[0],canAccuse:true,failedAccusation:false,stats:{rooms:0,discoveries:0,questions:0,turns:0},notebook:{},confirmedCards:[]};
  const r={code,hostId:p.id,players:[p],status:"lobby",log:[],turnIndex:0,completedTurns:0,pendingQuestion:null};rooms.set(code,r);socket.join(code);socket.emit("joined",{code,playerId:p.id});emitRoom(r);
 });
 socket.on("joinRoom",payload=>{
  const code=String(payload?.code||"").trim().toUpperCase(),r=rooms.get(code);if(!r)return fail(socket,"Soba ne postoji.");
  const reconnect=r.players.find(p=>payload?.playerId&&p.id===payload.playerId);
  if(reconnect){
   if(reconnect.socketId){const old=io.sockets.sockets.get(reconnect.socketId);if(old&&old.id!==socket.id)old.disconnect(true);}
   reconnect.socketId=socket.id;reconnect.disconnected=false;socket.join(r.code);
   socket.emit("joined",{code:r.code,playerId:reconnect.id,reconnected:true});addLog(r,`${reconnect.name} se ponovo povezao/la.`);emitRoom(r);return;
  }
  if(r.status!=="lobby")return fail(socket,"Igra je već počela. Za povratak koristi isti uređaj i kod sobe.");
  if(r.players.length>=MAX_PLAYERS)return fail(socket,"Soba je puna (maksimalno 8 igrača).");
  const clean=cleanName(payload?.name);if(r.players.some(p=>p.name.toLowerCase()===clean.toLowerCase()))return fail(socket,"To ime je već zauzeto.");
  const p={id:uid(),socketId:socket.id,name:clean,pos:{x:12,y:12},energy:0,hand:[],seen:[],explored:[],token:TOKENS[r.players.length%TOKENS.length],canAccuse:true,failedAccusation:false,stats:{rooms:0,discoveries:0,questions:0,turns:0},notebook:{},confirmedCards:[]};
  r.players.push(p);socket.join(r.code);socket.emit("joined",{code:r.code,playerId:p.id});addLog(r,`${clean} se pridružio/la istrazi.`);emitRoom(r);
 });
 socket.on("startGame",()=>{
  const r=roomFor(socket);if(!r)return;const p=playerBySocket(r,socket.id);if(p.id!==r.hostId)return fail(socket,"Samo domaćin može pokrenuti igru.");
  if(r.status!=="lobby")return fail(socket,"Igra je već pokrenuta.");if(r.players.length<2)return fail(socket,"Potrebna su najmanje dva igrača.");if(r.players.some(player=>!player.socketId))return fail(socket,"Svi igrači moraju biti povezani prije početka igre.");
  newGame(r);emitRoom(r);
 });
 socket.on("move",payload=>{
  const r=roomFor(socket);if(!r)return;const p=playerBySocket(r,socket.id);
  const x=Number(payload?.x),y=Number(payload?.y);if(!current(r,p))return fail(socket,"Nije tvoj potez.");
  if(p.energy<1)return fail(socket,"Nemaš dovoljno energije.");if(!Number.isInteger(x)||!Number.isInteger(y)||!connected(r,x,y,p))return fail(socket,"To polje nije dostupno.");
  p.pos={x,y};p.energy--;roomEntry(r,p);emitRoom(r);
 });
 socket.on("tunnel",()=>{
  const r=roomFor(socket);if(!r)return;const p=playerBySocket(r,socket.id);if(!current(r,p))return fail(socket,"Nije tvoj potez.");
  if(p.energy<TUNNEL_COST)return fail(socket,"Tunel košta 4 energije.");
  const i=TUNNELS.findIndex(e=>e.x===p.pos.x&&e.y===p.pos.y);if(i<0)return fail(socket,"Moraš stajati na jednom od dva ulaza u tunel.");
  const dest=TUNNELS[1-i];if(occupied(r,dest.x,dest.y,p.id))return fail(socket,"Izlaz tunela je zauzet.");
  p.pos={x:dest.x,y:dest.y};p.energy-=TUNNEL_COST;addLog(r,`${p.name} je koristio/la tajni tunel.`);roomEntry(r,p);emitRoom(r);
 });
 socket.on("askQuestion",payload=>{
  const r=roomFor(socket);if(!r)return;const p=playerBySocket(r,socket.id),target=r.players.find(x=>x.id===payload?.targetId),card=cardById(payload?.cardId);
  if(!current(r,p))return fail(socket,"Nije tvoj potez.");if(p.energy<QUESTION_COST)return fail(socket,"Pitanje košta 6 energije.");
  if(p.questionUsed||r.pendingQuestion)return fail(socket,"Već si postavio/la pitanje u ovom potezu.");
  if(!target||target.id===p.id||!target.socketId||!card)return fail(socket,"Neispravan izbor ili igrač nije povezan.");
  if((p.confirmedCards||[]).includes(card.id))return fail(socket,"Ovu kartu već imaš potvrđenu u bilježnici.");
  const id=uid();r.pendingQuestion={id,askerId:p.id,targetId:target.id,card:{id:card.id,type:card.type,name:card.name},createdAt:Date.now()};
  p.energy-=QUESTION_COST;p.questionUsed=true;p.stats.questions++;addLog(r,`${p.name} je zatražio/la odgovor od igrača ${target.name}.`);
  const ts=io.sockets.sockets.get(target.socketId);if(ts)ts.emit("questionRequest",{id,asker:p.name,card:r.pendingQuestion.card});
  emitRoom(r);
 });
 socket.on("answerQuestion",payload=>{
  const r=roomFor(socket);if(!r)return;const p=playerBySocket(r,socket.id),q=r.pendingQuestion;
  if(!q||q.id!==payload?.id||q.targetId!==p.id)return fail(socket,"Ovo pitanje više nije aktivno.");
  const asker=r.players.find(x=>x.id===q.askerId);if(!asker||!current(r,asker))return fail(socket,"Pitanje više nije važeće.");
  const has=p.hand.some(c=>c.id===q.card.id),answer=payload?.has===true;
  if(answer!==has){fail(socket,has?"Moraš potvrditi da posjeduješ ovu kartu.":"Ne možeš potvrditi kartu koju trenutno ne posjeduješ.");const ts=io.sockets.sockets.get(p.socketId);if(ts)ts.emit("questionRequest",{id:q.id,asker:asker.name,card:q.card});return;}
  if(answer){asker.notebook[q.card.id]="known";asker.confirmedCards=asker.confirmedCards||[];if(!asker.confirmedCards.includes(q.card.id))asker.confirmedCards.push(q.card.id);}
  const response={target:p.name,card:q.card.name,has:answer};
  r.pendingQuestion=null;addLog(r,`${p.name} je odgovorio/la ${answer?"DA":"NE"} na pitanje igrača ${asker.name}.`);
  const as=asker.socketId&&io.sockets.sockets.get(asker.socketId);if(as)as.emit("answer",response);
  emitRoom(r);
 });
 socket.on("accuse",payload=>{
  const r=roomFor(socket);if(!r)return;const p=playerBySocket(r,socket.id);if(!current(r,p))return fail(socket,"Nije tvoj potez.");
  if(!p.canAccuse)return fail(socket,"Već si iskoristio/la svoju optužbu.");
  const guess={place:payload?.place,suspect:payload?.suspect,weapon:payload?.weapon,time:payload?.time};
  if(!Object.entries(guess).every(([t,v])=>CARDS[t]?.includes(v)))return fail(socket,"Izbor sadrži neispravnu kartu.");
  const correct=Object.keys(guess).every(t=>r.solution[t].name===guess[t]);p.canAccuse=false;
  if(correct){r.status="ended";r.winner={type:"human",id:p.id,name:p.name};addLog(r,`${p.name} je riješio/la slučaj!`);}
  else{p.failedAccusation=true;addLog(r,`${p.name} je iznio/la pogrešnu završnu optužbu.`);}
  emitRoom(r);if(r.status==="ended")reveal(r);
 });
 socket.on("endTurn",()=>{
  const r=roomFor(socket);if(!r)return;const p=playerBySocket(r,socket.id);if(!current(r,p))return;
  if(r.pendingQuestion)return fail(socket,"Sačekaj da ispitani igrač odgovori prije završetka poteza.");
  addLog(r,`${p.name} je završio/la potez.`);endTurn(r);emitRoom(r);if(r.status==="ended")reveal(r);
 });
 socket.on("saveNotebook",data=>{
  const r=roomFor(socket);if(!r)return;const p=playerBySocket(r,socket.id);if(!p||!data||typeof data!=="object"||Array.isArray(data))return fail(socket,"Neispravni podaci bilježnice.");
  const clean={};for(const [id,status] of Object.entries(data)){if(cardById(id)&&["unknown","suspected","known"].includes(status))clean[id]=status;}
  // Server-confirmed knowledge cannot be downgraded by a client save.
  for(const id of (p.confirmedCards||[]))clean[id]="known";
  p.notebook=clean;socket.emit("private",privateState(r,p));
 });
 socket.on("disconnect",()=>{
  const r=roomFor(socket);if(!r)return;const p=playerBySocket(r,socket.id);if(!p)return;p.socketId=null;p.disconnected=true;
  addLog(r,`${p.name} je izgubio/la vezu. Može se vratiti istim kodom i uređajem.`);
  if(p.id===r.hostId){const next=r.players.find(x=>x.id!==p.id&&x.socketId);if(next)r.hostId=next.id;}
  if(r.pendingQuestion&&(r.pendingQuestion.targetId===p.id||r.pendingQuestion.askerId===p.id)){r.pendingQuestion=null;addLog(r,"Ispitivanje je otkazano jer se jedan od igrača prekinuo/la vezu.");}
  emitRoom(r);
 });
});
server.listen(PORT,()=>console.log(`Mystery Mansion running on ${PORT}`));
