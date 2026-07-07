const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ===== 配置 =====
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const DATA_FILE = path.join(__dirname, 'data.json');

// ===== 中间件 =====
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// 兼容两种目录结构：优先使用 public/，若不存在则从根目录提供静态文件
const publicDir = path.join(__dirname, 'public');
const staticDir = fs.existsSync(publicDir) ? publicDir : __dirname;
app.use(express.static(staticDir));

// ===== 数据存储 =====
function getDefaultData() {
    return {
        attendees: [],
        checkins: [],
        signups: []
    };
}

function loadData() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const raw = fs.readFileSync(DATA_FILE, 'utf-8');
            const data = JSON.parse(raw);
            if (!data.attendees) data.attendees = [];
            if (!data.checkins) data.checkins = [];
            if (!data.signups) data.signups = [];
            return data;
        }
    } catch (e) {
        console.error('读取数据失败:', e.message);
    }
    return getDefaultData();
}

function saveData(data) {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) {
        console.error('保存数据失败:', e.message);
    }
}

// ===== 工具函数 =====
function genId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function formatTime(ts) {
    if (!ts) return '--';
    const d = new Date(ts);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function getPhone(phone) {
    return (phone || '').trim().replace(/\s/g, '');
}

function isValidPhone(phone) {
    return /^1\d{10}$/.test((phone || '').trim());
}

// ===== API 接口 =====

// 查询手机号状态
app.post('/api/lookup', (req, res) => {
    const phone = getPhone(req.body.phone);
    if (!phone || !isValidPhone(phone)) {
        return res.json({ status: 'invalid', message: '手机号格式错误' });
    }

    const data = loadData();

    // 是否已签到
    const checkinRecord = data.checkins.find(c => c.phone === phone);
    if (checkinRecord) {
        return res.json({
            status: 'checked',
            user: checkinRecord
        });
    }

    const signupChecked = data.signups.find(s => s.phone === phone && s.checkinTime);
    if (signupChecked) {
        return res.json({
            status: 'checked',
            user: signupChecked
        });
    }

    // 是否在报名名单中
    const attendee = data.attendees.find(a => a.phone === phone);
    if (attendee) {
        return res.json({
            status: 'attendee',
            user: attendee
        });
    }

    // 新用户
    return res.json({ status: 'new', phone });
});

// 签到
app.post('/api/checkin', (req, res) => {
    const { name, phone, unit } = req.body;
    const cleanPhone = getPhone(phone);

    if (!cleanPhone || !isValidPhone(cleanPhone)) {
        return res.status(400).json({ success: false, message: '手机号格式错误' });
    }

    const data = loadData();

    // 检查是否已签到
    if (data.checkins.some(c => c.phone === cleanPhone)) {
        return res.json({ success: false, message: '您已签到，请勿重复签到' });
    }
    if (data.signups.some(s => s.phone === cleanPhone && s.checkinTime)) {
        return res.json({ success: false, message: '您已签到，请勿重复签到' });
    }

    // 检查是否在报名名单中
    const inAttendees = data.attendees.some(a => a.phone === cleanPhone);
    if (!inAttendees) {
        return res.status(400).json({ success: false, message: '请通过报名流程签到' });
    }

    const record = {
        id: genId(),
        name: name || '--',
        phone: cleanPhone,
        unit: unit || '--',
        checkinTime: Date.now()
    };
    data.checkins.push(record);
    saveData(data);

    return res.json({ success: true, record });
});

// 报名并签到
app.post('/api/signup', (req, res) => {
    const { name, phone, unit } = req.body;
    const cleanPhone = getPhone(phone);

    if (!name || !name.trim()) {
        return res.status(400).json({ success: false, message: '请输入姓名' });
    }
    if (!cleanPhone || !isValidPhone(cleanPhone)) {
        return res.status(400).json({ success: false, message: '请输入正确的手机号' });
    }
    if (!unit || !unit.trim()) {
        return res.status(400).json({ success: false, message: '请输入单位名称' });
    }

    const data = loadData();

    if (data.checkins.some(c => c.phone === cleanPhone)) {
        return res.json({ success: false, message: '该手机号已签到' });
    }
    if (data.signups.some(s => s.phone === cleanPhone && s.checkinTime)) {
        return res.json({ success: false, message: '该手机号已签到' });
    }
    if (data.attendees.some(a => a.phone === cleanPhone)) {
        return res.json({ success: false, message: '您已在报名名单中，请使用签到功能' });
    }

    const existing = data.signups.find(s => s.phone === cleanPhone);
    if (existing) {
        existing.checkinTime = Date.now();
        existing.name = name.trim();
        existing.unit = unit.trim();
        saveData(data);
        return res.json({ success: true, record: existing });
    }

    const newSignup = {
        id: genId(),
        name: name.trim(),
        phone: cleanPhone,
        unit: unit.trim(),
        signupTime: Date.now(),
        checkinTime: Date.now()
    };
    data.signups.push(newSignup);
    saveData(data);

    return res.json({ success: true, record: newSignup });
});

// 后台密码验证
app.post('/api/admin/login', (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_PASSWORD) {
        return res.json({ success: true, token: 'admin-' + genId() });
    }
    return res.status(401).json({ success: false, message: '密码错误' });
});

