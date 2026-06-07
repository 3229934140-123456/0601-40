import { Request, Response, NextFunction } from 'express';

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

export const errorHandler = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  if (err instanceof AppError) {
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
    return res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: '请求参数验证失败',
        details: err.errors,
        retrySuggestion: '请检查请求参数是否符合接口文档要求',
      },
    });
  }

  console.error('Unhandled error:', err);

  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: '服务器内部错误',
      retrySuggestion: '请稍后重试，或联系技术支持',
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
