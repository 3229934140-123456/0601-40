import app from './app';
import prisma from './prisma';

const PORT = process.env.PORT || 3000;

const startServer = async () => {
  try {
    await prisma.$connect();
    console.log('Database connected successfully');

    app.listen(PORT, () => {
      console.log(`\n🚀 AI 应用平台后端服务已启动`);
      console.log(`📍 服务地址: http://localhost:${PORT}`);
      console.log(`📊 健康检查: http://localhost:${PORT}/health`);
      console.log(`\n📚 API 文档:`);
      console.log(`   会话模块:   POST/GET /api/v1/sessions`);
      console.log(`   文档模块:   POST/GET /api/v1/documents`);
      console.log(`   任务模块:   POST/GET /api/v1/tasks`);
      console.log(`   知识模块:   POST/GET /api/v1/knowledge`);
      console.log(`   审核模块:   POST /api/v1/audit/check`);
      console.log(`   统计模块:   GET /api/v1/stats/*`);
      console.log(`   管理模块:   GET/POST /api/v1/admin/*`);
      console.log(`\n🔑 默认管理员 Token: admin-secret-token`);
      console.log(`\n`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

process.on('SIGINT', async () => {
  console.log('\nShutting down gracefully...');
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\nShutting down gracefully...');
  await prisma.$disconnect();
  process.exit(0);
});
