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

  await recordAuditLog(
    undefined,
    'create_api_key',
    'api_key',
    newApiKey.id,
    'success',
    {
      afterData: {
        name: newApiKey.name,
        appId: newApiKey.appId,
        quota: newApiKey.quota,
        status: newApiKey.status,
      },
      operator: 'admin',
      endpoint: req.originalUrl,
      ip: req.ip,
    }
  );

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

  const beforeData: any = {};
  if (name !== undefined) beforeData.name = apiKey.name;
  if (status !== undefined) beforeData.status = apiKey.status;
  if (quota !== undefined) beforeData.quota = apiKey.quota;
  if (rateLimit !== undefined) beforeData.rateLimit = apiKey.rateLimit;
  if (expiresAt !== undefined) beforeData.expiresAt = apiKey.expiresAt;

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

  const afterData: any = {};
  if (name !== undefined) afterData.name = updated.name;
  if (status !== undefined) afterData.status = updated.status;
  if (quota !== undefined) afterData.quota = updated.quota;
  if (rateLimit !== undefined) afterData.rateLimit = updated.rateLimit;
  if (expiresAt !== undefined) afterData.expiresAt = updated.expiresAt;

  await recordAuditLog(
    undefined,
    'update_api_key',
    'api_key',
    id,
    'success',
    {
      beforeData,
      afterData,
      operator: 'admin',
      endpoint: req.originalUrl,
      ip: req.ip,
    }
  );

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

  const beforeData = {
    id: apiKey.id,
    name: apiKey.name,
    appId: apiKey.appId,
    status: apiKey.status,
    quota: apiKey.quota,
    used: apiKey.used,
  };

  await prisma.apiKey.delete({ where: { id } });

  await recordAuditLog(
    undefined,
    'delete_api_key',
    'api_key',
    id,
    'success',
    {
      beforeData,
      operator: 'admin',
      endpoint: req.originalUrl,
      ip: req.ip,
    }
  );

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

  const beforeData = {
    quota: apiKey.quota,
    used: apiKey.used,
  };

  const updated = await prisma.apiKey.update({
    where: { id },
    data: { quota: body.quota },
  });

  const afterData = {
    quota: updated.quota,
    used: updated.used,
  };

  await recordAuditLog(
    undefined,
    'update_quota',
    'api_key',
    id,
    'success',
    {
      beforeData,
      afterData,
      operator: 'admin',
      endpoint: req.originalUrl,
      ip: req.ip,
    }
  );

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

  const beforeData = {
    quota: apiKey.quota,
    used: apiKey.used,
  };

  const updated = await prisma.apiKey.update({
    where: { id },
    data: { used: 0 },
  });

  const afterData = {
    quota: updated.quota,
    used: updated.used,
  };

  await recordAuditLog(
    undefined,
    'reset_quota',
    'api_key',
    id,
    'success',
    {
      beforeData,
      afterData,
      operator: 'admin',
      endpoint: req.originalUrl,
      ip: req.ip,
    }
  );

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

  await recordAuditLog(
    undefined,
    'create_template',
    'template',
    template.id,
    'success',
    {
      afterData: {
        id: template.id,
        name: template.name,
        code: template.code,
        description: template.description,
        type: template.type,
        status: template.status,
      },
      operator: 'admin',
      endpoint: req.originalUrl,
      ip: req.ip,
    }
  );

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

  const beforeData: any = {};
  if (name !== undefined) beforeData.name = template.name;
  if (description !== undefined) beforeData.description = template.description;
  if (type !== undefined) beforeData.type = template.type;
  if (systemPrompt !== undefined) beforeData.systemPrompt = template.systemPrompt;
  if (config !== undefined) beforeData.config = fromJSON(template.config);
  if (status !== undefined) beforeData.status = template.status;

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

  const afterData: any = {};
  if (name !== undefined) afterData.name = updated.name;
  if (description !== undefined) afterData.description = updated.description;
  if (type !== undefined) afterData.type = updated.type;
  if (systemPrompt !== undefined) afterData.systemPrompt = updated.systemPrompt;
  if (config !== undefined) afterData.config = fromJSON(updated.config);
  if (status !== undefined) afterData.status = updated.status;

  await recordAuditLog(
    undefined,
    'update_template',
    'template',
    id,
    'success',
    {
      beforeData,
      afterData,
      operator: 'admin',
      endpoint: req.originalUrl,
      ip: req.ip,
    }
  );

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

  const beforeData = {
    id: template.id,
    name: template.name,
    code: template.code,
    description: template.description,
    type: template.type,
    status: template.status,
  };

  await prisma.sceneTemplate.delete({ where: { id } });

  await recordAuditLog(
    undefined,
    'delete_template',
    'template',
    id,
    'success',
    {
      beforeData,
      operator: 'admin',
      endpoint: req.originalUrl,
      ip: req.ip,
    }
  );

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
    {
      details: { rating: body.rating },
    }
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

  await recordAuditLog(
    undefined,
    'list_feedbacks',
    'feedback',
    undefined,
    'success',
    {
      details: { total, page, pageSize },
      operator: 'admin',
      endpoint: req.originalUrl,
      ip: req.ip,
    }
  );

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

  await recordAuditLog(
    undefined,
    'list_errors',
    'error',
    undefined,
    'success',
    {
      details: { total, page, pageSize },
      operator: 'admin',
      endpoint: req.originalUrl,
      ip: req.ip,
    }
  );

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

  await recordAuditLog(
    undefined,
    'get_error_detail',
    'error',
    id,
    'success',
    {
      operator: 'admin',
      endpoint: req.originalUrl,
      ip: req.ip,
    }
  );

  successResponse(res, {
    ...error,
    metadata: fromJSON(error.metadata),
  }, '获取错误详情成功');
});

const listAuditLogsSchema = z.object({
  page: z.string().optional().default('1'),
  pageSize: z.string().optional().default('20'),
  action: z.string().optional(),
  resourceType: z.string().optional(),
  result: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

export const listAuditLogs = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const query = listAuditLogsSchema.parse(req.query);

  const page = parseInt(query.page as string);
  const pageSize = parseInt(query.pageSize as string);
  const skip = (page - 1) * pageSize;

  const where: any = {};
  if (query.action) where.action = query.action;
  if (query.resourceType) where.resourceType = query.resourceType;
  if (query.result) where.result = query.result;
  if (query.startDate || query.endDate) {
    where.createdAt = {};
    if (query.startDate) where.createdAt.gte = new Date(query.startDate as string);
    if (query.endDate) {
      const end = new Date(query.endDate as string);
      end.setHours(23, 59, 59, 999);
      where.createdAt.lte = end;
    }
  }

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize,
    }),
    prisma.auditLog.count({ where }),
  ]);

  const data = logs.map(log => ({
    ...log,
    details: fromJSON(log.details),
  }));

  paginatedResponse(res, data, total, page, pageSize, '获取审计日志成功');
});

export const getAuditLogDetail = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { id } = req.params;

  const log = await prisma.auditLog.findUnique({
    where: { id },
  });

  if (!log) {
    return next(new AppError(404, 'AUDIT_LOG_NOT_FOUND', '审计日志不存在', '请检查 ID 是否正确'));
  }

  successResponse(res, {
    ...log,
    details: fromJSON(log.details),
  }, '获取审计日志详情成功');
});
