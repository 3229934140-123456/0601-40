import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import prisma from '../prisma';
import { successResponse, paginatedResponse } from '../utils/response';
import { AppError, asyncHandler } from '../middleware/error.middleware';
import { searchKnowledgeEntries, generateAnswer } from '../services/knowledge.service';
import { recordUsage, recordAuditLog } from '../services/monitoring.service';
import { toJSON, fromJSON } from '../utils/json';

const createKnowledgeBaseSchema = z.object({
  name: z.string().min(1, '知识库名称不能为空'),
  description: z.string().optional(),
  metadata: z.any().optional(),
});

const listKnowledgeBasesSchema = z.object({
  page: z.string().optional().default('1'),
  pageSize: z.string().optional().default('10'),
  status: z.string().optional(),
});

const addEntrySchema = z.object({
  title: z.string().min(1, '标题不能为空'),
  content: z.string().min(1, '内容不能为空'),
  source: z.string().optional(),
  metadata: z.any().optional(),
});

const searchSchema = z.object({
  query: z.string().min(1, '查询内容不能为空'),
  topK: z.string().optional().default('5'),
  includeAnswer: z.string().optional().default('false'),
});

const askSchema = z.object({
  query: z.string().min(1, '问题不能为空'),
  topK: z.number().optional().default(5),
  systemPrompt: z.string().optional(),
});

export const createKnowledgeBase = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const body = createKnowledgeBaseSchema.parse(req.body);
  const apiKeyId = req.apiKey.id;

  const knowledgeBase = await prisma.knowledgeBase.create({
    data: {
      apiKeyId,
      name: body.name,
      description: body.description,
      metadata: toJSON(body.metadata),
    },
  });

  await recordAuditLog(
    apiKeyId,
    'create_knowledge_base',
    'knowledge_base',
    knowledgeBase.id,
    'success',
    { name: body.name }
  );

  const result = { ...knowledgeBase, metadata: fromJSON(knowledgeBase.metadata) };
  successResponse(res, result, '知识库创建成功', 201);
});

export const listKnowledgeBases = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const query = listKnowledgeBasesSchema.parse(req.query);
  const apiKeyId = req.apiKey.id;

  const page = parseInt(query.page as string);
  const pageSize = parseInt(query.pageSize as string);
  const skip = (page - 1) * pageSize;

  const where: any = { apiKeyId };
  if (query.status) where.status = query.status;

  const [knowledgeBases, total] = await Promise.all([
    prisma.knowledgeBase.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize,
      include: {
        _count: {
          select: { entries: true },
        },
      },
    }),
    prisma.knowledgeBase.count({ where }),
  ]);

  const result = knowledgeBases.map(kb => ({
    ...kb,
    metadata: fromJSON(kb.metadata),
  }));

  paginatedResponse(res, result, total, page, pageSize, '获取知识库列表成功');
});

export const getKnowledgeBase = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { id } = req.params;
  const apiKeyId = req.apiKey.id;

  const knowledgeBase = await prisma.knowledgeBase.findFirst({
    where: { id, apiKeyId },
    include: {
      _count: {
        select: { entries: true },
      },
    },
  });

  if (!knowledgeBase) {
    return next(new AppError(404, 'KNOWLEDGE_BASE_NOT_FOUND', '知识库不存在', '请检查知识库 ID 是否正确'));
  }

  const result = { ...knowledgeBase, metadata: fromJSON(knowledgeBase.metadata) };
  successResponse(res, result, '获取知识库详情成功');
});

export const updateKnowledgeBase = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { id } = req.params;
  const apiKeyId = req.apiKey.id;
  const { name, description, status, metadata } = req.body;

  const knowledgeBase = await prisma.knowledgeBase.findFirst({
    where: { id, apiKeyId },
  });

  if (!knowledgeBase) {
    return next(new AppError(404, 'KNOWLEDGE_BASE_NOT_FOUND', '知识库不存在', '请检查知识库 ID 是否正确'));
  }

  const updated = await prisma.knowledgeBase.update({
    where: { id },
    data: {
      name: name !== undefined ? name : undefined,
      description: description !== undefined ? description : undefined,
      status: status !== undefined ? status : undefined,
      metadata: metadata !== undefined ? toJSON(metadata) : undefined,
    },
  });

  await recordAuditLog(
    apiKeyId,
    'update_knowledge_base',
    'knowledge_base',
    id,
    'success'
  );

  const result = { ...updated, metadata: fromJSON(updated.metadata) };
  successResponse(res, result, '知识库更新成功');
});

export const deleteKnowledgeBase = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { id } = req.params;
  const apiKeyId = req.apiKey.id;

  const knowledgeBase = await prisma.knowledgeBase.findFirst({
    where: { id, apiKeyId },
  });

  if (!knowledgeBase) {
    return next(new AppError(404, 'KNOWLEDGE_BASE_NOT_FOUND', '知识库不存在', '请检查知识库 ID 是否正确'));
  }

  await prisma.$transaction([
    prisma.knowledgeEntry.deleteMany({ where: { knowledgeBaseId: id } }),
    prisma.knowledgeBase.delete({ where: { id } }),
  ]);

  await recordAuditLog(
    apiKeyId,
    'delete_knowledge_base',
    'knowledge_base',
    id,
    'success'
  );

  successResponse(res, null, '知识库删除成功');
});

