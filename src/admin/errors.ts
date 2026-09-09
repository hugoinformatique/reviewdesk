export class ApiError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

export function loginErrorMessage(status: number): string {
  if (status === 401) return 'Identifiants invalides.';
  if (status === 429) return 'Trop de tentatives. Réessayez dans une minute.';
  return 'Service momentanément indisponible. Réessayez plus tard.';
}
