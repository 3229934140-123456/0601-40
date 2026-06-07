import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import prisma from '../prisma';
import { successResponse, paginatedResponse } from '../utils/response';
import { AppError, asyncHandler } from '../middleware/error.middleware';
import { processTask, cancelTask, isTaskRunning } from '../services/task.service';
import { recordAuditLog } from '../services/monitoring.service';
import { toJSON, fromJSON } from '../utils/json';
import { v4 as uuidv4 } from 'uuid';

const createTaskSchema = z.object({
  type: z.enum(['summarize', 'rewrite']),
  inputData: z.object({
    text: z.string().optional(),
    content: z.string().optional(),
    documentId: z.string().optional(),
    options: z.any().optional(),
  }),
  priority: z.number().min(1).max(10).default(5),
  sessionId: z.string().optional(),
});

const listTasksSchema = z.object({
  page: z.string().optional().default('1'),
  pageSize: z.string().optional().default('10'),
  status: z.string().optional(),
  type: z.string().optional(),
});

const retryTaskSchema = z.object({
  maxRetries: z.number().optional(),
});

const formatTask = (task: any) => {
  if (!task) return task;
  const formatted = { ...task };
  if (formatted.inputData !== null && formatted.inputData !== undefined) {
    formatted.inputData = fromJSON(formatted.inputData);
  }
  if (formatted.outputData !== null && formatted.outputData !== undefined) {
    formatted.outputData = fromJSON(formatted.outputData);
  }
  return formatted;
};

const formatTasks = (tasks: any[]) => {
  return tasks.map(formatTask);
};

export const createTask = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const body = createTaskSchema.parse(req.body);
  const apiKeyId = req.apiKey.id;

  const taskId = uuidv4();

  let inputData = { ...body.inputData };

  if (body.inputData.documentId) {
    const doc = await prisma.document.findFirst({
      where: { id: body.inputData.documentId, apiKeyId },
    });
    if (!doc) {
      return next(new AppError(404, 'DOCUMENT_NOT_FOUND', '文档不存在', '请检查 documentId 是否正确'));
    }
    if (doc.status !== 'completed') {
      return next(new AppError(400, 'DOCUMENT_NOT_READY', '文档尚未解析完成', '当前状态：' + doc.status + '，请稍后重试'));
    }
    inputData.text = doc.parsedContent || '';
  }

  if (!inputData.text && !inputData.content) {
    return next(new AppError(400, 'INPUT_REQUIRED', '缺少输入内容', '请提供 text 或 documentId 参数'));
  }

  const task = await prisma.task.create({
    data: {
      apiKeyId,
      taskId,
      type: body.type,
      inputData: toJSON(inputData) as string,
      priority: body.priority,
      status: 'pending',
    },
  });

  setImmediate(() => processTask(task.id));

  await recordAuditLog(
    apiKeyId,
    'create_task',
    'task',
    task.id,
    'success',
    { taskType: body.type }
  );

  successResponse(res, {
    id: task.id,
    taskId: task.taskId,
    type: task.type,
    status: task.status,
    createdAt: task.createdAt,
  }, '任务创建成功', 201);
});

export const listTasks = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const query = listTasksSchema.parse(req.query);
  const apiKeyId = req.apiKey.id;

  const page = parseInt(query.page as string);
  const pageSize = parseInt(query.pageSize as string);
  const skip = (page - 1) * pageSize;

  const where: any = { apiKeyId };
  if (query.status) where.status = query.status;
  if (query.type) where.type = query.type;

  const [tasks, total] = await Promise.all([
    prisma.task.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize,
    }),
    prisma.task.count({ where }),
  ]);

  const formattedTasks = formatTasks(tasks);

  paginatedResponse(res, formattedTasks, total, page, pageSize, '获取任务列表成功');
});

export const getTask = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { id } = req.params;
  const apiKeyId = req.apiKey.id;

  const task = await prisma.task.findFirst({
    where: { id, apiKeyId },
    include: {
      taskRuns: {
        orderBy: { runIndex: 'desc' },
        take: 5,
      },
    },
  });

  if (!task) {
    return next(new AppError(404, 'TASK_NOT_FOUND', '任务不存在', '请检查任务 ID 是否正确'));
  }

  const running = isTaskRunning(task.id);

  const formattedTask = formatTask(task);

  successResponse(res, {
    ...formattedTask,
    isRunning: running,
  }, '获取任务详情成功');
});