export const addEntry = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { id } = req.params;
  const apiKeyId = req.apiKey.id;
  const body = addEntrySchema.parse(req.body);

  const knowledgeBase = await prisma.knowledgeBase.findFirst({
    where: { id, apiKeyId },
  });

  if (!knowledgeBase) {
    return next(new AppError(404, 'KNOWLEDGE_BASE_NOT_FOUND', '知识库不存在', '请检查知识库 ID 是否正确'));
  }

  const entry = await prisma.knowledgeEntry.create({
    data: {
      knowledgeBaseId: id,
      title: body.title,
      content: body.content,
      source: body.source,
      metadata: toJSON(body.metadata),
    },
  });

  await prisma.knowledgeBase.update({
    where: { id },
    data: { docCount: { increment: 1 } },
  });

  await recordAuditLog(
    apiKeyId,
    'add_knowledge_entry',
    'knowledge_entry',
    entry.id,
    'success',
    { knowledgeBaseId: id }
  );

  const result = { ...entry, metadata: fromJSON(entry.metadata) };
  successResponse(res, result, '知识条目添加成功', 201);
});

export const listEntries = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { id } = req.params;
  const apiKeyId = req.apiKey.id;
  const { page = '1', pageSize = '20' } = req.query;

  const knowledgeBase = await prisma.knowledgeBase.findFirst({
    where: { id, apiKeyId },
  });

  if (!knowledgeBase) {
    return next(new AppError(404, 'KNOWLEDGE_BASE_NOT_FOUND', '知识库不存在', '请检查知识库 ID 是否正确'));
  }

  const pageNum = parseInt(page as string);
  const pageSizeNum = parseInt(pageSize as string);
  const skip = (pageNum - 1) * pageSizeNum;

  const [entries, total] = await Promise.all([
    prisma.knowledgeEntry.findMany({
      where: { knowledgeBaseId: id },
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSizeNum,
    }),
    prisma.knowledgeEntry.count({ where: { knowledgeBaseId: id } }),
  ]);

  const result = entries.map(entry => ({
    ...entry,
    metadata: fromJSON(entry.metadata),
  }));

  paginatedResponse(res, result, total, pageNum, pageSizeNum, '获取知识条目成功');
});

export const deleteEntry = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { id, entryId } = req.params;
  const apiKeyId = req.apiKey.id;

  const knowledgeBase = await prisma.knowledgeBase.findFirst({
    where: { id, apiKeyId },
  });

  if (!knowledgeBase) {
    return next(new AppError(404, 'KNOWLEDGE_BASE_NOT_FOUND', '知识库不存在', '请检查知识库 ID 是否正确'));
  }

  const entry = await prisma.knowledgeEntry.findFirst({
    where: { id: entryId, knowledgeBaseId: id },
  });

  if (!entry) {
    return next(new AppError(404, 'KNOWLEDGE_ENTRY_NOT_FOUND', '知识条目不存在', '请检查条目 ID 是否正确'));
  }

  await prisma.knowledgeEntry.delete({ where: { id: entryId } });

  await prisma.knowledgeBase.update({
    where: { id },
    data: { docCount: { decrement: 1 } },
  });

  await recordAuditLog(
    apiKeyId,
    'delete_knowledge_entry',
    'knowledge_entry',
    entryId,
    'success'
  );

  successResponse(res, null, '知识条目删除成功');
});

export const searchKnowledge = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { id } = req.params;
  const apiKeyId = req.apiKey.id;
  const query = searchSchema.parse(req.query);

  const knowledgeBase = await prisma.knowledgeBase.findFirst({
    where: { id, apiKeyId },
  });

  if (!knowledgeBase) {
    return next(new AppError(404, 'KNOWLEDGE_BASE_NOT_FOUND', '知识库不存在', '请检查知识库 ID 是否正确'));
  }

  const topK = parseInt(query.topK as string);
  const results = await searchKnowledgeEntries(id, query.query, topK);

  const formattedResults = results.map(r => ({
    id: r.id,
    title: r.title,
    source: r.source,
    content: r.content.substring(0, 200) + (r.content.length > 200 ? '...' : ''),
    relevance: Math.round(r.relevance * 100) / 100,
  }));

  await recordUsage(apiKeyId, 'knowledge_search', 1, query.query.length);

  await recordAuditLog(
    apiKeyId,
    'search_knowledge',
    'knowledge_base',
    id,
    'success',
    { query: query.query, resultCount: formattedResults.length }
  );

  successResponse(res, {
    query: query.query,
    results: formattedResults,
    total: formattedResults.length,
  }, '知识检索成功');
});

export const askQuestion = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { id } = req.params;
  const apiKeyId = req.apiKey.id;
  const body = askSchema.parse(req.body);

  const knowledgeBase = await prisma.knowledgeBase.findFirst({
    where: { id, apiKeyId },
  });

  if (!knowledgeBase) {
    return next(new AppError(404, 'KNOWLEDGE_BASE_NOT_FOUND', '知识库不存在', '请检查知识库 ID 是否正确'));
  }

  const searchResults = await searchKnowledgeEntries(id, body.query, body.topK || 5);
  const { answer, citations } = await generateAnswer(body.query, searchResults);

  const formattedCitations = citations.map((r, i) => ({
    index: i + 1,
    id: r.id,
    title: r.title,
    source: r.source,
    content: r.content.substring(0, 200) + (r.content.length > 200 ? '...' : ''),
    relevance: Math.round(r.relevance * 100) / 100,
  }));

  const references = formattedCitations.map(c => c.source).filter(Boolean);
  const tokens = answer.length + body.query.length;

  await recordUsage(apiKeyId, 'knowledge_qa', 1, tokens);

  await recordAuditLog(
    apiKeyId,
    'ask_knowledge',
    'knowledge_base',
    id,
    'success',
    { query: body.query, hitCount: citations.length }
  );

  successResponse(res, {
    answer,
    query: body.query,
    citations: formattedCitations,
    references,
    hasAnswer: citations.length > 0,
    usage: {
      tokens,
    },
  }, '问答成功');
});
