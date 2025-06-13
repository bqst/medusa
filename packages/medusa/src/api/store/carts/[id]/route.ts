import { updateCartWorkflow } from "@medusajs/core-flows"
import {
  AdditionalData,
  HttpTypes,
  UpdateCartDataDTO,
} from "@medusajs/framework/types"

import {
  MedusaRequest,
  MedusaResponse,
  MedusaStoreRequest,
} from "@medusajs/framework/http"
import { refetchCart, refetchCartWithInventoryQuantity } from "../helpers"

export const GET = async (
  req: MedusaStoreRequest,
  res: MedusaResponse<HttpTypes.StoreCartResponse>
) => {
  const cart = await refetchCartWithInventoryQuantity(
    req.params.id,
    req.scope,
    req.queryConfig.fields,
    req
  )

  res.json({ cart })
}

export const POST = async (
  req: MedusaStoreRequest<UpdateCartDataDTO & AdditionalData>,
  res: MedusaResponse<{
    cart: HttpTypes.StoreCart
  }>
) => {
  const workflow = updateCartWorkflow(req.scope)

  await workflow.run({
    input: {
      ...req.validatedBody,
      id: req.params.id,
    },
  })

  const cart = await refetchCartWithInventoryQuantity(
    req.params.id,
    req.scope,
    req.queryConfig.fields,
    req
  )

  res.status(200).json({ cart })
}
