const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { tavily } = require('@tavily/core');

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
const TAVILY_API_KEY = process.env.TAVILY_API_KEY || '';
const BOT_NAME = '小助手';

let tvly = null;
if (TAVILY_API_KEY) {
  tvly = tavily({ apiKey: TAVILY_API_KEY });
}

let messages = [];
let users = new Map();

io.on('connection', (socket) => {
  console.log('用户连接:', socket.id);

  socket.emit('history', messages.slice(-100));
  
  const userList = Array.from(new Set(users.values()));
  socket.emit('userList', userList);

  socket.on('join', (username) => {
    users.set(socket.id, username);
    const userList = Array.from(new Set(users.values()));
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
      const userList = Array.from(new Set(users.values()));
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

function needsWebSearch(text) {
  if (!TAVILY_API_KEY || !tvly) return false;
  const keywords = ['天气', '今天', '最新', '现在', '近期', '新闻', '价格', '股价', '行情', '多少岁', '几岁', '身高', '体重', '怎么', '如何', '什么是', '介绍一下', '百度', '搜索', '查一下', '帮我找', '2025', '2026', '今年', '昨天', '明天', '最近'];
  const lowerText = text.toLowerCase();
  return keywords.some(kw => lowerText.includes(kw));
}

async function searchWeb(query) {
  if (!tvly) return null;
  try {
    const results = await tvly.search(query, {
      search_depth: 'basic',
      max_results: 5,
      include_answer: false
    });
    return results;
  } catch (err) {
    console.error('搜索失败:', err);
    return null;
  }
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
    let searchResults = null;
    if (needsWebSearch(cleanText)) {
      searchResults = await searchWeb(cleanText);
    }
    
    const response = await callDeepSeekAPI(botConversationHistory, searchResults);
    
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

async function callDeepSeekAPI(messages, searchResults = null) {
  let systemContent = '你是一个友好的群聊助手，叫"小助手"。请用简洁、亲切的语气回答问题。回复不要太长，尽量控制在200字以内。';
  
  if (searchResults && searchResults.results && searchResults.results.length > 0) {
    const searchContext = searchResults.results.map((r, i) => 
      `[${i+1}] ${r.title}\n${r.content}\n来源: ${r.url}`
    ).join('\n\n');
    systemContent += `\n\n以下是联网搜索到的最新信息，请基于这些信息回答问题：\n${searchContext}\n\n回答时可以在末尾标注信息来源。`;
  }

  const systemPrompt = {
    role: 'system',
    content: systemContent
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
      max_tokens: 800
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API 请求失败: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  return data.choices[0].message.content.trim();
}

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', onlineUsers: users.size, hasDeepSeekKey: !!DEEPSEEK_API_KEY, hasTavilyKey: !!TAVILY_API_KEY });
});

server.listen(PORT, () => {
  console.log(`服务器运行在 http://localhost:${PORT}`);
});

module.exports = app;
