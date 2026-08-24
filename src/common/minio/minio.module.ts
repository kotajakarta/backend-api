import { Module, Global } from '@nestjs/common';
import { MinioService } from './minio.service.js';

@Global()
@Module({
  providers: [MinioService],
  exports: [MinioService],
})
export class MinioModule {}
