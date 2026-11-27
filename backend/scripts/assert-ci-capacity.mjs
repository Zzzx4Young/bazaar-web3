import { readCapacityResources, assertCapacityResources } from './read-capacity-resources.mjs'
// Two tasks reserve up to 8 GB inclusive of 4.4 GB tmpfs, plus staged input and service/OS headroom.
const resources = await readCapacityResources()
console.log(
  JSON.stringify({
    event: 'private_capacity_admission',
    availableBytes: resources.availableBytes,
    requiredBytes: 12_000_000_000,
    cpus: resources.availableCpus,
    requiredCpus: 2,
    resources
  })
)
assertCapacityResources(resources)
