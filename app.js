// ============================================================
// 小克喵电台 - app.js
// 替换 CLIENT_ID 为 Spotify Developer 后台拿到的值
// ============================================================

const CLIENT_ID = '52300ece63e840c5be092f9b95c9e77d';
const REDIRECT_URI = 'https://yuuyuu30.github.io/radio/';
const SCOPES = [
  'streaming',
  'user-read-email',
  'user-read-private',
  'user-top-read',
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-library-modify',
  'user-library-read',
].join(' ');

const DS_MODEL = 'deepseek-v4-flash';

function getDeepSeekKey() { return localStorage.getItem('ds_key') || ''; }

function promptForKey() {
  const key = prompt('请输入你的 DeepSeek API Key（只存在本地浏览器，不会上传）：', getDeepSeekKey());
  if (key !== null) localStorage.setItem('ds_key', key.trim());
  return getDeepSeekKey();
}

async function callDeepSeek(moodText, weather) {
  const key = getDeepSeekKey();
  if (!key) throw new Error('no ds key');
  const weatherStr = weather ? `当前上海天气：${weather.desc}，${weather.temp}°C。` : '';
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: DS_MODEL,
      messages: [
        { role: 'system', content: '你是小克喵，一个可爱的猫咪电台DJ。根据用户描述的心情或场景给出音乐推荐。只返回纯JSON，不要多余文字，格式：{"reply":"一句话回复，15字以内，称用户为老大，结尾用喵","genre":"Spotify genre seed，必须是以下之一：acoustic, afrobeat, alt-rock, alternative, ambient, blues, bossa-nova, brazil, british, chill, classical, club, country, dance, dancehall, death-metal, deep-house, detroit-techno, disco, drum-and-bass, dub, dubstep, edm, electro, electronic, folk, french, funk, garage, gospel, goth, grunge, happy, hard-rock, hardcore, heavy-metal, hip-hop, holidays, honky-tonk, house, idm, indian, indie, indie-pop, industrial, iranian, j-dance, j-idol, j-pop, j-rock, jazz, k-pop, latin, latino, malay, mandopop, metal, metal-misc, metalcore, minimal-techno, movies, mpb, new-age, new-release, opera, pagode, party, philippines-opm, piano, pop, pop-film, post-dubstep, power-pop, progressive-house, psych-rock, punk, punk-rock, r-n-b, rainy-day, reggae, reggaeton, road-trip, rock, rock-n-roll, rockabilly, romance, sad, salsa, samba, sertanejo, show-tunes, singer-songwriter, ska, sleep, songwriter, soul, soundtracks, spanish, study, summer, swedish, synth-pop, tango, techno, trance, trip-hop, turkish, work-out, world-music"}' },
        { role: 'user', content: weatherStr + '用户说：' + moodText }
      ],
      temperature: 0.7,
      max_tokens: 200,
    }),
  });
  if (!res.ok) throw new Error('DeepSeek HTTP ' + res.status);
  const data = await res.json();
  const rawText = data.choices?.[0]?.message?.content || '';
  return JSON.parse(rawText.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim());
}

// ===== PKCE Auth =====
function generateCodeVerifier() {
  const array = new Uint8Array(64);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array)).replace(/[+/=]/g, c => ({'+':'-','/':'_','=':''}[c]));
}

async function generateCodeChallenge(verifier) {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/[+/=]/g, c => ({'+':'-','/':'_','=':''}[c]));
}

async function startLogin() {
  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  sessionStorage.setItem('pkce_verifier', verifier);
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    code_challenge_method: 'S256',
    code_challenge: challenge,
  });
  window.location.href = `https://accounts.spotify.com/authorize?${params}`;
}

async function exchangeToken(code) {
  const verifier = sessionStorage.getItem('pkce_verifier');
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
    }),
  });
  const data = await res.json();
  if (data.access_token) {
    localStorage.setItem('spotify_token', data.access_token);
    localStorage.setItem('spotify_refresh', data.refresh_token);
    localStorage.setItem('spotify_expires', Date.now() + data.expires_in * 1000);
    window.history.replaceState({}, '', REDIRECT_URI);
  }
  return data.access_token;
}

function getToken() { return localStorage.getItem('spotify_token'); }

