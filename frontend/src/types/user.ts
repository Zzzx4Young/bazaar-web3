// User / 当前用户（mock，写死 alice）

export type NotificationKind = 'order' | 'favorite' | 'system'

export interface Notification {
  id: string
  kind: NotificationKind
  title: string
  body: string
  href?: string
  read: boolean
  createdAt: string // ISO
}

export interface User {
  id: string
  displayName: string
  avatarSeed: string
  walletAddress: string
  joinedAt: string // ISO
  /**
   * Optional link to a Seller profile when the user has registered as a
   * merchant. Mock-only — in production this would be a separate table.
   */
  linkedSellerId?: string
}