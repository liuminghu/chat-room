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
  pingInterval: 25000,
  pingTimeout: 20000,
  connectTimeout: 30000,
  upgradeTimeout: 20000
});

app.use(cors());
app.use(express.json());
app.use(express.static('public', { extensions: ['html'] }));

const PORT = process.env.PORT || 3000;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const TAVILY_API_KEY = process.env.TAVILY_API_KEY || '';
const FIREBASE_DB_URL = process.env.FIREBASE_DB_URL || 'https://chat-room-demo-e837c-default-rtdb.firebaseio.com';
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY || '';
const BOT_NAME = '小助手';
const DEFAULT_ROOM = 'public';
const BOT_RATE_LIMIT = 10;
const BOT_RATE_LIMIT_WINDOW = 60000;
const BOT_DAILY_LIMIT = 50;

const DEEPSEEK_MODELS = [
  { id: 'deepseek-chat', name: 'DeepSeek-V3', desc: '通用聊天模型，平衡性能与速度' },
  { id: 'deepseek-reasoner', name: 'DeepSeek-R1', desc: '推理模型，擅长复杂数学和逻辑推理' }
];

let appConfig = {
  deepseekModel: 'deepseek-chat'
};

const botRateLimitMap = new Map();

async function loadAppConfig() {
  try {
    const res = await fetch(`${FIREBASE_DB_URL}/config/app.json`, { agent: false });
    if (res.ok) {
      const data = await res.json();
      if (data) {
        appConfig = { ...appConfig, ...data };
        console.log('应用配置已加载:', appConfig);
      }
    }
  } catch (err) {
    console.error('Firebase 加载应用配置失败:', err);
  }
}

async function saveAppConfig() {
  try {
    await fetch(`${FIREBASE_DB_URL}/config/app.json`, {
      agent: false,
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(appConfig)
    });
  } catch (err) {
    console.error('Firebase 保存应用配置失败:', err);
  }
}

function getTodayStr() {
  return new Date().toISOString().split('T')[0];
}

async function getDailyCount(userId) {
  try {
    const res = await fetch(`${FIREBASE_DB_URL}/botUsage/${userId}.json`, { agent: false });
    if (!res.ok) return 0;
    const data = await res.json();
    if (!data) return 0;
    const today = getTodayStr();
    return data[today] || 0;
  } catch (err) {
    console.error('Firebase 读取每日计数失败:', err);
    return 0;
  }
}

async function incrementDailyCount(userId) {
  try {
    const today = getTodayStr();
    const res = await fetch(`${FIREBASE_DB_URL}/botUsage/${userId}.json`, { agent: false });
    let data = {};
    if (res.ok) {
      data = await res.json() || {};
    }
    data[today] = (data[today] || 0) + 1;
    await fetch(`${FIREBASE_DB_URL}/botUsage/${userId}.json`, {
      agent: false,
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
  } catch (err) {
    console.error('Firebase 写入每日计数失败:', err);
  }
}

async function checkBotRateLimit(userId, roomId) {
  const now = Date.now();
  const today = getTodayStr();
  
  const dailyCount = await getDailyCount(userId);
  if (dailyCount >= BOT_DAILY_LIMIT) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    const waitSeconds = Math.ceil((tomorrow.getTime() - now) / 1000);
    const hours = Math.floor(waitSeconds / 3600);
    const minutes = Math.floor((waitSeconds % 3600) / 60);
    return {
      allowed: false,
      remaining: 0,
      resetTime: tomorrow.getTime(),
      type: 'daily',
      waitText: hours > 0 ? `${hours}小时${minutes}分钟` : `${minutes}分钟`
    };
  }
  
  const key = `${roomId}:${userId}`;
  
  let record = botRateLimitMap.get(key);
  if (!record) {
    record = { timestamps: [], windowStart: now };
    botRateLimitMap.set(key, record);
  }
  
  if (now - record.windowStart > BOT_RATE_LIMIT_WINDOW) {
    record.timestamps = [];
    record.windowStart = now;
  }
  
  record.timestamps.push(now);
  
  if (record.timestamps.length > BOT_RATE_LIMIT) {
    return { 
      allowed: false, 
      remaining: 0, 
      resetTime: record.windowStart + BOT_RATE_LIMIT_WINDOW,
      type: 'minute'
    };
  }
  
  await incrementDailyCount(userId);
  
  return { 
    allowed: true, 
    remaining: BOT_RATE_LIMIT - record.timestamps.length,
    dailyRemaining: BOT_DAILY_LIMIT - dailyCount - 1
  };
}

const DEFAULT_ANNOUNCEMENT = `欢迎来到聊天室！🤖 小助手可以帮你做这些事情：

🎮 趣味游戏
• \`/猜谜\` - 来玩猜谜语吧
• \`/成语接龙\` - 成语接龙挑战

📚 实用工具
• \`/百科 关键词\` - 百科知识查询
• \`/签到\` - 每日签到领积分
• \`/投票 问题 选项1 选项2 ...\` - 发起群投票

💬 AI 对话
• @小助手 + 问题 - 直接问我任何问题
• 支持联网搜索最新信息

📢 群管理
• \`/公告 内容\` - 设置房间公告

点击顶部可以折叠/展开公告哦~`;

const ADJECTIVES = ['快乐的', '活泼的', '可爱的', '聪明的', '勇敢的', '温柔的', '调皮的', '神秘的', '优雅的', '热情的', '冷静的', '机灵的', '憨厚的', '傲娇的', '佛系的', '元气的', '呆萌的', '霸气的', '文艺的', '搞笑的'];
const ANIMALS = ['小狐狸', '小熊猫', '小兔子', '小老虎', '小狮子', '小企鹅', '小海豚', '小松鼠', '小刺猬', '小考拉', '小水獭', '小柴犬', '小橘猫', '小仓鼠', '小羊驼', '小浣熊', '小鲸鱼', '小海龟', '小蜜蜂', '小蝴蝶'];

function generateRandomNickname() {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const animal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
  return adj + animal;
}

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
    const history = await loadMessagesFromFirebase(roomId, 100);
    const metadata = await loadRoomMetadata(roomId);
    const room = {
      messages: history,
      users: new Map(),
      loaded: true,
      announcement: metadata?.announcement || DEFAULT_ANNOUNCEMENT,
      signins: metadata?.signins || {},
      poll: metadata?.poll || {},
      botGame: metadata?.botGame || {}
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
      agent: false,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(msg)
    });
  } catch (err) {
    console.error('Firebase 保存失败:', err);
  }
}

