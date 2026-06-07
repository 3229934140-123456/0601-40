import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import prisma from '../prisma';
import { successResponse, paginatedResponse } from '../utils/response';
import { AppError, asyncHandler } from '../middleware/error.middleware';
import { simulateChatCompletion } from '../services/ai.service';
import { recordUsage, recordAuditLog } from '../services/monitoring.service';
import { v4 as uuidv4 } from 'uuid';

const createSessionSchema = z.object({
  sessionId: z.string().optional(),
  title: z.string().optional(),
  systemPrompt: z.string().optional(),
  model: z.string().optional(),
});

const sendMessageSchema = z.object({
  content: z.string().min(1, '消息内容不能为空'),
  role: z.enum(['user', 'assistant', 'system']).default('user'),
  sessionId: z.string().optional(),
  systemPrompt: z.string().optional(),
  model: z.string().optional(),
});

const listSessionsSchema = z.object({
  page: z.string().optional().default('1'),
  pageSize: z.string().optional().default('10'),
  status: z.string().optional(),
});

export const createSession = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const body = createSessionSchema.parse(req.body);
  const apiKeyId = req.apiKey.id;

  const sessionId = body.sessionId || uuidv4();

  const session = await prisma.session.create({
    data: {
      apiKeyId,
      sessionId,
      title: body.title || '新会话',
      systemPrompt: body.systemPrompt,
      model: body.model || 'default',
      status: 'active',
    },
  });

  await recordAuditLog(
    apiKeyId,
    'create_session',
    'session',
    session.id,
    'success',
    {
      details: { sessionId },
    }
  );

  successResponse(res, session, '会话创建成功', 201);
});

export const sendMessage = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const body = sendMessageSchema.parse(req.body);
  const apiKeyId = req.apiKey.id;
  const startTime = Date.now();

  let session;
  let sessionId = body.sessionId;

  if (sessionId) {
    session = await prisma.session.findFirst({
      where: { sessionId, apiKeyId, status: 'active' },
    });
    if (!session) {
      return next(new AppError(404, 'SESSION_NOT_FOUND', '会话不存在或已结束', '请检查 sessionId 是否正确，或创建新的会话'));
    }
  } else {
    sessionId = uuidv4();
    session = await prisma.session.create({
      data: {
        apiKeyId,
        sessionId,
        title: body.content.substring(0, 20),
        systemPrompt: body.systemPrompt,
        model: body.model || 'default',
        status: 'active',
      },
    });
  }

  const previousMessages = await prisma.message.findMany({
    where: { sessionId: session.id },
    orderBy: { createdAt: 'asc' },
    take: 20,
  });

  const allMessages = [
    ...(session.systemPrompt ? [{ role: 'system', content: session.systemPrompt }] : []),
    ...(body.systemPrompt && !session.systemPrompt ? [{ role: 'system', content: body.systemPrompt }] : []),
    ...previousMessages.map(m => ({ role: m.role, content: m.content })),
    { role: body.role, content: body.content },
  ];

  const userMessage = await prisma.message.create({
    data: {
      sessionId: session.id,
      role: body.role,
      content: body.content,
    },
  });

  const aiResponse = await simulateChatCompletion(
    allMessages as any,
    session.systemPrompt || body.systemPrompt
  );

  const assistantMessage = await prisma.message.create({
    data: {
      sessionId: session.id,
      role: 'assistant',
      content: aiResponse.content,
      tokens: aiResponse.tokens,
    },
  });

  await prisma.session.update({
    where: { id: session.id },
    data: {
      messageCount: { increment: 2 },
      updatedAt: new Date(),
    },
  });

  const latency = (Date.now() - startTime) / 1000;
  await recordUsage(apiKeyId, 'chat_message', 1, aiResponse.tokens, latency);

  await recordAuditLog(
    apiKeyId,
    'send_message',
    'session',
    session.id,
    'success',
    {
      details: { messageId: assistantMessage.id, tokens: aiResponse.tokens },
    }
  );

  successResponse(res, {
    sessionId: session.sessionId,
    message: {
      id: assistantMessage.id,
      role: assistantMessage.role,
      content: assistantMessage.content,
      tokens: assistantMessage.tokens,
      createdAt: assistantMessage.createdAt,
    },
    usage: {
      tokens: aiResponse.tokens,
      latency,
    },
  }, '消息发送成功');
});

