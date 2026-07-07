const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
// Token 签名密钥：部署时建议设置 APP_SECRET（固定值）；不设置则每次重启随机生成
const SECRET = process.env.APP_SECRET || crypto.randomBytes(32).toString('hex');
const DATA_FILE = path.join(__dirname, 'data.json');
const TOKEN_TTL = 2 * 60 * 60 * 1000; // Token 有效期 2 小时

// 兼容 public/ 目录结构：有 public/ 用 public/，否则用项目根目录
const publicDir = path.join(__dirname, 'public');
const staticDir = fs.existsSync(publicDir) ? publicDir : __dirname;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(staticDir));

// ===================== 数据存储 =====================
function getDefaultData() {
    return { admins: [], themes: [] };
}
function loadData() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const d = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
            if (!d.admins) d.admins = [];
            if (!d.themes) d.themes = [];
            return d;
        }
    } catch (e) {
        console.error('读取数据失败:', e.message);
    }
    return getDefaultData();
}
function saveData(d) {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2), 'utf-8');
    } catch (e) {
        console.error('保存数据失败:', e.message);
    }
}

// ===================== 密码哈希（PBKDF2，不依赖第三方库）=====================
function hashPassword(password, salt) {
    salt = salt || crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha256').toString('hex');
    return { salt, hash };
}
function verifyPassword(password, salt, hash) {
    const h = crypto.pbkdf2Sync(password || '', salt, 10000, 64, 'sha256').toString('hex');
    return h === hash;
}

// ===================== Token（HMAC 签名，无状态）=====================
function makeToken(payload) {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
    return body + '.' + sig;
}
function verifyToken(token) {
    if (!token || typeof token !== 'string' || !token.includes('.')) return null;
    const [body, sig] = token.split('.');
    const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
    if (sig !== expected) return null;
    let payload;
    try { payload = JSON.parse(Buffer.from(body, 'base64url').toString()); } catch { return null; }
    if (!payload.e || payload.e < Date.now()) return null;
    return payload;
}

