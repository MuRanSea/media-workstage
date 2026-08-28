# 05-local-task-queue-and-persistence

Type: grilling
Status: claimed
Blocked by: none

## Question

设计本地任务调度器与 SQLite 数据库持久化方案：包括 Task 表结构（ID, Provider, Model, Type, Prompt, Status, ResultURL, LocalPath, Error, Timestamps）、后台异步 Poller 轮询机制、以及前后端状态实时同步（WebSocket vs Server-Sent Events SSE）。
