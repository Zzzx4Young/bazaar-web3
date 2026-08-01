// User / 当前用户（mock，写死 alice）

export interface User {
  id: string
  displayName: string
  avatarSeed: string
  walletAddress?: string // mock 一个 0x 开头的字符串
  joinedAt: string
}