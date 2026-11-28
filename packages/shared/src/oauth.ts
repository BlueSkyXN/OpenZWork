// Modified for the private fork, 2026-09-23: the OAuth login domain types were removed
// with the account chain; only local credential-error utilities and UserInfo survive.
/** 凭据解密失败错误前缀 */
export const CREDENTIAL_DECRYPT_ERROR_PREFIX = "凭据解密失败：" as const;

/** 凭据解密失败稳定错误码 */
export const CREDENTIAL_DECRYPT_ERROR_CODE = "ZCODE_CREDENTIAL_DECRYPT_FAILED" as const;

// OW-P059：只有取得当前密钥后确认条目属于另一来源时才使用此原因，整库不可用仍按原错误处理。
export const CREDENTIAL_SOURCE_MISMATCH = "CREDENTIAL_SOURCE_MISMATCH" as const;
export const CREDENTIAL_SOURCE_MISMATCH_MESSAGE =
  "This credential uses a different key source. Read it from its original environment.";

export function isCredentialSourceMismatch(error: unknown): boolean {
  return (
    readCredentialErrorCode(error) === "CREDENTIAL_SECURE_STORAGE_UNAVAILABLE" &&
    typeof error === "object" && error !== null &&
    "reason" in error && error.reason === CREDENTIAL_SOURCE_MISMATCH
  );
}

export interface UserInfo {
  id: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
}

export function isCredentialDecryptError(error: unknown): boolean {
  const code = readCredentialErrorCode(error);
  if (code) {
    return code === CREDENTIAL_DECRYPT_ERROR_CODE;
  }

  // 兼容历史错误和跨边界丢失 code 的旧 payload；新错误应优先携带稳定 code。
  if (readCredentialErrorMessage(error).startsWith(CREDENTIAL_DECRYPT_ERROR_PREFIX)) {
    return true;
  }

  return false;
}

function readCredentialErrorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    return String((error as { code?: unknown }).code ?? "");
  }

  return "";
}

function readCredentialErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message?: unknown }).message ?? "");
  }

  return "";
}
