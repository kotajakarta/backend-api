import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Request, Inject } from '@nestjs/common';
import { FaqService } from './faq.service.js';
import { AccessControlGuard } from '../../common/guards/access-control.guard.js';

@Controller('faq')
export class FaqController {
  constructor(@Inject(FaqService) private readonly faqService: FaqService) {}

  @Get()
  @UseGuards(AccessControlGuard)
  async getAll() {
    return this.faqService.getAll();
  }

  @Post()
  @UseGuards(AccessControlGuard)
  async createFaq(@Body() body: { question: string, answer: string }, @Request() req: any) {
    return this.faqService.createFaq(body, req.user);
  }

  @Put(':id')
  @UseGuards(AccessControlGuard)
  async updateFaq(@Param('id') id: string, @Body() body: { question?: string, answer?: string }, @Request() req: any) {
    return this.faqService.updateFaq(id, body, req.user);
  }

  @Delete(':id')
  @UseGuards(AccessControlGuard)
  async deleteFaq(@Param('id') id: string, @Request() req: any) {
    return this.faqService.deleteFaq(id, req.user);
  }
}
