import { Request, Response, NextFunction } from 'express';
import prisma from '../prisma';
import { asyncHandler, AppError } from '../middleware/error.middleware';
import { successResponse, paginatedResponse } from '../utils/response';
import { z } from 'zod';

const listPublicTemplatesSchema = z.object({
  page: z.string().optional().default('1'),
  pageSize: z.string().optional().default('20'),
  type: z.string().optional(),
});

export const listPublicTemplates = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const query = listPublicTemplatesSchema.parse(req.query);

  const page = parseInt(query.page as string);
  const pageSize = parseInt(query.pageSize as string);
  const skip = (page - 1) * pageSize;

  const where: any = { status: 'active' };
  if (query.type) where.type = query.type;

  const [templates, total] = await Promise.all([
    prisma.sceneTemplate.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize,
      select: {
        id: true,
        name: true,
        code: true,
        description: true,
        type: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.sceneTemplate.count({ where }),
  ]);

  paginatedResponse(res, templates, total, page, pageSize, '获取场景模板成功');
});

export const getPublicTemplate = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { id } = req.params;

  const template = await prisma.sceneTemplate.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      code: true,
      description: true,
      type: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!template) {
    return next(new AppError(404, 'TEMPLATE_NOT_FOUND', '模板不存在', '请检查 ID 是否正确'));
  }

  if (template.status !== 'active') {
    return next(new AppError(404, 'TEMPLATE_NOT_FOUND', '模板不存在', '请检查 ID 是否正确'));
  }

  successResponse(res, template, '获取模板详情成功');
});

export const getPublicTemplateByCode = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { code } = req.params;

  const template = await prisma.sceneTemplate.findUnique({
    where: { code },
    select: {
      id: true,
      name: true,
      code: true,
      description: true,
      type: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!template) {
    return next(new AppError(404, 'TEMPLATE_NOT_FOUND', '模板不存在', '请检查模板编码是否正确'));
  }

  if (template.status !== 'active') {
    return next(new AppError(404, 'TEMPLATE_NOT_FOUND', '模板不存在', '请检查模板编码是否正确'));
  }

  successResponse(res, template, '获取模板成功');
});