async function loadMessagesFromFirebase(roomId, limit = 50) {
  try {
    let url = `${FIREBASE_DB_URL}/rooms/${roomId}/messages.json?orderBy=%22timestamp%22&limitToLast=${limit}`;
    let res = await fetch(url, { agent: false });
    
    if (!res.ok) {
      console.warn(`Firebase 查询失败，尝试不带参数加载: ${res.status}`);
      url = `${FIREBASE_DB_URL}/rooms/${roomId}/messages.json`;
      res = await fetch(url, { agent: false });
      if (!res.ok) {
        console.error(`Firebase 加载失败: HTTP ${res.status}`);
        return [];
      }
    }
    
    const data = await res.json();
    if (!data) return [];
    const arr = Object.values(data);
    return arr.sort((a, b) => a.timestamp - b.timestamp).slice(-limit);
  } catch (err) {
    console.error('Firebase 加载失败:', err);
    return [];
  }
}

async function saveRoomMetadata(roomId, metadata) {
  try {
    await fetch(`${FIREBASE_DB_URL}/rooms/${roomId}/metadata.json`, {
      agent: false,
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metadata)
    });
  } catch (err) {
    console.error('Firebase 保存房间元数据失败:', err);
  }
}

async function loadRoomMetadata(roomId) {
  try {
    const res = await fetch(`${FIREBASE_DB_URL}/rooms/${roomId}/metadata.json`, { agent: false });
    if (!res.ok) return null;
    const data = await res.json();
    return data || null;
  } catch (err) {
    console.error('Firebase 加载房间元数据失败:', err);
    return null;
  }
}

