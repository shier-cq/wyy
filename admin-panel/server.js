import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import staticPlugin from '@fastify/static';
import Redis from 'ioredis';

const app = Fastify({ logger: true });
app.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => {
  if (!body) {
    done(null, {});
    return;
  }
  try {
    done(null, JSON.parse(body));
  } catch (error) {
    done(error);
  }
});
const redis = new Redis(process.env.REDIS_URL || 'redis://redis:6379/5');
let runJob = {
  running: false,
  startedAt: null,
  finishedAt: null,
  output: '',
  error: '',
  qrUrl: '',
  logStartBytes: 0,
};
let containerBusy = false;
let activeRunContainer = '';

const envFilePath = process.env.ENV_FILE_PATH || '/project/.env';
const secondaryStatusPath = '/project/debug/secondary_status.json';
const secondaryInputPath = '/project/debug/secondary_input.json';
const projectHostDir = process.env.PROJECT_HOST_DIR || '/opt/netease-musician-task';
const taskContainer = process.env.TASK_CONTAINER || 'netease-musician-task';
const taskImage = process.env.TASK_IMAGE || 'xinghehy/netease-musician-task:latest';
const taskShmSize = Number(process.env.TASK_SHM_SIZE || 536870912);
const adminPassword = process.env.ADMIN_PANEL_PASSWORD || 'change-me';
const sessionSecret = crypto
  .createHash('sha256')
  .update(`${adminPassword}:${process.env.HOSTNAME || 'panel'}`)
  .digest('hex');

const settingKeys = [
  'SEND_TIME',
  'EXECUTION_INTERVAL_DAYS',
  'MAX_MONTHLY_SENDS',
  'LOGIN_METHOD',
  'PLAYWRIGHT_PROFILE_BASEDIR',
  'PLAYWRIGHT_PROFILE_PER_USER',
  'SECONDARY_VERIFY_METHOD',
  'COOKIE_EXPIRE_DAYS',
  'COOKIE_NOTIFY_BEFORE_DAYS',
  'WECOM_WEBHOOK_KEY',
  'CUSTOM_WEBHOOK_URL',
  'CUSTOM_WEBHOOK_METHOD',
  'CUSTOM_WEBHOOK_HEADERS',
  'ADMIN_PANEL_PASSWORD',
];

function sign(value) {
  return crypto.createHmac('sha256', sessionSecret).update(value).digest('hex');
}

function isAuthed(request) {
  const token = request.cookies.session || '';
  const [value, mac] = token.split('.');
  return value === 'ok' && mac && crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(sign(value)));
}

function requireAuth(request, reply, done) {
  if (isAuthed(request)) {
    done();
    return;
  }
  reply.code(401).send({ error: 'unauthorized' });
}

async function readEnv() {
  const raw = await fs.readFile(envFilePath, 'utf8').catch(() => '');
  const data = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.trim().startsWith('#') || !line.includes('=')) continue;
    const index = line.indexOf('=');
    data[line.slice(0, index)] = line.slice(index + 1);
  }
  return data;
}

async function writeEnv(updates) {
  const existing = await readEnv();
  const next = {
    ...existing,
    TZ: existing.TZ || 'Asia/Shanghai',
    REDIS_URL: existing.REDIS_URL || 'redis://redis:6379/5',
  };

  for (const key of settingKeys) {
    if (Object.hasOwn(updates, key)) next[key] = String(updates[key] ?? '');
  }

  const orderedKeys = [
    'TZ',
    'REDIS_URL',
    ...settingKeys.filter((key) => key !== 'ADMIN_PANEL_PASSWORD'),
    'ADMIN_PANEL_PASSWORD',
  ];
  const lines = orderedKeys.map((key) => `${key}=${next[key] ?? ''}`);
  await fs.writeFile(envFilePath, `${lines.join('\n')}\n`, 'utf8');
}

