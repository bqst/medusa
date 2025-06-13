import { MedusaContainer } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  remoteQueryObjectFromString,
} from "@medusajs/framework/utils"
import { wrapVariantsWithInventoryQuantityForSalesChannel } from "../../utils/middlewares"
import { MedusaStoreRequest } from "@medusajs/framework/http"

export const refetchCart = async (
  id: string,
  scope: MedusaContainer,
  fields: string[]
) => {
  const remoteQuery = scope.resolve(ContainerRegistrationKeys.REMOTE_QUERY)
  const queryObject = remoteQueryObjectFromString({
    entryPoint: "cart",
    variables: { filters: { id } },
    fields,
  })

  const [cart] = await remoteQuery(queryObject)

  return cart
}

export const refetchCartWithInventoryQuantity = async (
  id: string,
  scope: MedusaContainer,
  fields: string[],
  req: any // More flexible type to handle both MedusaStoreRequest and AuthenticatedMedusaRequest
) => {
  const withInventoryQuantity = fields.some((field) =>
    field.includes("items.variant.inventory_quantity")
  )

  let processedFields = fields
  if (withInventoryQuantity) {
    processedFields = fields.filter(
      (field) => !field.includes("items.variant.inventory_quantity")
    )
  }

  const cart = await refetchCart(id, scope, processedFields)

  if (
    withInventoryQuantity &&
    cart?.items?.length &&
    req.publishable_key_context
  ) {
    const variants = cart.items.map((item: any) => item.variant).filter(Boolean)

    await wrapVariantsWithInventoryQuantityForSalesChannel(req, variants)
  }

  return cart
}
