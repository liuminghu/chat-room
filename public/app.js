const BOT_NAME = '小助手';

let username = '';
let socket = null;
let onlineUsers = [];
let mentionStartPos = -1;
let selectedMentionIndex = 0;
let typingMessageIds = new Set();

function getSocketUrl() {
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return window.location.origin;
  }
  return window.location.origin;
}

function connectSocket() {
  socket = io(getSocketUrl(), {
    transports: ['websocket', 'polling']
  });

  socket.on('connect', () => {
    updateUserStatus('已连接');
  });

  socket.on('disconnect', () => {
    updateUserStatus('已断开');
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
}

function renderMembersList(users) {
  const membersList = document.getElementById('membersList');
  const allMembers = [BOT_NAME, ...users].filter((u, i, arr) => arr.indexOf(u) === i);
  
  membersList.innerHTML = allMembers.map(member => {
    const isBot = member === BOT_NAME;
    const isOnline = isBot || users.includes(member);
    const isMe = member === username;
    const avatar = isBot ? '🤖' : escapeHtml(member.charAt(0).toUpperCase());
    
    return `
      <div class="member-item ${isMe ? 'me' : ''}">
        <span class="member-avatar">${avatar}</span>
        <span class="member-name">${isMe ? '我' : escapeHtml(member)}</span>
        <span class="member-status ${isOnline ? 'online' : ''}"></span>
      </div>
    `;
  }).join('');
}

function updateUserStatus(status) {
  document.getElementById('userStatus').textContent = status;
}

function joinChat() {
  const input = document.getElementById('usernameInput');
  const name = input.value.trim();
  
  if (!name) {
    input.focus();
    return;
  }
  
  username = name;
  localStorage.setItem('chat_username', name);
  
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('chatScreen').classList.remove('hidden');
  
  socket.emit('join', name);
  
  document.getElementById('messageInput').focus();
}

function sendMessage() {
  const input = document.getElementById('messageInput');
  const text = input.value.trim();
  
  if (!text || !socket) return;
  
  socket.emit('message', { text: text });
  
  input.value = '';
  input.focus();
  hideMentionList();
}

function displayMessage(message) {
  const container = document.getElementById('messagesContainer');
  
  if (message.id && typingMessageIds.has(message.id)) {
    return;
  }

  if (message.type === 'typing') {
    typingMessageIds.add(message.id);
  }

  const messageDiv = document.createElement('div');
  
  if (message.type === 'system') {
    messageDiv.className = 'system-message';
    const time = new Date(message.timestamp);
    const timeStr = time.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    messageDiv.textContent = message.text;
    messageDiv.title = timeStr;
    container.appendChild(messageDiv);
    container.scrollTop = container.scrollHeight;
    return;
  }
  
  const isSent = message.username === username;
  const isBot = message.username === BOT_NAME;
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
  
  messageDiv.innerHTML = `
    <div class="message-username">${displayName}</div>
    <div class="message-content">${contentHtml}</div>
    <div class="message-time">${timeStr}</div>
  `;
  
  container.appendChild(messageDiv);
  container.scrollTop = container.scrollHeight;
}

function formatMessageWithMentions(text) {
  const escaped = escapeHtml(text);
  return escaped.replace(/@([^\s@]+)/g, '<span class="mention-highlight">@$1</span>');
}

function showMentionList(query) {
  const mentionList = document.getElementById('mentionList');
  const users = onlineUsers.filter(u => 
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

document.getElementById('joinBtn').addEventListener('click', joinChat);
document.getElementById('sendBtn').addEventListener('click', sendMessage);
document.getElementById('usernameInput').addEventListener('keypress', (e) => {
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
  if (savedUsername) {
    document.getElementById('usernameInput').value = savedUsername;
  }
  
  connectSocket();
});
