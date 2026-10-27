# 网易音乐人任务控制台

这是基于 [XingHehy/netease-musician-task](https://github.com/XingHehy/netease-musician-task) 的部署增强版本。

原项目提供网易音乐人任务自动化能力，包括多用户任务、定时执行、Playwright 网页登录、Redis 存储、日志管理、Webhook 通知等。本仓库不替代原项目核心逻辑，而是在原项目 Docker 镜像基础上，增加了一套更适合自部署使用的 Web 管理界面和 Compose 编排。

## 原项目

- 原项目地址：[XingHehy/netease-musician-task](https://github.com/XingHehy/netease-musician-task)
- Docker 镜像：`xinghehy/netease-musician-task:latest`

本仓库中的任务容器默认仍使用原项目镜像，主要改动集中在：

- `admin-panel/`：新增 Web 控制台
- `docker-compose.yml`：新增 Redis、任务容器、控制台的一键部署编排
- `login.py`：针对二次验证流程做了增强，并通过挂载覆盖容器内登录脚本

## 主要改进

### Web 控制台

新增一个浏览器管理界面，默认访问：

```text
http://YOUR_SERVER_IP:18080
```

控制台支持：

- 修改任务时间、执行间隔、每月执行上限
- 修改登录方式、Cookie 有效期、Cookie 到期提醒天数
- 配置企业微信机器人通知和自定义 Webhook
- 添加、查看、删除网易云账号任务
- 查看 Docker 容器状态
- 查看最近 10 条日志
- 点击“立即运行”手动执行一次任务
- 点击“发布动态”单独执行分享类任务，仍遵循原项目的执行间隔和每月上限
- 强制停止当前临时运行任务
- 校验每日执行时间，保存设置后重启任务容器使配置生效
- 临时任务最多运行 15 分钟，为登录和二次验证预留等待时间

### 更适合服务器自部署的 Docker Compose

本仓库提供完整 Compose 编排：

- `redis`：保存账号任务、Cookie、执行记录
- `netease-musician-task`：原项目任务容器
- `admin-panel`：新增管理面板

为了避免主任务容器一直在后台自动跑，推荐部署后保持主任务容器停止，通过控制台“立即运行”使用临时容器执行一次任务。

注意：“保存设置并重启任务”和“重启任务”都会启动主任务容器，恢复定时执行。如果只需要手动运行，操作后请再次执行 `docker compose stop netease-musician-task`。完整停止、恢复及发布前检查见 [运维说明](docs/operations.md)。

### 二次验证增强

原项目已支持 Playwright 登录和扫码验证。本仓库在此基础上增强了控制台联动：

- 支持原设备扫码验证链接展示
- 支持原设备确认方式
- 支持短信验证流程
- 支持网易“用绑定手机号主动发送短信到指定号码”的验证方式
- 控制台可显示短信内容和接收号码，并提供“我已发送短信”按钮
- 登录失败、验证码、二次验证等情况仍会保存 debug 截图，便于排查

### 通知配置更方便

控制台支持两种通知：

- 企业微信机器人：填写 `key=` 后面的机器人 key
- 自定义 Webhook：填写完整 Webhook URL，可配置 Method 和 Headers

如果同时配置了自定义 Webhook 和企业微信机器人，原项目逻辑会优先使用自定义 Webhook。

二次验证时还会通知需要短信验证、原设备确认、人工处理或等待超时；同一进程内，相同账号、方式和内容的通知在 5 分钟内不重复发送。通知可能包含账号及短信操作信息，请仅发送到自己信任的群或 Webhook。

### GitHub 上传友好

本仓库已做脱敏处理：

- 不提交真实 `.env`
- 不提交账号密码
- 不提交服务器 IP
- 不提交企业微信机器人 key
- 不提交日志、Redis 数据、浏览器 profile、debug 截图

公开配置请参考 `.env.example`，真实配置只保存在自己的服务器。

## 快速部署

### 1. 克隆仓库

```bash
git clone https://github.com/YOUR_NAME/YOUR_REPO.git
cd YOUR_REPO
```

### 2. 创建配置文件

```bash
cp .env.example .env
```

编辑 `.env`，至少修改：

```env
PROJECT_HOST_DIR=/opt/netease-musician-task
ADMIN_PANEL_PASSWORD=change-me
```

`PROJECT_HOST_DIR` 必须是你服务器上本项目的绝对路径。例如项目放在 `/opt/netease-musician-task`，就保持上面的值。

### 3. 启动服务

```bash
docker compose up -d --build
docker compose stop netease-musician-task
```

第二条命令用于停止常驻主任务容器。之后可通过控制台的“立即运行”按钮执行任务。

### 4. 打开控制台

```text
http://YOUR_SERVER_IP:18080
```

登录密码为 `.env` 中的：

```env
ADMIN_PANEL_PASSWORD=...
```

## 添加账号任务

可以直接在控制台“账号任务”区域添加：

- 任务名，例如 `user1`
- 网易云账号或手机号
- 网易云密码

也可以使用脚本：

```bash
bash add-netease-user.sh
```

账号信息会保存到 Redis 的 `netease:music:task` 哈希表中。

## 企业微信机器人配置

企业微信机器人 Webhook 类似：

```text
https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

在控制台或 `.env` 中只填写 `key=` 后面的内容：

```env
WECOM_WEBHOOK_KEY=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

不要提交这个 key 到 GitHub。

## 常用环境变量

| 变量 | 说明 |
| --- | --- |
| `PROJECT_HOST_DIR` | 服务器上本项目的绝对路径，用于临时运行容器挂载 |
| `ADMIN_PANEL_PASSWORD` | 控制台登录密码 |
| `SEND_TIME` | 每日任务执行时间，格式 `HH:MM` |
| `EXECUTION_INTERVAL_DAYS` | 分享类任务执行间隔天数 |
| `MAX_MONTHLY_SENDS` | 每月最多分享次数 |
| `LOGIN_METHOD` | 登录方式，建议 `playwright` |
| `SECONDARY_VERIFY_METHOD` | 二次验证优先方式，默认 `sms` |
| `WECOM_WEBHOOK_KEY` | 企业微信机器人 key |
| `CUSTOM_WEBHOOK_URL` | 自定义 Webhook 地址 |
| `COOKIE_EXPIRE_DAYS` | Cookie 写入 Redis 后的有效天数 |
| `COOKIE_NOTIFY_BEFORE_DAYS` | Cookie 到期前多少天提醒 |

更多原项目配置说明请参考：[原项目 README](https://github.com/XingHehy/netease-musician-task#readme)。

## 安全提醒

不要提交以下内容：

- `.env`
- 网易云账号和密码
- 企业微信机器人 key
- 自定义 Webhook token
- 服务器 IP
- `log/`
- `debug/`
- `redis-data/`
- `playwright_profiles/`

这些路径已在 `.gitignore` 中忽略。

## 致谢

核心任务能力来自 [XingHehy/netease-musician-task](https://github.com/XingHehy/netease-musician-task)。本仓库主要补充自部署控制台、Docker 编排、二次验证交互和脱敏部署模板。
