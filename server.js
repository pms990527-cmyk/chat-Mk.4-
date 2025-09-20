/**
 * Mini 1:1 Chat — single-file Node.js + Socket.IO app
 * ---------------------------------------------------
 * Features
 * - No login/account. Users enter a nickname.
 * - Private room via invite link: https://YOUR_HOST/?room=abc123
 * - Optional room key (password). First entrant sets it; second must match.
 * - Strictly 1:1 (max 2 participants). Third user is rejected.
 * - Message, typing indicator, join/leave, basic spam/throttle.
 * - In-memory only; no database. Restart wipes rooms.
 *
 * How to run (locally)
 * 1) npm init -y && npm i express socket.io@4
 * 2) node server.js
 */
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  maxHttpBufferSize: 1e6
});

// In-memory rooms
const rooms = new Map();
function getRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, { key: null, users: new Set(), lastMsgs: [] });
  }
  return rooms.get(roomId);
}
function sanitize(str, max = 200) {
  if (typeof str !== 'string') return '';
  return str.replace(/[<>]/g, '').slice(0, max);
}
function now() { return Date.now(); }
function isThrottled(room, socketId, limit = 8, windowMs = 10_000) {
  const t = now();
  room.lastMsgs = room.lastMsgs.filter(m => t - m.t < windowMs);
  const count = room.lastMsgs.reduce((acc, m) => acc + (m.from === socketId ? 1 : 0), 0);
  return count >= limit;
}

