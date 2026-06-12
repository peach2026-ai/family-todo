const QWEN_API_KEY = 'sk-7d7a9440783f43b1a409e49ba85389b5';
const QWEN_API_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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
6. 只返回JSON，不要其他文字
7. **物品名称必须转为家人日常会说的叫法**，不要直接复制包装上的完整商品名：
   - 英文品牌转中文：PROYA→珀莱雅、LANCOME→兰蔻、OLAY→OLAY、SK-II→SK2
   - 去掉营销修饰词（如"赋能鲜颜淡纹紧致轻盈"这种），只保留核心产品线名称
   - 用外观特征或昵称描述（如"大红瓶"、"小白瓶"、"红宝石"）
   - 示例：
     * "PROYA赋能鲜颜淡纹紧致轻盈霜" → "珀莱雅红宝石面霜"
     * "OLAY新生塑颜金纯面霜（信号肽）" → "OLAY大红瓶面霜"
     * "维D2磷葡钙片" → "钙片"
     * "小安素全营养配方粉" → "小安素奶粉"
   - 保留关键区分信息（如面霜vs精华、感冒药vs退烧药）`,
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
      if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
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
};
