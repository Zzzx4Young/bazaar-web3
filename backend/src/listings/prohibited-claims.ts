const excludedClaims = [
  /版权.{0,8}(?:转让|出售|买断)/i,
  /著作权.{0,8}(?:转让|出售|买断)/i,
  /所有权.{0,8}(?:转让|出售|买断)/i,
  /独家产权|独占产权|独家所有权/i,
  /copyright\s+(?:transfer|assignment|sale)/i,
  /exclusive\s+(?:ownership|property\s+rights)/i
]

export function hasExcludedRightsClaim(...texts: (string | null | undefined)[]) {
  return excludedClaims.some((pattern) => texts.some((text) => pattern.test(text ?? '')))
}
