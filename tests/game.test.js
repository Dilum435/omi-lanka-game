import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGame, newDeck, legalCards, setTrump, playCard, resolveTrick, scoreRound, winnerOfTrick, chooseBotCard, chooseBotTrump, teamOf, nextRound} from '../core.js';
const players = Array.from({length:4}, (_,i)=>({name:`Player ${i}`,isBot:false}));
test('deck contains exactly 32 unique cards and correct ranks', ()=>{
  const deck=newDeck(); assert.equal(deck.length,32); assert.equal(new Set(deck).size,32);
  assert.ok(deck.includes('S7')); assert.ok(deck.includes('HA')); assert.ok(!deck.includes('S6'));
});
test('following suit is compulsory',()=>{
  assert.deepEqual(legalCards(['H7','SK','S8'],[{seat:0,card:'SA'}]),['SK','S8']);
  assert.deepEqual(legalCards(['H7','C9'],[{seat:0,card:'SA'}]),['H7','C9']);
});
test('highest trump beats an ace of the led suit',()=>{
  const cards=[{seat:0,card:'HA'},{seat:1,card:'H8'},{seat:2,card:'S7'},{seat:3,card:'SK'}];
  assert.equal(winnerOfTrick(cards,'S'),3);
  assert.equal(winnerOfTrick(cards,'D'),0);
});
test('correct tokens for trump wins, defenders, kapothi, tie and rollover',()=>{
  assert.equal(scoreRound([5,3],0).tokens,1);
  assert.equal(scoreRound([3,5],0).tokens,2);
  assert.equal(scoreRound([8,0],0).tokens,3);
  assert.equal(scoreRound([0,8],0).tokens,3);
  assert.equal(scoreRound([4,4],0,1).nextBonus,2);
  assert.equal(scoreRound([5,3],0,2).tokens,3);
});
test('dealer right calls trump from four cards then eight are dealt',()=>{
  const game=makeGame(players,0);
  assert.equal(game.caller,1); assert.equal(game.turn,1); assert.equal(game.phase,'trump');
  assert.deepEqual(game.hands.map(x=>x.length),[4,4,4,4]);
  setTrump(game,1,'H'); assert.equal(game.phase,'playing');
  assert.deepEqual(game.hands.map(x=>x.length),[8,8,8,8]);
  assert.throws(()=>setTrump(game,0,'S'));
});
test('card not held and off-suit plays get rejected',()=>{
  const g=makeGame(players,0); setTrump(g,1,'S');
  assert.throws(()=>playCard(g,1,'X10'));
  const lead=g.hands[1][0]; playCard(g,1,lead);
  const next=g.turn;
  const hasFollow=g.hands[next].filter(c=>c[0]===lead[0]);
  if(hasFollow.length && hasFollow.length<g.hands[next].length) {
    const bad=g.hands[next].find(c=>c[0]!==lead[0]);
    assert.throws(()=>playCard(g,next,bad),/follow/);
  }
});
test('a full hand has 8 tricks, scored; next dealer rotates',()=>{
  const g=makeGame(players,0); setTrump(g,1,'S');
  for(let trick=0;trick<8;trick++) {
    for(let i=0;i<4;i++) {
      const p=g.turn;
      playCard(g,p,chooseBotCard(g.hands[p],g.table,g.trump,p));
    }
    assert.equal(g.phase,'resolving'); resolveTrick(g);
  }
  assert.equal(g.tricks[0]+g.tricks[1],8);
  assert.equal(g.phase,'roundEnd');
  assert.ok(g.lastAward);
  nextRound(g); assert.equal(g.dealer,1);assert.equal(g.caller,2);
});
test('bot trump is valid and AI always returns a legal card',()=>{
  const g=makeGame(players,0);
  const choice=chooseBotTrump(g.hands[1]);
  assert.ok(['S','H','D','C'].includes(choice));
  setTrump(g,1,choice);
  for(let i=0;i<4;i++) {
    const p=g.turn; const card=chooseBotCard(g.hands[p],g.table,g.trump,p);
    assert.ok(legalCards(g.hands[p],g.table).includes(card));
    playCard(g,p,card);
  }
  assert.equal(teamOf(2),0);
});
