const services = [
  { name: 'DeepSeek AI', key: 'deepseek', desc: '大语言模型服务' },
  { name: 'Tavily', key: 'tavily', desc: '联网搜索 API' },
  { name: 'Firebase', key: 'firebase', desc: '实时数据库' }
];

document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  loadDashboard();
  loadUsage();
  loadModelConfig();
  loadStoragePage();

  document.getElementById('refreshBtn').addEventListener('click', () => {
    loadDashboard();
    loadUsage();
    loadModelConfig();
    loadStoragePage();
  });

  const clearAllBtn = document.getElementById('clearAllBtn');
  if (clearAllBtn) {
    clearAllBtn.addEventListener('click', () => {
      showConfirmModal({
        icon: '⚠️',
        title: '确认清空全部消息？',
        desc: '此操作将删除所有房间的消息记录，包括 Firebase 中存储的历史消息。此操作不可撤销！',
        confirmText: '确认清空',
        onConfirm: async () => {
          await clearMessages();
          loadDashboard();
        }
      });
    });
  }

  const clearFirebaseBtn = document.getElementById('clearFirebaseBtn');
  if (clearFirebaseBtn) {
    clearFirebaseBtn.addEventListener('click', () => {
      showConfirmModal({
        icon: '🔥',
        title: '确认清理Firebase全部数据？',
        desc: '此操作将删除 Firebase 中的所有数据：所有房间消息、房间元数据、机器人使用统计、应用配置、旧文件存储。服务器内存中的所有数据也会被清空。此操作不可撤销！',
        confirmText: '确认清理',
        onConfirm: async () => {
          await clearMessages(null, 'full');
          loadDashboard();
          loadUsage();
        }
      });
    });
  }

  const clearFilesBtn = document.getElementById('clearFilesBtn');
  if (clearFilesBtn) {
    clearFilesBtn.addEventListener('click', () => {
      showConfirmModal({
        icon: '📁',
        title: '确认清理文件存储？',
        desc: '此操作将清理 Cloudinary 中的所有图片/语音文件，以及 Firebase 中残留的旧文件数据。此操作不可撤销！',
        confirmText: '确认清理',
        onConfirm: async () => {
          await clearMessages(null, null, 'cloudinary');
          await clearMessages(null, null, 'files');
          loadUsage();
        }
      });
    });
  }
});

function initNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  const sections = document.querySelectorAll('.content-section');
  const pageTitle = document.getElementById('pageTitle');

  const titles = {
    dashboard: '系统概览',
    services: '外部服务管理',
    storage: '文件存储管理',
    usage: '额度管理',
    rooms: '房间管理'
  };

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const target = item.dataset.section;

      navItems.forEach(i => i.classList.remove('active'));
      item.classList.add('active');

      sections.forEach(s => s.classList.remove('active'));
      document.getElementById(target).classList.add('active');

      pageTitle.textContent = titles[target] || '管理后台';
    });
  });
}

async function loadDashboard() {
  const statusBadge = document.getElementById('systemStatus');
  statusBadge.textContent = '检查中...';
  statusBadge.classList.remove('ok', 'error');

  try {
    const res = await fetch('/api/health');
    const data = await res.json();

    if (data.status === 'ok') {
      statusBadge.textContent = '运行正常';
      statusBadge.classList.add('ok');
    } else {
      statusBadge.textContent = '异常';
      statusBadge.classList.add('error');
    }

    updateStats(data);
    updateServiceStatus(data);
    updateRoomList(data.roomsInfo || []);
  } catch (err) {
    statusBadge.textContent = '连接失败';
    statusBadge.classList.add('error');
    console.error('获取健康状态失败:', err);
  }
}

function updateStats(data) {
  document.getElementById('roomCount').textContent = data.rooms || 0;
  document.getElementById('userCount').textContent = data.totalUsers || '0';
  document.getElementById('msgCount').textContent = data.totalMessages || '0';
  document.getElementById('botStatus').textContent = data.hasDeepSeekKey ? '已启用' : '未配置';
}

