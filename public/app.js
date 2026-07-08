const BOT_NAME = '小助手';

const ADJECTIVES = ['快乐的', '活泼的', '可爱的', '聪明的', '勇敢的', '温柔的', '调皮的', '神秘的', '优雅的', '热情的', '冷静的', '机灵的', '憨厚的', '傲娇的', '佛系的', '元气的', '呆萌的', '霸气的', '文艺的', '搞笑的'];
const ANIMALS = ['小狐狸', '小熊猫', '小兔子', '小老虎', '小狮子', '小企鹅', '小海豚', '小松鼠', '小刺猬', '小考拉', '小水獭', '小柴犬', '小橘猫', '小仓鼠', '小羊驼', '小浣熊', '小鲸鱼', '小海龟', '小蜜蜂', '小蝴蝶'];

function generateRandomNickname() {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const animal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
  return adj + animal;
}

const AVATAR_EMOJIS = [
  '🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼',
  '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🐔',
  '🐧', '🐦', '🐤', '🦆', '🦅', '🦉', '🦇', '🐝',
  '🦋', '🐌', '🐛', '🦟', '🦗', '🐢', '🐍', '🦎',
  '🦖', '🦕', '🐙', '🦑', '🦐', '🦞', '🦀', '🐡',
  '🐠', '🐟', '🐬', '🦈', '🐳', '🐋', '🦭', '🐊',
  '🐅', '🐆', '🦓', '🦍', '🦧', '🦣', '🦛', '🦏',
  '🐪', '🐫', '🦒', '🦘', '🦡', '🦦', '🦥', '🦔'
];

function getAvatarEmoji(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_EMOJIS[Math.abs(hash) % AVATAR_EMOJIS.length];
}

const CacheDB = {
  db: null,
  init: function() {
    return new Promise((resolve, reject) => {
      if (this.db) {
        resolve(this.db);
        return;
      }
      const request = indexedDB.open('ChatRoomCache', 1);
      request.onupgradeneeded = function(e) {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('files')) {
          const store = db.createObjectStore('files', { keyPath: 'url' });
          store.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };
      request.onsuccess = function(e) {
        CacheDB.db = e.target.result;
        resolve(CacheDB.db);
      };
      request.onerror = function(e) {
        reject(e.target.error);
      };
    });
  },
  get: async function(url) {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['files'], 'readonly');
      const store = transaction.objectStore('files');
      const request = store.get(url);
      request.onsuccess = function(e) {
        resolve(e.target.result);
      };
      request.onerror = function(e) {
        reject(e.target.error);
      };
    });
  },
  set: async function(url, data, type) {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['files'], 'readwrite');
      const store = transaction.objectStore('files');
      const request = store.put({
        url: url,
        data: data,
        type: type,
        timestamp: Date.now()
      });
      request.onsuccess = function() {
        resolve();
      };
      request.onerror = function(e) {
        reject(e.target.error);
      };
    });
  },
  clearExpired: async function(days = 7) {
    await this.init();
    const maxAge = Date.now() - days * 24 * 60 * 60 * 1000;
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['files'], 'readwrite');
      const store = transaction.objectStore('files');
      const request = store.openCursor();
      const deleted = [];
      request.onsuccess = function(e) {
        const cursor = e.target.result;
        if (cursor) {
          if (cursor.value.timestamp < maxAge) {
            deleted.push(cursor.value.url);
            cursor.delete();
          }
          cursor.continue();
        } else {
          resolve(deleted);
        }
      };
      request.onerror = function(e) {
        reject(e.target.error);
      };
    });
  },
  getCacheUrl: async function(url) {
    const cached = await this.get(url);
    if (cached) {
      return URL.createObjectURL(cached.data);
    }
    return null;
  },
  fetchAndCache: async function(url) {
    const cachedUrl = await this.getCacheUrl(url);
    if (cachedUrl) {
      return cachedUrl;
    }
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      await this.set(url, blob, blob.type);
      return URL.createObjectURL(blob);
    } catch (err) {
      console.error('缓存获取失败:', err);
      return url;
    }
  }
};

let username = '';
let currentRoomId = '';
let userId = '';
let socket = null;
let onlineUsers = [];
let mentionStartPos = -1;
let selectedMentionIndex = 0;
let typingMessageIds = new Set();
let replyingTo = null;
let hasMoreHistory = true;
let loadingHistory = false;

function getOrCreateUserId() {
  let uid = localStorage.getItem('chat_user_id');
  if (!uid) {
    uid = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
    localStorage.setItem('chat_user_id', uid);
  }
  return uid;
}

const EMOJIS = ['😀','😂','🥰','😎','🤔','👍','👏','🔥','❤️','🎉','😭','😡','🤮','🤡','💀','👻','🙈','🙉','🙊','💩','👽','🤖','🎃','🦄','🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼'];

function getSocketUrl() {
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return window.location.origin;
  }
  return window.location.origin;
}

let reconnectAttempt = 0;
const MAX_RECONNECT_DELAY = 30000;

