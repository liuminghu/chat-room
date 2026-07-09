// 钓鱼大师独立页面 - 黄金矿工式玩法
let socket = null;
let username = null;
let userId = null;
let currentRoomId = null;
let fsBackpack = { fishes: {}, totalCaught: 0 };

// 鱼类数据
const FISH_DATA = {
  junk: [
    { name: '破旧靴子', emoji: '👢', points: 1 },
    { name: '空酒瓶', emoji: '🍾', points: 1 },
    { name: '旧草帽', emoji: '👒', points: 2 },
    { name: '生锈硬币', emoji: '🪙', points: 2 }
  ],
  common: [
    { name: '小黄鱼', emoji: '🐟', points: 5 },
    { name: '热带鱼', emoji: '🐠', points: 6 },
    { name: '河豚', emoji: '🐡', points: 8 },
    { name: '鳗鱼', emoji: '🐍', points: 10 }
  ],
  rare: [
    { name: '金枪鱼', emoji: '🐟', points: 25 },
    { name: '神仙鱼', emoji: '🐠', points: 30 }
  ],
  epic: [
    { name: '小龙', emoji: '🐉', points: 80 },
    { name: '彩鳞鱼', emoji: '🐠', points: 90 },
    { name: '金鳞王', emoji: '🐟', points: 100 }
  ],
  legendary: [
    { name: '神龙', emoji: '🐲', points: 300 },
    { name: '美人鱼', emoji: '🧜', points: 350 },
    { name: '巨鲸', emoji: '🐋', points: 400 }
  ]
};

const FISH_RARITY = {
  junk: { name: '杂物', color: '#6B7280', chance: 0.10 },
  common: { name: '普通', color: '#9CA3AF', chance: 0.50 },
  rare: { name: '稀有', color: '#3B82F6', chance: 0.25 },
  epic: { name: '史诗', color: '#8B5CF6', chance: 0.12 },
  legendary: { name: '传说', color: '#F59E0B', chance: 0.03 }
};

// 工具函数
function getOrCreateUserId() {
  let id = localStorage.getItem('chat_user_id');
  if (!id) {
    id = 'u_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    localStorage.setItem('chat_user_id', id);
  }
  return id;
}

function showError(msg) {
  const el = document.getElementById('fsError');
  el.textContent = msg;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 3000);
}

// 初始化
function init() {
  // 读取登录态
  userId = getOrCreateUserId();
  username = localStorage.getItem('chat_username') || '游客';
  currentRoomId = localStorage.getItem('chat_room_id') || 'default';
  
  if (!username) {
    showError('请先到聊天室登录');
    setTimeout(() => { location.href = '/'; }, 2000);
    return;
  }
  
  // 连接 socket
  socket = io();
  
  socket.on('connect', () => {
    console.log('钓鱼页面已连接');
    socket.emit('join', { roomId: currentRoomId, username, userId });
    // 请求背包数据
    setTimeout(() => {
      socket.emit('getFishingBackpack', { roomId: currentRoomId });
    }, 500);
    // 隐藏加载提示
    setTimeout(() => {
      const loading = document.getElementById('fsLoading');
      if (loading) loading.style.display = 'none';
    }, 800);
    // 启动游戏
    startFishSwimming();
  });
  
  socket.on('connect_error', () => {
    showError('连接失败，请检查网络');
  });
  
  socket.on('fishCaught', (data) => {
    showFsFishCaughtResult(data);
  });
  
  socket.on('fishingBackpack', (data) => {
    if (data && data.backpack) {
      fsBackpack = data.backpack;
      document.getElementById('fsTotal').textContent = fsBackpack.totalCaught || 0;
    }
  });
  
  // 事件绑定
  document.getElementById('fsFishBtn').onclick = fsStartFishing;
  document.getElementById('fsBackBtn').onclick = () => { location.href = '/'; };
  document.getElementById('fsBackpackBtn').onclick = openBackpackModal;
  document.getElementById('fsBackpackCloseBtn').onclick = closeBackpackModal;
  document.querySelector('.fs-backpack-overlay').onclick = closeBackpackModal;
}

