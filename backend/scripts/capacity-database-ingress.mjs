// One fixed database endpoint per API; replacement processes retain their original endpoint.
export function validateSecondDatabaseAddress(address) {
  if (typeof address !== 'string' || !/^127\.0\.0\.1:[1-9]\d{0,4}$/.test(address) ||
    Number(address.split(':')[1]) > 65535)
    throw new Error('Second database ingress must be an explicit loopback port')
  return address
}

export function capacityDatabaseUrls(runtimeUrl, secondAddress) {
  const first = new URL(runtimeUrl)
  const second = new URL(runtimeUrl)
  if (secondAddress !== undefined) {
    validateSecondDatabaseAddress(secondAddress)
    if (first.hostname !== '127.0.0.1' || first.host === secondAddress)
      throw new Error('Dual database ingress requires distinct loopback endpoints')
    second.host = secondAddress
  }
  return [first, second]
}
