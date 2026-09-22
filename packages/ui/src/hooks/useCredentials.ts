/**
 * useCredentials —— 凭据服务 hooks
 */
import { useCallback } from "react";
import { useServices } from "./useServices.js";

/** 凭据管理的基础 hook */
export function useCredentials() {
  const { credentialService } = useServices();

  const load = useCallback((key: string) => credentialService.load(key), [credentialService]);
  const save = useCallback(
    (key: string, value: string) => credentialService.save(key, value),
    [credentialService],
  );
  const del = useCallback((key: string) => credentialService.delete(key), [credentialService]);

  return { load, save, delete: del };
}

/** active provider access_token 专用便捷 hook（无 OAuth 链，恒 null） */
export function useAuthToken() {
  const getToken = useCallback(async () => null, []);
  const setToken = useCallback(async (_token: string) => {
    throw new Error("当前构建无 OAuth 登录链，无法写入 auth token");
  }, []);
  return { getToken, setToken };
}
