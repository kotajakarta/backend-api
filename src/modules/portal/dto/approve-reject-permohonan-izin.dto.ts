import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

// Approving a leave request: an admin note is nice-to-have but not required.
export class ApprovePermohonanIzinDto {
  @IsString()
  @IsOptional()
  catatanAdmin?: string;
}

// Rejecting a leave request: require a non-empty reason so the parent knows why
// (matches the spirit of the existing PermohonanKelas/PermohonanCabang reject flows,
// which fall back to a generic message — here we instead require staff to state one).
export class RejectPermohonanIzinDto {
  @IsString()
  @IsNotEmpty({ message: 'Catatan admin wajib diisi saat menolak permohonan' })
  catatanAdmin!: string;
}
