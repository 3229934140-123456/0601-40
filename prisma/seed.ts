import prisma from '../src/prisma';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

const seed = async () => {
  console.log('开始初始化数据...');

  const apiKey1 = uuidv4().replace(/-/g, '');
  const secret1 = uuidv4().replace(/-/g, '');
  const secretHash1 = await bcrypt.hash(secret1, 10);

  const existingKey = await prisma.apiKey.findFirst({
    where: { appId: 'default-app' },
  });

  if (!existingKey) {
    await prisma.apiKey.create({
      data: {
        key: apiKey1,
        name: '默认应用',
        appId: 'default-app',
        secretHash: secretHash1,
        quota: 10000,
        rateLimit: 100,
        status: 'active',
      },
    });
    console.log('✅ 已创建默认 API Key');
    console.log(`   App ID: default-app`);
    console.log(`   API Key: ${apiKey1}`);
    console.log(`   API Secret: ${secret1}`);
    console.log(`   配额: 10000 次/周期`);
  } else {
    console.log('ℹ️  默认 API Key 已存在');
  }

  const sensitiveWords = [
    { word: '暴力', category: '违法违规', severity: 'high' as const },
    { word: '色情', category: '违法违规', severity: 'high' as const },
    { word: '赌博', category: '违法违规', severity: 'high' as const },
    { word: '毒品', category: '违法违规', severity: 'high' as const },
    { word: '诈骗', category: '违法违规', severity: 'high' as const },
    { word: '传销', category: '违法违规', severity: 'high' as const },
    { word: '脏话', category: '粗俗用语', severity: 'medium' as const },
    { word: '垃圾广告', category: '商业推广', severity: 'low' as const },
    { word: '刷单', category: '违法违规', severity: 'medium' as const },
    { word: '代刷', category: '违法违规', severity: 'medium' as const },
  ];

  for (const word of sensitiveWords) {
    const existing = await prisma.sensitiveWord.findUnique({
      where: { word: word.word },
    });
    if (!existing) {
      await prisma.sensitiveWord.create({ data: word });
    }
  }
  console.log('✅ 已初始化敏感词库');

  const templates = [
    {
      name: '通用问答',
      code: 'general-qa',
      description: '通用问答场景，适用于一般性的问答交互',
      type: 'qa',
      systemPrompt: '你是一个专业的AI助手，请友好、准确地回答用户的问题。',
      status: 'active',
    },
    {
      name: '客服助手',
      code: 'customer-service',
      description: '客户服务场景，适用于客服对话',
      type: 'service',
      systemPrompt: '你是一位专业的客服代表，请用礼貌、专业的语气回答用户问题，尽力帮助用户解决问题。',
      status: 'active',
    },
    {
      name: '代码助手',
      code: 'code-assistant',
      description: '编程辅助场景，适用于代码编写和调试',
      type: 'developer',
      systemPrompt: '你是一位资深的软件工程师，请帮助用户编写、优化和调试代码。请提供清晰的代码示例和解释。',
      status: 'active',
    },
    {
      name: '文档摘要',
      code: 'doc-summary',
      description: '文档摘要场景，适用于长文档内容总结',
      type: 'content',
      systemPrompt: '你是一位专业的文档编辑，请对用户提供的内容进行清晰、准确的摘要总结。',
      status: 'active',
    },
    {
      name: '创意写作',
      code: 'creative-writing',
      description: '创意写作场景，适用于文案创作',
      type: 'content',
      systemPrompt: '你是一位富有创意的写作专家，请帮助用户创作出有吸引力、有创意的内容。',
      status: 'active',
    },
  ];

  for (const tpl of templates) {
    const existing = await prisma.sceneTemplate.findUnique({
      where: { code: tpl.code },
    });
    if (!existing) {
      await prisma.sceneTemplate.create({ data: tpl });
    }
  }
  console.log('✅ 已初始化场景模板');

  console.log('\n🎉 数据初始化完成！');
  console.log('\n📝 使用说明:');
  console.log('   请在请求头中添加:');
  console.log('   x-api-key: ' + (existingKey ? '（已存在）' : apiKey1));
  console.log('   x-app-id: default-app');
  console.log('\n');
};

seed()
  .catch((e) => {
    console.error('初始化失败:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
