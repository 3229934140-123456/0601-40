import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import prisma from '../prisma';
import { successResponse, paginatedResponse } from '../utils/response';
import { toJSON, fromJSON } from '../utils/json';
import { AppError, asyncHandler } from '../middleware/error.middleware';
import { recordAuditLog } from '../services/monitoring.service';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';

const createApiKeySchema = z.object({
  name: z.string().min(1, '名称不能为空'),
  appId: z.string().min(1, 'App ID 不能为空'),
  quota: z.number().int().positive().optional().default(1000),
  rateLimit: z.number().int().positive().optional().default(100),
  expiresAt: z.string().optional(),
});

const listApiKeysSchema = z.object({
  page: z.string().optional().default('1'),
  pageSize: z.string().optional().default('10'),
  status: z.string().optional(),
});

const updateQuotaSchema = z.object({
  quota: z.number().int().min(0, '配额不能为负数'),
});

const createTemplateSchema = z.object({
  name: z.string().min(1, '模板名称不能为空'),
  code: z.string().min(1, '模板编码不能为空'),
  description: z.string().optional(),
  type: z.string().default('general'),
  systemPrompt: z.string().optional(),
  config: z.any().optional(),
  status: z.string().optional().default('active'),
});

const listTemplatesSchema = z.object({
  page: z.string().optional().default('1'),
  pageSize: z.string().optional().default('20'),
  type: z.string().optional(),
  status: z.string().optional(),
});

const feedbackSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().optional(),
  category: z.string().optional(),
  sessionId: z.string().optional(),
  messageId: z.string().optional(),
  metadata: z.any().optional(),
});

const listFeedbacksSchema = z.object({
  page: z.string().optional().default('1'),
  pageSize: z.string().optional().default('20'),
  rating: z.string().optional(),
  category: z.string().optional(),
});

const listErrorsSchema = z.object({
  page: z.string().optional().default('1'),
  pageSize: z.string().optional().default('20'),
  errorCode: z.string().optional(),
  endpoint: z.string().optional(),
});

export const createApiKey = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const body = createApiKeySchema.parse(req.body);

  const existing = await prisma.apiKey.findFirst({
    where: { appId: body.appId },
  });

  if (existing) {
    return next(new AppError(409, 'APP_ID_EXISTS', 'App ID 已存在', '请使用不同的 App ID'));
  }

  const apiKey = uuidv4().replace(/-/g, '');
  const secret = uuidv4().replace(/-/g, '');
  const secretHash = await bcrypt.hash(secret, 10);

  const newApiKey = await prisma.apiKey.create({
    data: {
      key: apiKey,
      name: body.name,
      appId: body.appId,
      secretHash,
      quota: body.quota,
      rateLimit: body.rateLimit,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
    },
  });

  successResponse(res, {
    id: newApiKey.id,
    name: newApiKey.name,
    appId: newApiKey.appId,
    apiKey: newApiKey.key,
    apiSecret: secret,
    quota: newApiKey.quota,
    rateLimit: newApiKey.rateLimit,
    status: newApiKey.status,
    createdAt: newApiKey.createdAt,
    expiresAt: newApiKey.expiresAt,
  }, 'API Key 创建成功', 201);
});

export const listApiKeys = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const query = listApiKeysSchema.parse(req.query);

  const page = parseInt(query.page as string);
  const pageSize = parseInt(query.pageSize as string);
  const skip = (page - 1) * pageSize;

  const where: any = {};
  if (query.status) where.status = query.status;

  const [apiKeys, total] = await Promise.all([
    prisma.apiKey.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize,
      select: {
        id: true,
        name: true,
        appId: true,
        key: true,
        status: true,
        quota: true,
        used: true,
        rateLimit: true,
        createdAt: true,
        expiresAt: true,
      },
    }),
    prisma.apiKey.count({ where }),
  ]);

  const data = apiKeys.map(k => ({
    ...k,
    remaining: k.quota - k.used,
    usagePercentage: Math.round((k.used / k.quota) * 100),
  }));

  paginatedResponse(res, data, total, page, pageSize, '获取 API Key 列表成功');
});

