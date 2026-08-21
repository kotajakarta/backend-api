import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';

/**
 * Global Exception Filter.
 * Catches ALL unhandled exceptions and prevents stack trace / internal details
 * from leaking to the client. Logs full details internally for debugging.
 * 
 * Standard: OWASP Error Handling Best Practices
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'An unexpected error occurred. Please try again later.';

    const isHttp =
      exception instanceof HttpException ||
      (typeof (exception as any)?.getStatus === 'function' && typeof (exception as any)?.getResponse === 'function');

    if (isHttp) {
      status = (exception as any).getStatus();
      const exceptionResponse = (exception as any).getResponse();
      message = typeof exceptionResponse === 'string'
        ? exceptionResponse
        : (exceptionResponse as any)?.message || message;
    } else if (process.env.NODE_ENV !== 'production' && exception instanceof Error) {
      message = exception.message;
    }

    // Log full error internally for debugging (never exposed to client)
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'ERROR',
      requestId: (request as any).requestId || 'N/A',
      path: request.url,
      method: request.method,
      statusCode: status,
      error: exception instanceof Error ? exception.message : String(exception),
      stack: exception instanceof Error ? exception.stack : undefined,
    }));

    response.status(status).json({
      statusCode: status,
      message,
      ...(process.env.NODE_ENV !== 'production' && !isHttp && exception instanceof Error
        ? { error: exception.message, stack: exception.stack }
        : {}),
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}
