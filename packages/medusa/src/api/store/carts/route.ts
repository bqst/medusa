import { createCartWorkflow } from "@medusajs/core-flows"
import {
  AdditionalData,
  CreateCartWorkflowInputDTO,
  HttpTypes,
} from "@medusajs/framework/types"
import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { refetchCartWithInventoryQuantity } from "./helpers"

export const POST = async (
  req: AuthenticatedMedusaRequest<HttpTypes.StoreCreateCart & AdditionalData>,
  res: MedusaResponse<HttpTypes.StoreCartResponse>
) => {
  const workflowInput = {
    ...req.validatedBody,
    customer_id: req.auth_context?.actor_id,
  }

  const { result } = await createCartWorkflow(req.scope).run({
    input: workflowInput as CreateCartWorkflowInputDTO,
  })

  const cart = await refetchCartWithInventoryQuantity(
    result.id,
    req.scope,
    req.queryConfig.fields,
    req
  )

  res.status(200).json({ cart })
}
