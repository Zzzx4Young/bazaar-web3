import { randomUUID } from 'node:crypto'
import { Body, Controller, HttpCode, Inject, Param, Post, Req } from '@nestjs/common'
import { type AuthRequest } from '../auth/auth.guard.js'
import { DomainError } from '../common/domain-error.js'
import { idInput, objectInput, textInput } from '../common/input.js'
import { DatabaseService } from '../database/database.service.js'
import { transact } from '../database/transaction.js'
import { lockListing } from './listing-lock.js'
import { publicSourceUrl } from './product-commitment.js'

const openStatuses = ['pending_payment', 'pending_delivery', 'pending_acceptance', 'issue']

@Controller('listings')
export class ListingReviewController {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  @Post('review-queue')
  @HttpCode(200)
  async queue(@Req() request: AuthRequest) {
    if (request.auth.account.role !== 'admin') throw new DomainError('FORBIDDEN')
    const rows = await this.database.client.listing.findMany({
      where: { OR: [{ reviewPending: true }, { reviewStatus: { in: ['paused', 'rejected'] } }] },
      include: { reviewRows: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
        orderListingRows: { where: { transactionPausedAt: { not: null } },
          select: { id: true, status: true } } },
      orderBy: [{ reviewUpdatedAt: 'desc' }, { id: 'desc' }], take: 100
    })
    return rows.map((row) => ({ id: row.id, title: row.title, type: row.type,
      reviewStatus: row.reviewStatus, reviewPending: row.reviewPending, reviewKind: row.reviewKind,
      reviewReason: row.reviewReason, replacementOfListingId: row.replacementOfListingId, sellerId: row.sellerId,
      events: row.reviewRows, orders: row.orderListingRows }))
  }

  @Post(':id/report')
  @HttpCode(200)
  async report(@Req() request: AuthRequest, @Param('id') rawId: string, @Body() body: unknown) {
    if (request.auth.account.role === 'observer') throw new DomainError('FORBIDDEN')
    const id = idInput(rawId)
    const input = objectInput(body, ['kind', 'reason'], ['kind', 'reason'])
    if (input.kind !== 'source' && input.kind !== 'listing_rule')
      throw new DomainError('INVALID_INPUT')
    const reason = textInput(input.reason, 2000)
    return transact(this.database.client, async (tx) => {
      const listing = await lockListing(tx, id)
      if (listing.publicationStatus !== 'published') throw new DomainError('NOT_FOUND')
      if (listing.sellerId === request.auth.account.id) throw new DomainError('FORBIDDEN')
      if (await tx.listingReviewEvent.findFirst({ where: {
        listingId: id, actorId: request.auth.account.id, action: 'report',
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
      } })) throw new DomainError('STATE_CONFLICT')
      const reviewId = randomUUID()
      await tx.listingReviewEvent.create({ data: {
        id: reviewId, listingId: id, actorId: request.auth.account.id,
        action: 'report', kind: input.kind as string, reason
      } })
      if (listing.reviewStatus === 'clear' && !listing.reviewPending) {
        await tx.listing.update({ where: { id }, data: {
          reviewPending: true, reviewReason: reason, reviewKind: input.kind as string,
          reviewUpdatedAt: new Date()
        } })
      }
      return { status: 'received' }
    })
  }

  @Post(':id/pause-review')
  @HttpCode(200)
  async pause(@Req() request: AuthRequest, @Param('id') rawId: string, @Body() body: unknown) {
    if (request.auth.account.role !== 'admin') throw new DomainError('FORBIDDEN')
    const id = idInput(rawId)
    const input = objectInput(body, ['reason', 'kind'], ['reason', 'kind'])
    if (input.kind !== 'source' && input.kind !== 'listing_rule')
      throw new DomainError('INVALID_INPUT')
    const reason = textInput(input.reason, 2000)
    return transact(this.database.client, async (tx) => {
      const listing = await lockListing(tx, id)
      if (listing.reviewStatus !== 'clear' || !listing.reviewPending)
        throw new DomainError('STATE_CONFLICT')
      const reviewId = randomUUID()
      await tx.listingReviewEvent.create({ data: {
        id: reviewId, listingId: id, actorId: request.auth.account.id,
        action: 'pause', kind: input.kind as string, reason
      } })
      await tx.listing.update({ where: { id }, data: {
        reviewStatus: 'paused', reviewPending: false,
        reviewReason: reason, reviewKind: input.kind as string,
        reviewUpdatedAt: new Date(), version: { increment: 1 }
      } })
      const orders = await tx.order.findMany({
        where: { listingId: id, status: { in: openStatuses }, transactionPausedAt: null },
        select: { id: true, status: true }
      })
      for (const order of orders) {
        await tx.order.update({ where: { id: order.id }, data: {
          transactionPausedAt: new Date(), pauseReviewId: reviewId, version: { increment: 1 }
        } })
        await tx.orderEvent.create({ data: {
          orderId: order.id, actorId: request.auth.account.id,
          operation: 'listing_review_pause', fromState: order.status,
          toState: order.status, requestId: reviewId, note: reason
        } })
      }
      return { status: 'paused' }
    })
  }

