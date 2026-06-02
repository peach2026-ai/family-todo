process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = 3000;

// ===== 配置 =====
const SUPABASE_URL = 'https://zgubxubqpkblrkgvomqo.supabase.co';
const SUPABASE_KEY = 'sb_publishable_mmo05rQjonntpyytYXOMBA_qB5y017l';
const QWEN_API_KEY = 'sk-7d7a9440783f43b1a409e49ba85389b5';
const QWEN_API_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
const QWEN_MODEL  = 'qwen-turbo';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

app.use(cors());
app.use(express.json({ limit: '20mb' }));

// 静态文件 — 让 index.html 也能通过 localhost:3000 访问
app.use(express.static(__dirname));

// 成员名称映射
const MEMBER_MAP = {
  dad:  '强哥 👨',
  mom:  '桃子 👩',
  baby: '小宝 🧒',
  gpa:  '外公 👴',
  gma:  '外婆 👵',
};

function buildPrompt(tasks) {
  const grouped = {};
  for (const t of tasks) {
    const name = MEMBER_MAP[t.member] || t.member;
    if (!grouped[name]) grouped[name] = [];
    const pLabel = { high: '高', mid: '中', low: '低' }[t.priority] || '中';
    grouped[name].push(`[${pLabel}优先级] ${t.title}`);
  }

  let taskSummary = '';
  for (const [name, list] of Object.entries(grouped)) {
    taskSummary += `${name}的未完成任务：\n`;
    list.forEach(item => { taskSummary += `  - ${item}\n`; });
    taskSummary += '\n';
  }

  if (!taskSummary.trim()) {
    taskSummary = '目前所有任务都已完成！';
  }

  return `你是一个温馨的家庭贴心管家AI，你的服务对象是一个五口之家：爸爸、妈妈、小宝（孩子）、外公、外婆。

请根据以下未完成的家庭任务，生成3-5条温馨实用的建议：

${taskSummary}

要求：
1. 语气温馨亲切，像家人之间说话一样
2. 重点提醒今日未完成的高优先级任务，语气要有紧迫感但不要让人焦虑
3. 对小宝的提醒要用鼓励的口吻，比如"小宝加油！""小宝真棒！"
4. 对外公外婆的提醒要特别关心他们的健康和生活
5. 每条建议独占一行，用emoji让内容更生动 🌟
6. 直接输出建议内容，不要加标题、编号或多余格式`;
}

// ===== GET /api/suggestion =====
app.get('/api/suggestion', async (req, res) => {
  try {
    // 1. 从 Supabase 读取未完成的任务
    const { data: tasks, error: dbError } = await supabase
      .from('tasks')
      .select('*')
      .eq('done', false);

    if (dbError) {
      console.error('Supabase 查询失败:', dbError.message);
      // 如果数据库不可用，使用空任务列表继续生成通用建议
    }

    const taskList = tasks || [];

    // 2. 调用通义千问 API
    const prompt = buildPrompt(taskList);

    const response = await fetch(QWEN_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${QWEN_API_KEY}`,
      },
      body: JSON.stringify({
        model: QWEN_MODEL,
        messages: [
          { role: 'system', content: '你是一个温馨的家庭管家AI助手。' },
          { role: 'user',   content: prompt },
        ],
        temperature: 0.8,
        max_tokens: 500,
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error(`通义千问 API 错误 [${response.status}]:`, errBody);
      return res.status(502).json({
        success: false,
        error: '调用 AI 服务失败',
        suggestion: getDefaultSuggestion(),
      });
    }

    const result = await response.json();
    const suggestion = result.choices?.[0]?.message?.content?.trim();

    if (!suggestion) {
      return res.json({ success: true, suggestion: getDefaultSuggestion(), source: 'default' });
    }

    res.json({ success: true, suggestion, source: 'qwen' });

  } catch (err) {
    console.error('接口异常:', err.message);
    res.status(500).json({
      success: false,
      error: err.message,
      suggestion: getDefaultSuggestion(),
    });
  }
});

function getDefaultSuggestion() {
  const defaults = [
    '今天也要元气满满哦！全家一起加油 💪\n小宝先把作业写完再玩，加油！📚\n外公外婆记得按时吃药，注意休息 🍵\n爸爸妈妈工作辛苦了，晚上早点休息 🌙\n一家人在一起就是最大的幸福 ❤️',
    '新的一天，新的开始 🌅\n高优先级的任务要优先处理哦 ⏰\n小宝真棒，今天也要努力学习！🌟\n外公外婆多喝水，天气变化注意保暖 🧣\n全家齐心协力，没有什么困难是过不去的 💕',
  ];
  return defaults[Math.floor(Math.random() * defaults.length)];
}

// ===== POST /api/recognize-item — AI多图识别 =====
app.post('/api/recognize-item', async (req, res) => {
  try {
    const { images, image } = req.body;
    const imgList = images || (image ? [image] : []);
    if (!imgList.length) {
      return res.status(400).json({ success: false, error: '缺少图片数据' });
    }

    const content = [];
    for (const img of imgList.slice(0, 5)) {
      const url = img.startsWith('data:') ? img : `data:image/jpeg;base64,${img}`;
      content.push({ type: 'image_url', image_url: { url } });
    }
    content.push({
      type: 'text',
      text: `我上传了一个物品的多张照片，请仔细识别所有图片中的文字和内容，提取以下信息并以JSON格式返回：
{
  "name": "物品名称（如'维D2磷葡钙片'）",
  "category": "物品类型，只能从以下选择一个：食品、药品、化妆品、保健品、日用品、其他",
  "production_date": "生产日期（格式YYYY-MM-DD）",
  "shelf_life_days": "有效天数（数字），如果看到'有效期至'某日期则不填此项",
  "expiry_date": "过期日期（格式YYYY-MM-DD）",
  "confidence": "识别置信度（high/medium/low）"
}

识别规则：
1. 药品特征：有'批准文号'/'国药准字'/'OTC'标识
2. 生产日期关键词：'生产日期'/'生产批号'/'出厂日期'
3. 过期日期关键词：'有效期至'/'保质期至'/'失效日期'
4. 日期格式多样，如'2026/01/13'/'20260113'/'2026.01.13'，统一转换为YYYY-MM-DD格式
5. 如果某字段图片中没有，返回null
6. 只返回JSON，不要其他文字`,
    });

    const response = await fetch(QWEN_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${QWEN_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'qwen-vl-plus',
        messages: [{ role: 'user', content }],
        temperature: 0.1,
        max_tokens: 500,
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error(`视觉API错误 [${response.status}]:`, errBody);
      return res.status(502).json({ success: false, error: '调用视觉AI失败' });
    }

    const result = await response.json();
    const text = result.choices?.[0]?.message?.content?.trim() || '';
    console.log('AI识别原始返回:', text);

    let parsed = null;
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      console.warn('JSON解析失败:', text);
    }

    if (parsed) {
      res.json({ success: true, result: parsed });
    } else {
      res.json({ success: false, error: '无法解析识别结果', raw: text });
    }

  } catch (err) {
    console.error('识别接口异常:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ===== 健康检查 =====
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`\n🏠 家庭贴心管家后端已启动`);
  console.log(`   地址: http://localhost:${PORT}`);
  console.log(`   建议接口: GET  /api/suggestion`);
  console.log(`   物品识别: POST /api/recognize-item`);
  console.log(`   健康检查: GET  /api/health\n`);
});
