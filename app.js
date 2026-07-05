const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT-default-rtdb.firebaseio.com",
  projectId: "YOUR_PROJECT",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

let username = '';
let database = null;

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
  
  messageDiv.innerHTML = `
    <div class="message-username">${isSent ? '我' : escapeHtml(message.username)}</div>
    <div class="message-content">${escapeHtml(message.text)}</div>
    <div class="message-time">${timeStr}</div>
  `;
  
  container.appendChild(messageDiv);
  container.scrollTop = container.scrollHeight;
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
document.getElementById('messageInput').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') sendMessage();
});

window.addEventListener('load', () => {
  const savedUsername = localStorage.getItem('chat_username');
  if (savedUsername) {
    document.getElementById('usernameInput').value = savedUsername;
  }
  
  initFirebase();
});
