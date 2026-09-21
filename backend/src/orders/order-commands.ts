import { type PrismaClient, type Order } from '../generated/prisma/client.js'
import { DomainError } from '../common/domain-error.js'
import { transact, type TransactionOptions, type Transaction } from '../database/transaction.js'
import { idempotent } from './order-idempotency.js'
import { lockListing } from '../listings/listing-lock.js'
import { requireActiveAccount } from '../accounts/require-active-account.js'

export interface CreateOrderInput {
  listingId: string
  version: number
  shipping?: { recipient: string; contact: string; address: string }
}
export type OrderAction =
  | 'cancel'
  | 'expire'
  | 'pay'
  | 'deliver'
  | 'issue'
  | 'request_refund'
  | 'accept'
  | 'refund'
  | 'restore'
export interface ActionInput {
  carrier?: string
  accessCode?: string
  reference?: string
  description?: string
  returnOutcome?: string
  inHandAndResellable?: boolean
}

// C1 application layer. actorId must be supplied by a trusted authentication boundary.
// No business HTTP routes are exposed before C2/C3 authentication and contracts are ready.
export class OrderCommands {
  constructor(private readonly client: PrismaClient) {}

  async create(
    actorId: string,
    key: string,
    input: CreateOrderInput,
    options: TransactionOptions = {}
  ) {
    return transact(
      this.client,
      async (tx, attempt) => {
        await requireActiveAccount(tx, actorId)
        return idempotent(
          tx,
          actorId,
          'create',
          key,
          {
            listingId: input.listingId,
            version: input.version,
            shipping: input.shipping
              ? [input.shipping.recipient, input.shipping.contact, input.shipping.address]
              : null
          },
          async () => {
            const listing = await lockListing(tx, input.listingId)
            if (listing.type === 'digital' && input.shipping) throw new DomainError('INVALID_INPUT')
            await options.checkpoint?.('locked', tx, attempt)
            if (listing.sellerId === actorId) throw new DomainError('FORBIDDEN')
            if (listing.publicationStatus !== 'published' || listing.version !== input.version)
              throw new DomainError('LISTING_CONFLICT')
            const inventory = listing.type === 'physical'
              ? await tx.physicalInventory.findUnique({ where: { listingId: listing.id } })
              : await tx.digitalInventory.findUnique({ where: { listingId: listing.id } })
            if (
              listing.type === 'physical' &&
              (!inventory || inventory.availability !== 'available')
            )
              throw new DomainError('UNAVAILABLE')
            if (listing.type === 'digital' && inventory && inventory.availability !== 'available')
              throw new DomainError('UNAVAILABLE')
            if (listing.type === 'physical' && !input.shipping)
              throw new DomainError('SHIPPING_REQUIRED')
            const order = await tx.order.create({
              data: { listingId: listing.id, buyerId: actorId, sellerId: listing.sellerId }
            })
            if (listing.type === 'physical') {
              await tx.physicalInventory.update({
                where: { listingId: listing.id },
                data: {
                  availability: 'reserved',
                  activeOrderId: order.id,
                  version: { increment: 1 }
                }
              })
              await tx.inventoryReservation.create({
                data: { listingId: listing.id, orderId: order.id }
              })
            } else if (inventory) {
              await tx.digitalInventory.update({
                where: { listingId: listing.id },
                data: {
                  availability: 'reserved',
                  activeOrderId: order.id,
                  version: { increment: 1 }
                }
              })
            }
            await options.checkpoint?.('inventory', tx, attempt)
            await tx.orderSnapshot.create({
              data: {
                orderId: order.id,
                listingVersion: listing.version,
                title: listing.title,
                description: listing.description,
                type: listing.type,
                category: listing.category,
                priceAmount: listing.priceAmount,
                currency: listing.currency,
                licenseDescription: listing.licenseDescription,
                contentVersion: listing.contentVersion
              }
            })
            if (listing.type === 'physical' && input.shipping)
              await tx.orderShipping.create({
                data: {
                  orderId: order.id,
                  recipient: input.shipping.recipient,
                  contact: input.shipping.contact,
                  address: input.shipping.address
                }
              })
            await options.checkpoint?.('snapshot', tx, attempt)
            await this.event(tx, order, actorId, 'create', key, null, order.status)
            await options.checkpoint?.('event', tx, attempt)
            return order.id
          }
        )
      },
      options
    )
  }

