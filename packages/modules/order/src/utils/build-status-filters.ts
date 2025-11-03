import type { Knex } from "@medusajs/framework/mikro-orm/knex"
import { isDefined } from "@medusajs/framework/utils"

/**
 * Build a subquery that computes the payment status for an order
 * based on its payment collections
 */
export function buildPaymentStatusSubquery(
  knex: Knex,
  orderAlias: string = "o0"
): Knex.Raw {
  return knex.raw(`
    (
      WITH payment_stats AS (
        SELECT 
          opc.order_id,
          COUNT(pc.id) FILTER (WHERE pc.status = 'requires_action') as requires_action_count,
          COUNT(pc.id) FILTER (WHERE pc.status = 'canceled') as canceled_count,
          COUNT(pc.id) FILTER (WHERE pc.status = 'awaiting') as awaiting_count,
          COUNT(pc.id) FILTER (WHERE pc.status = 'authorized') as authorized_count,
          COUNT(pc.id) as total_count,
          SUM(
            CASE 
              WHEN (pc.captured_amount IS NOT NULL AND (pc.captured_amount::numeric > 0 OR pc.amount::numeric = 0))
                   AND ABS((pc.amount::numeric - COALESCE(pc.captured_amount::numeric, 0))) <= 0.0001
              THEN 1
              WHEN (pc.captured_amount IS NOT NULL AND pc.captured_amount::numeric > 0)
              THEN 0.5
              ELSE 0
            END
          ) as captured_score,
          SUM(
            CASE 
              WHEN pc.refunded_amount IS NOT NULL AND pc.refunded_amount::numeric > 0
                   AND ABS((pc.amount::numeric - COALESCE(pc.refunded_amount::numeric, 0))) <= 0.0001
              THEN 1
              WHEN pc.refunded_amount IS NOT NULL AND pc.refunded_amount::numeric > 0
              THEN 0.5
              ELSE 0
            END
          ) as refunded_score
        FROM order_payment_collection opc
        INNER JOIN payment_collection pc ON pc.id = opc.payment_collection_id
        WHERE opc.order_id = "${orderAlias}".id
        GROUP BY opc.order_id
      )
      SELECT 
        CASE
          WHEN ps.requires_action_count > 0 THEN 'requires_action'
          WHEN ps.refunded_score > 0 AND ps.refunded_score = ps.captured_score THEN 'refunded'
          WHEN ps.refunded_score > 0 THEN 'partially_refunded'
          WHEN ps.captured_score > 0 AND ps.captured_score = (ps.total_count - ps.canceled_count) THEN 'captured'
          WHEN ps.captured_score > 0 THEN 'partially_captured'
          WHEN ps.authorized_count > 0 AND ps.authorized_count = (ps.total_count - ps.canceled_count) THEN 'authorized'
          WHEN ps.authorized_count > 0 THEN 'partially_authorized'
          WHEN ps.canceled_count > 0 AND ps.canceled_count = ps.total_count THEN 'canceled'
          WHEN ps.awaiting_count > 0 THEN 'awaiting'
          ELSE 'not_paid'
        END
      FROM payment_stats ps
    )
  `)
}

/**
 * Build a subquery that computes the fulfillment status for an order
 * based on its fulfillments and items
 */
export function buildFulfillmentStatusSubquery(
  knex: Knex,
  orderAlias: string = "o0"
): Knex.Raw {
  return knex.raw(`
    (
      WITH fulfillment_stats AS (
        SELECT 
          orf.order_id,
          COUNT(f.id) FILTER (WHERE f.canceled_at IS NOT NULL) as canceled_count,
          COUNT(f.id) FILTER (WHERE f.delivered_at IS NOT NULL) as delivered_count,
          COUNT(f.id) FILTER (WHERE f.shipped_at IS NOT NULL AND f.delivered_at IS NULL) as shipped_count,
          COUNT(f.id) FILTER (WHERE f.packed_at IS NOT NULL AND f.shipped_at IS NULL AND f.delivered_at IS NULL) as fulfilled_count,
          COUNT(f.id) as total_count
        FROM order_fulfillment orf
        INNER JOIN fulfillment f ON f.id = orf.fulfillment_id
        WHERE orf.order_id = "${orderAlias}".id
        GROUP BY orf.order_id
      ),
      item_stats AS (
        SELECT 
          oi.order_id,
          CASE 
            WHEN COUNT(*) FILTER (WHERE (oi.fulfilled_quantity::numeric) < (oi.quantity::numeric)) > 0 
            THEN true 
            ELSE false 
          END as has_unfulfilled_items
        FROM order_item oi
        WHERE oi.order_id = "${orderAlias}".id
          AND oi.version = "${orderAlias}".version
        GROUP BY oi.order_id
      )
      SELECT 
        CASE
          WHEN fs.delivered_count > 0 AND fs.delivered_count = (fs.total_count - fs.canceled_count) 
               AND COALESCE(its.has_unfulfilled_items, false) = false
          THEN 'delivered'
          WHEN fs.delivered_count > 0 THEN 'partially_delivered'
          WHEN fs.shipped_count > 0 AND fs.shipped_count = (fs.total_count - fs.canceled_count) 
               AND COALESCE(its.has_unfulfilled_items, false) = false
          THEN 'shipped'
          WHEN fs.shipped_count > 0 THEN 'partially_shipped'
          WHEN fs.fulfilled_count > 0 AND fs.fulfilled_count = (fs.total_count - fs.canceled_count) 
               AND COALESCE(its.has_unfulfilled_items, false) = false
          THEN 'fulfilled'
          WHEN fs.fulfilled_count > 0 THEN 'partially_fulfilled'
          WHEN fs.canceled_count > 0 AND fs.canceled_count = fs.total_count THEN 'canceled'
          ELSE 'not_fulfilled'
        END
      FROM fulfillment_stats fs
      LEFT JOIN item_stats its ON its.order_id = fs.order_id
      WHERE fs.order_id = "${orderAlias}".id
      UNION ALL
      SELECT 'not_fulfilled'
      WHERE NOT EXISTS (SELECT 1 FROM fulfillment_stats WHERE order_id = "${orderAlias}".id)
      LIMIT 1
    )
  `)
}

/**
 * Apply payment_status and fulfillment_status filters to a query builder
 * by adding WHERE clauses with subqueries
 */
export function applyStatusFilters(
  filters: any,
  queryBuilder: Knex.QueryBuilder,
  knex: Knex,
  orderAlias: string = "o0"
): void {
  if (isDefined(filters.payment_status)) {
    const paymentStatuses = Array.isArray(filters.payment_status)
      ? filters.payment_status
      : [filters.payment_status]

    queryBuilder.whereRaw(
      `${buildPaymentStatusSubquery(knex, orderAlias).toQuery()} IN (${paymentStatuses.map(() => '?').join(',')})`,
      paymentStatuses
    )
  }

  if (isDefined(filters.fulfillment_status)) {
    const fulfillmentStatuses = Array.isArray(filters.fulfillment_status)
      ? filters.fulfillment_status
      : [filters.fulfillment_status]

    queryBuilder.whereRaw(
      `${buildFulfillmentStatusSubquery(knex, orderAlias).toQuery()} IN (${fulfillmentStatuses.map(() => '?').join(',')})`,
      fulfillmentStatuses
    )
  }
}