export const getApiKey = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { id } = req.params;

  const apiKey = await prisma.apiKey.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      appId: true,
      key: true,
      status: true,
      quota: true,
      used: true,
      rateLimit: true,
      createdAt: true,
      updatedAt: true,
      expiresAt: true,
      _count: {
        select: {
          sessions: true,
          documents: true,
          tasks: true,
          knowledgeBases: true,
        },
      },
    },
  });

  if (!apiKey) {
    return next(new AppError(404, 'API_KEY_NOT_FOUND', 'API Key 不存在', '请检查 ID 是否正确'));
  }

  successResponse(res, {
    ...apiKey,
    remaining: apiKey.quota - apiKey.used,
    usagePercentage: Math.round((apiKey.used / apiKey.quota) * 100),
  }, '获取 API Key 详情成功');
});

export const updateApiKey = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { id } = req.params;
  const { name, status, quota, rateLimit, expiresAt } = req.body;

  const apiKey = await prisma.apiKey.findUnique({ where: { id } });
  if (!apiKey) {
    return next(new AppError(404, 'API_KEY_NOT_FOUND', 'API Key 不存在', '请检查 ID 是否正确'));
  }

  const updated = await prisma.apiKey.update({
    where: { id },
    data: {
      name: name !== undefined ? name : undefined,
      status: status !== undefined ? status : undefined,
      quota: quota !== undefined ? quota : undefined,
      rateLimit: rateLimit !== undefined ? rateLimit : undefined,
      expiresAt: expiresAt !== undefined ? new Date(expiresAt) : undefined,
    },
  });

  successResponse(res, {
    id: updated.id,
    name: updated.name,
    status: updated.status,
    quota: updated.quota,
    used: updated.used,
    rateLimit: updated.rateLimit,
    expiresAt: updated.expiresAt,
  }, 'API Key 更新成功');
});

export const deleteApiKey = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { id } = req.params;

  const apiKey = await prisma.apiKey.findUnique({ where: { id } });
  if (!apiKey) {
    return next(new AppError(404, 'API_KEY_NOT_FOUND', 'API Key 不存在', '请检查 ID 是否正确'));
  }

  await prisma.apiKey.delete({ where: { id } });

  successResponse(res, null, 'API Key 删除成功');
});

export const updateQuota = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { id } = req.params;
  const body = updateQuotaSchema.parse(req.body);

  const apiKey = await prisma.apiKey.findUnique({ where: { id } });
  if (!apiKey) {
    return next(new AppError(404, 'API_KEY_NOT_FOUND', 'API Key 不存在', '请检查 ID 是否正确'));
  }

  const updated = await prisma.apiKey.update({
    where: { id },
    data: { quota: body.quota },
  });

  successResponse(res, {
    id: updated.id,
    quota: updated.quota,
    used: updated.used,
    remaining: updated.quota - updated.used,
  }, '配额更新成功');
});

export const resetQuota = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { id } = req.params;

  const apiKey = await prisma.apiKey.findUnique({ where: { id } });
  if (!apiKey) {
    return next(new AppError(404, 'API_KEY_NOT_FOUND', 'API Key 不存在', '请检查 ID 是否正确'));
  }

  const updated = await prisma.apiKey.update({
    where: { id },
    data: { used: 0 },
  });

  successResponse(res, {
    id: updated.id,
    quota: updated.quota,
    used: updated.used,
    remaining: updated.quota - updated.used,
  }, '配额重置成功');
});

export const createTemplate = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const body = createTemplateSchema.parse(req.body);

  const existing = await prisma.sceneTemplate.findUnique({
    where: { code: body.code },
  });

  if (existing) {
    return next(new AppError(409, 'TEMPLATE_CODE_EXISTS', '模板编码已存在', '请使用不同的编码'));
  }

  const template = await prisma.sceneTemplate.create({
    data: {
      name: body.name,
      code: body.code,
      description: body.description,
      type: body.type,
      systemPrompt: body.systemPrompt,
      config: toJSON(body.config),
      status: body.status,
    },
  });

  successResponse(res, {
    ...template,
    config: fromJSON(template.config),
  }, '场景模板创建成功', 201);
});

