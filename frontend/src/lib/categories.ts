import type { Category } from '@/types'

export const marketplaceCategories: Category[] = [
  {
    id: 'electronics',
    label: '电子数码',
    itemCategory: 'physical',
    icon: 'Smartphone',
    subcategories: ['手机', '笔记本', '平板', '耳机', '游戏机'],
    itemIds: []
  },
  {
    id: 'digital_assets',
    label: '数字资产',
    itemCategory: 'digital',
    icon: 'Coins',
    subcategories: ['域名', '数字凭证', '会员权益'],
    itemIds: []
  },
  {
    id: 'software_source',
    label: '软件源码',
    itemCategory: 'digital',
    icon: 'Code2',
    subcategories: ['前端模板', '脚本', '组件库', '主题'],
    itemIds: []
  },
  {
    id: 'game_items',
    label: '游戏道具',
    itemCategory: 'digital',
    icon: 'Gamepad2',
    subcategories: ['游戏授权', '道具', '存档'],
    itemIds: []
  },
  {
    id: 'secondhand_fashion',
    label: '二手服饰',
    itemCategory: 'physical',
    icon: 'Shirt',
    subcategories: ['服饰', '鞋履', '配件', '外套'],
    itemIds: []
  }
]
