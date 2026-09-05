import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../common/prisma/prisma.service.js';

@Injectable()
export class PembelajaranRekapService {
  private readonly logger = new Logger(PembelajaranRekapService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  // Helper: Count Saturdays between two dates (inclusive)
  public countSaturdays(startDate: Date, endDate: Date): number {
    let count = 0;
    const cur = new Date(startDate);
    cur.setHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    while (cur <= end) {
      if (cur.getDay() === 6) count++;
      cur.setDate(cur.getDate() + 1);
    }
    return count;
  }

  // Helper: status string for percent
  public statusForPercent(pct: number): 'Optimal' | 'Sesuai Jalur' | 'Berisiko' {
    if (pct >= 85) return 'Optimal';
    if (pct >= 60) return 'Sesuai Jalur';
    return 'Berisiko';
  }

  // Resolve start and end dates for a period
  public resolvePeriodDates(
    mode: 'weekly' | 'monthly' | 'semester' | 'yearly',
    options: { weekStart?: string; month?: string; tahunAjaran?: string; semester?: string }
  ) {
    const now = new Date();
    let startDate: Date;
    let endDate: Date;
    let periodeKey = '';
    let periodeLabel = '';

    if (mode === 'weekly') {
      const baseDate = options.weekStart ? new Date(options.weekStart) : now;
      const day = baseDate.getDay();
      startDate = new Date(baseDate);
      startDate.setDate(baseDate.getDate() - day);
      startDate.setHours(0, 0, 0, 0);

      endDate = new Date(startDate);
      endDate.setDate(startDate.getDate() + 6);
      endDate.setHours(23, 59, 59, 999);

      const y = startDate.getFullYear();
      const m = String(startDate.getMonth() + 1).padStart(2, '0');
      const d = String(startDate.getDate()).padStart(2, '0');
      periodeKey = `${y}-${m}-${d}`;
      periodeLabel = `Minggu (${d}/${m} - ${String(endDate.getDate()).padStart(2, '0')}/${String(endDate.getMonth() + 1).padStart(2, '0')})`;
    } else if (mode === 'monthly') {
      let y: number;
      let m: number;
      if (options.month) {
        const parts = options.month.split('-');
        y = parseInt(parts[0], 10);
        m = parseInt(parts[1], 10) - 1;
      } else {
        y = now.getFullYear();
        m = now.getMonth();
      }
      startDate = new Date(y, m, 1, 0, 0, 0, 0);
      endDate = new Date(y, m + 1, 0, 23, 59, 59, 999);

      const monthNames = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
      periodeKey = `${y}-${String(m + 1).padStart(2, '0')}`;
      periodeLabel = `Bulan ${monthNames[m]} ${y}`;
    } else if (mode === 'semester') {
      const [startYearStr, endYearStr] = (options.tahunAjaran || '').split('/');
      const startYear = parseInt(startYearStr) || now.getFullYear();
      const endYear = parseInt(endYearStr || '') || startYear + 1;
      const sem = (options.semester || '1').toUpperCase();

      if (sem === '1' || sem === 'GANJIL') {
        startDate = new Date(Date.UTC(startYear, 6, 1, 0, 0, 0, 0));
        endDate = new Date(Date.UTC(startYear, 11, 31, 23, 59, 59, 999));
        periodeKey = `${options.tahunAjaran || `${startYear}/${endYear}`}-1`;
        periodeLabel = `Semester Ganjil ${options.tahunAjaran || `${startYear}/${endYear}`}`;
      } else {
        startDate = new Date(Date.UTC(endYear, 0, 1, 0, 0, 0, 0));
        endDate = new Date(Date.UTC(endYear, 5, 30, 23, 59, 59, 999));
        periodeKey = `${options.tahunAjaran || `${startYear}/${endYear}`}-2`;
        periodeLabel = `Semester Genap ${options.tahunAjaran || `${startYear}/${endYear}`}`;
      }
    } else {
      const y = now.getFullYear();
      startDate = new Date(y, 0, 1, 0, 0, 0, 0);
      endDate = new Date(y, 11, 31, 23, 59, 59, 999);
      periodeKey = `${y}`;
      periodeLabel = `Tahun ${y}`;
    }

    return { startDate, endDate, periodeKey, periodeLabel };
  }

  // Generate and persist pre-calculated aggregations for a given period
  async syncPeriod(
    tahunAjaran: string,
    semester: string,
    mode: 'weekly' | 'monthly' | 'semester' | 'yearly',
    periodeKeyParam?: string
  ) {
    const { startDate, endDate, periodeKey } = this.resolvePeriodDates(mode, {
      month: mode === 'monthly' ? periodeKeyParam : undefined,
      weekStart: mode === 'weekly' ? periodeKeyParam : undefined,
      tahunAjaran,
      semester
    });

    const finalPeriodeKey = periodeKeyParam || periodeKey;
    const now = new Date();

    // 1. Calculate Saturday count & target denominator
    const totalSabtu = this.countSaturdays(startDate, endDate);
    let targetDenominator = 5;
    if (mode === 'weekly') targetDenominator = 5;
    else if (mode === 'monthly') targetDenominator = totalSabtu * 5;
    else if (mode === 'semester') targetDenominator = totalSabtu * 6;
    else if (mode === 'yearly') targetDenominator = 12;

    // 2. Fetch all active Classes, Pelaksanaan, and Absensi for this date window
    const rawKelasList = await this.prisma.kelas.findMany({
      where: { isActive: true },
      include: {
        cabang: { include: { wilayah: true } },
        ruang: true,
        lembagaMuadalah: true,
        siswaFormal: {
          where: { student: { isActive: true } }
        }
      },
      orderBy: { name: 'asc' }
    });

    const kelasIds = rawKelasList.map(k => k.id);
    const kelasById = new Map(rawKelasList.map(k => [k.id, k]));

    const pelaksanaanList = kelasIds.length > 0 ? await this.prisma.pelaksanaanSilabus.findMany({
      where: {
        kelasId: { in: kelasIds },
        tanggalDiajar: { gte: startDate, lte: endDate }
      },
      include: { silabus: { include: { mataPelajaran: true } }, mataPelajaran: true, guru: true }
    }) : [];

    const absensiList = kelasIds.length > 0 ? await this.prisma.absensiMapel.findMany({
      where: {
        kelasId: { in: kelasIds },
        tanggal: { gte: startDate, lte: endDate },
        mataPelajaran: { aktifPembelajaran: true }
      },
      include: { mataPelajaran: true, silabus: true }
    }) : [];

    // 3. Build Weeks Info
    const monthShortNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
    const totalDays = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000)));
    const weekCount = Math.max(1, Math.ceil(totalDays / 7));

    const weeksInfo = Array.from({ length: weekCount }, (_, weekIdx) => {
      const wStart = new Date(startDate.getTime() + weekIdx * 7 * 24 * 60 * 60 * 1000);
      const wEnd = new Date(Math.min(endDate.getTime(), wStart.getTime() + 6 * 24 * 60 * 60 * 1000));

      let satDay: Date | null = null;
      const curr = new Date(wStart);
      while (curr <= wEnd) {
        if (curr.getDay() === 6) {
          satDay = new Date(curr);
          break;
        }
        curr.setDate(curr.getDate() + 1);
      }

      const monthShort = monthShortNames[wStart.getMonth()] || '';
      const dayLabel = satDay
        ? `Sabtu, ${String(satDay.getDate()).padStart(2, '0')} ${monthShortNames[satDay.getMonth()]}`
        : `${wStart.getDate()}-${wEnd.getDate()} ${monthShort}`;

      return {
        weekNumber: weekIdx + 1,
        dateLabel: dayLabel,
        saturdayDate: satDay ? satDay.toISOString().split('T')[0] : null,
        startDateIso: wStart.toISOString(),
        endDateIso: wEnd.toISOString(),
        dateRange: `${wStart.getDate()}-${wEnd.getDate()} ${monthShort}`
      };
    });

    // 4. Build aggregations for:
    // a) KELAS
    // b) CABANG
    // c) WILAYAH
    // d) GLOBAL

    type UnitAccumulator = {
      unitLevel: 'GLOBAL' | 'WILAYAH' | 'CABANG' | 'KELAS';
      unitId: string;
      unitName: string;
      parentName: string;
      cabangSet: Set<string>;
      kelasSet: Set<string>;
      jumlahSiswa: number;
      silabusCompleted: number;
      detailsMap: Map<string, any>;
      absensiMap: { hadir: number; sakit: number; izin: number; alpa: number };
    };

    const accumulators = new Map<string, UnitAccumulator>();

    const getAcc = (level: 'GLOBAL' | 'WILAYAH' | 'CABANG' | 'KELAS', id: string, name: string, parentName: string) => {
      const key = `${level}__${id}`;
      if (!accumulators.has(key)) {
        accumulators.set(key, {
          unitLevel: level,
          unitId: id,
          unitName: name,
          parentName,
          cabangSet: new Set(),
          kelasSet: new Set(),
          jumlahSiswa: 0,
          silabusCompleted: 0,
          detailsMap: new Map(),
          absensiMap: { hadir: 0, sakit: 0, izin: 0, alpa: 0 }
        });
      }
      return accumulators.get(key)!;
    };

    // Initialize all Wilayahs and Cabangs to ensure complete coverage
    const [allWilayahs, allCabangs] = await Promise.all([
      this.prisma.wilayah.findMany({ select: { id: true, name: true } }),
      this.prisma.cabang.findMany({ select: { id: true, name: true, wilayahId: true, wilayah: { select: { name: true } } } })
    ]);

    // Global
    getAcc('GLOBAL', 'GLOBAL', 'PUSAT NASIONAL', '');

    allWilayahs.forEach(w => {
      getAcc('WILAYAH', w.id, w.name, '');
    });

    allCabangs.forEach(c => {
      getAcc('CABANG', c.id, c.name, c.wilayah?.name || '');
    });

    // Populate Class data
    rawKelasList.forEach(k => {
      const classStudents = k.siswaFormal ? k.siswaFormal.length : 0;
      const cabangId = k.cabangId || 'unknown';
      const cabangName = k.cabang?.name || 'Tanpa Cabang';
      const wilayahId = k.cabang?.wilayahId || 'unknown';
      const wilayahName = k.cabang?.wilayah?.name || 'Tanpa Wilayah';

      const completedCount = pelaksanaanList.filter(
        p => p.kelasId === k.id && p.status === 'COMPLETED'
      ).length;

      // 1. KELAS Level
      const accKelas = getAcc('KELAS', k.id, k.name, cabangName);
      if (k.cabangId) accKelas.cabangSet.add(k.cabangId);
      accKelas.kelasSet.add(k.id);
      accKelas.jumlahSiswa += classStudents;
      accKelas.silabusCompleted += completedCount;

      // 2. CABANG Level
      const accCabang = getAcc('CABANG', cabangId, cabangName, wilayahName);
      accCabang.cabangSet.add(cabangId);
      accCabang.kelasSet.add(k.id);
      accCabang.jumlahSiswa += classStudents;
      accCabang.silabusCompleted += completedCount;

      // 3. WILAYAH Level
      const accWilayah = getAcc('WILAYAH', wilayahId, wilayahName, '');
      accWilayah.cabangSet.add(cabangId);
      accWilayah.kelasSet.add(k.id);
      accWilayah.jumlahSiswa += classStudents;
      accWilayah.silabusCompleted += completedCount;

      // 4. GLOBAL Level
      const accGlobal = getAcc('GLOBAL', 'GLOBAL', 'PUSAT NASIONAL', '');
      accGlobal.cabangSet.add(cabangId);
      accGlobal.kelasSet.add(k.id);
      accGlobal.jumlahSiswa += classStudents;
      accGlobal.silabusCompleted += completedCount;
    });

    // Populate Absensi data
    absensiList.forEach(a => {
      const k = kelasById.get(a.kelasId);
      if (!k) return;
      const cabangId = k.cabangId || 'unknown';
      const cabangName = k.cabang?.name || 'Tanpa Cabang';
      const wilayahId = k.cabang?.wilayahId || 'unknown';
      const wilayahName = k.cabang?.wilayah?.name || 'Tanpa Wilayah';

      const levels: UnitAccumulator[] = [
        getAcc('KELAS', k.id, k.name, cabangName),
        getAcc('CABANG', cabangId, cabangName, wilayahName),
        getAcc('WILAYAH', wilayahId, wilayahName, ''),
        getAcc('GLOBAL', 'GLOBAL', 'PUSAT NASIONAL', '')
      ];

      levels.forEach(acc => {
        if (a.status === 'HADIR') acc.absensiMap.hadir++;
        else if (a.status === 'SAKIT') acc.absensiMap.sakit++;
        else if (a.status === 'IZIN') acc.absensiMap.izin++;
        else if (a.status === 'ALPA') acc.absensiMap.alpa++;

        // Detail mapel
        const mapelName = a.mataPelajaran?.name || 'Mata Pelajaran';
        const tglStr = a.tanggal.toISOString().split('T')[0];
        const dKey = `${a.mataPelajaranId}__${tglStr}`;

        if (!acc.detailsMap.has(dKey)) {
          const pel = pelaksanaanList.find(p => p.kelasId === a.kelasId && p.mataPelajaranId === a.mataPelajaranId && p.tanggalDiajar && p.tanggalDiajar.toISOString().split('T')[0] === tglStr);
          acc.detailsMap.set(dKey, {
            id: dKey,
            mataPelajaranId: a.mataPelajaranId,
            mataPelajaranName: mapelName,
            guruName: pel?.guru?.name || null,
            tanggal: tglStr,
            statusPelaksanaan: pel?.status || 'COMPLETED',
            hadir: 0,
            sakit: 0,
            izin: 0,
            alpa: 0,
            totalSiswa: acc.jumlahSiswa || 1,
            persenHadirMapel: 0
          });
        }
        const d = acc.detailsMap.get(dKey)!;
        if (a.status === 'HADIR') d.hadir++;
        else if (a.status === 'SAKIT') d.sakit++;
        else if (a.status === 'IZIN') d.izin++;
        else if (a.status === 'ALPA') d.alpa++;
      });
    });

    // 5. Compute weekly breakdown array & upsert into RekapPembelajaran
    //
    // Group once by kelasId so each unit's weekly breakdown only scans the
    // handful of rows belonging to its own classes, instead of re-filtering
    // the entire pelaksanaanList/absensiList (which can be 90k+ rows for a
    // semester) for every week x every one of the ~680 units. That O(weeks x
    // units x totalRows) blowup was the actual bottleneck: it blocked the
    // Node event loop for the whole server on a single cache-miss request.
    const pelaksanaanByKelas = new Map<string, typeof pelaksanaanList>();
    for (const p of pelaksanaanList) {
      const arr = pelaksanaanByKelas.get(p.kelasId);
      if (arr) arr.push(p); else pelaksanaanByKelas.set(p.kelasId, [p]);
    }
    const absensiByKelas = new Map<string, typeof absensiList>();
    for (const a of absensiList) {
      const arr = absensiByKelas.get(a.kelasId);
      if (arr) arr.push(a); else absensiByKelas.set(a.kelasId, [a]);
    }

    const upsertPromises = Array.from(accumulators.values()).map(acc => {
      const jumlahCabang = acc.cabangSet.size;
      const jumlahKelas = acc.kelasSet.size;
      const jumlahSiswa = acc.jumlahSiswa;
      const mapelTarget = jumlahKelas * targetDenominator;
      const mapelTerlaksana = acc.silabusCompleted;
      const persenMapel = mapelTarget > 0 ? Math.min(100, Math.round((mapelTerlaksana / mapelTarget) * 100)) : 0;

      const totalHadir = acc.absensiMap.hadir;
      const totalAbsensi = acc.absensiMap.hadir + acc.absensiMap.sakit + acc.absensiMap.izin + acc.absensiMap.alpa;
      const persenKehadiran = totalAbsensi > 0 ? Math.min(100, Math.round((totalHadir / totalAbsensi) * 100)) : 0;

      // Finalize details
      const details = Array.from(acc.detailsMap.values()).map(d => {
        const rec = d.hadir + d.sakit + d.izin + d.alpa;
        const tot = Math.max(jumlahSiswa, rec, 1);
        return {
          ...d,
          totalSiswa: tot,
          persenHadirMapel: Math.min(100, Math.round((d.hadir / tot) * 100))
        };
      }).sort((a, b) => b.tanggal.localeCompare(a.tanggal));

      // Rows belonging to this unit's own classes only (gathered once, not
      // once per week) — for CABANG/KELAS units (the vast majority) this is
      // a tiny slice of the full pelaksanaanList/absensiList.
      const unitPel: typeof pelaksanaanList = [];
      const unitAbs: typeof absensiList = [];
      acc.kelasSet.forEach(kId => {
        const p = pelaksanaanByKelas.get(kId);
        if (p) unitPel.push(...p);
        const a = absensiByKelas.get(kId);
        if (a) unitAbs.push(...a);
      });

      // Build weekly structure
      const weeks = weeksInfo.map((wInfo, wIdx) => {
        const wStartDate = new Date(wInfo.startDateIso);
        wStartDate.setHours(0, 0, 0, 0);
        const wEndDate = new Date(wInfo.endDateIso);
        wEndDate.setHours(23, 59, 59, 999);
        const isFuture = wStartDate.getTime() > now.getTime();

        const wPel = unitPel.filter(
          p => p.tanggalDiajar && p.tanggalDiajar >= wStartDate && p.tanggalDiajar <= wEndDate && p.status === 'COMPLETED'
        );
        const wMapelCompleted = wPel.length;
        const wMapelTarget = jumlahKelas * 5;
        const wPersenMapel = isFuture || wMapelTarget === 0 ? 0 : Math.min(100, Math.round((wMapelCompleted / wMapelTarget) * 100));

        const wAbsAll = unitAbs.filter(
          a => a.tanggal >= wStartDate && a.tanggal <= wEndDate
        );
        const wHadir = wAbsAll.filter(a => a.status === 'HADIR').length;
        const wTotalAbs = wAbsAll.length;
        const wPersenHadir = isFuture ? 0 : (wTotalAbs > 0 ? Math.min(100, Math.round((wHadir / wTotalAbs) * 100)) : 0);

        const wDetails = details.filter(d => {
          const dDate = new Date(d.tanggal);
          return dDate >= wStartDate && dDate <= wEndDate;
        });

        return {
          weekNumber: wIdx + 1,
          dateLabel: wInfo.dateLabel,
          isFuture,
          mapelCompleted: isFuture ? 0 : wMapelCompleted,
          mapelTarget: wMapelTarget,
          persenMapel: wPersenMapel,
          hadir: isFuture ? 0 : wHadir,
          totalAbsensi: wTotalAbs,
          persenKehadiran: wPersenHadir,
          details: wDetails
        };
      });

      const weeksJsonData = {
        weeks,
        details
      };

      return this.prisma.rekapPembelajaran.upsert({
        where: {
          tahunAjaran_semester_periodeTipe_periodeKey_unitLevel_unitId_mataPelajaranId: {
            tahunAjaran,
            semester,
            periodeTipe: mode.toUpperCase(),
            periodeKey: finalPeriodeKey,
            unitLevel: acc.unitLevel,
            unitId: acc.unitId,
            mataPelajaranId: 'ALL'
          }
        },
        update: {
          unitName: acc.unitName,
          parentName: acc.parentName,
          jumlahCabang,
          jumlahKelas,
          jumlahSiswa,
          mapelTerlaksana,
          mapelTarget,
          persenMapel,
          totalHadir,
          totalAbsensi,
          persenKehadiran,
          weeksJson: weeksJsonData as any
        },
        create: {
          tahunAjaran,
          semester,
          periodeTipe: mode.toUpperCase(),
          periodeKey: finalPeriodeKey,
          unitLevel: acc.unitLevel,
          unitId: acc.unitId,
          unitName: acc.unitName,
          parentName: acc.parentName,
          mataPelajaranId: 'ALL',
          jumlahCabang,
          jumlahKelas,
          jumlahSiswa,
          mapelTerlaksana,
          mapelTarget,
          persenMapel,
          totalHadir,
          totalAbsensi,
          persenKehadiran,
          weeksJson: weeksJsonData as any
        }
      });
    });

    await Promise.all(upsertPromises);
    this.logger.log(`RekapPembelajaran synced successfully for ${tahunAjaran} ${semester} ${mode} ${finalPeriodeKey} (${upsertPromises.length} units).`);
    return { count: upsertPromises.length, periodeKey: finalPeriodeKey };
  }

  // Fast read from pre-calculated RekapPembelajaran table
  async getRingkasanFromRekap(
    user: any,
    queryParams?: {
      mode?: 'weekly' | 'monthly' | 'semester' | 'yearly';
      weekStart?: string;
      month?: string;
      tahunAjaran?: string;
      semester?: string;
      kelasId?: string;
      wilayahId?: string;
      cabangId?: string;
    } | string,
    kelasIdLegacy?: string,
    wilayahIdLegacy?: string,
    cabangIdLegacy?: string
  ) {
    let mode: 'weekly' | 'monthly' | 'semester' | 'yearly' = 'monthly';
    let weekStart: string | undefined;
    let month: string | undefined;
    let reqTahunAjaran: string | undefined;
    let reqSemester: string | undefined;
    let kelasId: string | undefined;
    let wilayahId: string | undefined;
    let cabangId: string | undefined;

    if (typeof queryParams === 'object' && queryParams !== null) {
      mode = queryParams.mode || 'monthly';
      weekStart = queryParams.weekStart;
      month = queryParams.month;
      reqTahunAjaran = queryParams.tahunAjaran;
      reqSemester = queryParams.semester;
      kelasId = queryParams.kelasId;
      wilayahId = queryParams.wilayahId;
      cabangId = queryParams.cabangId;
    } else {
      month = queryParams;
      kelasId = kelasIdLegacy;
      wilayahId = wilayahIdLegacy;
      cabangId = cabangIdLegacy;
    }

    const pengaturan = await this.prisma.pengaturanAkademik.findFirst();
    const tahunAjaran = reqTahunAjaran || pengaturan?.tahunAjaran || '';
    const semester = reqSemester || pengaturan?.semesterAktif || '';

    const scopeLevel: 'GLOBAL' | 'WILAYAH' | 'CABANG' =
      user?.scope === 'CABANG' ? 'CABANG' : user?.scope === 'WILAYAH' ? 'WILAYAH' : 'GLOBAL';

    let breakdownLevel: 'WILAYAH' | 'CABANG' | 'KELAS' = 'KELAS';
    if (scopeLevel === 'CABANG' || cabangId) {
      breakdownLevel = 'KELAS';
    } else if (scopeLevel === 'WILAYAH' || wilayahId) {
      breakdownLevel = 'CABANG';
    } else {
      breakdownLevel = 'WILAYAH';
    }

    const unitLabel = breakdownLevel === 'WILAYAH' ? 'Wilayah' : breakdownLevel === 'CABANG' ? 'Cabang' : 'Kelas';

    const { startDate, endDate, periodeKey, periodeLabel } = this.resolvePeriodDates(mode, {
      month,
      weekStart,
      tahunAjaran,
      semester
    });

    const emptyFilterOptions = {
      wilayahList: [] as Array<{ id: string; name: string }>,
      cabangList: [] as Array<{ id: string; name: string; wilayahId: string | null }>,
    };

    if (!tahunAjaran || !semester) {
      return {
        tahunAjaran, semester, scopeLevel, unitLabel, selectedMonth: month || '', periodeLabel,
        totalSilabusCompleted: 0, totalSilabusTarget: 0, persenSilabus: 0,
        hadir: 0, totalAbsensi: 0, persenKehadiran: 0, kehadiranDelta: 0,
        persenPelajaranTerlaksana: 0, belumMulai: 0,
        statusDistribution: { optimal: 0, sesuaiJalur: 0, berisiko: 0 },
        breakdownTotal: 0, unitBreakdown: [], filterOptions: emptyFilterOptions,
        kelasOptions: [], selectedKelasId: null, pemantauanMingguan: [], weeksInfo: []
      };
    }

    // Check if pre-calculated records exist for this period
    let rekapRecords = await this.prisma.rekapPembelajaran.findMany({
      where: {
        tahunAjaran,
        semester,
        periodeTipe: mode.toUpperCase(),
        periodeKey,
        unitLevel: breakdownLevel,
        mataPelajaranId: 'ALL'
      }
    });

    // If not found in summary table, compute and persist immediately
    if (rekapRecords.length === 0) {
      await this.syncPeriod(tahunAjaran, semester, mode, periodeKey);
      rekapRecords = await this.prisma.rekapPembelajaran.findMany({
        where: {
          tahunAjaran,
          semester,
          periodeTipe: mode.toUpperCase(),
          periodeKey,
          unitLevel: breakdownLevel,
          mataPelajaranId: 'ALL'
        }
      });
    }

    // Filter Options
    const filterOptions = { ...emptyFilterOptions };
    if (scopeLevel === 'GLOBAL') {
      const [allWilayah, allCabang] = await Promise.all([
        this.prisma.wilayah.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
        this.prisma.cabang.findMany({ select: { id: true, name: true, wilayahId: true }, orderBy: { name: 'asc' } })
      ]);
      filterOptions.wilayahList = allWilayah;
      filterOptions.cabangList = allCabang;
    } else if (scopeLevel === 'WILAYAH') {
      const allCabang = await this.prisma.cabang.findMany({
        where: { wilayahId: user.wilayahId },
        select: { id: true, name: true, wilayahId: true },
        orderBy: { name: 'asc' }
      });
      filterOptions.cabangList = allCabang;
    }

    // Apply scoping filters on unitBreakdown
    let filteredRekap = rekapRecords;
    if (breakdownLevel === 'CABANG') {
      const effectiveWilayahId = user?.scope === 'WILAYAH' ? user.wilayahId : wilayahId;
      if (effectiveWilayahId) {
        // match parentName or query matching cabangs
        const validCabangIds = new Set(filterOptions.cabangList.filter(c => c.wilayahId === effectiveWilayahId).map(c => c.id));
        filteredRekap = filteredRekap.filter(r => validCabangIds.has(r.unitId));
      }
      if (cabangId) {
        filteredRekap = filteredRekap.filter(r => r.unitId === cabangId);
      }
    } else if (breakdownLevel === 'KELAS') {
      const effectiveCabangId = user?.scope === 'CABANG' ? user.cabangId : cabangId;
      if (effectiveCabangId) {
        // Filter by class belonging to cabang
        const classesInCabang = await this.prisma.kelas.findMany({
          where: { cabangId: effectiveCabangId, isActive: true },
          select: { id: true }
        });
        const validClassIds = new Set(classesInCabang.map(k => k.id));
        filteredRekap = filteredRekap.filter(r => validClassIds.has(r.unitId));
      }
      if (kelasId) {
        filteredRekap = filteredRekap.filter(r => r.unitId === kelasId);
      }
    }

    // Extract weeksInfo from the first record's JSON
    const firstJson = (filteredRekap[0]?.weeksJson as any) || (rekapRecords[0]?.weeksJson as any);
    const weeksInfo = firstJson?.weeks ? firstJson.weeks.map((w: any) => ({
      weekNumber: w.weekNumber,
      dateLabel: w.dateLabel,
      saturdayDate: w.dateLabel,
      startDateIso: '',
      endDateIso: '',
      dateRange: w.dateLabel
    })) : [];

    // Map rows to unitBreakdown shape expected by frontend
    const unitBreakdown = filteredRekap.map(r => {
      const json = (r.weeksJson as any) || {};
      const weeks = json.weeks || [];
      const details = json.details || [];

      return {
        id: r.unitId,
        name: r.unitName,
        parentName: r.parentName || '',
        jumlahCabang: r.jumlahCabang,
        jumlahKelas: r.jumlahKelas,
        jumlahSiswa: r.jumlahSiswa,
        silabusCompleted: r.mapelTerlaksana,
        silabusTotal: r.mapelTarget,
        persenSilabus: Math.round(r.persenMapel),
        hadir: r.totalHadir,
        totalAbsensi: r.totalAbsensi,
        persenKehadiran: Math.round(r.persenKehadiran),
        status: this.statusForPercent(r.persenMapel),
        details,
        weeks
      };
    });

    // Summary totals
    const totalSilabusCompleted = unitBreakdown.reduce((acc, u) => acc + u.silabusCompleted, 0);
    const totalSilabusTarget = unitBreakdown.reduce((acc, u) => acc + u.silabusTotal, 0);
    const persenSilabus = totalSilabusTarget > 0 ? Math.min(100, Math.round((totalSilabusCompleted / totalSilabusTarget) * 100)) : 0;
    const hadir = unitBreakdown.reduce((acc, u) => acc + u.hadir, 0);
    const totalAbsensi = unitBreakdown.reduce((acc, u) => acc + u.totalAbsensi, 0);
    const persenKehadiran = totalAbsensi > 0 ? Math.min(100, Math.round((hadir / totalAbsensi) * 100)) : 0;

    // Status distribution
    const statusDistribution = unitBreakdown
      .map(u => u.status)
      .reduce(
        (acc, status) => {
          if (status === 'Optimal') acc.optimal++;
          else if (status === 'Sesuai Jalur') acc.sesuaiJalur++;
          else acc.berisiko++;
          return acc;
        },
        { optimal: 0, sesuaiJalur: 0, berisiko: 0 }
      );

    // Final average persenKehadiran excluding TES-WILAYAH for official compliance
    const validUnitsForTotal = unitBreakdown.filter(u => !u.name?.toUpperCase().includes('TES-WILAYAH') && !u.name?.toUpperCase().startsWith('TES-'));
    const finalPersenKehadiran = validUnitsForTotal.length > 0
      ? Math.min(100, Math.round(validUnitsForTotal.reduce((acc, u) => acc + (u.persenKehadiran || 0), 0) / validUnitsForTotal.length))
      : persenKehadiran;

    return {
      tahunAjaran,
      semester,
      scopeLevel,
      unitLabel,
      selectedMonth: month || '',
      periodeLabel,
      totalSilabusCompleted,
      totalSilabusTarget,
      persenSilabus,
      hadir,
      totalAbsensi,
      persenKehadiran: finalPersenKehadiran,
      kehadiranDelta: 0,
      persenPelajaranTerlaksana: persenSilabus,
      belumMulai: statusDistribution.berisiko,
      statusDistribution,
      breakdownTotal: unitBreakdown.length,
      unitBreakdown,
      filterOptions,
      kelasOptions: [],
      selectedKelasId: kelasId || null,
      pemantauanMingguan: [],
      weeksInfo
    };
  }

  // Daily Cron Job to keep current active periods fresh
  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async handleNightlyCron() {
    this.logger.log('Starting nightly Pembelajaran Rekap sync...');
    try {
      const pengaturan = await this.prisma.pengaturanAkademik.findFirst();
      if (!pengaturan) return;
      const { tahunAjaran, semesterAktif } = pengaturan;

      const now = new Date();
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

      // Sync monthly, weekly, semester (active) and yearly (current year) so
      // that "Per Semester"/"Per Tahun" reads also hit the fast rekap path
      // instead of triggering a synchronous recompute on first request.
      await this.syncPeriod(tahunAjaran, semesterAktif, 'monthly', currentMonth);
      await this.syncPeriod(tahunAjaran, semesterAktif, 'weekly');
      await this.syncPeriod(tahunAjaran, semesterAktif, 'semester');
      await this.syncPeriod(tahunAjaran, semesterAktif, 'yearly');
      this.logger.log('Nightly Pembelajaran Rekap sync completed.');
    } catch (err: any) {
      this.logger.error('Failed nightly Pembelajaran Rekap sync', err?.message || err);
    }
  }
}
