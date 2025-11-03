import { Modules } from "@medusajs/framework/utils"
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"

jest.setTimeout(50000)

medusaIntegrationTestRunner({
  testSuite: ({ getContainer }) => {
    describe("Order Module - Status Filters", () => {
      let orderModule
      let paymentModule
      let fulfillmentModule
      let remoteLink

      beforeAll(() => {
        const container = getContainer()
        orderModule = container.resolve(Modules.ORDER)
        paymentModule = container.resolve(Modules.PAYMENT)
        fulfillmentModule = container.resolve(Modules.FULFILLMENT)
        remoteLink = container.resolve("remoteLink")
      })

      describe("payment_status filter", () => {
        let orderId1, orderId2, orderId3

        beforeEach(async () => {
          // Create order 1 - not_paid
          const order1 = await orderModule.createOrders({
            currency_code: "usd",
            email: "test1@example.com",
            region_id: "reg_123",
          })
          orderId1 = order1.id

          // Create order 2 - captured
          const order2 = await orderModule.createOrders({
            currency_code: "usd",
            email: "test2@example.com",
            region_id: "reg_123",
          })
          orderId2 = order2.id

          const paymentCollection2 = await paymentModule.createPaymentCollections(
            {
              currency_code: "usd",
              amount: 1000,
            }
          )

          await remoteLink.create({
            [Modules.ORDER]: { order_id: orderId2 },
            [Modules.PAYMENT]: {
              payment_collection_id: paymentCollection2.id,
            },
          })

          await paymentModule.updatePaymentCollections(paymentCollection2.id, {
            captured_amount: 1000,
            status: "captured",
          })

          // Create order 3 - awaiting
          const order3 = await orderModule.createOrders({
            currency_code: "usd",
            email: "test3@example.com",
            region_id: "reg_123",
          })
          orderId3 = order3.id

          const paymentCollection3 = await paymentModule.createPaymentCollections(
            {
              currency_code: "usd",
              amount: 1500,
            }
          )

          await remoteLink.create({
            [Modules.ORDER]: { order_id: orderId3 },
            [Modules.PAYMENT]: {
              payment_collection_id: paymentCollection3.id,
            },
          })

          await paymentModule.updatePaymentCollections(paymentCollection3.id, {
            status: "awaiting",
          })
        })

        it("should filter orders by payment_status = 'captured'", async () => {
          const [orders, count] = await orderModule.listAndCountOrders({
            payment_status: "captured",
          })

          expect(count).toBe(1)
          expect(orders).toHaveLength(1)
          expect(orders[0].id).toBe(orderId2)
        })

        it("should filter orders by payment_status = 'not_paid'", async () => {
          const [orders, count] = await orderModule.listAndCountOrders({
            payment_status: "not_paid",
          })

          expect(count).toBe(1)
          expect(orders).toHaveLength(1)
          expect(orders[0].id).toBe(orderId1)
        })

        it("should filter orders by payment_status = 'awaiting'", async () => {
          const [orders, count] = await orderModule.listAndCountOrders({
            payment_status: "awaiting",
          })

          expect(count).toBe(1)
          expect(orders).toHaveLength(1)
          expect(orders[0].id).toBe(orderId3)
        })

        it("should filter orders by multiple payment statuses", async () => {
          const [orders, count] = await orderModule.listAndCountOrders({
            payment_status: ["captured", "awaiting"],
          })

          expect(count).toBe(2)
          expect(orders).toHaveLength(2)
          const orderIds = orders.map((o) => o.id).sort()
          expect(orderIds).toEqual([orderId2, orderId3].sort())
        })

        it("should combine payment_status filter with other filters", async () => {
          const [orders, count] = await orderModule.listAndCountOrders({
            payment_status: "captured",
            email: "test2@example.com",
          })

          expect(count).toBe(1)
          expect(orders).toHaveLength(1)
          expect(orders[0].id).toBe(orderId2)
        })

        it("should respect pagination with payment_status filter", async () => {
          const [orders, count] = await orderModule.listAndCountOrders(
            {
              payment_status: ["captured", "awaiting", "not_paid"],
            },
            {
              take: 2,
              skip: 1,
            }
          )

          expect(count).toBe(3)
          expect(orders).toHaveLength(2)
        })
      })

      describe("fulfillment_status filter", () => {
        let orderId1, orderId2, orderId3

        beforeEach(async () => {
          // Create order 1 - not_fulfilled
          const order1 = await orderModule.createOrders({
            currency_code: "usd",
            email: "test1@example.com",
            region_id: "reg_123",
            items: [
              {
                title: "Item 1",
                quantity: 2,
                unit_price: 1000,
              },
            ],
          })
          orderId1 = order1.id

          // Create order 2 - fulfilled
          const order2 = await orderModule.createOrders({
            currency_code: "usd",
            email: "test2@example.com",
            region_id: "reg_123",
            items: [
              {
                title: "Item 2",
                quantity: 1,
                unit_price: 2000,
              },
            ],
          })
          orderId2 = order2.id

          const fulfillment2 = await fulfillmentModule.createFulfillment({
            location_id: "loc_123",
            packed_at: new Date(),
            provider_id: "manual",
          })

          await remoteLink.create({
            [Modules.ORDER]: { order_id: orderId2 },
            [Modules.FULFILLMENT]: {
              fulfillment_id: fulfillment2.id,
            },
          })

          // Mark all items as fulfilled
          await orderModule.updateOrderItems([
            {
              selector: { order_id: orderId2 },
              data: { fulfilled_quantity: 1 },
            },
          ])

          // Create order 3 - shipped
          const order3 = await orderModule.createOrders({
            currency_code: "usd",
            email: "test3@example.com",
            region_id: "reg_123",
            items: [
              {
                title: "Item 3",
                quantity: 1,
                unit_price: 1500,
              },
            ],
          })
          orderId3 = order3.id

          const fulfillment3 = await fulfillmentModule.createFulfillment({
            location_id: "loc_123",
            packed_at: new Date(),
            shipped_at: new Date(),
            provider_id: "manual",
          })

          await remoteLink.create({
            [Modules.ORDER]: { order_id: orderId3 },
            [Modules.FULFILLMENT]: {
              fulfillment_id: fulfillment3.id,
            },
          })

          await orderModule.updateOrderItems([
            {
              selector: { order_id: orderId3 },
              data: { fulfilled_quantity: 1, shipped_quantity: 1 },
            },
          ])
        })

        it("should filter orders by fulfillment_status = 'not_fulfilled'", async () => {
          const [orders, count] = await orderModule.listAndCountOrders({
            fulfillment_status: "not_fulfilled",
          })

          expect(count).toBe(1)
          expect(orders).toHaveLength(1)
          expect(orders[0].id).toBe(orderId1)
        })

        it("should filter orders by fulfillment_status = 'fulfilled'", async () => {
          const [orders, count] = await orderModule.listAndCountOrders({
            fulfillment_status: "fulfilled",
          })

          expect(count).toBe(1)
          expect(orders).toHaveLength(1)
          expect(orders[0].id).toBe(orderId2)
        })

        it("should filter orders by fulfillment_status = 'shipped'", async () => {
          const [orders, count] = await orderModule.listAndCountOrders({
            fulfillment_status: "shipped",
          })

          expect(count).toBe(1)
          expect(orders).toHaveLength(1)
          expect(orders[0].id).toBe(orderId3)
        })

        it("should filter orders by multiple fulfillment statuses", async () => {
          const [orders, count] = await orderModule.listAndCountOrders({
            fulfillment_status: ["fulfilled", "shipped"],
          })

          expect(count).toBe(2)
          expect(orders).toHaveLength(2)
          const orderIds = orders.map((o) => o.id).sort()
          expect(orderIds).toEqual([orderId2, orderId3].sort())
        })
      })

      describe("combined status filters", () => {
        let orderId1, orderId2

        beforeEach(async () => {
          // Create order 1 - captured + fulfilled
          const order1 = await orderModule.createOrders({
            currency_code: "usd",
            email: "test1@example.com",
            region_id: "reg_123",
            items: [
              {
                title: "Item 1",
                quantity: 1,
                unit_price: 1000,
              },
            ],
          })
          orderId1 = order1.id

          const paymentCollection1 = await paymentModule.createPaymentCollections(
            {
              currency_code: "usd",
              amount: 1000,
            }
          )

          const fulfillment1 = await fulfillmentModule.createFulfillment({
            location_id: "loc_123",
            packed_at: new Date(),
            provider_id: "manual",
          })

          await remoteLink.create([
            {
              [Modules.ORDER]: { order_id: orderId1 },
              [Modules.PAYMENT]: {
                payment_collection_id: paymentCollection1.id,
              },
            },
            {
              [Modules.ORDER]: { order_id: orderId1 },
              [Modules.FULFILLMENT]: {
                fulfillment_id: fulfillment1.id,
              },
            },
          ])

          await paymentModule.updatePaymentCollections(paymentCollection1.id, {
            captured_amount: 1000,
            status: "captured",
          })

          await orderModule.updateOrderItems([
            {
              selector: { order_id: orderId1 },
              data: { fulfilled_quantity: 1 },
            },
          ])

          // Create order 2 - awaiting + not_fulfilled
          const order2 = await orderModule.createOrders({
            currency_code: "usd",
            email: "test2@example.com",
            region_id: "reg_123",
            items: [
              {
                title: "Item 2",
                quantity: 1,
                unit_price: 2000,
              },
            ],
          })
          orderId2 = order2.id

          const paymentCollection2 = await paymentModule.createPaymentCollections(
            {
              currency_code: "usd",
              amount: 2000,
            }
          )

          await remoteLink.create({
            [Modules.ORDER]: { order_id: orderId2 },
            [Modules.PAYMENT]: {
              payment_collection_id: paymentCollection2.id,
            },
          })

          await paymentModule.updatePaymentCollections(paymentCollection2.id, {
            status: "awaiting",
          })
        })

        it("should filter by both payment_status and fulfillment_status", async () => {
          const [orders, count] = await orderModule.listAndCountOrders({
            payment_status: "captured",
            fulfillment_status: "fulfilled",
          })

          expect(count).toBe(1)
          expect(orders).toHaveLength(1)
          expect(orders[0].id).toBe(orderId1)
        })

        it("should return empty when no orders match both filters", async () => {
          const [orders, count] = await orderModule.listAndCountOrders({
            payment_status: "captured",
            fulfillment_status: "not_fulfilled",
          })

          expect(count).toBe(0)
          expect(orders).toHaveLength(0)
        })
      })
    })
  },
})

