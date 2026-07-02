import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';

@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaClientExceptionFilter implements ExceptionFilter {
  catch(exception: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    if (exception.code === 'P2002') status = HttpStatus.CONFLICT;
    else if (exception.code === 'P2025') status = HttpStatus.NOT_FOUND;
    else if (exception.code.startsWith('P2')) status = HttpStatus.BAD_REQUEST;

    response.status(status).json({
      statusCode: status,
      message: `Database error: ${exception.code} - ${exception.message}`,
      code: exception.code,
      meta: exception.meta,
      details: exception.message,
    });
  }
}
