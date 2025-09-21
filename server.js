/**
 * Multi-user Chat — Cloud Cat / Fox
 * - 탭깜빡임(제목+파비콘), 데스크톱 알림, 소리 알림 각각 독립 토글
 * - 알림 끄기 즉시 반영(소리/깜빡임/데스크톱)
 * - 재연결 시 방 자동 재조인, keep-alive, 읽음 카운트, 이모지/파일, 테마 전환
 */
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// 타임아웃 튜닝
server.headersTimeout = 65_000;
server.keepAliveTimeout = 61_000;

const io = new Server(server, {
  cors: { origin: '*' },
  serveClient: true,
  pingInterval: 10_000,
  pingTimeout: 180_000,
  maxHttpBufferSize: 8_000_000
});

const APP_VERSION = 'v-2025-09-22-flash-favicon-fix';

const rooms = new Map();
/**
 * room = { key, users:Set<sid>, lastMsgs:[], unread: Map<msgId, Set<sid>> }
 */
function getRoom(roomId) {
  if (!rooms.has(roomId)) rooms.set(roomId, { key: null, users: new Set(), lastMsgs: [], unread: new Map() });
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

app.get('/healthz', (_, res) => res.status(200).type('text/plain').send('ok'));

app.get('/', (req, res) => {
  const { room = '', nick = '' } = req.query;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`<!doctype html>
<html lang="ko" data-theme="cloud">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Cloud Cat / Fox Chat</title>
<link id="favicon" rel="icon" href="">
<style>
  :root{
    --app-bg: linear-gradient(180deg,#e0f2fe,#ffffff);
    --chat-bg: linear-gradient(180deg,#f0f9ff,#ffffff);
    --card-bg: rgba(255,255,255,.86);
    --border: rgba(14,165,233,.18);
    --accent: #0ea5e9; --accent-weak:#38bdf8;
    --ink:#0f172a; --muted:#64748b;
    --meBg:#dff3ff; --themBg:#ffffff;
    --meText:#083344; --themText:#0f172a;
    --avatar-bg:#bae6fd;
    --shadow-soft: rgba(2,6,23,.08); --shadow-strong: rgba(2,132,199,.25);
    --header-h:58px;
  }
  :root[data-theme="cloud"]{
    --app-bg:
      radial-gradient(900px 500px at 15% -10%, rgba(255,255,255,.40), transparent 60%),
      radial-gradient(900px 600px at 85% 0%, rgba(186,230,253,.35), transparent 55%),
      radial-gradient(1200px 700px at 50% 120%, rgba(125,211,252,.20), transparent 60%),
      linear-gradient(180deg,#e0f2fe,#ffffff);
    --chat-bg: linear-gradient(180deg,#f0f9ff,#ffffff);
    --accent:#0ea5e9; --accent-weak:#38bdf8;
    --avatar-bg:#bae6fd;
    --meBg:#dff3ff; --meText:#083344;
    --themBg:#ffffff; --themText:#0f172a;
    --border: rgba(14,165,233,.18);
    --shadow-strong: rgba(2,132,199,.25);
  }
  :root[data-theme="fox"]{
    --app-bg:
      radial-gradient(900px 500px at 15% -10%, rgba(255,255,255,.45), transparent 60%),
      radial-gradient(900px 600px at 85% 0%, rgba(254,215,170,.35), transparent 55%),
      radial-gradient(1200px 700px at 50% 120%, rgba(253,186,116,.22), transparent 60%),
      linear-gradient(180deg,#fff5ec,#ffffff);
    --chat-bg: linear-gradient(180deg,#fff7ef,#ffffff);
    --accent:#f97316; --accent-weak:#fb923c;
    --avatar-bg:#fed7aa;
    --meBg:#ffe8d6; --meText:#4a2b13;
    --themBg:#ffffff; --themText:#1f2937;
    --border: rgba(244,114,33,.18);
    --shadow-strong: rgba(249,115,22,.25);
  }

  *{box-sizing:border-box}
  html,body{height:100%}
  body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,"Noto Sans KR",Arial;color:var(--ink);background:var(--app-bg);
    -webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}
  .wrap{max-width:740px;margin:0 auto;min-height:100%;padding:0 12px}
  .card{height:100dvh;height:100svh;background:var(--card-bg);backdrop-filter:blur(8px) saturate(110%);
    border:1px solid var(--border);border-radius:24px;box-shadow:0 16px 50px var(--shadow-soft), inset 0 0 0 1px rgba(255,255,255,.04);
    overflow:hidden;display:flex;flex-direction:column}
  .appbar{height:var(--header-h);display:flex;align-items:center;justify-content:space-between;padding:0 12px 0 16px;background:rgba(255,255,255,.92);border-bottom:1px solid var(--border)}
  .brand{display:flex;gap:10px;align-items:center}
  .cat{width:36px;height:36px;border-radius:999px;background:var(--avatar-bg);display:flex;align-items:center;justify-content:center;box-shadow:0 0 18px var(--accent-weak)}
  .title{font-weight:800;color:var(--accent)}
  .subtitle{font-size:12px;color:var(--muted);font-family:ui-serif, Georgia, serif}
  .right{display:flex;gap:8px;align-items:center}
  .status{display:flex;gap:6px;align-items:center;color:var(--accent);font-size:12px}
  .btn-flat{height:32px;padding:0 10px;border:1px solid var(--border);border-radius:10px;background:#fff;cursor:pointer}
  .btn-flat.active{border-color:var(--accent);box-shadow:0 0 0 2px rgba(14,165,233,.15) inset}
  .badge{background:var(--accent);color:#fff;border-radius:999px;padding:2px 8px;font-size:11px}

  .chat{flex:1;min-height:0;overflow:auto;background:var(--chat-bg);padding:14px 14px 110px 14px}
  .divider{display:flex;align-items:center;gap:8px;margin:8px 0}
  .divider .line{height:1px;background:var(--border);flex:1}
  .divider .txt{font-size:12px;color:var(--accent);font-family:ui-serif, Georgia, serif}
  .sys{color:var(--muted);font-size:13px;text-align:center;margin:8px 0}

  .msg{display:flex;gap:10px;margin:10px 0;align-items:flex-end}
  .msg.me{justify-content:flex-end}
  .avatar{width:32px;height:32px;border-radius:50%;background:var(--avatar-bg);display:flex;align-items:center;justify-content:center;font-size:18px}
  .msg.me .avatar{display:none}

  .stack{display:flex;flex-direction:column;max-width:60%}
  @media (max-width:480px){ .stack{max-width:80%} }

  .name{font-size:11px;color:var(--muted);margin:0 0 2px 4px}
  .msg.me .name{display:none}

  .content{display:flex;flex-direction:column;gap:4px}
  .text{display:inline-block;background:var(--themBg);color:var(--themText);line-height:1.24;word-break:break-word;padding:6px 10px;border-radius:12px;box-shadow:0 2px 8px var(--shadow-soft)}
  .msg.me .text{background:var(--meBg);color:var(--meText);box-shadow:0 4px 12px var(--shadow-strong)}
  .content img{display:block;max-width:320px;height:auto;border-radius:12px;cursor:zoom-in;box-shadow:0 12px 28px rgba(8,12,26,.18)}
  .att{font-size:12px}
  .att a{color:var(--accent);text-decoration:none;word-break:break-all}
  .att .size{color:var(--muted);margin-left:6px}

  .time{font-size:10px;color:#94a3b8;align-self:flex-end;min-width:34px;text-align:center;opacity:.9}
  .msg.me .time{margin-right:6px}
  .msg.them .time{margin-left:6px}
  .unread{font-size:10px;color:#94a3b8;align-self:flex-end;margin-left:6px;opacity:.95;display:none}

  .inputbar{position:fixed;left:0;right:0;bottom:0;margin:0 auto;max-width:740px;background:rgba(255,255,255,.94);backdrop-filter:blur(8px);border-top:1px solid var(--border);padding:10px}
  .inputrow{display:flex;gap:8px;align-items:center}
  .textinput{flex:1;border:1px solid var(--border);border-radius:14px;padding:12px 12px;font:inherit}
  .btn{height:40px;padding:0 14px;border:none;border-radius:12px;font-weight:700;cursor:pointer}
  .btn-emoji{background:#e2f2ff;color:#0c4a6e}
  .btn-attach{background:#e2e8f0;color:var(--ink)}
  .btn-send{background:var(--accent);color:#fff}
</style>
</head>
<body>
<div class="wrap">
  <div class="card">
    <div class="appbar">
      <div class="brand">
        <div class="cat" id="brandIcon">🐱</div>
        <div>
          <div class="title" id="brandTitle">Cloud Cat Chat</div>
          <div class="subtitle">테마 전환 · ${APP_VERSION}</div>
        </div>
      </div>
      <div class="right">
        <select id="themeSel" class="btn-flat">
          <option value="cloud">구름 고양이</option>
          <option value="fox">여우</option>
        </select>
        <button id="flashBtn"  class="btn-flat active" type="button" title="탭 깜빡임">⚡</button>
        <button id="notifyBtn" class="btn-flat"         type="button" title="데스크톱 알림">🔕</button>
        <button id="soundBtn"  class="btn-flat"         type="button" title="소리 알림">🔈</button>
        <span id="unseenBadge" class="badge" style="display:none">0</span>
        <div class="status"><span id="statusIcon">☁️</span><span id="online">offline</span></div>
      </div>
    </div>

    <div class="chat" id="chat">
      <div class="divider"><div class="line"></div><div class="txt">오늘</div><div class="line"></div></div>
    </div>

    <div class="inputbar" id="inputbar" style="display:none">
      <div class="inputrow">
        <input id="text" class="textinput" type="text" placeholder="메시지를 입력하세요" />
        <input id="file" type="file" style="display:none" accept="image/*,.pdf,.txt,.zip,.doc,.docx,.ppt,.pptx,.xls,.xlsx"/>
        <button id="attach" class="btn btn-attach" type="button">📎</button>
        <button id="emojiBtn" class="btn btn-emoji" type="button">😊</button>
        <button id="send" class="btn btn-send" type="button">보내기</button>
      </div>
      <div class="subtitle" style="margin-top:4px">Enter 전송 · 2MB 이하 첨부 지원</div>
    </div>

    <div id="setup" class="setup" style="padding:14px 14px 120px;background:var(--chat-bg)">
      <div class="panel" style="background:#fff;border:1px solid var(--border);border-radius:16px;padding:14px">
        <label class="label">대화방 코드</label>
        <input id="room" class="field" type="text" placeholder="예: myroom123" value="${room}" />
        <label class="label">닉네임</label>
        <input id="nick" class="field" type="text" placeholder="예: 민성" value="${nick}" />
        <label class="label">방 키 (선택)</label>
        <input id="key" class="field" type="password" placeholder="비밀번호" />
        <div class="row" style="display:flex;gap:8px;margin-top:12px">
          <button id="create" class="btn btn-send" type="button">입장</button>
          <button id="makeLink" class="btn btn-emoji" type="button">초대 링크</button>
        </div>
        <div class="subtitle" id="status" style="margin-top:6px">대기</div>
        <div class="link" style="font-size:12px;color:var(--accent);margin-top:6px">Invite link: <span id="invite"></span></div>
      </div>
    </div>
  </div>
</div>

<script src="/socket.io/socket.io.js?v=${APP_VERSION}"></script>
<script>
  var $ = function(s){ return document.querySelector(s); };
  var chatBox = $('#chat'), setup = $('#setup'), inputbar = $('#inputbar');

  // ==== Theme & Favicon ======================================================
  var THEME_KEY='chat_theme';
  var themeSel = $('#themeSel'), brandTitle = $('#brandTitle'), brandIcon = $('#brandIcon'), statusIcon = $('#statusIcon');
  var favLink = $('#favicon');
  var baseTitle = document.title;
  var favBaseEmoji = '🐱', favAlertEmoji = '🔔';
  var favBaseURL = '', favAlertURL = '';

  function drawFavicon(emoji){
    var c = document.createElement('canvas'); c.width = 64; c.height = 64;
    var ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0,0,64,64);
    ctx.font = '48px serif'; ctx.textAlign = 'center'; ctx.textBaseline='middle';
    ctx.fillText(emoji, 32, 40);
    return c.toDataURL('image/png');
  }
  function setFavicon(url){ if (favLink) { favLink.href = url; } }

  function applyTheme(t){
    document.documentElement.setAttribute('data-theme', t);
    localStorage.setItem(THEME_KEY, t);
    if (t === 'fox'){ brandTitle.textContent='Fox Chat'; brandIcon.textContent='🦊'; statusIcon.textContent='🔥'; favBaseEmoji='🦊'; }
    else { brandTitle.textContent='Cloud Cat Chat'; brandIcon.textContent='🐱'; statusIcon.textContent='☁️'; favBaseEmoji='🐱'; }
    favBaseURL = drawFavicon(favBaseEmoji);
    favAlertURL = drawFavicon(favAlertEmoji);
    setFavicon(favBaseURL);
  }
  var savedTheme = localStorage.getItem(THEME_KEY) || 'cloud';
  themeSel.value = savedTheme; applyTheme(savedTheme);
  themeSel.onchange = function(){ applyTheme(themeSel.value); };
  function peerEmoji(){ return (document.documentElement.getAttribute('data-theme') === 'fox') ? '🦊' : '🐾'; }

  // ==== State & helpers ======================================================
  var roomInput = $('#room'), nickInput = $('#nick'), keyInput = $('#key');
  var invite = $('#invite'), statusTag = $('#status'), online = $('#online');
  var fileInput = $('#file'), textInput = $('#text');

  function setInviteLink(r){
    var url = new URL(window.location); url.searchParams.set('room', r);
    invite.textContent = url.toString();
  }
  $('#makeLink').onclick = function(){
    var r = (roomInput.value||'').trim();
    if(!r){ alert('방 코드를 입력하세요'); return; }
    setInviteLink(r);
  };

  function addSys(msg){
    var d = document.createElement('div'); d.className='sys'; d.textContent = msg;
    chatBox.appendChild(d); chatBox.scrollTop = chatBox.scrollHeight;
  }
  function fmt(ts){ var d=new Date(ts); var h=String(d.getHours()).padStart(2,'0'); var m=String(d.getMinutes()).padStart(2,'0'); return h+':'+m; }
  function esc(s){ return (s||'').toString().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function genId(){ return 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2,6); }

  // ==== Attention/visibility =================================================
  var hasFocus = document.hasFocus();
  var visible = document.visibilityState === 'visible';
  function isAttended(){ return hasFocus && visible; }
  window.addEventListener('focus', function(){ hasFocus = true; clearUnseen(); rescanUnread(); stopFlash(); setFavicon(favBaseURL); });
  window.addEventListener('blur', function(){ hasFocus = false; });
  document.addEventListener('visibilitychange', function(){
    visible = document.visibilityState === 'visible';
    if (visible) { clearUnseen(); rescanUnread(); stopFlash(); setFavicon(favBaseURL); }
  });

  // ==== Notification toggles =================================================
  var LS = { flash:'flash_on', notify:'notify_on', sound:'sound_on' };
  var flashEnabled  = (localStorage.getItem(LS.flash)  ?? '1') === '1';   // 기본 켜짐
  var notifyEnabled = (localStorage.getItem(LS.notify) ?? '0') === '1';
  var soundEnabled  = (localStorage.getItem(LS.sound)  ?? '0') === '1';

  var flashBtn = $('#flashBtn'), notifyBtn = $('#notifyBtn'), soundBtn = $('#soundBtn');
  function updateToggleUI(){
    flashBtn.classList.toggle('active', flashEnabled);
    notifyBtn.classList.toggle('active', notifyEnabled);
    soundBtn.classList.toggle('active', soundEnabled);
    notifyBtn.textContent = notifyEnabled ? '🔔' : '🔕';
    soundBtn.textContent  = soundEnabled ? '🔊' : '🔈';
  }
  updateToggleUI();

  flashBtn.onclick = function(){
    flashEnabled = !flashEnabled; localStorage.setItem(LS.flash, flashEnabled ? '1':'0'); updateToggleUI();
    if (!flashEnabled) { stopFlash(); setFavicon(favBaseURL); }
  };
  notifyBtn.onclick = function(){
    if (!('Notification' in window)) { alert('이 브라우저는 데스크톱 알림을 지원하지 않습니다.'); return; }
    if (Notification.permission === 'granted') {
      notifyEnabled = !notifyEnabled; localStorage.setItem(LS.notify, notifyEnabled ? '1':'0'); updateToggleUI();
    } else {
      Notification.requestPermission().then(function(p){
        notifyEnabled = (p === 'granted'); localStorage.setItem(LS.notify, notifyEnabled ? '1':'0'); updateToggleUI();
      });
    }
  };
  soundBtn.onclick = function(){
    soundEnabled = !soundEnabled; localStorage.setItem(LS.sound, soundEnabled ? '1':'0'); updateToggleUI();
  };

  // ==== Beep (소리 토글에 묶음) ==============================================
  var audioCtx = null, audioUnlocked = false;
  function unlockAudioOnce(){
    if (audioUnlocked) return;
    try{
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      var o = audioCtx.createOscillator(), g = audioCtx.createGain();
      g.gain.value = 0; o.connect(g); g.connect(audioCtx.destination);
      o.start(); setTimeout(function(){ try{o.stop();}catch(e){} }, 30);
      audioUnlocked = true;
    }catch(e){}
  }
  document.addEventListener('click', unlockAudioOnce, { once:true });
  document.addEventListener('keydown', unlockAudioOnce, { once:true });
  function beep(){
    if (!soundEnabled) return;             // ← 소리 토글 적용
    if (!audioCtx) { try{ audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }catch(e){ return; } }
    var o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = 'triangle'; o.frequency.value = 880;
    g.gain.setValueAtTime(0, audioCtx.currentTime);
    g.gain.linearRampToValueAtTime(0.03, audioCtx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.2);
    o.connect(g); g.connect(audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + 0.22);
  }

  // ==== Unseen + Tab flash (title + favicon) =================================
  var unseenBadge = $('#unseenBadge');
  var unseenTotal = 0;
  var titleFlasher = null, flashOn = false;

  function startFlash(){
    if (!flashEnabled) return;         // 토글 꺼져 있으면 안 깜빡임
    if (titleFlasher) return;
    titleFlasher = setInterval(function(){
      flashOn = !flashOn;
      document.title = flashOn ? '🔔 ' + unseenTotal + ' 새 메시지' : baseTitle;
      setFavicon(flashOn ? favAlertURL : favBaseURL);
    }, 900);
  }
  function stopFlash(){
    if (titleFlasher){ clearInterval(titleFlasher); titleFlasher = null; }
    document.title = baseTitle;
  }
  function bumpUnseen(){
    unseenTotal++;
    unseenBadge.textContent = String(unseenTotal);
    unseenBadge.style.display = 'inline-block';
    startFlash();              // 플래시 토글이 꺼져 있으면 내부에서 패스
    if (soundEnabled) beep();  // 소리 토글 반영
  }
  function clearUnseen(){
    unseenTotal = 0;
    unseenBadge.style.display = 'none';
    stopFlash(); setFavicon(favBaseURL);
  }

  function showDesktopNote(title, body){
    if (!notifyEnabled || !('Notification' in window) || Notification.permission !== 'granted') return;
    try{
      var n = new Notification(title, { body: body, tag: 'room-'+(window.myRoom||'') });
      n.onclick = function(){ window.focus(); n.close(); };
      setTimeout(function(){ try{ n.close(); } catch(e){} }, 5000);
    }catch(e){}
  }

  function onIncoming(kind, payload){
    if (isAttended()) return;  // 창을 보고 있으면 알림 안 띄움
    if (kind === 'msg'){
      var icon = document.documentElement.getAttribute('data-theme') === 'fox' ? '🦊' : '🐱';
      showDesktopNote(icon + ' 새 메시지', (payload.nick||'상대') + ': ' + String(payload.text||'').slice(0,80));
    } else if (kind === 'file'){
      var icon2 = document.documentElement.getAttribute('data-theme') === 'fox' ? '🦊' : '🐱';
      var name = payload.name || '파일';
      showDesktopNote(icon2 + ' 파일 도착', (payload.nick||'상대') + '님이 ' + name + '을 보냈습니다');
    }
    bumpUnseen();
  }

  // ==== Read tracking ========================================================
  var readSent = new Set();
  function sendRead(id){
    if (!window.socket || readSent.has(id)) return;
    readSent.add(id);
    window.socket.emit('read', { room: myRoom, id: id });
  }
  var OBS_THRESHOLD = 0.75;
  var observer = new IntersectionObserver(function(entries){
    if (!isAttended()) return;
    entries.forEach(function(e){
      if (e.intersectionRatio >= OBS_THRESHOLD) {
        var id = e.target.getAttribute('data-mid');
        if (id && !readSent.has(id)) sendRead(id);
      }
    });
  }, { root: chatBox, threshold: [OBS_THRESHOLD] });
  function rescanUnread(){
    if (!isAttended()) return;
    document.querySelectorAll('.msg.them[data-mid]').forEach(function(el){
      var id = el.getAttribute('data-mid');
      if (!id || readSent.has(id)) return;
      observer.observe(el);
    });
  }

  // ==== Typing indicator =====================================================
  var typingFlag = document.createElement('div');
  typingFlag.className = 'typing-flag';
  typingFlag.style.cssText = 'position:sticky;bottom:8px;left:0;display:none;align-items:center;gap:8px;background:#fff;border:1px solid rgba(14,165,233,.22);padding:6px 10px;border-radius:12px;color:#0f172a;font-size:12px;box-shadow:0 8px 24px rgba(2,6,23,.08);max-width:70%';
  typingFlag.innerHTML = '<span class="who" style="color:var(--accent);font-weight:600"></span> 입력 중 <span class="dots"><i></i><i></i><i></i></span>';
  var typingWho = typingFlag.querySelector('.who');
  var typingHideTimer = null;
  function showTyping(name){
    typingWho.textContent = name || '상대';
    typingFlag.style.display = 'inline-flex';
    chatBox.appendChild(typingFlag);
    clearTimeout(typingHideTimer);
    typingHideTimer = setTimeout(hideTyping, 1500);
  }
  function hideTyping(){ typingFlag.style.display = 'none'; }

  // ==== Renderers ============================================================
  function makeStack(){ var s = document.createElement('div'); s.className = 'stack'; return s; }
  function addMsg(fromMe, name, text, ts, id){
    var row = document.createElement('div'); row.className = 'msg ' + (fromMe? 'me':'them');
    if(id) row.setAttribute('data-mid', id);

    if(!fromMe){
      var av = document.createElement('div'); av.className='avatar'; av.textContent = peerEmoji();
      row.appendChild(av);
    } else {
      var t = document.createElement('span'); t.className='time'; t.textContent = fmt(ts||Date.now()); row.appendChild(t);
    }

    var stack = makeStack();
    if(!fromMe){
      var nm = document.createElement('div'); nm.className='name'; nm.textContent = name || '상대';
      stack.appendChild(nm);
    }
    var content = document.createElement('div'); content.className='content';
    var p = document.createElement('div'); p.className='text'; p.textContent = text; content.appendChild(p);
    stack.appendChild(content);
    row.appendChild(stack);

    if(fromMe){
      var badge = document.createElement('span'); badge.className='unread'; badge.textContent=''; row.appendChild(badge);
    } else {
      var t2 = document.createElement('span'); t2.className='time'; t2.textContent = fmt(ts||Date.now()); row.appendChild(t2);
    }

    chatBox.appendChild(row); chatBox.scrollTop = chatBox.scrollHeight;
    chatBox.appendChild(typingFlag);
    if(!fromMe && id){ observer.observe(row); if(isAttended()) rescanUnread(); }
  }

  function humanSize(b){ if(b<1024) return b+' B'; if(b<1024*1024) return (b/1024).toFixed(1)+' KB'; return (b/1024/1024).toFixed(2)+' MB'; }
  function addFile(fromMe, name, file, id){
    var row = document.createElement('div'); row.className = 'msg ' + (fromMe? 'me':'them');
    if(id) row.setAttribute('data-mid', id);

    if(!fromMe){
      var av = document.createElement('div'); av.className='avatar'; av.textContent = peerEmoji();
      row.appendChild(av);
    } else {
      var t = document.createElement('span'); t.className='time'; t.textContent = fmt(file.ts||Date.now()); row.appendChild(t);
    }

    var stack = makeStack();
    if(!fromMe){
      var nm = document.createElement('div'); nm.className='name'; nm.textContent = name || '상대';
      stack.appendChild(nm);
    }

    var content = document.createElement('div'); content.className='content';
    if ((file.type||'').startsWith('image/')) {
      var img = document.createElement('img'); img.src = file.data; img.alt = file.name || 'image';
      img.addEventListener('click', function(){ openViewer(img.src, img.alt); });
      content.appendChild(img);
      var meta = document.createElement('div'); meta.className='att';
      meta.innerHTML = '<a href="' + file.data + '" download="' + esc(file.name||'image') + '">이미지 저장</a><span class="size"> ' + humanSize(file.size||0) + '</span>';
      content.appendChild(meta);
    } else {
      var meta2 = document.createElement('div'); meta2.className='att';
      meta2.innerHTML = '파일: <a href="' + file.data + '" download="' + esc(file.name||'file') + '">' + esc(file.name||'file') + '</a><span class="size"> ' + humanSize(file.size||0) + '</span>';
      content.appendChild(meta2);
    }
    stack.appendChild(content);
    row.appendChild(stack);

    if(fromMe){
      var badge = document.createElement('span'); badge.className='unread'; badge.textContent=''; row.appendChild(badge);
    } else {
      var t2 = document.createElement('span'); t2.className='time'; t2.textContent = fmt(file.ts||Date.now()); row.appendChild(t2);
    }

    chatBox.appendChild(row); chatBox.scrollTop = chatBox.scrollHeight;
    chatBox.appendChild(typingFlag);
    if(!fromMe && id){ observer.observe(row); if(isAttended()) rescanUnread(); }
  }

  // 라이트박스
  var viewer = document.createElement('div');
  viewer.id='viewer'; viewer.className='viewer';
  viewer.style.cssText='position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:rgba(2,6,23,.7);z-index:50';
  viewer.innerHTML = '<div class="close" id="viewerClose" title="닫기" style="position:absolute;top:16px;right:20px;font-size:26px;color:#e5e7eb;cursor:pointer">✕</div><div class="box" style="max-width:92vw;max-height:92vh;border-radius:12px;overflow:hidden;background:#000"><img id="viewerImg" alt=""></div>';
  document.body.appendChild(viewer);
  var viewerImg = $('#viewerImg'), viewerClose = $('#viewerClose');
  function openViewer(src, alt){ viewerImg.src = src; viewerImg.alt = alt || ''; viewer.style.display='flex'; }
  function closeViewer(){ viewer.style.display='none'; viewerImg.src=''; }
  viewer.addEventListener('click', function(e){ if(e.target===viewer) closeViewer(); });
  viewerClose.addEventListener('click', closeViewer);
  window.addEventListener('keydown', function(e){ if(e.key==='Escape') closeViewer(); });

  // ==== Emoji 최소 구현(입력창 삽입) =========================================
  var emojiBtn = $('#emojiBtn');
  emojiBtn.onclick = function(){
    var em = ['😀','😆','😊','😉','😍','😘','😎','🤗','🤔','😴','😇','🥳','😭','😡','👍','👏','🙏','💪','🔥','✨'];
    var s = prompt('이모지 선택: ' + em.join(' '));
    if (s) {
      var pos = textInput.selectionStart || textInput.value.length;
      textInput.value = textInput.value.slice(0,pos) + s + textInput.value.slice(pos);
      textInput.focus(); textInput.setSelectionRange(pos+s.length, pos+s.length);
    }
  };

  // ==== Socket / Join / Keep-alive ==========================================
  var socket; var myNick; var myRoom; var myKey=''; var joined=false; var typingTimerSend; var typingActive=false; var lastTypingSent=0; var joinGuard;
  var composing = false; var keepAliveTimer = null;

  function enableCreate(){ var b=$('#create'); if(b) b.disabled=false; }
  function disableCreate(){ var b=$('#create'); if(b) b.disabled=true; }

  $('#create').onclick = function(){
    if (socket) return; disableCreate();
    var r = (roomInput.value || '').trim();
    var n = (nickInput.value || '').trim();
    var k = (keyInput.value || '').trim();
    if(!r || !n){ alert('방 코드와 닉네임을 입력하세요'); enableCreate(); return; }
    myNick = n; myRoom = r; myKey = k;

    socket = io({
      path:'/socket.io',
      transports:['websocket','polling'],
      forceNew:true,
      reconnection:true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 15000
    });
    joinGuard = setTimeout(function(){ if(!joined){ enableCreate(); addSys('서버 응답 지연. 다시 시도하세요.'); } }, 16000);

    socket.on('connect', function(){
      online.textContent='online';
      if (joined && myRoom && myNick) socket.emit('join', { room: myRoom, nick: myNick, key: myKey || '' });
    });
    socket.on('reconnect', function(){
      if (myRoom && myNick) socket.emit('join', { room: myRoom, nick: myNick, key: myKey || '' });
    });
    socket.on('connect_error', function(err){ addSys('연결 실패: ' + (err && err.message ? err.message : err)); enableCreate(); });

    // 최초 조인
    socket.emit('join', { room: r, nick: n, key: k });

    socket.on('joined', function(info){
      joined = true; clearTimeout(joinGuard);
      window.socket = socket; window.myRoom = myRoom; window.myNick = myNick;
      setInviteLink(myRoom);
      setup.style.display='none'; inputbar.style.display='block';
      addSys(info.msg);
      history.replaceState(null, '', '?room='+encodeURIComponent(myRoom)+'&nick='+encodeURIComponent(myNick));
      rescanUnread();
      if (keepAliveTimer) clearInterval(keepAliveTimer);
      keepAliveTimer = setInterval(function(){ if (socket && socket.connected) socket.emit('ka', Date.now()); }, 10_000);
    });

    socket.on('disconnect', function(reason){
      online.textContent='offline';
      if (keepAliveTimer) { clearInterval(keepAliveTimer); keepAliveTimer = null; }
      addSys('연결이 끊어졌습니다: ' + reason + ' (자동 재연결 시도)');
      enableCreate();
    });

    socket.on('join_error', function(err){
      clearTimeout(joinGuard);
      addSys('입장 실패: ' + err); alert('입장 실패: ' + err); enableCreate();
    });

    socket.on('peer_joined', function(name){ addSys(name + ' 님이 입장했습니다'); });
    socket.on('peer_left', function(name){ addSys(name + ' 님이 퇴장했습니다'); });

    socket.on('msg', function(p){
      addMsg(false, p.nick, p.text, p.ts, p.id);
      if (p.id && isAttended()) sendRead(p.id);
      onIncoming('msg', p);
    });
    socket.on('file', function(p){
      addFile(false, p.nick, { name: p.name, type: p.type, size: p.size, data: p.data, ts: p.ts }, p.id);
      if (p.id && isAttended()) sendRead(p.id);
      onIncoming('file', p);
    });

    socket.on('unread', function(u){
      var row = document.querySelector('.msg.me[data-mid="'+u.id+'"]');
      if (!row) return;
      var badge = row.querySelector('.unread');
      if (!badge) return;
      if (u.count > 0){ badge.textContent = String(u.count); badge.style.display = 'inline'; }
      else { badge.remove(); }
    });

    socket.on('typing', function(p){ if (p && p.state){ showTyping(p.nick || '상대'); } else { hideTyping(); } });
    socket.on('ka', function(){});
  };

  // 입력/타이핑/엔터
  $('#send').onclick = sendMsg;
  textInput.addEventListener('compositionstart', function(){ composing = true; });
  textInput.addEventListener('compositionend', function(){ composing = false; });
  textInput.addEventListener('keydown', function(e){
    if ((e.key === 'Enter' || e.key === 'NumpadEnter') && !e.shiftKey) {
      if (!composing) { e.preventDefault(); sendMsg(); return; }
    }
    handleTyping();
  });
  textInput.addEventListener('input', handleTyping);
  textInput.addEventListener('blur', function(){ if(window.socket){ window.socket.emit('typing', { room: myRoom, state: 0 }); typingActive=false; } });
  function handleTyping(){
    if(!window.socket || !joined) return;
    var n = Date.now();
    if(!typingActive || n - lastTypingSent > 1000){
      window.socket.emit('typing', { room: myRoom, state: 1 });
      typingActive = true; lastTypingSent = n;
    }
    clearTimeout(typingTimerSend);
    typingTimerSend = setTimeout(function(){ if(window.socket){ window.socket.emit('typing', { room: myRoom, state: 0 }); typingActive=false; } }, 1500);
  }

  // 파일 전송
  $('#attach').onclick = function(){ fileInput.click(); };
  fileInput.onchange = function(){ var files = Array.from(fileInput.files||[]); files.forEach(function(f){ sendFile(f); }); fileInput.value = ''; };
  document.addEventListener('paste', function(e){
    if(!joined) return;
    var items = e.clipboardData && e.clipboardData.items ? Array.from(e.clipboardData.items) : [];
    items.forEach(function(it){ if (it.kind === 'file') { var f = it.getAsFile(); if (f) sendFile(f); } });
  });

  function sendMsg(){
    if(!window.socket){ addSys('연결되지 않음'); return; }
    var val = (textInput.value || '').trim(); if(!val) return;
    var id = genId();
    window.socket.emit('msg', { room: myRoom, id: id, text: val });
    addMsg(true, myNick, val, Date.now(), id);
    textInput.value = '';
    if(typingActive){ window.socket.emit('typing', { room: myRoom, state: 0 }); typingActive=false; }
    clearUnseen(); // 내가 보고 있을 때는 뱃지/플래시 초기화
  }

  var ALLOWED_TYPES = ['image/png','image/jpeg','image/webp','image/gif','application/pdf','text/plain','application/zip','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/msword','application/vnd.openxmlformats-officedocument.presentationml.presentation','application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-excel'];
  var MAX_BYTES = 2_000_000;

  function sendFile(file){
    if (!file) return;
    if (file.size > MAX_BYTES) { addSys('파일이 너무 큽니다(최대 2MB).'); return; }
    if (ALLOWED_TYPES.indexOf(file.type) === -1 && !(file.type||'').startsWith('image/')) { addSys('허용되지 않은 파일 형식입니다.'); return; }
    var reader = new FileReader();
    reader.onload = function(){
      var dataUrl = reader.result;
      var id = genId();
      addFile(true, myNick, { name: file.name, type: file.type, size: file.size, data: dataUrl, ts: Date.now() }, id);
      window.socket.emit('file', { room: myRoom, id: id, name: file.name, type: file.type, size: file.size, data: dataUrl });
    };
    reader.readAsDataURL(file);
  }

  chatBox.addEventListener('scroll', function(){ if (isAttended()) rescanUnread(); });

  // Prefill
  var url = new URL(window.location);
  var r = url.searchParams.get('room');
  var n = url.searchParams.get('nick');
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
    // 키: 첫 입장자는 설정, 이후는 검증
    if (r.users.size === 0) {
      if (key) r.key = key;
    } else {
      if (r.key && key !== r.key) return socket.emit('join_error', '방 키가 일치하지 않습니다');
      if (!r.key && key) return socket.emit('join_error', '이미 만들어진 방에는 키를 새로 설정할 수 없어요');
    }

    socket.data.nick = nick;
    socket.data.room = room;

    socket.join(room);
    r.users.add(socket.id);

    socket.emit('joined', { msg: nick + ' 님, ' + room + ' 방에 입장했습니다' + (r.key ? ' (키 적용됨)' : '') });
    socket.to(room).emit('peer_joined', nick);
  });

  // 텍스트
  socket.on('msg', ({ room, id, text }) => {
    room = sanitize(room, 40);
    id = sanitize(id, 64);
    const r = rooms.get(room);
    if (!r) return;
    const nick = sanitize(socket.data.nick, 24) || '게스트';
    text = sanitize(text, 2000);
    if (isThrottled(r, socket.id)) return socket.emit('info', '메시지가 너무 빠릅니다. 잠시 후 다시 시도하세요.');

    r.lastMsgs.push({ t: now(), from: socket.id });

    const recipients = Array.from(r.users).filter(sid => sid !== socket.id);
    r.unread.set(id, new Set(recipients));

    socket.to(room).emit('msg', { id, nick, text, ts: now() });
    io.to(room).emit('unread', { id, count: recipients.length });
  });

  // 파일
  const ALLOWED_TYPES = new Set(['image/png','image/jpeg','image/webp','image/gif','application/pdf','text/plain','application/zip','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/msword','application/vnd.openxmlformats-officedocument.presentationml.presentation','application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-excel']);
  const MAX_BYTES = 2_000_000;
  const MAX_DATAURL = 7_000_000;
  socket.on('file', ({ room, id, name, type, size, data }) => {
    room = sanitize(room, 40);
    id = sanitize(id, 64);
    const r = rooms.get(room);
    if (!r) return;
    const nick = sanitize(socket.data.nick, 24) || '게스트';
    name = sanitize(name, 140);
    type = sanitize(type, 100);
    size = Number(size) || 0;

    if (size > MAX_BYTES) return socket.emit('info', '파일이 너무 큽니다(최대 2MB).');
    if (!(ALLOWED_TYPES.has(type) || (type||'').startsWith('image/'))) return socket.emit('info', '허용되지 않은 파일 형식입니다.');
    if (typeof data !== 'string' || data.slice(0,5) !== 'data:' || data.length > MAX_DATAURL) return socket.emit('info', '파일 데이터가 올바르지 않습니다.');
    if (isThrottled(r, socket.id, 5, 15_000)) return socket.emit('info', '전송이 너무 빠릅니다. 잠시 후 다시 시도하세요.');

    const recipients = Array.from(r.users).filter(sid => sid !== socket.id);
    r.unread.set(id, new Set(recipients));

    socket.to(room).emit('file', { id, nick, name, type, size, data, ts: now() });
    io.to(room).emit('unread', { id, count: recipients.length });
  });

  // 읽음
  socket.on('read', ({ room, id }) => {
    room = sanitize(room, 40);
    id = sanitize(id, 64);
    if (!room || !id) return;
    const r = rooms.get(room);
    if (!r) return;
    const set = r.unread.get(id);
    if (!set) return;
    if (set.delete(socket.id)) {
      const count = set.size;
      io.to(room).emit('unread', { id, count });
      if (count === 0) r.unread.delete(id);
    }
  });

  // 타이핑
  socket.on('typing', ({ room, state }) => {
    room = sanitize(room, 40);
    const nick = sanitize(socket.data.nick, 24) || '게스트';
    socket.to(room).emit('typing', { nick, state: !!state });
  });

  // keep-alive echo
  socket.on('ka', () => { socket.emit('ka', Date.now()); });

  socket.on('disconnect', (reason) => {
    const room = socket.data.room;
    const nick = socket.data.nick;
    if (room && rooms.has(room)) {
      const r = rooms.get(room);
      for (const [mid, set] of r.unread.entries()) {
        if (set.delete(socket.id)) {
          const count = set.size;
          io.to(room).emit('unread', { id: mid, count });
          if (count === 0) r.unread.delete(mid);
        }
      }
      r.users.delete(socket.id);
      socket.to(room).emit('peer_left', nick || '게스트');
      if (r.users.size === 0) rooms.delete(room);
    }
    console.log('disconnect', reason);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('multi-user chat running on http://localhost:' + PORT);
});
