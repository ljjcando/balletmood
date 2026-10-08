# cleanupDuplicateRecords

这是一次性数据库维护云函数，默认拒绝所有调用者。

部署前必须在云函数环境变量中配置：

```text
CLEANUP_ADMIN_OPENIDS=管理员OPENID
```

多个管理员使用英文逗号分隔。未配置、当前调用者 OPENID 为空或不在名单中时，预演和正式清理都会返回 `FORBIDDEN`，且不会读取或修改数据库。

完成历史重复数据清理后，建议从生产环境下线此云函数。
