# Optimistic UI Update Guide

This guide explains how to implement optimistic UI updates in the listing creation and payment flows.

## Overview

Optimistic UI updates show the user immediate feedback while the backend processes the request, improving perceived performance and responsiveness on mobile.

## Usage Example: Listing Creation

```jsx
import { createOptimisticListing } from '@/lib/optimisticUI';
import { base44 } from '@/api/base44Client';

// In your component state
const [listings, setListings] = useState([]);
const [submitting, setSubmitting] = useState(false);

const handleSubmitListing = async (formData) => {
  setSubmitting(true);
  
  // 1. Create optimistic object with temp ID
  const optimisticListing = createOptimisticListing(formData, user.email);
  const tempId = optimisticListing.id;
  
  // 2. Show optimistic listing immediately
  setListings(prev => [...prev, optimisticListing]);
  
  try {
    // 3. Submit to backend with optimistic_id for tracking
    const res = await base44.functions.invoke('submitListing', {
      ...formData,
      optimistic_id: tempId
    });
    
    // 4. Replace optimistic entry with real response
    setListings(prev => prev.map(l => 
      l.id === tempId ? { ...res.data.listing, _optimistic: false } : l
    ));
  } catch (error) {
    // 5. Remove optimistic entry on error
    setListings(prev => prev.filter(l => l.id !== tempId));
    console.error('Listing failed:', error);
  } finally {
    setSubmitting(false);
  }
};
```

## Usage Example: Payment Capture

```jsx
import { createOptimisticPurchaseUpdate } from '@/lib/optimisticUI';
import { base44 } from '@/api/base44Client';

// In your component state
const [purchase, setPurchase] = useState(null);

const handleConfirmPurchase = async (confirming_role) => {
  const tempId = purchase.id;
  
  // 1. Create optimistic state update
  const optimisticUpdate = createOptimisticPurchaseUpdate(tempId, confirming_role);
  
  // 2. Update UI immediately
  setPurchase(prev => ({
    ...prev,
    ...optimisticUpdate
  }));
  
  try {
    // 3. Submit to backend
    const res = await base44.functions.invoke('capturePayment', {
      purchase_id: tempId,
      confirming_role: confirming_role,
      optimistic_id: tempId
    });
    
    // 4. Confirm with server response
    setPurchase(prev => ({
      ...prev,
      ...res.data,
      _optimistic: false,
      _updating: false
    }));
  } catch (error) {
    // 5. Revert optimistic update on error
    setPurchase(prev => ({
      ...prev,
      _optimistic: false,
      _updating: false,
      buyer_confirmed: confirming_role === 'buyer' ? false : prev.buyer_confirmed,
      seller_confirmed: confirming_role === 'seller' ? false : prev.seller_confirmed
    }));
    console.error('Confirmation failed:', error);
  }
};
```

## UI Rendering with Optimistic Entries

When rendering, check the `_optimistic` flag to show loading states or visual indicators:

```jsx
{listings.map(listing => (
  <div
    key={listing.id}
    className={listing._optimistic ? 'opacity-60 relative' : ''}>
    {listing._optimistic && (
      <div className="absolute top-2 right-2">
        <span className="text-[10px] px-2 py-1 rounded-full bg-yellow-500/20 text-yellow-600">
          Submitting…
        </span>
      </div>
    )}
    <ListingCard listing={listing} />
  </div>
))}
```

## Key Points

- **Optimistic IDs**: Temp IDs are generated with `temp_${Date.now()}` for instant UI updates
- **Tracking**: Pass `optimistic_id` to backend to correlate responses
- **Rollback**: Always revert state on error to maintain consistency
- **Visual Feedback**: Use `_optimistic` and `_updating` flags to show submission status
- **Disable Interactions**: Set component to `disabled` during submission to prevent duplicates

## Benefits

✅ Instant feedback on mobile (especially important for slow connections)
✅ Better perceived performance
✅ Reduced waiting perception
✅ Graceful error handling with rollback
✅ Maintains data consistency between UI and server