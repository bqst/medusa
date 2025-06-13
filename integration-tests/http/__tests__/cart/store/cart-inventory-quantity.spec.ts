import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import {
  createAdminUser,
  generatePublishableKey,
  generateStoreHeaders,
} from "../../../../helpers/create-admin-user"
import { setupTaxStructure } from "../../../../modules/__tests__/fixtures"
import { Modules } from "@medusajs/utils"

jest.setTimeout(50000)

const env = { MEDUSA_FF_MEDUSA_V2: true }
const adminHeaders = { headers: { "x-medusa-access-token": "test_token" } }

medusaIntegrationTestRunner({
  env,
  testSuite: ({ dbConnection, getContainer, api }) => {
    describe("Store Cart Inventory Quantity API", () => {
      let appContainer
      let storeHeaders
      let region, product, salesChannel, variant, inventoryItem, stockLocation

      beforeAll(async () => {
        appContainer = getContainer()
      })

      beforeEach(async () => {
        await createAdminUser(dbConnection, adminHeaders, appContainer)
        const publishableKey = await generatePublishableKey(appContainer)
        storeHeaders = generateStoreHeaders({ publishableKey })

        await setupTaxStructure(appContainer.resolve(Modules.TAX))

        // Create shipping profile
        const shippingProfile = (
          await api.post(
            `/admin/shipping-profiles`,
            { name: "default", type: "default" },
            adminHeaders
          )
        ).data.shipping_profile

        // Create region
        region = (
          await api.post(
            "/admin/regions",
            { name: "US", currency_code: "usd", countries: ["us"] },
            adminHeaders
          )
        ).data.region

        // Create product
        product = (
          await api.post(
            "/admin/products",
            {
              title: "Test Product",
              description: "A test product",
              status: "published",
              shipping_profile_id: shippingProfile.id,
              variants: [
                {
                  title: "Test Variant",
                  sku: "test-variant",
                  manage_inventory: true,
                  prices: [
                    {
                      currency_code: "usd",
                      amount: 1000,
                    },
                  ],
                },
              ],
            },
            adminHeaders
          )
        ).data.product

        variant = product.variants[0]

        // Create sales channel
        salesChannel = (
          await api.post(
            "/admin/sales-channels",
            { name: "Test Channel", description: "Test sales channel" },
            adminHeaders
          )
        ).data.sales_channel

        // Associate product with sales channel
        await api.post(
          `/admin/products/${product.id}/sales-channels`,
          { add: [salesChannel.id] },
          adminHeaders
        )

        // Create inventory item
        inventoryItem = (
          await api.post(
            `/admin/inventory-items`,
            {
              sku: "test-inventory-sku",
              requires_shipping: true,
            },
            adminHeaders
          )
        ).data.inventory_item

        // Create stock location
        stockLocation = (
          await api.post(
            `/admin/stock-locations`,
            {
              name: "Test Location",
              address: {
                country_code: "US",
              },
            },
            adminHeaders
          )
        ).data.stock_location

        // Set stock levels
        await api.post(
          `/admin/inventory-items/${inventoryItem.id}/location-levels`,
          {
            location_id: stockLocation.id,
            stocked_quantity: 100,
          },
          adminHeaders
        )

        // Associate variant with inventory item
        await api.post(
          `/admin/products/${product.id}/variants/${variant.id}/inventory-items`,
          {
            required_quantity: 1,
            inventory_item_id: inventoryItem.id,
          },
          adminHeaders
        )

        // Associate sales channel with stock location
        await api.post(
          `/admin/sales-channels/${salesChannel.id}/stock-locations`,
          { add: [stockLocation.id] },
          adminHeaders
        )
      })

      describe("GET /store/carts/:id", () => {
        it("should return inventory quantity when requested in fields", async () => {
          // Create cart with item
          const cart = (
            await api.post(
              `/store/carts`,
              {
                currency_code: "usd",
                sales_channel_id: salesChannel.id,
                items: [
                  {
                    variant_id: variant.id,
                    quantity: 1,
                  },
                ],
              },
              storeHeaders
            )
          ).data.cart

          // Retrieve cart with inventory quantity
          const response = await api.get(
            `/store/carts/${cart.id}?fields=*items,*items.variant,+items.variant.inventory_quantity`,
            storeHeaders
          )

          expect(response.status).toEqual(200)
          expect(response.data.cart).toEqual(
            expect.objectContaining({
              id: cart.id,
              items: expect.arrayContaining([
                expect.objectContaining({
                  variant: expect.objectContaining({
                    id: variant.id,
                    inventory_quantity: 100,
                    manage_inventory: true,
                  }),
                }),
              ]),
            })
          )
        })

        it("should not return inventory quantity when not requested", async () => {
          // Create cart with item
          const cart = (
            await api.post(
              `/store/carts`,
              {
                currency_code: "usd",
                sales_channel_id: salesChannel.id,
                items: [
                  {
                    variant_id: variant.id,
                    quantity: 1,
                  },
                ],
              },
              storeHeaders
            )
          ).data.cart

          // Retrieve cart without inventory quantity
          const response = await api.get(
            `/store/carts/${cart.id}`,
            storeHeaders
          )

          expect(response.status).toEqual(200)
          expect(
            response.data.cart.items[0].variant.inventory_quantity
          ).toBeUndefined()
        })

        it("should not return inventory quantity for variants with manage_inventory disabled", async () => {
          // Disable inventory management for variant
          await api.post(
            `/admin/products/${product.id}/variants/${variant.id}`,
            { manage_inventory: false },
            adminHeaders
          )

          // Create cart with item
          const cart = (
            await api.post(
              `/store/carts`,
              {
                currency_code: "usd",
                sales_channel_id: salesChannel.id,
                items: [
                  {
                    variant_id: variant.id,
                    quantity: 1,
                  },
                ],
              },
              storeHeaders
            )
          ).data.cart

          // Retrieve cart with inventory quantity requested
          const response = await api.get(
            `/store/carts/${cart.id}?fields=*items,*items.variant,+items.variant.inventory_quantity`,
            storeHeaders
          )

          expect(response.status).toEqual(200)
          expect(
            response.data.cart.items[0].variant.inventory_quantity
          ).toBeUndefined()
        })
      })

      describe("POST /store/carts/:id/line-items", () => {
        it("should return inventory quantity when adding items to cart", async () => {
          // Create empty cart
          const cart = (
            await api.post(
              `/store/carts`,
              {
                currency_code: "usd",
                sales_channel_id: salesChannel.id,
              },
              storeHeaders
            )
          ).data.cart

          // Add item to cart with inventory quantity requested
          const response = await api.post(
            `/store/carts/${cart.id}/line-items?fields=*items,*items.variant,+items.variant.inventory_quantity`,
            {
              variant_id: variant.id,
              quantity: 1,
            },
            storeHeaders
          )

          expect(response.status).toEqual(200)
          expect(response.data.cart).toEqual(
            expect.objectContaining({
              items: expect.arrayContaining([
                expect.objectContaining({
                  variant: expect.objectContaining({
                    id: variant.id,
                    inventory_quantity: 100,
                    manage_inventory: true,
                  }),
                }),
              ]),
            })
          )
        })
      })

      describe("POST /store/carts", () => {
        it("should return inventory quantity when creating cart with items", async () => {
          const response = await api.post(
            `/store/carts?fields=*items,*items.variant,+items.variant.inventory_quantity`,
            {
              currency_code: "usd",
              sales_channel_id: salesChannel.id,
              items: [
                {
                  variant_id: variant.id,
                  quantity: 1,
                },
              ],
            },
            storeHeaders
          )

          expect(response.status).toEqual(200)
          expect(response.data.cart).toEqual(
            expect.objectContaining({
              items: expect.arrayContaining([
                expect.objectContaining({
                  variant: expect.objectContaining({
                    id: variant.id,
                    inventory_quantity: 100,
                    manage_inventory: true,
                  }),
                }),
              ]),
            })
          )
        })
      })
    })
  },
})
