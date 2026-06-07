import { Request, Response, NextFunction } from 'express';
import prisma from '../prisma';
import { toJSON } from '../utils/json';

export class AppError extends Error {
  statusCode: number;
  errorCode: string;
  retrySuggestion?: string;

  constructor(statusCode: number, errorCode: string, message: string, retrySuggestion?: string) {
    super(message);
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.retrySuggestion = retrySuggestion;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

const logError = async (
  errorCode: string,
  errorMessage: string,
  req: Request,
  retrySuggestion?: string,
  stackTrace?: string,
  metadata?: any
) => {
  try {
    const apiKeyId = req.apiKey?.id;
    await prisma.errorLog.create({
      data: {
        errorCode,
        errorMessage,
        stackTrace: stackTrace || null,
        endpoint: req.originalUrl || req.url,
        apiKeyId: apiKeyId || null,
        retrySuggestion: retrySuggestion || null,
        metadata: toJSON({
          method: req.method,
          ip: req.ip,
          userAgent: req.get('user-agent'),
          ...metadata,
        }),
      },
    });
  } catch (e) {
    console.error('Failed to log error:', e);
  }
};

export const errorHandler = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  if (err instanceof AppError) {
    logError(
      err.errorCode,
      err.message,
      req,
      err.retrySuggestion,
      err.stack
    );

    return res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.errorCode,
        message: err.message,
        retrySuggestion: err.retrySuggestion,
      },
    });
  }

  if (err.name === 'ZodError') {
    const message = '请求参数验证失败';
    const retrySuggestion = '请检查请求参数是否符合接口文档要求';

    logError(
      'VALIDATION_ERROR',
      message,
      req,
      retrySuggestion,
      undefined,
      { details: err.errors }
    );

    return res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message,
        details: err.errors,
        retrySuggestion,
      },
    });
  }

  console.error('Unhandled error:', err);

  const message = '服务器内部错误';
  const retrySuggestion = '请稍后重试，或联系技术支持';

  logError(
    'INTERNAL_SERVER_ERROR',
    err.message || message,
    req,
    retrySuggestion,
    err.stack
  );

  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message,
      retrySuggestion,
    },
  });
};

export const asyncHandler = (fn: Function) => (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};
