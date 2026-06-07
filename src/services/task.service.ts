import prisma from '../prisma';
import { simulateSummarize, simulateRewrite } from './ai.service';
import { recordUsage } from './monitoring.service';
import { toJSON, fromJSON } from '../utils/json';

const runningTasks = new Map<string, { cancelled: boolean }>();

export const processTask = async (taskId: string) => {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) return;

  runningTasks.set(taskId, { cancelled: false });

  try {
    await prisma.task.update({
      where: { id: taskId },
      data: {
        status: 'processing',
        startedAt: new Date(),
        progress: 10,
      },
    });

    await simulateProgress(taskId, 10, 30, 500);

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

    await simulateProgress(taskId, 30, 90, 300);

    if (runningTasks.get(taskId)?.cancelled) {
      await prisma.task.update({
        where: { id: taskId },
        data: {
          status: 'cancelled',
          completedAt: new Date(),
        },
      });
      return;
    }

    await prisma.task.update({
      where: { id: taskId },
      data: {
        status: 'completed',
        progress: 100,
        outputData: toJSON(outputData),
        completedAt: new Date(),
      },
    });

    await recordUsage(task.apiKeyId, `task_${task.type}`, 1, tokens);
  } catch (error: any) {
    if (runningTasks.get(taskId)?.cancelled) {
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

    if (shouldRetry) {
      setTimeout(() => processTask(taskId), 2000 * newRetryCount);
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
    if (runningTasks.get(taskId)?.cancelled) return;
    await prisma.task.update({
      where: { id: taskId },
      data: { progress: Math.floor(from + stepSize * i) },
    });
  }
};

export const cancelTask = (taskId: string) => {
  const taskState = runningTasks.get(taskId);
  if (taskState) {
    taskState.cancelled = true;
    return true;
  }
  return false;
};

export const isTaskRunning = (taskId: string) => {
  return runningTasks.has(taskId);
};
