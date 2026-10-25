import { randomInt } from 'node:crypto';

export const SUITS = ['S', 'H', 'D', 'C'];
export const RANKS = ['7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const VALUES = Object.fromEntries(RANKS.map((r, i) => [r, i]));

export function suit(card) { return card[0]; }
export function rank(card) { return card.slice(1); }
export function rankValue(card) { return VALUES[rank(card)]; }
export function newDeck() { return SUITS.flatMap(s => RANKS.map(r => s + r)); }
export function shuffle(cards) {
  const array = [...cards];
  for (let i = array.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}
export function sortHand(cards) {
  return [...cards].sort((a, b) => SUITS.indexOf(suit(a)) - SUITS.indexOf(suit(b)) || rankValue(b) - rankValue(a));
}
export const teamOf = seat => seat % 2;
export const nextSeat = seat => (seat + 1) % 4;
export function legalCards(hand, table) {
  if (!table.length) return [...hand];
  const led = suit(table[0].card);
  const following = hand.filter(card => suit(card) === led);
  return following.length ? following : [...hand];
}
export function winnerOfTrick(table, trump) {
  if (table.length !== 4) throw new Error('Four cards required');
  if (!SUITS.includes(trump)) throw new Error('Invalid trump');
  const led = suit(table[0].card);
  let best = table[0];
  const power = ({card}) => (suit(card) === trump ? 100 : suit(card) === led ? 50 : 0) + rankValue(card);
  for (const play of table.slice(1)) if (power(play) > power(best)) best = play;
  return best.seat;
}
export function scoreRound(tricks, callerTeam, bonus = 0) {
  if (tricks.length !== 2 || tricks[0] + tricks[1] !== 8) throw new Error('Eight tricks required');
  if (tricks[0] === 4) return { team: null, base: 0, bonus: 0, tokens: 0, nextBonus: bonus + 1, label: 'Four–four draw' };
  const team = tricks[0] > tricks[1] ? 0 : 1;
  const base = tricks[team] === 8 ? 3 : team === callerTeam ? 1 : 2;
  const label = tricks[team] === 8 ? 'KAPOTHI! All eight tricks' : team === callerTeam ? 'Trump team wins' : 'Defenders win';
  return { team, base, bonus, tokens: base + bonus, nextBonus: 0, label };
}
export function chooseBotTrump(cards) {
  const score = s => cards.filter(c => suit(c) === s).reduce((total, card) =>
    total + 12 + [0, 0, 0, 1, 2, 3, 5, 8][rankValue(card)], 0);
  return [...SUITS].sort((a, b) => score(b) - score(a))[0];
}
const strength = (card, lead, trump) => (suit(card) === trump ? 100 : suit(card) === lead ? 50 : 0) + rankValue(card);
export function chooseBotCard(hand, table, trump, seat) {
  const allowed = legalCards(hand, table);
  const ascending = [...allowed].sort((a, b) => rankValue(a) - rankValue(b));
  const nontrump = ascending.filter(c => suit(c) !== trump);
  if (!table.length) {
    // Lead a high honor when holding the ace, or a low card from a long suit.
    const aces = allowed.filter(c => rank(c) === 'A');
    const nonTrumpAces = aces.filter(c => suit(c) !== trump);
    if (nonTrumpAces.length) return nonTrumpAces[0];
    const lengths = Object.fromEntries(SUITS.map(s => [s, hand.filter(c => suit(c) === s).length]));
    const long = [...allowed].sort((a, b) => (lengths[suit(b)] - lengths[suit(a)]) || (rankValue(a) - rankValue(b)));
    return long[0];
  }
  const led = suit(table[0].card);
  const best = table.reduce((a, b) => strength(a.card, led, trump) >= strength(b.card, led, trump) ? a : b);
  if (teamOf(best.seat) === teamOf(seat)) return (nontrump.length ? nontrump : ascending)[0];
  const winning = ascending.filter(c => strength(c, led, trump) > strength(best.card, led, trump) && (suit(c) === trump || suit(c) === led));
  if (winning.length) {
    const bestWin = winning.sort((a, b) => strength(a, led, trump) - strength(b, led, trump));
    return bestWin[0];
  }
  return (nontrump.length ? nontrump : ascending)[0];
}
export function makeGame(players, dealer = randomInt(4)) {
  if (!Array.isArray(players) || players.length !== 4 || players.some(p => !p)) throw new Error('Four seats required');
  const game = { players, dealer, scores: [0, 0], bonus: 0, handNumber: 0, history: [], phase: 'setup', winner: null, lastAward: null, lastTrick: null };
  beginRound(game);
  return game;
}
export function beginRound(game) {
  if (game.phase === 'finished') throw new Error('Match is over');
  const deck = shuffle(newDeck());
  game.hands = [[], [], [], []];
  const first = nextSeat(game.dealer);
  for (let i = 0; i < 16; i++) game.hands[(first + i) % 4].push(deck[i]);
  game.remaining = deck.slice(16);
  game.caller = first;
  game.turn = first;
  game.trump = null;
  game.phase = 'trump';
  game.table = [];
  game.tricks = [0, 0];
  game.handNumber++;
  game.lastTrick = null;
  game.lastAward = null;
  game.history.push(`Hand ${game.handNumber}: ${game.players[first].name} will choose trumps.`);
}
export function setTrump(game, seat, pickedSuit) {
  if (game.phase !== 'trump' || seat !== game.caller || !SUITS.includes(pickedSuit)) throw new Error('Not allowed to choose trump');
  game.trump = pickedSuit;
  for (let i = 0; i < 16; i++) game.hands[(game.caller + i) % 4].push(game.remaining[i]);
  game.remaining = [];
  game.phase = 'playing';
  game.history.push(`${game.players[seat].name} chose ${pickedSuit} as trump.`);
}
export function playCard(game, seat, card) {
  if (game.phase !== 'playing' || game.turn !== seat) throw new Error('Not your turn');
  if (!game.hands[seat].includes(card)) throw new Error('You do not have that card');
  if (!legalCards(game.hands[seat], game.table).includes(card)) throw new Error('You must follow the led suit');
  game.hands[seat].splice(game.hands[seat].indexOf(card), 1);
  game.table.push({ seat, card });
  if (game.table.length === 4) {
    game.phase = 'resolving';
    game.turn = null;
  } else game.turn = nextSeat(seat);
}
export function resolveTrick(game) {
  if (game.phase !== 'resolving' || game.table.length !== 4) throw new Error('Trick is not ready');
  const winner = winnerOfTrick(game.table, game.trump);
  game.tricks[teamOf(winner)]++;
  game.lastTrick = { winner, cards: [...game.table], number: game.tricks[0] + game.tricks[1] };
  game.history.push(`Trick ${game.lastTrick.number}: ${game.players[winner].name} won (${game.table.map(p => p.card).join(' · ')}).`);
  game.table = [];
  game.turn = winner;
  if (game.tricks[0] + game.tricks[1] === 8) {
    const award = scoreRound(game.tricks, teamOf(game.caller), game.bonus);
    game.lastAward = award;
    game.bonus = award.nextBonus;
    if (award.team !== null) game.scores[award.team] += award.tokens;
    game.history.push(`${award.label}: ${award.tokens} token${award.tokens === 1 ? '' : 's'} earned.`);
    if (game.scores.some(s => s >= 10)) {
      game.phase = 'finished';
      game.winner = game.scores[0] >= 10 ? 0 : 1;
    } else game.phase = 'roundEnd';
    game.turn = null;
  } else game.phase = 'playing';
  return winner;
}
export function nextRound(game) {
  if (game.phase !== 'roundEnd') throw new Error('Round not complete');
  game.dealer = nextSeat(game.dealer);
  beginRound(game);
}
