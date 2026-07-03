import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * Prisma Client Exception Filter (Hardened).
 * Converts Prisma database errors into safe, user-friendly HTTP responses
 * WITHOUT leaking internal database structure, query details, or table names.
 * 
 * Standard: OWASP Error Handling — never expose ORM/SQL internals
 */
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaClientExceptionFilter implements ExceptionFilter {
  catch(exception: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();
    
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'A database error occurred.';

    // Map Prisma error codes to safe user-facing messages
    switch (exception.code) {
      case 'P2002':
        status = HttpStatus.CONFLICT;
        message = 'A record with this data already exists.';
        break;
      case 'P2025':
        status = HttpStatus.NOT_FOUND;
        message = 'The requested record was not found.';
        break;
      case 'P2003':
        status = HttpStatus.BAD_REQUEST;
        message = 'This operation references a record that does not exist.';
        break;
      case 'P2014':
        status = HttpStatus.BAD_REQUEST;
        message = 'This operation violates a data relationship constraint.';
        break;
      default:
        if (exception.code.startsWith('P2')) {
          status = HttpStatus.BAD_REQUEST;
          message = 'The request contains invalid data.';
        }
        break;
    }

    // Log full error internally for debugging (never exposed to client)
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'DB_ERROR',
      requestId: (request as any).requestId || 'N/A',
      prismaCode: exception.code,
      prismaMessage: exception.message,
      prismaMeta: exception.meta,
    }));

    response.status(status).json({
      statusCode: status,
      message,
      timestamp: new Date().toISOString(),
    });
  }
}
