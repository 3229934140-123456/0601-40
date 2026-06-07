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
    await recordAuditLog(
      undefined,
      'create_api_key',
      'api_key',
      undefined,
      'fail',
      {
        details: { errorCode: 'APP_ID_EXISTS', errorMessage: 'App ID 已存在', appId: body.appId },
        operator: 'admin',
        endpoint: req.originalUrl,
        ip: req.ip,
      }
    );
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
    await recordAuditLog(
      undefined,
      'update_api_key',
      'api_key',
      id,
      'fail',
      {
        details: { errorCode: 'API_KEY_NOT_FOUND', errorMessage: 'API Key 不存在' },
        operator: 'admin',
        endpoint: req.originalUrl,
        ip: req.ip,
      }
    );
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
    await recordAuditLog(
      undefined,
      'delete_api_key',
      'api_key',
      id,
      'fail',
      {
        details: { errorCode: 'API_KEY_NOT_FOUND', errorMessage: 'API Key 不存在' },
        operator: 'admin',
        endpoint: req.originalUrl,
        ip: req.ip,
      }
    );
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
    await recordAuditLog(
      undefined,
      'update_quota',
      'api_key',
      id,
      'fail',
      {
        details: { errorCode: 'API_KEY_NOT_FOUND', errorMessage: 'API Key 不存在' },
        operator: 'admin',
        endpoint: req.originalUrl,
        ip: req.ip,
      }
    );
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
    await recordAuditLog(
      undefined,
      'reset_quota',
      'api_key',
      id,
      'fail',
      {
        details: { errorCode: 'API_KEY_NOT_FOUND', errorMessage: 'API Key 不存在' },
        operator: 'admin',
        endpoint: req.originalUrl,
        ip: req.ip,
      }
    );
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
    await recordAuditLog(
      undefined,
      'create_template',
      'template',
      undefined,
      'fail',
      {
        details: { errorCode: 'TEMPLATE_CODE_EXISTS', errorMessage: '模板编码已存在', code: body.code },
        operator: 'admin',
        endpoint: req.originalUrl,
        ip: req.ip,
      }
    );
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
    await recordAuditLog(
      undefined,
      'update_template',
      'template',
      id,
      'fail',
      {
        details: { errorCode: 'TEMPLATE_NOT_FOUND', errorMessage: '模板不存在' },
        operator: 'admin',
        endpoint: req.originalUrl,
        ip: req.ip,
      }
    );
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
    await recordAuditLog(
      undefined,
      'delete_template',
      'template',
      id,
      'fail',
      {
        details: { errorCode: 'TEMPLATE_NOT_FOUND', errorMessage: '模板不存在' },
        operator: 'admin',
        endpoint: req.originalUrl,
        ip: req.ip,
      }
    );
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
  try {
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
  } catch (error: any) {
    await recordAuditLog(
      undefined,
      'list_feedbacks',
      'feedback',
      undefined,
      'fail',
      {
        details: { errorMessage: error.message },
        operator: 'admin',
        endpoint: req.originalUrl,
        ip: req.ip,
      }
    );
    throw error;
  }
});

export const listErrors = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
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
  } catch (error: any) {
    await recordAuditLog(
      undefined,
      'list_errors',
      'error',
      undefined,
      'fail',
      {
        details: { errorMessage: error.message },
        operator: 'admin',
        endpoint: req.originalUrl,
        ip: req.ip,
      }
    );
    throw error;
  }
});