function connectSocket() {
  socket = io(getSocketUrl(), {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1500,
    reconnectionDelayMax: MAX_RECONNECT_DELAY,
    reconnectionAttempts: Infinity,
    timeout: 30000,
    pingInterval: 25000,
    pingTimeout: 20000,
    upgrade: true,
    forceNew: false
  });

  socket.on('connect', () => {
    reconnectAttempt = 0;
    updateUserStatus('已连接');

    CacheDB.clearExpired(7).catch(() => {});

    if (username && currentRoomId) {
      const container = document.getElementById('messagesContainer');
      container.innerHTML = '<div id="loadMoreTip" class="load-more-tip">下拉加载更多历史消息...</div>';
      onlineUsers = [];
      window.__earliestTimestamp = undefined;
      hasMoreHistory = true;
      loadingHistory = false;
      if (!userId) userId = getOrCreateUserId();
      socket.emit('join', { roomId: currentRoomId, username, userId });
    }
  });

  socket.on('disconnect', (reason) => {
    updateUserStatus('已断开');
  });

  socket.on('reconnect', (attemptNumber) => {
    updateUserStatus('已连接');
  });

  socket.on('reconnecting', (attemptNumber) => {
    updateUserStatus(`重连中(${attemptNumber})`);
  });

  socket.on('connect_error', (err) => {
    console.warn('连接错误:', err.message);
  });

  socket.on('history', (messages) => {
    messages.forEach(msg => displayMessage(msg));
    
    if (messages.length > 0) {
      const earliest = messages.reduce((min, msg) => msg.timestamp && msg.timestamp < min ? msg.timestamp : min, messages[0].timestamp);
      window.__earliestTimestamp = earliest;
      
      if (messages.length >= 50) {
        hasMoreHistory = true;
        const tip = document.getElementById('loadMoreTip');
        if (tip) {
          tip.textContent = '下拉加载更多历史消息...';
          tip.classList.remove('no-more');
        }
      }
    }
  });

  socket.on('message', (message) => {
    displayMessage(message);
  });

  socket.on('removeTyping', (id) => {
    const el = document.querySelector(`[data-msg-id="${id}"]`);
    if (el) el.remove();
    typingMessageIds.delete(id);
  });

  socket.on('userList', (users) => {
    onlineUsers = users;
    renderMembersList(users);
  });

  socket.on('moreHistory', ({ messages, hasMore }) => {
    const container = document.getElementById('messagesContainer');
    const prevScrollHeight = container.scrollHeight;
    const prevScrollTop = container.scrollTop;

    messages.forEach(msg => displayMessage(msg, true));

    if (messages.length > 0) {
      const earliest = messages.reduce((min, msg) => msg.timestamp && msg.timestamp < min ? msg.timestamp : min, messages[0].timestamp);
      window.__earliestTimestamp = earliest;
    }

    requestAnimationFrame(() => {
      const newScrollHeight = container.scrollHeight;
      container.scrollTop = newScrollHeight - prevScrollHeight + prevScrollTop;
    });

    loadingHistory = false;
    const tip = document.getElementById('loadMoreTip');
    if (!hasMore) {
      hasMoreHistory = false;
      if (tip) {
        tip.textContent = '已经是最早的消息了';
        tip.classList.add('no-more');
      }
    } else {
      if (tip) tip.textContent = '点击加载更多历史消息...';
    }
  });

  socket.on('messageLiked', ({ messageId, likes }) => {
    const msgEl = document.querySelector(`[data-msg-id="${messageId}"]`);
    if (msgEl) {
      const likeCount = msgEl.querySelector('.like-count');
      const likeBtn = msgEl.querySelector('.like-action');
      if (likeCount) likeCount.textContent = likes.length;
      if (likeBtn) {
        const isLiked = likes.includes(userId);
        likeBtn.classList.toggle('liked', isLiked);
      }
    }
  });

  socket.on('messageRecalled', ({ messageId }) => {
    const msgEl = document.querySelector(`[data-msg-id="${messageId}"]`);
    if (msgEl) {
      msgEl.className = 'message system-message';
      msgEl.innerHTML = '<div class="message-recalled">消息已撤回</div>';
    }
  });

  socket.on('pollUpdated', ({ pollId, votes, options, question }) => {
    updatePollDisplay(pollId, votes, options, question);
  });

  socket.on('usernameUpdated', ({ newUsername }) => {
    username = newUsername;
    localStorage.setItem('chat_username', newUsername);
    showToast(`昵称已改为 ${newUsername}`, 'success');
  });

  socket.on('announcementUpdated', ({ announcement }) => {
    updateAnnouncementBar(announcement);
  });

  socket.on('messagesCleared', ({ roomId, level }) => {
    if (roomId && roomId !== currentRoomId) return;
    
    const container = document.getElementById('messagesContainer');
    container.innerHTML = '<div id="loadMoreTip" class="load-more-tip">下拉加载更多历史消息...</div>';
    onlineUsers = [];
    window.__earliestTimestamp = undefined;
    hasMoreHistory = false;
    loadingHistory = false;
    
    showToast('消息记录已被清空', 'success');
  });
}

function updateAnnouncementBar(text) {
  const bar = document.getElementById('announcementBar');
  const content = document.getElementById('announcementContent');
  
  if (!text) {
    bar.classList.add('hidden');
    return;
  }
  
  bar.classList.remove('hidden');
  content.innerHTML = formatAnnouncement(text);
}

function formatAnnouncement(text) {
  let html = escapeHtml(text);
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\n/g, '<br>');
  return html;
}

function toggleAnnouncement() {
  const bar = document.getElementById('announcementBar');
  bar.classList.toggle('collapsed');
  const collapsed = bar.classList.contains('collapsed');
  if (currentRoomId) {
    localStorage.setItem('announcement_collapsed_' + currentRoomId, collapsed ? '1' : '0');
  }
}

function renderMembersList(users) {
  const membersList = document.getElementById('membersList');
  const memberCount = document.getElementById('memberCount');
  const allMembers = [BOT_NAME, ...users].filter((u, i, arr) => arr.indexOf(u) === i);
  
  memberCount.textContent = allMembers.length;
  
  membersList.innerHTML = allMembers.map(member => {
    const isBot = member === BOT_NAME;
    const isOnline = isBot || users.includes(member);
    const isMe = member === username;
    const avatar = isBot ? '🤖' : getAvatarEmoji(member);
    
    return `
      <div class="member-item ${isMe ? 'me' : ''}" data-username="${escapeHtml(member)}">
        <span class="member-avatar">${avatar}</span>
        <span class="member-name">${isMe ? '我' : escapeHtml(member)}</span>
        <span class="member-status ${isOnline ? 'online' : ''}"></span>
      </div>
    `;
  }).join('');

  membersList.querySelectorAll('.member-item').forEach(item => {
    item.addEventListener('click', () => {
      const memberName = item.dataset.username;
      if (memberName === username) return;
      
      const input = document.getElementById('messageInput');
      if (input.value.length > 0 && !input.value.endsWith(' ')) {
        input.value += ' ';
      }
      input.value += '@' + memberName + ' ';
      input.focus();
      
      // 移动端：点击后关闭侧边栏
      if (window.innerWidth <= 600) {
        closeMembersSidebar();
      }
    });
  });
}

function toggleMembersSidebar() {
  const sidebar = document.getElementById('membersSidebar');
  const overlay = document.getElementById('membersSidebarOverlay');
  sidebar.classList.toggle('open');
  overlay.classList.toggle('open');
}

function closeMembersSidebar() {
  const sidebar = document.getElementById('membersSidebar');
  const overlay = document.getElementById('membersSidebarOverlay');
  sidebar.classList.remove('open');
  overlay.classList.remove('open');
}

function updateUserStatus(status) {
  const statusEl = document.getElementById('userStatus');
  statusEl.textContent = status;
  statusEl.classList.remove('connected', 'reconnecting');
  if (status === '已连接') {
    statusEl.classList.add('connected');
  } else if (status.includes('重连中')) {
    statusEl.classList.add('reconnecting');
  }
}

