import { Constructor, Context, DAL } from "@medusajs/framework/types"
import { toMikroORMEntity } from "@medusajs/framework/utils"
import { LoadStrategy } from "@medusajs/framework/mikro-orm/core"
import { Order, OrderClaim } from "@models"
import { applyStatusFilters, mapRepositoryToOrderModel } from "."

/**
 * Apply calculated field filters (payment_status, fulfillment_status) to a query.
 * These fields are not database columns but are calculated via subqueries.
 *
 * @returns The query result if filters were applied, null otherwise
 */
async function applyCalculatedFieldFilters<T>(
  manager: any,
  entity: any,
  config: any,
  knex: any,
  orderAlias: string,
  isCount: boolean
): Promise<[T[], number] | T[] | null> {

  console.log("config", config)

  // Extract status filters FIRST (before any deletion)
  const paymentStatusFilter = config.where.payment_status
  const fulfillmentStatusFilter = config.where.fulfillment_status

  console.log("paymentStatusFilter", paymentStatusFilter)
  console.log("fulfillmentStatusFilter", fulfillmentStatusFilter)

  // Return null if no status filters are present
  if (!paymentStatusFilter && !fulfillmentStatusFilter) {
    return null
  }

  // Create a CLEAN where object without status fields (don't mutate original)
  const cleanWhere = { ...config.where }
  delete cleanWhere.payment_status
  delete cleanWhere.fulfillment_status

  console.log("cleanWhere AFTER delete", cleanWhere)

  // Build query with status filters - ensure all options are clean before building
  const rawPopulate = config.options.populate || []
  const cleanedPopulate = Array.isArray(rawPopulate)
    ? rawPopulate.filter((p) => p && typeof p === 'string' && p.trim() !== '')
    : []


  console.log("cleanedPopulate", cleanedPopulate)
  
  const cleanedFields = config.options.fields
    ? config.options.fields.filter((f) => f && typeof f === 'string' && f.trim() !== "" && f !== "payment_status" && f !== "fulfillment_status")
    : undefined

  const cleanedOptions = {
    ...config.options,
    populate: cleanedPopulate,
    fields: cleanedFields,
  }

  console.log("cleanedOptions", cleanedOptions)

  const qb = manager.qb(entity)
  qb.where(cleanWhere)

  // Apply cleaned populate - only if we have valid values
  if (cleanedPopulate.length > 0) {
    qb.populate(cleanedPopulate)
  }

  // Apply cleaned fields
  if (cleanedOptions.fields && cleanedOptions.fields.length > 0) {
    qb.select(cleanedOptions.fields)
  }

  if (cleanedOptions.limit) {
    qb.limit(cleanedOptions.limit)
  }

  if (cleanedOptions.offset) {
    qb.offset(cleanedOptions.offset)
  }

  if (cleanedOptions.orderBy) {
    Object.entries(cleanedOptions.orderBy).forEach(([key, direction]) => {
      qb.orderBy({ [key]: direction })
    })
  }

  if (cleanedOptions.populateWhere) {
    const validPopulateKeys = Object.keys(cleanedOptions.populateWhere).filter(k => k != null && k !== "" && typeof k === 'string')
    if (validPopulateKeys.length > 0) {
      // Don't override if already populated
      const newPopulate = validPopulateKeys.filter(k => !cleanedOptions.populate.includes(k))
      if (newPopulate.length > 0) {
        qb.populate(newPopulate, cleanedOptions.populateWhere)
      }
    }
  }

  // Apply SQL subqueries for status filtering
  // Get Knex query ONLY ONCE after all QB operations are done
  const knexQuery = qb.getKnexQuery()
  
  applyStatusFilters(
    { payment_status: paymentStatusFilter, fulfillment_status: fulfillmentStatusFilter },
    knexQuery,
    knex,
    orderAlias
  )

  // Execute query and return results
  return isCount ? await qb.getResultAndCount() : await qb.getResultList()
}