app.get('/', (req, res) => {
  const { room = '', nick = '' } = req.query;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>1:1 Private Chat</title>
  <style>
    :root { --bg:#0f172a; --card:#111827; --muted:#94a3b8; --text:#e5e7eb; --accent:#22d3ee; }
    *{box-sizing:border-box} body{margin:0;font-family:system-ui, -apple-system, Segoe UI, Roboto, Noto Sans KR, Arial;background:linear-gradient(120deg,#0b1020,#111827);color:var(--text)}
    .wrap{max-width:820px;margin:24px auto;padding:16px}
    .card{background:rgba(17,24,39,.8);backdrop-filter:blur(6px);border:1px solid rgba(148,163,184,.15);border-radius:16px;padding:16px;box-shadow:0 10px 30px rgba(0,0,0,.35)}
    h1{margin:0 0 6px;font-size:20px;font-weight:700}
    .muted{color:var(--muted);font-size:14px}
    label{display:block;margin:10px 0 6px}
    input,button{font:inherit}
    input[type=text],input[type=password]{width:100%;padding:10px 12px;border-radius:12px;border:1px solid rgba(148,163,184,.25);background:#0b1220;color:#e5e7eb}
    button{cursor:pointer;border:1px solid rgba(148,163,184,.25);background:#0b1220;color:#e5e7eb;border-radius:12px;padding:10px 14px}
    button.primary{background:var(--accent);border-color:transparent;color:#0b1220;font-weight:700}
    .row{display:flex;gap:8px}
    .chat{height:380px;overflow:auto;border:1px solid rgba(148,163,184,.2);border-radius:12px;padding:12px;background:#0b1220}
    .msg{margin:8px 0;display:flex;gap:8px;align-items:flex-end}
    .bubble{max-width:70%;padding:10px 12px;border-radius:14px;border:1px solid rgba(148,163,184,.2)}
    .me{justify-content:flex-end}
    .me .bubble{background:#111827}
    .them .bubble{background:#0d1528}
    .sys{color:#94a3b8;text-align:center;font-size:13px;margin:8px 0}
    .typing{font-size:12px;color:var(--muted);margin-top:4px;height:16px}
    .top{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}
    .top .right{display:flex;gap:6px;align-items:center}
    .tag{font-size:12px;color:#0b1220;background:#a5f3fc;border-radius:999px;padding:2px 8px}
    .small{font-size:12px;color:var(--muted)}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="top">
        <div>
          <h1>1:1 Private Chat</h1>
          <div class="small">Invite link: <span id="invite"></span></div>
        </div>
        <div class="right"><span class="tag" id="status">대기</span></div>
      </div>

      <div id="setup">
        <label>대화방 코드 (영문/숫자)</label>
        <input id="room" type="text" placeholder="예: myroom123" value="${room}" />

        <label style="margin-top:12px">닉네임</label>
        <input id="nick" type="text" placeholder="예: 민성" value="${nick}" />

        <label style="margin-top:12px">방 키 (선택, 비밀번호)</label>
        <input id="key" type="password" placeholder="처음 입장한 사람이 키를 설정하면, 두 번째도 동일 키 필요" />

        <div class="row" style="margin-top:12px">
          <button id="create" class="primary">입장</button>
          <button id="makeLink">초대 링크 만들기</button>
        </div>
        <div class="typing" id="hint">최대 2명만 입장할 수 있어요.</div>
      </div>

      <div id="chatUI" style="display:none">
        <div class="chat" id="chat"></div>
        <div class="typing" id="typing"></div>
        <div class="row" style="margin-top:8px">
          <input id="text" type="text" placeholder="메시지 입력" />
          <button id="send" class="primary">전송</button>
        </div>
      </div>
    </div>
  </div>

  <script src="/socket.io/socket.io.js"></script>
  <script>
    const $ = (s)=>document.querySelector(s);
    const roomInput = $('#room');
    const nickInput = $('#nick');
    const keyInput = $('#key');
    const invite = $('#invite');
    const statusTag = $('#status');
    const chatBox = $('#chat');
    const chatUI = $('#chatUI');
    const typing = $('#typing');

    function setInviteLink(r){
      const url = new URL(window.location);
      url.searchParams.set('room', r);
      invite.textContent = url.toString();
    }

    $('#makeLink').onclick = () => {
      const r = roomInput.value.trim();
      if(!r){ alert('방 코드를 입력하세요'); return; }
      setInviteLink(r);
    };

    function addSys(msg){
      const d = document.createElement('div'); d.className='sys'; d.textContent = msg; chatBox.appendChild(d); chatBox.scrollTop = chatBox.scrollHeight; }
    function addMsg(fromMe, name, text){
      const row = document.createElement('div'); row.className = 'msg ' + (fromMe?'me':'them');
      const b = document.createElement('div'); b.className='bubble'; b.innerHTML = '<strong>'+name+':</strong> ' + text;
      row.appendChild(b); chatBox.appendChild(row); chatBox.scrollTop = chatBox.scrollHeight;
    }

    let socket; let myNick; let myRoom; let joined = false; let typingTimer;

    $('#create').onclick = () => {
      const r = roomInput.value.trim();
      const n = nickInput.value.trim();
      const k = keyInput.value.trim();
      if(!r || !n){ alert('방 코드와 닉네임을 입력하세요'); return; }
      myNick = n; myRoom = r;
      socket = io();
      socket.emit('join', { room: r, nick: n, key: k });

      socket.on('joined', (info)=>{
        joined = true; statusTag.textContent = '연결됨'; statusTag.style.background = '#86efac';
        setInviteLink(myRoom);
        $('#setup').style.display='none'; chatUI.style.display='block';
        addSys(info.msg);
        history.replaceState(null, '', '?room='+encodeURIComponent(myRoom)+'&nick='+encodeURIComponent(myNick));
      });

      socket.on('join_error', (err)=>{
        addSys('입장 실패: ' + err);
        statusTag.textContent = '거부됨'; statusTag.style.background = '#fca5a5';
        socket.disconnect();
      });

      socket.on('peer_joined', (name)=> addSys(name + ' 님이 입장했습니다'));
      socket.on('peer_left', (name)=> addSys(name + ' 님이 퇴장했습니다'));

      socket.on('msg', ({ nick, text, ts }) => {
        addMsg(false, nick, text);
      });

      socket.on('typing', (name)=>{
        typing.textContent = name + ' 입력 중...';
        clearTimeout(typingTimer);
        typingTimer = setTimeout(()=> typing.textContent = '', 1200);
      });

      socket.on('info', (m)=> addSys(m));
    };

    $('#send').onclick = sendMsg;
    $('#text').addEventListener('keydown', (e)=>{
      if(e.key==='Enter') sendMsg();
      else if(['Shift','Alt','Control','Meta'].includes(e.key)===false && joined) socket.emit('typing', myRoom);
    });

    function sendMsg(){
      const input = $('#text');
      const val = input.value.trim(); if(!val) return;
      socket.emit('msg', { room: myRoom, text: val });
      addMsg(true, myNick, val);
      input.value = '';
    }

    // Prefill from URL
    const url = new URL(window.location);
    const r = url.searchParams.get('room');
    const n = url.searchParams.get('nick');
    if(r){ roomInput.value = r; setInviteLink(r); }
    if(n){ nickInput.value = n; }
  </script>
</body>
</html>`);
});

io.on('connection', (socket) => {
  socket.on('join', ({ room, nick, key }) => {
    room = sanitize(room, 40);
    nick = sanitize(nick, 24);
    key = sanitize(key, 50);
    if (!room || !nick) return socket.emit('join_error', '잘못된 파라미터');

    const r = getRoom(room);

    if (r.users.size >= 2) {
      return socket.emit('join_error', '이 방은 최대 2명만 입장할 수 있어요');
    }

    if (r.users.size === 0) {
      if (key) r.key = key;
    } else {
      if (r.key && key !== r.key) {
        return socket.emit('join_error', '방 키가 일치하지 않습니다');
      }
      if (!r.key && key) {
        return socket.emit('join_error', '이미 만들어진 방에는 키를 새로 설정할 수 없어요');
      }
    }

    socket.data.nick = nick;
    socket.data.room = room;

    socket.join(room);
    r.users.add(socket.id);

    socket.emit('joined', { msg: `${nick} 님, ${room} 방에 입장했습니다${r.key ? ' (키 적용됨)' : ''}` });
    socket.to(room).emit('peer_joined', nick);
  });

  socket.on('msg', ({ room, text }) => {
    room = sanitize(room, 40);
    const r = rooms.get(room);
    if (!r) return;
    const nick = sanitize(socket.data.nick, 24) || '게스트';
    text = sanitize(text, 2000);

    if (isThrottled(r, socket.id)) {
      return socket.emit('info', '메시지가 너무 빠릅니다. 잠시 후 다시 시도하세요.');
    }

    r.lastMsgs.push({ t: now(), from: socket.id });
    io.to(room).emit('msg', { nick, text, ts: now() });
  });

  socket.on('typing', (room) => {
    room = sanitize(room, 40);
    const r = rooms.get(room);
    if (!r) return;
    const nick = sanitize(socket.data.nick, 24) || '게스트';
    socket.to(room).emit('typing', nick);
  });

  socket.on('disconnect', () => {
    const room = socket.data.room;
    const nick = socket.data.nick;
    if (room && rooms.has(room)) {
      const r = rooms.get(room);
      r.users.delete(socket.id);
      socket.to(room).emit('peer_left', nick || '게스트');
      if (r.users.size === 0) rooms.delete(room);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('1:1 chat running on http://localhost:' + PORT);
});