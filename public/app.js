const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const SUITS = {S:{symbol:'♠',label:'Spades'},H:{symbol:'♥',label:'Hearts'},D:{symbol:'♦',label:'Diamonds'},C:{symbol:'♣',label:'Clubs'}};
let state = null;
let identity = null;
let stream = null;
let busy = false;
let sound = localStorage.getItem('omi-sound') !== 'off';
let previousTurn = null;
let reactionId = null;
let toastTimer;
let actx = null;
const safe = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const suitSymbol = s => SUITS[s]?.symbol || '—';
const teamLabel = t => t === 0 ? 'Gold' : 'Teal';
const teamOf = s => s % 2;
const display = (selector, visible) => {$(selector).hidden = !visible;};
const names = seat => state?.players?.[seat]?.name || `Seat ${seat + 1}`;
function showToast(message){const t=$('#toast');t.textContent=message;t.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('visible'),3100);}
function playSound(type='tap'){
  if(!sound) return;
  try{
    actx ||= new (window.AudioContext || window.webkitAudioContext)();
    const oscillator=actx.createOscillator(), gain=actx.createGain();
    oscillator.connect(gain);gain.connect(actx.destination);
    const now=actx.currentTime;
    oscillator.type=type==='win'?'sine':'triangle';
    oscillator.frequency.setValueAtTime(type==='win'?530:440,now);
    oscillator.frequency.exponentialRampToValueAtTime(type==='win'?780:300,now+.12);
    gain.gain.setValueAtTime(.045,now);gain.gain.exponentialRampToValueAtTime(.001,now+.16);
    oscillator.start(now);oscillator.stop(now+.17);
  }catch{}
}
function cardHtml(card, {small=false, clickable=false, legal=true, index=0}={}) {
  if(!card || !SUITS[card[0]]) return '';
  const suit=card[0],r=card.slice(1),symbol=suitSymbol(suit),red=suit==='H'||suit==='D';
  const isFace=['J','Q','K'].includes(r);
  let body;
  if(isFace) body=`<span class="court-letter">${r}</span><span class="court-deco">${symbol} ✦ ${symbol}</span>`;
  else if(r==='A') body=`<span class="pip-large">${symbol}</span>`;
  else {
    // Two-column pip matrix for numerals, deliberately crisp at mobile sizes.
    const number=Number(r),columns=2,positions=[];
    if(number===7) positions.push([0,0],[0,1],[1,0],[1,1],[2,0],[2,1],[4,0]);
    else if(number===8) positions.push([0,0],[0,1],[1,0],[1,1],[3,0],[3,1],[4,0],[4,1]);
    else if(number===9) positions.push([0,0],[0,1],[1,0],[1,1],[2,0],[3,0],[3,1],[4,0],[4,1]);
    else positions.push([0,0],[0,1],[1,0],[1,1],[2,0],[2,1],[3,0],[3,1],[4,0],[4,1]);
    body=`<div class="pip-grid">${positions.map(([y,x])=>`<i style="grid-row:${y+1};grid-column:${x+1}">${symbol}</i>`).join('')}</div>`;
  }
  const cls=`playing-card ${red?'red':''} ${small?'card-static':''} ${clickable?(legal?'card-clickable':'card-unplayable'):''}`;
  const attrs=clickable ? `type="button" data-card="${safe(card)}" ${legal?'':'disabled'} aria-label="Play ${safe(r)} of ${safe(SUITS[suit].label)}" style="animation-delay:${index*30}ms"` : `aria-label="${safe(r)} of ${safe(SUITS[suit].label)}"`;
  return `<${clickable?'button':'div'} class="${cls}" ${attrs}><span class="corner">${safe(r)}<i>${symbol}</i></span><span class="card-center">${body}</span><span class="corner reverse">${safe(r)}<i>${symbol}</i></span></${clickable?'button':'div'}>`;
}
function showScreen(which){for(const id of ['home','lobby','game']) display(`#${id}-screen`,id===which);}
function inviteUrl(){return `${location.origin}${location.pathname}?room=${encodeURIComponent(identity.code)}`;}
async function copyInvite(){
  const value=inviteUrl();
  try {await navigator.clipboard.writeText(value);showToast('Invite link copied! Send it to your friends.');}
  catch {showToast(`Room code: ${identity.code} (share this code)`);}
}
async function request(url, options={}){
  let response;
  try{response=await fetch(url,{...options,headers:{'Content-Type':'application/json',...(identity?{'X-Omi-Token':identity.token}:{}),...(options.headers||{})}});}
  catch{throw new Error('Cannot reach the game server. Check your internet connection.');}
  const data=await response.json();
  if(!response.ok)throw new Error(data.error || 'Something went wrong');
  return data;
}
function getPlayerName(){const name=$('#player-name').value.trim();if(name.length<2){showToast('Enter a name (at least 2 characters).');$('#player-name').focus();return null;} localStorage.setItem('omi-name',name);return name;}
function keepIdentity(id){identity=id;localStorage.setItem(`omi-room-${id.code}`,id.token);history.replaceState({},'',`${location.pathname}?room=${id.code}`);}
async function create(automatic=false){
  const name=getPlayerName();if(!name||busy)return;
  busy=true;
  try{
    const data=await request('/api/rooms',{method:'POST',body:JSON.stringify({name})});
    keepIdentity({code:data.code,token:data.token});
    render(data.state);connect();
    if(automatic){busy=false;await action('start');}
  }catch(e){showToast(e.message);}finally{busy=false;}
}
async function join(){
  const name=getPlayerName();if(!name||busy)return;
  const code=$('#join-code').value.replace(/\s/g,'').toUpperCase();
  if(!/^[A-HJ-NP-Z2-9]{6}$/.test(code)){showToast('Please enter a valid six-character room code.');return;}
  busy=true;
  try{
    const data=await request(`/api/rooms/${code}/join`,{method:'POST',body:JSON.stringify({name})});
    keepIdentity({code:data.code,token:data.token});render(data.state);connect();showToast('Welcome to the table!');
  }catch(e){showToast(e.message);}finally{busy=false;}
}
async function resume(code){
  const token=localStorage.getItem(`omi-room-${code}`);
  if(!token)return false;
  identity={code,token};
  try{
    const data=await request(`/api/rooms/${code}/state?token=${encodeURIComponent(token)}`);
    render(data);connect();return true;
  }catch{identity=null;localStorage.removeItem(`omi-room-${code}`);return false;}
}
function connect(){
  if(stream)stream.close();
  stream=new EventSource(`/api/rooms/${identity.code}/events?token=${encodeURIComponent(identity.token)}`);
  stream.addEventListener('state',event=>{try{render(JSON.parse(event.data));}catch(e){console.error('Bad game state',e);}});
  stream.onerror=()=>{if(state?.phase!=='lobby')$('#turn-status').textContent='Reconnecting to the table…';};
}
async function action(type,fields={}){
  if(!identity||busy)return;
  busy=true;
  try{
    const data=await request(`/api/rooms/${identity.code}/action`,{method:'POST',body:JSON.stringify({type,...fields})});
    if(type==='play')playSound();
    return data;
  }catch(e){showToast(e.message);}finally{busy=false;}
}
function render(newState){
  if(!newState)return;
  const old=state;state=newState;
  if(state.reaction && state.reaction.id!==reactionId){reactionId=state.reaction.id;showToast(`${state.reaction.name}: ${state.reaction.emoji}`);}
  if(old?.phase !== 'finished' && state.phase === 'finished')playSound('win');
  else if(state.turn===state.seat && previousTurn!==state.seat && state.phase==='playing')playSound('tap');
  previousTurn=state.turn;
  if(state.phase==='lobby'){renderLobby();showScreen('lobby');}
  else {showScreen('game');renderGame();}
  display('#trump-overlay',state.phase==='trump' && state.caller===state.seat);
  if(state.phase==='trump' && state.caller===state.seat)$('#trump-preview').innerHTML=state.hand.map(c=>cardHtml(c,{small:true})).join('');
  display('#result-overlay',state.phase==='roundEnd'||state.phase==='finished');
  if(state.phase==='roundEnd'||state.phase==='finished')renderResult();
}
function renderLobby(){
  $('#lobby-code').textContent=state.code;
  $('#lobby-grid').innerHTML=state.players.map((p,i)=>`<div class="lobby-seat ${i%2?'teal':'gold'} ${p?'':'empty'}"><div class="lobby-avatar">${p?'♠':'+'}</div><div><strong>SEAT ${i+1} — ${p?safe(p.name):'Waiting for player'}</strong><small>${i%2?'Teal':'Gold'} team ${i===0?'• HOST':p?'• READY':'• BOT IF EMPTY'}</small></div></div>`).join('');
  display('#start-btn',state.host);display('#waiting-host',!state.host);
  $('#start-btn').textContent=state.players.filter(Boolean).length===4?'Start the match →':'Start game with bots →';
}
function seatRelative(seat){return (seat-state.seat+4)%4;}
function seatTag(rel){
  const seat=(state.seat+rel)%4,p=state.players[seat];
  if(!p)return '';
  const active=state.turn===seat || (state.phase==='trump'&&state.caller===seat);
  const isMe=rel===0;
  const sub = [state.dealer===seat?'Dealer':'',state.caller===seat?'Trump caller':'',isMe?'You':p.isBot?'Computer':'Player'].filter(Boolean).join(' · ');
  const backs=rel===0?'':`<div class="player-backs">${Array.from({length:Math.min(5,state.counts[seat])},()=>'<span class="mini-back"></span>').join('')}</div>`;
  return `${rel===2?backs:''}<div class="player-tag ${active?'active':''} ${isMe?'mine':''}"><div class="player-title">${safe(p.name)}${isMe?' (YOU)':''}</div><div class="player-info">${safe(sub)} · ${state.counts[seat]} cards</div></div>${rel!==2?backs:''}`;
}
function renderGame(){
  $('#header-code').textContent=state.code;
  $('#score-gold').textContent=state.score[0];$('#score-teal').textContent=state.score[1];
  $('#hand-num').textContent=state.round;
  const complete=state.tricks[0]+state.tricks[1];
  $('#trick-num').textContent=`TRICK ${Math.min(8,complete+1)} OF 8`;
  $('#turn-status').textContent=state.phase==='trump'?`${names(state.caller)} is choosing trumps…`:
    state.phase==='resolving'?'Determining the trick winner…':
    state.phase==='roundEnd'?'Hand complete. Tokens awarded!':
    state.phase==='finished'?'Match complete! Congratulations.':
    state.turn===state.seat?'YOUR TURN — PLAY A CARD':`${names(state.turn)} is playing…`;
  $('#trump-chip').innerHTML=`TRUMP <b>${suitSymbol(state.trump)}</b>`;
  $('#trick-score-chip').textContent=`TRICKS ${state.tricks[0]}–${state.tricks[1]}`;
  $('#side-trump').textContent=state.trump?`${SUITS[state.trump].symbol} ${SUITS[state.trump].label}`:'Not chosen';
  $('#side-dealer').textContent=names(state.dealer);
  $('#side-bonus').textContent=`+${state.bonus}`;
  $('#bonus-notice').textContent=state.bonus?`✦ +${state.bonus} BONUS TOKEN${state.bonus===1?'':'S'} ON NEXT WIN`:'WIN THE HAND. CLAIM THE TOKENS.';
  $('#hand-label').innerHTML=`YOUR HAND <b>• ${state.hand.length} CARDS</b>`;
  $('#hand-hint').textContent=state.phase==='playing' && state.turn===state.seat?'Glowing cards are playable':state.phase==='trump'&&state.caller===state.seat?'Choose trumps to begin':'Waiting for your turn';
  $('#seat-top').innerHTML=seatTag(2);$('#seat-right').innerHTML=seatTag(1);$('#seat-left').innerHTML=seatTag(3);$('#seat-bottom').innerHTML=seatTag(0);
  $('#played-cards').innerHTML=state.table.length?state.table.map(({seat,card})=>{
    const rel=seatRelative(seat),pos=['bottom','right','top','left'][rel];
    return `<div class="play-position play-pos-${pos}">${cardHtml(card,{small:true})}</div>`;
  }).join(''):'<span class="table-watermark">♠</span>';
  $('#last-trick-notice').textContent=state.lastTrick && state.phase==='playing' ? `Last trick: ${names(state.lastTrick.winner)} won` : '';
  const myTurn=state.phase==='playing'&&state.turn===state.seat;
  $('#my-hand').innerHTML=state.hand.map((card,i)=>cardHtml(card,{clickable:true,legal:myTurn&&state.legal.includes(card),index:i})).join('');
  $('#team-details').innerHTML=[0,1].map(team=>{
    const players=state.players.filter(p=>p?.team===team).map(p=>safe(p.name)).join(' & ');
    return `<div class="side-team ${team===1?'teal':''}"><div><span class="side-tname">${team===0?'✦ GOLD':'✧ TEAL'}</span><span class="side-players">${players}</span></div><strong>${state.tricks[team]}</strong></div>`;
  }).join('');
  $('#activity-log').innerHTML=state.history.map(line=>`<div class="log-item">${safe(line.replace(/\b([SHDC])(A|K|Q|J|10|9|8|7)\b/g,(_,s,r)=>r+suitSymbol(s)))}</div>`).join('');
}
function renderResult(){
  const isFinish=state.phase==='finished';
  const a=state.lastAward;
  const winner=a?.team;
  $('#result-eyebrow').textContent=isFinish?'THE MATCH IS OVER':'HAND COMPLETE';
  $('#result-title').textContent=isFinish?`${teamLabel(state.winner)} Team Wins!`:a?.label==='Four–four draw'?'A perfect tie!':a?.base===3?'KAPOTHI!':`${teamLabel(winner)} takes the hand!`;
  $('#result-subtitle').textContent=isFinish?'First to 10 tokens. What a match!':'A fresh hand is just around the corner.';
  $('#result-gold').textContent=state.tricks[0];$('#result-teal').textContent=state.tricks[1];
  $('#result-award').textContent=winner===null?`4–4 draw. Bonus now +${state.bonus} for the next winning hand.`:
    `${teamLabel(winner)} earns +${a.tokens} token${a.tokens===1?'':'s'} (${a.base} base${a.bonus?` + ${a.bonus} carryover`:''}). Total: ${state.score[winner]}/10`;
  display('#next-btn',state.host);display('#result-wait',!state.host);
  $('#next-btn').textContent=isFinish?'Play a rematch ↻':'Deal next hand →';
}
// UI event wiring
$('#solo-btn').addEventListener('click',()=>create(true));
$('#create-btn').addEventListener('click',()=>create(false));
$('#join-open-btn').addEventListener('click',()=>{display('#join-fields',true);$('#join-code').focus();});
$('#join-btn').addEventListener('click',join);
$('#join-code').addEventListener('keydown',e=>{if(e.key==='Enter')join();});
$('#player-name').addEventListener('keydown',e=>{if(e.key==='Enter'&&!$('#join-fields').hidden)join();else if(e.key==='Enter')create(true);});
$('#copy-link').addEventListener('click',copyInvite);
$('#game-copy').addEventListener('click',copyInvite);
$('#start-btn').addEventListener('click',()=>action('start'));
$('#next-btn').addEventListener('click',()=>action(state?.phase==='finished'?'rematch':'next'));
$('#my-hand').addEventListener('click',e=>{
  const card=e.target.closest('button[data-card]');
  if(card&&!card.disabled)action('play',{card:card.dataset.card});
});
$('#suit-buttons').addEventListener('click',e=>{
  const btn=e.target.closest('button[data-suit]');if(btn)action('trump',{suit:btn.dataset.suit});
});
$$('[data-help]').forEach(btn=>btn.addEventListener('click',()=>display('#help-overlay',true)));
$('#close-help').addEventListener('click',()=>display('#help-overlay',false));
$('#help-done').addEventListener('click',()=>display('#help-overlay',false));
$('#help-overlay').addEventListener('click',e=>{if(e.target===$('#help-overlay'))display('#help-overlay',false);});
document.addEventListener('keydown',e=>{if(e.key==='Escape')display('#help-overlay',false);});
$$('[data-emoji]').forEach(btn=>btn.addEventListener('click',()=>action('react',{emoji:btn.dataset.emoji})));
$('#sound-toggle').addEventListener('click',()=>{sound=!sound;localStorage.setItem('omi-sound',sound?'on':'off');$('#sound-toggle').textContent=sound?'♫':'♪̸';showToast(sound?'Sound enabled':'Sound muted');});
$('#sound-toggle').textContent=sound?'♫':'♪̸';
$('#player-name').value=localStorage.getItem('omi-name') || '';
const incoming=new URLSearchParams(location.search).get('room')?.toUpperCase();
if(incoming){
  $('#join-code').value=incoming;display('#join-fields',true);
  resume(incoming).then(success=>{if(!success){showScreen('home');showToast('Enter your name to join this friend room.');}});
}