function updateServiceStatus(data) {
  const list = document.getElementById('serviceStatusList');
  const statusMap = {
    deepseek: data.hasDeepSeekKey,
    tavily: data.hasTavilyKey,
    firebase: data.firebaseEnabled
  };

  list.innerHTML = services.map(s => `
    <div class="service-status-item">
      <div class="service-status-info">
        <div class="service-status-dot ${statusMap[s.key] ? 'active' : 'inactive'}"></div>
        <div>
          <div class="service-status-name">${s.name}</div>
          <div class="service-status-text">${s.desc}</div>
        </div>
      </div>
      <div class="service-status-text">
        ${statusMap[s.key] ? '✓ 已配置' : '✗ 未配置'}
      </div>
    </div>
  `).join('');
}

async function loadUsage() {
  const list = document.getElementById('usageList');
  const botList = document.getElementById('botStatsList');
  const firebaseList = document.getElementById('firebaseStats');
  const checkedAt = document.getElementById('usageCheckedAt');

  list.innerHTML = `
    <div class="empty-state">
      <div class="empty-icon">💰</div>
      <p>正在查询额度信息...</p>
    </div>
  `;
  
  botList.innerHTML = `
    <div class="empty-state">
      <div class="empty-icon">🤖</div>
      <p>正在加载统计数据...</p>
    </div>
  `;

  firebaseList.innerHTML = `
    <div class="empty-state">
      <div class="empty-icon">☁️</div>
      <p>正在加载Firebase数据...</p>
    </div>
  `;

  try {
    const res = await fetch('/api/usage');
    const data = await res.json();
    checkedAt.textContent = data.checkedAt ? `查询时间：${new Date(data.checkedAt).toLocaleString('zh-CN')}` : '--';
    updateUsageList(data);
    updateBotStatsList(data.botStats || {});
    updateFirebaseStats(data.firebaseStats || {});
  } catch (err) {
    checkedAt.textContent = '查询失败';
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⚠️</div>
        <p>额度查询失败</p>
        <p class="empty-sub">${escapeHtml(err.message)}</p>
      </div>
    `;
  }
}

function updateBotStatsList(stats) {
  const list = document.getElementById('botStatsList');
  
  if (stats.error) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⚠️</div>
        <p>统计加载失败</p>
        <p class="empty-sub">${escapeHtml(stats.error)}</p>
      </div>
    `;
    return;
  }
  
  const statsItems = [
    { name: '今日总调用', value: stats.todayTotal || 0, icon: '📊' },
    { name: '活跃用户数', value: stats.users || 0, icon: '👥' }
  ];
  
  list.innerHTML = statsItems.map(item => `
    <div class="usage-card">
      <div class="usage-icon">${item.icon}</div>
      <div class="usage-info">
        <div class="usage-name">${item.name}</div>
        <div class="usage-detail">机器人对话次数</div>
      </div>
      <div class="usage-value active">${item.value}</div>
    </div>
  `).join('');
}

function updateFirebaseStats(stats) {
  const list = document.getElementById('firebaseStats');
  
  if (!stats.configured) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⚠️</div>
        <p>未配置 Firebase</p>
        <p class="empty-sub">请配置 FIREBASE_DB_URL 环境变量</p>
      </div>
    `;
    return;
  }
  
  if (!stats.ok) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⚠️</div>
        <p>Firebase 连接失败</p>
        <p class="empty-sub">${escapeHtml(stats.error)}</p>
      </div>
    `;
    return;
  }
  
  const dbUrl = stats.databaseUrl || '';
  const botUsage = stats.botUsage || {};
  const rooms = stats.rooms || {};
  
  const statsItems = [
    { name: '数据库地址', value: dbUrl.split('//')[1] || dbUrl, icon: '🔗', detail: 'Firebase Realtime Database' },
    { name: '机器人用户数', value: botUsage.totalUsers || 0, icon: '👤', detail: '累计使用机器人的用户' },
    { name: '今日机器人调用', value: botUsage.todayCalls || 0, icon: '📊', detail: '今天的机器人对话次数' },
    { name: '累计机器人调用', value: botUsage.totalCalls || 0, icon: '📈', detail: '历史总对话次数' },
    { name: '房间总数', value: rooms.totalRooms || 0, icon: '💬', detail: '存储的房间数量' },
    { name: '消息总数', value: rooms.totalMessages || 0, icon: '✉️', detail: '历史消息记录数' },
    { name: '带元数据的房间', value: rooms.roomsWithMetadata || 0, icon: '📋', detail: '有公告/签到等配置的房间' }
  ];
  
  list.innerHTML = statsItems.map(item => `
    <div class="usage-card">
      <div class="usage-icon">${item.icon}</div>
      <div class="usage-info">
        <div class="usage-name">${item.name}</div>
        <div class="usage-detail">${escapeHtml(item.detail)}</div>
      </div>
      <div class="usage-value active">${escapeHtml(item.value)}</div>
    </div>
  `).join('');
}

