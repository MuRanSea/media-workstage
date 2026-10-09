# ADR 0008: 上传平台独立于服务商

## 上下文 (Context)
上传卡片的「上传素材库」和「获取链接」调用的是 Heighliner 平台自己的业务 API（`/api/volcengine/assets/*` 和 `/api/files/upload`，见 https://platform.sgt.site/docs/ 的「平台业务 API」一节），不是哪家模型厂商的接口。原先的实现让用户在卡片上选一个服务商，再拿该服务商 Base URL 的域名和密钥去调这些接口。结果下拉框里列出了所有已配置的服务商，Midjourney、Google、OpenAI 都在里面。指向别处的服务商只会失败，指向同一平台、同一密钥的服务商则重复出现。用户分不清该选哪个。

## 决策 (Decision)
- **上传平台（Upload Platform）单独配置**：在设置里有自己的一页「上传平台」，只有平台地址和 API Key 两项，存放在 `system_configs` 的 `upload_base_url`、`upload_api_key` 中。环境变量 `UPLOAD_BASE_URL`、`UPLOAD_API_KEY` 作为回退，地址默认为 `https://platform.sgt.site`。
- **上传卡片不再选服务商**：所有上传都发往上传平台。接口只用地址的 scheme 和 host，`/api/...` 路径由程序补上。
- **测试连接走只读接口**：调用 `POST /api/volcengine/assets/list`（只取一条），不上传文件，也不消耗额度。
- 卡片里已有的 `uploadProvider` 字段不再读取，也不再写入。旧工程里留着这个字段不受影响。

## 考虑过的方案 (Considered Options)
- **把地址和密钥相同的服务商合并成一项**：下拉框变短了，但"上传要选服务商"这件事本身就是错的，用户仍然会看到和上传毫不相关的服务商名字。
- **固定用火山方舟服务商的地址和密钥**：省掉一页设置，但把上传和某个服务商绑在一起，服务商改指向官方地址时上传就会坏。

## 结果与影响 (Consequences)
- 新用户需要在「上传平台」里单独填一次 Key，即使它和某个服务商的 Key 相同。
- 素材 ID 仍然只有火山方舟（Seedance）能用，这一点由平台决定，与本决策无关。
