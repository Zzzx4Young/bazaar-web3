# 本地测试商品图片审核

`catalog-plan.json` 将开发库中的测试商品 ID 映射到新标题、描述、价格及检索词。
其中 `locked: true` 的 75 件一次性商品已有订单，未修改其当前商品资料或历史订单快照。

`assets/` 存放从 Wikimedia Commons、Kenney 和开源项目页面收集的参考图片；`sources.json` 为每张图片
保留商品 ID、来源文件页、作者字段、许可、文件类型、大小及 SHA-256。浏览器打开
`review.html` 可以逐项核对图像与商品标题。`remaining.json` 列出尚未找到合适来源的商品。

当前已收集 225/225 张唯一候选图，其中实体商品 90 张、游戏素材 27 张、数字素材
81 张、源码类 27 张。开源项目仓库中的页面截图和本地截取的 Docusaurus 文档页
仅作待审参考；仓库代码许可不自动覆盖页面中可能出现的第三方图片、文字或商标。
Wikimedia Commons 通用搜索容易返回无关图，已改按素材分类、具体项目和文件页筛选。

2026-10-22 已通过卖家会话、上传接口和商品编辑接口，将 225 张图片分别作为 225 件
可编辑测试商品的主图导入本机 `bazaar_dev` 和 Garage；75 件已有订单的一次性商品未改动。
这些图仍只是同类内容示意，不能冒充实际二手商品实拍或数字交付文件预览。公开发布前
仍须核对具体授权及署名要求，确认图片和标题的相关性，并由卖家补充实际商品的成色、
配件与交付范围。开源项目截图的代码许可不能自动作为截图中第三方内容的授权。

商品数据更新脚本：`backend/scripts/refresh-local-test-catalog.mjs`。联网检索脚本：
`backend/scripts/download-catalog-review-images.mjs`，Kenney 素材脚本为
`backend/scripts/download-open-game-previews.mjs`，Commons 分类图片脚本为
`backend/scripts/download-commons-artwork.mjs`。项目截图脚本为
`backend/scripts/download-open-source-project-previews.mjs`、
`backend/scripts/download-final-source-previews.mjs`；替换误配图的脚本为
`backend/scripts/replace-catalog-review-mismatches.mjs`。旧目录里按品类复用的对象仍在
Garage；删除前要核对是否被其他商品或订单引用。导入后的独立 `--verify` 返回
225/225 主图哈希匹配、75/75 锁定商品未变；目前本机库中历史订单图片快照记录为 0，
因此本次无法以现存订单验证图片快照读取。

## 导入与细节图

`backend/scripts/apply-catalog-review-images.mjs` 只允许操作本机 `bazaar_dev`，先校验
225 份图片文件、映射和商品归属，再通过卖家登录、媒体上传和商品编辑接口替换主图。
在 `backend/` 目录以 `node --env-file=.env scripts/apply-catalog-review-images.mjs`
预览；追加 `--apply --limit=3` 做小批量试传，确认后再用 `--apply` 完成。
`--verify` 会核对全部 225 件的媒体哈希与可读性。每次导入前的旧媒体 ID 备份和逐件结果
记录在已忽略的 `backend/.tmp/catalog-review-media-*.json*`，不得放入版本库。

目前每件商品只有一张经筛选的候选图，因此先用作主图，不重复充当细节图，也不保留
旧的通用品类图凑数。后续细节图应按商品类型补充：二手实物需要同一件物品的背面、接口、
瑕疵和配件实拍；数字素材需要同一素材包的局部放大、文件结构或应用示例；源码商品需要
同一版本的功能页面、代码结构和运行结果截图。每张图都应有单独来源和许可记录，并在
卖家确认与交付物一致后上传；找不到可靠细节图的商品保持单图。