// 启动鱼/物品生成
function startFishSwimming() {
  const container = document.getElementById('fsFishContainer');
  if (!container) return;
  container.innerHTML = '';
  
  const fishConfig = [
    { rarity: 'junk', weight: 0.10 },
    { rarity: 'common', weight: 0.50 },
    { rarity: 'rare', weight: 0.25 },
    { rarity: 'epic', weight: 0.12 },
    { rarity: 'legendary', weight: 0.03 }
  ];
  
  function pickRarity() {
    const r = Math.random();
    let cumulative = 0;
    for (const cfg of fishConfig) {
      cumulative += cfg.weight;
      if (r < cumulative) return cfg.rarity;
    }
    return 'common';
  }
  
  const weightMap = {
    'junk': 0.3, 'common': 0.5, 'rare': 0.8, 'epic': 1.2, 'legendary': 1.8
  };
  
  const itemCount = 12;
  const placedPositions = [];
  
  for (let i = 0; i < itemCount; i++) {
    const rarity = pickRarity();
    const fishPool = FISH_DATA[rarity];
    const fishInfo = fishPool[Math.floor(Math.random() * fishPool.length)];
    
    const fish = document.createElement('div');
    fish.className = `fs-static-fish rarity-${rarity}`;
    fish.textContent = fishInfo.emoji;
    fish.dataset.rarity = rarity;
    fish.dataset.weight = weightMap[rarity];
    fish.dataset.name = fishInfo.name;
    fish.dataset.points = fishInfo.points;
    
    let x, y, attempts = 0;
    do {
      x = 5 + Math.random() * 90;
      y = 5 + Math.random() * 90;
      attempts++;
      let overlap = false;
      for (const pos of placedPositions) {
        const dx = Math.abs(pos.x - x);
        const dy = Math.abs(pos.y - y);
        if (dx < 14 && dy < 16) { overlap = true; break; }
      }
      if (!overlap) break;
    } while (attempts < 30);
    
    fish.style.left = x + '%';
    fish.style.top = y + '%';
    placedPositions.push({ x, y });
    container.appendChild(fish);
  }
  
  startHookSwing();
}

// 钩子状态
let fsCastState = 'idle';
let fsAnimationFrame = null;
let fsSwingFrame = null;
let fsCurrentRopeLength = 0;
let fsCurrentAngle = 0;        // 当前钩子摆动角度（实时跟踪）
let fsSwingStartTime = 0;      // 摆动动画开始时间
let fsSwingDirection = 1;      // 摆动方向
let fsCaughtFish = null;
let fsCaughtRarity = '';
let fsCaughtFishName = '';
let fsCaughtPoints = 0;

function startHookSwing() {
  const hookArm = document.getElementById('fsHookArm');
  if (!hookArm) return;
  hookArm.classList.remove('dropping', 'hoisting');
  hookArm.classList.add('swinging');
  fsCurrentAngle = 0;
  fsSwingStartTime = performance.now();
  fsSwingDirection = 1;
  
  // 持续跟踪摆动角度（解决 CSS 动画 transform 读取不准的问题）
  if (fsSwingFrame) cancelAnimationFrame(fsSwingFrame);
  function trackSwing() {
    if (fsCastState !== 'idle') return;
    const elapsed = (performance.now() - fsSwingStartTime) / 1000;
    // 摆动周期 2.4 秒，角度从 -55° 到 55° 摆动
    // 用 sin 函数模拟：sin(2π * t / T) * 55
    fsCurrentAngle = Math.sin((Math.PI * elapsed) / 1.2) * 55;
    fsSwingFrame = requestAnimationFrame(trackSwing);
  }
  fsSwingFrame = requestAnimationFrame(trackSwing);
}

