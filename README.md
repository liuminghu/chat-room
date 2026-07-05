# 实时聊天室

一个基于 Node.js + Socket.io 的实时多用户聊天室，集成 DeepSeek AI 群机器人。

## 功能特性

- 🚀 实时消息同步（Socket.io）
- 💬 多用户同时在线聊天
- 🤖 AI 群机器人（@小助手 对话）
- 🏷️ @艾特别人功能
- 🎨 美观的渐变界面设计
- 📱 响应式设计，支持移动端

## 技术栈

- **后端**: Node.js + Express + Socket.io
- **前端**: HTML5 + CSS3 + JavaScript
- **AI**: DeepSeek API

## 本地运行

```bash
# 安装依赖
npm install

# 设置环境变量
cp .env.example .env
# 编辑 .env，填入你的 DeepSeek API Key

# 启动服务
npm start
```

然后打开 http://localhost:3000

## 部署到 Vercel

### 1. 推送代码到 GitHub

### 2. 在 Vercel 导入项目
1. 登录 [vercel.com](https://vercel.com)
2. 点击 "New Project" → 导入你的 GitHub 仓库
3. Framework Preset 选 "Other"
4. 环境变量添加 `DEEPSEEK_API_KEY`，值为你的 DeepSeek API Key
5. 点击 "Deploy"

### 3. 配置说明
- `vercel.json` 已配置好路由
- 后端 Serverless Function 处理 Socket.io 和 API
- 前端静态文件在 `public/` 目录

## 项目结构

```
.
├── server.js          # 后端服务
├── package.json       # 依赖配置
├── vercel.json        # Vercel 部署配置
├── .env.example       # 环境变量示例
├── .gitignore
└── public/            # 前端静态文件
    ├── index.html
    ├── style.css
    └── app.js
```

## 使用说明

1. 输入昵称加入聊天室
2. 直接输入消息发送
3. 输入 `@` 可艾特别人
4. 输入 `@小助手` 或开头说"小助手"可召唤 AI 机器人
