# desktop-web-remote-relay

提供 HMAC 配对 proof 与凭据 adapter。credentialService 独占 passHash，AppSettings 只保存 deviceSid；加载到不完整记录时清理两侧，rotate 先清旧材料再保存新材料。Manager 只通过公开工厂装配 adapter，不复制凭据状态；transport 独占连接及重连，Host 独占业务会话。
