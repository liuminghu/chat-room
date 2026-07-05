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
  },
  pingInterval: 15000,
  pingTimeout: 10000,
  connectTimeout: 20000
});

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const TAVILY_API_KEY = process.env.TAVILY_API_KEY || '';
const FIREBASE_DB_URL = process.env.FIREBASE_DB_URL || 'https://chat-room-demo-e837c-default-rtdb.firebaseio.com';
const BOT_NAME = '小助手';
const DEFAULT_ROOM = 'public';

let tvly = null;
if (TAVILY_API_KEY) {
  tvly = tavily({ apiKey: TAVILY_API_KEY });
}

// 房间数据：roomId -> { messages: [], users: Map(socketId -> username), loaded: boolean }
const rooms = new Map();
const roomLoadPromises = new Map();

async function getOrLoadRoom(roomId) {
  if (rooms.has(roomId)) {
    return rooms.get(roomId);
  }

  if (roomLoadPromises.has(roomId)) {
    return roomLoadPromises.get(roomId);
  }

  const loadPromise = (async () => {
    const history = await loadMessagesFromFirebase(roomId);
    const room = {
      messages: history,
      users: new Map(),
      loaded: true
    };
    rooms.set(roomId, room);
    roomLoadPromises.delete(roomId);
    console.log(`房间 ${roomId} 已从 Firebase 加载 ${history.length} 条历史消息`);
    return room;
  })();

  roomLoadPromises.set(roomId, loadPromise);
  return loadPromise;
}