function sendMessage() {
  const input = document.getElementById('messageInput');
  const text = input.value.trim();

  if (!text || !socket) return;

  const payload = { text: text };
  if (replyingTo) {
    payload.replyTo = {
      id: replyingTo.id,
      username: replyingTo.username,
      text: replyingTo.text.substring(0, 50)
    };
    cancelReply();
  }

  socket.emit('message', payload);

  const emojiRainKeywords = ['生日快乐', '恭喜', '庆祝', '谢谢', '爱心', '666', '加油', '开心', '爱你', '想你', '晚安', '早安', '下雪', '下雨', '花', '星星', '月亮', '太阳', '彩虹'];
  emojiRainKeywords.forEach(keyword => {
    if (text.includes(keyword)) {
      triggerEmojiRain(keyword);
    }
  });

  input.value = '';
  input.focus();
  hideMentionList();
}

function setReplyTo(message) {
  replyingTo = message;
  const preview = document.getElementById('replyPreview');
  const text = document.getElementById('replyPreviewText');
  text.textContent = `引用 ${message.username}: ${message.text.substring(0, 30)}${message.text.length > 30 ? '...' : ''}`;
  preview.classList.remove('hidden');
  document.getElementById('messageInput').focus();
}

function cancelReply() {
  replyingTo = null;
  document.getElementById('replyPreview').classList.add('hidden');
}

function togglePlusPanel() {
  const panel = document.getElementById('plusPanel');
  panel.classList.toggle('hidden');
}

function insertEmoji(emoji) {
  const input = document.getElementById('messageInput');
  input.value += emoji;
  input.focus();
  document.getElementById('plusPanel').classList.add('hidden');
}

function renderEmojiPanel() {
  const panel = document.getElementById('emojiTab');
  panel.innerHTML = EMOJIS.map(e => `<button class="emoji-btn" data-emoji="${e}">${e}</button>`).join('');
  panel.querySelectorAll('.emoji-btn').forEach(btn => {
    btn.addEventListener('click', () => insertEmoji(btn.dataset.emoji));
  });
}

function initPlusPanel() {
  // 标签切换
  document.querySelectorAll('.plus-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.plus-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.querySelectorAll('.plus-tab-content').forEach(c => c.classList.add('hidden'));
      document.getElementById(tab.dataset.tab + 'Tab').classList.remove('hidden');
    });
  });

  // 添加投票选项
  document.getElementById('addPollOption').addEventListener('click', () => {
    const container = document.getElementById('pollOptions');
    const count = container.children.length + 1;
    if (count > 8) {
      showToast('最多8个选项');
      return;
    }
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'poll-option-input';
    input.placeholder = `选项 ${count}`;
    input.maxLength = 50;
    container.appendChild(input);
    input.focus();
  });

  // 发起投票
  document.getElementById('createPollBtn').addEventListener('click', () => {
    const question = document.getElementById('pollQuestion').value.trim();
    const optionInputs = document.querySelectorAll('.poll-option-input');
    const options = Array.from(optionInputs).map(i => i.value.trim()).filter(v => v);

    if (!question) {
      showToast('请输入投票问题');
      return;
    }
    if (options.length < 2) {
      showToast('至少需要2个选项');
      return;
    }

    socket.emit('createPoll', { question, options });
    document.getElementById('plusPanel').classList.add('hidden');

    // 重置表单
    document.getElementById('pollQuestion').value = '';
    optionInputs.forEach(i => i.value = '');
    // 只保留2个选项
    const container = document.getElementById('pollOptions');
    while (container.children.length > 2) {
      container.removeChild(container.lastChild);
    }
  });
}

function rollDice() {
  const dice = Math.floor(Math.random() * 6) + 1;
  const diceEmoji = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'][dice - 1];
  socket.emit('message', { text: `🎲 掷骰子结果：${diceEmoji} ${dice}点` });
  document.getElementById('plusPanel').classList.add('hidden');
}

function playRockPaperScissors() {
  const choices = ['✊', '✋', '✌️'];
  const myChoice = choices[Math.floor(Math.random() * choices.length)];
  const botChoice = choices[Math.floor(Math.random() * choices.length)];
  
  let result = '';
  if (myChoice === botChoice) {
    result = '平局！';
  } else if (
    (myChoice === '✊' && botChoice === '✌️') ||
    (myChoice === '✋' && botChoice === '✊') ||
    (myChoice === '✌️' && botChoice === '✋')
  ) {
    result = '你赢了！🎉';
  } else {
    result = '你输了！😢';
  }
  
  socket.emit('message', { 
    text: `✊ 石头剪刀布：你出${myChoice}，小助手出${botChoice}，${result}` 
  });
  document.getElementById('plusPanel').classList.add('hidden');
}

let mediaRecorder = null;
let audioChunks = [];
let voiceRecordingTimer = null;
let voiceRecordingSeconds = 0;

async function compressImage(file, maxWidth = 1280, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;
      
      if (width > maxWidth) {
        height = (height * maxWidth) / width;
        width = maxWidth;
      }
      
      canvas.width = width;
      canvas.height = height;
      
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' }));
        } else {
          resolve(file);
        }
      }, 'image/jpeg', quality);
    };
    img.onerror = () => resolve(file);
    img.src = URL.createObjectURL(file);
  });
}

async function handleImageUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  
  showToast('正在处理图片...', 'info');
  
  try {
    const compressedFile = await compressImage(file);
    
    showToast('正在上传图片...', 'info');
    
    const formData = new FormData();
    formData.append('file', compressedFile);
    formData.append('folder', 'images');
    
    const res = await fetch('/api/upload', {
      method: 'POST',
      body: formData
    });
    
    const data = await res.json();
    if (data.ok) {
      socket.emit('message', { 
        type: 'image',
        text: '',
        imageUrl: data.url 
      });
      showToast('图片发送成功！', 'success');
    } else {
      showToast('图片上传失败：' + data.error, 'error');
    }
  } catch (err) {
    showToast('图片上传失败：' + err.message, 'error');
  }
  
  e.target.value = '';
  document.getElementById('plusPanel').classList.add('hidden');
}

async function startVoiceRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    
    mediaRecorder = new MediaRecorder(stream);
    audioChunks = [];
    voiceRecordingSeconds = 0;
    
    mediaRecorder.ondataavailable = (event) => {
      audioChunks.push(event.data);
    };
    
    mediaRecorder.onstop = () => {
      stream.getTracks().forEach(track => track.stop());
    };
    
    mediaRecorder.start(100);
    
    document.getElementById('plusPanel').classList.add('hidden');
    document.getElementById('voiceRecorder').classList.remove('hidden');
    
    voiceRecordingTimer = setInterval(() => {
      voiceRecordingSeconds++;
      const mins = Math.floor(voiceRecordingSeconds / 60).toString().padStart(2, '0');
      const secs = (voiceRecordingSeconds % 60).toString().padStart(2, '0');
      document.getElementById('voice-timer').textContent = `${mins}:${secs}`;
    }, 1000);
    
  } catch (err) {
    showToast('无法访问麦克风：' + err.message, 'error');
  }
}

function cancelVoiceRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
  if (voiceRecordingTimer) {
    clearInterval(voiceRecordingTimer);
  }
  document.getElementById('voiceRecorder').classList.add('hidden');
}

async function sendVoiceMessage() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
  if (voiceRecordingTimer) {
    clearInterval(voiceRecordingTimer);
  }
  
  if (audioChunks.length === 0) {
    showToast('请先录制语音', 'error');
    return;
  }
  
  showToast('正在上传语音...', 'info');
  
  const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
  const formData = new FormData();
  formData.append('file', audioBlob, `voice-${Date.now()}.webm`);
  formData.append('folder', 'voice');
  
  try {
    const res = await fetch('/api/upload', {
      method: 'POST',
      body: formData
    });
    
    const data = await res.json();
    if (data.ok) {
      socket.emit('message', { 
        type: 'audio',
        text: '',
        audioUrl: data.url,
        duration: voiceRecordingSeconds
      });
      showToast('语音发送成功！', 'success');
    } else {
      showToast('语音上传失败：' + data.error, 'error');
    }
  } catch (err) {
    showToast('语音上传失败：' + err.message, 'error');
  }
  
  document.getElementById('voiceRecorder').classList.add('hidden');
}

async function previewImage(url) {
  const cachedUrl = await CacheDB.fetchAndCache(url);
  const overlay = document.createElement('div');
  overlay.className = 'image-preview-overlay';
  overlay.innerHTML = `<img src="${cachedUrl}" alt="预览">`;
  overlay.onclick = () => overlay.remove();
  document.body.appendChild(overlay);
}

let currentAudio = null;

async function toggleAudio(button) {
  const originalUrl = button.dataset.originalUrl;
  if (!originalUrl) return;

  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
    document.querySelectorAll('.message-audio-play').forEach(btn => btn.textContent = '▶');
  }

  const url = await CacheDB.fetchAndCache(originalUrl);
  const audio = new Audio(url);
  currentAudio = audio;
  
  audio.onplay = () => {
    button.textContent = '⏸';
  };
  
  audio.onpause = () => {
    button.textContent = '▶';
  };
  
  audio.onended = () => {
    button.textContent = '▶';
    currentAudio = null;
  };
  
  audio.play().catch(err => {
    console.error('播放失败:', err);
    button.textContent = '▶';
    currentAudio = null;
  });
}

function createHeartAnimation(x, y) {
  const heart = document.createElement('div');
  heart.className = 'like-heart';
  heart.textContent = '❤️';
  heart.style.left = x + 'px';
  heart.style.top = y + 'px';
  document.body.appendChild(heart);
  
  setTimeout(() => {
    heart.remove();
  }, 800);
}

function triggerEmojiRain(keyword) {
  const rainEmojis = {
    '生日快乐': ['🎂', '🎁', '🎉', '🎊', '🎈', '🎀'],
    '恭喜': ['🎉', '🎊', '👏', '👍', '✨', '🌟'],
    '庆祝': ['🎉', '🎊', '🎈', '🎆', '🎇', '✨'],
    '谢谢': ['🙏', '❤️', '😊', '💕', '💖', '💝'],
    '爱心': ['❤️', '💖', '💕', '💝', '💗', '💘'],
    '666': ['🔥', '💯', '👍', '👏', '✨', '🌟'],
    '加油': ['💪', '🔥', '✨', '🌟', '💯', '🌟'],
    '开心': ['😄', '😆', '🤣', '🥳', '🎉', '✨'],
    '爱你': ['❤️', '💕', '💖', '💝', '💗', '💘'],
    '想你': ['💭', '❤️', '💝', '💖', '💕', '💗'],
    '晚安': ['🌙', '✨', '💤', '😴', '🌛', '⭐'],
    '早安': ['☀️', '🌅', '🌤️', '✨', '🌟', '🌞'],
    '下雪': ['❄️', '☃️', '🌨️', '⛄', '💎', '✨'],
    '下雨': ['🌧️', '🌦️', '💧', '☔', '🌈', '⛈️'],
    '花': ['🌸', '🌺', '🌹', '🌻', '🌷', '💐'],
    '星星': ['⭐', '🌟', '✨', '💫', '🌠', '🌌'],
    '月亮': ['🌙', '🌛', '🌜', '🌚', '⭐', '✨'],
    '太阳': ['☀️', '🌞', '🌤️', '🔥', '✨', '🌟'],
    '彩虹': ['🌈', '⭐', '✨', '🌈', '🎨', '🎭']
  };
  
  const emojis = rainEmojis[keyword] || ['🎉', '🎊', '✨', '🌟'];
  
  let container = document.getElementById('emojiRainContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'emojiRainContainer';
    container.className = 'emoji-rain-container';
    document.body.appendChild(container);
  }
  
  for (let i = 0; i < 30; i++) {
    setTimeout(() => {
      const emoji = document.createElement('div');
      emoji.className = 'emoji-drop';
      emoji.textContent = emojis[Math.floor(Math.random() * emojis.length)];
      emoji.style.left = Math.random() * 100 + '%';
      emoji.style.animationDuration = (2 + Math.random() * 2) + 's';
      emoji.style.animationDelay = Math.random() * 0.5 + 's';
      container.appendChild(emoji);
      
      setTimeout(() => {
        emoji.remove();
      }, 4000);
    }, i * 80);
  }
  
  setTimeout(() => {
    if (container.children.length === 0) {
      container.remove();
    }
  }, 5000);
}

function requestLoadMoreHistory() {
  if (!hasMoreHistory || loadingHistory || !socket) return;

  let earliestTs = window.__earliestTimestamp;
  
  if (earliestTs === undefined || earliestTs === null) {
    earliestTs = Date.now();
  }

  loadingHistory = true;
  const tip = document.getElementById('loadMoreTip');
  if (tip) tip.textContent = '加载中...';

  socket.emit('loadMoreHistory', { beforeTimestamp: earliestTs });
}