io.on('connection', (socket) => {
  console.log('用户连接:', socket.id);

  socket.on('join', async ({ roomId, username, userId }) => {
    const finalRoomId = (roomId && roomId.trim()) || DEFAULT_ROOM;
    const finalUsername = (username && username.trim()) || generateRandomNickname();
    const finalUserId = userId || socket.id;

    // 如果是重连（同一用户重新 join），取消 disconnect 时的延迟离开广播
    if (socket.leaveTimer) {
      clearTimeout(socket.leaveTimer);
      socket.leaveTimer = null;
    }

    // 离开之前加入的房间
    const previousRooms = Array.from(socket.rooms).filter(r => r !== socket.id);
    previousRooms.forEach(r => {
      const prevRoom = rooms.get(r);
      if (prevRoom) {
        const prevName = prevRoom.users.get(socket.id);
        prevRoom.users.delete(socket.id);
        if (prevRoom.userIdMap && socket.userId) {
          prevRoom.userIdMap.delete(socket.userId);
        }
        const prevUserList = Array.from(new Set(prevRoom.users.values()));
        io.to(r).emit('userList', prevUserList);
        // 不同房间切换时才广播离开消息
        if (prevName && r !== finalRoomId) {
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
    if (!room.userIdMap) room.userIdMap = new Map();

    // 判断是否重连（同一 userId 已有其他 socket 在线）
    const oldSocketId = room.userIdMap.get(finalUserId);
    const isReconnect = !!oldSocketId && oldSocketId !== socket.id;

    // 重连时清理旧 socket 的用户记录
    if (isReconnect) {
      room.users.delete(oldSocketId);
    }

    room.users.set(socket.id, finalUsername);
    room.userIdMap.set(finalUserId, socket.id);
    socket.join(finalRoomId);
    socket.roomId = finalRoomId;
    socket.username = finalUsername;
    socket.userId = finalUserId;

    const userList = Array.from(new Set(room.users.values()));
    io.to(finalRoomId).emit('userList', userList);

    // 发送历史消息给新加入的用户
    socket.emit('history', room.messages.slice(-50));

    // 发送房间公告
    socket.emit('announcementUpdated', { announcement: room.announcement || null });

    // 重连时不广播"加入"消息
    if (!isReconnect) {
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
    }

    // 发送房间公告给新用户
    if (room.announcement) {
      socket.emit('message', {
        id: Date.now() + Math.random(),
        type: 'system',
        text: `📢 房间公告: ${room.announcement}`,
        timestamp: Date.now()
      });
    }
  });

  socket.on('message', async (data) => {
    const roomId = socket.roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;

    const username = room.users.get(socket.id) || '匿名';
    const userId = socket.userId;
    const msg = {
      id: Date.now() + Math.random(),
      type: 'message',
      username: username,
      userId: userId,
      text: data.text,
      timestamp: Date.now(),
      likes: [],
      replyTo: data.replyTo || null
    };

    room.messages.push(msg);
    if (room.messages.length > 500) room.messages = room.messages.slice(-500);
    saveMessageToFirebase(roomId, msg);
    io.to(roomId).emit('message', msg);

    if (shouldTriggerBot(data.text, username)) {
      const limit = await checkBotRateLimit(userId, roomId);
      if (!limit.allowed) {
        let tipText;
        if (limit.type === 'daily') {
          tipText = `@${username} 今日对话次数已用完，请${limit.waitText}后再试哦~`;
        } else {
          const waitSeconds = Math.ceil((limit.resetTime - Date.now()) / 1000);
          tipText = `@${username} 您发起对话过于频繁，请 ${waitSeconds} 秒后再试哦~`;
        }
        const limitMsg = {
          id: Date.now() + Math.random(),
          type: 'message',
          username: BOT_NAME,
          text: tipText,
          timestamp: Date.now()
        };
        room.messages.push(limitMsg);
        if (room.messages.length > 500) room.messages = room.messages.slice(-500);
        io.to(roomId).emit('message', limitMsg);
        return;
      }
      await handleBotReply(roomId, data.text, username);
    }
  });

  socket.on('likeMessage', ({ messageId }) => {
    const roomId = socket.roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;

    const msg = room.messages.find(m => m.id == messageId);
    if (!msg || msg.type !== 'message') return;

    const userId = socket.userId;
    if (!msg.likes) msg.likes = [];
    const idx = msg.likes.indexOf(userId);
    if (idx > -1) {
      msg.likes.splice(idx, 1);
    } else {
      msg.likes.push(userId);
    }
    io.to(roomId).emit('messageLiked', { messageId: msg.id, likes: msg.likes });
  });

  socket.on('recallMessage', ({ messageId }) => {
    const roomId = socket.roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;

    const msg = room.messages.find(m => m.id == messageId);
    if (!msg || msg.type !== 'message') return;
    if (msg.userId !== socket.userId) return;
    if (Date.now() - msg.timestamp > 120000) return;

    msg.recalled = true;
    io.to(roomId).emit('messageRecalled', { messageId: msg.id });
  });

  socket.on('vote', ({ pollId, optionIndex }) => {
    const roomId = socket.roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;
    if (!room.poll || !room.poll.active) return;

    const poll = room.poll.active;
    if (poll.id !== pollId) return;
    if (optionIndex < 0 || optionIndex >= poll.options.length) return;

    const voter = socket.username || socket.id;
    poll.votes[voter] = optionIndex;

    // 更新消息中的投票数据
    const pollMsg = room.messages.find(m => m.id == pollId && m.type === 'poll');
    if (pollMsg && pollMsg.pollData) {
      pollMsg.pollData.votes = { ...poll.votes };
    }

    io.to(roomId).emit('pollUpdated', {
      pollId,
      votes: poll.votes,
      options: poll.options,
      question: poll.question
    });

    saveRoomMetadata(roomId, { announcement: room.announcement, signins: room.signins, poll: room.poll, botGame: room.botGame });
  });

  socket.on('createPoll', ({ question, options }) => {
    const roomId = socket.roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;
    if (!question || !options || options.length < 2) return;

    if (!room.poll) room.poll = {};
    const pollId = Date.now().toString();
    const fromUser = socket.username || '匿名';
    room.poll.active = {
      id: pollId,
      question,
      options,
      votes: {},
      creator: fromUser
    };
    const pollMsg = {
      id: pollId,
      type: 'poll',
      username: BOT_NAME,
      pollData: {
        id: pollId,
        question,
        options,
        votes: {},
        creator: fromUser
      },
      timestamp: Date.now()
    };
    room.messages.push(pollMsg);
    if (room.messages.length > 500) room.messages = room.messages.slice(-500);
    saveMessageToFirebase(roomId, pollMsg);
    io.to(roomId).emit('message', pollMsg);
    saveRoomMetadata(roomId, { announcement: room.announcement, signins: room.signins, poll: room.poll, botGame: room.botGame });
  });

  socket.on('loadMoreHistory', async ({ beforeTimestamp }) => {
    const roomId = socket.roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;

    try {
      const PAGE_SIZE = 20;
      let arr = [];

      // 先从内存中查找更早的消息
      const earlierInMemory = room.messages
        .filter(m => m.timestamp < beforeTimestamp)
        .sort((a, b) => a.timestamp - b.timestamp);

      if (earlierInMemory.length > 0) {
        arr = earlierInMemory.slice(-PAGE_SIZE);
        const hasMore = earlierInMemory.length > PAGE_SIZE;
        socket.emit('moreHistory', { messages: arr, hasMore });
        return;
      }

      // 内存中没有更早的消息，从 Firebase 加载
      try {
        const url = `${FIREBASE_DB_URL}/rooms/${roomId}/messages.json?orderBy=%22timestamp%22&endAt=${beforeTimestamp - 1}&limitToLast=${PAGE_SIZE}`;
        const res = await fetch(url, { agent: false });
        if (res.ok) {
          const data = await res.json();
          if (data && Object.keys(data).length > 0) {
            arr = Object.values(data).sort((a, b) => a.timestamp - b.timestamp);
          }
        }
      } catch (queryErr) {
        console.warn('Firebase 查询失败，尝试全量加载:', queryErr.message);
      }

      if (arr.length === 0) {
        const url = `${FIREBASE_DB_URL}/rooms/${roomId}/messages.json`;
        const res = await fetch(url, { agent: false });
        if (res.ok) {
          const allMessages = await res.json();
          if (allMessages) {
            const allArr = Object.values(allMessages)
              .sort((a, b) => a.timestamp - b.timestamp)
              .filter(m => m.timestamp < beforeTimestamp);
            arr = allArr.slice(-PAGE_SIZE);
          }
        }
      }

      const hasMore = arr.length >= PAGE_SIZE;
      room.messages = [...arr, ...room.messages];
      socket.emit('moreHistory', { messages: arr, hasMore });
    } catch (err) {
      console.error('加载历史消息失败:', err);
      socket.emit('moreHistory', { messages: [], hasMore: false });
    }
  });

  socket.on('updateUsername', ({ newUsername }) => {
    const roomId = socket.roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;
    const oldUsername = socket.username;
    const trimmed = (newUsername && newUsername.trim()) || '';
    if (!trimmed || trimmed === oldUsername) return;

    socket.username = trimmed;
    room.users.set(socket.id, trimmed);

    const userList = Array.from(new Set(room.users.values()));
    io.to(roomId).emit('userList', userList);

    const systemMsg = {
      id: Date.now() + Math.random(),
      type: 'system',
      text: `${oldUsername} 改名为 ${trimmed}`,
      timestamp: Date.now()
    };
    room.messages.push(systemMsg);
    if (room.messages.length > 500) room.messages = room.messages.slice(-500);
    saveMessageToFirebase(roomId, systemMsg);
    io.to(roomId).emit('message', systemMsg);

    socket.emit('usernameUpdated', { newUsername: trimmed });
  });

  socket.on('disconnect', () => {
    const roomId = socket.roomId;
    const username = socket.username;
    const userId = socket.userId;
    if (roomId && username) {
      // 延迟广播"离开"消息，期间重连则取消
      socket.leaveTimer = setTimeout(() => {
        const room = rooms.get(roomId);
        if (!room) return;
        // 如果该 userId 仍绑定在当前 socket（没有被新 socket 覆盖），说明真的离开了
        if (room.userIdMap && room.userIdMap.get(userId) === socket.id) {
          room.users.delete(socket.id);
          room.userIdMap.delete(userId);
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
      }, 20000);
    }
    console.log('用户断开:', socket.id);
  });
});

function shouldTriggerBot(text, username) {
  if (username === BOT_NAME) return false;
  if (text.startsWith('/')) return true;
  if (!DEEPSEEK_API_KEY) return false;
  return text.includes('@' + BOT_NAME) || text.startsWith('小助手');
}

function needsWebSearch(text) {
  if (!TAVILY_API_KEY || !tvly) return false;
  const lowerText = text.toLowerCase();

  // 明确搜索指令：用户明确要求使用搜索功能
  const explicitSearchKeywords = ['搜索', '查一下', '帮我查', '百度一下', 'google', '谷歌', '必应', '搜索一下', '帮我搜', '搜一下', '查找', '查询'];
  const hasExplicitSearch = explicitSearchKeywords.some(kw => lowerText.includes(kw));

  // 模糊匹配：内容暗示需要最新信息
  const implicitKeywords = ['天气', '今天', '最新', '现在', '近期', '新闻', '价格', '股价', '行情', '多少岁', '几岁', '身高', '体重', '怎么', '如何', '什么是', '介绍一下', '2025', '2026', '今年', '昨天', '明天', '最近'];
  const hasImplicitKeyword = implicitKeywords.some(kw => lowerText.includes(kw));

  return hasExplicitSearch || hasImplicitKeyword;
}

function hasExplicitSearchRequest(text) {
  const lowerText = text.toLowerCase();
  const explicitSearchKeywords = ['搜索', '查一下', '帮我查', '百度一下', 'google', '谷歌', '必应', '搜索一下', '帮我搜', '搜一下', '查找', '查询'];
  return explicitSearchKeywords.some(kw => lowerText.includes(kw));
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

// ===== 机器人指令系统 =====

const RIDDLES = [
  { q: '千条线，万条线，掉到水里看不见。', a: '雨' },
  { q: '五个兄弟，住在一起，名字不同，高矮不齐。', a: '手指' },
  { q: '身穿绿衣裳，肚里水汪汪，生的子儿多，个个黑脸膛。', a: '西瓜' },
  { q: '屋子方方，有门没窗，屋外热烘，屋里冰霜。', a: '冰箱' },
  { q: '独木造高楼，没瓦没砖头，人在水下走，水在人上流。', a: '雨伞' },
  { q: '耳朵长，尾巴短，只吃菜，不吃饭。', a: '兔子' },
  { q: '一物三口，有腿无手，谁要没它，难见亲友。', a: '裤子' },
  { q: '身披花棉袄，唱歌呱呱叫，田里捉害虫，丰收立功劳。', a: '青蛙' }
];

const IDIOMS = [
  '一心一意', '两全其美', '三心二意', '四面八方', '五湖四海',
  '六神无主', '七上八下', '八面玲珑', '九牛一毛', '十全十美',
  '画龙点睛', '守株待兔', '亡羊补牢', '掩耳盗铃', '拔苗助长'
];

function parseBotCommand(text) {
  const t = text.trim();
  if (t === '/猜谜' || t === '猜谜') return { cmd: 'riddle' };
  if (t === '/成语接龙' || t === '成语接龙') return { cmd: 'idiom' };
  if (t.startsWith('/百科 ') || t.startsWith('百科 ')) return { cmd: 'wiki', keyword: t.replace(/^(\/百科|百科)\s*/, '') };
  if (t === '/签到' || t === '签到') return { cmd: 'signin' };
  if (t.startsWith('/投票 ')) {
    const parts = t.replace('/投票 ', '').split(/\s+/);
    if (parts.length >= 3) {
      return { cmd: 'poll', question: parts[0], options: parts.slice(1) };
    }
  }
  if (t.startsWith('/公告 ')) return { cmd: 'announce', text: t.replace(/^\/公告\s*/, '') };
  return null;
}

async function handleBotCommand(roomId, command, fromUser, rawText) {
  const room = rooms.get(roomId);
  if (!room) return;

  const sendBotMsg = (text) => {
    const msg = {
      id: Date.now() + Math.random(),
      type: 'message',
      username: BOT_NAME,
      text: `@${fromUser} ${text}`,
      timestamp: Date.now()
    };
    room.messages.push(msg);
    if (room.messages.length > 500) room.messages = room.messages.slice(-500);
    saveMessageToFirebase(roomId, msg);
    io.to(roomId).emit('message', msg);
  };

  switch (command.cmd) {
    case 'riddle': {
      if (!room.botGame) room.botGame = {};
      const riddle = RIDDLES[Math.floor(Math.random() * RIDDLES.length)];
      room.botGame.riddle = { answer: riddle.a, player: fromUser };
      sendBotMsg(`我来出一个谜语，你来猜！\n\n${riddle.q}\n\n回复"谜底是xxx"来猜答案吧！`);
      break;
    }
    case 'idiom': {
      if (!room.botGame) room.botGame = {};
      const idiom = IDIOMS[Math.floor(Math.random() * IDIOMS.length)];
      room.botGame.idiom = { current: idiom, player: fromUser };
      sendBotMsg(`成语接龙开始！我先来：${idiom}\n\n请接以"${idiom.slice(-1)}"开头的成语！`);
      break;
    }
    case 'wiki': {
      if (!DEEPSEEK_API_KEY) {
        sendBotMsg('抱歉，百科查询功能暂时不可用。');
        return;
      }
      const typingMsg = {
        id: Date.now() + Math.random(),
        type: 'typing',
        username: BOT_NAME,
        timestamp: Date.now()
      };
      io.to(roomId).emit('message', typingMsg);

      try {
        const response = await callDeepSeekAPI([
          { role: 'user', content: `请用简洁的语言介绍一下"${command.keyword}"，100字以内。` }
        ], null, '', false);
        io.to(roomId).emit('removeTyping', typingMsg.id);
        sendBotMsg(response);
      } catch (e) {
        io.to(roomId).emit('removeTyping', typingMsg.id);
        sendBotMsg('百科查询失败，请稍后再试。');
      }
      break;
    }
    case 'signin': {
      if (!room.signins) room.signins = {};
      const today = new Date().toISOString().split('T')[0];
      const userSignin = room.signins[fromUser];
      if (userSignin && userSignin.date === today) {
        sendBotMsg(`你今天已经签到过了！连续签到${userSignin.streak}天，继续保持哦~`);
      } else {
        const streak = (userSignin && userSignin.date === getPrevDay(today)) ? (userSignin.streak || 0) + 1 : 1;
        room.signins[fromUser] = { date: today, streak };
        const points = 10 + (streak > 1 ? streak * 2 : 0);
        sendBotMsg(`签到成功！🎉 获得 ${points} 积分\n连续签到 ${streak} 天，明天继续来签到吧！`);
      }
      saveRoomMetadata(roomId, { announcement: room.announcement, signins: room.signins, poll: room.poll, botGame: room.botGame });
      break;
    }
    case 'poll': {
      if (!room.poll) room.poll = {};
      const pollId = Date.now().toString();
      room.poll.active = {
        id: pollId,
        question: command.question,
        options: command.options,
        votes: {},
        creator: fromUser
      };
      const pollMsg = {
        id: pollId,
        type: 'poll',
        username: BOT_NAME,
        pollData: {
          id: pollId,
          question: command.question,
          options: command.options,
          votes: {},
          creator: fromUser
        },
        timestamp: Date.now()
      };
      room.messages.push(pollMsg);
      if (room.messages.length > 500) room.messages = room.messages.slice(-500);
      saveMessageToFirebase(roomId, pollMsg);
      io.to(roomId).emit('message', pollMsg);
      saveRoomMetadata(roomId, { announcement: room.announcement, signins: room.signins, poll: room.poll, botGame: room.botGame });
      break;
    }
    case 'announce': {
      room.announcement = command.text;
      sendBotMsg(`📢 房间公告已更新！`);
      io.to(roomId).emit('announcementUpdated', { announcement: command.text });
      saveRoomMetadata(roomId, { announcement: room.announcement, signins: room.signins, poll: room.poll, botGame: room.botGame });
      break;
    }
  }
}

function getPrevDay(dateStr) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}

function checkBotGame(roomId, text, fromUser) {
  const room = rooms.get(roomId);
  if (!room || !room.botGame) return false;

  const t = text.trim();

  // 猜谜
  if (room.botGame.riddle && room.botGame.riddle.player === fromUser) {
    const match = t.match(/谜底是(.+)/);
    if (match) {
      const guess = match[1].trim();
      const answer = room.botGame.riddle.answer;
      if (guess === answer || guess.includes(answer) || answer.includes(guess)) {
        delete room.botGame.riddle;
        return { text: `@${fromUser} 恭喜你答对了！🎉 答案是"${answer}"！` };
      } else {
        return { text: `@${fromUser} 不对哦，再想想！提示：答案有${answer.length}个字。` };
      }
    }
  }

  // 成语接龙
  if (room.botGame.idiom && room.botGame.idiom.player === fromUser) {
    const currentEnd = room.botGame.idiom.current.slice(-1);
    if (t.length === 4 && t.startsWith(currentEnd)) {
      room.botGame.idiom.current = t;
      room.botGame.idiom.player = fromUser;
      return { text: `@${fromUser} 接得好！${t}\n\n请接以"${t.slice(-1)}"开头的成语！` };
    } else if (t.length === 4) {
      return { text: `@${fromUser} 这个成语不以"${currentEnd}"开头哦，请重新接龙！` };
    }
  }

  return false;
}

function checkPollVote(roomId, text, fromUser) {
  const room = rooms.get(roomId);
  if (!room || !room.poll || !room.poll.active) return false;

  const t = text.trim();
  const poll = room.poll.active;

  // 数字投票
  const num = parseInt(t);
  if (!isNaN(num) && num >= 1 && num <= poll.options.length) {
    poll.votes[fromUser] = num - 1;
    return { text: `@${fromUser} 投票成功！你选择了"${poll.options[num - 1]}"` };
  }

  // 文本匹配投票
  const idx = poll.options.findIndex(o => o === t || t.includes(o));
  if (idx >= 0) {
    poll.votes[fromUser] = idx;
    return { text: `@${fromUser} 投票成功！你选择了"${poll.options[idx]}"` };
  }

  // 查看投票结果
  if (t === '投票结果' || t === '/结果') {
    const counts = new Array(poll.options.length).fill(0);
    Object.values(poll.votes).forEach(v => counts[v]++);
    const total = Object.keys(poll.votes).length;
    const resultText = poll.options.map((o, i) => {
      const pct = total > 0 ? Math.round((counts[i] / total) * 100) : 0;
      const bar = '█'.repeat(Math.round(pct / 10)) + '░'.repeat(10 - Math.round(pct / 10));
      return `${o}: ${bar} ${counts[i]}票 (${pct}%)`;
    }).join('\n');
    return { text: `📊 ${poll.question}\n${resultText}\n\n共 ${total} 人参与投票` };
  }

  return false;
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

  // 优先处理游戏和投票
  const gameResult = checkBotGame(roomId, cleanText, fromUser);
  if (gameResult) {
    const room = rooms.get(roomId);
    if (room) {
      const msg = { id: Date.now() + Math.random(), type: 'message', username: BOT_NAME, text: gameResult.text, timestamp: Date.now() };
      room.messages.push(msg);
      if (room.messages.length > 500) room.messages = room.messages.slice(-500);
      saveMessageToFirebase(roomId, msg);
      saveRoomMetadata(roomId, { announcement: room.announcement, signins: room.signins, poll: room.poll, botGame: room.botGame });
      io.to(roomId).emit('message', msg);
    }
    return;
  }

  const pollResult = checkPollVote(roomId, cleanText, fromUser);
  if (pollResult) {
    const room = rooms.get(roomId);
    if (room) {
      const msg = { id: Date.now() + Math.random(), type: 'message', username: BOT_NAME, text: pollResult.text, timestamp: Date.now() };
      room.messages.push(msg);
      if (room.messages.length > 500) room.messages = room.messages.slice(-500);
      saveMessageToFirebase(roomId, msg);
      saveRoomMetadata(roomId, { announcement: room.announcement, signins: room.signins, poll: room.poll, botGame: room.botGame });
      io.to(roomId).emit('message', msg);
    }
    return;
  }

  // 检测指令
  const command = parseBotCommand(cleanText);
  if (command) {
    await handleBotCommand(roomId, command, fromUser, cleanText);
    return;
  }

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
    const isExplicitSearch = hasExplicitSearchRequest(cleanText);

    if (isExplicitSearch && (!TAVILY_API_KEY || !tvly)) {
      io.to(roomId).emit('removeTyping', typingMsg.id);
      const noSearchMsg = {
        id: Date.now() + Math.random(),
        type: 'message',
        username: BOT_NAME,
        text: `@${fromUser} 抱歉，我目前还没配置联网搜索功能，无法帮你搜索。你可以直接问我问题，我会尽力回答！`,
        timestamp: Date.now()
      };
      const room = rooms.get(roomId);
      if (room) {
        room.messages.push(noSearchMsg);
        if (room.messages.length > 500) room.messages = room.messages.slice(-500);
        saveMessageToFirebase(roomId, noSearchMsg);
      }
      io.to(roomId).emit('message', noSearchMsg);
      return;
    }

    if (needsWebSearch(cleanText)) {
      searchResults = await searchWeb(cleanText);
    }

    const response = await callDeepSeekAPI(botConversationHistory, searchResults, fromUser, isExplicitSearch);

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

async function callDeepSeekAPI(messages, searchResults = null, fromUser = '', isExplicitSearch = false) {
  let systemContent = '你是一个友好的群聊助手，叫"小助手"。请用简洁、亲切的语气回答问题。回复不要太长，尽量控制在200字以内。';
  if (fromUser) {
    systemContent += `\n\n你当前正在回复群成员"${fromUser}"，回答时直接给出内容即可，不要在开头加"@"或对方昵称（系统会自动在回复前加上@提问者）。`;
  }

  if (searchResults && searchResults.results && searchResults.results.length > 0) {
    const searchContext = searchResults.results.map((r, i) =>
      `[${i+1}] ${r.title}\n${r.content}\n来源: ${r.url}`
    ).join('\n\n');
    systemContent += `\n\n以下是联网搜索到的最新信息，请基于这些信息回答问题：\n${searchContext}\n\n回答时可以在末尾标注信息来源。`;
  } else if (isExplicitSearch) {
    systemContent += '\n\n用户明确要求进行联网搜索，但本次搜索未返回有效结果。请如实告知用户未能找到相关信息，并建议用户换个关键词或描述更具体一些。';
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
      model: appConfig.deepseekModel,
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

app.get('/api/debug/firebase-index', async (req, res) => {
  try {
    const url = `${FIREBASE_DB_URL}/rooms/123/messages.json?orderBy=%22timestamp%22&limitToLast=10`;
    const response = await fetch(url, { agent: false });
    
    if (response.ok) {
      const data = await response.json();
      res.json({
        ok: true,
        status: response.status,
        messageCount: data ? Object.keys(data).length : 0,
        message: '索引已存在且正常工作'
      });
      return;
    }
    
    const text = await response.text();
    let errorMessage = text;
    let indexLink = '';
    
    try {
      const json = JSON.parse(text);
      errorMessage = json.error || text;
      if (json.error && json.error.indexOf('index') !== -1) {
        const match = text.match(/https:\/\/console\.firebase\.google\.com[^"]+/);
        if (match) {
          indexLink = match[0];
        }
      }
    } catch (e) {}
    
    res.json({
      ok: false,
      status: response.status,
      error: errorMessage,
      indexLink: indexLink || '请手动在 Firebase Console 中创建索引',
      instructions: '如果收到 "Permission denied" 或 "Index not defined" 错误，请访问上述链接或手动在 Firebase Console 的 Realtime Database Rules 中添加索引'
    });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

app.get('/api/health', (req, res) => {
  let totalUsers = 0;
  let totalMessages = 0;
  const roomsInfo = [];

  rooms.forEach((room, roomId) => {
    const userCount = room.users.size;
    const msgCount = room.messages.length;
    totalUsers += userCount;
    totalMessages += msgCount;
    roomsInfo.push({
      id: roomId,
      name: roomId,
      userCount,
      messageCount: msgCount
    });
  });

  res.json({
    status: 'ok',
    rooms: rooms.size,
    totalUsers,
    totalMessages,
    hasDeepSeekKey: !!DEEPSEEK_API_KEY,
    hasTavilyKey: !!TAVILY_API_KEY,
    firebaseEnabled: !!FIREBASE_DB_URL,
    roomsInfo
  });
});

async function fetchDeepSeekBalance() {
  if (!DEEPSEEK_API_KEY) return { configured: false };
  try {
    const res = await fetch('https://api.deepseek.com/user/balance', {
      headers: { 'Authorization': 'Bearer ' + DEEPSEEK_API_KEY }
    });
    if (!res.ok) {
      const text = await res.text();
      return { configured: true, ok: false, error: `HTTP ${res.status}: ${text}` };
    }
    const data = await res.json();
    let balance = null;
    let currency = 'CNY';
    
    if (Array.isArray(data?.balance_infos) && data.balance_infos.length > 0) {
      const first = data.balance_infos[0];
      balance = first?.total_balance ?? null;
      currency = first?.currency || 'CNY';
    } else if (data?.data?.total_balance !== undefined) {
      balance = data.data.total_balance;
      currency = data.data.currency || 'CNY';
    } else if (data?.total_balance !== undefined) {
      balance = data.total_balance;
      currency = data.currency || 'CNY';
    }
    
    return {
      configured: true,
      ok: true,
      balance,
      currency,
      raw: data
    };
  } catch (err) {
    return { configured: true, ok: false, error: err.message };
  }
}

async function fetchTavilyUsage() {
  if (!TAVILY_API_KEY) return { configured: false };
  try {
    const res = await fetch('https://api.tavily.com/usage', {
      headers: { 'Authorization': 'Bearer ' + TAVILY_API_KEY }
    });
    const data = await res.json();
    if (!res.ok) {
      return { configured: true, ok: false, error: data?.detail || `HTTP ${res.status}` };
    }
    
    const keyUsage = data?.key?.search_usage || 0;
    const keyLimit = data?.key?.limit;
    const planUsage = data?.account?.search_usage || 0;
    const planLimit = data?.account?.plan_limit || 0;
    const plan = data?.account?.current_plan || 'Unknown';
    
    return { 
      configured: true, 
      ok: true, 
      plan,
      usage: planUsage,
      limit: planLimit,
      remaining: planLimit > 0 ? planLimit - planUsage : null,
      status: planLimit > 0 ? `${planUsage}/${planLimit}` : '可用'
    };
  } catch (err) {
    return { configured: true, ok: false, error: err.message };
  }
}

async function fetchBotUsageStats() {
  try {
    const res = await fetch(`${FIREBASE_DB_URL}/botUsage.json`, { agent: false });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const data = await res.json();
    if (!data) return { todayTotal: 0, users: 0 };
    
    const today = new Date().toISOString().split('T')[0];
    let todayTotal = 0;
    let users = 0;
    
    Object.values(data).forEach(userData => {
      if (userData && typeof userData === 'object') {
        users++;
        todayTotal += userData[today] || 0;
      }
    });
    
    return { todayTotal, users, data };
  } catch (err) {
    return { error: err.message };
  }
}

app.get('/api/config', (req, res) => {
  res.json({
    deepseekModel: appConfig.deepseekModel,
    availableModels: DEEPSEEK_MODELS
  });
});

app.put('/api/config', async (req, res) => {
  const { deepseekModel } = req.body;
  
  if (deepseekModel) {
    const validModel = DEEPSEEK_MODELS.find(m => m.id === deepseekModel);
    if (!validModel) {
      return res.status(400).json({ error: '无效的模型 ID' });
    }
    appConfig.deepseekModel = deepseekModel;
    await saveAppConfig();
  }
  
  res.json({
    success: true,
    deepseekModel: appConfig.deepseekModel
  });
});

async function fetchFirebaseStats() {
  try {
    const [botUsageRes, roomsRes, configRes] = await Promise.all([
      fetch(`${FIREBASE_DB_URL}/botUsage.json`, { agent: false }),
      fetch(`${FIREBASE_DB_URL}/rooms.json`, { agent: false }),
      fetch(`${FIREBASE_DB_URL}/config/app.json`, { agent: false })
    ]);

    const botUsage = botUsageRes.ok ? await botUsageRes.json() : null;
    const rooms = roomsRes.ok ? await roomsRes.json() : null;
    const config = configRes.ok ? await configRes.json() : null;

    let totalBotUsers = 0;
    let todayBotCalls = 0;
    let totalBotCalls = 0;
    const today = new Date().toISOString().split('T')[0];

    if (botUsage && typeof botUsage === 'object') {
      totalBotUsers = Object.keys(botUsage).length;
      Object.values(botUsage).forEach(userData => {
        if (userData && typeof userData === 'object') {
          todayBotCalls += userData[today] || 0;
          totalBotCalls += Object.values(userData).reduce((sum, val) => sum + (Number(val) || 0), 0);
        }
      });
    }

    let totalRooms = 0;
    let totalMessages = 0;
    let roomsWithMetadata = 0;

    if (rooms && typeof rooms === 'object') {
      totalRooms = Object.keys(rooms).length;
      Object.values(rooms).forEach(roomData => {
        if (roomData && typeof roomData === 'object') {
          if (roomData.messages && typeof roomData.messages === 'object') {
            totalMessages += Object.keys(roomData.messages).length;
          }
          if (roomData.metadata) {
            roomsWithMetadata++;
          }
        }
      });
    }

    return {
      ok: true,
      configured: !!FIREBASE_DB_URL,
      databaseUrl: FIREBASE_DB_URL,
      botUsage: {
        totalUsers: totalBotUsers,
        todayCalls: todayBotCalls,
        totalCalls: totalBotCalls
      },
      rooms: {
        totalRooms,
        totalMessages,
        roomsWithMetadata
      },
      config: config || null
    };
  } catch (err) {
    return {
      configured: !!FIREBASE_DB_URL,
      ok: false,
      error: err.message
    };
  }
}

async function firebaseDelete(path) {
  let url = `${FIREBASE_DB_URL}${path}.json`;
  if (FIREBASE_API_KEY) {
    url += `?auth=${FIREBASE_API_KEY}`;
  }
  try {
    const res = await fetch(url, { agent: false, method: 'DELETE' });
    if (!res.ok) {
      const text = await res.text();
      console.error(`Firebase DELETE ${path} 失败: HTTP ${res.status}, 响应: ${text}`);
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    console.log(`Firebase DELETE ${path} 成功`);
    return true;
  } catch (err) {
    console.error(`Firebase DELETE ${path} 异常:`, err.message);
    throw err;
  }
}

async function deleteAllRooms() {
  try {
    let url = `${FIREBASE_DB_URL}/rooms.json`;
    if (FIREBASE_API_KEY) {
      url += `?auth=${FIREBASE_API_KEY}`;
    }
    const res = await fetch(url, { agent: false });
    if (!res.ok) {
      console.error(`Firebase 获取房间列表失败: HTTP ${res.status}`);
      return;
    }
    const roomsData = await res.json();
    if (!roomsData) {
      console.log('Firebase 中没有房间数据');
      return;
    }
    const roomIds = Object.keys(roomsData);
    const deletePromises = roomIds.map(id => firebaseDelete(`/rooms/${id}`));
    await Promise.all(deletePromises);
    console.log(`已删除 ${roomIds.length} 个房间`);
  } catch (err) {
    console.error('删除所有房间失败:', err.message);
    throw err;
  }
}

async function tryDeleteRootMessages() {
  try {
    await firebaseDelete('/messages');
    console.log('已删除根级别 messages');
  } catch (err) {
    console.warn('删除根级别 messages 失败（可能是权限问题）:', err.message);
  }
}

app.post('/api/admin/clear-messages', async (req, res) => {
  const { roomId, level } = req.body || {};

  try {
    if (level === 'full') {
      await deleteAllRooms();
      await tryDeleteRootMessages();
      await firebaseDelete('/botUsage');
      await firebaseDelete('/config');
      rooms.clear();
      io.emit('messagesCleared', { level: 'full' });
      console.log('已完全清空 Firebase 所有数据');
      res.json({ ok: true, clearedAll: true, level: 'full' });
    } else if (roomId) {
      const room = rooms.get(roomId);
      if (room) {
        room.messages = [];
      }
      await firebaseDelete(`/rooms/${roomId}/messages`);
      io.to(roomId).emit('messagesCleared', { roomId });
      console.log(`已清空房间 ${roomId} 的消息记录`);
      res.json({ ok: true, clearedRoom: roomId });
    } else {
      rooms.forEach(room => {
        room.messages = [];
      });
      let roomsUrl = `${FIREBASE_DB_URL}/rooms.json`;
      if (FIREBASE_API_KEY) {
        roomsUrl += `?auth=${FIREBASE_API_KEY}`;
      }
      const roomsRes = await fetch(roomsUrl, { agent: false });
      if (roomsRes.ok) {
        const roomsData = await roomsRes.json();
        if (roomsData) {
          const deletePromises = Object.keys(roomsData).map(id =>
            firebaseDelete(`/rooms/${id}/messages`)
          );
          await Promise.all(deletePromises);
        }
      }
      io.emit('messagesCleared', { level: 'all' });
      console.log('已清空所有房间的消息记录');
      res.json({ ok: true, clearedAll: true });
    }
  } catch (err) {
    console.error('清空消息失败:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/usage', async (req, res) => {
  const [deepseek, tavily, botStats, firebaseStats] = await Promise.all([
    fetchDeepSeekBalance(), 
    fetchTavilyUsage(),
    fetchBotUsageStats(),
    fetchFirebaseStats()
  ]);
  res.json({
    deepseek,
    tavily,
    botStats,
    firebaseStats,
    checkedAt: new Date().toISOString()
  });
});

server.listen(PORT, async () => {
  console.log(`服务器运行在 http://localhost:${PORT}`);
  await loadAppConfig();
});

setInterval(() => {
  rooms.forEach((room, roomId) => {
    saveRoomMetadata(roomId, {
      announcement: room.announcement,
      signins: room.signins,
      poll: room.poll,
      botGame: room.botGame
    });
  });
}, 60000);

module.exports = app;
