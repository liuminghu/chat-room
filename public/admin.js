const services = [
  { name: 'DeepSeek AI', key: 'deepseek', desc: '大语言模型服务' },
  { name: 'Tavily', key: 'tavily', desc: '联网搜索 API' },
  { name: 'Firebase', key: 'firebase', desc: '实时数据库' }
];

document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  loadDashboard();
  loadUsage();

  document.getElementById('refreshBtn').addEventListener('click', () => {
    loadDashboard();
    loadUsage();
  });
});

function initNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  const sections = document.querySelectorAll('.content-section');
  const pageTitle = document.getElementById('pageTitle');

  const titles = {
    dashboard: '系统概览',
    services: '外部服务管理',
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
  const checkedAt = document.getElementById('usageCheckedAt');

  list.innerHTML = `
    <div class="empty-state">
      <div class="empty-icon">💰</div>
      <p>正在查询额度信息...</p>
    </div>
  `;

  try {
    const res = await fetch('/api/usage');
    const data = await res.json();
    checkedAt.textContent = data.checkedAt ? `查询时间：${new Date(data.checkedAt).toLocaleString('zh-CN')}` : '--';
    updateUsageList(data);
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
        return {
          value: info.balance !== null ? `${info.balance} ${info.currency || ''}`.trim() : '余额可用',
          status: 'active',
          detail: '账户余额'
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
    </div>
  `).join('');
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}
