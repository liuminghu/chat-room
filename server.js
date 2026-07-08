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
    const res = await fetch(`${FIREBASE_DB_URL}/rooms/${roomId}/messages.json?limitToLast=50`);
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
        const prevUserList = Array.from(new Set(prevRoom.users.values()));
        io.to(r).emit('userList', prevUserList);
        // 同房间重连（用户名相同）不广播离开消息
        if (prevName && (r !== finalRoomId || prevName !== finalUsername)) {
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

    // 判断是否首次加入该房间（同房间内已有同名用户视为重连，不广播加入）
    const existingUserList = Array.from(new Set(room.users.values()));
    const isReconnect = existingUserList.includes(finalUsername);

    room.users.set(socket.id, finalUsername);
    socket.join(finalRoomId);
    socket.roomId = finalRoomId;
    socket.username = finalUsername;

    const userList = Array.from(new Set(room.users.values()));
    io.to(finalRoomId).emit('userList', userList);

    // 发送历史消息给新加入的用户
    socket.emit('history', room.messages.slice(-20));

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
      timestamp: Date.now(),
      likes: [],
      replyTo: data.replyTo || null
    };

    room.messages.push(msg);
    if (room.messages.length > 500) room.messages = room.messages.slice(-500);
    saveMessageToFirebase(roomId, msg);
    io.to(roomId).emit('message', msg);

    if (shouldTriggerBot(data.text, username)) {
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

    const user = room.users.get(socket.id);
    if (!msg.likes) msg.likes = [];
    const idx = msg.likes.indexOf(user);
    if (idx > -1) {
      msg.likes.splice(idx, 1);
    } else {
      msg.likes.push(user);
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
    if (msg.username !== room.users.get(socket.id)) return;
    if (Date.now() - msg.timestamp > 120000) return;

    msg.recalled = true;
    io.to(roomId).emit('messageRecalled', { messageId: msg.id });
  });

  socket.on('disconnect', () => {
    const roomId = socket.roomId;
    const username = socket.username;
    if (roomId && username) {
      // 延迟广播"离开"消息，期间重连则取消
      socket.leaveTimer = setTimeout(() => {
        const room = rooms.get(roomId);
        if (!room) return;
        // 再次确认用户是否真的离线（防止重连后又被广播）
        // 如果房间内还有同名用户（重连后加入了新 socket），不广播
        const currentUsers = Array.from(new Set(room.users.values()));
        if (!currentUsers.includes(username)) {
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
      }, 8000);
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
      const optionsText = command.options.map((o, i) => `${i + 1}. ${o}`).join('\n');
      sendBotMsg(`📊 投票发起！\n${command.question}\n\n${optionsText}\n\n回复选项编号或名称参与投票！`);
      break;
    }
    case 'announce': {
      room.announcement = command.text;
      sendBotMsg(`📢 房间公告已更新！`);
      io.to(roomId).emit('message', {
        id: Date.now() + Math.random(),
        type: 'system',
        text: `📢 房间公告: ${command.text}`,
        timestamp: Date.now()
      });
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