function displayMessage(message, prepend = false) {
  const container = document.getElementById('messagesContainer');
  const loadMoreTip = document.getElementById('loadMoreTip');

  if (message.id && typingMessageIds.has(message.id)) {
    return;
  }

  if (message.type === 'typing') {
    typingMessageIds.add(message.id);
  }

  const messageDiv = document.createElement('div');

  if (message.type === 'system') {
    const isJoin = message.text.includes('加入了聊天室');
    const isLeave = message.text.includes('离开了聊天室');
    messageDiv.className = `system-message ${isJoin ? 'join-effect' : ''} ${isLeave ? 'leave-effect' : ''}`;
    const time = new Date(message.timestamp);
    const timeStr = time.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    messageDiv.textContent = message.text;
    messageDiv.title = timeStr;
    if (prepend) {
      container.insertBefore(messageDiv, loadMoreTip ? loadMoreTip.nextSibling : container.firstChild);
    } else {
      container.appendChild(messageDiv);
      container.scrollTop = container.scrollHeight;
    }
    updateEarliestTimestamp(message.timestamp);
    return;
  }

  if (message.type === 'poll') {
    renderPollMessage(message, container, prepend);
    updateEarliestTimestamp(message.timestamp);
    return;
  }

  if (message.recalled) {
    messageDiv.className = 'message system-message';
    messageDiv.dataset.msgId = message.id;
    messageDiv.innerHTML = '<div class="message-recalled">消息已撤回</div>';
    if (prepend) {
      container.insertBefore(messageDiv, loadMoreTip ? loadMoreTip.nextSibling : container.firstChild);
    } else {
      container.appendChild(messageDiv);
      container.scrollTop = container.scrollHeight;
    }
    updateEarliestTimestamp(message.timestamp);
    return;
  }

  const isSent = message.username === username;
  const isBot = message.username === BOT_NAME;
  const avatar = isBot ? '🤖' : getAvatarEmoji(message.username);
  messageDiv.className = `message ${isSent ? 'sent' : 'received'}`;
  if (message.id) {
    messageDiv.dataset.msgId = message.id;
  }

  const time = new Date(message.timestamp);
  const timeStr = time.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

  if (!onlineUsers.includes(message.username)) {
    onlineUsers.push(message.username);
  }

  let displayName = isSent ? '我' : escapeHtml(message.username);
  if (isBot) {
    displayName += '<span class="message-bot-badge">AI</span>';
  }

  let contentHtml;
  if (message.type === 'typing') {
    contentHtml = '<div class="typing-dots"><span></span><span></span><span></span></div>';
  } else if (message.type === 'image' && message.imageUrl) {
    contentHtml = `
      <div class="message-image-wrapper">
        <div class="message-image-loading">⏳ 图片加载中...</div>
        <img data-original-url="${escapeHtml(message.imageUrl)}" class="message-image" onclick="previewImage('${escapeHtml(message.imageUrl)}')" alt="图片" onload="this.previousElementSibling.style.display='none'" onerror="this.style.display='none';this.previousElementSibling.textContent='❌ 图片加载失败'">
      </div>`;
  } else if (message.type === 'audio' && message.audioUrl) {
    const mins = Math.floor(message.duration / 60).toString().padStart(2, '0');
    const secs = (message.duration % 60).toString().padStart(2, '0');
    contentHtml = `
      <div class="message-audio">
        <button class="message-audio-play" data-original-url="${escapeHtml(message.audioUrl)}" onclick="toggleAudio(this)">▶</button>
        <div class="message-audio-progress">
          <div class="message-audio-progress-bar"></div>
        </div>
        <span class="message-audio-duration">${mins}:${secs}</span>
      </div>
    `;
  } else {
    contentHtml = formatMessageWithMentions(message.text);
  }

  let replyHtml = '';
  if (message.replyTo) {
    replyHtml = `<div class="message-reply"><span class="reply-label">引用 ${escapeHtml(message.replyTo.username)}:</span> ${escapeHtml(message.replyTo.text)}</div>`;
  }

  const likes = message.likes || [];
  const isLiked = likes.includes(userId);
  const canRecall = message.userId === userId && (Date.now() - message.timestamp < 120000);

  messageDiv.innerHTML = `
    <div class="message-avatar">${avatar}</div>
    <div class="message-body">
      <div class="message-username">${displayName}</div>
      ${replyHtml}
      <div class="message-content ${isBot ? 'type-bot' : ''}${message.text.includes('🎲') || message.text.includes('✊') ? ' type-game' : ''}">${contentHtml}</div>
      <div class="message-footer">
        <span class="message-time">${timeStr}</span>
        <div class="message-actions">
          <button class="msg-action like-action ${isLiked ? 'liked' : ''}" data-msg-id="${message.id}">
            ${isLiked ? '❤️' : '🤍'} <span class="like-count">${likes.length}</span>
          </button>
          ${canRecall ? `<button class="msg-action recall-action" data-msg-id="${message.id}">撤回</button>` : ''}
          <button class="msg-action reply-action" data-msg-id="${message.id}">引用</button>
        </div>
      </div>
    </div>
  `;

  const likeBtn = messageDiv.querySelector('.like-action');
  if (likeBtn) {
    likeBtn.addEventListener('click', (e) => {
      const rect = likeBtn.getBoundingClientRect();
      createHeartAnimation(rect.left + rect.width / 2, rect.top);
      socket.emit('likeMessage', { messageId: message.id });
    });
  }

  const recallBtn = messageDiv.querySelector('.recall-action');
  if (recallBtn) {
    recallBtn.addEventListener('click', () => {
      socket.emit('recallMessage', { messageId: message.id });
    });
  }

  const replyBtn = messageDiv.querySelector('.reply-action');
  if (replyBtn) {
    replyBtn.addEventListener('click', () => {
      setReplyTo(message);
    });
  }

  if (prepend) {
    container.insertBefore(messageDiv, loadMoreTip ? loadMoreTip.nextSibling : container.firstChild);
  } else {
    container.appendChild(messageDiv);
    container.scrollTop = container.scrollHeight;
  }
  
  updateEarliestTimestamp(message.timestamp);

  if (message.type === 'image' && message.imageUrl) {
    const img = messageDiv.querySelector('.message-image');
    if (img) {
      CacheDB.fetchAndCache(message.imageUrl).then(cachedUrl => {
        if (img && cachedUrl) {
          img.src = cachedUrl;
        }
      }).catch(() => {
        if (img) {
          img.src = message.imageUrl;
        }
      });
    }
  }
}

function updateEarliestTimestamp(timestamp) {
  if (!timestamp) return;
  if (window.__earliestTimestamp === undefined) {
    window.__earliestTimestamp = timestamp;
  } else if (timestamp < window.__earliestTimestamp) {
    window.__earliestTimestamp = timestamp;
  }
}