// 获取后台数据
app.post('/api/admin/data', (req, res) => {
    const { password } = req.body;
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ success: false, message: '未授权' });
    }
    const data = loadData();
    return res.json({ success: true, data });
});

// 导入名单
app.post('/api/admin/import', (req, res) => {
    const { password, lines } = req.body;
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ success: false, message: '未授权' });
    }

    const data = loadData();
    let added = 0;
    let skipped = 0;
    const errors = [];

    (lines || []).forEach((line, idx) => {
        let parts = line.split(/[,，\t;；]/).map(s => s.trim());
        if (parts.length < 2) {
            errors.push(`第 ${idx + 1} 行格式错误: "${line}"`);
            return;
        }
        const name = parts[0] || '';
        const phone = getPhone(parts[1] || '');
        const unit = parts[2] || '';

        if (!name || !phone) {
            errors.push(`第 ${idx + 1} 行缺少姓名或电话: "${line}"`);
            return;
        }
        if (!isValidPhone(phone)) {
            errors.push(`第 ${idx + 1} 行电话格式错误: "${phone}"`);
            return;
        }

        if (data.attendees.some(a => a.phone === phone)) {
            skipped++;
            return;
        }

        data.attendees.push({
            id: genId(),
            name,
            phone,
            unit: unit || '--'
        });
        added++;
    });

    if (added > 0) {
        saveData(data);
    }

    return res.json({ success: true, added, skipped, errors });
});

// 后台手动签到
app.post('/api/admin/checkin', (req, res) => {
    const { password, phone, name, unit } = req.body;
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ success: false, message: '未授权' });
    }

    const cleanPhone = getPhone(phone);
    const data = loadData();

    if (data.checkins.some(c => c.phone === cleanPhone)) {
        return res.json({ success: false, message: '该用户已签到' });
    }
    if (data.signups.some(s => s.phone === cleanPhone && s.checkinTime)) {
        return res.json({ success: false, message: '该用户已签到' });
    }

    const inAttendees = data.attendees.some(a => a.phone === cleanPhone);
    if (inAttendees) {
        data.checkins.push({
            id: genId(),
            name,
            phone: cleanPhone,
            unit: unit || '--',
            checkinTime: Date.now()
        });
        saveData(data);
        return res.json({ success: true, message: `${name} 签到成功` });
    }

    const existing = data.signups.find(s => s.phone === cleanPhone);
    if (existing) {
        existing.checkinTime = Date.now();
        saveData(data);
        return res.json({ success: true, message: `${name} 签到成功` });
    }

    data.signups.push({
        id: genId(),
        name,
        phone: cleanPhone,
        unit: unit || '--',
        signupTime: Date.now(),
        checkinTime: Date.now()
    });
    saveData(data);
    return res.json({ success: true, message: `${name} 已补录并签到` });
});

// 导出CSV
app.post('/api/admin/export', (req, res) => {
    const { password } = req.body;
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ success: false, message: '未授权' });
    }

    const data = loadData();
    const attendees = data.attendees || [];
    const checkins = data.checkins || [];
    const signups = data.signups || [];

    const allPeople = [];
    attendees.forEach(a => {
        const checked = checkins.some(c => c.phone === a.phone);
        const checkedTime = checkins.find(c => c.phone === a.phone)?.checkinTime || null;
        allPeople.push({
            name: a.name,
            phone: a.phone,
            unit: a.unit || '--',
            source: '报名名单',
            checked: checked ? '已签到' : '未签到',
            checkinTime: checkedTime ? formatTime(checkedTime) : '--',
            signupTime: '--'
        });
    });
    signups.forEach(s => {
        allPeople.push({
            name: s.name,
            phone: s.phone,
            unit: s.unit || '--',
            source: '新报名',
            checked: s.checkinTime ? '已签到' : '未签到',
            checkinTime: s.checkinTime ? formatTime(s.checkinTime) : '--',
            signupTime: s.signupTime ? formatTime(s.signupTime) : '--'
        });
    });

    const headers = ['姓名', '电话', '单位', '来源', '签到状态', '签到时间', '报名时间'];
    const rows = allPeople.map(p => [p.name, p.phone, p.unit, p.source, p.checked, p.checkinTime, p.signupTime]);

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    return res.json({ success: true, csv: '\uFEFF' + csvContent, count: allPeople.length });
});

// 重置数据
app.post('/api/admin/reset', (req, res) => {
    const { password } = req.body;
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ success: false, message: '未授权' });
    }
    saveData(getDefaultData());
    return res.json({ success: true, message: '已重置所有数据' });
});

// 健康检查
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
});

// 所有其他路由返回前端
app.get('*', (req, res) => {
    const indexPath = path.join(staticDir, 'index.html');
    res.sendFile(indexPath);
});

// ===== 启动服务器 =====
app.listen(PORT, () => {
    console.log(`\n  📋 签到系统服务已启动`);
    console.log(`  📍 本地访问: http://localhost:${PORT}`);
    console.log(`  🔐 管理密码: ${ADMIN_PASSWORD}`);
    console.log(`  💾 数据文件: ${DATA_FILE}\n`);
});
