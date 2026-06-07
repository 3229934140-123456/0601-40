import prisma from '../prisma';

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
  details?: any,
  ip?: string
) => {
  await prisma.auditLog.create({
    data: {
      apiKeyId,
      action,
      resourceType,
      resourceId,
      result,
      details: details ? JSON.stringify(details) : undefined,
      ip,
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
