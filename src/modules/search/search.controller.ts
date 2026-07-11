import { Controller, Get, Query, UseGuards, Request, Inject } from '@nestjs/common';
import { SearchService } from './search.service.js';
import { AccessControlGuard } from '../../common/guards/access-control.guard.js';

@Controller('search')
export class SearchController {
  constructor(@Inject(SearchService) private readonly searchService: SearchService) {}

  @Get()
  @UseGuards(AccessControlGuard)
  async globalSearch(@Query('q') q: string, @Request() req: any) {
    return this.searchService.searchAll(q, req.user);
  }
}