// ===================== 工具函数 =====================
function genId() { return Date.now().toString(36) + crypto.randomBytes(4).toString('hex'); }
function formatTime(ts) {
    if (!ts) return '--';
    const d = new Date(ts);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function getPhone(p) { return (p || '').trim().replace(/\s/g, ''); }
function isValidPhone(p) { return /^1\d{10}$/.test((p || '').trim()); }
function findTheme(data, code) { return data.themes.find(t => t.code === code); }
function findAdmin(data, username) { return data.admins.find(a => a.username === username); }
function canManage(admin, theme) { return admin.isSuper || (theme && theme.owner === admin.username); }

// ===================== 公开接口（参与者）=====================
app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// 主题公开信息：参与者页据此加载活动名称与配色
app.get('/api/theme', (req, res) => {
    const code = (req.query.code || '').trim();
    if (!code) return res.status(400).json({ success: false, message: '缺少主题编码' });
    const data = loadData();
    const theme = findTheme(data, code);
    if (!theme) return res.status(404).json({ success: false, message: '主题不存在' });
    res.json({ success: true, theme: { code: theme.code, name: theme.name, color: theme.color || '#4F46E5' } });
});

// 查询手机号状态
app.post('/api/lookup', (req, res) => {
    const { code, phone } = req.body;
    const clean = getPhone(phone);
    if (!code || !clean || !isValidPhone(clean)) return res.status(400).json({ success: false, message: '参数错误' });
    const data = loadData();
    const theme = findTheme(data, code);
    if (!theme) return res.status(404).json({ success: false, message: '主题不存在' });
    const ck = theme.checkins.find(c => c.phone === clean);
    if (ck) return res.json({ status: 'checked', user: ck });
    const sc = theme.signups.find(s => s.phone === clean && s.checkinTime);
    if (sc) return res.json({ status: 'checked', user: sc });
    const at = theme.attendees.find(a => a.phone === clean);
    if (at) return res.json({ status: 'attendee', user: at });
    res.json({ status: 'new', phone: clean });
});

// 名单内签到
app.post('/api/checkin', (req, res) => {
    const { code, name, phone, unit } = req.body;
    const clean = getPhone(phone);
    if (!code || !clean || !isValidPhone(clean)) return res.status(400).json({ success: false, message: '参数错误' });
    const data = loadData();
    const theme = findTheme(data, code);
    if (!theme) return res.status(404).json({ success: false, message: '主题不存在' });
    if (theme.checkins.some(c => c.phone === clean)) return res.json({ success: false, message: '您已签到，请勿重复签到' });
    if (theme.signups.some(s => s.phone === clean && s.checkinTime)) return res.json({ success: false, message: '您已签到，请勿重复签到' });
    if (!theme.attendees.some(a => a.phone === clean)) return res.status(400).json({ success: false, message: '请通过报名流程签到' });
    const record = { id: genId(), name: name || '--', phone: clean, unit: unit || '--', checkinTime: Date.now() };
    theme.checkins.push(record);
    saveData(data);
    res.json({ success: true, record });
});

// 报名并签到
app.post('/api/signup', (req, res) => {
    const { code, name, phone, unit } = req.body;
    const clean = getPhone(phone);
    if (!code || !name || !name.trim()) return res.status(400).json({ success: false, message: '请输入姓名' });
    if (!clean || !isValidPhone(clean)) return res.status(400).json({ success: false, message: '请输入正确的手机号' });
    if (!unit || !unit.trim()) return res.status(400).json({ success: false, message: '请输入单位名称' });
    const data = loadData();
    const theme = findTheme(data, code);
    if (!theme) return res.status(404).json({ success: false, message: '主题不存在' });
    if (theme.checkins.some(c => c.phone === clean)) return res.json({ success: false, message: '该手机号已签到' });
    if (theme.signups.some(s => s.phone === clean && s.checkinTime)) return res.json({ success: false, message: '该手机号已签到' });
    if (theme.attendees.some(a => a.phone === clean)) return res.json({ success: false, message: '您已在报名名单中，请使用签到功能' });
    const existing = theme.signups.find(s => s.phone === clean);
    if (existing) {
        existing.checkinTime = Date.now();
        existing.name = name.trim();
        existing.unit = unit.trim();
        saveData(data);
        return res.json({ success: true, record: existing });
    }
    const n = { id: genId(), name: name.trim(), phone: clean, unit: unit.trim(), signupTime: Date.now(), checkinTime: Date.now() };
    theme.signups.push(n);
    saveData(data);
    res.json({ success: true, record: n });
});

// ===================== 普通管理后台登录（需 管理员 + 密码 + 主题编码）=====================
app.post('/api/admin/login', (req, res) => {
    const { username, password, code } = req.body;
    const data = loadData();
    const admin = findAdmin(data, username);
    const theme = findTheme(data, code);
    if (!admin || !verifyPassword(password, admin.salt, admin.hash)) return res.status(401).json({ success: false, message: '管理员账号或密码错误' });
    if (!theme) return res.status(404).json({ success: false, message: '主题编码不存在' });
    if (!canManage(admin, theme)) return res.status(403).json({ success: false, message: '您无权管理该主题' });
    const token = makeToken({ u: username, c: code, scope: 'admin', e: Date.now() + TOKEN_TTL });
    res.json({ success: true, token, theme: { code: theme.code, name: theme.name } });
});

// 管理操作鉴权：校验 Token（含 username + code）且对该主题有权限
function adminAuth(req, res, next) {
    const token = (req.body && req.body.token) || req.headers['x-token'];
    const p = verifyToken(token);
    if (!p || p.scope !== 'admin') return res.status(401).json({ success: false, message: '未授权，请重新登录' });
    const data = loadData();
    const admin = findAdmin(data, p.u);
    const theme = findTheme(data, p.c);
    if (!admin || !theme || !canManage(admin, theme)) return res.status(403).json({ success: false, message: '无权限' });
    req.ctx = { data, admin, theme };
    next();
}

app.post('/api/admin/data', adminAuth, (req, res) => {
    const { theme } = req.ctx;
    res.json({ success: true, data: { attendees: theme.attendees, checkins: theme.checkins, signups: theme.signups } });
});

app.post('/api/admin/import', adminAuth, (req, res) => {
    const { theme, data } = req.ctx;
    const lines = req.body.lines || [];
    let added = 0, skipped = 0;
    const errors = [];
    lines.forEach((line, idx) => {
        const parts = line.split(/[,，\t;；]/).map(s => s.trim());
        if (parts.length < 2) { errors.push(`第 ${idx + 1} 行格式错误: "${line}"`); return; }
        const name = parts[0] || '';
        const phone = getPhone(parts[1] || '');
        const unit = parts[2] || '';
        if (!name || !phone) { errors.push(`第 ${idx + 1} 行缺少姓名或电话`); return; }
        if (!isValidPhone(phone)) { errors.push(`第 ${idx + 1} 行电话格式错误: "${phone}"`); return; }
        if (theme.attendees.some(a => a.phone === phone)) { skipped++; return; }
        theme.attendees.push({ id: genId(), name, phone, unit: unit || '--' });
        added++;
    });
    if (added > 0) saveData(data);
    res.json({ success: true, added, skipped, errors });
});

app.post('/api/admin/checkin', adminAuth, (req, res) => {
    const { theme, data } = req.ctx;
    const { phone, name, unit } = req.body;
    const clean = getPhone(phone);
    if (theme.checkins.some(c => c.phone === clean)) return res.json({ success: false, message: '该用户已签到' });
    if (theme.signups.some(s => s.phone === clean && s.checkinTime)) return res.json({ success: false, message: '该用户已签到' });
    if (theme.attendees.some(a => a.phone === clean)) {
        theme.checkins.push({ id: genId(), name, phone: clean, unit: unit || '--', checkinTime: Date.now() });
        saveData(data);
        return res.json({ success: true, message: `${name} 签到成功` });
    }
    const ex = theme.signups.find(s => s.phone === clean);
    if (ex) {
        ex.checkinTime = Date.now();
        saveData(data);
        return res.json({ success: true, message: `${name} 签到成功` });
    }
    theme.signups.push({ id: genId(), name, phone: clean, unit: unit || '--', signupTime: Date.now(), checkinTime: Date.now() });
    saveData(data);
    res.json({ success: true, message: `${name} 已补录并签到` });
});

app.post('/api/admin/export', adminAuth, (req, res) => {
    const { theme } = req.ctx;
    const all = [];
    theme.attendees.forEach(a => {
        const ck = theme.checkins.find(c => c.phone === a.phone);
        all.push({ name: a.name, phone: a.phone, unit: a.unit || '--', source: '报名名单', checked: ck ? '已签到' : '未签到', checkinTime: ck ? formatTime(ck.checkinTime) : '--', signupTime: '--' });
    });
    theme.signups.forEach(s => {
        all.push({ name: s.name, phone: s.phone, unit: s.unit || '--', source: '新报名', checked: s.checkinTime ? '已签到' : '未签到', checkinTime: s.checkinTime ? formatTime(s.checkinTime) : '--', signupTime: s.signupTime ? formatTime(s.signupTime) : '--' });
    });
    const headers = ['姓名', '电话', '单位', '来源', '签到状态', '签到时间', '报名时间'];
    const rows = all.map(p => [p.name, p.phone, p.unit, p.source, p.checked, p.checkinTime, p.signupTime]);
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    res.json({ success: true, csv: '\uFEFF' + csv, count: all.length });
});

app.post('/api/admin/reset', adminAuth, (req, res) => {
    const { theme, data } = req.ctx;
    theme.attendees = [];
    theme.checkins = [];
    theme.signups = [];
    saveData(data);
    res.json({ success: true, message: '已重置该主题数据' });
});

// ===================== 超级管理员 Console（开发者后端）=====================
app.post('/api/console/login', (req, res) => {
    const { username, password } = req.body;
    const data = loadData();
    const admin = findAdmin(data, username);
    if (!admin || !verifyPassword(password, admin.salt, admin.hash)) return res.status(401).json({ success: false, message: '账号或密码错误' });
    if (!admin.isSuper) return res.status(403).json({ success: false, message: '需要超级管理员权限' });
    const token = makeToken({ u: username, scope: 'console', e: Date.now() + TOKEN_TTL });
    res.json({ success: true, token, isSuper: true });
});

function consoleAuth(req, res, next) {
    const token = (req.body && req.body.token) || req.headers['x-token'];
    const p = verifyToken(token);
    if (!p || p.scope !== 'console') return res.status(401).json({ success: false, message: '未授权，请重新登录' });
    const data = loadData();
    const admin = findAdmin(data, p.u);
    if (!admin || !admin.isSuper) return res.status(403).json({ success: false, message: '无权限' });
    req.ctx = { data, admin };
    next();
}

// 首次初始化状态
app.get('/api/console/init', (req, res) => {
    const data = loadData();
    res.json({ initialized: data.admins.length > 0 });
});

// 创建第一个超级管理员（仅首次，自动为超级管理员 = 开发者）
app.post('/api/console/setup', (req, res) => {
    const { username, password } = req.body;
    if (!username || !username.trim()) return res.status(400).json({ success: false, message: '请填写管理员用户名' });
    if (!password || password.length < 4) return res.status(400).json({ success: false, message: '密码至少 4 位' });
    const data = loadData();
    if (data.admins.length > 0) return res.status(400).json({ success: false, message: '已初始化，请勿重复创建' });
    const { salt, hash } = hashPassword(password);
    data.admins.push({ username: username.trim(), salt, hash, isSuper: true, createdAt: Date.now() });
    saveData(data);
    const token = makeToken({ u: username.trim(), scope: 'console', e: Date.now() + TOKEN_TTL });
    res.json({ success: true, token, isSuper: true, message: '超级管理员创建成功' });
});

app.post('/api/console/admins', consoleAuth, (req, res) => {
    const { data } = req.ctx;
    res.json({ success: true, admins: data.admins.map(a => ({ username: a.username, isSuper: !!a.isSuper, createdAt: a.createdAt })) });
});

app.post('/api/console/admin/create', consoleAuth, (req, res) => {
    const { username, password } = req.body;
    if (!username || !username.trim()) return res.status(400).json({ success: false, message: '请填写用户名' });
    if (!password || password.length < 4) return res.status(400).json({ success: false, message: '密码至少 4 位' });
    const { data } = req.ctx;
    if (findAdmin(data, username.trim())) return res.status(400).json({ success: false, message: '管理员已存在' });
    const { salt, hash } = hashPassword(password);
    data.admins.push({ username: username.trim(), salt, hash, isSuper: false, createdAt: Date.now() });
    saveData(data);
    res.json({ success: true, message: `管理员 ${username.trim()} 创建成功` });
});

// 修改密码（超级管理员可改任意管理员；普通管理员也能改自己，但 console 仅 super 可进）
app.post('/api/console/admin/password', consoleAuth, (req, res) => {
    const { username, newPassword } = req.body;
    if (!newPassword || newPassword.length < 4) return res.status(400).json({ success: false, message: '新密码至少 4 位' });
    const { data } = req.ctx;
    const target = findAdmin(data, (username || '').trim()) || req.ctx.admin;
    const { salt, hash } = hashPassword(newPassword);
    target.salt = salt;
    target.hash = hash;
    saveData(data);
    res.json({ success: true, message: '密码已更新' });
});

app.post('/api/console/themes', consoleAuth, (req, res) => {
    const { data } = req.ctx;
    res.json({ success: true, themes: data.themes.map(t => ({ code: t.code, name: t.name, color: t.color, owner: t.owner, attendees: (t.attendees || []).length, checkins: (t.checkins || []).length })) });
});

// 创建主题（主题编码唯一，不可重复）
app.post('/api/console/theme/create', consoleAuth, (req, res) => {
    const { code, name, color } = req.body;
    if (!code || !code.trim()) return res.status(400).json({ success: false, message: '主题编码必填' });
    if (!name || !name.trim()) return res.status(400).json({ success: false, message: '主题名称必填' });
    const { data, admin } = req.ctx;
    const c = code.trim();
    if (findTheme(data, c)) return res.status(400).json({ success: false, message: '主题编码已存在，不可重复' });
    data.themes.push({ code: c, name: name.trim(), color: color || '#4F46E5', owner: admin.username, createdAt: Date.now(), attendees: [], checkins: [], signups: [] });
    saveData(data);
    res.json({ success: true, message: `主题「${name.trim()}」创建成功`, code: c });
});

// 开发者总后台：查看所有主题的完整数据
app.post('/api/console/data/all', consoleAuth, (req, res) => {
    const { data } = req.ctx;
    res.json({ success: true, themes: data.themes });
});

// ===================== 兜底路由 =====================
app.get('/api/*', (req, res) => res.status(404).json({ success: false, message: '接口不存在' }));
app.get('*', (req, res) => {
    const p = req.path;
    let file = 'index.html';
    if (p === '/admin' || p === '/admin.html') file = 'admin.html';
    else if (p === '/console' || p === '/console.html') file = 'console.html';
    res.sendFile(path.join(staticDir, file));
});

app.listen(PORT, () => {
    console.log(`\n  📋 多主题签到系统已启动`);
    console.log(`  📍 本地访问: http://localhost:${PORT}`);
    console.log(`  🔧 首次使用请访问 /console 创建超级管理员（开发者账号）\n`);
});
