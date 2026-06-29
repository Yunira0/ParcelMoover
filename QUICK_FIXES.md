# Quick Fixes - Implementation Guide

## 🔴 CRITICAL (Fix This Week)

### Fix #1: Cache Invalidation Retry Logic (30 minutes)

**File:** `server/src/services/order.service.ts`

**Replace lines 77-86:**

```typescript
// OLD - Silently fails on Redis error
async function invalidateOrderCaches() {
  try {
    await Promise.all([
      scanAndDelete(`${DASHBOARD_SUMMARY_CACHE_PREFIX}*`),
      scanAndDelete(`${ORDERS_LIST_CACHE_PREFIX}*`),
    ]);
  } catch (error) {
    console.error("[Redis] Failed to invalidate order caches:", error);
  }
}
```

**With:**

```typescript
// NEW - Retries with exponential backoff
const CACHE_INVALIDATION_RETRIES = 3;
const CACHE_INVALIDATION_RETRY_DELAY_MS = 100;

async function invalidateOrderCaches(retries = 0): Promise<void> {
  try {
    await Promise.all([
      scanAndDelete(`${DASHBOARD_SUMMARY_CACHE_PREFIX}*`),
      scanAndDelete(`${ORDERS_LIST_CACHE_PREFIX}*`),
    ]);
  } catch (error) {
    if (retries < CACHE_INVALIDATION_RETRIES) {
      console.warn(
        `[Redis] Cache invalidation attempt ${retries + 1} failed, retrying in ${CACHE_INVALIDATION_RETRY_DELAY_MS * (retries + 1)}ms...`
      );
      await new Promise(resolve =>
        setTimeout(resolve, CACHE_INVALIDATION_RETRY_DELAY_MS * (retries + 1))
      );
      return invalidateOrderCaches(retries + 1);
    }

    console.error("[Redis] Critical: Failed to invalidate order caches after retries", error);
    // Optional: Queue for background retry
    throw new AppError(500, 'Cache invalidation failed - please retry');
  }
}
```

---

### Fix #2: Transaction Error Handling (20 minutes)

**File:** `server/src/services/order.service.ts`

**Wrap lines 996-1051 in try-catch:**

```typescript
export async function updateParcelStatus(
  actor: OrderActor,
  parcelId: string,
  data: UpdateParcelStatusInput,
) {
  // ... existing validations (lines 932-994) ...

  try {
    const updatedParcel = await prisma.$transaction(async (tx) => {
      const updateData: Prisma.parcelsUpdateInput = {
        status: newStatus as parcel_status,
      };

      if (newStatus === "delivered") {
        (updateData as any).delivered_at = new Date();
      }

      if (data.locationId) {
        (updateData as any).current_location_id = data.locationId;
      }

      if (riderAssignmentField) {
        (updateData as any)[riderAssignmentField] = data.riderId;
      }

      if (parcel.pickup_tasks && ["rider_assigned", "picked_up", "cancelled"].includes(newStatus)) {
        await tx.pickup_tasks.update({
          where: { parcel_id: parcel.id },
          data: { status: newStatus as parcel_status },
        });
      }

      const updatedParcel = await tx.parcels.update({
        where: { id: parcelId },
        data: updateData,
      });

      await tx.parcel_status_history.create({
        data: {
          parcel_id: parcelId,
          old_status: currentStatus as parcel_status,
          new_status: newStatus as parcel_status,
          location_id: data.locationId || parcel.current_location_id,
          changed_by: actor.id,
          remarks: data.remarks || null,
        },
      });

      await tx.audit_logs.create({
        data: {
          actor_id: actor.id,
          entity_type: "parcel",
          entity_id: parcelId,
          action: "UPDATE_STATUS",
          old_data: { status: currentStatus },
          new_data: { status: newStatus },
        },
      });

      return updatedParcel;
    });

    await invalidateOrderCaches();
    await notifyVendorOfStatusChange(parcel.vendor_id, parcel.tracking_id, newStatus, actor.id);
    
    return updatedParcel;
  } catch (error) {
    // Explicit transaction error handling
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2025') {
        throw new AppError(404, 'Parcel no longer exists');
      }
      if (error.code === 'P2034') {
        throw new AppError(409, 'Concurrent modification detected. Please retry.');
      }
    }
    
    if (error instanceof AppError) {
      throw error;
    }

    console.error('Transaction failed during status update:', error);
    throw new AppError(500, 'Failed to update order status');
  }
}
```

---

### Fix #3: Input Sanitization for Remarks (15 minutes)

**File:** `server/src/services/order.service.ts` or create `server/src/utils/sanitize.ts`

**Create sanitize utility:**

