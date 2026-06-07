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
  tags: z.array(z.string()).optional(),
  metadata: z.any().optional(),
});

const batchAddEntriesSchema = z.object({
  entries: z.array(
    z.object({
      title: z.string().min(1, '标题不能为空'),
      content: z.string().min(1, '内容不能为空'),
      source: z.string().optional(),
      tags: z.array(z.string()).optional(),
      metadata: z.any().optional(),
    })
  ).min(1, '条目列表不能为空'),
});

const listEntriesSchema = z.object({
  page: z.string().optional().default('1'),
  pageSize: z.string().optional().default('20'),
  source: z.string().optional(),
  tags: z.string().optional(),
});

const searchSchema = z.object({
  query: z.string().min(1, '查询内容不能为空'),
  topK: z.string().optional().default('5'),
  includeAnswer: z.string().optional().default('false'),
  source: z.string().optional(),
  tags: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

const askSchema = z.object({
  query: z.string().min(1, '问题不能为空'),
  topK: z.number().optional().default(5),
  systemPrompt: z.string().optional(),
  source: z.string().optional(),
  tags: z.array(z.string()).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

const parseTagsParam = (tagsStr: string | undefined): string[] | undefined => {
  if (!tagsStr) return undefined;
  try {
    const parsed = JSON.parse(tagsStr);
    if (Array.isArray(parsed)) {
      return parsed.filter(t => typeof t === 'string');
    }
  } catch {
    return tagsStr.split(',').map(t => t.trim()).filter(t => t.length > 0);
  }
  return undefined;
};

const parseDateParam = (dateStr: string | undefined): Date | undefined => {
  if (!dateStr) return undefined;
  const date = new Date(dateStr);
  return isNaN(date.getTime()) ? undefined : date;
};

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
    {
      details: { name: body.name },
    }
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

  const entry = await prisma.$transaction(async (tx) => {
    const newEntry = await tx.knowledgeEntry.create({
      data: {
        knowledgeBaseId: id,
        title: body.title,
        content: body.content,
        source: body.source,
        tags: toJSON(body.tags),
        metadata: toJSON(body.metadata),
      },
    });

    await tx.knowledgeEntryVersion.create({
      data: {
        entryId: newEntry.id,
        version: 1,
        title: body.title,
        content: body.content,
        source: body.source,
        tags: toJSON(body.tags),
        changeSummary: '初始版本',
        metadata: toJSON(body.metadata),
      },
    });

    await tx.knowledgeBase.update({
      where: { id },
      data: { docCount: { increment: 1 } },
    });

    return newEntry;
  });

  await recordAuditLog(
    apiKeyId,
    'add_knowledge_entry',
    'knowledge_entry',
    entry.id,
    'success',
    {
      details: { knowledgeBaseId: id },
    }
  );

  const result = { ...entry, tags: fromJSON<string[]>(entry.tags), metadata: fromJSON(entry.metadata) };
  successResponse(res, result, '知识条目添加成功', 201);
});

export const batchAddEntries = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { id } = req.params;
  const apiKeyId = req.apiKey.id;
  const body = batchAddEntriesSchema.parse(req.body);

  const knowledgeBase = await prisma.knowledgeBase.findFirst({
    where: { id, apiKeyId },
  });

  if (!knowledgeBase) {
    return next(new AppError(404, 'KNOWLEDGE_BASE_NOT_FOUND', '知识库不存在', '请检查知识库 ID 是否正确'));
  }

  const createdEntries = await prisma.$transaction(async (tx) => {
    const entries = [];
    for (const item of body.entries) {
      const entry = await tx.knowledgeEntry.create({
        data: {
          knowledgeBaseId: id,
          title: item.title,
          content: item.content,
          source: item.source,
          tags: toJSON(item.tags),
          metadata: toJSON(item.metadata),
        },
      });
      entries.push(entry);
    }

    await tx.knowledgeBase.update({
      where: { id },
      data: { docCount: { increment: entries.length } },
    });

    return entries;
  });

  await recordAuditLog(
    apiKeyId,
    'batch_add_knowledge_entries',
    'knowledge_base',
    id,
    'success',
    {
      details: { knowledgeBaseId: id, count: createdEntries.length },
    }
  );

  const result = createdEntries.map(entry => ({
    ...entry,
    tags: fromJSON<string[]>(entry.tags),
    metadata: fromJSON(entry.metadata),
  }));

  successResponse(res, {
    added: result.length,
    entries: result,
  }, '批量添加知识条目成功', 201);
});