  @Post(':id/dismiss-report')
  @HttpCode(200)
  async dismiss(@Req() request: AuthRequest, @Param('id') rawId: string, @Body() body: unknown) {
    if (request.auth.account.role !== 'admin') throw new DomainError('FORBIDDEN')
    const id = idInput(rawId)
    const input = objectInput(body, ['reason'], ['reason'])
    const reason = textInput(input.reason, 2000)
    return transact(this.database.client, async (tx) => {
      const listing = await lockListing(tx, id)
      if (listing.reviewStatus !== 'clear' || !listing.reviewPending)
        throw new DomainError('STATE_CONFLICT')
      await tx.listingReviewEvent.create({ data: {
        listingId: id, actorId: request.auth.account.id, action: 'dismiss_report',
        kind: listing.reviewKind, reason
      } })
      await tx.listing.update({ where: { id }, data: {
        reviewPending: false, reviewReason: reason, reviewUpdatedAt: new Date()
      } })
      return { status: 'clear' }
    })
  }

  @Post(':id/source-response')
  @HttpCode(200)
  async sourceResponse(@Req() request: AuthRequest, @Param('id') rawId: string,
    @Body() body: unknown) {
    if (request.auth.account.role !== 'participant') throw new DomainError('FORBIDDEN')
    const id = idInput(rawId)
    const input = objectInput(body, ['explanation', 'sourceUrl', 'creationProcess'],
      ['explanation'])
    const explanation = textInput(input.explanation, 2000)
    const sourceUrl = input.sourceUrl === undefined ? null : publicSourceUrl(input.sourceUrl)
    const creationProcess = input.creationProcess === undefined ? null
      : textInput(input.creationProcess, 2000)
    if (!sourceUrl && !creationProcess) throw new DomainError('INVALID_INPUT')
    return transact(this.database.client, async (tx) => {
      const listing = await lockListing(tx, id)
      if (listing.sellerId !== request.auth.account.id) throw new DomainError('FORBIDDEN')
      if (listing.reviewStatus !== 'paused' || listing.reviewKind !== 'source')
        throw new DomainError('STATE_CONFLICT')
      await tx.listingReviewEvent.create({ data: {
        listingId: id, actorId: request.auth.account.id, action: 'source_response',
        kind: 'source', reason: explanation,
        evidence: JSON.stringify({ sourceUrl, creationProcess })
      } })
      return { status: 'submitted' }
    })
  }

  @Post(':id/review')
  @HttpCode(200)
  async review(@Req() request: AuthRequest, @Param('id') rawId: string, @Body() body: unknown) {
    if (request.auth.account.role !== 'admin') throw new DomainError('FORBIDDEN')
    const id = idInput(rawId)
    const input = objectInput(body, ['outcome', 'reason'], ['outcome', 'reason'])
    if (typeof input.outcome !== 'string' ||
      !['resume', 'continue_pause', 'rule_violation'].includes(input.outcome))
      throw new DomainError('INVALID_INPUT')
    const reason = textInput(input.reason, 2000)
    return transact(this.database.client, async (tx) => {
      const listing = await lockListing(tx, id)
      if (listing.reviewStatus !== 'paused') throw new DomainError('STATE_CONFLICT')
      if (input.outcome === 'resume' && listing.replacementOfListingId) {
        const old = await lockListing(tx, listing.replacementOfListingId)
        if ((old.reviewStatus === 'clear' && old.commitmentVersion === 1 && old.commitment) ||
          (await tx.order.count({ where: { listingId: old.id,
            status: { in: openStatuses }
          } }))) throw new DomainError('UNAVAILABLE')
        const inventory = old.type === 'physical'
          ? await tx.physicalInventory.findUnique({ where: { listingId: old.id } })
          : await tx.digitalInventory.findUnique({ where: { listingId: old.id } })
        if (inventory && (inventory.availability !== 'available' || inventory.activeOrderId))
          throw new DomainError('UNAVAILABLE')
      }
      if (input.outcome === 'resume' &&
        await tx.listing.count({ where: { replacementOfListingId: id,
          reviewStatus: { in: ['paused', 'clear'] } } }))
        throw new DomainError('UNAVAILABLE')
      if (input.outcome === 'resume' && listing.reviewKind === 'source' &&
        !(await tx.listingReviewEvent.findFirst({
          where: { listingId: id, action: 'source_response',
            createdAt: { gte: listing.reviewUpdatedAt ?? listing.createdAt } }
        }))) throw new DomainError('STATE_CONFLICT')
      const next = input.outcome === 'resume' ? 'clear'
        : input.outcome === 'rule_violation' ? 'rejected' : 'paused'
      const reviewId = randomUUID()
      await tx.listingReviewEvent.create({ data: {
        id: reviewId, listingId: id, actorId: request.auth.account.id,
        action: input.outcome as string, kind: listing.reviewKind, reason
      } })
      await tx.listing.update({ where: { id }, data: {
        reviewStatus: next, reviewReason: reason, reviewUpdatedAt: new Date(),
        version: { increment: 1 }
      } })
      if (next === 'clear') {
        const orders = await tx.order.findMany({ where: {
          listingId: id, status: { in: openStatuses }, transactionPausedAt: { not: null }
        }, select: { id: true, status: true } })
        for (const order of orders) {
          await tx.order.update({ where: { id: order.id }, data: {
            transactionPausedAt: null, pauseReviewId: null, version: { increment: 1 }
          } })
          await tx.orderEvent.create({ data: {
            orderId: order.id, actorId: request.auth.account.id,
            operation: 'listing_review_resume', fromState: order.status,
            toState: order.status, requestId: reviewId, note: reason
          } })
        }
      }
      return { status: next }
    })
  }

