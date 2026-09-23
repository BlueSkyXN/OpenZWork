// Modified for the private fork, 2026-09-23: the OAuth login domain types were removed
// with the account chain; only local credential-error utilities and UserInfo survive.
/** 凭据解密失败错误前缀 */
export const CREDENTIAL_DECRYPT_ERROR_PREFIX = "凭据解密失败：" as const;

/** 凭据解密失败稳定错误码 */
export const CREDENTIAL_DECRYPT_ERROR_CODE = "ZCODE_CREDENTIAL_DECRYPT_FAILED" as const;

export interface UserInfo {
  id: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
}