function renderPollMessage(message, container, prepend = false) {
  const poll = message.pollData;
  if (!poll) return;

  const totalVotes = Object.keys(poll.votes || {}).length;
  const counts = new Array(poll.options.length).fill(0);
  Object.values(poll.votes || {}).forEach(v => {
    if (v >= 0 && v < poll.options.length) counts[v]++;
  });

  const myVote = poll.votes ? poll.votes[username] : undefined;

  let optionsHtml = poll.options.map((opt, i) => {
    const count = counts[i] || 0;
    const percent = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
    const isVoted = myVote === i;
    return `
      <div class="poll-option ${isVoted ? 'voted' : ''}" data-index="${i}" data-poll-id="${poll.id}">
        <div class="poll-option-bar" style="width: ${percent}%"></div>
        <div class="poll-option-content">
          <span class="poll-option-text">${escapeHtml(opt)}</span>
          <span class="poll-option-count">${count} 票 (${percent}%)</span>
        </div>
        ${isVoted ? '<span class="poll-option-check">✓</span>' : ''}
      </div>
    `;
  }).join('');

  const div = document.createElement('div');
  div.className = 'poll-message';
  div.dataset.pollId = poll.id;
  div.innerHTML = `
    <div class="poll-header">
      <span class="poll-icon">📊</span>
      <span class="poll-question">${escapeHtml(poll.question)}</span>
    </div>
    <div class="poll-options">${optionsHtml}</div>
    <div class="poll-footer">
      <span>${totalVotes} 人参与投票</span>
      <span>${myVote !== undefined ? '你已投票' : '点击选项投票'}</span>
    </div>
  `;

  div.querySelectorAll('.poll-option').forEach(opt => {
    opt.addEventListener('click', () => {
      const idx = parseInt(opt.dataset.index);
      const pid = opt.dataset.pollId;
      socket.emit('vote', { pollId: pid, optionIndex: idx });
    });
  });

  const loadMoreTip = document.getElementById('loadMoreTip');
  if (prepend) {
    container.insertBefore(div, loadMoreTip ? loadMoreTip.nextSibling : container.firstChild);
  } else {
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  }
}

function updatePollDisplay(pollId, votes, options, question) {
  const pollDiv = document.querySelector(`.poll-message[data-poll-id="${pollId}"]`);
  if (!pollDiv) return;

  const totalVotes = Object.keys(votes).length;
  const counts = new Array(options.length).fill(0);
  Object.values(votes).forEach(v => {
    if (v >= 0 && v < options.length) counts[v]++;
  });

  const myVote = votes[username];

  pollDiv.querySelector('.poll-question').textContent = question;

  const optionsContainer = pollDiv.querySelector('.poll-options');
  optionsContainer.innerHTML = options.map((opt, i) => {
    const count = counts[i] || 0;
    const percent = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
    const isVoted = myVote === i;
    return `
      <div class="poll-option ${isVoted ? 'voted' : ''}" data-index="${i}" data-poll-id="${pollId}">
        <div class="poll-option-bar" style="width: ${percent}%"></div>
        <div class="poll-option-content">
          <span class="poll-option-text">${escapeHtml(opt)}</span>
          <span class="poll-option-count">${count} 票 (${percent}%)</span>
        </div>
        ${isVoted ? '<span class="poll-option-check">✓</span>' : ''}
      </div>
    `;
  }).join('');

  optionsContainer.querySelectorAll('.poll-option').forEach(opt => {
    opt.addEventListener('click', () => {
      const idx = parseInt(opt.dataset.index);
      const pid = opt.dataset.pollId;
      socket.emit('vote', { pollId: pid, optionIndex: idx });
    });
  });

  const footerSpans = pollDiv.querySelectorAll('.poll-footer span');
  if (footerSpans[0]) footerSpans[0].textContent = `${totalVotes} 人参与投票`;
  if (footerSpans[1]) footerSpans[1].textContent = myVote !== undefined ? '你已投票' : '点击选项投票';
}

function formatMessageWithMentions(text) {
  const escaped = escapeHtml(text);
  return escaped.replace(/@([^\s@]+)/g, '<span class="mention-highlight">@$1</span>');
}

function showMentionList(query) {
  const mentionList = document.getElementById('mentionList');
  const allUsers = [BOT_NAME, ...onlineUsers].filter((u, i, arr) => arr.indexOf(u) === i);
  const users = allUsers.filter(u => 
    u !== username && u.toLowerCase().includes(query.toLowerCase())
  );
  
  if (users.length === 0) {
    mentionList.classList.add('hidden');
    return;
  }
  
  selectedMentionIndex = 0;
  mentionList.innerHTML = users.map((user, index) => `
    <div class="mention-item ${index === 0 ? 'active' : ''}" data-username="${escapeHtml(user)}">
      <div class="mention-avatar">${escapeHtml(user.charAt(0).toUpperCase())}</div>
      <span class="mention-name">${escapeHtml(user)}</span>
    </div>
  `).join('');
  
  mentionList.classList.remove('hidden');
  
  mentionList.querySelectorAll('.mention-item').forEach(item => {
    item.addEventListener('click', () => {
      insertMention(item.dataset.username);
    });
  });
}

function hideMentionList() {
  document.getElementById('mentionList').classList.add('hidden');
  mentionStartPos = -1;
}

function insertMention(mentionUser) {
  const input = document.getElementById('messageInput');
  const text = input.value;
  const before = text.substring(0, mentionStartPos);
  const after = text.substring(input.selectionStart);
  
  const newText = before + '@' + mentionUser + ' ' + after;
  input.value = newText;
  
  const cursorPos = before.length + mentionUser.length + 2;
  input.focus();
  input.setSelectionRange(cursorPos, cursorPos);
  
  hideMentionList();
}

function handleMentionInput() {
  const input = document.getElementById('messageInput');
  const cursorPos = input.selectionStart;
  const text = input.value.substring(0, cursorPos);
  
  const lastAtIndex = text.lastIndexOf('@');
  
  if (lastAtIndex === -1) {
    hideMentionList();
    return;
  }
  
  const charBefore = lastAtIndex > 0 ? text[lastAtIndex - 1] : ' ';
  if (charBefore !== ' ' && lastAtIndex !== 0) {
    hideMentionList();
    return;
  }
  
  const query = text.substring(lastAtIndex + 1);
  if (query.includes(' ')) {
    hideMentionList();
    return;
  }
  
  mentionStartPos = lastAtIndex;
  showMentionList(query);
}

