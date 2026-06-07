import { Request, Response, NextFunction } from 'express';
import prisma from '../prisma';
import { AppError, asyncHandler } from './error.middleware';

declare global {
  namespace Express {
    interface Request {
      apiKey?: any;
    }
  }
}

export const apiKeyAuth = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const apiKeyHeader = req.headers['x-api-key'] as string;
  const appId = req.headers['x-app-id'] as string;

  if (!apiKeyHeader) {
    return next(new AppError(401, 'AUTH_API_KEY_MISSING', '缺少 API Key', '请在请求头中添加 x-api-key'));
  }

  if (!appId) {
    return next(new AppError(401, 'AUTH_APP_ID_MISSING', '缺少 App ID', '请在请求头中添加 x-app-id'));
  }

  const apiKeyRecord = await prisma.apiKey.findFirst({
    where: {
      key: apiKeyHeader,
      appId: appId,
      status: 'active',
    },
  });

  if (!apiKeyRecord) {
    return next(new AppError(401, 'AUTH_API_KEY_INVALID', '无效的 API Key 或 App ID', '请检查 API Key 和 App ID 是否正确，或密钥是否已被禁用'));
  }

  if (apiKeyRecord.expiresAt && apiKeyRecord.expiresAt < new Date()) {
    return next(new AppError(401, 'AUTH_API_KEY_EXPIRED', 'API Key 已过期', '请申请新的 API Key'));
  }

  if (apiKeyRecord.used >= apiKeyRecord.quota) {
    return next(new AppError(429, 'QUOTA_EXCEEDED', '调用额度已用完', '请升级额度或等待下个计费周期重置'));
  }

  req.apiKey = apiKeyRecord;
  next();
});

export const adminAuth = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const adminToken = req.headers['x-admin-token'] as string;
  const expectedToken = process.env.ADMIN_TOKEN || 'admin-secret-token';

  if (!adminToken || adminToken !== expectedToken) {
    return next(new AppError(403, 'AUTH_ADMIN_REQUIRED', '需要管理员权限', '请使用有效的管理员令牌访问'));
  }
  next();
});
