const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const simulateChatCompletion = async (
  messages: Array<{ role: string; content: string }>,
  systemPrompt?: string
): Promise<{ content: string; tokens: number }> => {
  await delay(500 + Math.random() * 1000);

  const lastUserMessage = [...messages].reverse().find(m => m.role === 'user')?.content || '';
  const hasSystemPrompt = systemPrompt || messages.some(m => m.role === 'system');

  let response = '';

  if (lastUserMessage.includes('你好') || lastUserMessage.includes('hello') || lastUserMessage.includes('hi')) {
    response = '您好！我是 AI 智能助手，很高兴为您服务。请问有什么可以帮助您的吗？';
  } else if (lastUserMessage.includes('天气')) {
    response = '关于天气查询，我可以为您提供一般性的天气预报信息。不过目前我无法获取实时天气数据，建议您通过专业的天气应用或网站获取最新的天气信息。';
  } else if (lastUserMessage.includes('代码') || lastUserMessage.includes('编程') || lastUserMessage.includes('code')) {
    response = '关于编程问题，我很乐意帮助您！我可以回答各种编程语言相关的问题，包括 JavaScript、Python、TypeScript、Java 等。请告诉我您具体遇到了什么问题，我会尽力提供解决方案。';
  } else {
    response = `我已经收到您的消息："${lastUserMessage.substring(0, 50)}${lastUserMessage.length > 50 ? '...' : ''}"。这是一个模拟的 AI 回复。在真实环境中，这里会调用大语言模型生成更智能的回答。${hasSystemPrompt ? '（已根据角色提示进行调整）' : ''}`;
  }

  const tokens = response.length + lastUserMessage.length;

  return {
    content: response,
    tokens,
  };
};

export const simulateSummarize = async (
  text: string,
  options?: { length?: 'short' | 'medium' | 'long'; language?: string }
): Promise<{ content: string; tokens: number }> => {
  await delay(1000 + Math.random() * 2000);

  const length = options?.length || 'medium';
  const language = options?.language || 'zh';

  let summary = '';
  const firstLine = text.substring(0, 100);

  if (length === 'short') {
    summary = `【摘要】本文主要内容概述：${firstLine}...（共 ${text.length} 字）`;
  } else if (length === 'long') {
    summary = `【详细摘要】

一、核心内容
本文档主要包含以下关键信息：${firstLine}...

二、主要观点
1. 文档围绕中心主题展开论述
2. 提供了详细的背景信息和数据支撑
3. 给出了明确的结论和建议

三、关键数据
- 文档总字数：约 ${text.length} 字
- 核心要点：5-8 个重要概念

四、总结建议
建议进一步阅读原文以获取完整信息。本摘要由 AI 自动生成，仅供参考。`;
  } else {
    summary = `【内容摘要】

本文档主要介绍了 ${firstLine}... 等相关内容。全文约 ${text.length} 字，涵盖了多个重要方面。

主要内容包括：
1. 背景介绍与问题阐述
2. 核心观点与分析
3. 结论与建议

如需了解更多细节，建议查阅完整文档。`;
  }

  return {
    content: summary,
    tokens: text.length + summary.length,
  };
};

export const simulateRewrite = async (
  text: string,
  options?: { style?: string; tone?: string; purpose?: string }
): Promise<{ content: string; tokens: number }> => {
  await delay(800 + Math.random() * 1500);

  const style = options?.style || 'professional';
  const tone = options?.tone || 'neutral';

  let rewritten = '';

  if (style === 'formal') {
    rewritten = `尊敬的读者：

经过专业整理和优化，原文内容如下：

${text}

以上内容已经过规范化处理，确保语言表达正式、准确。

此致
敬礼`;
  } else if (style === 'casual') {
    rewritten = `嘿，朋友们~ 👋

给大家分享一下这段内容哈：

${text}

怎么样，是不是挺有意思的？有啥想法欢迎交流哦~ 😊`;
  } else {
    rewritten = `【优化后内容】

${text}

---

*以上内容已通过 AI 智能改写优化，提升了可读性和表达效果。
改写风格：${style} / 语气：${tone}*`;
  }

  return {
    content: rewritten,
    tokens: text.length * 2,
  };
};