export const listEntries = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { id } = req.params;
  const apiKeyId = req.apiKey.id;
  const query = listEntriesSchema.parse(req.query);

  const knowledgeBase = await prisma.knowledgeBase.findFirst({
    where: { id, apiKeyId },
  });

  if (!knowledgeBase) {
    return next(new AppError(404, 'KNOWLEDGE_BASE_NOT_FOUND', '知识库不存在', '请检查知识库 ID 是否正确'));
  }

  const pageNum = parseInt(query.page as string);
  const pageSizeNum = parseInt(query.pageSize as string);
  const skip = (pageNum - 1) * pageSizeNum;

  const where: any = { knowledgeBaseId: id };
  if (query.source) {
    where.source = query.source;
  }

  const [entries, total] = await Promise.all([
    prisma.knowledgeEntry.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSizeNum,
    }),
    prisma.knowledgeEntry.count({ where }),
  ]);

  const tagsFilter = parseTagsParam(query.tags as string | undefined);
  let filteredEntries = entries;
  if (tagsFilter && tagsFilter.length > 0) {
    filteredEntries = entries.filter(entry => {
      if (!entry.tags) return false;
      const entryTags = fromJSON<string[]>(entry.tags) || [];
      return tagsFilter.every(tag => entryTags.includes(tag));
    });
  }

  const result = filteredEntries.map(entry => ({
    id: entry.id,
    knowledgeBaseId: entry.knowledgeBaseId,
    title: entry.title,
    content: entry.content,
    source: entry.source,
    tags: fromJSON<string[]>(entry.tags),
    version: entry.version,
    metadata: fromJSON(entry.metadata),
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  }));

  const totalCount = tagsFilter && tagsFilter.length > 0 ? result.length : total;

  paginatedResponse(res, result, totalCount, pageNum, pageSizeNum, '获取知识条目成功');
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
  const tags = parseTagsParam(query.tags as string | undefined);
  const startDate = parseDateParam(query.startDate as string | undefined);
  const endDate = parseDateParam(query.endDate as string | undefined);

  const results = await searchKnowledgeEntries(id, query.query, {
    topK,
    tags,
    source: query.source,
    startDate,
    endDate,
  });

  const formattedResults = results.map(r => ({
    id: r.id,
    title: r.title,
    source: r.source,
    tags: r.tags,
    version: r.version,
    summary: r.summary,
    relevance: Math.round(r.relevance * 100) / 100,
    matchedFields: r.matchedFields,
  }));

  await recordUsage(apiKeyId, 'knowledge_search', 1, query.query.length);

  await recordAuditLog(
    apiKeyId,
    'search_knowledge',
    'knowledge_base',
    id,
    'success',
    { details: { query: query.query, resultCount: formattedResults.length } }
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

  const startDate = parseDateParam(body.startDate);
  const endDate = parseDateParam(body.endDate);

  const searchResults = await searchKnowledgeEntries(id, body.query, {
    topK: body.topK || 5,
    tags: body.tags,
    source: body.source,
    startDate,
    endDate,
  });
  const { answer, citations } = await generateAnswer(body.query, searchResults);

  const formattedCitations = citations.map((r, i) => ({
    index: i + 1,
    id: r.id,
    title: r.title,
    source: r.source,
    tags: r.tags,
    version: r.version,
    summary: r.summary,
    relevance: Math.round(r.relevance * 100) / 100,
    matchedFields: r.matchedFields,
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
    { details: { query: body.query, hitCount: citations.length } }
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

const updateEntrySchema = z.object({
  title: z.string().min(1, '标题不能为空').optional(),
  content: z.string().min(1, '内容不能为空').optional(),
  source: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

const arraysEqual = (a: string[] | null | undefined, b: string[] | null | undefined): boolean => {
  const arr1 = a || [];
  const arr2 = b || [];
  if (arr1.length !== arr2.length) return false;
  const sorted1 = [...arr1].sort();
  const sorted2 = [...arr2].sort();
  return sorted1.every((val, idx) => val === sorted2[idx]);
};

const calculateChangeSummary = (
  oldTitle: string,
  newTitle: string | undefined,
  oldContent: string,
  newContent: string | undefined,
  oldSource: string | null,
  newSource: string | undefined,
  oldTags: string[] | null,
  newTags: string[] | undefined
): string => {
  const changedFields: string[] = [];

  if (newTitle !== undefined && newTitle !== oldTitle) {
    changedFields.push('title');
  }
  if (newContent !== undefined && newContent !== oldContent) {
    changedFields.push('content');
  }
  if (newSource !== undefined && newSource !== oldSource) {
    changedFields.push('source');
  }
  if (newTags !== undefined && !arraysEqual(oldTags, newTags)) {
    changedFields.push('tags');
  }

  return changedFields.join(', ');
};

export const updateEntry = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { id, entryId } = req.params;
  const apiKeyId = req.apiKey.id;
  const body = updateEntrySchema.parse(req.body);

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

  const oldTags = fromJSON<string[]>(entry.tags);
  const changeSummary = calculateChangeSummary(
    entry.title,
    body.title,
    entry.content,
    body.content,
    entry.source,
    body.source,
    oldTags,
    body.tags
  );

  if (!changeSummary) {
    const result = {
      ...entry,
      tags: oldTags,
      metadata: fromJSON(entry.metadata),
    };
    return successResponse(res, result, '条目未修改');
  }

  const newVersion = entry.version + 1;
  const updatedTitle = body.title !== undefined ? body.title : entry.title;
  const updatedContent = body.content !== undefined ? body.content : entry.content;
  const updatedSource = body.source !== undefined ? body.source : entry.source;
  const updatedTags = body.tags !== undefined ? toJSON(body.tags) : entry.tags;

  const updatedEntry = await prisma.$transaction(async (tx) => {
    const updated = await tx.knowledgeEntry.update({
      where: { id: entryId },
      data: {
        title: updatedTitle,
        content: updatedContent,
        source: updatedSource,
        tags: updatedTags,
        version: newVersion,
      },
    });

    await tx.knowledgeEntryVersion.create({
      data: {
        entryId: entryId,
        version: newVersion,
        title: updatedTitle,
        content: updatedContent,
        source: updatedSource,
        tags: updatedTags,
        changeSummary,
        metadata: entry.metadata,
      },
    });

    return updated;
  });

  await recordAuditLog(
    apiKeyId,
    'update_knowledge_entry',
    'knowledge_entry',
    entryId,
    'success',
    {
      details: { knowledgeBaseId: id, version: newVersion, changed: changeSummary },
    }
  );

  const result = {
    ...updatedEntry,
    tags: fromJSON<string[]>(updatedEntry.tags),
    metadata: fromJSON(updatedEntry.metadata),
  };
  successResponse(res, result, '知识条目更新成功');
});

export const listEntryVersions = asyncHandler(async (
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

  const versions = await prisma.knowledgeEntryVersion.findMany({
    where: { entryId },
    orderBy: { version: 'desc' },
  });

  const result = versions.map(v => ({
    version: v.version,
    title: v.title,
    source: v.source,
    tags: fromJSON<string[]>(v.tags),
    changeSummary: v.changeSummary,
    createdAt: v.createdAt,
  }));

  successResponse(res, result, '获取版本历史成功');
});

export const getEntryVersion = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { id, entryId, version } = req.params;
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

  const versionNum = parseInt(version);
  if (isNaN(versionNum)) {
    return next(new AppError(400, 'INVALID_VERSION', '版本号无效', '版本号必须是数字'));
  }

  const versionRecord = await prisma.knowledgeEntryVersion.findFirst({
    where: { entryId, version: versionNum },
  });

  if (!versionRecord) {
    return next(new AppError(404, 'VERSION_NOT_FOUND', '版本不存在', '请检查版本号是否正确'));
  }

  const result = {
    id: versionRecord.id,
    entryId: versionRecord.entryId,
    version: versionRecord.version,
    title: versionRecord.title,
    content: versionRecord.content,
    source: versionRecord.source,
    tags: fromJSON<string[]>(versionRecord.tags),
    changeSummary: versionRecord.changeSummary,
    metadata: fromJSON(versionRecord.metadata),
    createdAt: versionRecord.createdAt,
  };

  successResponse(res, result, '获取版本详情成功');
});
