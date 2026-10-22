import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { readConfig } from '../dist/config.js'
import { DatabaseService } from '../dist/database/database.service.js'

// These are fictional local test offers, not copied marketplace listings or verified seller claims.
// The image query describes the kind of object to source for the separate review package.
const catalog = {
  electronics: [
    ['头戴式蓝牙降噪耳机', 'wireless over ear headphones', 89, '蓝牙连接；头梁与耳罩完整，适合通勤及居家聆听'],
    ['便携式蓝牙音箱', 'portable bluetooth speaker', 49, '便携机身；适合书桌、旅行与小型聚会'],
    ['机械键盘', 'mechanical keyboard', 79, '有线连接；独立键帽与标准键位布局'],
    ['无线办公鼠标', 'wireless computer mouse', 29, '轻量化机身；适合笔记本和日常办公'],
    ['USB-C 多口扩展坞', 'usb c docking station', 45, '适合为笔记本扩展显示器和常用外设接口'],
    ['桌面电脑显示器', 'computer monitor 27 inch', 159, '适合桌面办公与日常内容创作；尺寸和底座以卖家清单为准'],
    ['微单相机机身', 'mirrorless digital camera', 399, '可更换镜头相机机身；镜头和存储卡另行确认'],
    ['定焦相机镜头', 'camera prime lens', 179, '适合人像及日常街拍；购买前需确认卡口'],
    ['桌面 USB 麦克风', 'usb microphone desk', 65, '桌面收音设备；适合视频会议与个人录音'],
    ['电子阅读器', 'ebook reader', 99, '电子墨水屏阅读设备；账号及数字内容不随设备转移'],
    ['运动相机', 'action camera', 149, '便携拍摄设备；支架、电池和防水配件以清单为准'],
    ['手持游戏控制器', 'video game controller', 45, '双摇杆控制器；购买前确认平台兼容性'],
    ['便携固态硬盘', 'external solid state drive', 69, 'USB 外置存储设备；容量和健康度以实测为准'],
    ['智能手表', 'smart watch', 119, '腕戴设备；配对前需确认可解除原账号绑定'],
    ['平板电脑', 'tablet computer', 229, '触控平板；容量、系统和电池状态请以卖家检测为准'],
    ['无反相机三脚架', 'camera tripod', 39, '可折叠摄影支架；承重及云台接口购买前确认'],
    ['桌面补光灯', 'led ring light desk', 32, '适合视频会议、产品摄影与桌面补光'],
    ['无线充电底座', 'wireless charging pad', 24, '桌面充电配件；兼容标准和充电器另行核对'],
    ['桌面电脑音箱', 'computer speakers desk', 59, '双声道桌面扬声器；连接方式以卖家清单为准'],
    ['便携投影仪', 'portable projector', 189, '小型家用投影设备；亮度和接口需实物确认']
  ],
  secondhand_fashion: [
    ['棉质牛仔夹克', 'denim jacket', 42, '日常休闲外套；肩宽、衣长和磨损处请核对实测'],
    ['帆布托特包', 'canvas tote bag', 24, '日常通勤手提包；尺寸与内袋以实物为准'],
    ['羊毛混纺针织衫', 'wool sweater', 38, '秋冬叠穿单品；洗护和起球情况请确认'],
    ['真皮斜挎包', 'leather crossbody bag', 68, '小型随身包；皮面划痕及五金状态请核对'],
    ['复古运动鞋', 'vintage sneakers', 54, '二手休闲鞋；鞋码和鞋底磨损需实测确认'],
    ['轻便风衣', 'trench coat', 63, '换季外套；面料、衣长与腰带配件请核对'],
    ['针织围巾', 'knitted scarf', 19, '秋冬配饰；面料成分和尺寸以卖家标签为准'],
    ['宽松亚麻衬衫', 'linen shirt', 31, '透气日常衬衫；尺码及色差以实物为准'],
    ['皮革腰带', 'leather belt', 22, '日常穿搭配件；长度和扣头磨损需确认'],
    ['帆布双肩背包', 'canvas backpack', 43, '通勤背包；容量、拉链和背带状态请核对']
  ],
  digital_assets: [
    ['游戏手柄按键图标素材包', 'game controller input icons', 19, '包含不同控制器与键鼠的输入提示图标；交付格式以清单为准'],
    ['电商商品卡片 UI 模板', 'ecommerce user interface design', 29, '商品列表与详情卡片布局素材；可用于界面原型'],
    ['社交媒体信息图素材', 'social media infographic', 15, '适合图文账号展示社交媒体数据的图表版式参考'],
    ['像素风角色素材包', 'pixel art character sprites', 25, '游戏角色帧素材；需按所附授权范围使用'],
    ['等距城市插画素材', 'isometric city illustration', 35, '用于演示和视觉稿的等距建筑插画'],
    ['信息图与统计图表素材', 'information graphics charts', 22, '包含多种主题的信息图和统计图表版式参考'],
    ['自然风景壁纸合集', 'nature landscape wallpaper', 12, '桌面与移动端分辨率壁纸文件'],
    ['手绘植物装饰图案', 'botanical illustration', 18, '适合包装和网页配图的植物元素'],
    ['几何纹理背景素材', 'geometric abstract pattern', 14, '重复纹理背景；适合网页和海报设计'],
    ['复古海报排版模板', 'vintage poster typography', 27, '可编辑标题、留白和装饰版式'],
    ['网页仪表盘组件', 'dashboard user interface design', 39, '数据卡片、导航和筛选组件设计稿'],
    ['餐饮菜单版式模板', 'restaurant menu design', 17, '适合咖啡馆和简餐品牌的菜单版式'],
    ['旅行路线信息图模板', 'travel map infographic', 21, '线路与站点信息展示模板'],
    ['抽象渐变背景合集', 'abstract gradient background', 13, '用于页面横幅与演示封面的渐变素材'],
    ['多场景展示背景素材', 'versatile background images', 28, '适合页面横幅与商品展示的不同背景图参考']
  ],
  software_source: [
    ['待办清单 Web 应用源码', 'task management app screenshot', 49, '包含任务列表、筛选和状态管理示例；部署环境需自行配置'],
    ['库存管理后台模板源码', 'inventory dashboard screenshot', 89, '商品、库存与报表页面示例；不含真实业务数据'],
    ['预约日历组件源码', 'calendar application screenshot', 55, '日期选择和预约时段的前端实现示例'],
    ['多语言文档站模板源码', 'documentation website screenshot', 69, '导航、搜索和文章页面布局示例'],
    ['开源图表仪表盘源码', 'analytics dashboard screenshot', 79, '常见统计卡片与图表页面示例'],
    ['个人作品集网站源码', 'portfolio website screenshot', 39, '响应式展示页面和项目详情示例'],
    ['商品目录前端模板源码', 'online store website screenshot', 65, '商品网格、筛选和详情页交互示例'],
    ['博客发布系统源码', 'blog editor screenshot', 59, '文章编辑、标签和列表页面示例'],
    ['客服工单面板源码', 'helpdesk dashboard screenshot', 75, '工单列表、详情和状态流转示例'],
    ['学习进度看板源码', 'learning dashboard screenshot', 52, '课程目录与学习进度显示示例']
  ],
  game_items: [
    ['像素地牢道具图标包', 'pixel art game items', 18, '适合像素风地牢游戏的道具图标素材'],
    ['奇幻地图地形素材', 'fantasy game map tiles', 24, '草地、道路和建筑图块示例'],
    ['桌游骰子模型素材', 'polyhedral dice', 16, '骰子造型与桌游界面配图素材'],
    ['低多边形宝箱模型', 'low poly treasure chest', 29, '适合游戏原型的宝箱模型示例'],
    ['角色状态图标合集', 'game status icons', 21, '生命、护盾和能量等状态图标'],
    ['复古街机按钮素材', 'arcade game buttons', 14, '街机风格菜单与按钮组件'],
    ['森林场景背景素材', 'game forest background', 19, '横向卷轴游戏场景背景示例'],
    ['太空飞船像素素材', 'pixel art spaceship', 23, '像素风飞船及特效元素'],
    ['卡牌边框界面素材', 'fantasy card game design', 17, '卡牌边框与信息栏版式示例'],
    ['回合制战斗界面素材', 'role playing game interface', 26, '角色头像、状态栏与操作区域版式']
  ]
}