  @Post(':id/review-history')
  @HttpCode(200)
  async history(@Req() request: AuthRequest, @Param('id') rawId: string) {
    const id = idInput(rawId)
    const listing = await this.database.client.listing.findUnique({ where: { id } })
    if (!listing) throw new DomainError('NOT_FOUND')
    if (request.auth.account.role !== 'admin' &&
      request.auth.account.id !== listing.sellerId) throw new DomainError('FORBIDDEN')
    const events = await this.database.client.listingReviewEvent.findMany({
      where: { listingId: id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
    })
    return request.auth.account.role === 'admin' ? events
      : events.map((event) => ({ id: event.id, listingId: event.listingId,
        action: event.action, kind: event.kind, reason: event.reason,
        evidence: event.evidence, createdAt: event.createdAt }))
  }

  @Post(':id/review-orders/:orderId/resolve')
  @HttpCode(200)
  async resolveAffectedOrder(@Req() request: AuthRequest, @Param('id') rawId: string,
    @Param('orderId') rawOrderId: string, @Body() body: unknown) {
    if (request.auth.account.role !== 'admin') throw new DomainError('FORBIDDEN')
    const id = idInput(rawId), orderId = idInput(rawOrderId)
    const input = objectInput(body, ['reason', 'returnOutcome'], ['reason'])
    const reason = textInput(input.reason, 2000)
    return transact(this.database.client, async (tx) => {
      const listing = await lockListing(tx, id)
      if (listing.reviewStatus !== 'rejected') throw new DomainError('STATE_CONFLICT')
      await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId}::uuid FOR UPDATE`
      const order = await tx.order.findUnique({ where: { id: orderId }, include: { snapshot: true } })
      if (!order || order.listingId !== id) throw new DomainError('NOT_FOUND')
      if (!order.transactionPausedAt || !openStatuses.includes(order.status) || !order.snapshot)
        throw new DomainError('STATE_CONFLICT')
      const refund = order.status !== 'pending_payment'
      const next = refund ? 'refunded' : 'cancelled'
      if (refund) {
        const payment = await tx.settlementRecord.findUnique({ where: {
          orderId_operation: { orderId, operation: 'payment' }
        } })
        if (!payment) throw new DomainError('REFUND_REQUIRED')
        if (listing.type === 'physical' &&
          !['not_sent', 'returned', 'not_required'].includes(String(input.returnOutcome)))
          throw new DomainError('RETURN_REQUIRED')
        await tx.settlementRecord.create({ data: {
          orderId, operation: 'refund', amount: order.snapshot.priceAmount,
          currency: order.snapshot.currency
        } })
        await tx.refundRequest.updateMany({
          where: { orderId, status: 'pending' }, data: { status: 'closed' }
        })
        await tx.issueRecord.updateMany({
          where: { orderId, status: 'open' },
          data: { status: 'resolved', resolvedAt: new Date() }
        })
      }
      if (listing.type === 'physical') {
        await tx.inventoryReservation.update({ where: { orderId }, data: {
          state: next, closedAt: new Date()
        } })
        await tx.physicalInventory.update({ where: { listingId: id }, data: {
          availability: refund ? 'refund_hold' : 'available',
          activeOrderId: refund ? orderId : null, version: { increment: 1 }
        } })
      } else {
        const inventory = await tx.digitalInventory.findUnique({ where: { listingId: id } })
        if (inventory) await tx.digitalInventory.update({ where: { listingId: id }, data: {
          availability: refund ? 'refund_hold' : 'available',
          activeOrderId: refund ? orderId : null, version: { increment: 1 }
        } })
      }
      await tx.order.update({ where: { id: orderId }, data: {
        status: next, transactionPausedAt: null, pauseReviewId: null,
        version: { increment: 1 }
      } })
      await tx.orderEvent.create({ data: {
        orderId, actorId: request.auth.account.id, operation: `review_${next}`,
        fromState: order.status, toState: next, requestId: randomUUID(),
        note: refund && listing.type === 'physical'
          ? `${reason} (return: ${String(input.returnOutcome)})` : reason
      } })
      return { status: next }
    })
  }
}