export const listSessions = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const query = listSessionsSchema.parse(req.query);
  const apiKeyId = req.apiKey.id;

  const page = parseInt(query.page as string);
  const pageSize = parseInt(query.pageSize as string);
  const skip = (page - 1) * pageSize;

  const where: any = { apiKeyId };
  if (query.status) {
    where.status = query.status;
  }

  const [sessions, total] = await Promise.all([
    prisma.session.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip,
      take: pageSize,
      include: {
        _count: {
          select: { messages: true },
        },
      },
    }),
    prisma.session.count({ where }),
  ]);

  paginatedResponse(res, sessions, total, page, pageSize, '获取会话列表成功');
});

export const getSession = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { sessionId } = req.params;
  const apiKeyId = req.apiKey.id;

  const session = await prisma.session.findFirst({
    where: { sessionId, apiKeyId },
    include: {
      _count: {
        select: { messages: true },
      },
    },
  });

  if (!session) {
    return next(new AppError(404, 'SESSION_NOT_FOUND', '会话不存在', '请检查 sessionId 是否正确'));
  }

  successResponse(res, session, '获取会话详情成功');
});

export const getSessionMessages = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { sessionId } = req.params;
  const apiKeyId = req.apiKey.id;
  const { page = '1', pageSize = '50' } = req.query;

  const session = await prisma.session.findFirst({
    where: { sessionId, apiKeyId },
  });

  if (!session) {
    return next(new AppError(404, 'SESSION_NOT_FOUND', '会话不存在', '请检查 sessionId 是否正确'));
  }

  const pageNum = parseInt(page as string);
  const pageSizeNum = parseInt(pageSize as string);
  const skip = (pageNum - 1) * pageSizeNum;

  const [messages, total] = await Promise.all([
    prisma.message.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: 'asc' },
      skip,
      take: pageSizeNum,
      include: {
        citations: true,
      },
    }),
    prisma.message.count({ where: { sessionId: session.id } }),
  ]);

  paginatedResponse(res, messages, total, pageNum, pageSizeNum, '获取消息列表成功');
});

export const updateSession = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { sessionId } = req.params;
  const apiKeyId = req.apiKey.id;
  const { title, systemPrompt, status } = req.body;

  const session = await prisma.session.findFirst({
    where: { sessionId, apiKeyId },
  });

  if (!session) {
    return next(new AppError(404, 'SESSION_NOT_FOUND', '会话不存在', '请检查 sessionId 是否正确'));
  }

  const updatedSession = await prisma.session.update({
    where: { id: session.id },
    data: {
      title: title !== undefined ? title : undefined,
      systemPrompt: systemPrompt !== undefined ? systemPrompt : undefined,
      status: status !== undefined ? status : undefined,
    },
  });

  await recordAuditLog(
    apiKeyId,
    'update_session',
    'session',
    session.id,
    'success',
    {
      details: { title, status },
    }
  );

  successResponse(res, updatedSession, '会话更新成功');
});

export const deleteSession = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { sessionId } = req.params;
  const apiKeyId = req.apiKey.id;

  const session = await prisma.session.findFirst({
    where: { sessionId, apiKeyId },
  });

  if (!session) {
    return next(new AppError(404, 'SESSION_NOT_FOUND', '会话不存在', '请检查 sessionId 是否正确'));
  }

  await prisma.$transaction([
    prisma.message.deleteMany({ where: { sessionId: session.id } }),
    prisma.session.delete({ where: { id: session.id } }),
  ]);

  await recordAuditLog(
    apiKeyId,
    'delete_session',
    'session',
    session.id,
    'success'
  );

  successResponse(res, null, '会话删除成功');
});