// Firebase 消息持久化（按房间区分）
async function saveMessageToFirebase(roomId, msg) {
  try {
    await fetch(`${FIREBASE_DB_URL}/rooms/${roomId}/messages.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(msg)
    });
  } catch (err) {
    console.error('Firebase 保存失败:', err);
  }
}

async function loadMessagesFromFirebase(roomId) {
  try {
    const res = await fetch(`${FIREBASE_DB_URL}/rooms/${roomId}/messages.json?limitToLast=100`);
    if (!res.ok) return [];
    const data = await res.json();
    if (!data) return [];
    const arr = Object.values(data);
    return arr.sort((a, b) => a.timestamp - b.timestamp);
  } catch (err) {
    console.error('Firebase 加载失败:', err);
    return [];
  }
}

io.on('connection', (socket) => {
  console.log('用户连接:', socket.id);

  socket.on('join', async ({ roomId, username }) => {
    const finalRoomId = (roomId && roomId.trim()) || DEFAULT_ROOM;
    const finalUsername = (username && username.trim()) || '匿名';

    // 离开之前加入的房间
    const previousRooms = Array.from(socket.rooms).filter(r => r !== socket.id);
    previousRooms.forEach(r => {
      const prevRoom = rooms.get(r);
      if (prevRoom) {
        const prevName = prevRoom.users.get(socket.id);
        prevRoom.users.delete(socket.id);
        const prevUserList = Array.from(new Set(prevRoom.users.values()));
        io.to(r).emit('userList', prevUserList);
        if (prevName) {
          const leaveMsg = {
            id: Date.now() + Math.random(),
            type: 'system',
            text: `${prevName} 离开了聊天室`,
            timestamp: Date.now()
          };
          prevRoom.messages.push(leaveMsg);
          if (prevRoom.messages.length > 500) prevRoom.messages = prevRoom.messages.slice(-500);
          saveMessageToFirebase(r, leaveMsg);
          io.to(r).emit('message', leaveMsg);
        }
      }
      socket.leave(r);
    });

    const room = await getOrLoadRoom(finalRoomId);
    room.users.set(socket.id, finalUsername);
    socket.join(finalRoomId);
    socket.roomId = finalRoomId;
    socket.username = finalUsername;

    const userList = Array.from(new Set(room.users.values()));
    io.to(finalRoomId).emit('userList', userList);

    // 发送历史消息给新加入的用户
    socket.emit('history', room.messages.slice(-100));

    const systemMsg = {
      id: Date.now() + Math.random(),
      type: 'system',
      text: `${finalUsername} 加入了聊天室`,
      timestamp: Date.now()
    };
    room.messages.push(systemMsg);
    if (room.messages.length > 500) room.messages = room.messages.slice(-500);
    saveMessageToFirebase(finalRoomId, systemMsg);
    io.to(finalRoomId).emit('message', systemMsg);

    // 机器人欢迎（只欢迎第一次进入房间的用户）
    const isNewUser = !room.messages.some(
      m => m.username === finalUsername || (m.type === 'system' && m.text.startsWith(`${finalUsername} `))
    );

    if (isNewUser) {
      setTimeout(() => {
        const welcomeMsg = {
          id: Date.now() + Math.random(),
          type: 'message',
          username: BOT_NAME,
          text: `@${finalUsername} 欢迎来到房间 ${finalRoomId}！有什么问题可以随时问我哦~ 😊`,
          timestamp: Date.now()
        };
        const currentRoom = rooms.get(finalRoomId);
        if (currentRoom) {
          currentRoom.messages.push(welcomeMsg);
          if (currentRoom.messages.length > 500) currentRoom.messages = currentRoom.messages.slice(-500);
          saveMessageToFirebase(finalRoomId, welcomeMsg);
          io.to(finalRoomId).emit('message', welcomeMsg);
        }
      }, 500);
    }
  });

  socket.on('message', async (data) => {
    const roomId = socket.roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;

    const username = room.users.get(socket.id) || '匿名';
    const msg = {
      id: Date.now() + Math.random(),
      type: 'message',
      username: username,
      text: data.text,
      timestamp: Date.now()
    };

    room.messages.push(msg);
    if (room.messages.length > 500) room.messages = room.messages.slice(-500);
    saveMessageToFirebase(roomId, msg);
    io.to(roomId).emit('message', msg);

    if (shouldTriggerBot(data.text, username)) {
      await handleBotReply(roomId, data.text, username);
    }
  });

  socket.on('disconnect', () => {
    const roomId = socket.roomId;
    const username = socket.username;
    if (roomId && username) {
      const room = rooms.get(roomId);
      if (room) {
        room.users.delete(socket.id);
        const userList = Array.from(new Set(room.users.values()));
        io.to(roomId).emit('userList', userList);

        const systemMsg = {
          id: Date.now() + Math.random(),
          type: 'system',
          text: `${username} 离开了聊天室`,
          timestamp: Date.now()
        };
        room.messages.push(systemMsg);
        if (room.messages.length > 500) room.messages = room.messages.slice(-500);
        saveMessageToFirebase(roomId, systemMsg);
        io.to(roomId).emit('message', systemMsg);
      }
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

// 每个房间独立的机器人对话历史
function getBotHistory(roomId) {
  const room = rooms.get(roomId);
  if (!room) return [];
  if (!room.botHistory) room.botHistory = [];
  return room.botHistory;
}

async function handleBotReply(roomId, userText, fromUser) {
  const cleanText = userText.replace(/@小助手/g, '').trim();
  const botConversationHistory = getBotHistory(roomId);

  botConversationHistory.push({
    role: 'user',
    content: `[${fromUser}]: ${cleanText}`
  });

  if (botConversationHistory.length > 20) {
    botConversationHistory.splice(0, botConversationHistory.length - 20);
  }

  const typingMsg = {
    id: Date.now() + Math.random(),
    type: 'typing',
    username: BOT_NAME,
    timestamp: Date.now()
  };
  io.to(roomId).emit('message', typingMsg);

  try {
    let searchResults = null;
    if (needsWebSearch(cleanText)) {
      searchResults = await searchWeb(cleanText);
    }

    const response = await callDeepSeekAPI(botConversationHistory, searchResults, fromUser);

    botConversationHistory.push({
      role: 'assistant',
      content: response
    });

    io.to(roomId).emit('removeTyping', typingMsg.id);

    const botMsg = {
      id: Date.now() + Math.random(),
      type: 'message',
      username: BOT_NAME,
      text: `@${fromUser} ${response}`,
      timestamp: Date.now()
    };

    const room = rooms.get(roomId);
    if (room) {
      room.messages.push(botMsg);
      if (room.messages.length > 500) room.messages = room.messages.slice(-500);
      saveMessageToFirebase(roomId, botMsg);
    }
    io.to(roomId).emit('message', botMsg);
  } catch (error) {
    console.error('机器人回复失败:', error);
    io.to(roomId).emit('removeTyping', typingMsg.id);

    const errorMsg = {
      id: Date.now() + Math.random(),
      type: 'message',
      username: BOT_NAME,
      text: `@${fromUser} 抱歉，我遇到了一点小问题: ${error.message}`,
      timestamp: Date.now()
    };

    const room = rooms.get(roomId);
    if (room) {
      room.messages.push(errorMsg);
      if (room.messages.length > 500) room.messages = room.messages.slice(-500);
      saveMessageToFirebase(roomId, errorMsg);
    }
    io.to(roomId).emit('message', errorMsg);
  }
}

async function callDeepSeekAPI(messages, searchResults = null, fromUser = '') {
  let systemContent = '你是一个友好的群聊助手，叫"小助手"。请用简洁、亲切的语气回答问题。回复不要太长，尽量控制在200字以内。';
  if (fromUser) {
    systemContent += `\n\n你当前正在回复群成员"${fromUser}"，回答时直接给出内容即可，不要在开头加"@"或对方昵称（系统会自动在回复前加上@提问者）。`;
  }

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
  res.json({
    status: 'ok',
    rooms: rooms.size,
    hasDeepSeekKey: !!DEEPSEEK_API_KEY,
    hasTavilyKey: !!TAVILY_API_KEY,
    firebaseEnabled: !!FIREBASE_DB_URL
  });
});

server.listen(PORT, () => {
  console.log(`服务器运行在 http://localhost:${PORT}`);
});

module.exports = app;
