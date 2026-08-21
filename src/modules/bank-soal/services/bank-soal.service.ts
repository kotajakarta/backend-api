import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service.js';
import { CreateQuestionBankDto } from '../dto/create-question-bank.dto.js';
import { UpdateQuestionBankDto } from '../dto/update-question-bank.dto.js';
import { CreateQuestionItemDto, QuestionOptionDto } from '../dto/create-question-item.dto.js';
import { UpdateQuestionItemDto } from '../dto/update-question-item.dto.js';
import { ReorderQuestionsDto } from '../dto/reorder-questions.dto.js';
import { CreateProjectDto } from '../dto/create-project.dto.js';
import { DelegateAssignmentDto } from '../dto/delegate-assignment.dto.js';
import { QuestionType, AssignmentStatus, ProjectStatus } from '@prisma/client';

@Injectable()
export class BankSoalService {
  constructor(private prisma: PrismaService) {}

  /**
   * Cek apakah user memiliki hak akses membaca Bank Soal
   */
  private checkReadAccess(bank: any, user: any) {
    if (!user) return;
    if (user.scope === 'GLOBAL') return;
    if (user.scope === 'WILAYAH' && bank.cabang?.wilayahId === user.wilayahId) return;
    if (bank.isShared) return;
    if (bank.teacherId === user.id) return;
    if (user.cabangId && bank.cabangId === user.cabangId) return;
    throw new ForbiddenException('Anda tidak memiliki akses membaca Bank Soal ini.');
  }

  /**
   * Cek apakah user memiliki hak akses mengedit/menghapus Bank Soal
   */
  private checkWriteAccess(bank: any, user: any) {
    if (!user) return;
    if (user.scope === 'GLOBAL') return;
    if (bank.teacherId === user.id) return;
    if (user.scope === 'CABANG' && user.cabangId && bank.cabangId === user.cabangId && user.divisi === 'ALL') return;
    throw new ForbiddenException('Akses ditolak: Anda bukan pembuat Bank Soal ini.');
  }

