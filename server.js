// server.js — سيرفر Multiplayer + يقدم اللعبة
const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = 8080;

function getLocalIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return '127.0.0.1';
}

const LOCAL_IP = getLocalIP();

// =========================================================
//        سيرفر HTTP — يقدم index.html للاعبين
// =========================================================
const httpServer = http.createServer((req, res) => {
  let filePath = req.url === '/' ? '/index.html' : req.url;
  filePath = path.join(__dirname, filePath.split('?')[0]);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const mime = {
      '.html': 'text/html; charset=utf-8',
      '.js':   'text/javascript; charset=utf-8',
      '.css':  'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.png':  'image/png',
      '.jpg':  'image/jpeg',
      '.svg':  'image/svg+xml',
      '.ico':  'image/x-icon',
    }[ext] || 'application/octet-stream';

    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
});

// =========================================================
//        سيرفر WebSocket — الرومات واللاعبين
// =========================================================
const wss = new WebSocket.Server({ server: httpServer });
const rooms = new Map(); // roomCode -> Map(playerId -> player)

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log('===========================================');
  console.log('🚀 السيرفر شغال!');
  console.log(`📡 IP جهازك: ${LOCAL_IP}:${PORT}`);
  console.log('');
  console.log(`🌐 افتح اللعبة من: http://${LOCAL_IP}:${PORT}/`);
  console.log('===========================================');

  try {
    fs.writeFileSync('server-ip.txt', `${LOCAL_IP}:${PORT}`, 'utf-8');
  } catch (e) {}
});

// ---------- توليد كود روم عشوائي ----------
function genRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return rooms.has(code) ? genRoomCode() : code;
}

let nextId = 1;

wss.on('connection', (ws) => {
  const id = String(nextId++);
  let currentRoom = null;

  // نبعت معلومات السيرفر أول ما يتصل
  ws.send(JSON.stringify({
    type: 'serverInfo',
    ip: LOCAL_IP,
    port: PORT,
    address: `${LOCAL_IP}:${PORT}`,
  }));

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch (e) {
      return;
    }

    // ================================================
    //           إنشاء روم جديد
    // ================================================
    if (msg.type === 'createRoom') {
      const code = genRoomCode();
      const room = new Map();
      rooms.set(code, room);

      const player = {
        id,
        ws,
        name: msg.name || `لاعب ${id}`,
        x: -136,
        y: 1.7,
        z: -136,
        yaw: 0,
        color: msg.color || Math.floor(Math.random() * 0xffffff),
      };
      room.set(id, player);
      currentRoom = code;

      ws.send(JSON.stringify({
        type: 'roomCreated',
        code,
        id,
        name: player.name,
        spawn: { x: player.x, z: player.z, yaw: 0 },
        players: [],
        address: `${LOCAL_IP}:${PORT}`,
      }));

      console.log(`🏠 روم جديد: ${code} — ${player.name}`);
    }

    // ================================================
    //           دخول روم موجود
    // ================================================
    if (msg.type === 'joinRoom') {
      const code = String(msg.code || '').toUpperCase().trim();
      const room = rooms.get(code);

      if (!room) {
        ws.send(JSON.stringify({
          type: 'error',
          message: 'الروم مش موجود — اتأكد من الكود',
        }));
        return;
      }

      if (room.size >= 8) {
        ws.send(JSON.stringify({
          type: 'error',
          message: 'الروم مليان (8 لاعبين كتير)',
        }));
        return;
      }

      const slot = room.size;
      const player = {
        id,
        ws,
        name: msg.name || `لاعب ${id}`,
        x: -136 + (slot % 4) * 8,
        y: 1.7,
        z: -136 + Math.floor(slot / 4) * 8,
        yaw: 0,
        color: msg.color || Math.floor(Math.random() * 0xffffff),
      };
      room.set(id, player);
      currentRoom = code;

      // اللاعبين الموجودين
      const others = [...room.values()]
        .filter(p => p.id !== id)
        .map(p => ({
          id: p.id,
          name: p.name,
          x: p.x,
          y: p.y,
          z: p.z,
          yaw: p.yaw,
          color: p.color,
        }));

      ws.send(JSON.stringify({
        type: 'roomJoined',
        code,
        id,
        name: player.name,
        spawn: { x: player.x, z: player.z, yaw: 0 },
        players: others,
      }));

      // نبلغ الباقي
      broadcastToRoom(code, {
        type: 'join',
        player: {
          id,
          name: player.name,
          x: player.x,
          y: player.y,
          z: player.z,
          yaw: player.yaw,
          color: player.color,
        },
      }, id);

      console.log(`👋 ${player.name} دخل الروم ${code} — إجمالي: ${room.size}`);
    }

    // ================================================
    //           تحديث موقع اللاعب
    // ================================================
    if (msg.type === 'pos' && currentRoom) {
      const room = rooms.get(currentRoom);
      if (!room) return;
      const p = room.get(id);
      if (!p) return;

      p.x = msg.x;
      p.y = msg.y;
      p.z = msg.z;
      p.yaw = msg.yaw;
      p.vehicle = msg.vehicle || null;

      broadcastToRoom(currentRoom, {
        type: 'pos',
        id,
        x: p.x,
        y: p.y,
        z: p.z,
        yaw: p.yaw,
        vehicle: p.vehicle,
      }, id);
    }

    // ================================================
    //           دردشة
    // ================================================
    if (msg.type === 'chat' && currentRoom) {
      const room = rooms.get(currentRoom);
      if (!room) return;
      const p = room.get(id);
      if (!p) return;

      broadcastToRoom(currentRoom, {
        type: 'chat',
        id,
        name: p.name,
        text: String(msg.text || '').slice(0, 120),
      });
    }
  });

  // ================================================
  //           خروج اللاعب
  // ================================================
  ws.on('close', () => {
    if (currentRoom) {
      const room = rooms.get(currentRoom);
      if (room) {
        const p = room.get(id);
        if (p) console.log(`❌ ${p.name} خرج من الروم ${currentRoom}`);

        room.delete(id);
        broadcastToRoom(currentRoom, { type: 'leave', id });

        // لو الروم فاضي، شيله
        if (room.size === 0) {
          rooms.delete(currentRoom);
          console.log(`🗑️ الروم ${currentRoom} اتقفل (فاضي)`);
        }
      }
    }
  });
});

// =========================================================
//           إرسال رسالة لكل اللاعبين في روم
// =========================================================
function broadcastToRoom(code, msg, exceptId) {
  const room = rooms.get(code);
  if (!room) return;

  const data = JSON.stringify(msg);
  for (const p of room.values()) {
    if (p.id === exceptId) continue;
    if (p.ws.readyState === WebSocket.OPEN) {
      p.ws.send(data);
    }
  }
}