function fsStartFishing() {
  if (fsCastState !== 'idle' || !socket) return;
  fsCastState = 'dropping';
  
  const fishBtn = document.getElementById('fsFishBtn');
  const statusEl = document.getElementById('fsStatus');
  const hookArm = document.getElementById('fsHookArm');
  
  if (!hookArm) return;
  
  fishBtn.disabled = true;
  fishBtn.textContent = '🎣 收线';
  statusEl.textContent = '⤬ 放钩子...';
  statusEl.style.color = '#F59E0B';
  
  // 停止摆动（角度已通过 trackSwing 实时跟踪）
  hookArm.classList.remove('swinging');
  if (fsSwingFrame) cancelAnimationFrame(fsSwingFrame);
  fsSwingFrame = null;
  
  // 固定当前角度
  const angle = fsCurrentAngle;
  hookArm.style.transform = `rotate(${angle}deg)`;
  
  const sceneEl = document.querySelector('.fs-fishing-scene');
  const sceneHeight = sceneEl ? sceneEl.clientHeight : 600;
  const pivotY = sceneHeight * 0.3;
  const maxRopeLength = Math.max(400, sceneHeight);
  
  hookArm.style.setProperty('--hook-angle', angle + 'deg');
  hookArm.style.setProperty('--rope-length', maxRopeLength + 'px');
  
  fsAnimateDrop(maxRopeLength, angle, pivotY);
}

function fsAnimateDrop(targetRopeLength, angle, pivotY) {
  const hookArm = document.getElementById('fsHookArm');
  const hookRope = hookArm.querySelector('.fs-hook-rope');
  const hookClaw = document.getElementById('fsHookClaw');
  
  if (!hookArm || !hookRope || !hookClaw) return;
  
  fsCurrentRopeLength = 0;
  const startTime = performance.now();
  const dropDuration = 700;
  
  function step(now) {
    if (fsCastState !== 'dropping') return;
    
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / dropDuration, 1);
    const eased = progress * progress;
    fsCurrentRopeLength = targetRopeLength * eased;
    
    hookRope.style.height = fsCurrentRopeLength + 'px';
    
    const rad = angle * Math.PI / 180;
    const pivotX = window.innerWidth / 2;
    const clawX = pivotX + Math.sin(rad) * fsCurrentRopeLength;
    const clawY = pivotY + Math.cos(rad) * fsCurrentRopeLength;
    
    hookClaw.style.position = 'fixed';
    hookClaw.style.left = clawX + 'px';
    hookClaw.style.top = clawY + 'px';
    hookClaw.style.transform = 'translate(-50%, 0)';
    
    const caughtFish = fsCheckHookCollision(clawX, clawY);
    if (caughtFish) {
      fsCaughtFish = caughtFish;
      fsCaughtRarity = caughtFish.dataset.rarity;
      fsCaughtFishName = caughtFish.dataset.name || caughtFish.textContent;
      fsCaughtPoints = parseInt(caughtFish.dataset.points) || 0;
      caughtFish.style.opacity = '0';
      caughtFish.classList.add('caught');
      
      const caughtItem = document.getElementById('fsCaughtItem');
      caughtItem.textContent = caughtFish.textContent;
      caughtItem.style.position = 'fixed';
      caughtItem.style.left = clawX + 'px';
      caughtItem.style.top = (clawY + 40) + 'px';
      caughtItem.classList.add('show');
      
      fsStartHoist(angle, targetRopeLength, pivotY);
      return;
    }
    
    if (progress < 1) {
      fsAnimationFrame = requestAnimationFrame(step);
    } else {
      fsStartHoist(angle, targetRopeLength, pivotY);
    }
  }
  fsAnimationFrame = requestAnimationFrame(step);
}

