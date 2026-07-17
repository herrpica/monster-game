"use strict";
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
const server = require('http').createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, '..', 'public')));

const MODE_CAPACITY = { '1v1': 2, '2v2': 4, '3v3': 6, 'ffa': 4 };
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const queues = { '1v1': [], '2v2': [], '3v3': [], 'ffa': [] };
const rooms = new Map();   // code -> { mode, capacity, hostId, players: [{id,name,charId,ready}] }
const matches = new Map(); // matchId -> { mode, hostId, players: [{id,name,charId,team}] }
const playerLoc = new Map(); // socketId -> { kind:'queue'|'room'|'match', mode?, code?, matchId? }

function makeCode(){
  let c=''; for(let i=0;i<5;i++) c += CODE_CHARS[Math.random()*CODE_CHARS.length|0];
  return rooms.has(c) ? makeCode() : c;
}
function teamsFor(mode, n){
  if(mode==='1v1') return [0,1];
  if(mode==='2v2') return [0,0,1,1];
  if(mode==='3v3') return [0,0,0,1,1,1];
  const arr=[]; for(let i=0;i<n;i++) arr.push(i);
  return arr;
}
function safeName(n){
  return (typeof n==='string' && n.trim()) ? n.trim().slice(0,16) : 'Fighter';
}
function safeChar(id){
  return (typeof id==='string' && id.length<32) ? id : 'shade';
}
function clearLoc(id){ playerLoc.delete(id); }

function removeFromQueue(socketId){
  for(const mode of Object.keys(queues)){
    const q = queues[mode];
    const i = q.findIndex(p=>p.id===socketId);
    if(i>=0) q.splice(i,1);
  }
}

function startMatchFromPlayers(mode, players){
  const matchId = crypto.randomUUID();
  const teams = teamsFor(mode, players.length);
  const roster = players.map((p,i)=>({ id:p.id, name:p.name, charId:p.charId, team:teams[i] }));
  const hostId = roster[0].id;
  matches.set(matchId, { mode, hostId, players: roster });
  for(const p of roster){
    const sock = io.sockets.sockets.get(p.id);
    if(!sock) continue;
    sock.join(matchId);
    playerLoc.set(p.id, { kind:'match', matchId });
    sock.emit('matchStart', { matchId, mode, isHost: p.id===hostId, players: roster });
  }
}

function tryFormQueueMatch(mode){
  const need = MODE_CAPACITY[mode];
  const q = queues[mode];
  while(q.length >= need){
    const chosen = q.splice(0, need);
    startMatchFromPlayers(mode, chosen);
  }
}

function broadcastRoom(code){
  const room = rooms.get(code);
  if(!room) return;
  io.to('room:'+code).emit('roomUpdate', {
    code, mode: room.mode, capacity: room.capacity, hostId: room.hostId,
    players: room.players.map(p=>({ id:p.id, name:p.name, charId:p.charId, ready:p.ready }))
  });
}

function leaveRoomInternal(socket, code){
  const room = rooms.get(code);
  if(!room) return;
  socket.leave('room:'+code);
  room.players = room.players.filter(p=>p.id!==socket.id);
  if(room.players.length===0){ rooms.delete(code); return; }
  if(room.hostId===socket.id) room.hostId = room.players[0].id;
  broadcastRoom(code);
}

function endMatch(matchId, payload){
  const match = matches.get(matchId);
  if(!match) return;
  io.to(matchId).emit('matchEvent', payload);
  matches.delete(matchId);
}