function offer(category, index) {
  const entries = catalog[category]
  assert.ok(entries, `Unknown category: ${category}`)
  const [name, imageQuery, usdPrice, feature] = entries[index % entries.length]
  const edition = Math.floor(index / entries.length)
  assert.ok(edition < 6, `Catalog needs more variants for ${category}`)
  const digital = !['electronics', 'secondhand_fashion'].includes(category)
  const title = digital
    ? `${name}｜演示条目 ${String(edition + 1).padStart(2, '0')}（数字下载）`
    : `${name}（二手）｜测试库存 ${String(edition + 1).padStart(2, '0')}`
  const description = digital
    ? `${feature}。展示用测试商品；交付文件、格式、版本及授权范围以订单页面说明为准。图片仅作同类内容的视觉示意，不代表交付文件。`
    : `${feature}。展示用测试商品；具体成色、配件、尺寸及功能以卖家验货信息为准。图片为同类实拍示意，不代表本件商品实物。`
  return { title, description, priceAmount: String(usdPrice + edition * (digital ? 3 : 7)), currency: 'USD', imageQuery }
}

const config = readConfig()
const url = new URL(config.databaseUrl)
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
assert.equal(url.pathname, '/bazaar_dev')
assert.equal(url.searchParams.get('schema'), 'bazaar')

