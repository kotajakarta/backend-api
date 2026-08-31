import { Controller, Get, Param, Query, UseGuards, Inject } from '@nestjs/common';
import { PesantrenExternalService, StudentFilterDto } from './pesantren-external.service.js';
import { ApiKeyGuard } from './api-key.guard.js';

@Controller('external/pesantren')
@UseGuards(ApiKeyGuard)
export class PesantrenExternalController {
  constructor(
    @Inject(PesantrenExternalService)
    private readonly pesantrenService: PesantrenExternalService
  ) {}

  @Get('health')
  healthCheck() {
    return this.pesantrenService.ping();
  }

  @Get('students')
  getStudents(@Query() query: StudentFilterDto) {
    return this.pesantrenService.getStudents(query);
  }

  @Get('students/:id')
  getStudentById(@Param('id') id: string) {
    return this.pesantrenService.getStudentById(id);
  }

  @Get('cabang')
  getCabangList() {
    return this.pesantrenService.getCabangList();
  }

  @Get('grup-daimi')
  getGrupDaimiList() {
    return this.pesantrenService.getGrupDaimiList();
  }
}
