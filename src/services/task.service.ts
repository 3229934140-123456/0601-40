import prisma from '../prisma';
import { simulateSummarize, simulateRewrite } from './ai.service';
import { recordUsage } from './monitoring.service';
import { toJSON, fromJSON } from '../utils/json';

interface RunningTaskState {
  cancelled: boolean;
  taskRunId?: string;
}

const runningTasks = new Map<string, RunningTaskState>();

const isCancelled = (taskId: string): boolean => {
  const state = runningTasks.get(taskId);
  return state ? state.cancelled : false;
};

const getCurrentTaskRunId = (taskId: string): string | undefined => {
  const state = runningTasks.get(taskId);
  return state?.taskRunId;
};

const checkAndHandleCancellation = async (taskId: string): Promise<boolean> => {
  if (isCancelled(taskId)) {
    const taskRunId = getCurrentTaskRunId(taskId);
    const now = new Date();
    
    const updates: any = {
      status: 'cancelled',
      completedAt: now,
    };

    await prisma.task.update({
      where: { id: taskId },
      data: updates,
    });

    if (taskRunId) {
      await prisma.taskRun.update({
        where: { id: taskRunId },
        data: {
          status: 'cancelled',
          completedAt: now,
        },
      });
    }
    return true;
  }
  return false;
};

export const processTask = async (taskId: string, source: string = 'auto') => {
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

    const taskRun = await prisma.taskRun.create({
      data: {
        taskId,
        runIndex: task.retryCount,
        status: 'running',
        source,
        inputData: task.inputData,
        startedAt: new Date(),
      },
    });

    const state = runningTasks.get(taskId);
    if (state) {
      state.taskRunId = taskRun.id;
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
      const taskRunId = getCurrentTaskRunId(taskId);
      if (taskRunId) {
        await prisma.taskRun.update({
          where: { id: taskRunId },
          data: {
            status: 'completed',
            outputData: toJSON(outputData),
            completedAt: new Date(),
          },
        });
      }
      await recordUsage(task.apiKeyId, `task_${task.type}`, 1, tokens);
    }
  } catch (error: any) {
    if (isCancelled(taskId)) {
      const taskRunId = getCurrentTaskRunId(taskId);
      const now = new Date();
      
      await prisma.task.updateMany({
        where: {
          id: taskId,
          status: { in: ['processing', 'pending'] },
        },
        data: {
          status: 'cancelled',
          completedAt: now,
        },
      });

      if (taskRunId) {
        await prisma.taskRun.update({
          where: { id: taskRunId },
          data: {
            status: 'cancelled',
            completedAt: now,
          },
        });
      }
      return;
    }

    const taskRunId = getCurrentTaskRunId(taskId);
    const newRetryCount = task.retryCount + 1;
    const shouldRetry = newRetryCount < task.maxRetries;
    const errorMessage = error.message || '未知错误';

    await prisma.task.update({
      where: { id: taskId },
      data: {
        status: shouldRetry ? 'pending' : 'failed',
        errorMessage,
        retryCount: newRetryCount,
        progress: 0,
      },
    });

    if (taskRunId) {
      await prisma.taskRun.update({
        where: { id: taskRunId },
        data: {
          status: 'failed',
          errorMessage,
          completedAt: new Date(),
        },
      });
    }

    try {
      const retrySuggestion = shouldRetry 
        ? '系统将自动重试，或稍后可手动重试' 
        : '已达到最大重试次数，请检查输入后手动重试';
      
      await prisma.errorLog.create({
        data: {
          errorCode: `TASK_FAILED_${task.type.toUpperCase()}`,
          errorMessage,
          stackTrace: error.stack || null,
          endpoint: `/api/v1/tasks/${taskId}`,
          apiKeyId: task.apiKeyId,
          retrySuggestion,
          metadata: toJSON({
            taskId: taskId,
            taskTaskId: task.taskId,
            taskType: task.type,
            retryCount: newRetryCount,
            maxRetries: task.maxRetries,
            taskRunId: taskRunId,
          }),
        },
      });
    } catch (e) {
      console.error('Failed to log task error:', e);
    }

    if (shouldRetry) {
      setTimeout(() => {
        if (!isCancelled(taskId)) {
          processTask(taskId, 'auto_retry');
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

export const cancelTask = async (
  taskId: string,
  cancelledBy: string = 'system'
): Promise<{ success: boolean; status: string }> => {
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

  const now = new Date();

  const updateResult = await prisma.task.updateMany({
    where: {
      id: taskId,
      status: { in: ['pending', 'processing'] },
    },
    data: {
      status: 'cancelled',
      completedAt: now,
      cancelledAt: now,
      cancelledBy,
    },
  });

  if (updateResult.count > 0) {
    const latestRun = await prisma.taskRun.findFirst({
      where: { taskId, status: 'running' },
      orderBy: { runIndex: 'desc' },
    });
    if (latestRun) {
      await prisma.taskRun.update({
        where: { id: latestRun.id },
        data: {
          status: 'cancelled',
          completedAt: now,
        },
      });
    }
    return { success: true, status: 'cancelled' };
  }

  const finalTask = await prisma.task.findUnique({
    where: { id: taskId },
    select: { status: true },
  });

  return { success: false, status: finalTask?.status || 'unknown' };
};

export const isTaskRunning = (taskId: string) => {
  return runningTasks.has(taskId);
};