io.on('connection', (socket)=>{

  socket.on('quickMatch', ({mode, charId, name}={})=>{
    if(!MODE_CAPACITY[mode]) return;
    removeFromQueue(socket.id);
    queues[mode].push({ id: socket.id, name: safeName(name), charId: safeChar(charId) });
    playerLoc.set(socket.id, { kind:'queue', mode });
    for(const m of Object.keys(queues)) socket.emit('queueStatus', { mode:m, waiting:queues[m].length, need:MODE_CAPACITY[m] });
    tryFormQueueMatch(mode);
  });

  socket.on('cancelQuickMatch', ()=>{
    removeFromQueue(socket.id);
    clearLoc(socket.id);
  });

  socket.on('createRoom', ({mode, charId, name}={})=>{
    if(!MODE_CAPACITY[mode]) return;
    const capacity = MODE_CAPACITY[mode];
    const code = makeCode();
    const room = { mode, capacity, hostId: socket.id,
      players:[{ id:socket.id, name:safeName(name), charId:safeChar(charId), ready:false }] };
    rooms.set(code, room);
    socket.join('room:'+code);
    playerLoc.set(socket.id, { kind:'room', code });
    socket.emit('roomCreated', { code, mode, capacity });
    broadcastRoom(code);
  });

  socket.on('joinRoom', ({code, charId, name}={})=>{
    code = (code||'').toUpperCase().trim();
    const room = rooms.get(code);
    if(!room){ socket.emit('roomError', { message:'Room not found.' }); return; }
    if(room.players.length >= room.capacity){ socket.emit('roomError', { message:'Room is full.' }); return; }
    if(room.players.some(p=>p.id===socket.id)){ socket.emit('roomError', { message:'Already in room.' }); return; }
    room.players.push({ id:socket.id, name:safeName(name), charId:safeChar(charId), ready:false });
    socket.join('room:'+code);
    playerLoc.set(socket.id, { kind:'room', code });
    socket.emit('roomJoined', { code, mode:room.mode, capacity:room.capacity });
    broadcastRoom(code);
  });

  socket.on('leaveRoom', ()=>{
    const loc = playerLoc.get(socket.id);
    if(loc && loc.kind==='room') leaveRoomInternal(socket, loc.code);
    clearLoc(socket.id);
  });

  socket.on('toggleReady', ({ready}={})=>{
    const loc = playerLoc.get(socket.id);
    if(!loc || loc.kind!=='room') return;
    const room = rooms.get(loc.code);
    if(!room) return;
    const p = room.players.find(p=>p.id===socket.id);
    if(p) p.ready = !!ready;
    broadcastRoom(loc.code);
    if(room.players.length>=room.capacity && room.players.every(p=>p.ready)){
      const players = room.players.slice();
      rooms.delete(loc.code);
      io.socketsLeave('room:'+loc.code);
      startMatchFromPlayers(room.mode, players);
    }
  });

  socket.on('startRoom', ()=>{
    const loc = playerLoc.get(socket.id);
    if(!loc || loc.kind!=='room') return;
    const room = rooms.get(loc.code);
    if(!room || room.hostId!==socket.id) return;
    const minNeeded = room.mode==='ffa' ? 2 : room.capacity;
    if(room.players.length<minNeeded) return;
    const players = room.players.slice();
    rooms.delete(loc.code);
    io.socketsLeave('room:'+loc.code);
    startMatchFromPlayers(room.mode, players);
  });

  socket.on('input', (input)=>{
    const loc = playerLoc.get(socket.id);
    if(!loc || loc.kind!=='match') return;
    const match = matches.get(loc.matchId);
    if(!match) return;
    const hostSock = io.sockets.sockets.get(match.hostId);
    if(hostSock) hostSock.emit('peerInput', { playerId: socket.id, input });
  });

  socket.on('stateSync', (payload)=>{
    const loc = playerLoc.get(socket.id);
    if(!loc || loc.kind!=='match') return;
    const match = matches.get(loc.matchId);
    if(!match || match.hostId!==socket.id) return;
    socket.to(loc.matchId).emit('stateSync', payload);
  });

  socket.on('matchEvent', (payload)=>{
    const loc = playerLoc.get(socket.id);
    if(!loc || loc.kind!=='match') return;
    const match = matches.get(loc.matchId);
    if(!match || match.hostId!==socket.id) return;
    io.to(loc.matchId).emit('matchEvent', payload);
  });

  socket.on('restartMatch', ()=>{
    const loc = playerLoc.get(socket.id);
    if(!loc || loc.kind!=='match') return;
    const match = matches.get(loc.matchId);
    if(!match || match.hostId!==socket.id) return;
    for(const p of match.players){
      const sock = io.sockets.sockets.get(p.id);
      if(sock) sock.emit('matchStart', { matchId: loc.matchId, mode: match.mode, isHost: p.id===match.hostId, players: match.players });
    }
  });

  socket.on('leaveMatch', ()=>{
    const loc = playerLoc.get(socket.id);
    if(!loc || loc.kind!=='match') return;
    handleMatchLeave(socket, loc.matchId);
  });

  socket.on('disconnect', ()=>{
    removeFromQueue(socket.id);
    const loc = playerLoc.get(socket.id);
    if(!loc){ return; }
    if(loc.kind==='room') leaveRoomInternal(socket, loc.code);
    else if(loc.kind==='match') handleMatchLeave(socket, loc.matchId);
    clearLoc(socket.id);
  });

  function handleMatchLeave(socket, matchId){
    const match = matches.get(matchId);
    if(!match) return;
    socket.leave(matchId);
    if(socket.id===match.hostId){
      endMatch(matchId, { type:'aborted', reason:'host_disconnected' });
    } else {
      match.players = match.players.filter(p=>p.id!==socket.id);
      io.to(matchId).emit('peerLeft', { playerId: socket.id });
    }
    clearLoc(socket.id);
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, ()=>{
  console.log('Fur & Fury server listening on port ' + PORT);
});
