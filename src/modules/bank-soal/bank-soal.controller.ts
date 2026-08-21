import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Res,
  Req,
} from '@nestjs/common';
import { Response } from 'express';
import { BankSoalService } from './services/bank-soal.service.js';
import { DocxExportService } from './services/docx-export.service.js';
import { CreateQuestionBankDto } from './dto/create-question-bank.dto.js';
import { UpdateQuestionBankDto } from './dto/update-question-bank.dto.js';
import { CreateQuestionItemDto } from './dto/create-question-item.dto.js';
import { UpdateQuestionItemDto } from './dto/update-question-item.dto.js';
import { ReorderQuestionsDto } from './dto/reorder-questions.dto.js';

@Controller('bank-soal')
export class BankSoalController {
  constructor(
    private readonly bankService: BankSoalService,
    private readonly docxService: DocxExportService,
  ) {}

  @Get()
  async getQuestionBanks(
    @Req() req: any,
    @Query('search') search?: string,
    @Query('subject') subject?: string,
    @Query('gradeLevel') gradeLevel?: string,
    @Query('cabangId') cabangId?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('onlyMine') onlyMine?: string,
  ) {
    const user = req.user;
    return this.bankService.getQuestionBanks(user, {
      search,
      subject,
      gradeLevel,
      cabangId,
      page,
      limit,
      onlyMine: onlyMine === 'true',
    });
  }

  @Get('filters')
  async getFilterOptions(@Req() req: any) {
    return this.bankService.getFilterOptions(req.user);
  }

  @Post()
  async createQuestionBank(@Req() req: any, @Body() dto: CreateQuestionBankDto) {
    return this.bankService.createQuestionBank(dto, req.user);
  }

  @Get(':id')
  async getQuestionBankDetail(@Req() req: any, @Param('id') id: string) {
    return this.bankService.getQuestionBankDetail(id, req.user);
  }

  @Put(':id')
  async updateQuestionBank(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateQuestionBankDto,
  ) {
    return this.bankService.updateQuestionBank(id, dto, req.user);
  }

  @Delete(':id')
  async deleteQuestionBank(@Req() req: any, @Param('id') id: string) {
    return this.bankService.deleteQuestionBank(id, req.user);
  }

  @Post(':id/duplicate')
  async duplicateQuestionBank(@Req() req: any, @Param('id') id: string) {
    return this.bankService.duplicateQuestionBank(id, req.user);
  }

  // ================= BUTIR SOAL ENDPOINTS =================

  @Post(':id/questions')
  async createQuestionItem(
    @Req() req: any,
    @Param('id') bankId: string,
    @Body() dto: CreateQuestionItemDto,
  ) {
    return this.bankService.createQuestionItem(bankId, dto, req.user);
  }

  @Put(':id/questions/:qId')
  async updateQuestionItem(
    @Req() req: any,
    @Param('id') bankId: string,
    @Param('qId') qId: string,
    @Body() dto: UpdateQuestionItemDto,
  ) {
    return this.bankService.updateQuestionItem(bankId, qId, dto, req.user);
  }

  @Delete(':id/questions/:qId')
  async deleteQuestionItem(
    @Req() req: any,
    @Param('id') bankId: string,
    @Param('qId') qId: string,
  ) {
    return this.bankService.deleteQuestionItem(bankId, qId, req.user);
  }

  @Post(':id/reorder')
  async reorderQuestions(
    @Req() req: any,
    @Param('id') bankId: string,
    @Body() dto: ReorderQuestionsDto,
  ) {
    return this.bankService.reorderQuestions(bankId, dto, req.user);
  }

  // ================= DOCX EXPORT STREAMING =================

  @Get(':id/export-docx')
  async exportDocx(
    @Req() req: any,
    @Param('id') id: string,
    @Query('includeKey') includeKey: string,
    @Res() res: Response,
  ) {
    const bank = await this.bankService.getQuestionBankDetail(id, req.user);
    const buffer = await this.docxService.generateDocxBuffer(bank, includeKey === 'true');

    const cleanTitle = (bank.title || 'Soal_Ujian').replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `${cleanTitle}_${bank.gradeLevel || 'Kelas'}.docx`;

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.end(buffer);
  }
}
