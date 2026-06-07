import prisma from '../prisma';
import { simulateSummarize, simulateRewrite } from './ai.service';
import { recordUsage } from './monitoring.service';
import { toJSON, fromJSON } from '../utils/json';

const runningTasks = new Map<string, { cancelled: boolean }>();

const isCancelled = (taskId: string): boolean => {
  const state = runningTasks.get(taskId);
  return state ? state.cancelled : false;
};

const checkAndHandleCancellation = async (taskId: string): Promise<boolean> => {
  if (isCancelled(taskId)) {
    await prisma.task.update({
      where: { id: taskId },
      data: {
        status: 'cancelled',
        completedAt: new Date(),
      },
    });
    return true;
  }
  return false;
};

export const processTask = async (taskId: string) => {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) return;

  if (task.status === 'cancelled') {
    return;
  }

  if (task.status !== 'pending') {
    return;
  }

  runningTasks.set(taskId, { cancelled: false });

  try {
    const updateResult = await prisma.task.updateMany({
      where: {
        id: taskId,
        status: 'pending',
      },
      data: {
        status: 'processing',
        startedAt: new Date(),
        progress: 10,
      },
    });

    if (updateResult.count === 0) {
      return;
    }

    if (await checkAndHandleCancellation(taskId)) return;

    await simulateProgress(taskId, 10, 30, 500);

    if (await checkAndHandleCancellation(taskId)) return;

    let outputData: any;
    let tokens = 0;

    const inputData = fromJSON(task.inputData) as any;

    switch (task.type) {
      case 'summarize':
        const summaryResult = await simulateSummarize(
          inputData.text || inputData.content,
          inputData.options
        );
        outputData = { summary: summaryResult.content };
        tokens = summaryResult.tokens;
        break;

      case 'rewrite':
        const rewriteResult = await simulateRewrite(
          inputData.text || inputData.content,
          inputData.options
        );
        outputData = { rewritten: rewriteResult.content };
        tokens = rewriteResult.tokens;
        break;

      default:
        throw new Error(`不支持的任务类型: ${task.type}`);
    }

    if (await checkAndHandleCancellation(taskId)) return;

    await simulateProgress(taskId, 30, 90, 300);

    if (await checkAndHandleCancellation(taskId)) return;

    const finalUpdate = await prisma.task.updateMany({
      where: {
        id: taskId,
        status: 'processing',
      },
      data: {
        status: 'completed',
        progress: 100,
        outputData: toJSON(outputData),
        completedAt: new Date(),
      },
    });

    if (finalUpdate.count > 0) {
      await recordUsage(task.apiKeyId, `task_${task.type}`, 1, tokens);
    }
  } catch (error: any) {
    if (isCancelled(taskId)) {
      await prisma.task.updateMany({
        where: {
          id: taskId,
          status: { in: ['processing', 'pending'] },
        },
        data: {
          status: 'cancelled',
          completedAt: new Date(),
        },
      });
      return;
    }

    const newRetryCount = task.retryCount + 1;
    const shouldRetry = newRetryCount < task.maxRetries;

    await prisma.task.update({
      where: { id: taskId },
      data: {
        status: shouldRetry ? 'pending' : 'failed',
        errorMessage: error.message,
        retryCount: newRetryCount,
        progress: 0,
      },
    });

    try {
      await prisma.errorLog.create({
        data: {
          errorCode: `TASK_FAILED_${task.type.toUpperCase()}`,
          errorMessage: error.message,
          stackTrace: error.stack || null,
          endpoint: `/api/v1/tasks/${taskId}`,
          apiKeyId: task.apiKeyId,
          retrySuggestion: shouldRetry 
            ? '系统将自动重试，或稍后可手动重试' 
            : '已达到最大重试次数，请检查输入后手动重试',
          metadata: toJSON({
            taskId,
            taskType: task.type,
            retryCount: newRetryCount,
            maxRetries: task.maxRetries,
          }),
        },
      });
    } catch (e) {
      console.error('Failed to log task error:', e);
    }

    if (shouldRetry) {
      setTimeout(() => {
        if (!isCancelled(taskId)) {
          processTask(taskId);
        }
      }, 2000 * newRetryCount);
    }
  } finally {
    runningTasks.delete(taskId);
  }
};

const simulateProgress = async (
  taskId: string,
  from: number,
  to: number,
  interval: number
) => {
  const steps = 5;
  const stepSize = (to - from) / steps;
  for (let i = 1; i <= steps; i++) {
    await new Promise(resolve => setTimeout(resolve, interval / steps));
    if (isCancelled(taskId)) return;
    await prisma.task.updateMany({
      where: {
        id: taskId,
        status: 'processing',
      },
      data: { progress: Math.floor(from + stepSize * i) },
    });
  }
};

export const cancelTask = async (taskId: string): Promise<{ success: boolean; status: string }> => {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { status: true },
  });

  if (!task) {
    return { success: false, status: 'not_found' };
  }

  if (task.status === 'completed' || task.status === 'cancelled' || task.status === 'failed') {
    return { success: false, status: task.status };
  }

  const taskState = runningTasks.get(taskId);
  if (taskState) {
    taskState.cancelled = true;
  }

  if (task.status === 'pending') {
    await prisma.task.update({
      where: { id: taskId },
      data: {
        status: 'cancelled',
        completedAt: new Date(),
      },
    });
  }

  return { success: true, status: 'cancelling' };
};

export const isTaskRunning = (taskId: string) => {
  return runningTasks.has(taskId);
};
