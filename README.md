# 实时聊天室

一个基于 Firebase 的实时多用户聊天室应用。

## 功能特性

- 🚀 实时消息同步
- 💬 多用户同时在线聊天
- 🎨 美观的渐变界面设计
- 📱 响应式设计，支持移动端
- 💾 本地回退模式（未配置 Firebase 时使用 localStorage）

## 快速开始

### 方式一：直接使用（本地模式）

打开 `index.html` 即可使用，消息存储在浏览器本地。

### 方式二：配置 Firebase（推荐，支持多用户实时聊天）

1. 前往 [Firebase 控制台](https://console.firebase.google.com/) 创建项目
2. 启用 "Realtime Database"
3. 在项目设置中添加 Web 应用，获取配置信息
4. 编辑 `app.js`，替换 `firebaseConfig` 中的配置项：
   ```javascript
   const firebaseConfig = {
     apiKey: "你的-api-key",
     authDomain: "你的项目.firebaseapp.com",
     databaseURL: "https://你的项目-default-rtdb.firebaseio.com",
     projectId: "你的项目id",
     storageBucket: "你的项目.appspot.com",
     messagingSenderId: "你的发送者id",
     appId: "你的应用id"
   };
   ```
5. 设置 Firebase 数据库规则（测试阶段）：
   ```json
   {
     "rules": {
       "messages": {
         ".read": true,
         ".write": true
       }
     }
   }
   ```

## 部署到 GitHub Pages

1. 将代码推送到 GitHub 仓库
2. 进入仓库 Settings → Pages
3. Source 选择 `main` 分支，根目录
4. 等待部署完成后访问 `https://你的用户名.github.io/仓库名/`

## 技术栈

- HTML5
- CSS3
- JavaScript (ES6+)
- Firebase Realtime Database