function navigateMentionList(direction) {
  const mentionList = document.getElementById('mentionList');
  const items = mentionList.querySelectorAll('.mention-item');
  
  if (items.length === 0) return;
  
  items[selectedMentionIndex].classList.remove('active');
  
  if (direction === 'down') {
    selectedMentionIndex = (selectedMentionIndex + 1) % items.length;
  } else {
    selectedMentionIndex = (selectedMentionIndex - 1 + items.length) % items.length;
  }
  
  items[selectedMentionIndex].classList.add('active');
  items[selectedMentionIndex].scrollIntoView({ block: 'nearest' });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

document.getElementById('joinBtn').addEventListener('click', () => joinChat());
document.getElementById('refreshNameBtn').addEventListener('click', () => {
  document.getElementById('usernameInput').value = generateRandomNickname();
});
document.getElementById('sendBtn').addEventListener('click', sendMessage);
document.getElementById('usernameInput').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') joinChat();
});
document.getElementById('roomIdInput').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') joinChat();
});

const messageInput = document.getElementById('messageInput');
messageInput.addEventListener('input', handleMentionInput);
messageInput.addEventListener('keydown', (e) => {
  const mentionList = document.getElementById('mentionList');
  const isMentionVisible = !mentionList.classList.contains('hidden');
  
  if (isMentionVisible) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      navigateMentionList('down');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      navigateMentionList('up');
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      const activeItem = mentionList.querySelector('.mention-item.active');
      if (activeItem) {
        insertMention(activeItem.dataset.username);
      }
    } else if (e.key === 'Escape') {
      hideMentionList();
    }
  } else if (e.key === 'Enter') {
    sendMessage();
  }
});

messageInput.addEventListener('blur', () => {
  setTimeout(hideMentionList, 200);
});

messageInput.addEventListener('focus', handleMentionInput);

window.addEventListener('load', () => {
  const savedUsername = localStorage.getItem('chat_username');
  const savedRoomId = localStorage.getItem('chat_room_id');
  const urlParams = new URLSearchParams(window.location.search);
  const urlRoomId = urlParams.get('room');

  if (savedUsername) {
    document.getElementById('usernameInput').value = savedUsername;
  } else {
    const randomName = generateRandomNickname();
    document.getElementById('usernameInput').value = randomName;
  }

  const initialRoomId = urlRoomId || savedRoomId;
  if (initialRoomId) {
    document.getElementById('roomIdInput').value = initialRoomId;
  }

  // 加载更多历史消息 - 点击按钮触发
  const messagesContainer = document.getElementById('messagesContainer');
  if (messagesContainer) {
    messagesContainer.addEventListener('scroll', () => {
      if (messagesContainer.scrollTop <= 5 && hasMoreHistory && !loadingHistory) {
        requestLoadMoreHistory();
      }
    });
  }

  document.addEventListener('click', (e) => {
    const tip = e.target.closest('#loadMoreTip');
    if (tip && !tip.classList.contains('no-more') && hasMoreHistory && !loadingHistory) {
      requestLoadMoreHistory();
    }
  });

  // 如果本地有登录信息，直接进入聊天界面，后台连接
  if (savedUsername && initialRoomId) {
    showChatScreen(savedUsername, initialRoomId);
  }

  // 页面从后台切回前台时，主动重连
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && socket && socket.disconnected) {
      socket.connect();
    }
  });

  connectSocket();
});

function showChatScreen(name, roomId) {
  username = name;
  currentRoomId = roomId;
  if (!userId) userId = getOrCreateUserId();

  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('chatScreen').classList.remove('hidden');

  const roomBadge = document.getElementById('roomBadge');
  roomBadge.textContent = roomId;
  roomBadge.classList.remove('hidden');

  document.getElementById('shareBtn').classList.remove('hidden');
  document.getElementById('editNameBtn').classList.remove('hidden');
  document.getElementById('switchRoomBtn').classList.remove('hidden');
  
  // 移动端显示成员按钮
  if (window.innerWidth <= 600) {
    document.getElementById('membersToggle').classList.remove('hidden');
  }

  // 恢复公告折叠状态
  const bar = document.getElementById('announcementBar');
  const collapsed = localStorage.getItem('announcement_collapsed_' + roomId);
  if (collapsed === '1') {
    bar.classList.add('collapsed');
  } else {
    bar.classList.remove('collapsed');
  }
}

function joinChat(name, roomId) {
  const usernameInput = document.getElementById('usernameInput');
  const roomIdInput = document.getElementById('roomIdInput');
  const nameToUse = (typeof name === 'string' && name) || usernameInput.value.trim();
  const roomIdToUse = (typeof roomId === 'string' && roomId) || roomIdInput.value.trim();

  if (!nameToUse) {
    usernameInput.focus();
    return;
  }
  if (!roomIdToUse) {
    roomIdInput.focus();
    return;
  }

  username = nameToUse;
  currentRoomId = roomIdToUse;
  if (!userId) userId = getOrCreateUserId();
  localStorage.setItem('chat_username', nameToUse);
  localStorage.setItem('chat_room_id', roomIdToUse);

  showChatScreen(nameToUse, roomIdToUse);

  const container = document.getElementById('messagesContainer');
  container.innerHTML = '<div id="loadMoreTip" class="load-more-tip">下拉加载更多历史消息...</div>';
  onlineUsers = [];
  window.__earliestTimestamp = undefined;
  hasMoreHistory = true;
  loadingHistory = false;

  socket.emit('join', { roomId: roomIdToUse, username: nameToUse, userId });

  document.getElementById('messageInput').focus();
}

function getShareUrl() {
  const url = new URL(window.location.href);
  url.searchParams.set('room', currentRoomId);
  return url.toString();
}

async function generateQRCode() {
  const qrcodeEl = document.getElementById('qrcode');
  qrcodeEl.innerHTML = '';
  try {
    if (window.QRCode) {
      new QRCode(qrcodeEl, {
        text: getShareUrl(),
        width: 180,
        height: 180,
        colorDark: '#000000',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.H
      });
    }
  } catch (e) {
    console.error('二维码生成失败:', e);
  }
}

function openShareModal() {
  document.getElementById('shareCardRoom').textContent = currentRoomId;
  document.getElementById('shareCardRoomId').textContent = `Room ID: ${currentRoomId}`;
  document.getElementById('shareCardOnline').textContent = `👥 ${onlineUsers.length} 人在线`;
  document.getElementById('shareModal').classList.remove('hidden');
  setTimeout(generateQRCode, 150);
}

function closeShareModal() {
  document.getElementById('shareModal').classList.add('hidden');
}

