const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = 3000;

// ===== 配置 =====
const SUPABASE_URL = 'https://zgubxubqpkblrkgvomqo.supabase.co';
const SUPABASE_KEY = 'sb_publishable_mmo05rQjonntpyytYXOMBA_qB5y017l';
const QWEN_API_KEY = '61ea2383b94a4fe1226f5d0ac6866005';
const QWEN_API_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
const QWEN_MODEL  = 'qwen-turbo';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

app.use(cors());
app.use(express.json());

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

// ===== 健康检查 =====
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`\n🏠 家庭贴心管家后端已启动`);
  console.log(`   地址: http://localhost:${PORT}`);
  console.log(`   建议接口: http://localhost:${PORT}/api/suggestion`);
  console.log(`   健康检查: http://localhost:${PORT}/api/health\n`);
});