  private async event(
    tx: Transaction,
    order: Order,
    actorId: string,
    operation: string,
    key: string,
    fromState: string | null,
    toState: string
  ) {
    await tx.orderEvent.create({
      data: { orderId: order.id, actorId, operation, requestId: key, fromState, toState }
    })
  }

  async act(
    actorId: string,
    key: string,
    orderId: string,
    action: OrderAction,
    input: ActionInput = {},
    options: TransactionOptions = {}
  ) {
    if (
      ![
        'cancel',
        'expire',
        'pay',
        'deliver',
        'issue',
        'request_refund',
        'accept',
        'refund',
        'restore'
      ].includes(action)
    )
      throw new DomainError('INVALID_INPUT')
    return transact(
      this.client,
      async (tx, attempt) => {
        await requireActiveAccount(tx, actorId)
        return idempotent(
          tx,
          actorId,
          action,
          key,
          {
            orderId,
            reference: input.reference ?? null,
            ...(input.carrier !== undefined ? { carrier: input.carrier } : {}),
            ...(input.accessCode !== undefined ? { accessCode: input.accessCode } : {}),
            description: input.description ?? null,
            returnOutcome: input.returnOutcome ?? null,
            inHandAndResellable: input.inHandAndResellable ?? false
          },
          async () => {
            const hint = await tx.order.findUnique({ where: { id: orderId } })
            if (!hint) throw new DomainError('NOT_FOUND')
            const listing = await lockListing(tx, hint.listingId)
            await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId}::uuid FOR UPDATE`
            const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } })
            await options.checkpoint?.('locked', tx, attempt)
            const sellerAction = ['deliver', 'refund', 'restore'].includes(action)
            if (actorId !== (sellerAction ? order.sellerId : order.buyerId))
              throw new DomainError('FORBIDDEN')
            const physical = listing.type === 'physical'
            const inventory = physical
              ? await tx.physicalInventory.findUnique({ where: { listingId: listing.id } })
              : await tx.digitalInventory.findUnique({ where: { listingId: listing.id } })
            if (
              (physical || (inventory && action !== 'restore')) &&
              (inventory?.activeOrderId !== orderId ||
                inventory.availability !== (action === 'restore' ? 'refund_hold' : 'reserved'))
            )
              throw new DomainError('INVENTORY_CONFLICT')
            const snapshot = await tx.orderSnapshot.findUniqueOrThrow({ where: { orderId } })
            let next = order.status
            const requireStatus = (...states: string[]) => {
              if (!states.includes(order.status)) throw new DomainError('STATE_CONFLICT')
            }
            const closeInventory = async (state: string, availability: string) => {
              if (physical) {
                await tx.inventoryReservation.update({
                  where: { orderId },
                  data: { state, closedAt: new Date() }
                })
                await tx.physicalInventory.update({
                  where: { listingId: listing.id },
                  data: {
                    availability,
                    activeOrderId: availability === 'available' ? null : orderId,
                    version: { increment: 1 }
                  }
                })
              } else if (inventory) {
                await tx.digitalInventory.update({
                  where: { listingId: listing.id },
                  data: {
                    availability,
                    activeOrderId: availability === 'available' ? null : orderId,
                    version: { increment: 1 }
                  }
                })
              }
            }
            const settle = async (operation: string) => {
              await tx.settlementRecord.create({
                data: {
                  orderId,
                  operation,
                  amount: snapshot.priceAmount,
                  currency: snapshot.currency
                }
              })
              await options.checkpoint?.('settlement', tx, attempt)
            }
            switch (action) {
              case 'cancel':
                requireStatus('pending_payment')
                next = 'cancelled'
                await closeInventory('cancelled', 'available')
                break
              case 'expire':
                requireStatus('pending_payment')
                next = 'expired'
                await closeInventory('expired', 'available')
                break
              case 'pay':
                requireStatus('pending_payment')
                next = 'pending_delivery'
                await settle('payment')
                break
              case 'deliver': {
                requireStatus('pending_delivery', 'issue')
                if (!input.reference) throw new DomainError('DELIVERY_REQUIRED')
                const sequence = (await tx.deliveryRecord.count({ where: { orderId } })) + 1
                await tx.deliveryRecord.create({
                  data: {
                    orderId,
                    sellerId: actorId,
                    sequence,
                    kind: snapshot.type,
                    reference: input.reference,
                    carrier: input.carrier,
                    accessCode: input.accessCode
                  }
                })
                next = order.status === 'issue' ? 'issue' : 'pending_acceptance'
                break
              }
              case 'issue':
                requireStatus('pending_delivery', 'pending_acceptance')
                next = 'issue'
                if (!input.description) throw new DomainError('DESCRIPTION_REQUIRED')
                await tx.issueRecord.create({
                  data: {
                    orderId,
                    buyerId: actorId,
                    sourceStatus: order.status,
                    description: input.description
                  }
                })
                break
              case 'request_refund': {
                requireStatus('issue')
                const issue = await tx.issueRecord.findFirstOrThrow({
                  where: { orderId, status: 'open' }
                })
                await tx.refundRequest.create({
                  data: { orderId, issueId: issue.id, requestedBy: actorId }
                })
                break
              }
              case 'accept':
                requireStatus('pending_acceptance', 'issue')
                if ((await tx.deliveryRecord.count({ where: { orderId } })) === 0)
                  throw new DomainError('DELIVERY_REQUIRED')
                next = 'completed'
                await closeInventory('completed', 'sold')
                await tx.issueRecord.updateMany({
                  where: { orderId, status: 'open' },
                  data: { status: 'resolved', resolvedAt: new Date() }
                })
                await tx.refundRequest.updateMany({
                  where: { orderId, status: 'pending' },
                  data: { status: 'closed' }
                })
                break
              case 'refund': {
                requireStatus('issue')
                const request = await tx.refundRequest.findFirst({
                  where: { orderId, status: 'pending' }
                })
                const payment = await tx.settlementRecord.findUnique({
                  where: { orderId_operation: { orderId, operation: 'payment' } }
                })
                if (!request || !payment) throw new DomainError('REFUND_REQUIRED')
                if (
                  physical &&
                  !['not_sent', 'returned', 'not_required'].includes(input.returnOutcome ?? '')
                )
                  throw new DomainError('RETURN_REQUIRED')
                await settle('refund')
                next = 'refunded'
                await tx.refundRequest.update({
                  where: { id: request.id },
                  data: {
                    status: 'approved',
                    approvedBy: actorId,
                    approvedAt: new Date(),
                    returnOutcome: physical ? input.returnOutcome : 'digital'
                  }
                })
                await tx.issueRecord.update({
                  where: { id: request.issueId },
                  data: { status: 'resolved', resolvedAt: new Date() }
                })
                await closeInventory('refunded', 'refund_hold')
                break
              }
              case 'restore':
                requireStatus('refunded')
                if (
                  !physical ||
                  !input.inHandAndResellable ||
                  !(await tx.settlementRecord.findUnique({
                    where: { orderId_operation: { orderId, operation: 'refund' } }
                  }))
                )
                  throw new DomainError('RESTORE_CONFLICT')
                await tx.physicalInventory.update({
                  where: { listingId: listing.id },
                  data: {
                    availability: 'available',
                    activeOrderId: null,
                    version: { increment: 1 }
                  }
                })
                break
            }
            if (action !== 'restore')
              await tx.order.update({
                where: { id: orderId },
                data: { status: next, version: { increment: 1 } }
              })
            await this.event(tx, order, actorId, action, key, order.status, next)
            await options.checkpoint?.('event', tx, attempt)
            return orderId
          }
        )
      },
      options
    )
  }

  async expirePendingPaymentOrders(before: Date, options: { limit?: number } = {}) {
    const candidates = await this.client.order.findMany({
      where: { status: 'pending_payment', createdAt: { lt: before } },
      select: { id: true, buyerId: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: options.limit ?? 100
    })
    const expired: string[] = []
    for (const order of candidates) {
      try {
        await this.act(order.buyerId, `system-expire-${order.id}`, order.id, 'expire')
        expired.push(order.id)
      } catch (error) {
        if (!(error instanceof DomainError) || !['STATE_CONFLICT', 'INVENTORY_CONFLICT'].includes(error.code))
          throw error
      }
    }
    return { expired, scanned: candidates.length }
  }
}
