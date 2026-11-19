import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { link, lstat, open, rename, rm, type FileHandle } from "node:fs/promises";
import { isAbsolute, dirname, join } from "node:path";
import { promisify } from "node:util";
import { withFileLock } from "@zcode/shared/node";

// Windows 在创建临时文件时即指定受保护的 DACL，文件内容从不经过子进程。
async function windowsAcl(path: string, create: boolean) {
  const systemRoot = process.env.SystemRoot;
  if (!systemRoot || !isAbsolute(systemRoot)) throw new Error("config-package.private-file");
  const verify = [
    "$actual=[IO.File]::GetAccessControl($p)",
    "$rules=@($actual.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))",
    "if (!$actual.AreAccessRulesProtected -or $actual.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value -or $rules.Count -ne 1 -or $rules[0].IdentityReference.Value -ne $sid.Value -or $rules[0].AccessControlType -ne 'Allow' -or $rules[0].FileSystemRights -ne 'FullControl') { throw 'private ACL required' }",
  ];
  const script = [
    "$ErrorActionPreference='Stop'",
    "$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User",
    "$p=$env:OZ_CONFIG_PACKAGE_SELECTED_FILE",
    ...(create
      ? [
          "$acl=New-Object Security.AccessControl.FileSecurity",
          "$acl.SetAccessRuleProtection($true,$false)",
          "$acl.SetOwner($sid)",
          "$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','Allow')))",
          "$created=$false",
          "try {",
          "$f=[IO.FileStream]::new($p,[IO.FileMode]::CreateNew,[Security.AccessControl.FileSystemRights]::FullControl,[IO.FileShare]::None,4096,[IO.FileOptions]::None,$acl)",
          "$created=$true",
          "$f.Dispose()",
          ...verify,
          "} catch { if ($created) { [IO.File]::Delete($p) }; throw }",
        ]
      : verify),
  ];
  await promisify(execFile)(
    join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    [
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(script.join("\n"), "utf16le").toString("base64"),
    ],
    { windowsHide: true, env: { ...process.env, OZ_CONFIG_PACKAGE_SELECTED_FILE: path } },
  );
}

// 备份与原文件是同卷硬链接，恢复时也保留原文件的 ACL。备份创建失败时目标尚未替换。
async function publishWindows(
  path: string,
  temporary: string,
  handle: FileHandle,
  verify: (path: string) => Promise<void>,
) {
  const backup = temporary + ".previous";
  let hasBackup = false;
  let retainBackup = false;
  await withFileLock(path, async () => {
    try {
      try {
        await link(path, backup);
        hasBackup = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      await rename(temporary, path);
      try {
        await verify(path);
      } catch (error) {
        retainBackup = true;
        // 即使路径已由第三方替换，也只清空本次仍持有的文件。恢复旧文件前核对文件身份。
        try {
          await handle.truncate(0);
          await handle.sync();
        } finally {
          const current = await lstat(path, { bigint: true });
          const staged = await handle.stat({ bigint: true });
          if (current.dev === staged.dev && current.ino === staged.ino) {
            if (hasBackup) await rename(backup, path);
            else await rm(path);
          }
          retainBackup = false;
        }
        throw error;
      }
    } finally {
      // 恢复操作本身失败时保留原件。成功恢复的 backup 已由 rename 消耗。
      if (hasBackup && !retainBackup) await rm(backup, { force: true });
    }
  });
}

export async function writePrivatePackage(
  path: string,
  bytes: Uint8Array,
  acl = process.platform === "win32" ? windowsAcl : undefined,
) {
  const temporary = join(dirname(path), ".openzwork-config-" + randomUUID() + ".tmp");
  let owned = false;
  try {
    if (acl) {
      await acl(temporary, true);
      owned = true;
    }
    const handle = await open(temporary, acl ? "r+" : "wx", 0o600);
    owned = true;
    try {
      if (!acl) {
        await handle.chmod(0o600);
        if (((await handle.stat()).mode & 0o777) !== 0o600) throw new Error();
      }
      await handle.writeFile(bytes);
      await handle.sync();
      if (acl) {
        await publishWindows(path, temporary, handle, (final) => acl(final, false));
        owned = false;
      }
    } finally {
      await handle.close();
    }
    if (!acl) {
      await rename(temporary, path);
      owned = false;
    }
  } catch {
    throw new Error("config-package.private-file");
  } finally {
    if (owned) await rm(temporary, { force: true });
  }
}