export const listTemplates = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const query = listTemplatesSchema.parse(req.query);

  const page = parseInt(query.page as string);
  const pageSize = parseInt(query.pageSize as string);
  const skip = (page - 1) * pageSize;

  const where: any = {};
  if (query.type) where.type = query.type;
  if (query.status) where.status = query.status;

  const [templates, total] = await Promise.all([
    prisma.sceneTemplate.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize,
    }),
    prisma.sceneTemplate.count({ where }),
  ]);

  const data = templates.map(t => ({
    ...t,
    config: fromJSON(t.config),
  }));

  paginatedResponse(res, data, total, page, pageSize, '获取场景模板成功');
});

export const getTemplate = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { id } = req.params;

  const template = await prisma.sceneTemplate.findUnique({
    where: { id },
  });

  if (!template) {
    return next(new AppError(404, 'TEMPLATE_NOT_FOUND', '模板不存在', '请检查 ID 是否正确'));
  }

  successResponse(res, {
    ...template,
    config: fromJSON(template.config),
  }, '获取模板详情成功');
});

export const getTemplateByCode = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { code } = req.params;

  const template = await prisma.sceneTemplate.findUnique({
    where: { code },
  });

  if (!template) {
    return next(new AppError(404, 'TEMPLATE_NOT_FOUND', '模板不存在', '请检查模板编码是否正确'));
  }

  successResponse(res, {
    ...template,
    config: fromJSON(template.config),
  }, '获取模板成功');
});

export const updateTemplate = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { id } = req.params;
  const { name, description, type, systemPrompt, config, status } = req.body;

  const template = await prisma.sceneTemplate.findUnique({ where: { id } });
  if (!template) {
    return next(new AppError(404, 'TEMPLATE_NOT_FOUND', '模板不存在', '请检查 ID 是否正确'));
  }

  const updated = await prisma.sceneTemplate.update({
    where: { id },
    data: {
      name: name !== undefined ? name : undefined,
      description: description !== undefined ? description : undefined,
      type: type !== undefined ? type : undefined,
      systemPrompt: systemPrompt !== undefined ? systemPrompt : undefined,
      config: config !== undefined ? toJSON(config) : undefined,
      status: status !== undefined ? status : undefined,
    },
  });

  successResponse(res, {
    ...updated,
    config: fromJSON(updated.config),
  }, '模板更新成功');
});

export const deleteTemplate = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { id } = req.params;

  const template = await prisma.sceneTemplate.findUnique({ where: { id } });
  if (!template) {
    return next(new AppError(404, 'TEMPLATE_NOT_FOUND', '模板不存在', '请检查 ID 是否正确'));
  }

  await prisma.sceneTemplate.delete({ where: { id } });

  successResponse(res, null, '模板删除成功');
});

export const submitFeedback = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const body = feedbackSchema.parse(req.body);
  const apiKeyId = req.apiKey.id;

  const feedback = await prisma.feedback.create({
    data: {
      apiKeyId,
      rating: body.rating,
      comment: body.comment,
      category: body.category,
      metadata: toJSON(body.metadata),
    },
  });

  await recordAuditLog(
    apiKeyId,
    'submit_feedback',
    'feedback',
    feedback.id,
    'success',
    { rating: body.rating }
  );

  successResponse(res, {
    ...feedback,
    metadata: fromJSON(feedback.metadata),
  }, '反馈提交成功', 201);
});

