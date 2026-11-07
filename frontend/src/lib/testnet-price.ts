// Decimal text only. Test assets never use the existing currency conversion path.
export function validTestnetPrice(value: string) {
  if (value.length > 85 || !/^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$/.test(value)) return false
  const [whole = '0', fraction = ''] = value.split('.')
  const atoms = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'))
  return atoms > 0n && atoms <= (1n << 256n) - 1n
}
