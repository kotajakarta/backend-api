import { SetMetadata } from '@nestjs/common';

export const RequireDivisi = (divisi: string) => SetMetadata('requireDivisi', divisi);
export const RequireScope = (scope: string) => SetMetadata('requireScope', scope);
export const AllowCookieAuth = () => SetMetadata('allowCookieAuth', true);
