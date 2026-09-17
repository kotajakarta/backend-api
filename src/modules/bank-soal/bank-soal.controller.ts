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
  UseGuards,
  Inject,
} from '@nestjs/common';
import { Response } from 'express';
import { AccessControlGuard } from '../../common/guards/access-control.guard.js';
import { AllowCookieAuth } from '../../common/decorators/access-control.decorator.js';
import { BankSoalService } from './services/bank-soal.service.js';
import { DocxExportService } from './services/docx-export.service.js';
import { CreateQuestionBankDto } from './dto/create-question-bank.dto.js';
import { UpdateQuestionBankDto } from './dto/update-question-bank.dto.js';
import { CreateQuestionItemDto } from './dto/create-question-item.dto.js';
import { UpdateQuestionItemDto } from './dto/update-question-item.dto.js';
import { ReorderQuestionsDto } from './dto/reorder-questions.dto.js';
import { CreateProjectDto, CreateAssignmentItemDto } from './dto/create-project.dto.js';
import { UpdateProjectDto } from './dto/update-project.dto.js';
import { UpdateAssignmentDto, ReviewAssignmentDto } from './dto/update-assignment.dto.js';
import { DelegateAssignmentDto } from './dto/delegate-assignment.dto.js';
import { BatchCreateQuestionsDto } from './dto/batch-create-questions.dto.js';
import { AssignmentStatus } from '@prisma/client';

@Controller('bank-soal')
@UseGuards(AccessControlGuard)
export class BankSoalController {
  constructor(
    @Inject(BankSoalService) private readonly bankService: BankSoalService,
    @Inject(DocxExportService) private readonly docxService: DocxExportService,
  ) {}

  // ================= METADATA & FILTERS (STATIC ROUTES FIRST) =================

  @Get('metadata/formal')
  async getFormalMetadata() {
    return this.bankService.getFormalMetadata();
  }

  @Get('metadata/hierarchy')
  async getBranchesAndTeachers(
    @Query('wilayahId') wilayahId?: string,
    @Query('cabangId') cabangId?: string,
  ) {
    return this.bankService.getBranchesAndTeachers(wilayahId, cabangId);
  }

  @Get('filters')
  async getFilterOptions(@Req() req: any) {
    return this.bankService.getFilterOptions(req.user);
  }

  // ================= PROYEK & PENUGASAN (STATIC ROUTES FIRST) =================

  @Get('projects/list')
  async getProjects(@Req() req: any) {
    return this.bankService.getProjects(req.user);
  }

  @Get('projects/:id')
  async getProjectDetail(@Param('id') id: string) {
    return this.bankService.getProjectDetail(id);
  }

  @Post('projects')
  async createProject(@Req() req: any, @Body() dto: CreateProjectDto) {
    return this.bankService.createProject(dto, req.user);
  }

  @Put('projects/:id')
  async updateProject(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateProjectDto,
  ) {
    return this.bankService.updateProject(id, dto, req.user);
  }

  @Post('projects/:id/assignments')
  async addAssignmentToProject(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: CreateAssignmentItemDto,
  ) {
    return this.bankService.addAssignmentToProject(id, dto, req.user);
  }

  @Delete('projects/:id')
  async deleteProject(@Req() req: any, @Param('id') id: string) {
    return this.bankService.deleteProject(id, req.user);
  }

  @Get('assignments/list')
  async getAssignments(
    @Req() req: any,
    @Query('projectId') projectId?: string,
    @Query('status') status?: AssignmentStatus,
    @Query('onlyMine') onlyMine?: string,
  ) {
    return this.bankService.getAssignments(req.user, {
      projectId,
      status,
      onlyMine: onlyMine === 'true',
    });
  }

  @Put('assignments/:id/delegate')
  async delegateAssignment(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: DelegateAssignmentDto,
  ) {
    return this.bankService.delegateAssignment(id, dto, req.user);
  }

  @Put('assignments/:id')
  async updateAssignment(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateAssignmentDto,
  ) {
    return this.bankService.updateAssignment(id, dto, req.user);
  }

  @Delete('assignments/:id')
  async deleteAssignment(@Req() req: any, @Param('id') id: string) {
    return this.bankService.deleteAssignment(id, req.user);
  }

  @Post('assignments/:id/review')
  async reviewAssignment(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: ReviewAssignmentDto,
  ) {
    return this.bankService.reviewAssignment(id, dto.action, dto.notes, req.user);
  }

  // ================= BANK SOAL (ROOT ROUTES) =================

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
    @Query('isOfficial') isOfficial?: string,
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
      isOfficial: isOfficial !== undefined ? isOfficial === 'true' : undefined,
    });
  }

  @Post()
  async createQuestionBank(
    @Req() req: any,
    @Body() dto: CreateQuestionBankDto & { assignmentId?: string },
  ) {
    return this.bankService.createQuestionBank(dto, req.user);
  }

  // ================= DYNAMIC PARAMETER ROUTES (:id) =================

  @Get(':id/export-docx')
  @AllowCookieAuth()
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

  @Post(':id/duplicate')
  async duplicateQuestionBank(@Req() req: any, @Param('id') id: string) {
    return this.bankService.duplicateQuestionBank(id, req.user);
  }

  @Post(':id/reorder')
  async reorderQuestions(
    @Req() req: any,
    @Param('id') bankId: string,
    @Body() dto: ReorderQuestionsDto,
  ) {
    return this.bankService.reorderQuestions(bankId, dto, req.user);
  }

  @Post(':id/questions')
  async createQuestionItem(
    @Req() req: any,
    @Param('id') bankId: string,
    @Body() dto: CreateQuestionItemDto,
  ) {
    return this.bankService.createQuestionItem(bankId, dto, req.user);
  }

  @Post(':id/questions/batch')
  async createBatchQuestions(
    @Req() req: any,
    @Param('id') bankId: string,
    @Body() dto: BatchCreateQuestionsDto,
  ) {
    return this.bankService.createBatchQuestions(bankId, dto, req.user);
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

  @Post(':id/set-official')
  async setOfficialQuestionBank(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body?: { isOfficial?: boolean },
  ) {
    const isOfficial = body?.isOfficial !== undefined ? body.isOfficial : true;
    return this.bankService.setOfficialQuestionBank(id, req.user, isOfficial);
  }

  @Post(':id/transfer-project')
  async transferBankSoalToProject(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: { targetProjectId: string; targetAssignmentId?: string },
  ) {
    return this.bankService.transferBankSoalToProject(id, dto, req.user);
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
}
