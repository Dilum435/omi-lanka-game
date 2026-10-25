import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomInt } from 'node:crypto';
import { beginRound, chooseBotCard, chooseBotTrump, legalCards, makeGame, nextRound, playCard, resolveTrick, setTrump, sortHand, teamOf } from './core.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT || 3000);
const rooms = new Map();
const MIME = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.ico':'image/x-icon' };
const BOT_NAMES = ['Nimali 🤖', 'Kamal 🤖', 'Sahan 🤖', 'Tharushi 🤖'];
const REACTIONS = new Set(['👏', '🔥', '😎', '😂', '👍', '😮']);
const safeName = value => typeof value === 'string' ? value.replace(/[<>\x00-\x1f]/g, '').trim().slice(0, 20) : '';
const token = () => randomBytes(24).toString('hex');
const code = () => Array.from({length:6}, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[randomInt(32)]).join('');

function roomSummary(room, viewerToken) {
  const seat = room.players.findIndex(p => p?.token === viewerToken);
  if (seat < 0) return null;
  const g = room.game;
  const result = {
    code: room.code, seat, host: room.players[0]?.token === viewerToken,
    phase: g?.phase || 'lobby',
    players: room.players.map((p, i) => p ? ({ name: p.name, seat: i, team: teamOf(i), isBot: p.isBot, connected: p.isBot || [...room.clients].some(c => c.token === p.token) }) : null),
    score: g?.scores || [0, 0], bonus: g?.bonus || 0,
    round: g?.handNumber || 0, dealer: g?.dealer ?? null, caller: g?.caller ?? null,
    trump: g?.trump || null, turn: g?.turn ?? null,
    tricks: g?.tricks || [0, 0], table: g?.table || [],
    counts: g ? g.hands.map(h => h.length) : [0, 0, 0, 0],
    hand: g ? sortHand(g.hands[seat]) : [],
    legal: g?.phase === 'playing' && g.turn === seat ? legalCards(g.hands[seat], g.table) : [],
    lastTrick: g?.lastTrick || null,
    lastAward: g?.lastAward || null,
    winner: g?.winner ?? null,
    history: g?.history.slice(-18).reverse() || [],
    reaction: room.reaction || null,
    version: room.version
  };
  return result;
}
function broadcast(room) {
  room.version++;
  room.touched = Date.now();
  for (const client of [...room.clients]) {
    try { client.res.write(`event: state\ndata: ${JSON.stringify(roomSummary(room, client.token))}\n\n`); }
    catch { room.clients.delete(client); }
  }
  scheduleBot(room);
}
function scheduleBot(room) {
  const g = room.game;
  if (!g || room.botScheduled) return;
  const currentSeat = g.phase === 'trump' ? g.caller : g.phase === 'playing' ? g.turn : null;
  if (currentSeat === null || !g.players[currentSeat].isBot) return;
  room.botScheduled = true;
  setTimeout(() => {
    room.botScheduled = false;
    if (room.game !== g) return;
    const s = g.phase === 'trump' ? g.caller : g.phase === 'playing' ? g.turn : null;
    if (s !== currentSeat || !g.players[s]?.isBot) return;
    try {
      if (g.phase === 'trump') setTrump(g, s, chooseBotTrump(g.hands[s]));
      else if (g.phase === 'playing') playCard(g, s, chooseBotCard(g.hands[s], g.table, g.trump, s));
      afterMove(room);
    } catch (e) { console.error('Bot failed:', e); }
  }, 560).unref();
}
function afterMove(room) {
  broadcast(room);
  if (room.game?.phase === 'resolving') {
    const g = room.game;
    setTimeout(() => {
      if (room.game !== g || g.phase !== 'resolving') return;
      resolveTrick(g);
      broadcast(room);
    }, 1100).unref();
  }
}
function createRoom(name) {
  let id; do { id = code(); } while (rooms.has(id));
  const secret = token();
  const room = { code: id, players: [{name, token: secret, isBot: false}, null, null, null], clients: new Set(),
    version: 1, game: null, touched: Date.now(), botScheduled: false, reaction: null };
  rooms.set(id, room);
  return { room, secret };
}
function respond(res, data, status=200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(data));
}
function failure(res, message, status=400) { respond(res, {error: message}, status); }
async function readJson(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16384) throw new Error('Request too large');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw new Error('Invalid JSON'); }
}
async function api(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean);
  const method = req.method;
  if (method === 'POST' && parts.length === 2 && parts[1] === 'rooms') {
    const {name} = await readJson(req);
    const cleaned = safeName(name);
    if (cleaned.length < 2) return failure(res, 'Name should have at least 2 characters');
    const {room,secret} = createRoom(cleaned);
    return respond(res, {code:room.code,token:secret,state:roomSummary(room,secret)},201);
  }
  if (parts.length < 3 || parts[1] !== 'rooms') return failure(res,'Unknown endpoint',404);
  const id = (parts[2] || '').toUpperCase();
  const room = rooms.get(id);
  if (!room) return failure(res,'Room not found. Check the invite code.',404);
  if (method === 'POST' && parts.length === 4 && parts[3] === 'join') {
    if (room.game) return failure(res,'This match already started. Join before the host starts.',409);
    const data = await readJson(req);
    const name = safeName(data.name);
    if (name.length < 2) return failure(res,'Name should have at least 2 characters');
    let seat = Number.isInteger(data.seat) ? data.seat : room.players.findIndex(p => !p);
    if (seat < 0 || seat > 3 || room.players[seat]) return failure(res,'That seat is occupied',409);
    const secret = token();
    room.players[seat] = { name, token: secret, isBot: false };
    broadcast(room);
    return respond(res,{code:id,token:secret,state:roomSummary(room,secret)},201);
  }
  const authToken = method === 'GET' ? url.searchParams.get('token') : String(req.headers['x-omi-token'] || '');
  if (!authToken || !room.players.some(p => p?.token === authToken)) return failure(res,'Not allowed. Please rejoin with your room link.',403);
  if (method === 'GET' && parts.length === 4 && parts[3] === 'state') return respond(res,roomSummary(room,authToken));
  if (method === 'GET' && parts.length === 4 && parts[3] === 'events') {
    res.writeHead(200, { 'Content-Type':'text/event-stream; charset=utf-8', 'Cache-Control':'no-cache, no-transform', Connection:'keep-alive', 'X-Accel-Buffering':'no', 'X-Content-Type-Options':'nosniff' });
    const client = {token: authToken,res};
    room.clients.add(client);
    res.write(`retry: 1500\nevent: state\ndata: ${JSON.stringify(roomSummary(room,authToken))}\n\n`);
    broadcast(room);
    const timer = setInterval(() => { try { res.write(': keepalive\n\n'); } catch { clearInterval(timer); } }, 20000);
    timer.unref();
    res.on('close', () => { clearInterval(timer); room.clients.delete(client); broadcast(room); });
    return;
  }
  if (method === 'POST' && parts.length === 4 && parts[3] === 'action') {
    const data = await readJson(req);
    const seat = room.players.findIndex(p => p?.token === authToken);
    const host = seat === 0;
    const g = room.game;
    switch (data.type) {
      case 'start': {
        if (!host) return failure(res, 'Only the host can start');
        if (g) return failure(res,'Already started');
        for (let i = 0; i < 4; i++) if (!room.players[i]) room.players[i] = {name:BOT_NAMES[i], token: null, isBot:true};
        room.game = makeGame(room.players);
        afterMove(room);
        break;
      }
      case 'trump':
        if (!g) return failure(res,'No active match');
        setTrump(g,seat,data.suit);
        afterMove(room);
        break;
      case 'play':
        if (!g) return failure(res,'No active match');
        playCard(g,seat,data.card);
        afterMove(room);
        break;
      case 'next':
        if (!host || !g) return failure(res,'Only the host can start the next hand');
        nextRound(g);
        afterMove(room);
        break;
      case 'rematch': {
        if (!host || !g || g.phase !== 'finished') return failure(res,'Host can request a rematch after game ends');
        room.game = makeGame(room.players);
        afterMove(room);
        break;
      }
      case 'react': {
        if (!REACTIONS.has(data.emoji)) return failure(res,'Unknown reaction');
        room.reaction = {emoji:data.emoji,name:room.players[seat].name,id:randomBytes(4).toString('hex')};
        broadcast(room);
        break;
      }
      default: return failure(res,'Unknown action');
    }
    return respond(res,{ok:true,version:room.version});
  }
  return failure(res,'Unknown endpoint',404);
}
async function staticFile(req,res,url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return failure(res,'Method not allowed',405);
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { return failure(res,'Invalid path'); }
  if (pathname === '/') pathname = '/index.html';
  const absolute = path.resolve(PUBLIC, '.' + pathname);
  if (!absolute.startsWith(PUBLIC + path.sep) || pathname.includes('\\') || path.basename(absolute).startsWith('.')) return failure(res,'Forbidden',403);
  try {
    const info = await stat(absolute);
    if (!info.isFile()) return failure(res,'Not found',404);
    const buffer = await readFile(absolute);
    res.writeHead(200, {'Content-Type':MIME[path.extname(absolute)] || 'application/octet-stream', 'Content-Length': buffer.length, 'Cache-Control':'public, max-age=300', 'X-Content-Type-Options':'nosniff'});
    res.end(req.method === 'HEAD' ? undefined : buffer);
  } catch { failure(res,'Not found',404); }
}
const server = http.createServer(async (req,res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) await api(req,res,url);
    else await staticFile(req,res,url);
  } catch (e) { if (!res.headersSent) failure(res,e.message || 'Server error', e.message === 'Request too large' ? 413 : 400); else res.end(); }
});
const cleanTimer = setInterval(() => {
  for (const [id,room] of rooms) if (!room.clients.size && Date.now() - room.touched > 6*60*60*1000) rooms.delete(id);
}, 60*60*1000);
cleanTimer.unref();
server.listen(PORT, '0.0.0.0', () => console.log(`OMI Lanka running → http://localhost:${PORT}`));
export { server };