function updateUsageList(data) {
  const list = document.getElementById('usageList');
  const providers = [
    {
      name: 'DeepSeek AI',
      icon: '🤖',
      info: data.deepseek,
      render: (info) => {
        if (!info.configured) return { value: '未配置 API Key', status: 'inactive', detail: '请配置 DEEPSEEK_API_KEY 环境变量' };
        if (!info.ok) return { value: '查询失败', status: 'error', detail: info.error };
        if (info.balance !== null && info.balance !== undefined) {
          const balanceNum = Number(info.balance);
          const displayBalance = isNaN(balanceNum) ? String(info.balance) : balanceNum.toFixed(2);
          return {
            value: `${displayBalance} ${info.currency || 'CNY'}`,
            status: 'active',
            detail: '账户余额'
          };
        }
        return {
          value: '余额可用',
          status: 'active',
          detail: info.rawJson ? 'API返回数据已记录' : '账户余额'
        };
      }
    },
    {
      name: 'Tavily Search',
      icon: '🔍',
      info: data.tavily,
      render: (info) => {
        if (!info.configured) return { value: '未配置 API Key', status: 'inactive', detail: '请配置 TAVILY_API_KEY 环境变量' };
        if (!info.ok) return { value: '查询失败', status: 'error', detail: info.error };
        if (info.limit > 0 && info.remaining !== null) {
          return { 
            value: `${info.remaining} 次`, 
            status: 'active', 
            detail: `${info.plan} - 已用 ${info.usage}/${info.limit}` 
          };
        }
        return { value: info.status || '可用', status: 'active', detail: '服务可用' };
      }
    }
  ];

  list.innerHTML = providers.map(p => {
    const { value, status, detail } = p.render(p.info);
    return `
      <div class="usage-card">
        <div class="usage-icon">${p.icon}</div>
        <div class="usage-info">
          <div class="usage-name">${p.name}</div>
          <div class="usage-detail">${escapeHtml(detail)}</div>
        </div>
        <div class="usage-value ${status}">${escapeHtml(value)}</div>
      </div>
    `;
  }).join('');
}