  async getQuestionBanks(
    user: any,
    query: {
      search?: string;
      subject?: string;
      gradeLevel?: string;
      cabangId?: string;
      page?: number;
      limit?: number;
      onlyMine?: boolean;
    },
  ) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 10));
    const skip = (page - 1) * limit;

    const where: any = {};

    // Filter Search
    if (query.search) {
      where.OR = [
        { title: { contains: query.search, mode: 'insensitive' } },
        { subject: { contains: query.search, mode: 'insensitive' } },
        { institution: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    if (query.subject) {
      where.subject = query.subject;
    }

    if (query.gradeLevel) {
      where.gradeLevel = query.gradeLevel;
    }

    // Filter RBAC / Scope
    if (query.onlyMine && user?.id) {
      where.teacherId = user.id;
    } else if (user?.scope === 'CABANG' && user.cabangId) {
      where.OR = [
        { cabangId: user.cabangId },
        { teacherId: user.id },
        { isShared: true },
      ];
    } else if (user?.scope === 'WILAYAH' && user.wilayahId) {
      where.OR = [
        { cabang: { wilayahId: user.wilayahId } },
        { teacherId: user.id },
        { isShared: true },
      ];
    } else if (query.cabangId) {
      where.cabangId = query.cabangId;
    }

    const [total, items] = await Promise.all([
      this.prisma.questionBank.count({ where }),
      this.prisma.questionBank.findMany({
        where,
        skip,
        take: limit,
        orderBy: { updatedAt: 'desc' },
        include: {
          teacher: {
            select: { id: true, username: true, operatorName: true },
          },
          cabang: {
            select: { id: true, name: true },
          },
          assignment: {
            select: {
              id: true,
              project: { select: { id: true, title: true } },
              status: true,
            },
          },
          _count: {
            select: { questions: true },
          },
        },
      }),
    ]);

    return {
      data: items,
      pagination: {
        page,
        limit,
        totalItems: total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getQuestionBankDetail(id: string, user: any) {
    const bank = await this.prisma.questionBank.findUnique({
      where: { id },
      include: {
        teacher: {
          select: { id: true, username: true, operatorName: true },
        },
        cabang: {
          select: { id: true, name: true, wilayahId: true },
        },
        assignment: {
          select: {
            id: true,
            projectId: true,
            project: { select: { id: true, title: true, deadline: true } },
            targetMcqCount: true,
            targetEssayCount: true,
            status: true,
          },
        },
        questions: {
          orderBy: { orderIndex: 'asc' },
          include: {
            options: {
              orderBy: { orderIndex: 'asc' },
            },
          },
        },
      },
    });

    if (!bank) throw new NotFoundException('Bank Soal tidak ditemukan.');
    this.checkReadAccess(bank, user);
    return bank;
  }

  async createQuestionBank(dto: CreateQuestionBankDto & { assignmentId?: string }, user: any) {
    const teacherId = user?.id;
    if (!teacherId) throw new BadRequestException('ID Pengguna tidak valid.');

    return this.prisma.$transaction(async (tx) => {
      const bank = await tx.questionBank.create({
        data: {
          title: dto.title,
          subject: dto.subject,
          gradeLevel: dto.gradeLevel,
          timeLimit: dto.timeLimit || null,
          institution: dto.institution || null,
          academicYear: dto.academicYear || null,
          semester: dto.semester || null,
          instructions: dto.instructions || null,
          isShared: dto.isShared ?? false,
          teacherId,
          cabangId: user?.cabangId || null,
        },
        include: {
          teacher: { select: { id: true, username: true, operatorName: true } },
          cabang: { select: { id: true, name: true } },
        },
      });

      // If created from an assignment, link it and update status to DALAM_PROSES
      if (dto.assignmentId) {
        await tx.bankSoalAssignment.update({
          where: { id: dto.assignmentId },
          data: {
            questionBankId: bank.id,
            status: AssignmentStatus.DALAM_PROSES,
            teacherId: user.id,
            cabangId: user.cabangId || undefined,
          },
        });
      }

      return bank;
    });
  }

  async updateQuestionBank(id: string, dto: UpdateQuestionBankDto, user: any) {
    const bank = await this.prisma.questionBank.findUnique({ where: { id } });
    if (!bank) throw new NotFoundException('Bank Soal tidak ditemukan.');
    this.checkWriteAccess(bank, user);

    return this.prisma.questionBank.update({
      where: { id },
      data: {
        title: dto.title,
        subject: dto.subject,
        gradeLevel: dto.gradeLevel,
        timeLimit: dto.timeLimit !== undefined ? dto.timeLimit : bank.timeLimit,
        institution: dto.institution !== undefined ? dto.institution : bank.institution,
        academicYear: dto.academicYear !== undefined ? dto.academicYear : bank.academicYear,
        semester: dto.semester !== undefined ? dto.semester : bank.semester,
        instructions: dto.instructions !== undefined ? dto.instructions : bank.instructions,
        isShared: dto.isShared !== undefined ? dto.isShared : bank.isShared,
      },
      include: {
        teacher: { select: { id: true, username: true, operatorName: true } },
        cabang: { select: { id: true, name: true } },
      },
    });
  }

  async deleteQuestionBank(id: string, user: any) {
    const bank = await this.prisma.questionBank.findUnique({ where: { id } });
    if (!bank) throw new NotFoundException('Bank Soal tidak ditemukan.');
    this.checkWriteAccess(bank, user);

    await this.prisma.questionBank.delete({ where: { id } });
    return { success: true, message: 'Bank Soal berhasil dihapus.' };
  }

  async duplicateQuestionBank(id: string, user: any) {
    const sourceBank = await this.prisma.questionBank.findUnique({
      where: { id },
      include: {
        questions: {
          orderBy: { orderIndex: 'asc' },
          include: {
            options: { orderBy: { orderIndex: 'asc' } },
          },
        },
      },
    });

    if (!sourceBank) throw new NotFoundException('Bank Soal sumber tidak ditemukan.');
    this.checkReadAccess(sourceBank, user);

    return this.prisma.$transaction(async (tx) => {
      // 1. Clone QuestionBank
      const newBank = await tx.questionBank.create({
        data: {
          title: `[Salinan] ${sourceBank.title}`,
          subject: sourceBank.subject,
          gradeLevel: sourceBank.gradeLevel,
          timeLimit: sourceBank.timeLimit,
          institution: sourceBank.institution,
          academicYear: sourceBank.academicYear,
          semester: sourceBank.semester,
          instructions: sourceBank.instructions,
          isShared: false,
          teacherId: user.id,
          cabangId: user.cabangId || sourceBank.cabangId,
        },
      });

      // 2. Clone Questions & Options
      for (const q of sourceBank.questions) {
        const newQ = await tx.questionItem.create({
          data: {
            questionBankId: newBank.id,
            type: q.type,
            contentHtml: q.contentHtml,
            answerKey: q.answerKey,
            orderIndex: q.orderIndex,
            weight: q.weight,
          },
        });

        if (q.options && q.options.length > 0) {
          await tx.questionOption.createMany({
            data: q.options.map((opt) => ({
              questionItemId: newQ.id,
              label: opt.label,
              contentHtml: opt.contentHtml,
              isCorrect: opt.isCorrect,
              orderIndex: opt.orderIndex,
            })),
          });
        }
      }

      return tx.questionBank.findUnique({
        where: { id: newBank.id },
        include: {
          _count: { select: { questions: true } },
          teacher: { select: { id: true, username: true, operatorName: true } },
        },
      });
    });
  }

  // ================= BUTIR SOAL (QUESTION ITEMS) =================

  async createQuestionItem(bankId: string, dto: CreateQuestionItemDto, user: any) {
    const bank = await this.prisma.questionBank.findUnique({ where: { id: bankId } });
    if (!bank) throw new NotFoundException('Bank Soal tidak ditemukan.');
    this.checkWriteAccess(bank, user);

    const count = await this.prisma.questionItem.count({ where: { questionBankId: bankId } });

    let finalOptions: QuestionOptionDto[] = [];
    if (dto.type === QuestionType.MCQ_4) {
      finalOptions = (dto.options || []).slice(0, 4);
    } else if (dto.type === QuestionType.MCQ_5) {
      finalOptions = (dto.options || []).slice(0, 5);
    } else if (dto.type === QuestionType.COMPLEX_MC || dto.type === QuestionType.TRUE_FALSE) {
      finalOptions = dto.options || [];
    }

    return this.prisma.$transaction(async (tx) => {
      const item = await tx.questionItem.create({
        data: {
          questionBankId: bankId,
          type: dto.type,
          contentHtml: dto.contentHtml,
          answerKey: dto.answerKey || null,
          weight: dto.weight ?? 1,
          orderIndex: count,
        },
      });

      if (dto.type !== QuestionType.ESSAY && finalOptions.length > 0) {
        await tx.questionOption.createMany({
          data: finalOptions.map((opt, idx) => ({
            questionItemId: item.id,
            label: opt.label || String.fromCharCode(65 + idx),
            contentHtml: opt.contentHtml || '',
            isCorrect: opt.isCorrect ?? false,
            orderIndex: opt.orderIndex !== undefined ? opt.orderIndex : idx,
          })),
        });
      }

      // Update questionBank updated_at
      await tx.questionBank.update({
        where: { id: bankId },
        data: { updatedAt: new Date() },
      });

      return tx.questionItem.findUnique({
        where: { id: item.id },
        include: {
          options: { orderBy: { orderIndex: 'asc' } },
        },
      });
    });
  }

  async updateQuestionItem(bankId: string, questionId: string, dto: UpdateQuestionItemDto, user: any) {
    const bank = await this.prisma.questionBank.findUnique({ where: { id: bankId } });
    if (!bank) throw new NotFoundException('Bank Soal tidak ditemukan.');
    this.checkWriteAccess(bank, user);

    const existingItem = await this.prisma.questionItem.findUnique({
      where: { id: questionId },
      include: { options: true },
    });
    if (!existingItem || existingItem.questionBankId !== bankId) {
      throw new NotFoundException('Butir soal tidak ditemukan pada paket ini.');
    }

    let finalOptions: QuestionOptionDto[] = [];
    const targetType = dto.type || existingItem.type;
    if (targetType === QuestionType.MCQ_4) {
      finalOptions = (dto.options || []).slice(0, 4);
    } else if (targetType === QuestionType.MCQ_5) {
      finalOptions = (dto.options || []).slice(0, 5);
    } else if (targetType === QuestionType.COMPLEX_MC || targetType === QuestionType.TRUE_FALSE) {
      finalOptions = dto.options || [];
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.questionItem.update({
        where: { id: questionId },
        data: {
          type: targetType,
          contentHtml: dto.contentHtml !== undefined ? dto.contentHtml : existingItem.contentHtml,
          answerKey: dto.answerKey !== undefined ? dto.answerKey : existingItem.answerKey,
          weight: dto.weight !== undefined ? dto.weight : existingItem.weight,
        },
      });

      // Update Options: delete old and recreate cleanly
      await tx.questionOption.deleteMany({
        where: { questionItemId: questionId },
      });

      if (targetType !== QuestionType.ESSAY && finalOptions.length > 0) {
        await tx.questionOption.createMany({
          data: finalOptions.map((opt, idx) => ({
            questionItemId: questionId,
            label: opt.label || String.fromCharCode(65 + idx),
            contentHtml: opt.contentHtml || '',
            isCorrect: opt.isCorrect ?? false,
            orderIndex: opt.orderIndex !== undefined ? opt.orderIndex : idx,
          })),
        });
      }

      await tx.questionBank.update({
        where: { id: bankId },
        data: { updatedAt: new Date() },
      });

      return tx.questionItem.findUnique({
        where: { id: questionId },
        include: {
          options: { orderBy: { orderIndex: 'asc' } },
        },
      });
    });
  }

  async deleteQuestionItem(bankId: string, questionId: string, user: any) {
    const bank = await this.prisma.questionBank.findUnique({ where: { id: bankId } });
    if (!bank) throw new NotFoundException('Bank Soal tidak ditemukan.');
    this.checkWriteAccess(bank, user);

    await this.prisma.questionItem.delete({
      where: { id: questionId },
    });

    // Re-normalize orderIndex for remaining questions
    const remaining = await this.prisma.questionItem.findMany({
      where: { questionBankId: bankId },
      orderBy: { orderIndex: 'asc' },
    });

    await this.prisma.$transaction(
      remaining.map((q, idx) =>
        this.prisma.questionItem.update({
          where: { id: q.id },
          data: { orderIndex: idx },
        }),
      ),
    );

    return { success: true, message: 'Butir soal berhasil dihapus.' };
  }

  async reorderQuestions(bankId: string, dto: ReorderQuestionsDto, user: any) {
    const bank = await this.prisma.questionBank.findUnique({ where: { id: bankId } });
    if (!bank) throw new NotFoundException('Bank Soal tidak ditemukan.');
    this.checkWriteAccess(bank, user);

    await this.prisma.$transaction(
      dto.questionIds.map((qId, index) =>
        this.prisma.questionItem.update({
          where: { id: qId },
          data: { orderIndex: index },
        }),
      ),
    );

    return { success: true, message: 'Urutan butir soal berhasil diperbarui.' };
  }

  // ================= PROYEK & PENUGASAN (TASK ASSIGNMENT) =================

  async getProjects(user: any) {
    const projects = await this.prisma.bankSoalProject.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        createdBy: {
          select: { id: true, username: true, operatorName: true },
        },
        assignments: {
          include: {
            wilayah: { select: { id: true, name: true } },
            cabang: { select: { id: true, name: true } },
            teacher: { select: { id: true, username: true, operatorName: true } },
            questionBank: {
              select: {
                id: true,
                title: true,
                _count: { select: { questions: true } },
              },
            },
          },
        },
      },
    });

    return projects.map((p) => {
      const total = p.assignments.length;
      const completed = p.assignments.filter(
        (a) => a.status === AssignmentStatus.SELESAI || a.status === AssignmentStatus.DISETUJUI,
      ).length;
      const inProgress = p.assignments.filter((a) => a.status === AssignmentStatus.DALAM_PROSES).length;

      return {
        ...p,
        stats: {
          total,
          completed,
          inProgress,
          pending: total - completed - inProgress,
          percentage: total > 0 ? Math.round((completed / total) * 100) : 0,
        },
      };
    });
  }

  async getProjectDetail(id: string) {
    const project = await this.prisma.bankSoalProject.findUnique({
      where: { id },
      include: {
        createdBy: {
          select: { id: true, username: true, operatorName: true },
        },
        assignments: {
          orderBy: [{ subjectName: 'asc' }, { gradeLevel: 'asc' }],
          include: {
            wilayah: { select: { id: true, name: true } },
            cabang: { select: { id: true, name: true } },
            teacher: { select: { id: true, username: true, operatorName: true } },
            questionBank: {
              select: {
                id: true,
                title: true,
                updatedAt: true,
                _count: { select: { questions: true } },
              },
            },
          },
        },
      },
    });

    if (!project) throw new NotFoundException('Proyek Bank Soal tidak ditemukan.');
    return project;
  }

  async createProject(dto: CreateProjectDto, user: any) {
    if (user?.scope !== 'GLOBAL') {
      throw new ForbiddenException('Hanya Admin Global yang dapat membuat proyek penugasan bank soal.');
    }

    return this.prisma.$transaction(async (tx) => {
      const project = await tx.bankSoalProject.create({
        data: {
          title: dto.title,
          description: dto.description || null,
          academicYear: dto.academicYear || null,
          semester: dto.semester || null,
          deadline: dto.deadline ? new Date(dto.deadline) : null,
          createdById: user.id,
        },
      });

      if (dto.assignments && dto.assignments.length > 0) {
        await tx.bankSoalAssignment.createMany({
          data: dto.assignments.map((item) => ({
            projectId: project.id,
            subjectId: item.subjectId || null,
            subjectName: item.subjectName,
            gradeLevel: item.gradeLevel,
            targetMcqCount: item.targetMcqCount ?? 40,
            targetEssayCount: item.targetEssayCount ?? 5,
            timeLimit: item.timeLimit || null,
            instructions: item.instructions || null,
            wilayahId: item.wilayahId || null,
            cabangId: item.cabangId || null,
            teacherId: item.teacherId || null,
            status: item.teacherId
              ? AssignmentStatus.DITUGASKAN
              : item.cabangId
              ? AssignmentStatus.MENUNGGU_PENUGASAN_GURU
              : AssignmentStatus.MENUNGGU_DELEGASI_CABANG,
          })),
        });
      }

      return tx.bankSoalProject.findUnique({
        where: { id: project.id },
        include: { assignments: true },
      });
    });
  }

  async deleteProject(id: string, user: any) {
    if (user?.scope !== 'GLOBAL') {
      throw new ForbiddenException('Hanya Admin Global yang dapat menghapus proyek.');
    }
    await this.prisma.bankSoalProject.delete({ where: { id } });
    return { success: true, message: 'Proyek berhasil dihapus.' };
  }

  async getAssignments(
    user: any,
    query: {
      projectId?: string;
      status?: AssignmentStatus;
      onlyMine?: boolean;
    },
  ) {
    const where: any = {};

    if (query.projectId) {
      where.projectId = query.projectId;
    }

    if (query.status) {
      where.status = query.status;
    }

    // Role-based filtering
    if (query.onlyMine || user?.scope === 'GURU') {
      where.teacherId = user?.id;
    } else if (user?.scope === 'CABANG' && user.cabangId) {
      where.OR = [
        { cabangId: user.cabangId },
        { teacherId: user.id },
      ];
    } else if (user?.scope === 'WILAYAH' && user.wilayahId) {
      where.OR = [
        { wilayahId: user.wilayahId },
        { cabang: { wilayahId: user.wilayahId } },
      ];
    }

    return this.prisma.bankSoalAssignment.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
      include: {
        project: {
          select: { id: true, title: true, deadline: true, academicYear: true, semester: true },
        },
        wilayah: { select: { id: true, name: true } },
        cabang: { select: { id: true, name: true } },
        teacher: { select: { id: true, username: true, operatorName: true } },
        questionBank: {
          select: {
            id: true,
            title: true,
            updatedAt: true,
            _count: { select: { questions: true } },
          },
        },
      },
    });
  }

  async delegateAssignment(assignmentId: string, dto: DelegateAssignmentDto, user: any) {
    const assignment = await this.prisma.bankSoalAssignment.findUnique({
      where: { id: assignmentId },
      include: { cabang: true },
    });

    if (!assignment) throw new NotFoundException('Penugasan tidak ditemukan.');

    const updateData: any = {};

    // 1. Admin Global -> Delegasi ke Wilayah
    if (user?.scope === 'GLOBAL') {
      if (dto.wilayahId !== undefined) updateData.wilayahId = dto.wilayahId;
      if (dto.cabangId !== undefined) updateData.cabangId = dto.cabangId;
      if (dto.teacherId !== undefined) updateData.teacherId = dto.teacherId;
      if (dto.status !== undefined) updateData.status = dto.status;
      if (dto.notes !== undefined) updateData.notes = dto.notes;
    }
    // 2. Admin Wilayah -> Delegasi ke Cabang
    else if (user?.scope === 'WILAYAH') {
      if (assignment.wilayahId && assignment.wilayahId !== user.wilayahId) {
        throw new ForbiddenException('Tugas ini tidak berada di wilayah Anda.');
      }
      if (dto.cabangId) {
        updateData.cabangId = dto.cabangId;
        updateData.status = AssignmentStatus.MENUNGGU_PENUGASAN_GURU;
      }
      if (dto.notes !== undefined) updateData.notes = dto.notes;
    }
    // 3. Admin Cabang -> Delegasi ke Guru
    else if (user?.scope === 'CABANG') {
      if (assignment.cabangId && assignment.cabangId !== user.cabangId) {
        throw new ForbiddenException('Tugas ini tidak berada di cabang Anda.');
      }
      if (dto.teacherId) {
        updateData.teacherId = dto.teacherId;
        updateData.status = AssignmentStatus.DITUGASKAN;
      }
      if (dto.status) updateData.status = dto.status;
      if (dto.notes !== undefined) updateData.notes = dto.notes;
    }
    // 4. Guru -> Perbarui Status / Tautkan Bank Soal
    else if (assignment.teacherId === user.id) {
      if (dto.status) updateData.status = dto.status;
      if (dto.questionBankId) updateData.questionBankId = dto.questionBankId;
    }

    if (dto.questionBankId) {
      updateData.questionBankId = dto.questionBankId;
    }

    return this.prisma.bankSoalAssignment.update({
      where: { id: assignmentId },
      data: updateData,
      include: {
        project: { select: { id: true, title: true } },
        wilayah: { select: { id: true, name: true } },
        cabang: { select: { id: true, name: true } },
        teacher: { select: { id: true, username: true, operatorName: true } },
        questionBank: { select: { id: true, title: true } },
      },
    });
  }

  // ================= METADATA FORMAL (MAPEL & TINGKAT) =================

  async getFormalMetadata() {
    const [mapels, kelases] = await Promise.all([
      this.prisma.mataPelajaran.findMany({
        where: { isActive: true },
        select: { id: true, name: true, kodeMapel: true, grupMapel: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.kelas.findMany({
        where: { isActive: true },
        select: { tingkat: true },
        distinct: ['tingkat'],
      }),
    ]);

    // Unique levels from DB and defaults
    const rawLevels = kelases.map((k) => k.tingkat).filter(Boolean) as string[];
    const defaultLevels = [
      'Kelas 1',
      'Kelas 2',
      'Kelas 3',
      'Kelas 4',
      'Kelas 5',
      'Kelas 6',
      'Kelas 7',
      'Kelas 8',
      'Kelas 9',
      'Kelas 10',
      'Kelas 11',
      'Kelas 12',
      'Ula 1',
      'Ula 2',
      'Wustha 1',
      'Wustha 2',
      'Wustha 3',
      'Ulya 1',
      'Ulya 2',
      'Ulya 3',
    ];

    const uniqueGradeLevels = Array.from(new Set([...rawLevels, ...defaultLevels])).sort();

    return {
      subjects: mapels,
      gradeLevels: uniqueGradeLevels,
    };
  }

  async getBranchesAndTeachers(wilayahId?: string, cabangId?: string) {
    const [branches, teachers] = await Promise.all([
      this.prisma.cabang.findMany({
        where: wilayahId ? { wilayahId } : undefined,
        select: { id: true, name: true, wilayahId: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.user.findMany({
        where: {
          cabangId: cabangId || undefined,
          isApproved: true,
        },
        select: {
          id: true,
          username: true,
          operatorName: true,
          cabangId: true,
        },
        orderBy: { operatorName: 'asc' },
      }),
    ]);

    const wilayahList = await this.prisma.wilayah.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });

    return {
      wilayahList,
      branches,
      teachers,
    };
  }

  async getFilterOptions(user: any) {
    const where: any = {};
    if (user?.scope === 'CABANG' && user.cabangId) {
      where.OR = [{ cabangId: user.cabangId }, { teacherId: user.id }, { isShared: true }];
    } else if (user?.scope === 'WILAYAH' && user.wilayahId) {
      where.OR = [{ cabang: { wilayahId: user.wilayahId } }, { teacherId: user.id }, { isShared: true }];
    }

    const banks = await this.prisma.questionBank.findMany({
      where,
      select: { subject: true, gradeLevel: true },
    });

    const subjects = Array.from(new Set(banks.map((b) => b.subject).filter(Boolean))).sort();
    const gradeLevels = Array.from(new Set(banks.map((b) => b.gradeLevel).filter(Boolean))).sort();

    return { subjects, gradeLevels };
  }
}
