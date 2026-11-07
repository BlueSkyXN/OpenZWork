# Web Remote v3 Static Deployment Implementation Plan

历史设计的目标是将手机静态资源按路径隔离，防止新资源覆盖旧版本 App。当前 V2 以 OSS 版本目录实现该隔离，参见 [Remote v4 静态部署](../../web-remote-control/remote-v4-static-deployment.md)。

`/remote/__test__` 独立测试链继续保留；构建、镜像推送和路由验证以当前静态部署文档为准。应用层配对与恢复见[远控架构](../../web-remote-control/web-remote-control-architecture.md)。
