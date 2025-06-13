# PR: Add Inventory Quantity Support to Store Cart Endpoints

## 🎯 Overview

This PR implements inventory quantity functionality for store cart endpoints, bringing feature parity with the existing product endpoints. Users can now retrieve variant inventory quantities when working with carts by using the `+items.variant.inventory_quantity` field parameter.

## 🚀 Changes

### Files Modified

1. **`packages/medusa/src/api/store/carts/helpers.ts`**
   - Added new `refetchCartWithInventoryQuantity` helper function
   - Implements inventory quantity detection and wrapping logic similar to product endpoints
   - Handles graceful degradation when publishable key context is missing

2. **`packages/medusa/src/api/store/carts/[id]/route.ts`**
   - Updated GET and POST handlers to use the new helper function
   - Changed request types from `MedusaRequest` to `MedusaStoreRequest` for proper type safety

3. **`packages/medusa/src/api/store/carts/route.ts`**
   - Updated cart creation endpoint to support inventory quantity

4. **`packages/medusa/src/api/store/carts/[id]/line-items/route.ts`**
   - Updated line items endpoint to support inventory quantity

### Files Added

5. **`integration-tests/http/__tests__/cart/store/cart-inventory-quantity.spec.ts`**
   - Comprehensive test suite for the new functionality
   - Tests all cart endpoints with inventory quantity support
   - Tests edge cases like disabled inventory management

## 🔧 Technical Implementation

### How It Works

The implementation follows the same pattern used in product endpoints:

1. **Detection**: Check if `items.variant.inventory_quantity` is requested in fields
2. **Preprocessing**: Remove the inventory quantity field from the query (since it's computed, not stored)
3. **Fetching**: Retrieve cart data normally
4. **Post-processing**: If inventory quantity was requested and variants exist, call `wrapVariantsWithInventoryQuantityForSalesChannel`

### Key Features

- **Sales Channel Aware**: Inventory calculations respect the sales channel context
- **Performance Optimized**: Only calculates inventory when explicitly requested
- **Type Safe**: Proper TypeScript types with `MedusaStoreRequest`
- **Graceful Degradation**: Handles missing publishable key context gracefully
- **Consistent API**: Uses the same field syntax as product endpoints

## 📝 Usage Examples

### Retrieve Cart with Inventory Quantities

```javascript
GET /store/carts/{cart_id}?fields=*items,*items.variant,+items.variant.inventory_quantity
```

### Create Cart with Inventory Quantities

```javascript
POST /store/carts?fields=*items,*items.variant,+items.variant.inventory_quantity
```

### Add Item to Cart with Inventory Quantities

```javascript
POST /store/carts/{cart_id}/line-items?fields=*items,*items.variant,+items.variant.inventory_quantity
```

## 🧪 Testing

### Test Coverage

- ✅ Inventory quantity returned when requested
- ✅ Inventory quantity not returned when not requested  
- ✅ Respects `manage_inventory` setting
- ✅ Works with cart creation
- ✅ Works with line item addition
- ✅ Works with cart retrieval

### Running Tests

```bash
npm test integration-tests/http/__tests__/cart/store/cart-inventory-quantity.spec.ts
```

## 🔄 Backward Compatibility

This change is **100% backward compatible**:

- Existing cart API calls continue to work unchanged
- New functionality is opt-in via query parameters
- No breaking changes to existing responses

## 📊 Response Example

```json
{
  "cart": {
    "items": [
      {
        "variant": {
          "id": "variant_123",
          "title": "Medium / Black",
          "inventory_quantity": 15,
          "manage_inventory": true,
          // ... other variant fields
        }
        // ... other line item fields
      }
    ]
    // ... other cart fields
  }
}
```

## 🎯 Benefits

1. **Feature Parity**: Cart endpoints now match product endpoint capabilities
2. **Real-time Inventory**: Show current stock levels in cart context
3. **Better UX**: Enable inventory-aware cart interfaces
4. **Consistent API**: Same field syntax across all store endpoints

## 🔍 Edge Cases Handled

- **Variants without inventory management**: No inventory quantity returned
- **Missing publishable key context**: Graceful fallback without error
- **Multiple inventory items per variant**: Proper availability calculation
- **Sales channel restrictions**: Only counts inventory from associated locations

## 📋 Checklist

- [x] Implementation follows existing patterns
- [x] Comprehensive test coverage
- [x] Backward compatibility maintained
- [x] TypeScript types updated
- [x] Documentation examples provided
- [x] Error handling implemented

## 🔮 Future Improvements

This PR lays the groundwork for potential future enhancements:

- Cache inventory calculations for better performance
- Add inventory quantity to other cart-related endpoints
- Support for inventory reservations in cart context

## 🤝 Rationale

This feature was requested because users needed to display real-time inventory information in their cart interfaces, similar to what's available on product pages. The implementation maintains consistency with existing Medusa patterns and provides a seamless developer experience. 