export const getTaskProgress = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { id } = req.params;
  const apiKeyId = req.apiKey.id;

  const task = await prisma.task.findFirst({
    where: { id, apiKeyId },
    select: {
      id: true,
      taskId: true,
      type: true,
      status: true,
      progress: true,
      createdAt: true,
      startedAt: true,
      completedAt: true,
      errorMessage: true,
      retryCount: true,
    },
  });

  if (!task) {
    return next(new AppError(404, 'TASK_NOT_FOUND', '任务不存在', '请检查任务 ID 是否正确'));
  }

  const running = isTaskRunning(task.id);

  let errorInfo: any = null;
  if (task.status === 'failed' && task.errorMessage) {
    errorInfo = {
      message: task.errorMessage,
      retrySuggestion: task.retryCount < 3 ? '可以调用重试接口重新执行任务' : '已达到最大重试次数，请检查输入后重试',
      canRetry: task.retryCount < 3,
    };
  }

  successResponse(res, {
    ...task,
    isRunning: running,
    errorInfo,
  }, '获取任务进度成功');
});

export const cancelTaskHandler = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { id } = req.params;
  const apiKeyId = req.apiKey.id;

  const task = await prisma.task.findFirst({
    where: { id, apiKeyId },
  });

  if (!task) {
    return next(new AppError(404, 'TASK_NOT_FOUND', '任务不存在', '请检查任务 ID 是否正确'));
  }

  if (task.status === 'completed' || task.status === 'cancelled' || task.status === 'failed') {
    return next(new AppError(400, 'TASK_FINISHED', '任务已完成或已取消', '无法取消已结束的任务'));
  }

  const result = await cancelTask(task.id);

  if (!result.success) {
    return next(new AppError(400, 'CANCEL_FAILED', `任务取消失败，当前状态：${result.status}`, '请稍后重试'));
  }

  await recordAuditLog(
    apiKeyId,
    'cancel_task',
    'task',
    task.id,
    'success'
  );

  successResponse(res, {
    id: task.id,
    status: 'cancelled',
    message: '任务取消成功',
  }, '任务已取消');
});

export const retryTask = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { id } = req.params;
  const apiKeyId = req.apiKey.id;
  const body = retryTaskSchema.parse(req.body);

  const task = await prisma.task.findFirst({
    where: { id, apiKeyId },
  });

  if (!task) {
    return next(new AppError(404, 'TASK_NOT_FOUND', '任务不存在', '请检查任务 ID 是否正确'));
  }

  if (task.status !== 'failed') {
    return next(new AppError(400, 'TASK_NOT_FAILED', '只有失败的任务才能重试', '当前任务状态不支持重试'));
  }

  const updatedTask = await prisma.task.update({
    where: { id: task.id },
    data: {
      status: 'pending',
      errorMessage: null,
      progress: 0,
      maxRetries: body.maxRetries !== undefined ? body.maxRetries : task.maxRetries,
    },
  });

  setImmediate(() => processTask(task.id));

  await recordAuditLog(
    apiKeyId,
    'retry_task',
    'task',
    task.id,
    'success'
  );

  const formattedTask = formatTask(updatedTask);

  successResponse(res, formattedTask, '任务重试成功');
});

export const deleteTask = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { id } = req.params;
  const apiKeyId = req.apiKey.id;

  const task = await prisma.task.findFirst({
    where: { id, apiKeyId },
  });

  if (!task) {
    return next(new AppError(404, 'TASK_NOT_FOUND', '任务不存在', '请检查任务 ID 是否正确'));
  }

  if (isTaskRunning(task.id)) {
    return next(new AppError(400, 'TASK_RUNNING', '任务正在运行中', '请先取消任务再删除'));
  }

  await prisma.$transaction([
    prisma.taskRun.deleteMany({ where: { taskId: task.id } }),
    prisma.task.delete({ where: { id: task.id } }),
  ]);

  await recordAuditLog(
    apiKeyId,
    'delete_task',
    'task',
    task.id,
    'success'
  );

  successResponse(res, null, '任务删除成功');
});