export const getErrorStats = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { startDate, endDate } = req.query;

  const where: any = {};
  if (startDate) {
    where.createdAt = { ...where.createdAt, gte: new Date(startDate as string) };
  } else {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    where.createdAt = { gte: sevenDaysAgo };
  }
  if (endDate) {
    const end = new Date(endDate as string);
    end.setHours(23, 59, 59, 999);
    where.createdAt = { ...where.createdAt, lte: end };
  }

  const errors = await prisma.errorLog.groupBy({
    by: ['errorCode'],
    where,
    _count: { errorCode: true },
    _max: { createdAt: true },
    orderBy: { _count: { errorCode: 'desc' } },
    take: 10,
  });

  const topErrors = errors.map(e => ({
    errorCode: e.errorCode,
    count: e._count.errorCode,
    lastOccurredAt: e._max.createdAt,
  }));

  successResponse(res, {
    topErrors,
    totalErrors: topErrors.reduce((sum, d) => sum + d.count, 0),
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
    await recordAuditLog(
      undefined,
      'get_error_detail',
      'error',
      id,
      'fail',
      {
        details: { errorCode: 'ERROR_NOT_FOUND', errorMessage: '错误记录不存在' },
        operator: 'admin',
        endpoint: req.originalUrl,
        ip: req.ip,
      }
    );
    return next(new AppError(404, 'ERROR_NOT_FOUND', '错误记录不存在', '请检查 ID 是否正确'));
  }

  const metadata = fromJSON(error.metadata);

  let apiKey = null;
  if (error.apiKeyId) {
    const foundApiKey = await prisma.apiKey.findUnique({
      where: { id: error.apiKeyId },
      select: { id: true, name: true, appId: true },
    });
    if (foundApiKey) {
      apiKey = foundApiKey;
    }
  }

  let taskInfo = null;
  let canRetry = false;
  let retrySuggestion = null;
  let lastError = null;
  const taskUuid = metadata?.taskId;
  if (taskUuid) {
    const task = await prisma.task.findUnique({
      where: { id: taskUuid },
      select: {
        id: true,
        taskId: true,
        type: true,
        status: true,
        retryCount: true,
        maxRetries: true,
        errorMessage: true,
        progress: true,
      },
    });
    if (task) {
      taskInfo = task;
      lastError = task.errorMessage;
      if (task.status === 'failed' && task.retryCount < task.maxRetries) {
        canRetry = true;
        retrySuggestion = `任务已失败 ${task.retryCount} 次，还可重试 ${task.maxRetries - task.retryCount} 次，可调用重试接口重新执行任务`;
      } else if (task.status === 'failed') {
        retrySuggestion = '已达到最大重试次数，请检查输入后手动重试';
      }
    }
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
    id: error.id,
    errorCode: error.errorCode,
    errorMessage: error.errorMessage,
    stackTrace: error.stackTrace,
    endpoint: error.endpoint,
    apiKeyId: error.apiKeyId,
    retrySuggestion: retrySuggestion || error.retrySuggestion,
    metadata,
    createdAt: error.createdAt,
    apiKey,
    taskInfo,
    canRetry,
    lastError,
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

  const details = fromJSON(log.details);
  const operator = details?.operator;

  let relatedLogs: any[] = [];

  if (operator) {
    const [beforeLogs, afterLogs] = await Promise.all([
      prisma.auditLog.findMany({
        where: {
          id: { not: id },
          createdAt: { lt: log.createdAt },
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true,
          action: true,
          resourceType: true,
          resourceId: true,
          result: true,
          createdAt: true,
          details: true,
        },
      }),
      prisma.auditLog.findMany({
        where: {
          id: { not: id },
          createdAt: { gt: log.createdAt },
        },
        orderBy: { createdAt: 'asc' },
        take: 5,
        select: {
          id: true,
          action: true,
          resourceType: true,
          resourceId: true,
          result: true,
          createdAt: true,
          details: true,
        },
      }),
    ]);

    const filteredBefore = beforeLogs.filter(l => {
      const d = fromJSON(l.details);
      return d?.operator === operator;
    }).slice(0, 5);

    const filteredAfter = afterLogs.filter(l => {
      const d = fromJSON(l.details);
      return d?.operator === operator;
    }).slice(0, 5);

    const currentLog = {
      id: log.id,
      action: log.action,
      resourceType: log.resourceType,
      resourceId: log.resourceId,
      result: log.result,
      createdAt: log.createdAt,
    };

    relatedLogs = [
      ...filteredBefore.map(l => ({
        id: l.id,
        action: l.action,
        resourceType: l.resourceType,
        resourceId: l.resourceId,
        result: l.result,
        createdAt: l.createdAt,
      })).reverse(),
      currentLog,
      ...filteredAfter.map(l => ({
        id: l.id,
        action: l.action,
        resourceType: l.resourceType,
        resourceId: l.resourceId,
        result: l.result,
        createdAt: l.createdAt,
      })),
    ];
  } else if (log.resourceId) {
    const [beforeLogs, afterLogs] = await Promise.all([
      prisma.auditLog.findMany({
        where: {
          id: { not: id },
          resourceId: log.resourceId,
          createdAt: { lt: log.createdAt },
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true,
          action: true,
          resourceType: true,
          resourceId: true,
          result: true,
          createdAt: true,
        },
      }),
      prisma.auditLog.findMany({
        where: {
          id: { not: id },
          resourceId: log.resourceId,
          createdAt: { gt: log.createdAt },
        },
        orderBy: { createdAt: 'asc' },
        take: 5,
        select: {
          id: true,
          action: true,
          resourceType: true,
          resourceId: true,
          result: true,
          createdAt: true,
        },
      }),
    ]);

    const currentLog = {
      id: log.id,
      action: log.action,
      resourceType: log.resourceType,
      resourceId: log.resourceId,
      result: log.result,
      createdAt: log.createdAt,
    };

    relatedLogs = [
      ...beforeLogs.reverse(),
      currentLog,
      ...afterLogs,
    ];
  }

  successResponse(res, {
    ...log,
    details,
    relatedLogs,
  }, '获取审计日志详情成功');
});

const getAuditStatsSchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  granularity: z.enum(['hour', 'day']).optional().default('day'),
});

const generateTrendData = async (granularity: 'hour' | 'day', where: any) => {
  const now = new Date();
  const points: { time: string; total: number; success: number; fail: number }[] = [];

  if (granularity === 'hour') {
    for (let i = 23; i >= 0; i--) {
      const hour = new Date(now);
      hour.setHours(hour.getHours() - i, 0, 0, 0);
      const nextHour = new Date(hour);
      nextHour.setHours(nextHour.getHours() + 1);
      const timeStr = `${hour.getFullYear()}-${String(hour.getMonth() + 1).padStart(2, '0')}-${String(hour.getDate()).padStart(2, '0')} ${String(hour.getHours()).padStart(2, '0')}:00`;
      points.push({ time: timeStr, total: 0, success: 0, fail: 0 });
    }
  } else {
    for (let i = 6; i >= 0; i--) {
      const day = new Date(now);
      day.setDate(day.getDate() - i);
      day.setHours(0, 0, 0, 0);
      const timeStr = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
      points.push({ time: timeStr, total: 0, success: 0, fail: 0 });
    }
  }

  const trendWhere = { ...where };
  if (granularity === 'hour') {
    const twentyFourHoursAgo = new Date(now);
    twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);
    trendWhere.createdAt = { ...trendWhere.createdAt, gte: twentyFourHoursAgo };
  } else {
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    trendWhere.createdAt = { ...trendWhere.createdAt, gte: sevenDaysAgo };
  }

  const logs = await prisma.auditLog.findMany({
    where: trendWhere,
    select: {
      createdAt: true,
      result: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  logs.forEach(log => {
    const createdAt = new Date(log.createdAt);
    let index = -1;

    if (granularity === 'hour') {
      const firstHour = new Date(now);
      firstHour.setHours(firstHour.getHours() - 23, 0, 0, 0);
      index = Math.floor((createdAt.getTime() - firstHour.getTime()) / (1000 * 60 * 60));
    } else {
      const firstDay = new Date(now);
      firstDay.setDate(firstDay.getDate() - 6);
      firstDay.setHours(0, 0, 0, 0);
      index = Math.floor((createdAt.getTime() - firstDay.getTime()) / (1000 * 60 * 60 * 24));
    }

    if (index >= 0 && index < points.length) {
      points[index].total++;
      if (log.result === 'success') points[index].success++;
      if (log.result === 'fail') points[index].fail++;
    }
  });

  return points;
};

const detectRisks = async () => {
  const risks: { type: string; level: 'high' | 'medium'; message: string; count: number; timeRange: string }[] = [];
  const oneHourAgo = new Date();
  oneHourAgo.setHours(oneHourAgo.getHours() - 1);

  const recentLogs = await prisma.auditLog.findMany({
    where: {
      createdAt: { gte: oneHourAgo },
    },
    select: {
      id: true,
      action: true,
      result: true,
      details: true,
      createdAt: true,
    },
  });

  const parsedLogs = recentLogs.map(log => ({
    ...log,
    details: fromJSON(log.details),
  }));

  let successCount = 0;
  let failCount = 0;
  parsedLogs.forEach(log => {
    if (log.result === 'success') successCount++;
    if (log.result === 'fail') failCount++;
  });

  const total = successCount + failCount;
  if (total > 0 && failCount > 3) {
    const failRate = (failCount / total) * 100;
    if (failRate > 30) {
      risks.push({
        type: 'high_failure_rate',
        level: 'high',
        message: `最近 1 小时失败率达 ${failRate.toFixed(1)}%，共 ${failCount} 次失败`,
        count: failCount,
        timeRange: '最近 1 小时',
      });
    }
  }

  const deleteOpsByOperator = new Map<string, number>();
  parsedLogs.forEach(log => {
    if (log.action.startsWith('delete_')) {
      const operator = log.details?.operator || 'unknown';
      deleteOpsByOperator.set(operator, (deleteOpsByOperator.get(operator) || 0) + 1);
    }
  });

  deleteOpsByOperator.forEach((count, operator) => {
    if (count > 5) {
      risks.push({
        type: 'mass_deletion',
        level: 'high',
        message: `操作者 ${operator} 最近 1 小时内执行了 ${count} 次删除操作`,
        count,
        timeRange: '最近 1 小时',
      });
    }
  });

  const quotaOpsByOperator = new Map<string, number>();
  parsedLogs.forEach(log => {
    if (log.action === 'update_quota') {
      const operator = log.details?.operator || 'unknown';
      quotaOpsByOperator.set(operator, (quotaOpsByOperator.get(operator) || 0) + 1);
    }
  });

  quotaOpsByOperator.forEach((count, operator) => {
    if (count > 3) {
      risks.push({
        type: 'mass_quota_change',
        level: 'medium',
        message: `操作者 ${operator} 最近 1 小时内修改了 ${count} 次额度`,
        count,
        timeRange: '最近 1 小时',
      });
    }
  });

  return risks;
};

export const getAuditStats = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const query = getAuditStatsSchema.parse(req.query);

  const where: any = {};
  if (query.startDate || query.endDate) {
    where.createdAt = {};
    if (query.startDate) where.createdAt.gte = new Date(query.startDate as string);
    if (query.endDate) {
      const end = new Date(query.endDate as string);
      end.setHours(23, 59, 59, 999);
      where.createdAt.lte = end;
    }
  }

  const [totalLogs, byActionRaw, byResourceTypeRaw, topActionsRaw, trend, risks] = await Promise.all([
    prisma.auditLog.groupBy({
      by: ['result'],
      where,
      _count: { result: true },
    }),
    prisma.auditLog.groupBy({
      by: ['action', 'result'],
      where,
      _count: { action: true },
      orderBy: { _count: { action: 'desc' } },
    }),
    prisma.auditLog.groupBy({
      by: ['resourceType'],
      where,
      _count: { resourceType: true },
      orderBy: { _count: { resourceType: 'desc' } },
    }),
    prisma.auditLog.groupBy({
      by: ['action'],
      where,
      _count: { action: true },
      orderBy: { _count: { action: 'desc' } },
      take: 10,
    }),
    generateTrendData(query.granularity, where),
    detectRisks(),
  ]);

  let total = 0;
  let successCount = 0;
  let failCount = 0;

  totalLogs.forEach(item => {
    const count = item._count.result;
    total += count;
    if (item.result === 'success') successCount = count;
    if (item.result === 'fail') failCount = count;
  });

  const successRate = total > 0 ? Math.round((successCount / total) * 100) : 0;

  const byActionMap = new Map<string, { action: string; count: number; successCount: number; failCount: number }>();
  byActionRaw.forEach(item => {
    const action = item.action;
    const count = item._count.action;
    if (!byActionMap.has(action)) {
      byActionMap.set(action, { action, count: 0, successCount: 0, failCount: 0 });
    }
    const entry = byActionMap.get(action)!;
    entry.count += count;
    if (item.result === 'success') entry.successCount = count;
    if (item.result === 'fail') entry.failCount = count;
  });

  const byAction = Array.from(byActionMap.values()).sort((a, b) => b.count - a.count);

  const byResourceType = byResourceTypeRaw.map(item => ({
    resourceType: item.resourceType,
    count: item._count.resourceType,
  }));

  const topActions = topActionsRaw.map(item => ({
    action: item.action,
    count: item._count.action,
  }));

  successResponse(res, {
    summary: {
      total,
      successCount,
      failCount,
      successRate,
    },
    byAction,
    byResourceType,
    topActions,
    trend,
    risks,
  }, '获取审计统计成功');
});

