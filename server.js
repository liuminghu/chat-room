const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const BOT_NAME = '小助手';

let messages = [];
let users = new Map();

io.on('connection', (socket) => {
  console.log('用户连接:', socket.id);

  socket.emit('history', messages.slice(-100));
  
  const userList = Array.from(new Set(users.values())).concat(BOT_NAME);
  socket.emit('userList', userList);

  socket.on('join', (username) => {
    users.set(socket.id, username);
    const userList = Array.from(new Set(users.values())).concat(BOT_NAME);
    io.emit('userList', userList);
    
    const systemMsg = {
      id: Date.now() + Math.random(),
      type: 'system',
      text: `${username} 加入了聊天室`,
      timestamp: Date.now()
    };
    messages.push(systemMsg);
    if (messages.length > 500) messages = messages.slice(-500);
    io.emit('message', systemMsg);
  });

  socket.on('message', async (data) => {
    const username = users.get(socket.id) || '匿名';
    const msg = {
      id: Date.now() + Math.random(),
      type: 'message',
      username: username,
      text: data.text,
      timestamp: Date.now()
    };
    
    messages.push(msg);
    if (messages.length > 500) messages = messages.slice(-500);
    io.emit('message', msg);

    if (shouldTriggerBot(data.text, username)) {
      await handleBotReply(data.text, username);
    }
  });

  socket.on('disconnect', () => {
    const username = users.get(socket.id);
    if (username) {
      users.delete(socket.id);
      const userList = Array.from(new Set(users.values())).concat(BOT_NAME);
      io.emit('userList', userList);
      
      const systemMsg = {
        id: Date.now() + Math.random(),
        type: 'system',
        text: `${username} 离开了聊天室`,
        timestamp: Date.now()
      };
      messages.push(systemMsg);
      if (messages.length > 500) messages = messages.slice(-500);
      io.emit('message', systemMsg);
    }
    console.log('用户断开:', socket.id);
  });
});

function shouldTriggerBot(text, username) {
  if (!DEEPSEEK_API_KEY) return false;
  if (username === BOT_NAME) return false;
  return text.includes('@' + BOT_NAME) || text.startsWith('小助手');
}

let botConversationHistory = [];

async function handleBotReply(userText, fromUser) {
  const cleanText = userText.replace(/@小助手/g, '').trim();
  
  botConversationHistory.push({
    role: 'user',
    content: cleanText
  });
  
  if (botConversationHistory.length > 20) {
    botConversationHistory = botConversationHistory.slice(-20);
  }

  const typingMsg = {
    id: Date.now() + Math.random(),
    type: 'typing',
    username: BOT_NAME,
    timestamp: Date.now()
  };
  io.emit('message', typingMsg);

  try {
    const response = await callDeepSeekAPI(botConversationHistory);
    
    botConversationHistory.push({
      role: 'assistant',
      content: response
    });

    io.emit('removeTyping', typingMsg.id);

    const botMsg = {
      id: Date.now() + Math.random(),
      type: 'message',
      username: BOT_NAME,
      text: response,
      timestamp: Date.now()
    };
    
    messages.push(botMsg);
    if (messages.length > 500) messages = messages.slice(-500);
    io.emit('message', botMsg);
  } catch (error) {
    console.error('机器人回复失败:', error);
    io.emit('removeTyping', typingMsg.id);
    
    const errorMsg = {
      id: Date.now() + Math.random(),
      type: 'message',
      username: BOT_NAME,
      text: `抱歉，我遇到了一点小问题: ${error.message}`,
      timestamp: Date.now()
    };
    
    messages.push(errorMsg);
    if (messages.length > 500) messages = messages.slice(-500);
    io.emit('message', errorMsg);
  }
}

async function callDeepSeekAPI(messages) {
  const systemPrompt = {
    role: 'system',
    content: '你是一个友好的群聊助手，叫"小助手"。请用简洁、亲切的语气回答问题。回复不要太长，尽量控制在200字以内。'
  };

  const requestMessages = [systemPrompt, ...messages];

  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + DEEPSEEK_API_KEY
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: requestMessages,
      temperature: 0.7,
      max_tokens: 500
    })
  });

  if (!response.ok) {
    throw new Error('API 请求失败: ' + response.status);
  }

  const data = await response.json();
  return data.choices[0].message.content.trim();
}

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', onlineUsers: users.size, hasApiKey: !!DEEPSEEK_API_KEY });
});

server.listen(PORT, () => {
  console.log(`服务器运行在 http://localhost:${PORT}`);
});

module.exports = app;