function fsCheckHookCollision(clawX, clawY) {
  const fishes = document.querySelectorAll('.fs-static-fish:not(.caught)');
  for (const fish of fishes) {
    const rect = fish.getBoundingClientRect();
    if (rect.width === 0) continue;
    const fx = rect.left + rect.width / 2;
    const fy = rect.top + rect.height / 2;
    const dx = fx - clawX;
    const dy = fy - clawY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 45) return fish;
  }
  return null;
}

function fsStartHoist(angle, ropeLength, pivotY) {
  if (fsCastState === 'hoisting') return;
  fsCastState = 'hoisting';
  
  const statusEl = document.getElementById('fsStatus');
  const fishBtn = document.getElementById('fsFishBtn');
  const caughtItem = document.getElementById('fsCaughtItem');
  
  const hasCaught = !!fsCaughtFish;
  const weight = hasCaught ? parseFloat(fsCaughtFish.dataset.weight) || 0.5 : 0.5;
  
  const baseDuration = 1200;
  const hoistDuration = baseDuration * weight;
  
  const startTime = performance.now();
  const startLength = fsCurrentRopeLength;
  
  if (hasCaught) {
    const rarityNames = { common: '普通', rare: '稀有', epic: '史诗', legendary: '传说', junk: '杂物' };
    statusEl.textContent = `⤴ 收回中...（${rarityNames[fsCaughtRarity] || ''}）`;
    statusEl.style.color = '#10B981';
  } else {
    statusEl.textContent = '😢 这次没勾到...';
    statusEl.style.color = '#9CA3AF';
  }
  fishBtn.textContent = '⤴ 收线中...';
  fishBtn.disabled = true;
  
  function step(now) {
    if (fsCastState !== 'hoisting') return;
    
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / hoistDuration, 1);
    const eased = 1 - Math.pow(1 - progress, 2);
    const newLength = startLength * (1 - eased);
    
    const hookArm = document.getElementById('fsHookArm');
    const hookRope = hookArm.querySelector('.fs-hook-rope');
    const hookClaw = document.getElementById('fsHookClaw');
    
    hookRope.style.height = newLength + 'px';
    
    const rad = angle * Math.PI / 180;
    const pivotX = window.innerWidth / 2;
    const clawX = pivotX + Math.sin(rad) * newLength;
    const clawY = pivotY + Math.cos(rad) * newLength;
    
    hookClaw.style.left = clawX + 'px';
    hookClaw.style.top = clawY + 'px';
    
    if (hasCaught && caughtItem) {
      caughtItem.style.left = clawX + 'px';
      caughtItem.style.top = (clawY + 40) + 'px';
    }
    
    if (progress < 1) {
      fsAnimationFrame = requestAnimationFrame(step);
    } else {
      fsFishingComplete(hasCaught);
    }
  }
  fsAnimationFrame = requestAnimationFrame(step);
}

function fsFishingComplete(hasCaught) {
  const hookArm = document.getElementById('fsHookArm');
  const hookRope = hookArm.querySelector('.fs-hook-rope');
  const hookClaw = document.getElementById('fsHookClaw');
  const caughtItem = document.getElementById('fsCaughtItem');
  const fishBtn = document.getElementById('fsFishBtn');
  const statusEl = document.getElementById('fsStatus');
  
  if (hasCaught && socket) {
    socket.emit('startFishing', {
      expectedRarity: fsCaughtRarity,
      fishName: fsCaughtFishName,
      points: fsCaughtPoints
    });
  } else if (socket) {
    socket.emit('startFishing', { missed: true });
  }
  
  setTimeout(() => {
    hookArm.style.transform = '';
    hookRope.style.height = '0px';
    hookClaw.style.left = '';
    hookClaw.style.top = '';
    hookClaw.style.position = '';
    hookClaw.style.transform = '';
    caughtItem.classList.remove('show');
    caughtItem.textContent = '';
    caughtItem.style.left = '';
    caughtItem.style.top = '';
    caughtItem.style.position = '';
    
    fsCaughtFish = null;
    fsCaughtRarity = '';
    fsCaughtFishName = '';
    fsCaughtPoints = 0;
    fsCurrentRopeLength = 0;
    fsCastState = 'idle';
    
    startHookSwing();
    
    fishBtn.textContent = '🎣 放钩子';
    fishBtn.disabled = false;
    statusEl.textContent = '准备就绪';
    statusEl.style.color = '#10B981';
  }, 600);
}

