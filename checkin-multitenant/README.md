# 多主题签到系统（全栈版 v2）

一个支持**多活动 / 多主题**的会议签到工具。每个活动有独立的「主题编码」，参与者通过带编码的链接进入对应签到页；管理员凭「账号 + 密码 + 主题编码」登录后台查看与管理数据；**开发者（超级管理员）**可通过独立控制台创建管理员、设置主题、查看全部数据。

> 密码不再写死在代码里，全部通过界面配置并加密存储。

---

## 一、核心特性

- 🏷️ **主题编码隔离**：每个活动一个唯一编码（不可重复），数据互相独立
- 🔗 **链接变式**：参与者访问 `?code=主题编码` 即进入对应活动页（名称、配色自动加载）
- 👤 **管理员体系**：可新增多名管理员，密码加密存储（PBKDF2）
- 🔐 **三重鉴权**：后台查看/操作需 `管理员 + 密码 + 主题编码`，未授权无法访问数据
- 🛠️ **开发者控制台**：超级管理员可创建管理员、修改密码、创建主题、查看**所有主题**数据
- 📤 **数据导出**：管理员可导出本主题 CSV，开发者可导出全部 CSV
- 📱 **多设备实时共享**：数据集中存储于服务器

---

## 二、目录结构

```
checkin-multitenant/
├── server.js          # 服务器主程序（多租户 + 鉴权）
├── package.json       # 依赖与启动配置
├── render.yaml        # Render 一键部署（已设 rootDir 指向本目录）
├── .gitignore         # 忽略 node_modules / data.json
├── public/
│   ├── index.html     # 参与者签到页（?code=主题编码）
│   ├── admin.html     # 管理后台（账号+密码+主题编码 登录）
│   └── console.html   # 开发者控制台（超级管理员）
├── data.json          # 运行时自动生成的数据文件（勿提交）
├── README.md
└── 部署指南.md
```

---

## 三、本地运行

需要本机已安装 Node.js（建议 18+）。

```bash
cd checkin-multitenant
npm install
node server.js
```

启动后访问：
- 参与者签到页：http://localhost:3000/?code=会议2026
- 管理后台：http://localhost:3000/admin.html?code=会议2026
- 开发者控制台：http://localhost:3000/console

> 首次使用必须先访问 `/console` 创建超级管理员（开发者）账号。

---

## 四、部署到云端（Render）

详细见 **`部署指南.md`**。要点：

1. 将 `checkin-multitenant/` 目录上传到 GitHub 仓库
2. 在 [Render](https://render.com) 选择 **New → Blueprint**，连接仓库（自动读取 `render.yaml`，已通过 `rootDir` 指向本目录）
3. 部署完成后：
   - 访问 `https://你的地址/console` 创建超级管理员
   - 在控制台创建主题（得到主题编码）
   - 把 `https://你的地址/?code=主题编码` 生成二维码分享给参与者

---

## 五、使用流程

### 第 1 步：初始化（仅一次）
部署后访问 `/console` → 创建超级管理员（开发者）账号。该账号即「开发者」，可查看所有主题数据。

### 第 2 步：创建管理员与主题（开发者）
在 `/console` 控制台：
- **新增管理员**：创建普通管理员账号（供各活动负责人使用）
- **创建主题**：填写「主题编码」（唯一）+「主题名称」+「配色」，如编码 `会议2026`
- 普通管理员只能管理自己创建的主题；开发者可管理全部

### 第 3 步：分享签到链接
把 `https://你的地址/?code=会议2026` 生成二维码，参与者扫码即进入该活动签到页。

### 第 4 步：参与者签到
参与者输入手机号 → 系统识别状态 → 填写姓名单位 → 签到 / 报名并签到。

### 第 5 步：管理员查看与管理
访问 `/admin.html?code=会议2026`，用「管理员账号 + 密码 + 主题编码」登录后，可：
- 查看报名 / 签到统计与明细
- 批量导入名单（姓名,手机号,单位）
- 手动补录签到
- 导出 CSV

### 第 6 步：开发者总后台
开发者在 `/console` 登录后，切换「全部数据」标签页，可查看并导出**所有主题**的完整数据。

---

## 六、API 接口

| 接口 | 方法 | 说明 | 鉴权 |
|------|------|------|------|
| `/api/health` | GET | 健康检查 | 无 |
| `/api/theme?code=` | GET | 主题公开信息 | 无 |
| `/api/lookup` | POST | 查手机号状态 | 需 code |
| `/api/checkin` | POST | 名单内签到 | 需 code |
| `/api/signup` | POST | 报名并签到 | 需 code |
| `/api/admin/login` | POST | 管理员登录（账号+密码+code） | — |
| `/api/admin/data` | POST | 本主题数据 | Token |
| `/api/admin/import` | POST | 导入名单 | Token |
| `/api/admin/checkin` | POST | 手动签到 | Token |
| `/api/admin/export` | POST | 导出 CSV | Token |
| `/api/admin/reset` | POST | 重置本主题 | Token |
| `/api/console/setup` | POST | 创建首个超级管理员 | 仅首次 |
| `/api/console/login` | POST | 超级管理员登录 | — |
| `/api/console/admin/create` | POST | 新增管理员 | 超级 Token |
| `/api/console/admin/password` | POST | 修改密码 | 超级 Token |
| `/api/console/theme/create` | POST | 创建主题（编码唯一） | 超级 Token |
| `/api/console/data/all` | POST | 全部主题数据 | 超级 Token |

---

## 七、常见问题

**Q：忘记超级管理员密码怎么办？**
A：登录服务器，删除 `data.json` 后重启，重新访问 `/console` 初始化（会清空所有数据，请先备份）。

**Q：主题编码能重复吗？**
A：不能。创建主题时系统会校验唯一性，重复会报错。

**Q：普通管理员能看到其他主题的数据吗？**
A：不能。普通管理员仅能管理自己创建的主题；只有超级管理员（开发者）可在控制台查看全部。

**Q：数据存在哪里？会被重置吗？**
A：数据存于云端 `data.json`（临时磁盘），重新部署会被重置，请定期用「导出 CSV」备份。

---

© 多主题签到系统 · 全栈版 v2