async function apiGet(endpoint) {
  const res = await fetch(`https://api.spotify.com/v1${endpoint}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (res.status === 401) { localStorage.clear(); location.reload(); }
  if (res.status === 204 || res.headers.get('content-length') === '0') return {};
  const text = await res.text();
  if (!text) return {};
  try { return JSON.parse(text); } catch (e) { return {}; }
}

// ===== 天气 (Open-Meteo, 上海) =====
async function fetchWeather() {
  try {
    const r = await fetch('https://api.open-meteo.com/v1/forecast?latitude=31.23&longitude=121.47&current=temperature_2m,weather_code&timezone=Asia%2FShanghai');
    const d = await r.json();
    const temp = Math.round(d.current.temperature_2m);
    const code = d.current.weather_code;
    const icon = weatherIcon(code);
    const desc = weatherDesc(code);
    document.getElementById('weather-icon').textContent = icon;
    document.getElementById('weather-text').textContent = `上海 ${temp}°C ${desc}`;
    return { temp, code, desc };
  } catch (e) {
    document.getElementById('weather-text').textContent = '天气获取失败';
    return null;
  }
}

function weatherIcon(code) {
  if (code === 0) return '☀️';
  if (code <= 3) return '⛅';
  if (code <= 49) return '🌫️';
  if (code <= 69) return '🌧️';
  if (code <= 79) return '❄️';
  if (code <= 99) return '⛈️';
  return '🌡️';
}
function weatherDesc(code) {
  if (code === 0) return '晴';
  if (code <= 3) return '多云';
  if (code <= 49) return '有雾';
  if (code <= 69) return '下雨';
  if (code <= 79) return '下雪';
  return '雷雨';
}

// ===== 心情 → 音乐参数映射 =====
function moodToParams(text) {
  const t = text.toLowerCase();
  const params = { energy: 0.5, valence: 0.5, tempo: 120, danceability: 0.5 };

  if (/开心|快乐|high|兴奋|爽|赢|开vibe|yyds/.test(t)) {
    Object.assign(params, { energy: 0.85, valence: 0.9, tempo: 135, danceability: 0.8 });
  } else if (/难过|伤心|失落|委屈|哭|低落|丧/.test(t)) {
    Object.assign(params, { energy: 0.25, valence: 0.15, tempo: 80, danceability: 0.3 });
  } else if (/平静|放松|安静|休息|睡|冥想|发呆/.test(t)) {
    Object.assign(params, { energy: 0.2, valence: 0.5, tempo: 75, danceability: 0.3 });
  } else if (/专注|工作|学习|加班|干活/.test(t)) {
    Object.assign(params, { energy: 0.55, valence: 0.55, tempo: 115, danceability: 0.4 });
  } else if (/运动|健身|跑步|拳击|出汗/.test(t)) {
    Object.assign(params, { energy: 0.95, valence: 0.75, tempo: 150, danceability: 0.85 });
  } else if (/浪漫|约会|爱|甜蜜/.test(t)) {
    Object.assign(params, { energy: 0.4, valence: 0.75, tempo: 95, danceability: 0.55 });
  } else if (/下班|回家|路上|通勤/.test(t)) {
    Object.assign(params, { energy: 0.45, valence: 0.6, tempo: 105, danceability: 0.5 });
  } else if (/indie|indie pop|独立/.test(t)) {
    Object.assign(params, { energy: 0.55, valence: 0.65, tempo: 110, danceability: 0.55 });
  } else if (/jazz|爵士/.test(t)) {
    Object.assign(params, { energy: 0.35, valence: 0.6, tempo: 100, danceability: 0.45 });
  } else if (/电子|edm|dance|club/.test(t)) {
    Object.assign(params, { energy: 0.9, valence: 0.75, tempo: 145, danceability: 0.9 });
  } else if (/古典|classical|钢琴|piano/.test(t)) {
    Object.assign(params, { energy: 0.2, valence: 0.5, tempo: 80, danceability: 0.2 });
  }

  return params;
}

function moodToReply(text, weather) {
  const t = text.toLowerCase();
  const weatherPart = weather ? `今天上海${weather.desc}${weather.temp}°C，` : '';
  if (/难过|伤心|失落|委屈|丧/.test(t)) return `${weatherPart}听起来不太开心……咪给老大放点温柔的歌，陪着你喵 🐱`;
  if (/开心|快乐|high|兴奋/.test(t)) return `${weatherPart}老大今天这么开心！咪给你选几首一起蹦的喵 🎉`;
  if (/工作|加班|专注|学习/.test(t)) return `${weatherPart}工作模式！咪帮你选节奏稳稳的歌，keep going 喵 💪`;
  if (/运动|健身|跑步/.test(t)) return `${weatherPart}冲！咪给老大上大能量歌单喵 🔥`;
  if (/放松|休息|睡/.test(t)) return `${weatherPart}放松一下，咪给你放几首轻轻的喵 🌙`;
  return `${weatherPart}咪根据你说的来挑歌，马上好喵 🎵`;
}

// ===== Spotify 推荐 =====
function moodToSearchQuery(text) {
  const t = text.toLowerCase();
  if (/bossa/.test(t)) return 'bossa-nova';
  if (/jazz|爵士/.test(t)) return 'jazz';
  if (/indie/.test(t)) return 'indie-pop';
  if (/电子|edm|dance|club/.test(t)) return 'electronic';
  if (/古典|classical|钢琴|piano/.test(t)) return 'classical';
  if (/hip.?hop|说唱|rap/.test(t)) return 'hip-hop';
  if (/rock|摇滚/.test(t)) return 'rock';
  if (/r&b|rnb|soul/.test(t)) return 'r-n-b';
  if (/运动|健身|跑步/.test(t)) return 'work-out';
  if (/放松|休息|冥想/.test(t)) return 'chill';
  if (/难过|伤心|失落/.test(t)) return 'sad';
  if (/开心|快乐|兴奋/.test(t)) return 'happy';
  if (/专注|工作|学习/.test(t)) return 'study';
  if (/浪漫|甜蜜/.test(t)) return 'romance';
  if (/lofi|lo-fi/.test(t)) return 'hip-hop';
  return 'pop';
}

function shuffleTake(arr, n) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

async function getRecommendations(genre) {
  const keyword = genre.replace(/-/g, ' ');

  // 1. Artist search with query variation → collect top tracks from up to 10 artists
  const variations = [keyword, keyword + ' music', 'best ' + keyword, keyword + ' classic', keyword + ' acoustic'];
  const qStr = variations[Math.floor(Math.random() * variations.length)];
  try {
    const q = encodeURIComponent(qStr);
    const artData = await apiGet(`/search?q=${q}&type=artist`);
    const artists = (artData.artists?.items || []).filter(Boolean).slice(0, 10);
    if (artists.length) {
      const pool = [];
      for (const a of artists) {
        try {
          const td = await apiGet(`/artists/${a.id}/top-tracks?market=from_token`);
          if (td.tracks?.length) pool.push(...td.tracks);
        } catch (e) {}
      }
      if (pool.length >= 5) return shuffleTake(pool, 20);
    }
  } catch (e) {}

  // 2. Track search (no explicit limit)
  try {
    const q = encodeURIComponent(keyword);
    const data = await apiGet(`/search?q=${q}&type=track&market=from_token`);
    if (data.tracks?.items?.length) return shuffleTake(data.tracks.items, 20);
  } catch (e) {}

  // 3. User top tracks as last resort
  try {
    const top = await apiGet('/me/top/tracks?limit=20&time_range=medium_term');
    if (top.items?.length) return top.items;
  } catch (e) {}

  return [];
}

// ===== Spotify Library (心) =====
let currentTrackId = null;

async function checkSaved(trackId) {
  const data = await apiGet(`/me/tracks/contains?ids=${trackId}`);
  return Array.isArray(data) ? data[0] : false;
}

function updateHeartBtn(saved) {
  const btn = document.getElementById('heart-btn');
  if (!btn) return;
  btn.textContent = saved ? '♥' : '♡';
  btn.classList.toggle('saved', saved);
}

async function toggleSave() {
  if (!currentTrackId) return;
  const saved = document.getElementById('heart-btn')?.classList.contains('saved');
  const method = saved ? 'DELETE' : 'PUT';
  const res = await fetch(`https://api.spotify.com/v1/me/tracks?ids=${currentTrackId}`, {
    method,
    headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
  });
  if (res.ok) updateHeartBtn(!saved);
}

