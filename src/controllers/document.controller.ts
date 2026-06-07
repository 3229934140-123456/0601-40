import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import prisma from '../prisma';
import { successResponse, paginatedResponse } from '../utils/response';
import { AppError, asyncHandler } from '../middleware/error.middleware';
import { simulateDocumentParse } from '../services/ai.service';
import { recordUsage, recordAuditLog } from '../services/monitoring.service';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';

const listDocumentsSchema = z.object({
  page: z.string().optional().default('1'),
  pageSize: z.string().optional().default('10'),
  status: z.string().optional(),
  type: z.string().optional(),
});

const updateDocumentSchema = z.object({
  name: z.string().optional(),
  metadata: z.any().optional(),
});

export const uploadDocument = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const apiKeyId = req.apiKey.id;

  if (!req.file) {
    return next(new AppError(400, 'FILE_MISSING', '未上传文件', '请在请求中包含文件'));
  }

  const uploadDir = process.env.UPLOAD_DIR || './uploads';
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  const documentId = uuidv4();
  const fileExt = path.extname(req.file.originalname);
  const fileName = `${documentId}${fileExt}`;
  const filePath = path.join(uploadDir, fileName);

  fs.writeFileSync(filePath, req.file.buffer);

  const document = await prisma.document.create({
    data: {
      apiKeyId,
      name: req.body.name || req.file.originalname,
      originalName: req.file.originalname,
      type: req.file.mimetype,
      size: req.file.size,
      path: filePath,
      status: 'parsing',
      metadata: JSON.stringify({
        originalName: req.file.originalname,
        encoding: req.file.encoding,
      }),
    },
  });

  setImmediate(async () => {
    try {
      const parsed = await simulateDocumentParse(filePath, req.file!.mimetype);

      await prisma.$transaction([
        prisma.document.update({
          where: { id: document.id },
          data: {
            status: 'completed',
            parsedContent: parsed.content,
            pages: parsed.pages,
          },
        }),
        prisma.documentChunk.createMany({
          data: parsed.chunks.map(chunk => ({
            documentId: document.id,
            chunkIndex: chunk.index,
            content: chunk.content,
          })),
        }),
      ]);

      await recordUsage(apiKeyId, 'document_parse', 1, parsed.content.length);
    } catch (error) {
      await prisma.document.update({
        where: { id: document.id },
        data: {
          status: 'failed',
        },
      });
    }
  });

  await recordAuditLog(
    apiKeyId,
    'upload_document',
    'document',
    document.id,
    'success',
    {
      details: { fileName: req.file.originalname, size: req.file.size },
    }
  );

  successResponse(res, {
    id: document.id,
    name: document.name,
    status: document.status,
    size: document.size,
    type: document.type,
  }, '文档上传成功', 201);
});

export const listDocuments = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const query = listDocumentsSchema.parse(req.query);
  const apiKeyId = req.apiKey.id;

  const page = parseInt(query.page as string);
  const pageSize = parseInt(query.pageSize as string);
  const skip = (page - 1) * pageSize;

  const where: any = { apiKeyId };
  if (query.status) where.status = query.status;
  if (query.type) where.type = { contains: query.type };

  const [documents, total] = await Promise.all([
    prisma.document.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize,
      include: {
        _count: {
          select: { chunks: true },
        },
      },
    }),
    prisma.document.count({ where }),
  ]);

  paginatedResponse(res, documents, total, page, pageSize, '获取文档列表成功');
});

export const getDocument = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { id } = req.params;
  const apiKeyId = req.apiKey.id;

  const document = await prisma.document.findFirst({
    where: { id, apiKeyId },
    include: {
      chunks: {
        orderBy: { chunkIndex: 'asc' },
        take: 10,
      },
    },
  });

  if (!document) {
    return next(new AppError(404, 'DOCUMENT_NOT_FOUND', '文档不存在', '请检查文档 ID 是否正确'));
  }

  successResponse(res, document, '获取文档详情成功');
});

export const getDocumentContent = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { id } = req.params;
  const apiKeyId = req.apiKey.id;

  const document = await prisma.document.findFirst({
    where: { id, apiKeyId },
  });

  if (!document) {
    return next(new AppError(404, 'DOCUMENT_NOT_FOUND', '文档不存在', '请检查文档 ID 是否正确'));
  }

  if (document.status !== 'completed') {
    return next(new AppError(400, 'DOCUMENT_NOT_READY', '文档尚未解析完成', `当前状态：${document.status}，请稍后重试`));
  }

  const { page = '1', pageSize = '20' } = req.query;
  const pageNum = parseInt(page as string);
  const pageSizeNum = parseInt(pageSize as string);
  const skip = (pageNum - 1) * pageSizeNum;

  const [chunks, total] = await Promise.all([
    prisma.documentChunk.findMany({
      where: { documentId: id },
      orderBy: { chunkIndex: 'asc' },
      skip,
      take: pageSizeNum,
    }),
    prisma.documentChunk.count({ where: { documentId: id } }),
  ]);

  paginatedResponse(res, chunks, total, pageNum, pageSizeNum, '获取文档内容成功');
});

export const updateDocument = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { id } = req.params;
  const apiKeyId = req.apiKey.id;
  const body = updateDocumentSchema.parse(req.body);

  const document = await prisma.document.findFirst({
    where: { id, apiKeyId },
  });

  if (!document) {
    return next(new AppError(404, 'DOCUMENT_NOT_FOUND', '文档不存在', '请检查文档 ID 是否正确'));
  }

  const updatedDocument = await prisma.document.update({
    where: { id },
    data: {
      name: body.name !== undefined ? body.name : undefined,
      metadata: body.metadata !== undefined && body.metadata !== null ? JSON.stringify(body.metadata) : undefined,
    },
  });

  await recordAuditLog(
    apiKeyId,
    'update_document',
    'document',
    id,
    'success',
    {
      details: { name: body.name },
    }
  );

  successResponse(res, updatedDocument, '文档更新成功');
});

export const deleteDocument = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { id } = req.params;
  const apiKeyId = req.apiKey.id;

  const document = await prisma.document.findFirst({
    where: { id, apiKeyId },
  });

  if (!document) {
    return next(new AppError(404, 'DOCUMENT_NOT_FOUND', '文档不存在', '请检查文档 ID 是否正确'));
  }

  try {
    if (fs.existsSync(document.path)) {
      fs.unlinkSync(document.path);
    }
  } catch (e) {
    console.error('Failed to delete file:', e);
  }

  await prisma.$transaction([
    prisma.documentChunk.deleteMany({ where: { documentId: id } }),
    prisma.document.delete({ where: { id } }),
  ]);

  await recordAuditLog(
    apiKeyId,
    'delete_document',
    'document',
    id,
    'success'
  );

  successResponse(res, null, '文档删除成功');
});