function dockerApi(method, path, body, responseType = 'json') {
  return new Promise((resolve, reject) => {
    const payload = body ? Buffer.from(JSON.stringify(body)) : null;
    const request = http.request({
      socketPath: '/var/run/docker.sock',
      path,
      method,
      headers: payload
        ? { 'Content-Type': 'application/json', 'Content-Length': payload.length }
        : undefined,
      timeout: 120000,
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const text = buffer.toString('utf8');
        if (response.statusCode >= 400) {
          reject(new Error(text || `Docker API returned ${response.statusCode}`));
          return;
        }
        if (responseType === 'buffer') {
          resolve(buffer);
        } else if (responseType === 'text') {
          resolve(text);
        } else {
          resolve(text ? JSON.parse(text) : {});
        }
      });
    });
    request.on('error', reject);
    request.on('timeout', () => request.destroy(new Error('Docker API timeout')));
    if (payload) request.write(payload);
    request.end();
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function containerInspect(name) {
  return dockerApi('GET', `/containers/${encodeURIComponent(name)}/json`);
}

async function containerLogs(name, tail = 120) {
  return dockerApi(
    'GET',
    `/containers/${encodeURIComponent(name)}/logs?stdout=1&stderr=1&tail=${tail}&timestamps=0`,
    null,
    'buffer',
  ).then(stripDockerLogHeaders);
}

async function fileLogs(tail = 200) {
  const raw = await fs.readFile('/project/log/netease_music.log', 'utf8').catch(() => '');
  return raw.split(/\r?\n/).slice(-tail).join('\n');
}

async function fileSize(path) {
  const stat = await fs.stat(path).catch(() => null);
  return stat?.size || 0;
}

async function fileLogsSince(offset = 0) {
  const handle = await fs.open('/project/log/netease_music.log', 'r').catch(() => null);
  if (!handle) return '';
  try {
    const stat = await handle.stat();
    const start = Math.min(Math.max(0, offset), stat.size);
    const buffer = Buffer.alloc(stat.size - start);
    if (!buffer.length) return '';
    await handle.read(buffer, 0, buffer.length, start);
    return buffer.toString('utf8');
  } finally {
    await handle.close().catch(() => {});
  }
}

async function readSecondaryStatus() {
  const raw = await fs.readFile(secondaryStatusPath, 'utf8').catch(() => '');
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function clearSecondaryFiles() {
  await Promise.all([
    fs.unlink(secondaryStatusPath).catch(() => {}),
    fs.unlink(secondaryInputPath).catch(() => {}),
  ]);
}

function stripDockerLogHeaders(buffer) {
  const parts = [];
  let offset = 0;
  while (offset + 8 <= buffer.length) {
    const size = buffer.readUInt32BE(offset + 4);
    if (!size || offset + 8 + size > buffer.length) break;
    parts.push(buffer.subarray(offset + 8, offset + 8 + size).toString('utf8'));
    offset += 8 + size;
  }
  return parts.length ? parts.join('') : buffer.toString('utf8');
}

async function composeStatus() {
  const containers = await dockerApi(
    'GET',
    `/containers/json?all=1&filters=${encodeURIComponent(JSON.stringify({ label: ['com.docker.compose.project=netease-musician-task'] }))}`,
  );
  return containers
    .map((container) => {
      const name = (container.Names?.[0] || '').replace(/^\//, '');
      return `${name.padEnd(24)} ${container.Image.padEnd(38)} ${container.Status}`;
    })
    .join('\n');
}

function envArrayFromSettings(settings) {
  return Object.entries(settings).map(([key, value]) => `${key}=${value}`);
}

async function removeContainer(name) {
  await dockerApi('DELETE', `/containers/${encodeURIComponent(name)}?force=1`).catch(() => {});
}

async function recreateTaskContainer() {
  const inspect = await containerInspect(taskContainer);
  const settings = await readEnv();
  await dockerApi('POST', `/containers/${encodeURIComponent(taskContainer)}/stop?t=10`).catch(() => {});
  await dockerApi('DELETE', `/containers/${encodeURIComponent(taskContainer)}?force=1`).catch(() => {});

  const networkingConfig = {};
  for (const networkName of Object.keys(inspect.NetworkSettings.Networks || {})) {
    networkingConfig.EndpointsConfig = networkingConfig.EndpointsConfig || {};
    networkingConfig.EndpointsConfig[networkName] = {};
  }

  const createBody = {
    Image: inspect.Config.Image,
    Env: envArrayFromSettings(settings),
    Cmd: inspect.Config.Cmd,
    Entrypoint: inspect.Config.Entrypoint,
    WorkingDir: inspect.Config.WorkingDir,
    Labels: inspect.Config.Labels,
    HostConfig: {
      Binds: inspect.HostConfig.Binds,
      RestartPolicy: inspect.HostConfig.RestartPolicy,
      NetworkMode: inspect.HostConfig.NetworkMode,
      ShmSize: taskShmSize,
    },
    NetworkingConfig: networkingConfig,
  };
  await dockerApi('POST', `/containers/create?name=${encodeURIComponent(taskContainer)}`, createBody);
  await dockerApi('POST', `/containers/${encodeURIComponent(taskContainer)}/start`);
}

async function startRunJob({ mode = 'once' } = {}) {
  const name = `netease-musician-run-${Date.now()}`;
  const isPublishOnly = mode === 'publish';
  activeRunContainer = name;
  runJob = {
    running: true,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    output: isPublishOnly
      ? '发布动态任务已启动，正在执行 interval_task_runner ...'
      : '后台任务已启动，正在执行 python main.py --once ...',
    error: '',
    qrUrl: '',
    logStartBytes: await fileSize('/project/log/netease_music.log'),
  };

  try {
    const settings = await readEnv();
    await clearSecondaryFiles();
    await removeContainer(name);
    await dockerApi('POST', `/containers/create?name=${encodeURIComponent(name)}`, {
      Image: taskImage,
      Env: envArrayFromSettings(settings),
      Cmd: isPublishOnly
        ? [
            'python',
            '-c',
            "import sys; sys.argv=['manual_interval_publish','--once']; import main; main.logger.info('[panel] run interval publish task only'); main.interval_task_runner()",
          ]
        : ['python', 'main.py', '--once'],
      HostConfig: {
        AutoRemove: false,
        ShmSize: taskShmSize,
        NetworkMode: 'netease-musician',
        Binds: [
          `${projectHostDir}/log:/app/log`,
          `${projectHostDir}/playwright_profiles:/app/playwright_profiles`,
          `${projectHostDir}/debug:/app/debug`,
          `${projectHostDir}/login.py:/app/playwright_handle/login.py`,
        ],
      },
    });
    await dockerApi('POST', `/containers/${encodeURIComponent(name)}/start`);
    const runPromise = dockerApi('POST', `/containers/${encodeURIComponent(name)}/wait`, null)
      .then(async () => containerLogs(name, 500));
    const timeoutPromise = sleep(420000).then(async () => {
      await dockerApi('POST', `/containers/${encodeURIComponent(name)}/kill`).catch(() => {});
      return '后台任务超过 420 秒，已自动停止临时运行容器。';
    });
    const output = await Promise.race([runPromise, timeoutPromise]);
    runJob.output = output || '任务执行结束，但没有返回输出。';
    runJob.qrUrl = extractQrUrl(runJob.output);
  } catch (error) {
    runJob.error = error.message;
    runJob.output = `${runJob.output}\n${error.message}`;
    if (error.message.includes('timeout')) {
      await dockerApi('POST', `/containers/${encodeURIComponent(name)}/kill`).catch(() => {});
      runJob.output = `${runJob.output}\n检测到 Docker API 超时，已停止临时运行容器。`;
    }
  } finally {
    await removeContainer(name);
    activeRunContainer = '';
    runJob.qrUrl = runJob.qrUrl || extractQrUrl(runJob.output);
    runJob.running = false;
    runJob.finishedAt = new Date().toISOString();
  }
}

async function startRunOnceJob() {
  return startRunJob({ mode: 'once' });
}

async function startPublishJob() {
  return startRunJob({ mode: 'publish' });
}

function extractQrUrl(text) {
  const match = String(text || '').match(/https:\/\/api\.pwmqr\.com\/qrcode\/create\/\?url=[^\s]+/);
  return match ? match[0] : '';
}

async function listUsers() {
  const rows = await redis.hgetall('netease:music:task');
  return Object.entries(rows).map(([key, raw]) => {
    let parsed = {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = {};
    }
    return {
      key,
      phone: parsed.phone || '',
      hasPassword: Boolean(parsed.password),
    };
  });
}

app.register(cookie);
app.register(formbody);
app.register(staticPlugin, {
  root: new URL('./public', import.meta.url).pathname,
});

app.post('/api/login', async (request, reply) => {
  if ((request.body?.password || '') !== adminPassword) {
    reply.code(401).send({ error: '密码错误' });
    return;
  }
  reply.setCookie('session', `ok.${sign('ok')}`, {
    httpOnly: true,
    sameSite: 'strict',
    path: '/',
  });
  reply.send({ ok: true });
});

app.post('/api/logout', async (_request, reply) => {
  reply.clearCookie('session', { path: '/' }).send({ ok: true });
});

app.get('/api/state', { preHandler: requireAuth }, async () => {
  const [settings, users, ps, logs] = await Promise.all([
    readEnv(),
    listUsers(),
    composeStatus(),
    fileLogs(120).catch(() => containerLogs(taskContainer, 80).catch((error) => error.message)),
  ]);
  return { settings, users, ps, logs };
});

app.get('/api/run-status', { preHandler: requireAuth }, async () => {
  const secondary = await readSecondaryStatus();
  if (runJob.running) {
    const currentLogs = await fileLogsSince(runJob.logStartBytes).catch(() => '');
    if (currentLogs) {
      runJob.output = `后台任务已启动，正在执行 python main.py --once ...\n${currentLogs}`;
    }
  }
  if (runJob.running && !runJob.qrUrl) {
    const logs = await fileLogsSince(runJob.logStartBytes).catch(() => '');
    const qrUrl = extractQrUrl(logs);
    if (qrUrl) {
      runJob.qrUrl = qrUrl;
      runJob.output = `${runJob.output}\n${logs}`;
    }
  }
  return { ...runJob, secondary };
});

app.post('/api/sms-code', { preHandler: requireAuth }, async (request, reply) => {
  if (request.body?.sent) {
    await fs.mkdir('/project/debug', { recursive: true });
    await fs.writeFile(
      secondaryInputPath,
      JSON.stringify({ sent: true, submittedAt: new Date().toISOString() }),
      'utf8',
    );
    reply.send({ ok: true });
    return;
  }
  const code = String(request.body?.code || '').replace(/\D+/g, '').slice(0, 8);
  if (!code || code.length < 4) {
    reply.code(400).send({ error: '请输入有效的短信验证码' });
    return;
  }
  await fs.mkdir('/project/debug', { recursive: true });
  await fs.writeFile(
    secondaryInputPath,
    JSON.stringify({ code, submittedAt: new Date().toISOString() }),
    'utf8',
  );
  reply.send({ ok: true });
});

app.post('/api/settings', { preHandler: requireAuth }, async (request) => {
  if (runJob.running || containerBusy) {
    return { ok: false, message: '任务容器正在运行或重启中，请稍后再保存设置。' };
  }
  containerBusy = true;
  try {
  await writeEnv(request.body || {});
  return { ok: true };
  } finally {
    containerBusy = false;
  }
});

app.post('/api/users', { preHandler: requireAuth }, async (request, reply) => {
  const { key, phone, password } = request.body || {};
  if (!key || !phone || !password) {
    reply.code(400).send({ error: '任务名、账号和密码都必填' });
    return;
  }
  await redis.hset('netease:music:task', key, JSON.stringify({ phone, password }));
  reply.send({ ok: true });
});

app.delete('/api/users/:key', { preHandler: requireAuth }, async (request) => {
  await redis.hdel('netease:music:task', request.params.key);
  return { ok: true };
});

app.post('/api/run-once', { preHandler: requireAuth }, async () => {
  if (containerBusy) {
    return {
      running: false,
      startedAt: null,
      finishedAt: new Date().toISOString(),
      output: '任务容器正在保存设置或重启中，请稍后再运行。',
      error: 'container_busy',
    };
  }
  if (runJob.running) {
    return runJob;
  }
  startRunOnceJob();
  return runJob;
});

app.post('/api/run-publish', { preHandler: requireAuth }, async () => {
  if (containerBusy) {
    return {
      running: false,
      startedAt: null,
      finishedAt: new Date().toISOString(),
      output: '任务容器正在保存设置或重启中，请稍后再运行。',
      error: 'container_busy',
    };
  }
  if (runJob.running) {
    return runJob;
  }
  startPublishJob();
  return runJob;
});

app.post('/api/restart', { preHandler: requireAuth }, async () => {
  if (runJob.running || containerBusy) {
    return { output: '任务正在运行或容器正在处理中，请先强制停止或稍后再重启。' };
  }
  containerBusy = true;
  try {
    await dockerApi('POST', `/containers/${encodeURIComponent(taskContainer)}/stop?t=5`).catch(() => {});
    return { output: '已停止主任务容器；立即运行会使用临时容器。' };
  } finally {
    containerBusy = false;
  }
});

app.post('/api/stop-run', { preHandler: requireAuth }, async () => {
  if (activeRunContainer) {
    await dockerApi('POST', `/containers/${encodeURIComponent(activeRunContainer)}/kill`).catch(() => {});
    await removeContainer(activeRunContainer);
  }
  runJob = {
    running: false,
    startedAt: runJob.startedAt,
    finishedAt: new Date().toISOString(),
    output: `${runJob.output}\n已强制停止临时运行容器。`,
    error: '',
    qrUrl: runJob.qrUrl || extractQrUrl(runJob.output),
    logStartBytes: runJob.logStartBytes,
  };
  await clearSecondaryFiles();
  return runJob;
});

app.get('/api/logs', { preHandler: requireAuth }, async () => {
  const logs = await fileLogs(240).catch(() => containerLogs(taskContainer, 200).catch((error) => error.message));
  return { logs };
});

app.listen({ host: '0.0.0.0', port: 8080 });