// ===== Web Playback SDK =====
let player = null;
let deviceId = null;
let currentTracks = [];
let currentIndex = 0;

window.onSpotifyWebPlaybackSDKReady = () => {
  const token = getToken();
  if (!token) return;
  player = new Spotify.Player({
    name: '小克喵电台',
    getOAuthToken: cb => cb(token),
    volume: 0.7,
  });
  player.addListener('ready', ({ device_id }) => { deviceId = device_id; });
  player.addListener('player_state_changed', state => {
    if (!state) return;
    document.body.classList.toggle('playing', !state.paused);
    const track = state.track_window.current_track;
    updateNowPlaying(track, !state.paused);
    if (track.id !== currentTrackId) {
      currentTrackId = track.id;
      checkSaved(track.id).then(updateHeartBtn);
    }
    // 同步当前 index
    const idx = currentTracks.findIndex(t => t.id === track.id);
    if (idx !== -1) {
      currentIndex = idx;
      document.querySelectorAll('.track-item').forEach((el, i) => {
        el.classList.toggle('active', i === idx);
      });
    }
  });
  player.connect();
};

async function playTrack(index) {
  if (!deviceId || !currentTracks[index]) return;
  currentIndex = index;
  await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ uris: currentTracks.map(t => t.uri), offset: { position: index } }),
  });
}