const apply = process.argv.includes('--apply')
const db = new DatabaseService(config.databaseUrl, config.databasePool)
await db.onModuleInit()
try {
  const sellers = await db.client.account.findMany({
    where: { loginName: { contains: '_seller_' } }, select: { id: true, loginName: true }
  })
  const testSellerIds = sellers.filter((seller) =>
    /^v2-stress(?:-r2)?_seller_[1-6]@test\.com$/.test(seller.loginName)).map((seller) => seller.id)
  const listings = await db.client.listing.findMany({
    where: { sellerId: { in: testSellerIds }, OR: [
      { description: { startsWith: 'V2 seeded description ' } },
      { description: { contains: '展示用测试商品；' } }
    ] },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    include: { _count: { select: { orderListingRows: true } } }
  })
  const categoryIndex = new Map()
  const plan = listings.map((listing) => {
    const index = categoryIndex.get(listing.category) ?? 0
    categoryIndex.set(listing.category, index + 1)
    const locked = listing.saleMode === 'one_off' && listing._count.orderListingRows > 0
    const product = locked ? null : offer(listing.category, index)
    return { id: listing.id, category: listing.category, publicationStatus: listing.publicationStatus,
      saleMode: listing.saleMode, orderCount: listing._count.orderListingRows, locked,
      before: { title: listing.title, description: listing.description,
        priceAmount: listing.priceAmount.toString(), currency: listing.currency,
        version: listing.version }, product }
  })
  const editable = plan.filter((row) => !row.locked)
  const pending = editable.filter((row) => row.before.title !== row.product.title ||
    row.before.description !== row.product.description ||
    row.before.priceAmount !== row.product.priceAmount ||
    row.before.currency !== row.product.currency)
  const folder = resolve(import.meta.dirname, '../../images/catalog-review')
  await mkdir(folder, { recursive: true })
  await writeFile(resolve(folder, 'catalog-plan.json'), JSON.stringify(plan, null, 2) + '\n')
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'preview', testListings: plan.length,
    locked: plan.length - editable.length, editable: editable.length, pending: pending.length,
    byStatus: Object.fromEntries([...new Set(editable.map((row) => row.publicationStatus))]
      .map((status) => [status, editable.filter((row) => row.publicationStatus === status).length])) }))
  if (apply) {
    const backup = resolve('.tmp', `catalog-backup-${Date.now()}.json`)
    await mkdir(resolve('.tmp'), { recursive: true })
    await writeFile(backup, JSON.stringify(plan.map(({ id, before }) => ({ id, before })), null, 2) + '\n')
    await db.client.$transaction(async (tx) => {
      for (const row of pending) {
        const changed = await tx.listing.updateMany({
          where: { id: row.id, version: row.before.version,
            description: row.before.description,
            ...(row.saleMode === 'one_off' ? { orderListingRows: { none: {} } } : {}) },
          data: { title: row.product.title, description: row.product.description,
            priceAmount: row.product.priceAmount, currency: row.product.currency,
            version: { increment: 1 } }
        })
        assert.equal(changed.count, 1, `Concurrent change: ${row.id}`)
      }
    }, { maxWait: 10000, timeout: 60000 })
    console.log(JSON.stringify({ updated: pending.length, backup }))
  }
} finally {
  await db.onModuleDestroy()
}
