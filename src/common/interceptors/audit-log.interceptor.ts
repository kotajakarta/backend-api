import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable, tap } from 'rxjs';

/**
 * Enterprise Audit Log Interceptor.
 * Logs all state-changing operations (POST, PUT, DELETE) with structured JSON
 * containing user identity, action details, and timing information.
 * 
 * Standard: ISO 27001 / PCI-DSS Audit Trail Requirements
 */
@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const method = req.method;

    // Only audit state-changing operations
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      return next.handle();
    }

    const startTime = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          this.logAudit(req, context, startTime, 'SUCCESS');
        },
        error: (err) => {
          this.logAudit(req, context, startTime, 'FAILED', err.message);
        },
      }),
    );
  }

  private logAudit(
    req: any,
    context: ExecutionContext,
    startTime: number,
    result: 'SUCCESS' | 'FAILED',
    errorMessage?: string,
  ) {
    const durationMs = Date.now() - startTime;
    const user = req.user || null;
    const res = context.switchToHttp().getResponse();

    const auditEntry = {
      timestamp: new Date().toISOString(),
      level: 'AUDIT',
      requestId: req.requestId || 'N/A',
      ip: req.ip || req.socket?.remoteAddress || 'unknown',
      method: req.method,
      path: req.originalUrl || req.url,
      statusCode: res.statusCode,
      userId: user?.id || 'anonymous',
      userScope: user?.scope || 'N/A',
      userDivisi: user?.divisi || 'N/A',
      result,
      durationMs,
      ...(errorMessage && { error: errorMessage }),
    };

    // Structured JSON log — easily parseable by log management tools
    // (ELK Stack, Grafana Loki, CloudWatch, etc.)
    console.log(JSON.stringify(auditEntry));
  }
}