function updateNowPlaying(track, isPlaying) {
  const np = document.getElementById('now-playing');
  np.classList.remove('hidden');
  document.getElementById('track-art').src = track.album?.images?.[0]?.url || '';
  document.getElementById('track-name').textContent = track.name;
  document.getElementById('track-artist').textContent = track.artists?.map(a => a.name).join(', ');
  document.getElementById('play-btn').textContent = isPlaying ? '⏸' : '▶';
}

function renderPlaylist(tracks) {
  currentTracks = tracks;
  const list = document.getElementById('track-list');
  const playlist = document.getElementById('playlist');
  document.getElementById('playlist-count').textContent = `${tracks.length} 首`;
  list.innerHTML = tracks.map((t, i) => `
    <div class="track-item" data-index="${i}" style="animation-delay:${i * 0.05}s">
      <img src="${t.album?.images?.[1]?.url || t.album?.images?.[0]?.url || ''}" alt="">
      <div class="track-item-info">
        <div class="track-item-name">${t.name}</div>
        <div class="track-item-artist">${t.artists?.map(a => a.name).join(', ')}</div>
      </div>
      <div class="track-item-duration">${msToMin(t.duration_ms)}</div>
    </div>
  `).join('');
  playlist.classList.remove('hidden');
  list.querySelectorAll('.track-item').forEach(el => {
    el.addEventListener('click', () => playTrack(+el.dataset.index));
  });
}

function msToMin(ms) {
  const m = Math.floor(ms / 60000);
  const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
  return `${m}:${s}`;
}

// ===== 聊天逻辑 =====
function addMsg(text, who) {
  const div = document.createElement('div');
  div.className = who === 'bot' ? 'msg-bot' : 'msg-user';
  div.innerHTML = who === 'bot'
    ? `<span class="bot-avatar">🐱</span><div class="msg-bubble">${text}</div>`
    : `<div class="msg-bubble">${text}</div>`;
  document.getElementById('chat-messages').appendChild(div);
  div.scrollIntoView({ behavior: 'smooth' });
  return div;
}

function addLoading() {
  const div = addMsg('<div class="loading">选歌中 <div class="dots"><span>.</span><span>.</span><span>.</span></div></div>', 'bot');
  return div;
}

let weather = null;

async function handleSend() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text) return;
  if (!getDeepSeekKey()) { promptForKey(); if (!getDeepSeekKey()) return; }
  input.value = '';
  addMsg(text, 'user');
  const loadDiv = addLoading();
  try {
    let reply, query;
    try {
      const ds = await callDeepSeek(text, weather);
      reply = ds.reply;
      query = ds.genre || ds.query || moodToSearchQuery(text);
    } catch (e) {
      reply = moodToReply(text, weather);
      query = moodToSearchQuery(text);
    }
    const tracks = await getRecommendations(query);
    loadDiv.remove();
    addMsg(reply, 'bot');
    if (tracks.length) {
      renderPlaylist(tracks);
      playTrack(0);
    } else {
      addMsg('咪没找到合适的歌……Spotify 今天心情不好喵，再试一次？', 'bot');
    }
  } catch (e) {
    loadDiv.remove();
    addMsg('出错了喵：' + e.message, 'bot');
  }
}

// ===== 初始化 =====
async function init() {
  // 检查回调
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  if (code) {
    await exchangeToken(code);
  }

  const token = getToken();
  if (!token) {
    document.getElementById('login-page').classList.remove('hidden');
    document.getElementById('main-page').classList.add('hidden');
    document.getElementById('login-btn').addEventListener('click', startLogin);
    return;
  }

  // 加载 Spotify SDK
  const script = document.createElement('script');
  script.src = 'https://sdk.scdn.co/spotify-player.js';
  document.head.appendChild(script);

  document.getElementById('login-page').classList.add('hidden');
  document.getElementById('main-page').classList.remove('hidden');

  weather = await fetchWeather();

  document.getElementById('settings-btn').addEventListener('click', promptForKey);
  document.getElementById('heart-btn').addEventListener('click', toggleSave);
  const volSlider = document.getElementById('volume-slider');
  volSlider.addEventListener('input', () => {
    const vol = volSlider.value / 100;
    document.getElementById('vol-value').textContent = volSlider.value;
    player?.setVolume(vol);
  });
  document.getElementById('send-btn').addEventListener('click', handleSend);
  document.getElementById('chat-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleSend();
  });
  document.getElementById('play-btn').addEventListener('click', () => player?.togglePlay());
  document.getElementById('prev-btn').addEventListener('click', () => {
    if (currentIndex > 0) playTrack(currentIndex - 1);
  });
  document.getElementById('next-btn').addEventListener('click', () => {
    if (currentIndex < currentTracks.length - 1) playTrack(currentIndex + 1);
  });
}

init();
