const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://zgubxubqpkblrkgvomqo.supabase.co';
const SUPABASE_KEY = 'sb_publishable_mmo05rQjonntpyytYXOMBA_qB5y017l';
const QWEN_API_KEY = 'sk-7d7a9440783f43b1a409e49ba85389b5';
const QWEN_API_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const MEMBER_MAP = {
  dad: '强哥 👨', mom: '桃子 🍑', baby: '小宝 👶🏻',
  gpa: '外公 👴', gma: '外婆 👵',
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
  if (!taskSummary.trim()) taskSummary = '目前所有任务都已完成！';

  return `你是一个温馨的家庭贴心管家AI。这个管家系统的使用者是"强哥"和"桃子"（夫妻），他们用这个系统记录和管理全家人的任务。小宝是他们的宝宝（婴儿），还不懂事，不能作为提醒或建议对象。

以下是当前未完成的家庭任务：

${taskSummary}

请严格基于上面的任务列表，生成建议。要求：
1. 每条建议必须关联上面的某个具体任务，不要凭空编造建议
2. 如果没有未完成的任务，直接返回空字符串，什么都不要输出
3. 最多3条，可以少于3条，只针对真正需要提醒的任务
4. 建议对象只能是强哥和桃子，用"强哥""桃子"称呼
5. 小宝是婴儿，涉及小宝的任务直接提醒强哥桃子去做
6. 长辈的任务用"记得叮嘱外公…"的方式提醒
7. 语气温馨简短，每条一行，带emoji
8. 直接输出建议，不要标题、编号或多余格式`;
}

function getDefaultSuggestion() {
  const defaults = [
    '今天也要元气满满哦！全家一起加油 💪',
    '新的一天，新的开始 🌅',
  ];
  return defaults[Math.floor(Math.random() * defaults.length)];
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { data: tasks } = await supabase
      .from('tasks').select('*').eq('done', false);
    const taskList = tasks || [];

    const response = await fetch(QWEN_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${QWEN_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'qwen-turbo',
        messages: [
          { role: 'system', content: '你是一个温馨的家庭管家AI助手。' },
          { role: 'user', content: buildPrompt(taskList) },
        ],
        temperature: 0.8,
        max_tokens: 500,
      }),
    });

    if (!response.ok) {
      return res.status(502).json({ success: false, suggestion: getDefaultSuggestion() });
    }

    const result = await response.json();
    const suggestion = result.choices?.[0]?.message?.content?.trim();
    res.json({ success: true, suggestion: suggestion || getDefaultSuggestion(), source: suggestion ? 'qwen' : 'default' });
  } catch (err) {
    console.error('suggestion error:', err.message);
    res.status(500).json({ success: false, suggestion: getDefaultSuggestion() });
  }
};
