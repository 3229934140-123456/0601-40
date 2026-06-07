import prisma from '../prisma';
import { toJSON, fromJSON } from '../utils/json';

export const recordUsage = async (
  apiKeyId: string,
  metricType: string,
  count: number = 1,
  tokens: number = 0,
  latency?: number
) => {
  const now = new Date();
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const existingStat = await prisma.usageStat.findFirst({
    where: {
      apiKeyId,
      metricType,
      date,
    },
  });

  if (existingStat) {
    await prisma.usageStat.update({
      where: { id: existingStat.id },
      data: {
        count: { increment: count },
        tokens: { increment: tokens },
        latency: latency ? (existingStat.latency || latency) : undefined,
      },
    });
  } else {
    await prisma.usageStat.create({
      data: {
        apiKeyId,
        metricType,
        date,
        count,
        tokens,
        latency,
      },
    });
  }

  await prisma.apiKey.update({
    where: { id: apiKeyId },
    data: { used: { increment: count } },
  });
};

export const recordAuditLog = async (
  apiKeyId: string | undefined,
  action: string,
  resourceType: string,
  resourceId: string | undefined,
  result: string,
  options?: {
    details?: any;
    beforeData?: any;
    afterData?: any;
    operator?: string;
    endpoint?: string;
    ip?: string;
  }
) => {
  const detailsObj: any = {};
  if (options?.details) {
    detailsObj.details = options.details;
  }
  if (options?.beforeData) {
    detailsObj.beforeData = options.beforeData;
  }
  if (options?.afterData) {
    detailsObj.afterData = options.afterData;
  }
  if (options?.operator) {
    detailsObj.operator = options.operator;
  }
  if (options?.endpoint) {
    detailsObj.endpoint = options.endpoint;
  }

  await prisma.auditLog.create({
    data: {
      apiKeyId,
      action,
      resourceType,
      resourceId,
      result,
      details: Object.keys(detailsObj).length > 0 ? toJSON(detailsObj) : null,
      ip: options?.ip || null,
    },
  });
};

export const recordError = async (
  errorCode: string,
  errorMessage: string,
  stackTrace?: string,
  endpoint?: string,
  apiKeyId?: string,
  retrySuggestion?: string,
  metadata?: any
) => {
  await prisma.errorLog.create({
    data: {
      errorCode,
      errorMessage,
      stackTrace,
      endpoint,
      apiKeyId,
      retrySuggestion,
      metadata: metadata ? JSON.stringify(metadata) : undefined,
    },
  });
};
