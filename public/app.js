const BOT_NAME = '小助手';

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

let username = '';
let currentRoomId = '';
let socket = null;
let onlineUsers = [];
let mentionStartPos = -1;
let selectedMentionIndex = 0;
let typingMessageIds = new Set();
let replyingTo = null;
let hasMoreHistory = true;
let loadingHistory = false;

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
    reconnectionDelay: 1000,
    reconnectionDelayMax: MAX_RECONNECT_DELAY,
    reconnectionAttempts: Infinity,
    timeout: 20000,
    pingInterval: 15000,
    pingTimeout: 10000
  });

  socket.on('connect', () => {
    reconnectAttempt = 0;
    updateUserStatus('已连接');

    if (username && currentRoomId) {
      document.getElementById('messagesContainer').innerHTML = '';
      onlineUsers = [];
      socket.emit('join', { roomId: currentRoomId, username: username });
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

    // 保持滚动位置：插入历史消息后让用户视觉位置不变
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
      if (tip) tip.textContent = '下拉加载更多历史消息...';
    }
  });

  socket.on('messageLiked', ({ messageId, likes }) => {
    const msgEl = document.querySelector(`[data-msg-id="${messageId}"]`);
    if (msgEl) {
      const likeCount = msgEl.querySelector('.like-count');
      const likeBtn = msgEl.querySelector('.like-action');
      if (likeCount) likeCount.textContent = likes.length;
      if (likeBtn) {
        const isLiked = likes.includes(username);
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

function toggleEmojiPanel() {
  const panel = document.getElementById('emojiPanel');
  panel.classList.toggle('hidden');
}

function insertEmoji(emoji) {
  const input = document.getElementById('messageInput');
  input.value += emoji;
  input.focus();
  document.getElementById('emojiPanel').classList.add('hidden');
}

function renderEmojiPanel() {
  const panel = document.getElementById('emojiPanel');
  panel.innerHTML = EMOJIS.map(e => `<button class="emoji-btn" data-emoji="${e}">${e}</button>`).join('');
  panel.querySelectorAll('.emoji-btn').forEach(btn => {
    btn.addEventListener('click', () => insertEmoji(btn.dataset.emoji));
  });
}

function requestLoadMoreHistory() {
  if (!hasMoreHistory || loadingHistory || !socket) return;

  const container = document.getElementById('messagesContainer');
  if (!container) return;

  // 找最早的一条消息的 timestamp
  let earliestTs = null;
  const firstMsg = container.querySelector('[data-msg-id]');
  if (firstMsg) {
    // 从已知集合里取最小 timestamp
    earliestTs = window.__earliestTimestamp || null;
  }

  // 如果容器里没消息，从服务器拉取一次
  if (earliestTs === null) {
    // 进入聊天时已经拉过 20 条，这里仅做兜底
    return;
  }

  loadingHistory = true;
  const tip = document.getElementById('loadMoreTip');
  if (tip) tip.textContent = '加载中...';

  socket.emit('loadMoreHistory', { beforeTimestamp: earliestTs });
}

function displayMessage(message, prepend = false) {
  const container = document.getElementById('messagesContainer');

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
      container.insertBefore(messageDiv, container.firstChild);
    } else {
      container.appendChild(messageDiv);
      container.scrollTop = container.scrollHeight;
    }
    if (message.timestamp && (window.__earliestTimestamp === undefined || message.timestamp < window.__earliestTimestamp)) {
      window.__earliestTimestamp = message.timestamp;
    }
    return;
  }

  if (message.recalled) {
    messageDiv.className = 'message system-message';
    messageDiv.dataset.msgId = message.id;
    messageDiv.innerHTML = '<div class="message-recalled">消息已撤回</div>';
    if (prepend) {
      container.insertBefore(messageDiv, container.firstChild);
    } else {
      container.appendChild(messageDiv);
      container.scrollTop = container.scrollHeight;
    }
    if (message.timestamp && (window.__earliestTimestamp === undefined || message.timestamp < window.__earliestTimestamp)) {
      window.__earliestTimestamp = message.timestamp;
    }
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
  } else {
    contentHtml = formatMessageWithMentions(message.text);
  }

  let replyHtml = '';
  if (message.replyTo) {
    replyHtml = `<div class="message-reply"><span class="reply-label">引用 ${escapeHtml(message.replyTo.username)}:</span> ${escapeHtml(message.replyTo.text)}</div>`;
  }

  const likes = message.likes || [];
  const isLiked = likes.includes(username);
  const canRecall = isSent && (Date.now() - message.timestamp < 120000);

  messageDiv.innerHTML = `
    <div class="message-avatar">${avatar}</div>
    <div class="message-body">
      <div class="message-username">${displayName}</div>
      ${replyHtml}
      <div class="message-content">${contentHtml}</div>
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
    likeBtn.addEventListener('click', () => {
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
    container.insertBefore(messageDiv, container.firstChild);
    if (message.timestamp && (window.__earliestTimestamp === undefined || message.timestamp < window.__earliestTimestamp)) {
      window.__earliestTimestamp = message.timestamp;
    }
  } else {
    container.appendChild(messageDiv);
    container.scrollTop = container.scrollHeight;
    if (message.timestamp && (window.__earliestTimestamp === undefined || message.timestamp < window.__earliestTimestamp)) {
      window.__earliestTimestamp = message.timestamp;
    }
  }
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
  }

  const initialRoomId = urlRoomId || savedRoomId;
  if (initialRoomId) {
    document.getElementById('roomIdInput').value = initialRoomId;
  }

  // 挂载下拉加载历史的滚动监听器
  const messagesContainer = document.getElementById('messagesContainer');
  if (messagesContainer) {
    messagesContainer.addEventListener('scroll', () => {
      if (messagesContainer.scrollTop <= 30) {
        requestLoadMoreHistory();
      }
    });
  }

  // 阻止移动端下拉刷新（整页 overscroll）
  document.body.addEventListener('touchmove', (e) => {
    if (e.target.closest('.messages-container, .emoji-panel, .mention-list, .members-list, input, textarea')) {
      return;
    }
  }, { passive: true });

  // 如果本地有登录信息，直接进入聊天界面，后台连接
  if (savedUsername && initialRoomId) {
    showChatScreen(savedUsername, initialRoomId);
  }

  connectSocket();
});

function showChatScreen(name, roomId) {
  username = name;
  currentRoomId = roomId;

  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('chatScreen').classList.remove('hidden');

  const roomBadge = document.getElementById('roomBadge');
  roomBadge.textContent = roomId;
  roomBadge.classList.remove('hidden');

  document.getElementById('shareBtn').classList.remove('hidden');
  
  // 移动端显示成员按钮
  if (window.innerWidth <= 600) {
    document.getElementById('membersToggle').classList.remove('hidden');
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
  localStorage.setItem('chat_username', nameToUse);
  localStorage.setItem('chat_room_id', roomIdToUse);

  showChatScreen(nameToUse, roomIdToUse);

  document.getElementById('messagesContainer').innerHTML = '';
  onlineUsers = [];
  window.__earliestTimestamp = undefined;
  hasMoreHistory = true;
  loadingHistory = false;
  const tip = document.getElementById('loadMoreTip');
  if (tip) {
    tip.textContent = '下拉加载更多历史消息...';
    tip.classList.remove('no-more');
  }

  socket.emit('join', { roomId: roomIdToUse, username: nameToUse });

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

document.getElementById('emojiBtn').addEventListener('click', toggleEmojiPanel);
document.getElementById('cancelReplyBtn').addEventListener('click', cancelReply);

renderEmojiPanel();
