import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import prisma from '../prisma';
import { successResponse, paginatedResponse } from '../utils/response';
import { AppError, asyncHandler } from '../middleware/error.middleware';
import { checkSensitive, invalidateWordCache } from '../services/audit.service';
import { recordAuditLog } from '../services/monitoring.service';

const checkTextSchema = z.object({
  text: z.string().min(1, '审核文本不能为空'),
  censor: z.boolean().optional().default(false),
  categories: z.array(z.string()).optional(),
});

const addWordSchema = z.object({
  word: z.string().min(1, '敏感词不能为空'),
  category: z.string().optional().default('自定义'),
  severity: z.enum(['low', 'medium', 'high']).optional().default('medium'),
  replacement: z.string().optional(),
  enabled: z.boolean().optional().default(true),
});

const listWordsSchema = z.object({
  page: z.string().optional().default('1'),
  pageSize: z.string().optional().default('20'),
  category: z.string().optional(),
  severity: z.string().optional(),
  enabled: z.string().optional(),
});

export const checkText = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const body = checkTextSchema.parse(req.body);
  const apiKeyId = req.apiKey.id;

  const result = await checkSensitive(body.text, {
    categories: body.categories,
    censor: body.censor,
  });

  const passed = result.passed;

  await recordAuditLog(
    apiKeyId,
    'check_sensitive',
    'sensitive_check',
    undefined,
    passed ? 'passed' : 'blocked',
    {
      details: {
        textLength: body.text.length,
        matchedCount: result.matchedWords.length,
        matchedWords: result.matchedWords.map(w => w.word),
      },
    }
  );

  successResponse(res, {
    passed,
    matchedWords: result.matchedWords,
    censoredText: result.censoredText,
    stats: {
      totalMatched: result.matchedWords.length,
      highSeverity: result.matchedWords.filter(w => w.severity === 'high').length,
      mediumSeverity: result.matchedWords.filter(w => w.severity === 'medium').length,
      lowSeverity: result.matchedWords.filter(w => w.severity === 'low').length,
    },
  }, '内容审核完成');
});

export const addSensitiveWord = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const body = addWordSchema.parse(req.body);

  const existing = await prisma.sensitiveWord.findUnique({
    where: { word: body.word },
  });

  if (existing) {
    return next(new AppError(409, 'SENSITIVE_WORD_EXISTS', '敏感词已存在', '请使用其他词语，或更新现有敏感词'));
  }

  const word = await prisma.sensitiveWord.create({
    data: {
      word: body.word,
      category: body.category,
      severity: body.severity,
      replacement: body.replacement,
      enabled: body.enabled,
    },
  });

  invalidateWordCache();

  successResponse(res, word, '敏感词添加成功', 201);
});

export const listSensitiveWords = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const query = listWordsSchema.parse(req.query);

  const page = parseInt(query.page as string);
  const pageSize = parseInt(query.pageSize as string);
  const skip = (page - 1) * pageSize;

  const where: any = {};
  if (query.category) where.category = query.category;
  if (query.severity) where.severity = query.severity;
  if (query.enabled !== undefined) where.enabled = query.enabled === 'true';

  const [words, total] = await Promise.all([
    prisma.sensitiveWord.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize,
    }),
    prisma.sensitiveWord.count({ where }),
  ]);

  paginatedResponse(res, words, total, page, pageSize, '获取敏感词列表成功');
});

export const updateSensitiveWord = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { id } = req.params;
  const { word, category, severity, replacement, enabled } = req.body;

  const existing = await prisma.sensitiveWord.findUnique({
    where: { id },
  });

  if (!existing) {
    return next(new AppError(404, 'SENSITIVE_WORD_NOT_FOUND', '敏感词不存在', '请检查敏感词 ID 是否正确'));
  }

  const updated = await prisma.sensitiveWord.update({
    where: { id },
    data: {
      word: word !== undefined ? word : undefined,
      category: category !== undefined ? category : undefined,
      severity: severity !== undefined ? severity : undefined,
      replacement: replacement !== undefined ? replacement : undefined,
      enabled: enabled !== undefined ? enabled : undefined,
    },
  });

  invalidateWordCache();

  successResponse(res, updated, '敏感词更新成功');
});

export const deleteSensitiveWord = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { id } = req.params;

  const existing = await prisma.sensitiveWord.findUnique({
    where: { id },
  });

  if (!existing) {
    return next(new AppError(404, 'SENSITIVE_WORD_NOT_FOUND', '敏感词不存在', '请检查敏感词 ID 是否正确'));
  }

  await prisma.sensitiveWord.delete({ where: { id } });

  invalidateWordCache();

  successResponse(res, null, '敏感词删除成功');
});

export const getCategories = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const words = await prisma.sensitiveWord.findMany({
    select: { category: true, severity: true },
    distinct: ['category'],
  });

  const categories = [...new Set(words.map(w => w.category))];
  const severities = ['low', 'medium', 'high'];

  successResponse(res, {
    categories,
    severities,
  }, '获取分类成功');
});

export const batchAddWords = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { words } = req.body;

  if (!Array.isArray(words) || words.length === 0) {
    return next(new AppError(400, 'INVALID_INPUT', '请提供有效的敏感词列表', 'words 必须是非空数组'));
  }

  const created: any[] = [];
  const failed: any[] = [];

  for (const word of words) {
    try {
      const existing = await prisma.sensitiveWord.findUnique({
        where: { word: word.word },
      });
      if (existing) {
        failed.push({ word: word.word, reason: '已存在' });
        continue;
      }
      const createdWord = await prisma.sensitiveWord.create({
        data: {
          word: word.word,
          category: word.category || '自定义',
          severity: word.severity || 'medium',
          replacement: word.replacement,
          enabled: word.enabled !== false,
        },
      });
      created.push(createdWord);
    } catch (e) {
      failed.push({ word: word.word, reason: '创建失败' });
    }
  }

  successResponse(res, {
    created: created.length,
    failed: failed.length,
    failedItems: failed,
  }, '批量添加完成');

  if (created.length > 0) {
    invalidateWordCache();
  }
});