```typescript
// server/src/utils/sanitize.ts
export function sanitizeRemark(input: string): string {
  return input
    .trim()
    // Remove any HTML/script tags
    .replace(/<[^>]*>/g, '')
    // Remove javascript: protocol
    .replace(/javascript:/gi, '')
    // Remove event handlers
    .replace(/on\w+\s*=/gi, '')
    // Remove control characters
    .replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '');
}
```

**Update `addOrderRemark()` in `order.service.ts`:**

```typescript
import { sanitizeRemark } from "../utils/sanitize";

export async function addOrderRemark(
  actor: OrderActor,
  parcelId: string,
  remark: string,
  parentRemarkId?: string | null,
) {
  // ... existing code ...

  const trimmed = remark.trim();
  if (!trimmed || trimmed.length < 1 || trimmed.length > 1000) {
    throw new AppError(400, "Remark must be between 1-1000 characters");
  }

  // NEW: Sanitize before storing
  const sanitized = sanitizeRemark(trimmed);

  // ... rest of the code, use `sanitized` instead of `trimmed` ...
  
  const remark = await prisma.parcel_remarks.create({
    data: {
      parcel_id: parcel.id,
      user_id: actor.id,
      location_id: locationId,
      remark: sanitized, // Use sanitized version
      parent_remark_id: validParentId,
    },
    include: { users: true, parent_remark: { include: { users: true } } },
  });
}
```

---

### Fix #4: Validate JWT Secret at Startup (10 minutes)

**File:** `server/src/server.ts`

**Add at the very beginning (before creating Express app):**

```typescript
import express, { Express, Request, Response } from 'express';
import { config } from 'dotenv';

config();

// NEW: Validate critical environment variables at startup
if (!process.env.JWT_SECRET) {
  console.error('🔴 FATAL: JWT_SECRET environment variable is not set');
  console.error('Please set JWT_SECRET in your .env file');
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error('🔴 FATAL: DATABASE_URL environment variable is not set');
  process.exit(1);
}

if (!process.env.REDIS_URL) {
  console.error('🔴 FATAL: REDIS_URL environment variable is not set');
  process.exit(1);
}

const app: Express = express();
const port = process.env.PORT || 3000;

// ... rest of the server setup ...
```

**Update `auth.middleware.ts` to assume JWT_SECRET exists:**

```typescript
export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  try {
    const token = req.cookies.accessToken;

    if (!token) {
      throw new AppError(401, 'Authentication required');
    }

    // JWT_SECRET is guaranteed to exist from startup validation
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as AuthTokenPayload;

    if (!decoded?.id) {
      throw new AppError(401, 'Invalid token payload');
    }

    const user = await prisma.users.findFirst({
      where: {
        id: decoded.id,
        deleted_at: null,
        status: 'active',
      },
      include: {
        user_roles: { include: { roles: true } },
      },
    });

    if (!user) {
      throw new AppError(401, 'User not found or inactive');
    }

    req.user = {
      id: user.id,
      fullName: user.full_name,
      email: user.email,
      phone: user.phone,
      status: user.status,
      roles: user.user_roles.map(ur => ur.roles.code),
    };

    next();
  } catch (error: any) {
    // Better error handling
    if (error instanceof AppError) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }

    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token',
      });
    }

    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token expired',
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Authentication error',
    });
  }
}
```

---

## 🟠 HIGH PRIORITY (Fix This Sprint)

### Fix #5: Add Rate Limiting to Remarks (20 minutes)

**File:** `server/src/routes/order.routes.ts`

**Find the remark route and update:**

```typescript
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import { createRedisRateLimitStore } from "../lib/rateLimitStore";

const actorOrIpKey = (req: Request) => req.user?.id ?? ipKeyGenerator(req.ip ?? "");

// NEW: Rate limiter for remarks
const remarkLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20, // 20 remarks per minute
  message: { success: false, message: "Too many remarks added. Please wait before adding more." },
  standardHeaders: true,
  legacyHeaders: false,
  store: createRedisRateLimitStore("order-remark"),
  keyGenerator: actorOrIpKey,
});

// Update the route to include the limiter
orderRouter.post(
  "/:id/remarks",
  authMiddleware,
  csrfProtection,
  authorizeRoles("super_admin", "admin", "vendor", "rider"),
  remarkLimiter, // ADD THIS LINE
  validate(uuidParamSchema, "params"),
  validate(addOrderRemarkSchema),
  addOrderRemarkController,
);
```

---

### Fix #6: Improve Bulk Update Rider Validation (30 minutes)

**File:** `server/src/services/order.service.ts`

**Update `bulkUpdateParcelStatus()` starting at line 1097:**

