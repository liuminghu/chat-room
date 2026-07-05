const firebaseConfig = {
  apiKey: "AIzaSyCaScHr69e9DCuryeTj0upmhgzQZDTGOdI",
  authDomain: "chat-room-demo-e837c.firebaseapp.com",
  databaseURL: "https://chat-room-demo-e837c-default-rtdb.firebaseio.com",
  projectId: "chat-room-demo-e837c",
  storageBucket: "chat-room-demo-e837c.firebasestorage.app",
  messagingSenderId: "503903612427",
  appId: "1:503903612427:web:cfe6ba1a23779e5343a10e"
};

let username = '';
let database = null;
let onlineUsers = new Set();
let mentionStartPos = -1;
let selectedMentionIndex = 0;

function initFirebase() {
  if (firebaseConfig.apiKey === 'YOUR_API_KEY') {
    console.warn('请先配置 Firebase 配置信息');
    return false;
  }
  
  try {
    firebase.initializeApp(firebaseConfig);
    database = firebase.database();
    updateUserStatus('已连接');
    return true;
  } catch (error) {
    console.error('Firebase 初始化失败:', error);
    updateUserStatus('连接失败');
    return false;
  }
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
  
  if (database) {
    listenForMessages();
    addSystemMessage(`${username} 加入了聊天室`);
  } else {
    loadLocalMessages();
    addSystemMessage(`欢迎 ${username}！（本地模式）`);
  }
  
  document.getElementById('messageInput').focus();
}

function sendMessage() {
  const input = document.getElementById('messageInput');
  const text = input.value.trim();
  
  if (!text) return;
  
  const messageData = {
    username: username,
    text: text,
    timestamp: Date.now()
  };
  
  if (database) {
    database.ref('messages').push(messageData);
  } else {
    saveLocalMessage(messageData);
    displayMessage(messageData);
  }
  
  input.value = '';
  input.focus();
}

function displayMessage(message) {
  const container = document.getElementById('messagesContainer');
  const messageDiv = document.createElement('div');
  
  const isSent = message.username === username;
  messageDiv.className = `message ${isSent ? 'sent' : 'received'}`;
  
  const time = new Date(message.timestamp);
  const timeStr = time.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  
  onlineUsers.add(message.username);
  
  messageDiv.innerHTML = `
    <div class="message-username">${isSent ? '我' : escapeHtml(message.username)}</div>
    <div class="message-content">${formatMessageWithMentions(message.text)}</div>
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
  const users = Array.from(onlineUsers).filter(u => 
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

function addSystemMessage(text) {
  const container = document.getElementById('messagesContainer');
  const messageDiv = document.createElement('div');
  messageDiv.className = 'system-message';
  messageDiv.textContent = text;
  container.appendChild(messageDiv);
  container.scrollTop = container.scrollHeight;
}

function listenForMessages() {
  const messagesRef = database.ref('messages').limitToLast(100);
  
  messagesRef.on('child_added', (snapshot) => {
    const message = snapshot.val();
    displayMessage(message);
  });
}

function saveLocalMessage(message) {
  let messages = JSON.parse(localStorage.getItem('chat_messages') || '[]');
  messages.push(message);
  if (messages.length > 100) {
    messages = messages.slice(-100);
  }
  localStorage.setItem('chat_messages', JSON.stringify(messages));
}

function loadLocalMessages() {
  const messages = JSON.parse(localStorage.getItem('chat_messages') || '[]');
  messages.forEach(msg => displayMessage(msg));
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
  
  initFirebase();
});