export function setFindMethods<T>(klass: Constructor<T>, entity: any) {
  klass.prototype.find = async function find(
    this: any,
    options?: DAL.FindOptions<T>,
    context?: Context
  ): Promise<T[]> {
    const manager = this.getActiveManager(context)
    const knex = manager.getKnex()

    const findOptions_ = { ...options } as any
    findOptions_.options ??= {}
    findOptions_.where ??= {}

    if (!("strategy" in findOptions_.options)) {
      if (findOptions_.options.limit != null || findOptions_.options.offset) {
        Object.assign(findOptions_.options, {
          strategy: LoadStrategy.SELECT_IN,
        })
      }
    }

    const isRelatedEntity = entity.name !== Order.name

    const config = mapRepositoryToOrderModel(findOptions_, isRelatedEntity)
    config.options ??= {}
    config.options.populate ??= []

    const strategy = findOptions_.options.strategy ?? LoadStrategy.JOINED
    let orderAlias = "o0"
    if (isRelatedEntity) {
      if (entity === OrderClaim) {
        config.options.populate.push("claim_items")
      }

      if (strategy === LoadStrategy.JOINED) {
        config.options.populate.push("order.shipping_methods")
        config.options.populate.push("order.summary")
        config.options.populate.push("shipping_methods")
      }

      if (!config.options.populate.includes("order.items")) {
        config.options.populate.unshift("order.items")
      }

      // first relation is always order if the entity is not Order
      const index = config.options.populate.findIndex((p) => p === "order")
      if (index > -1) {
        config.options.populate.splice(index, 1)
      }

      config.options.populate.unshift("order")
      orderAlias = "o1"
    }

    let defaultVersion = knex.raw(`"${orderAlias}"."version"`)

    if (strategy === LoadStrategy.SELECT_IN) {
      const sql = manager
        .qb(toMikroORMEntity(Order), "_sub0")
        .select("version")
        .where({ id: knex.raw(`"${orderAlias}"."order_id"`) })
        .getKnexQuery()
        .toString()

      defaultVersion = knex.raw(`(${sql})`)
    }

    const version = config.where?.version ?? defaultVersion
    delete config.where?.version

    configurePopulateWhere(config, isRelatedEntity, version)

    if (!config.options.orderBy) {
      config.options.orderBy = { id: "ASC" }
    }

    config.where ??= {}

    // Try to apply calculated field filters (payment_status, fulfillment_status)
    const result = await applyCalculatedFieldFilters<T>(
      manager,
      this.entity,
      config,
      knex,
      orderAlias,
      false
    )

    if (result !== null) {
      return result as T[]
    }

    return await manager.find(this.entity, config.where, config.options)
  }

  klass.prototype.findAndCount = async function findAndCount(
    this: any,
    findOptions: DAL.FindOptions<T> = { where: {} } as DAL.FindOptions<T>,
    context: Context = {}
  ): Promise<[T[], number]> {
    const manager = this.getActiveManager(context)
    const knex = manager.getKnex()

    const findOptions_ = { ...findOptions } as any
    findOptions_.options ??= {}
    findOptions_.where ??= {}

    if (!("strategy" in findOptions_.options)) {
      Object.assign(findOptions_.options, {
        strategy: LoadStrategy.SELECT_IN,
      })
    }

    const isRelatedEntity = entity.name !== Order.name

    const config = mapRepositoryToOrderModel(findOptions_, isRelatedEntity)

    let orderAlias = "o0"
    if (isRelatedEntity) {
      if (entity === OrderClaim) {
        if (
          config.options.populate.includes("additional_items") &&
          !config.options.populate.includes("claim_items")
        ) {
          config.options.populate.push("claim_items")
        }
      }

      const index = config.options.populate.findIndex((p) => p === "order")
      if (index > -1) {
        config.options.populate.splice(index, 1)
      }

      config.options.populate.unshift("order")
      orderAlias = "o1"
    }

    let defaultVersion = knex.raw(`"${orderAlias}"."version"`)
    const strategy = config.options.strategy ?? LoadStrategy.JOINED
    if (strategy === LoadStrategy.SELECT_IN) {
      defaultVersion = getVersionSubQuery(manager, orderAlias)
    }

    const version = config.where.version ?? defaultVersion
    delete config.where.version

    configurePopulateWhere(
      config,
      isRelatedEntity,
      version,
      strategy === LoadStrategy.SELECT_IN,
      manager
    )

    if (!config.options.orderBy) {
      config.options.orderBy = { id: "ASC" }
    }

    // Try to apply calculated field filters (payment_status, fulfillment_status)
    const result = await applyCalculatedFieldFilters<T>(
      manager,
      this.entity,
      config,
      knex,
      orderAlias,
      true
    )

    if (result !== null) {
      return result as [T[], number]
    }

    return await manager.findAndCount(this.entity, config.where, config.options)
  }
}

function getVersionSubQuery(manager, alias, field = "order_id") {
  const knex = manager.getKnex()
  const sql = manager
    .qb(toMikroORMEntity(Order), "_sub0")
    .select("version")
    .where({ id: knex.raw(`"${alias}"."${field}"`) })
    .getKnexQuery()
    .toString()

  return knex.raw(`(${sql})`)
}

function configurePopulateWhere(
  config: any,
  isRelatedEntity: boolean,
  version: any,
  isSelectIn = false,
  manager?
) {
  const requestedPopulate = config.options?.populate ?? []
  const hasRelation = (relation: string) =>
    requestedPopulate.some(
      (p) => p === relation || p.startsWith(`${relation}.`)
    )

  config.options.populateWhere ??= {}
  const popWhere = config.options.populateWhere

  // isSelectIn && isRelatedEntity - Order is always the FROM clause (field o0.id)
  if (isRelatedEntity) {
    popWhere.order ??= {}

    const popWhereOrder = popWhere.order

    popWhereOrder.version = isSelectIn
      ? getVersionSubQuery(manager, "o0", "id")
      : version

    // related entity shipping method
    if (hasRelation("shipping_methods")) {
      popWhere.shipping_methods ??= {}
      popWhere.shipping_methods.version = isSelectIn
        ? getVersionSubQuery(manager, "s0")
        : version
    }

    if (hasRelation("items") || hasRelation("order.items")) {
      popWhereOrder.items ??= {}
      popWhereOrder.items.version = isSelectIn
        ? getVersionSubQuery(manager, "o0", "id")
        : version
    }

    if (hasRelation("shipping_methods")) {
      popWhereOrder.shipping_methods ??= {}
      popWhereOrder.shipping_methods.version = isSelectIn
        ? getVersionSubQuery(manager, "o0", "id")
        : version
    }

    return
  }

  if (isSelectIn) {
    version = getVersionSubQuery(manager, "o0")
  }

  if (hasRelation("summary")) {
    popWhere.summary ??= {}
    popWhere.summary.version = version
  }

  if (hasRelation("credit_lines")) {
    popWhere.credit_lines ??= {}
    popWhere.credit_lines.version = version
  }

  if (hasRelation("items") || hasRelation("order.items")) {
    popWhere.items ??= {}
    popWhere.items.version = version
  }

  if (hasRelation("shipping_methods")) {
    popWhere.shipping_methods ??= {}
    popWhere.shipping_methods.version = version
  }
}