const exportAuditLogsSchema = z.object({
  action: z.string().optional(),
  resourceType: z.string().optional(),
  result: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

const generateChangeSummary = (details: any): string => {
  if (!details) return '';
  const { beforeData, afterData } = details;
  if (!beforeData && !afterData) return '';

  const changes: string[] = [];
  const keys = new Set([
    ...(beforeData ? Object.keys(beforeData) : []),
    ...(afterData ? Object.keys(afterData) : []),
  ]);

  keys.forEach(key => {
    const before = beforeData?.[key];
    const after = afterData?.[key];
    if (before !== undefined && after !== undefined && before !== after) {
      changes.push(`${key}: ${JSON.stringify(before)} → ${JSON.stringify(after)}`);
    } else if (before !== undefined && after === undefined) {
      changes.push(`${key}: 删除`);
    } else if (before === undefined && after !== undefined) {
      changes.push(`${key}: 新增 ${JSON.stringify(after)}`);
    }
  });

  return changes.join('; ');
};

const escapeCsvField = (value: any): string => {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
};

export const exportAuditLogs = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const query = exportAuditLogsSchema.parse(req.query);

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

  const logs = await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 10000,
  });

  const headers = ['操作时间', '操作者', '请求路径', '动作', '资源类型', '资源ID', '资源名称', '结果', '失败原因', '变化摘要', 'IP地址'];
  const rows = logs.map(log => {
    const details = fromJSON(log.details);
    const operator = details?.operator || '';
    const endpoint = details?.endpoint || '';
    const resourceName = details?.afterData?.name || details?.beforeData?.name || '';
    const failReason = log.result === 'fail' 
      ? (details?.errorMessage || details?.details?.errorMessage || '')
      : '';
    const changeSummary = generateChangeSummary(details);
    const ip = details?.ip || '';
    return [
      log.createdAt.toISOString(),
      operator,
      endpoint,
      log.action,
      log.resourceType,
      log.resourceId || '',
      resourceName,
      log.result,
      failReason,
      changeSummary,
      ip,
    ];
  });

  const csvContent = [
    headers.map(escapeCsvField).join(','),
    ...rows.map(row => row.map(escapeCsvField).join(',')),
  ].join('\n');

  const BOM = '\uFEFF';
  const today = new Date();
  const dateStr = today.getFullYear().toString() +
    (today.getMonth() + 1).toString().padStart(2, '0') +
    today.getDate().toString().padStart(2, '0');
  const filename = `audit-logs-${dateStr}.csv`;

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
  res.send(BOM + csvContent);
});
