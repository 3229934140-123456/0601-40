import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import prisma from '../prisma';
import { successResponse } from '../utils/response';
import { asyncHandler } from '../middleware/error.middleware';

const usageStatsSchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  metricType: z.string().optional(),
  groupBy: z.enum(['day', 'hour']).optional().default('day'),
});

const summarySchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

export const getUsageStats = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const query = usageStatsSchema.parse(req.query);
  const apiKeyId = req.apiKey.id;

  const where: any = { apiKeyId };

  if (query.startDate) {
    where.date = { ...where.date, gte: new Date(query.startDate) };
  }
  if (query.endDate) {
    const end = new Date(query.endDate);
    end.setHours(23, 59, 59, 999);
    where.date = { ...where.date, lte: end };
  }
  if (query.metricType) {
    where.metricType = query.metricType;
  }

  const stats = await prisma.usageStat.findMany({
    where,
    orderBy: { date: 'asc' },
  });

  const grouped: Record<string, any> = {};
  for (const stat of stats) {
    const key = stat.date.toISOString().split('T')[0];
    if (!grouped[key]) {
      grouped[key] = { date: key, metrics: {}, totalCount: 0, totalTokens: 0 };
    }
    grouped[key].metrics[stat.metricType] = {
      count: stat.count,
      tokens: stat.tokens,
      avgLatency: stat.latency,
    };
    grouped[key].totalCount += stat.count;
    grouped[key].totalTokens += stat.tokens;
  }

  const data = Object.values(grouped).sort((a: any, b: any) => a.date.localeCompare(b.date));

  successResponse(res, {
    data,
    summary: {
      totalDays: data.length,
      totalCount: data.reduce((sum: number, d: any) => sum + d.totalCount, 0),
      totalTokens: data.reduce((sum: number, d: any) => sum + d.totalTokens, 0),
    },
  }, '获取用量统计成功');
});

export const getSummary = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const query = summarySchema.parse(req.query);
  const apiKeyId = req.apiKey.id;

  const where: any = { apiKeyId };

  if (query.startDate) {
    where.createdAt = { ...where.createdAt, gte: new Date(query.startDate) };
  }
  if (query.endDate) {
    const end = new Date(query.endDate);
    end.setHours(23, 59, 59, 999);
    where.createdAt = { ...where.createdAt, lte: end };
  }

  const [
    sessionCount,
    documentCount,
    taskCount,
    knowledgeBaseCount,
    feedbackCount,
  ] = await Promise.all([
    prisma.session.count({ where: { apiKeyId, ...(query.startDate || query.endDate ? { createdAt: where.createdAt } : {}) } }),
    prisma.document.count({ where: { apiKeyId, ...(query.startDate || query.endDate ? { createdAt: where.createdAt } : {}) } }),
    prisma.task.count({ where: { apiKeyId, ...(query.startDate || query.endDate ? { createdAt: where.createdAt } : {}) } }),
    prisma.knowledgeBase.count({ where: { apiKeyId, ...(query.startDate || query.endDate ? { createdAt: where.createdAt } : {}) } }),
    prisma.feedback.count({ where: { apiKeyId, ...(query.startDate || query.endDate ? { createdAt: where.createdAt } : {}) } }),
  ]);

  const taskStats = await prisma.task.groupBy({
    by: ['status'],
    where: { apiKeyId },
    _count: { status: true },
  });

  const taskByStatus: Record<string, number> = {};
  for (const ts of taskStats) {
    taskByStatus[ts.status] = ts._count.status;
  }

  const apiKey = await prisma.apiKey.findUnique({
    where: { id: apiKeyId },
    select: { quota: true, used: true, name: true, status: true, createdAt: true },
  });

  successResponse(res, {
    overview: {
      sessions: sessionCount,
      documents: documentCount,
      tasks: taskCount,
      knowledgeBases: knowledgeBaseCount,
      feedbacks: feedbackCount,
    },
    tasks: {
      byStatus: taskByStatus,
    },
    quota: apiKey ? {
      total: apiKey.quota,
      used: apiKey.used,
      remaining: apiKey.quota - apiKey.used,
      percentage: Math.round((apiKey.used / apiKey.quota) * 100),
    } : null,
    apiKey: {
      name: apiKey?.name,
      status: apiKey?.status,
      createdAt: apiKey?.createdAt,
    },
  }, '获取统计概览成功');
});

export const getAuditLogs = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { page = '1', pageSize = '20', action, resourceType, result } = req.query;
  const apiKeyId = req.apiKey.id;

  const pageNum = parseInt(page as string);
  const pageSizeNum = parseInt(pageSize as string);
  const skip = (pageNum - 1) * pageSizeNum;

  const where: any = { apiKeyId };
  if (action) where.action = action;
  if (resourceType) where.resourceType = resourceType;
  if (result) where.result = result;

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSizeNum,
    }),
    prisma.auditLog.count({ where }),
  ]);

  successResponse(res, {
    data: logs,
    pagination: {
      page: pageNum,
      pageSize: pageSizeNum,
      total,
      totalPages: Math.ceil(total / pageSizeNum),
    },
  }, '获取审计日志成功');
});

export const getTopMetrics = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const apiKeyId = req.apiKey.id;
  const { startDate, endDate, limit = '10' } = req.query;

  const where: any = { apiKeyId };
  if (startDate) where.date = { ...where.date, gte: new Date(startDate as string) };
  if (endDate) {
    const end = new Date(endDate as string);
    end.setHours(23, 59, 59, 999);
    where.date = { ...where.date, lte: end };
  }

  const stats = await prisma.usageStat.groupBy({
    by: ['metricType'],
    where,
    _sum: {
      count: true,
      tokens: true,
    },
    orderBy: {
      _sum: { count: 'desc' },
    },
    take: parseInt(limit as string),
  });

  const data = stats.map(s => ({
    metricType: s.metricType,
    count: s._sum.count || 0,
    tokens: s._sum.tokens || 0,
  }));

  successResponse(res, {
    data,
    total: data.length,
  }, '获取指标排行成功');
});
