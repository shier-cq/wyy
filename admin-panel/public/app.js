const loginView = document.querySelector('#loginView');
const appView = document.querySelector('#appView');
const settingsForm = document.querySelector('#settingsForm');
const userForm = document.querySelector('#userForm');
const usersBox = document.querySelector('#users');
const logBox = document.querySelector('#logBox');
const psBox = document.querySelector('#psBox');
const loginError = document.querySelector('#loginError');
const runStatus = document.querySelector('#runStatus');
const runBtn = document.querySelector('#runBtn');
const stopRunBtn = document.querySelector('#stopRunBtn');
const qrBox = document.querySelector('#qrBox');
const qrImage = document.querySelector('#qrImage');
const qrLink = document.querySelector('#qrLink');
const smsBox = document.querySelector('#smsBox');
const smsCodeInput = document.querySelector('#smsCodeInput');
const smsHint = document.querySelector('#smsHint');
const smsInstruction = document.querySelector('#smsInstruction');
const smsText = document.querySelector('#smsText');
const smsTo = document.querySelector('#smsTo');
const smsCodeLabel = document.querySelector('#smsCodeLabel');
const smsSubmitBtn = document.querySelector('#smsSubmitBtn');
const smsSentBtn = document.querySelector('#smsSentBtn');
let refreshTimer = null;

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  const response = await fetch(path, {
    headers,
    ...options,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || response.statusText);
  }
  return response.json();
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function recentLogLines(text, count = 10) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim());
  return lines.slice(-count).join('\n');
}

function setLog(text) {
  logBox.textContent = recentLogLines(text) || '';
}

function fillSettings(settings) {
  for (const input of settingsForm.elements) {
    if (!input.name) continue;
    input.value = settings[input.name] || '';
  }
}

function renderUsers(users) {
  usersBox.innerHTML = '';
  if (!users.length) {
    usersBox.innerHTML = '<p class="error">还没有账号任务。</p>';
    return;
  }
  for (const user of users) {
    const row = document.createElement('div');
    row.className = 'user';
    row.innerHTML = `
      <div>
        <strong></strong>
        <span></span>
      </div>
      <button class="secondary" type="button">删除</button>
    `;
    row.querySelector('strong').textContent = user.key;
    row.querySelector('span').textContent = `${user.phone || '未填写账号'} · ${user.hasPassword ? '已保存密码' : '无密码'}`;
    row.querySelector('button').addEventListener('click', async () => {
      if (!confirm(`删除任务 ${user.key}？`)) return;
      await api(`/api/users/${encodeURIComponent(user.key)}`, { method: 'DELETE' });
      await loadState();
    });
    usersBox.append(row);
  }
}

async function loadState() {
  const state = await api('/api/state');
  loginView.classList.add('hidden');
  appView.classList.remove('hidden');
  fillSettings(state.settings);
  renderUsers(state.users);
  psBox.textContent = state.ps || '';
  setLog(state.logs || '');
}