export const listFeedbacks = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const query = listFeedbacksSchema.parse(req.query);

  const page = parseInt(query.page as string);
  const pageSize = parseInt(query.pageSize as string);
  const skip = (page - 1) * pageSize;

  const where: any = {};
  if (query.rating) where.rating = parseInt(query.rating as string);
  if (query.category) where.category = query.category;

  const [feedbacks, total] = await Promise.all([
    prisma.feedback.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize,
    }),
    prisma.feedback.count({ where }),
  ]);

  const data = feedbacks.map(f => ({
    ...f,
    metadata: fromJSON(f.metadata),
  }));

  paginatedResponse(res, data, total, page, pageSize, '获取反馈列表成功');
});

export const listErrors = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const query = listErrorsSchema.parse(req.query);

  const page = parseInt(query.page as string);
  const pageSize = parseInt(query.pageSize as string);
  const skip = (page - 1) * pageSize;

  const where: any = {};
  if (query.errorCode) where.errorCode = query.errorCode;
  if (query.endpoint) where.endpoint = { contains: query.endpoint };

  const [errors, total] = await Promise.all([
    prisma.errorLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize,
    }),
    prisma.errorLog.count({ where }),
  ]);

  const data = errors.map(e => ({
    ...e,
    metadata: fromJSON(e.metadata),
  }));

  paginatedResponse(res, data, total, page, pageSize, '获取错误日志成功');
});

export const getErrorStats = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { startDate, endDate } = req.query;

  const where: any = {};
  if (startDate) where.createdAt = { ...where.createdAt, gte: new Date(startDate as string) };
  if (endDate) {
    const end = new Date(endDate as string);
    end.setHours(23, 59, 59, 999);
    where.createdAt = { ...where.createdAt, lte: end };
  }

  const errors = await prisma.errorLog.groupBy({
    by: ['errorCode'],
    where,
    _count: { errorCode: true },
    orderBy: { _count: { errorCode: 'desc' } },
    take: 10,
  });

  const data = errors.map(e => ({
    errorCode: e.errorCode,
    count: e._count.errorCode,
  }));

  successResponse(res, {
    topErrors: data,
    totalErrors: data.reduce((sum, d) => sum + d.count, 0),
  }, '获取错误统计成功');
});

export const getErrorDetail = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { id } = req.params;

  const error = await prisma.errorLog.findUnique({
    where: { id },
  });

  if (!error) {
    return next(new AppError(404, 'ERROR_NOT_FOUND', '错误记录不存在', '请检查 ID 是否正确'));
  }

  const retrySuggestions: Record<string, string> = {
    VALIDATION_ERROR: '请检查请求参数是否符合接口文档要求，确保所有必填参数已提供且格式正确。',
    AUTH_API_KEY_MISSING: '请在请求头中添加 x-api-key 参数，并确保值为有效的 API Key。',
    AUTH_API_KEY_INVALID: '请检查 API Key 和 App ID 是否正确，或联系管理员确认密钥状态。',
    QUOTA_EXCEEDED: '当前配额已用完，请升级套餐或等待下个周期重置，也可以申请临时额度提升。',
    SESSION_NOT_FOUND: '请检查 sessionId 是否正确，或创建新的会话后重试。',
    TASK_NOT_FOUND: '请检查任务 ID 是否正确。',
    TASK_FINISHED: '任务已完成或已取消，无法执行此操作。',
    DOCUMENT_NOT_FOUND: '请检查文档 ID 是否正确。',
    DOCUMENT_NOT_READY: '文档尚未解析完成，请稍后再试。',
    KNOWLEDGE_BASE_NOT_FOUND: '请检查知识库 ID 是否正确。',
    RATE_LIMIT_EXCEEDED: '请求过于频繁，请降低请求频率后重试。',
    INTERNAL_SERVER_ERROR: '服务器内部错误，请稍后重试，如持续出现请联系技术支持。',
  };

  const suggestion = error.retrySuggestion || retrySuggestions[error.errorCode] || '请稍后重试，如问题持续请联系技术支持。';

  successResponse(res, {
    ...error,
    metadata: fromJSON(error.metadata),
    retrySuggestion: suggestion,
  }, '获取错误详情成功');
});
