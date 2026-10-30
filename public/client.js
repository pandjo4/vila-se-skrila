const socket=io();
const $=id=>document.getElementById(id);
let me=null,roomState=null,privateData={hand:[],seen:[],explored:[],energy:0},zoom=1,legal=[];
const TYPES={place:"Mjesta",suspect:"Osumnjičeni",weapon:"Oružja",time:"Vrijeme"};
const CARD_LIST={place:["Biblioteka","Plesna sala","Kuhinja","Spavaća soba","Radna soba","Kupatilo","Staklenik","Dnevni boravak"],suspect:["Vrtlar","Kuhar","Domaćica / Služavka","Batler","Vlasnik vile","Nasljednica","Advokat","Doktor"],weapon:["Revolver","Nož","Svijećnjak","Čekić","Sjekira","Štap za hodanje","Satara","Lanac","Žarač","Otvarač pisama"],time:["17:00–19:00 · Rano veče","19:00–21:00 · Sumrak","21:00–23:00 · Kasno veče","23:00–01:00 · Ponoć","01:00–03:00 · Duboka noć","03:00–05:00 · Pred zoru"]};
function toast(t){$("toast").textContent=t;$("toast").classList.add("show");setTimeout(()=>$("toast").classList.remove("show"),2600)}
function showError(t){$("lobbyMessage").textContent=t;toast(t)}
socket.on("connect",()=>$("connection").textContent="● Povezano");
socket.on("disconnect",()=>$("connection").textContent="● Prekinuta veza");
socket.on("errorMsg",showError);
socket.on("joined",d=>{me=d.playerId;$("lobbyScreen").classList.remove("hidden");$("roomPanel").classList.remove("hidden");$("codeLabel").textContent=d.code;$("lobbyMessage").textContent="";});
socket.on("state",s=>{roomState=s;renderState();});
socket.on("private",p=>{privateData=p;renderPrivate();});
socket.on("discovery",d=>showDiscovery(d));
socket.on("answer",d=>openModal(`<div class="eyebrow">PRIVATNI ODGOVOR</div><h2>${d.target}</h2><p>Posjeduje li kartu <b>${d.card}</b>?</p><h2 style="color:${d.has?'#8eae83':'#c47b7b'}">${d.has?'✓ DA':'✕ NE'}</h2><p class="hint">Odgovor je poznat samo tebi. Zabilježi ga u notes.</p>`));
socket.on("reveal",d=>showEnd(d));
$("createBtn").onclick=()=>socket.emit("createRoom",{name:$("playerName").value});
$("joinBtn").onclick=()=>socket.emit("joinRoom",{name:$("playerName").value,code:$("roomCode").value.trim()});
$("copyCode").onclick=()=>{navigator.clipboard?.writeText($("codeLabel").textContent);toast("Kod sobe kopiran.");};
$("startBtn").onclick=()=>socket.emit("startGame");
$("endTurnBtn").onclick=()=>socket.emit("endTurn");
$("questionBtn").onclick=questionModal;
$("tunnelBtn").onclick=()=>{if(confirm("Koristiti tunel za 4 energije?"))socket.emit("tunnel");};
$("accuseBtn").onclick=accuseModal;
$("zoomIn").onclick=()=>setZoom(Math.min(1.7,zoom+.15));$("zoomOut").onclick=()=>setZoom(Math.max(.55,zoom-.15));$("resetZoom").onclick=()=>setZoom(1);
function setZoom(z){zoom=z;$("board").style.transform=`scale(${zoom})`;$("board").style.marginBottom=`${625*(zoom-1)}px`;$("board").style.marginRight=`${625*(zoom-1)}px`;}
function renderState(){if(!roomState)return;
 if(roomState.status==="playing"||roomState.status==="ended"){$("lobbyScreen").classList.add("hidden");$("gameScreen").classList.remove("hidden");}
 $("playerCount").textContent=`${roomState.players.length}/8`;
 $("lobbyPlayers").innerHTML=roomState.players.map(p=>playerHTML(p)).join("");
 $("gamePlayers").innerHTML=roomState.players.map(p=>playerHTML(p)).join("");
 const active=roomState.players[roomState.turnIndex];const mine=roomState.players.find(p=>p.id===me);
 $("turnLabel").textContent=active?(active.id===me?"TVOJ POTEZ — istraži vilu":`Na potezu: ${active.name}`):"Čeka se potez";
 $("energyLabel").textContent=`ENERGIJA ${mine?.energy??0}/8`;$("energyOrb").textContent=mine?.energy??0;
 $("turnCount").textContent=`${roomState.completedTurns} / 80`;$("turnMeter").style.width=`${roomState.completedTurns/80*100}%`;
 $("endTurnBtn").disabled=active?.id!==me;$("questionBtn").disabled=active?.id!==me||mine?.energy<6;$("tunnelBtn").disabled=active?.id!==me||mine?.energy<4;$("accuseBtn").disabled=active?.id!==me||!mine?.canAccuse;
 $("activityLog").innerHTML=roomState.log.slice().reverse().map(e=>`<div>${escapeHTML(e.msg)}</div>`).join("");
 renderBoard();
 if(roomState.status==="lobby"){$("startBtn").style.display=roomState.hostId===me?"block":"none";}
}
function playerHTML(p){return `<div class="player-item"><i class="dot" style="background:${p.token}"></i><span>${escapeHTML(p.name)}</span>${p.active?'<b class="you">NA POTEZU</b>':''}${p.id===me?'<b class="you">TI</b>':''}</div>`;}
function renderBoard(){
 const board=$("board");board.innerHTML="";
 legal=[];
 const mine=roomState.players.find(p=>p.id===me), active=roomState.players[roomState.turnIndex];
 if(mine && active?.id===me && mine.energy>0){
  [[1,0],[-1,0],[0,1],[0,-1]].forEach(([dx,dy])=>{
   const x=mine.pos.x+dx,y=mine.pos.y+dy;
   const room=roomState.rooms.some(r=>x>=r.x&&x<r.x+r.w&&y>=r.y&&y<r.y+r.h);
   const walk=room||(x>=9&&x<=15)||(y>=7&&y<=17)||(x>=7&&x<=17&&y>=5&&y<=19);
   const busy=roomState.players.some(p=>p.id!==me&&p.pos.x===x&&p.pos.y===y);
   if(walk&&!busy)legal.push({x,y});
  });
 }
 const rooms=roomState.rooms;const roomCells=new Map();
 rooms.forEach(r=>{for(let y=r.y;y<r.y+r.h;y++)for(let x=r.x;x<r.x+r.w;x++)roomCells.set(`${x},${y}`,r);});
 const players=roomState.players;
 for(let y=0;y<25;y++)for(let x=0;x<25;x++){
  const c=document.createElement("div");c.className="cell";c.dataset.x=x;c.dataset.y=y;
  const r=roomCells.get(`${x},${y}`);
  const walk=(x>=9&&x<=15)||(y>=7&&y<=17)||(x>=7&&x<=17&&y>=5&&y<=19)||!!r;
  if(!walk)c.classList.add("wall");else if(r){c.classList.add("room");c.style.setProperty("--room",r.color+"88");if(x===r.x+Math.floor(r.w/2)&&y===r.y+Math.floor(r.h/2)){c.title=r.name;c.innerHTML=`<span class="room-label">${r.icon} ${r.name}</span>`;}}
  else c.classList.add("corridor");
  if([[8,8],[16,16],[8,16],[16,8]].some(([a,b])=>a===x&&b===y))c.classList.add("tunnel");
  const p=players.find(p=>p.pos.x===x&&p.pos.y===y);if(p){const t=document.createElement("i");t.className="token";t.style.background=p.token;t.textContent=p.name.slice(0,1).toUpperCase();c.append(t);}
  if(legal.some(q=>q.x===x&&q.y===y))c.classList.add("legal");
  c.onclick=()=>{if(legal.some(q=>q.x===x&&q.y===y))socket.emit("move",{x,y});};board.append(c);
 }
}
function renderPrivate(){if(!privateData)return;
 $("myCards").innerHTML=(privateData.hand||[]).map(c=>`<div class="evidence-card"><small>${TYPES[c.type]}</small><b>${escapeHTML(c.name)}</b></div>`).join("")||'<p class="hint">Još nemaš karata. Istraži prostorije da pronađeš dokaze.</p>';
 const categories=Object.entries(CARD_LIST).map(([type,names])=>`<div class="note-category"><h4>${TYPES[type]}</h4>${names.map(n=>`<label class="note-row"><input type="checkbox" data-card="${type}:${n}"> ${escapeHTML(n)}</label>`).join("")}</div>`).join("");
 $("notebook").innerHTML=categories;
 $("notebook").querySelectorAll("input").forEach(i=>{i.checked=!!privateData.notebook?.[i.dataset.card];i.onchange=()=>{privateData.notebook[i.dataset.card]=i.checked;socket.emit("saveNotebook",privateData.notebook);};});
}
function showDiscovery(d){openModal(`<div class="eyebrow">${d.bonus?'COMPLETNA EKSPEDICIJA':'NOVI DOKAZ OTKRIVEN'}</div><h2>${d.bonus?'Bonus karta':'Pronašao/la si dokaz'}</h2><p class="hint">${d.room}</p><div class="evidence-card"><small>${TYPES[d.card.type]}</small><b>${escapeHTML(d.card.name)}</b></div><p class="hint">Ova karta sigurno nije dio tajnog rješenja. Informacija je privatna.</p><button class="primary" onclick="closeModal()">ZABILJEŽI DOKAZ</button>`);}
function openModal(html){$("modalContent").innerHTML=html;$("modal").classList.remove("hidden");}
function closeModal(){$("modal").classList.add("hidden");}
$("modalClose").onclick=closeModal;$("modal").onclick=e=>{if(e.target===$("modal"))closeModal();};
function questionModal(){const players=roomState.players.filter(p=>p.id!==me);openModal(`<div class="eyebrow">DIRECT INTERROGATION · 6 ENERGY</div><h2>Postavi pitanje</h2><label>ISPITAJ IGRAČA</label><select id="qTarget">${players.map(p=>`<option value="${p.id}">${escapeHTML(p.name)}</option>`).join("")}</select><label>KOJU KARTU POSJEDUJE?</label><select id="qCard">${Object.entries(CARD_LIST).map(([t,ns])=>`<optgroup label="${TYPES[t]}">${ns.map(n=>`<option value="${t}:${n}">${escapeHTML(n)}</option>`).join("")}</optgroup>`).join("")}</select><button class="primary" id="sendQuestion">POŠALJI PITANJE</button>`);$("sendQuestion").onclick=()=>{socket.emit("askQuestion",{targetId:$("qTarget").value,cardId:$("qCard").value});closeModal();};}
function accuseModal(){openModal(`<div class="eyebrow">FINAL ACCUSATION</div><h2>Ko je ubica?</h2><p class="hint">Imaš samo jednu završnu optužbu. Ako pogriješiš, više ne možeš pobijediti optužbom.</p>${Object.entries(CARD_LIST).map(([t,ns])=>`<label>${TYPES[t].toUpperCase()}</label><select id="a_${t}">${ns.map(n=>`<option>${escapeHTML(n)}</option>`).join("")}</select>`).join("")}<button class="primary" id="sendAccuse">POTVRDI OPTUŽBU</button>`);$("sendAccuse").onclick=()=>{if(confirm("Jesi li siguran/na? Ovu optužbu možeš iskoristiti samo jednom.")){socket.emit("accuse",{place:$("a_place").value,suspect:$("a_suspect").value,weapon:$("a_weapon").value,time:$("a_time").value});closeModal();}};}
function showEnd(d){const s=d.solution;openModal(`<div class="eyebrow">THE CASE IS CLOSED</div><h2>${d.winner.type==="human"?"Slučaj je riješen!":"Vrijeme je isteklo."}</h2><p>${escapeHTML(d.winner.name)} ${d.winner.type==="human"?"je otkrio/la istinu.":"je pobijedio kao vremensko ograničenje."}</p><div class="card-grid">${Object.entries(s).map(([t,c])=>`<div class="evidence-card"><small>${TYPES[t]}</small><b>${escapeHTML(c.name)}</b></div>`).join("")}</div><h3>Detektivski izvještaj</h3>${d.players.map(p=>`<p>${escapeHTML(p.name)} — ${p.stats.rooms}/8 prostorija, ${p.stats.discoveries} različitih otkrića, ${p.stats.questions} pitanja ${p.failed?" · pogrešna optužba":""}</p>`).join("")}<button class="primary" onclick="location.reload()">ZATVORI I VRATI SE U LOBI</button>`);}
function escapeHTML(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
document.querySelectorAll(".mobile-tabs button").forEach(b=>b.onclick=()=>{document.querySelectorAll(".mobile-tabs button").forEach(x=>x.classList.remove("active"));b.classList.add("active");document.getElementById(b.dataset.tab)?.scrollIntoView({behavior:"smooth",block:"start"});});
let notesTimer;
const savedNotes=localStorage.getItem("mansion-personal-notes")||"";
$("personalNotes").value=savedNotes;
$("personalNotes").addEventListener("input",()=>{clearTimeout(notesTimer);notesTimer=setTimeout(()=>$("personalNotes").value&&localStorage.setItem("mansion-personal-notes",$("personalNotes").value),250);});