async function loadModelConfig() {
  const container = document.getElementById('modelSettings');
  
  try {
    const res = await fetch('/api/config');
    const data = await res.json();
    renderModelSettings(data);
  } catch (err) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⚠️</div>
        <p>加载模型配置失败</p>
        <p class="empty-sub">${escapeHtml(err.message)}</p>
      </div>
    `;
  }
}

function renderModelSettings(data) {
  const container = document.getElementById('modelSettings');
  const currentModel = data.deepseekModel;
  const models = data.availableModels || [];
  
  container.innerHTML = models.map(m => `
    <div class="model-option ${m.id === currentModel ? 'selected' : ''}" data-model="${m.id}">
      <div class="model-radio">
        <div class="model-radio-inner"></div>
      </div>
      <div class="model-info">
        <div class="model-name">${escapeHtml(m.name)}</div>
        <div class="model-desc">${escapeHtml(m.desc)}</div>
        <div class="model-id">模型ID: ${escapeHtml(m.id)}</div>
      </div>
      ${m.id === currentModel ? '<div class="model-badge">当前使用</div>' : ''}
    </div>
  `).join('') + `
    <div class="model-actions">
      <button id="saveModelBtn" class="save-btn" disabled>
        <span class="save-icon">💾</span>
        保存设置
      </button>
      <span id="saveModelMsg" class="save-msg"></span>
    </div>
  `;
  
  let selectedModel = currentModel;
  
  document.querySelectorAll('.model-option').forEach(option => {
    option.addEventListener('click', () => {
      const modelId = option.dataset.model;
      if (modelId === selectedModel) return;
      
      selectedModel = modelId;
      
      document.querySelectorAll('.model-option').forEach(o => {
        o.classList.remove('selected');
        const badge = o.querySelector('.model-badge');
        if (badge) badge.remove();
      });
      
      option.classList.add('selected');
      
      const saveBtn = document.getElementById('saveModelBtn');
      saveBtn.disabled = selectedModel === currentModel;
      
      const msg = document.getElementById('saveModelMsg');
      msg.textContent = '';
      msg.className = 'save-msg';
    });
  });
  
  const saveBtn = document.getElementById('saveModelBtn');
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      saveBtn.disabled = true;
      const msg = document.getElementById('saveModelMsg');
      msg.textContent = '保存中...';
      msg.className = 'save-msg saving';
      
      try {
        const res = await fetch('/api/config', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deepseekModel: selectedModel })
        });
        
        const result = await res.json();
        
        if (result.success) {
          msg.textContent = '✓ 保存成功';
          msg.className = 'save-msg success';
          setTimeout(() => {
            loadModelConfig();
          }, 1000);
        } else {
          throw new Error(result.error || '保存失败');
        }
      } catch (err) {
        msg.textContent = '✗ 保存失败: ' + err.message;
        msg.className = 'save-msg error';
        saveBtn.disabled = false;
      }
    });
  }
}

function updateRoomList(rooms) {
  const list = document.getElementById('roomList');

  if (!rooms || rooms.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">💬</div>
        <p>暂无房间数据</p>
        <p class="empty-sub">暂无活跃房间</p>
      </div>
    `;
    return;
  }

  list.innerHTML = rooms.map(r => `
    <div class="room-item">
      <div class="room-info">
        <div class="room-icon">💬</div>
        <div>
          <div class="room-name">${escapeHtml(r.name)}</div>
          <div class="room-id">Room ID: ${escapeHtml(r.id)}</div>
        </div>
      </div>
      <div class="room-item-actions">
        <div class="room-stats">
          <div class="room-stat">
            <span class="room-stat-icon">👥</span>
            <span>${r.userCount || 0} 人</span>
          </div>
          <div class="room-stat">
            <span class="room-stat-icon">💬</span>
            <span>${r.messageCount || 0} 条</span>
          </div>
        </div>
        <button class="btn btn-danger btn-sm clear-room-btn" data-room-id="${escapeHtml(r.id)}" data-room-name="${escapeHtml(r.name)}">
          <span>🗑️</span>
          <span>清空</span>
        </button>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('.clear-room-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const roomId = btn.dataset.roomId;
      const roomName = btn.dataset.roomName;
      showConfirmModal({
        icon: '⚠️',
        title: `确认清空 ${roomName} 的消息？`,
        desc: `此操作将删除房间 "${roomName}" 的所有消息记录，包括 Firebase 中存储的历史消息。此操作不可撤销！`,
        confirmText: '确认清空',
        onConfirm: async () => {
          await clearMessages(roomId);
          loadDashboard();
        }
      });
    });
  });
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}

async function clearMessages(roomId, level, target) {
  try {
    const body = roomId ? { roomId } : (level ? { level } : (target ? { target } : {}));
    const res = await fetch('/api/admin/clear-messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (data.ok) {
      return true;
    } else {
      alert('操作失败: ' + (data.error || '未知错误'));
      return false;
    }
  } catch (err) {
    alert('操作失败: ' + err.message);
    return false;
  }
}

function showConfirmModal({ icon, title, desc, confirmText, onConfirm }) {
  const existing = document.getElementById('confirmModal');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'confirmModal';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-icon">${icon || '⚠️'}</div>
      <div class="modal-title">${title || '确认操作'}</div>
      <div class="modal-desc">${desc || '此操作不可撤销，请确认继续。'}</div>
      <div class="modal-actions">
        <button class="modal-btn modal-btn-cancel" id="modalCancel">取消</button>
        <button class="modal-btn modal-btn-danger" id="modalConfirm">${confirmText || '确认'}</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  requestAnimationFrame(() => {
    overlay.classList.add('show');
  });

  const closeModal = () => {
    overlay.classList.remove('show');
    setTimeout(() => overlay.remove(), 200);
  };

  overlay.querySelector('#modalCancel').addEventListener('click', closeModal);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });

  const confirmBtn = overlay.querySelector('#modalConfirm');
  confirmBtn.addEventListener('click', async () => {
    confirmBtn.disabled = true;
    confirmBtn.textContent = '处理中...';
    const result = await onConfirm();
    closeModal();
  });
}

async function loadStoragePage() {
  await loadCloudinaryStats();
  await loadFileList();
  
  const refreshFilesBtn = document.getElementById('refreshFilesBtn');
  if (refreshFilesBtn) {
    refreshFilesBtn.addEventListener('click', loadFileList);
  }
  
  const clearAllFilesBtn = document.getElementById('clearAllFilesBtn');
  if (clearAllFilesBtn) {
    clearAllFilesBtn.addEventListener('click', () => {
      showConfirmModal({
        icon: '🗑️',
        title: '确认清空所有文件？',
        desc: '此操作将删除 Cloudinary 中 chat-room 文件夹下的所有图片和语音文件。此操作不可撤销！',
        confirmText: '确认清空',
        onConfirm: async () => {
          await clearAllCloudinaryFiles();
          await loadFileList();
          await loadCloudinaryStats();
        }
      });
    });
  }
}

async function loadCloudinaryStats() {
  const container = document.getElementById('cloudinaryStats');
  if (!container) return;
  
  try {
    const res = await fetch('/api/cloudinary-stats');
    const data = await res.json();
    
    if (data.ok && data.stats) {
      const stats = data.stats;
      const totalSizeGB = (data.totalSize / (1024 * 1024 * 1024)).toFixed(3);
      const storageLimitGB = (stats.storage.limit / (1024 * 1024 * 1024)).toFixed(0);
      const storageUsedGB = (stats.storage.usage / (1024 * 1024 * 1024)).toFixed(3);
      const storagePercent = ((stats.storage.usage / stats.storage.limit) * 100).toFixed(1);
      
      container.innerHTML = `
        <div class="usage-item">
          <div class="usage-item-header">
            <span class="usage-item-name">📦 存储空间</span>
            <span class="usage-item-value">${storageUsedGB} GB / ${storageLimitGB} GB</span>
          </div>
          <div class="usage-bar">
            <div class="usage-bar-fill" style="width: ${storagePercent}%; background: linear-gradient(90deg, #6366f1, #8b5cf6);"></div>
          </div>
          <div class="usage-item-sub">已使用 ${storagePercent}% | 文件总数: ${stats.objects.usage}</div>
        </div>
        <div class="usage-item">
          <div class="usage-item-header">
            <span class="usage-item-name">🌐 带宽流量</span>
            <span class="usage-item-value">${(stats.bandwidth.usage / (1024 * 1024 * 1024)).toFixed(2)} GB / ${(stats.bandwidth.limit / (1024 * 1024 * 1024)).toFixed(0)} GB</span>
          </div>
          <div class="usage-bar">
            <div class="usage-bar-fill" style="width: ${((stats.bandwidth.usage / stats.bandwidth.limit) * 100).toFixed(1)}%; background: linear-gradient(90deg, #10b981, #34d399);"></div>
          </div>
        </div>
        <div class="usage-item">
          <div class="usage-item-header">
            <span class="usage-item-name">⭐ 积分额度</span>
            <span class="usage-item-value">${(stats.credits.usage / 1000).toFixed(2)}K / ${(stats.credits.limit / 1000).toFixed(0)}K</span>
          </div>
          <div class="usage-bar">
            <div class="usage-bar-fill" style="width: ${((stats.credits.usage / stats.credits.limit) * 100).toFixed(1)}%; background: linear-gradient(90deg, #f59e0b, #fbbf24);"></div>
          </div>
        </div>
        <div class="usage-item">
          <div class="usage-item-header">
            <span class="usage-item-name">📊 API 请求数</span>
            <span class="usage-item-value">${(stats.requests.usage / 1000).toFixed(1)}K / ${(stats.requests.limit / 1000).toFixed(0)}K</span>
          </div>
          <div class="usage-bar">
            <div class="usage-bar-fill" style="width: ${((stats.requests.usage / stats.requests.limit) * 100).toFixed(1)}%; background: linear-gradient(90deg, #ec4899, #f472b6);"></div>
          </div>
        </div>
      `;
    } else {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">❌</div>
          <p>获取存储信息失败</p>
          <p class="empty-sub">${data.error || '未知错误'}</p>
        </div>
      `;
    }
  } catch (err) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">❌</div>
        <p>加载失败</p>
        <p class="empty-sub">${err.message}</p>
      </div>
    `;
  }
}

async function loadFileList() {
  const container = document.getElementById('fileList');
  if (!container) return;
  
  container.innerHTML = `
    <div class="empty-state">
      <div class="empty-icon">⏳</div>
      <p>正在加载文件列表...</p>
    </div>
  `;
  
  try {
    const res = await fetch('/api/cloudinary-stats');
    const data = await res.json();
    
    if (data.ok && data.files && data.files.length > 0) {
      container.innerHTML = data.files.map(file => {
        const sizeKB = (file.size / 1024).toFixed(1);
        const typeIcon = file.type === 'video' ? '🎤' : '🖼️';
        const date = new Date(file.created_at);
        const dateStr = date.toLocaleString('zh-CN');
        
        return `
          <div class="file-item">
            <div class="file-icon">${typeIcon}</div>
            <div class="file-info">
              <div class="file-name">${escapeHtml(file.public_id.split('/').pop())}</div>
              <div class="file-meta">
                <span>${sizeKB} KB</span>
                ${file.width ? `<span>${file.width}×${file.height}</span>` : ''}
                <span>${dateStr}</span>
              </div>
            </div>
            <div class="file-actions">
              <button class="file-action-btn" onclick="window.open('${file.url}', '_blank')">查看</button>
              <button class="file-action-btn delete" onclick="deleteFile('${file.public_id}', '${file.type}')">删除</button>
            </div>
          </div>
        `;
      }).join('');
    } else {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📭</div>
          <p>暂无文件</p>
          <p class="empty-sub">上传的图片和语音会显示在这里</p>
        </div>
      `;
    }
  } catch (err) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">❌</div>
        <p>加载失败</p>
        <p class="empty-sub">${err.message}</p>
      </div>
    `;
  }
}

async function deleteFile(publicId, type) {
  if (!confirm('确定要删除这个文件吗？')) return;
  
  try {
    const res = await fetch('/api/admin/delete-file', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publicId, type })
    });
    const data = await res.json();
    
    if (data.ok) {
      alert('删除成功！');
      loadFileList();
      loadCloudinaryStats();
    } else {
      alert('删除失败：' + (data.error || '未知错误'));
    }
  } catch (err) {
    alert('删除失败：' + err.message);
  }
}

async function clearAllCloudinaryFiles() {
  try {
    const res = await fetch('/api/admin/clear-messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level: 'cloudinary' })
    });
    const data = await res.json();
    return data.ok;
  } catch (err) {
    console.error('清空文件失败:', err);
    return false;
  }
}