function showFsFishCaughtResult(data) {
  const fishBtn = document.getElementById('fsFishBtn');
  const statusEl = document.getElementById('fsStatus');
  const resultEl = document.getElementById('fsFishResult');
  const totalEl = document.getElementById('fsTotal');
  const pointsEl = document.getElementById('fsPoints');
  
  fishBtn.textContent = '🎣 放钩子';
  
  if (data.escaped) {
    const escapedMsg = document.createElement('div');
    escapedMsg.className = 'fs-escape-toast';
    escapedMsg.innerHTML = `😱 鱼脱钩了！`;
    escapedMsg.style.cssText = `
      position: fixed; top: 30%; left: 50%; transform: translateX(-50%);
      background: rgba(239, 68, 68, 0.95); color: white; padding: 12px 24px;
      border-radius: 24px; font-size: 18px; font-weight: 600;
      z-index: 3001; animation: fsEscapeToast 2s ease-out forwards;
    `;
    document.body.appendChild(escapedMsg);
    setTimeout(() => escapedMsg.remove(), 2100);
    statusEl.textContent = '😱 鱼脱钩了！';
    statusEl.style.color = '#EF4444';
  } else if (data.missed) {
    statusEl.textContent = '😢 空钩而归';
    statusEl.style.color = '#9CA3AF';
  } else {
    statusEl.textContent = '🎉 收获满满！';
    statusEl.style.color = '#10B981';
  }
  
  if (data.backpack) {
    fsBackpack = data.backpack;
    totalEl.textContent = data.backpack.totalCaught || 0;
  }
  
  if (data.fish) {
    document.getElementById('fsFishEmoji').textContent = data.fish.emoji;
    document.getElementById('fsFishName').textContent = data.fish.name;
    document.getElementById('fsFishRarity').textContent = data.rarityInfo.name;
    document.getElementById('fsFishRarity').style.color = data.rarityInfo.color;
    document.getElementById('fsFishPoints').textContent = `+${data.fish.points} 积分`;
    
    resultEl.classList.remove('hidden');
    resultEl.querySelector('.fs-fish-result-inner').style.animation = 'none';
    void resultEl.querySelector('.fs-fish-result-inner').offsetWidth;
    resultEl.querySelector('.fs-fish-result-inner').style.animation = 'fsFishPopIn 0.6s ease-out';
    
    setTimeout(() => { resultEl.classList.add('hidden'); }, 2500);
  }
}

function openBackpackModal() {
  const modal = document.getElementById('fsBackpackModal');
  const list = document.getElementById('fsBackpackList');
  const total = document.getElementById('fsBackpackTotal');
  
  list.innerHTML = '';
  const fish = fsBackpack.fishes || {};
  const entries = Object.entries(fish);
  
  if (entries.length === 0) {
    list.innerHTML = '<div class="fs-backpack-empty">背包是空的<br>去钓点鱼吧！</div>';
  } else {
    entries.sort((a, b) => b[1] - a[1]).forEach(([name, count]) => {
      const item = document.createElement('div');
      item.className = 'fs-backpack-item';
      item.innerHTML = `
        <span class="fs-backpack-name">${name}</span>
        <span class="fs-backpack-count">×${count}</span>
      `;
      list.appendChild(item);
    });
  }
  
  total.textContent = fsBackpack.totalCaught || 0;
  modal.classList.remove('hidden');
}

function closeBackpackModal() {
  document.getElementById('fsBackpackModal').classList.add('hidden');
}

// 启动
document.addEventListener('DOMContentLoaded', init);