function copyShareLink() {
  const url = getShareUrl();
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(() => {
      showToast('链接已复制', 'success');
    }).catch(() => {
      fallbackCopy(url);
    });
  } else {
    fallbackCopy(url);
  }
}

function fallbackCopy(text) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand('copy');
    showToast('链接已复制', 'success');
  } catch (e) {
    showToast('复制失败', 'error');
  }
  document.body.removeChild(textarea);
}

async function saveShareImage() {
  const card = document.getElementById('shareCard');
  try {
    if (window.html2canvas) {
      const canvas = await html2canvas(card, {
        backgroundColor: null,
        scale: 2,
        useCORS: true
      });
      const link = document.createElement('a');
      link.download = `分享卡片-${currentRoomId}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
      showToast('图片已保存');
    } else {
      showToast('图片保存功能暂不可用');
    }
  } catch (e) {
    console.error('保存图片失败:', e);
    showToast('保存图片失败');
  }
}

function showToast(msg, type = '') {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.remove('success', 'error');
  if (type) toast.classList.add(type);
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
  }, 2000);
}

document.getElementById('shareBtn').addEventListener('click', openShareModal);
document.getElementById('shareCloseBtn').addEventListener('click', closeShareModal);
document.querySelector('.share-modal-overlay').addEventListener('click', closeShareModal);
document.getElementById('copyLinkBtn').addEventListener('click', copyShareLink);
document.getElementById('saveImageBtn').addEventListener('click', saveShareImage);

function openEditNameModal() {
  document.getElementById('newNameInput').value = username;
  document.getElementById('editNameModal').classList.remove('hidden');
  setTimeout(() => document.getElementById('newNameInput').focus(), 100);
}

function closeEditNameModal() {
  document.getElementById('editNameModal').classList.add('hidden');
}

function confirmEditName() {
  const newName = document.getElementById('newNameInput').value.trim();
  if (!newName) {
    showToast('昵称不能为空', 'error');
    return;
  }
  if (newName === username) {
    closeEditNameModal();
    return;
  }
  socket.emit('updateUsername', { newUsername: newName });
  closeEditNameModal();
}

document.getElementById('editNameBtn').addEventListener('click', openEditNameModal);
document.getElementById('editNameCloseBtn').addEventListener('click', closeEditNameModal);
document.getElementById('cancelEditNameBtn').addEventListener('click', closeEditNameModal);
document.getElementById('confirmEditNameBtn').addEventListener('click', confirmEditName);
document.getElementById('newNameInput').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') confirmEditName();
});
document.getElementById('announcementToggle').addEventListener('click', toggleAnnouncement);

// 移动端侧边栏
document.getElementById('membersToggle').addEventListener('click', toggleMembersSidebar);
document.getElementById('membersSidebarOverlay').addEventListener('click', closeMembersSidebar);

// 窗口大小变化时处理
window.addEventListener('resize', () => {
  const membersToggle = document.getElementById('membersToggle');
  if (window.innerWidth <= 600) {
    membersToggle.classList.remove('hidden');
  } else {
    membersToggle.classList.add('hidden');
    closeMembersSidebar();
  }
});

document.getElementById('rollDiceBtn').addEventListener('click', rollDice);
document.getElementById('rockPaperScissorsBtn').addEventListener('click', playRockPaperScissors);
document.getElementById('uploadImageBtn').addEventListener('click', () => {
  document.getElementById('imageInput').click();
});
document.getElementById('imageInput').addEventListener('change', handleImageUpload);
document.getElementById('recordVoiceBtn').addEventListener('click', startVoiceRecording);
document.getElementById('cancelVoiceBtn').addEventListener('click', cancelVoiceRecording);
document.getElementById('sendVoiceBtn').addEventListener('click', sendVoiceMessage);

document.getElementById('plusBtn').addEventListener('click', togglePlusPanel);
document.getElementById('cancelReplyBtn').addEventListener('click', cancelReply);

renderEmojiPanel();
initPlusPanel();

// 点击面板外部关闭
let plusPanelOpen = false;
document.getElementById('plusBtn').addEventListener('click', () => {
  plusPanelOpen = !document.getElementById('plusPanel').classList.contains('hidden');
});
document.addEventListener('click', (e) => {
  const panel = document.getElementById('plusPanel');
  const btn = document.getElementById('plusBtn');
  if (!panel.classList.contains('hidden') && !panel.contains(e.target) && !btn.contains(e.target)) {
    panel.classList.add('hidden');
  }
});

// 切换房间功能
function openSwitchRoomModal() {
  document.getElementById('newRoomIdInput').value = '';
  document.getElementById('switchRoomModal').classList.remove('hidden');
  setTimeout(() => document.getElementById('newRoomIdInput').focus(), 100);
}

function closeSwitchRoomModal() {
  document.getElementById('switchRoomModal').classList.add('hidden');
}

function confirmSwitchRoom() {
  const newRoomId = document.getElementById('newRoomIdInput').value.trim();
  if (!newRoomId) {
    showToast('请输入房间ID', 'error');
    return;
  }
  if (newRoomId === currentRoomId) {
    showToast('已经在该房间了', 'error');
    closeSwitchRoomModal();
    return;
  }

  // 清空消息列表
  const container = document.getElementById('messagesContainer');
  container.innerHTML = '<div id="loadMoreTip" class="load-more-tip">下拉加载更多历史消息...</div>';
  onlineUsers = [];
  window.__earliestTimestamp = undefined;
  hasMoreHistory = true;
  loadingHistory = false;

  // 更新当前房间
  currentRoomId = newRoomId;
  localStorage.setItem('chat_room_id', newRoomId);

  // 更新房间显示
  document.getElementById('roomBadge').textContent = newRoomId;

  // 加入新房间（服务器会自动处理离开之前的房间）
  if (socket && socket.connected) {
    socket.emit('join', { roomId: newRoomId, username, userId });
  }

  closeSwitchRoomModal();
  showToast(`已切换到房间: ${newRoomId}`, 'success');
}

document.getElementById('switchRoomBtn').addEventListener('click', openSwitchRoomModal);
document.getElementById('switchRoomCloseBtn').addEventListener('click', closeSwitchRoomModal);
document.querySelector('#switchRoomModal .share-modal-overlay').addEventListener('click', closeSwitchRoomModal);
document.getElementById('cancelSwitchRoomBtn').addEventListener('click', closeSwitchRoomModal);
document.getElementById('confirmSwitchRoomBtn').addEventListener('click', confirmSwitchRoom);
document.getElementById('newRoomIdInput').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') confirmSwitchRoom();
});