```typescript
export async function bulkUpdateParcelStatus(
  actor: OrderActor,
  data: BulkUpdateParcelStatusInput,
): Promise<BulkUpdateResult> {
  const ids = Array.from(new Set(data.ids));
  if (ids.length === 0) {
    throw new AppError(400, "No parcel ids provided");
  }
  if (ids.length > MAX_BULK_IDS) {
    throw new AppError(400, `Cannot update more than ${MAX_BULK_IDS} parcels at once`);
  }

  const newStatus = data.status;
  const isAdmin = actor.roles.some((r) => ["super_admin", "admin"].includes(r));

  if (newStatus === "cancelled" && !isAdmin) {
    throw new AppError(403, "Only admins can cancel an order");
  }
  if (HUB_OPERATION_STATUSES.includes(newStatus as parcel_status) && !isAdmin) {
    throw new AppError(403, "Only admins can perform dispatch hub operations");
  }

  const parcels = await prisma.parcels.findMany({
    where: { id: { in: ids }, deleted_at: null },
    include: { pickup_tasks: true },
  });

  if (parcels.length !== ids.length) {
    throw new AppError(404, "One or more parcels were not found");
  }

  // NEW: Validate transitions and collect issues
  const validationErrors: string[] = [];
  for (const parcel of parcels) {
    const currentStatus = parcel.status as ParcelStatus;
    if (TERMINAL_STATUSES.includes(currentStatus as parcel_status)) {
      validationErrors.push(`${parcel.tracking_id} is already '${currentStatus}' (terminal state)`);
      continue;
    }
    const allowed = STATUS_TRANSITIONS[
      currentStatus as keyof typeof STATUS_TRANSITIONS
    ] as readonly ParcelStatus[];
    if (!allowed || !allowed.includes(newStatus)) {
      validationErrors.push(`${parcel.tracking_id}: '${currentStatus}' → '${newStatus}' invalid`);
    }
  }

  if (validationErrors.length > 0) {
    throw new AppError(422, `Validation failed:\n${validationErrors.join('\n')}`);
  }

  // NEW: Validate rider if required for this transition
  const riderAssignmentField = RIDER_ASSIGNMENT_FIELD[newStatus as parcel_status];
  if (riderAssignmentField && data.riderId) {
    // Validate rider exists and is active
    const rider = await prisma.riders.findFirst({
      where: { id: data.riderId, deleted_at: null, status: "active" },
      select: { id: true, name: true },
    });
    if (!rider) {
      throw new AppError(400, "Rider not found or inactive");
    }
  }

  // ... rest of the implementation ...
}
```

---

## 🟡 MEDIUM PRIORITY (Next Sprint)

### Fix #7: Add Database Query Optimization

**File:** `server/src/services/order.service.ts`

**For dashboard summary, add indexes to PostgreSQL:**

```sql
-- Add to your migration file
CREATE INDEX IF NOT EXISTS idx_parcels_status ON parcels(status);
CREATE INDEX IF NOT EXISTS idx_parcels_created_at ON parcels(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_parcels_vendor_id ON parcels(vendor_id);
CREATE INDEX IF NOT EXISTS idx_parcels_pickup_rider_id ON parcels(pickup_rider_id);
CREATE INDEX IF NOT EXISTS idx_parcels_delivery_rider_id ON parcels(delivery_rider_id);
CREATE INDEX IF NOT EXISTS idx_parcel_remarks_created_at ON parcel_remarks(created_at DESC);
```

---

## Testing Checklist

After implementing fixes, run these tests:

```bash
# 1. Unit tests for cache invalidation
npm test -- cache.test.ts

# 2. Integration test for status update
npm test -- status-update.integration.test.ts

# 3. Security test for XSS in remarks
npm test -- sanitize.test.ts

# 4. Load test rate limiting
npm test -- rate-limit.load.test.ts

# 5. Concurrent update test
npm test -- concurrent.update.test.ts
```

---

## Deployment Checklist

```markdown
Before deploying to production:

- [ ] All 4 critical fixes implemented
- [ ] No TypeScript compilation errors
- [ ] All tests passing
- [ ] .env has JWT_SECRET, DATABASE_URL, REDIS_URL
- [ ] Database migrations run
- [ ] Indexes created
- [ ] Staging environment tested
- [ ] Rollback plan documented
```

---

## Time Estimates

| Fix # | Task | Time |
|-------|------|------|
| 1 | Cache retry logic | 30 min |
| 2 | Transaction error handling | 20 min |
| 3 | Input sanitization | 15 min |
| 4 | JWT secret validation | 10 min |
| 5 | Rate limiting on remarks | 20 min |
| 6 | Bulk update validation | 30 min |
| **Total** | **All Critical & High** | **2.5 hours** |

---

## Next Steps

1. **Immediately:** Implement fixes #1-4 (1 hour)
2. **This week:** Implement fixes #5-6 (1 hour)
3. **Test thoroughly:** Run integration tests (1 hour)
4. **Deploy:** Push to staging, then production

**Estimated total effort: 3 hours**