export const simulateKnowledgeSearch = async (
  query: string,
  knowledgeBaseId: string
): Promise<Array<{ title: string; content: string; source: string; relevance: number; pageNumber?: number }>> => {
  await delay(300 + Math.random() * 500);

  const mockResults = [
    {
      title: '人工智能发展概述',
      content: `人工智能（AI）是计算机科学的一个分支，致力于创建能够执行通常需要人类智能的任务的系统。这些任务包括学习、推理、问题解决、感知和语言理解等。关于"${query}"的相关内容在本文档第三章有详细说明。`,
      source: 'AI基础知识手册.pdf',
      relevance: 0.92,
      pageNumber: 15,
    },
    {
      title: '机器学习基础概念',
      content: `机器学习是人工智能的一个子领域，它使计算机能够从数据中学习并改进性能，而无需进行明确的编程。机器学习算法可以分为监督学习、无监督学习和强化学习等类别。与"${query}"相关的算法主要包括深度学习和神经网络。`,
      source: 'ML入门教程.docx',
      relevance: 0.85,
      pageNumber: 8,
    },
    {
      title: '自然语言处理应用',
      content: `自然语言处理（NLP）是人工智能的重要应用领域，关注计算机与人类语言之间的交互。NLP 技术包括文本分类、情感分析、机器翻译、问答系统等。针对"${query}"这一问题，可以使用语义搜索和知识图谱技术来提升回答质量。`,
      source: 'NLP实践指南.pdf',
      relevance: 0.78,
      pageNumber: 23,
    },
  ];

  return mockResults.slice(0, Math.floor(Math.random() * 3) + 2);
};

export const simulateDocumentParse = async (
  filePath: string,
  fileType: string
): Promise<{ content: string; pages?: number; chunks: Array<{ index: number; content: string }> }> => {
  await delay(1000 + Math.random() * 2000);

  const mockContent = `这是一份示例文档的解析内容。

第一章 概述
本文档主要介绍了 AI 应用平台的核心功能和使用方法。平台提供会话、文档、任务、知识、审核、统计、管理等七大模块，为企业内部工具提供统一的智能处理能力。

第二章 会话功能
会话模块支持多轮对话，可以设置系统角色提示，实现个性化的 AI 交互体验。支持上下文记忆，确保对话的连贯性。

第三章 文档处理
文档模块支持多种格式的文档上传和解析，包括 PDF、Word、PPT、TXT 等格式。解析后的文档可以用于摘要生成、知识检索等场景。

第四章 任务中心
任务模块支持摘要、改写等异步任务，用户可以提交任务后查询进度，支持任务取消功能。

第五章 知识库
知识模块支持构建企业知识库，实现智能问答和语义搜索，返回引用来源，确保答案的可追溯性。

第六章 内容审核
审核模块提供敏感词检测功能，支持自定义敏感词库，设置审核策略，保障内容安全。

第七章 统计分析
统计模块提供用量统计功能，支持按时间、按接口类型等多维度统计调用量和资源消耗。

第八章 系统管理
管理模块提供 API 密钥管理、额度限制、场景模板配置等功能，方便管理员进行系统配置。`;

  const chunkSize = 500;
  const chunks: Array<{ index: number; content: string }> = [];
  for (let i = 0; i < mockContent.length; i += chunkSize) {
    chunks.push({
      index: Math.floor(i / chunkSize),
      content: mockContent.substring(i, i + chunkSize),
    });
  }

  return {
    content: mockContent,
    pages: 8,
    chunks,
  };
};

export const simulateSensitiveCheck = async (
  text: string
): Promise<{
  passed: boolean;
  matchedWords: Array<{ word: string; category: string; severity: string; position: number }>;
  censoredText?: string;
}> => {
  await delay(100 + Math.random() * 200);

  const sensitiveWords = [
    { word: '暴力', category: '违法违规', severity: 'high' },
    { word: '色情', category: '违法违规', severity: 'high' },
    { word: '赌博', category: '违法违规', severity: 'high' },
    { word: '毒品', category: '违法违规', severity: 'high' },
    { word: '诈骗', category: '违法违规', severity: 'high' },
    { word: '脏话', category: '粗俗用语', severity: 'medium' },
    { word: '广告', category: '商业推广', severity: 'low' },
  ];

  const matchedWords: Array<{ word: string; category: string; severity: string; position: number }> = [];

  for (const sw of sensitiveWords) {
    let position = text.indexOf(sw.word);
    while (position !== -1) {
      matchedWords.push({
        word: sw.word,
        category: sw.category,
        severity: sw.severity,
        position,
      });
      position = text.indexOf(sw.word, position + 1);
    }
  }

  let censoredText = text;
  for (const mw of matchedWords) {
    const replacement = '*'.repeat(mw.word.length);
    censoredText = censoredText.replace(new RegExp(mw.word, 'g'), replacement);
  }

  return {
    passed: matchedWords.length === 0,
    matchedWords,
    censoredText: matchedWords.length > 0 ? censoredText : undefined,
  };
};