function renderRunStatus(status) {
  if (status.secondary?.type === 'sms') {
    const phone = status.secondary.phone ? `账号 ${status.secondary.phone}` : '当前账号';
    if (status.secondary.mode === 'send_sms' && status.secondary.smsText && status.secondary.smsTo) {
      smsText.textContent = status.secondary.smsText;
      smsTo.textContent = status.secondary.smsTo;
      smsInstruction.classList.remove('hidden');
      smsCodeLabel.classList.add('hidden');
      smsSubmitBtn.classList.add('hidden');
      smsSentBtn.classList.remove('hidden');
      smsHint.textContent = `${phone} 需要用绑定手机发送短信后确认`;
    } else {
      smsInstruction.classList.add('hidden');
      smsCodeLabel.classList.remove('hidden');
      smsSubmitBtn.classList.remove('hidden');
      smsSentBtn.classList.add('hidden');
      smsHint.textContent = `${phone} 正在等待短信验证码`;
    }
    smsBox.classList.remove('hidden');
  } else {
    smsBox.classList.add('hidden');
    smsHint.textContent = '';
    smsInstruction.classList.add('hidden');
    smsSentBtn.classList.add('hidden');
  }

  const qrMatch = String(status.output || '').match(/https:\/\/api\.pwmqr\.com\/qrcode\/create\/\?url=[^\s]+/);
  const qrUrl = status.qrUrl || (qrMatch ? qrMatch[0] : '');
  if (qrUrl) {
    qrImage.src = qrUrl;
    qrLink.href = qrUrl;
    qrBox.classList.remove('hidden');
  } else {
    qrBox.classList.add('hidden');
  }

  if (!status.running && !status.startedAt) {
    runStatus.textContent = '空闲';
    runBtn.disabled = false;
    stopRunBtn.disabled = true;
    return;
  }

  if (status.running) {
    runStatus.textContent = `运行中，开始于 ${new Date(status.startedAt).toLocaleTimeString()}`;
    runBtn.disabled = true;
    stopRunBtn.disabled = false;
    setLog(status.output || '后台任务正在执行...');
    return;
  }

  runStatus.textContent = `已结束，结束于 ${new Date(status.finishedAt).toLocaleTimeString()}`;
  runBtn.disabled = false;
  stopRunBtn.disabled = true;
  if (status.output) setLog(status.output);
}

async function loadRunStatus() {
  const status = await api('/api/run-status');
  renderRunStatus(status);
  if (status.running) {
    const logs = await api('/api/logs').catch(() => null);
    if (logs?.logs) setLog(logs.logs);
  }
}

function startPolling() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(async () => {
    if (appView.classList.contains('hidden')) return;
    await loadRunStatus().catch(() => {});
  }, 5000);
}

document.querySelector('#loginForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  loginError.textContent = '';
  try {
    await api('/api/login', {
      method: 'POST',
      body: JSON.stringify(formData(event.currentTarget)),
    });
    await loadState();
    await loadRunStatus();
    startPolling();
  } catch (error) {
    loginError.textContent = error.message;
  }
});

settingsForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  await api('/api/settings', {
    method: 'POST',
    body: JSON.stringify(formData(settingsForm)),
  });
  await loadState();
});

userForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  await api('/api/users', {
    method: 'POST',
    body: JSON.stringify(formData(userForm)),
  });
  userForm.reset();
  await loadState();
});

document.querySelector('#refreshBtn').addEventListener('click', loadState);
document.querySelector('#restartBtn').addEventListener('click', async () => {
  const result = await api('/api/restart', { method: 'POST' });
  setLog(result.output || '已重启');
  await loadState();
});
runBtn.addEventListener('click', async () => {
  runBtn.disabled = true;
  setLog('后台任务启动中...');
  const status = await api('/api/run-once', { method: 'POST' });
  renderRunStatus(status);
});
stopRunBtn.addEventListener('click', async () => {
  if (!confirm('强制停止会重启任务容器，确认继续？')) return;
  const status = await api('/api/stop-run', { method: 'POST' });
  renderRunStatus(status);
  await loadState();
});

smsBox.addEventListener('submit', async (event) => {
  event.preventDefault();
  const code = smsCodeInput.value.trim();
  smsHint.textContent = '验证码已提交，等待后端继续登录...';
  await api('/api/sms-code', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
  smsCodeInput.value = '';
  await loadRunStatus();
});

smsSentBtn.addEventListener('click', async () => {
  smsHint.textContent = '已通知后端点击“已发送，立即登录”...';
  await api('/api/sms-code', {
    method: 'POST',
    body: JSON.stringify({ sent: true }),
  });
  await loadRunStatus();
});

loadState().then(async () => {
  await loadRunStatus();
  startPolling();
}).catch(() => {
  loginView.classList.remove('hidden');
  appView.classList.add('hidden');
});
