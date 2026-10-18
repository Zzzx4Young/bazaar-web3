export const illustrativeImageNotice = '示意图说明：图片仅展示商品类别，并非该商品实物或交付内容。'

export function hasIllustrativeImages(description: string): boolean {
  return description.includes(illustrativeImageNotice)
}
