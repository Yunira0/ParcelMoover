# Delivery Management System — Master Test Plan & Test Case Catalog

> **Status:** Living document. Track execution status per release in the tracking tables.
> **Stack under test:** Express + TypeScript + Prisma + PostgreSQL + Redis (backend, :3000) · React + TypeScript + Vite (frontend) · JWT (cookie) + CSRF auth · Roles: `super_admin`, `admin`, `vendor`, `rider`.
> **Legend for Status column:** ⬜ Not started · 🟡 In progress · ✅ Pass · ❌ Fail · 🚫 Blocked · ⏭️ Skipped
> **Priority:** P0 (critical / release-blocker) · P1 (high) · P2 (medium) · P3 (low)
> **Type:** FUNC (functional) · NEG (negative) · SEC (security) · PERF (performance) · UI (UI/UX) · A11Y (accessibility) · DATA (data integrity) · INT (integration) · E2E (end-to-end) · REG (regression)

---

## 1. Purpose & Scope

This document catalogs the full set of test cases for the Delivery Management System (DMS) to industry standard (ISTQB-aligned test design: equivalence partitioning, boundary value analysis, decision tables, state transition testing, and negative/security testing).

### In scope
- Authentication, authorization & session management
- Order lifecycle & 19-state status state machine
- Order creation (single + bulk), listing, search, keyset pagination
- Operations pages (Pickup, Dispatch, Hold, OOV, Loss & Damage, Return)
- Vendor portal (orders, COD, settlements, payments, staff)
- KYC, Finance, Tickets, Remarks, Delivery Rates, Pricing, Locations
- Rider run sheets, notifications (SSE), dashboards
- Redis caching, rate limiting, CSRF, input validation
- Cross-cutting: i18n / Nepali (BS) dates, error handling, data integrity

### Out of scope (unless noted)
- Third-party payment gateway internals
- Infrastructure/OS-level pentesting
- Load testing beyond defined perf thresholds

---

## 2. Test Strategy & Levels

| Level | Focus | Tooling (suggested) |
|---|---|---|
| Unit | Services, validators (Zod), utils, state-machine transitions | Vitest / Jest |
| Integration | Controller → Service → Prisma, Redis cache, middleware chain | Supertest + test DB |
| API/Contract | Route request/response schema, status codes, headers | Supertest / Postman / Newman |
| E2E | Full user journeys per role, in browser | Playwright / Cypress |
| Non-functional | Perf, security, accessibility, i18n | k6, OWASP ZAP, axe-core |

**Middleware chain to keep in mind for every API test:** CORS → Auth → CSRF → Zod validate → Rate limit → Controller → Service → Prisma → Error handler.

---

## 3. Test Environments & Data

| Env | Purpose | Notes |
|---|---|---|
| Local | Dev smoke | Seeded DB, Redis running |
| CI | Automated regression gate | Ephemeral DB per run, mock Redis or test instance |
| Staging | UAT / E2E | Production-like data volumes |

**Test data prerequisites**
- One user per role: `super_admin`, `admin`, `vendor`, `rider`
- Vendors with & without completed KYC
- Orders in every one of the 19 statuses
- Riders (pickup-capable, delivery-capable)
- Locations/hubs (source + destination), delivery rate table populated
- Large dataset (≥ 10k parcels) for pagination & perf

---

## 4. Test Case Catalog

### 4.1 Authentication & Session (AUTH)

| ID | Title | Type | Priority | Preconditions | Steps | Expected Result | Status |
|---|---|---|---|---|---|---|---|
| AUTH-001 | Login with valid credentials | FUNC | P0 | Active user exists | Submit correct email + password | 200; JWT cookie + `csrfToken` cookie set; redirected to role dashboard | ⬜ |
| AUTH-002 | Login with wrong password | NEG | P0 | User exists | Submit valid email, wrong password | 401; generic "invalid credentials"; no cookie set | ⬜ |
| AUTH-003 | Login with non-existent email | NEG | P1 | — | Submit unknown email | 401; same generic message (no user enumeration) | ⬜ |
| AUTH-004 | Login empty fields | NEG | P1 | — | Submit blank email/password | 400 Zod validation error; specific field errors | ⬜ |
| AUTH-005 | Password minimum length enforced | NEG | P1 | — | Password < 8 chars | Rejected with "min 8" message | ⬜ |
| AUTH-006 | Email format validation | NEG | P2 | — | `notanemail` | 400 invalid email | ⬜ |
| AUTH-007 | Account locked / disabled user | NEG | P1 | Disabled user | Attempt login | Denied with appropriate message | ⬜ |
| AUTH-008 | Force change password on first login | FUNC | P1 | User flagged must-change-password | Login | Redirected to ForceChangePassword page; cannot access app until changed | ⬜ |
| AUTH-009 | Logout clears session | FUNC | P0 | Logged in | Click logout | JWT + CSRF cookies cleared; protected routes redirect to login | ⬜ |
| AUTH-010 | Session expiry (JWT expired) | SEC | P0 | Expired token | Call protected API | 401; forced re-login | ⬜ |
| AUTH-011 | Tampered JWT rejected | SEC | P0 | Modified token payload/signature | Call protected API | 401; no data leaked | ⬜ |
| AUTH-012 | Access protected route without token | SEC | P0 | Logged out | GET protected endpoint | 401 | ⬜ |
| AUTH-013 | Brute-force rate limiting on login | SEC | P1 | — | N rapid failed logins | Rate-limited (429) after threshold | ⬜ |
| AUTH-014 | Remember/redirect to intended page after login | UI | P2 | Deep link while logged out | Login | Returned to originally requested page | ⬜ |
| AUTH-015 | Concurrent sessions behavior | SEC | P2 | Login on 2 devices | Use both | Behaves per policy (both valid or invalidate old) | ⬜ |
| AUTH-016 | Password change with correct old password | FUNC | P1 | Logged in | Submit valid old + new | Success; can log in with new password | ⬜ |
| AUTH-017 | Password change with wrong old password | NEG | P1 | Logged in | Wrong old password | Rejected | ⬜ |

### 4.2 Authorization / RBAC (RBAC)

| ID | Title | Type | Priority | Preconditions | Steps | Expected Result | Status |
|---|---|---|---|---|---|---|---|
| RBAC-001 | super_admin full access | FUNC | P0 | super_admin | Access all modules | All permitted | ⬜ |
| RBAC-002 | admin cannot access super_admin-only actions | SEC | P0 | admin | Attempt super_admin action | 403 | ⬜ |
| RBAC-003 | vendor sees only own orders | SEC | P0 | vendor A | List orders | Only vendor A's orders; cannot see vendor B's | ⬜ |
| RBAC-004 | vendor cannot access admin operations pages | SEC | P0 | vendor | GET admin ops route/API | 403 / NotAuthorized page | ⬜ |
| RBAC-005 | rider limited to assigned tasks | SEC | P0 | rider | Access order not assigned | 403 / hidden | ⬜ |
| RBAC-006 | Direct API call bypassing UI role gate | SEC | P0 | vendor token | Hit admin API directly | 403 (server enforces, not just UI) | ⬜ |
| RBAC-007 | IDOR: vendor accesses another vendor's order by ID | SEC | P0 | vendor A, order ID of B | GET /orders/:id | 403/404, no data leak | ⬜ |
| RBAC-008 | Privilege escalation via role field in request body | SEC | P0 | vendor | Send `role: admin` in update | Ignored/rejected | ⬜ |
| RBAC-009 | Staff (vendor sub-user) scoped permissions | SEC | P1 | vendor staff | Access restricted vendor action | Enforced per staff permission | ⬜ |
| RBAC-010 | NotAuthorized page renders for blocked route | UI | P2 | any role | Navigate to disallowed page | NotAuthorized page shown | ⬜ |

### 4.3 CSRF & Security Headers (SEC)

| ID | Title | Type | Priority | Preconditions | Steps | Expected Result | Status |
|---|---|---|---|---|---|---|---|
| SEC-001 | State-changing request without CSRF token | SEC | P0 | Logged in | POST without `x-csrf-token` | 403 CSRF failure | ⬜ |
| SEC-002 | Mismatched CSRF token | SEC | P0 | Logged in | Send wrong token | 403 | ⬜ |
| SEC-003 | GET requests do not require CSRF | FUNC | P2 | Logged in | GET endpoint | Succeeds | ⬜ |
| SEC-004 | CSRF token rotates/refreshes properly | SEC | P2 | Logged in | Inspect cookie lifecycle | Behaves per policy | ⬜ |
| SEC-005 | SQL injection in search/filter params | SEC | P0 | — | `' OR 1=1--` in search | Safely parameterized (Prisma); no error/leak | ⬜ |
| SEC-006 | XSS stored in order fields (name/address/remarks) | SEC | P0 | — | Submit `<script>` payload | Escaped on render; not executed | ⬜ |
| SEC-007 | XSS reflected in error messages | SEC | P1 | — | Inject in query param | Escaped | ⬜ |
| SEC-008 | Mass assignment on create/update | SEC | P1 | — | Add unexpected fields | Stripped by Zod schema | ⬜ |
| SEC-009 | Rate limiting on write endpoints | SEC | P1 | — | Flood endpoint | 429 after threshold | ⬜ |
| SEC-010 | Sensitive data not in responses (password hash, tokens) | SEC | P0 | — | Inspect any user/order response | No secrets leaked | ⬜ |
| SEC-011 | CORS restricted to allowed origins | SEC | P1 | — | Cross-origin request from unknown origin | Blocked | ⬜ |
| SEC-012 | Security headers present | SEC | P2 | — | Inspect response headers | HSTS/CSP/X-Frame-Options as configured | ⬜ |
| SEC-013 | File upload validation (KYC docs, imports) | SEC | P0 | — | Upload oversized / wrong MIME / malicious file | Rejected with clear error | ⬜ |
| SEC-014 | Cookie flags (HttpOnly, Secure, SameSite) | SEC | P0 | — | Inspect auth cookies | HttpOnly + Secure + SameSite set | ⬜ |

### 4.4 Order Creation — Single (ORD-C)

| ID | Title | Type | Priority | Preconditions | Steps | Expected Result | Status |
|---|---|---|---|---|---|---|---|
| ORD-C-001 | Create order all valid fields | FUNC | P0 | vendor w/ KYC | Fill CreateOrderPage, submit | 201; unique trackingId; status `pickup_ordered` | ⬜ |
| ORD-C-002 | Create with missing required field | NEG | P0 | — | Omit receiver name | 400 field error | ⬜ |
| ORD-C-003 | COD amount = 0 (prepaid) | FUNC | P1 | — | codAmount 0 | Accepted | ⬜ |
| ORD-C-004 | COD amount negative | NEG | P1 | — | codAmount -100 | Rejected | ⬜ |
| ORD-C-005 | COD amount boundary (max) | BVA | P2 | — | Very large amount | Handled per business max | ⬜ |
| ORD-C-006 | Invalid phone number format | NEG | P1 | — | Letters in phone | Rejected | ⬜ |
| ORD-C-007 | Delivery charge auto-calculated from rate table | FUNC | P1 | Rates configured | Choose destination | Correct charge applied | ⬜ |
| ORD-C-008 | Destination without configured rate | NEG | P1 | No rate | Select destination | Clear error / blocked | ⬜ |
| ORD-C-009 | Duplicate order detection | DATA | P2 | — | Resubmit identical order | Handled per policy (allowed or warned) | ⬜ |
| ORD-C-010 | Vendor without KYC cannot create | SEC | P1 | vendor no KYC | Attempt create | Blocked with reason | ⬜ |
| ORD-C-011 | Unicode / Nepali text in address & names | DATA | P2 | — | Devanagari input | Stored & rendered correctly | ⬜ |
| ORD-C-012 | Whitespace-only / trimmed fields | NEG | P2 | — | "   " in name | Rejected/trimmed | ⬜ |
| ORD-C-013 | Very long field values | BVA | P2 | — | Max-length strings | Enforced max length | ⬜ |
| ORD-C-014 | Special chars in fields | NEG | P2 | — | `!@#$%` in name | Accepted/escaped appropriately | ⬜ |

### 4.5 Order Creation — Bulk (ORD-B)

| ID | Title | Type | Priority | Preconditions | Steps | Expected Result | Status |
|---|---|---|---|---|---|---|---|
| ORD-B-001 | Bulk upload all valid rows | FUNC | P0 | Valid file | Upload | All created; count reported | ⬜ |
| ORD-B-002 | Bulk with some invalid rows | FUNC | P0 | Mixed file | Upload | Partial success; per-row `success/error` result; `created`/`failed` counts correct | ⬜ |
| ORD-B-003 | Bulk with default sender applied | FUNC | P1 | defaultSender set, rows omit sender | Upload | Default applied to those rows | ⬜ |
| ORD-B-004 | Empty file / no rows | NEG | P1 | — | Upload empty | Clear error | ⬜ |
| ORD-B-005 | Malformed CSV / wrong columns | NEG | P1 | — | Bad template | Rejected with guidance | ⬜ |
| ORD-B-006 | Very large batch (perf) | PERF | P1 | 10k rows | Upload | Completes within threshold; no timeout; transactional integrity | ⬜ |
| ORD-B-007 | Partial failure does not corrupt successful rows | DATA | P0 | Mixed | Upload | Valid rows persisted, invalid skipped | ⬜ |
| ORD-B-008 | Duplicate tracking IDs within batch | DATA | P1 | — | Dup rows | Handled/reported | ⬜ |

### 4.6 Order Listing, Search, Filter, Sort (ORD-L)

| ID | Title | Type | Priority | Preconditions | Steps | Expected Result | Status |
|---|---|---|---|---|---|---|---|
| ORD-L-001 | List default page | FUNC | P0 | Orders exist | Open list | First page shown; correct page size | ⬜ |
| ORD-L-002 | Filter by single status | FUNC | P0 | — | Filter `delivered` | Only delivered shown | ⬜ |
| ORD-L-003 | Filter by multiple statuses | FUNC | P1 | — | Multi-select statuses | Union returned | ⬜ |
| ORD-L-004 | Filter by orderType | FUNC | P1 | — | Select type | Correct subset | ⬜ |
| ORD-L-005 | Search by trackingId | FUNC | P0 | — | Enter tracking id | Exact match found | ⬜ |
| ORD-L-006 | Search by receiver name / phone | FUNC | P1 | — | Partial term | Relevant matches | ⬜ |
| ORD-L-007 | Search no results | FUNC | P2 | — | Nonsense term | Empty state shown | ⬜ |
| ORD-L-008 | Sort by createdAt asc/desc | FUNC | P1 | — | Toggle sort | Correct order | ⬜ |
| ORD-L-009 | Sort by codAmount / deliveryCharge / trackingId / status | FUNC | P1 | — | Each sort field | Correct order | ⬜ |
| ORD-L-010 | Invalid sortBy value rejected | NEG | P2 | — | `sortBy=hack` | 400 / ignored | ⬜ |
| ORD-L-011 | Combined filter + search + sort | FUNC | P1 | — | Apply all | Correct intersection & order | ⬜ |
| ORD-L-012 | Empty dataset state | UI | P2 | No orders | Open list | Friendly empty state | ⬜ |

### 4.7 Keyset Pagination (PAG) — *current branch focus*

| ID | Title | Type | Priority | Preconditions | Steps | Expected Result | Status |
|---|---|---|---|---|---|---|---|
| PAG-001 | Next page navigation | FUNC | P0 | > 2 pages | Click Next | Next rows, no overlap, no gaps | ⬜ |
| PAG-002 | Previous page navigation | FUNC | P0 | On page 2+ | Click Prev | Correct previous rows | ⬜ |
| PAG-003 | Round-trip next→prev returns same page | FUNC | P0 | — | Next then Prev | Identical rows to original page | ⬜ |
| PAG-004 | First page (no cursor) | FUNC | P0 | — | Load list | Top of dataset per sort | ⬜ |
| PAG-005 | Last page behavior | FUNC | P1 | — | Page to end | Next disabled; no crash | ⬜ |
| PAG-006 | Cursor stable under concurrent inserts | DATA | P0 | Insert during paging | Insert then Next | No skipped/duplicated rows (keyset property) | ⬜ |
| PAG-007 | Pagination with active filter | FUNC | P0 | Filter applied | Page through | Cursor respects filter | ⬜ |
| PAG-008 | Pagination with sort change resets cursor | FUNC | P1 | On page 3 | Change sortBy | Resets to first page correctly | ⬜ |
| PAG-009 | Tampered / malformed cursor | NEG/SEC | P0 | — | Send garbage base64 cursor | 400, no server error/leak | ⬜ |
| PAG-010 | Cursor for another sort field mismatch | NEG | P1 | — | Reuse cursor after sort change | Rejected/handled gracefully | ⬜ |
| PAG-011 | pageSize boundary (min=1, max cap) | BVA | P1 | — | pageSize 1, huge, 0, negative | Clamped/validated | ⬜ |
| PAG-012 | page hint echoed in meta | FUNC | P2 | — | Request with page=5 | Meta echoes hint; data from cursor | ⬜ |
| PAG-013 | Sort by non-unique field (status) tie-break by id | DATA | P0 | Many same-status rows | Page through | Deterministic order via id tiebreak; no dup/skip | ⬜ |
| PAG-014 | Index used (perf) for keyset query | PERF | P1 | Large dataset | Query with EXPLAIN | Uses `parcels_keyset_index`; fast | ⬜ |
| PAG-015 | Deleting current page's boundary row | DATA | P2 | — | Delete boundary then Next | Graceful, no crash | ⬜ |
| PAG-016 | Direct URL/deep-link with cursor | FUNC | P2 | — | Load URL with cursor param | Correct page restored | ⬜ |

### 4.8 Order Status State Machine (SM)

> 19 states. Transition rules in `STATUS_TRANSITIONS`. Test **every allowed transition**, a sample of **disallowed** ones, and **terminal** states.

**Allowed transitions to verify (positive):**

| ID | From → To | Priority | Notes | Status |
|---|---|---|---|---|
| SM-001 | pickup_ordered → rider_assigned | P0 | Requires pickup `riderId` | ⬜ |
| SM-002 | pickup_ordered → cancelled | P1 | — | ⬜ |
| SM-003 | rider_assigned → picked_up | P0 | — | ⬜ |
| SM-004 | rider_assigned → failed_pickup | P1 | — | ⬜ |
| SM-005 | rider_assigned → cancelled | P1 | — | ⬜ |
| SM-006 | picked_up → arrived | P0 | — | ⬜ |
| SM-007 | arrived → ready_to_deliver | P0 | — | ⬜ |
| SM-008 | arrived → oov | P1 | — | ⬜ |
| SM-009 | oov → dispatched | P1 | Bulk requires `toLocationId` | ⬜ |
| SM-010 | oov → hold | P1 | — | ⬜ |
| SM-011 | dispatched → arrived_at_branch | P0 | — | ⬜ |
| SM-012 | arrived_at_branch → ready_to_deliver | P0 | — | ⬜ |
| SM-013 | ready_to_deliver → sent_for_delivery | P0 | Requires delivery `riderId` | ⬜ |
| SM-014 | ready_to_deliver → hold | P1 | — | ⬜ |
| SM-015 | sent_for_delivery → delivered | P0 | Terminal on success | ⬜ |
| SM-016 | sent_for_delivery → failed_delivery | P0 | — | ⬜ |
| SM-017 | hold → ready_to_deliver | P1 | — | ⬜ |
| SM-018 | hold → oov | P2 | — | ⬜ |
| SM-019 | hold → loss_and_damage | P1 | — | ⬜ |
| SM-020 | failed_pickup → pickup_ordered | P1 | Re-attempt | ⬜ |
| SM-021 | failed_pickup → cancelled | P2 | — | ⬜ |
| SM-022 | failed_delivery → ready_to_deliver | P1 | Re-attempt | ⬜ |
| SM-023 | failed_delivery → follow_up | P1 | NDR | ⬜ |
| SM-024 | failed_delivery → ready_to_return | P1 | RTO | ⬜ |
| SM-025 | loss_and_damage → ready_to_deliver | P2 | Recovery | ⬜ |
| SM-026 | loss_and_damage → arrived_at_branch | P2 | — | ⬜ |
| SM-027 | follow_up → ready_to_deliver | P1 | — | ⬜ |
| SM-028 | follow_up → ready_to_return | P1 | — | ⬜ |
| SM-029 | ready_to_return → sent_to_vendor | P1 | — | ⬜ |
| SM-030 | sent_to_vendor → returned_to_vendor | P1 | — | ⬜ |

**Negative / guard transitions:**

| ID | Title | Type | Priority | Expected | Status |
|---|---|---|---|---|---|
| SM-N01 | Transition to non-adjacent status | NEG | P0 | Rejected (e.g. pickup_ordered → delivered) | ⬜ |
| SM-N02 | Any transition from terminal `delivered` | NEG | P0 | Rejected (empty allowed set) | ⬜ |
| SM-N03 | Any transition from terminal `cancelled` | NEG | P0 | Rejected | ⬜ |
| SM-N04 | Any transition from terminal `returned_to_vendor` | NEG | P1 | Rejected | ⬜ |
| SM-N05 | rider_assigned without providing riderId | NEG | P0 | 400 riderId required | ⬜ |
| SM-N06 | sent_for_delivery without delivery riderId | NEG | P0 | 400 riderId required | ⬜ |
| SM-N07 | dispatched (bulk) without toLocationId | NEG | P0 | 400 toLocationId required | ⬜ |
| SM-N08 | Unauthorized role attempts a transition | SEC | P0 | 403 (per role transition permission) | ⬜ |
| SM-N09 | Invalid status string | NEG | P1 | 400 Zod enum error | ⬜ |
| SM-N10 | Concurrent transition (race) on same order | DATA | P0 | One wins; no invalid final state | ⬜ |
| SM-N11 | Assigning inactive/wrong-type rider | NEG | P1 | Rejected | ⬜ |
| SM-N12 | Status history/audit recorded on each change | DATA | P1 | Timeline reflects transition + actor + timestamp | ⬜ |

### 4.9 Bulk Status Update / Manifests (SM-BULK)

| ID | Title | Type | Priority | Expected | Status |
|---|---|---|---|---|---|
| SM-BULK-01 | Bulk transition N valid orders | FUNC | P0 | All updated; count reported | ⬜ |
| SM-BULK-02 | Bulk with mixed valid/invalid states | FUNC | P0 | Valid updated, invalid reported, no partial corruption | ⬜ |
| SM-BULK-03 | Bulk dispatched requires toLocationId | NEG | P0 | Rejected without hub | ⬜ |
| SM-BULK-04 | Bulk with empty ids array | NEG | P1 | 400 | ⬜ |
| SM-BULK-05 | Bulk with duplicate ids | DATA | P2 | Deduped/handled | ⬜ |
| SM-BULK-06 | Bulk across another vendor's orders (IDOR) | SEC | P0 | Blocked | ⬜ |
| SM-BULK-07 | Very large bulk (perf) | PERF | P1 | Within threshold, transactional | ⬜ |

### 4.10 Operations Pages (OPS)

> Pages: PickupOperations, DispatchOperations, HoldOperations, OOVOperations, LossAndDamageOperations, ReturnOperations, OrderManagement.

| ID | Title | Type | Priority | Expected | Status |
|---|---|---|---|---|---|
| OPS-001 | Each ops page loads correct status subset | FUNC | P0 | Correct filtered orders per page | ⬜ |
| OPS-002 | Row selection (single/multi/select-all) | UI | P1 | Selection state correct | ⬜ |
| OPS-003 | Bulk action button reflects valid next states | UI | P1 | Only allowed actions enabled | ⬜ |
| OPS-004 | Assign rider modal (pickup/delivery) | FUNC | P0 | Rider list scoped correctly; assign works | ⬜ |
| OPS-005 | Dispatch manifest to hub | FUNC | P0 | Manifest created with destination | ⬜ |
| OPS-006 | Hold with reason/remark | FUNC | P1 | Remark saved | ⬜ |
| OPS-007 | Loss & Damage recording | FUNC | P1 | Recorded; downstream finance impact if any | ⬜ |
| OPS-008 | Return-to-vendor workflow end-to-end | E2E | P1 | ready_to_return → sent_to_vendor → returned_to_vendor | ⬜ |
| OPS-009 | Pagination + filters work on each ops page | REG | P1 | Consistent behavior | ⬜ |
| OPS-010 | Optimistic UI vs server error rollback | UI | P1 | UI reverts on failure with message | ⬜ |

### 4.11 Vendor Portal (VEN)

| ID | Title | Type | Priority | Expected | Status |
|---|---|---|---|---|---|
| VEN-001 | Vendor dashboard KPIs correct | FUNC | P1 | Numbers match underlying data | ⬜ |
| VEN-002 | Vendor orders list scoped to vendor | SEC | P0 | Only own orders | ⬜ |
| VEN-003 | Pending COD list & totals | DATA | P0 | Correct COD sums | ⬜ |
| VEN-004 | Settlements list & status | FUNC | P1 | Accurate settlement records | ⬜ |
| VEN-005 | Order payments view | FUNC | P1 | Payment records correct | ⬜ |
| VEN-006 | Delivery charges view | FUNC | P1 | Matches rate table | ⬜ |
| VEN-007 | Vendor staff (sub-user) CRUD | FUNC | P1 | Create/edit/deactivate staff | ⬜ |
| VEN-008 | Staff permission scoping | SEC | P1 | Staff limited to granted actions | ⬜ |
| VEN-009 | Vendor bulk order page | FUNC | P1 | See ORD-B suite | ⬜ |
| VEN-010 | COD reconciliation math (delivered − charges) | DATA | P0 | No rounding/aggregation errors | ⬜ |

### 4.12 KYC (KYC)

| ID | Title | Type | Priority | Expected | Status |
|---|---|---|---|---|---|
| KYC-001 | Submit KYC application with docs | FUNC | P1 | Saved, status pending | ⬜ |
| KYC-002 | Invalid/oversized document upload | NEG/SEC | P1 | Rejected | ⬜ |
| KYC-003 | Admin approves KYC | FUNC | P1 | Vendor becomes active/able to create orders | ⬜ |
| KYC-004 | Admin rejects KYC with reason | FUNC | P1 | Status rejected; reason shown | ⬜ |
| KYC-005 | Vendor cannot approve own KYC | SEC | P0 | 403 | ⬜ |
| KYC-006 | Resubmit after rejection | FUNC | P2 | Allowed | ⬜ |

### 4.13 Finance (FIN)

| ID | Title | Type | Priority | Expected | Status |
|---|---|---|---|---|---|
| FIN-001 | Finance dashboard totals | DATA | P0 | Accurate aggregates | ⬜ |
| FIN-002 | COD collected vs settled reconciliation | DATA | P0 | Balances correct | ⬜ |
| FIN-003 | Settlement creation | FUNC | P1 | Correct amount, marks orders settled | ⬜ |
| FIN-004 | Currency/decimal rounding | DATA | P0 | No floating errors; 2-decimal consistency | ⬜ |
| FIN-005 | Negative/zero settlement guard | NEG | P1 | Rejected | ⬜ |
| FIN-006 | Export/report accuracy | DATA | P2 | Matches on-screen data | ⬜ |

### 4.14 Delivery Rates & Pricing (RATE)

| ID | Title | Type | Priority | Expected | Status |
|---|---|---|---|---|---|
| RATE-001 | Create/edit single rate | FUNC | P1 | Saved and applied | ⬜ |
| RATE-002 | Bulk import rates (valid) | FUNC | P0 | All imported | ⬜ |
| RATE-003 | Bulk import with invalid rows | NEG | P1 | Partial + error report | ⬜ |
| RATE-004 | Overlapping/duplicate rate resolution | DATA | P1 | Deterministic resolution | ⬜ |
| RATE-005 | Rate change does not retroactively alter past orders | DATA | P1 | Historical charges preserved | ⬜ |
| RATE-006 | Destination without rate blocks order | NEG | P1 | See ORD-C-008 | ⬜ |

### 4.15 Tickets & Remarks (SUP)

| ID | Title | Type | Priority | Expected | Status |
|---|---|---|---|---|---|
| SUP-001 | Create ticket | FUNC | P1 | Saved with status open | ⬜ |
| SUP-002 | Ticket detail & status update | FUNC | P1 | Transitions valid | ⬜ |
| SUP-003 | Add remark to order | FUNC | P1 | Remark linked to order | ⬜ |
| SUP-004 | Unclosed remarks view | FUNC | P2 | Correct filtered list | ⬜ |
| SUP-005 | Remark visibility per role | SEC | P1 | Scoped correctly | ⬜ |

### 4.16 Rider Run Sheet (RUN)

| ID | Title | Type | Priority | Expected | Status |
|---|---|---|---|---|---|
| RUN-001 | Generate run sheet for rider | FUNC | P1 | Correct assigned parcels listed | ⬜ |
| RUN-002 | Persisted run sheet reload | DATA | P1 | Reloads same sheet | ⬜ |
| RUN-003 | Admin-side Run Sheet page | FUNC | P1 | Shows rider sheets | ⬜ |
| RUN-004 | Rider marks pickup/delivery outcomes | FUNC | P0 | Status transitions applied | ⬜ |
| RUN-005 | Run sheet reflects reassignments | DATA | P2 | Updated correctly | ⬜ |

### 4.17 Notifications / SSE (NOTIF)

| ID | Title | Type | Priority | Expected | Status |
|---|---|---|---|---|---|
| NOTIF-001 | SSE connection establishes | INT | P1 | Stream opens per user | ⬜ |
| NOTIF-002 | Status change pushes notification | INT | P1 | Relevant user notified in real time | ⬜ |
| NOTIF-003 | Redis PubSub fan-out | INT | P1 | Multiple subscribers receive | ⬜ |
| NOTIF-004 | Reconnect after drop | INT | P2 | Auto-reconnect | ⬜ |
| NOTIF-005 | Notification scoping (no cross-tenant leak) | SEC | P0 | Only intended recipient | ⬜ |
| NOTIF-006 | Mark read / unread count | FUNC | P2 | Accurate count | ⬜ |

### 4.18 Redis Caching & Rate Limiting (CACHE)

| ID | Title | Type | Priority | Expected | Status |
|---|---|---|---|---|---|
| CACHE-001 | Dashboard cache hit within TTL (30s) | PERF | P1 | Served from cache | ⬜ |
| CACHE-002 | Orders cache hit within TTL (20s) | PERF | P1 | Served from cache | ⬜ |
| CACHE-003 | Cache invalidation on write | DATA | P0 | Stale data not served after order change | ⬜ |
| CACHE-004 | Redis down — graceful degradation | INT | P0 | Falls back to DB; bounded timeout; no hang | ⬜ |
| CACHE-005 | Redis command timeout bound respected | PERF | P1 | No unbounded blocking | ⬜ |
| CACHE-006 | Cache key isolation per vendor/role | SEC | P0 | No cross-tenant cache leakage | ⬜ |

### 4.19 Internationalization / Nepali (BS) Dates (I18N)

| ID | Title | Type | Priority | Expected | Status |
|---|---|---|---|---|---|
| I18N-001 | BS date displays app-wide | FUNC | P1 | Correct AD→BS conversion | ⬜ |
| I18N-002 | BS date boundary (month/year rollover) | BVA | P1 | Correct at edges | ⬜ |
| I18N-003 | Timezone handling (NPT +05:45) | DATA | P1 | No off-by-one day | ⬜ |
| I18N-004 | Devanagari numerals/text rendering | UI | P2 | Correct glyphs | ⬜ |
| I18N-005 | Date filters use correct calendar | FUNC | P1 | Filter results align with displayed dates | ⬜ |

### 4.20 Cross-cutting UI / UX / A11Y (UX)

| ID | Title | Type | Priority | Expected | Status |
|---|---|---|---|---|---|
| UX-001 | Loading states on all async actions | UI | P2 | Spinners/skeletons shown | ⬜ |
| UX-002 | Error toasts show specific messages | UI | P1 | Not generic "something went wrong" | ⬜ |
| UX-003 | Form field-level validation feedback | UI | P1 | Inline errors per field | ⬜ |
| UX-004 | Responsive layout (mobile/tablet/desktop) | UI | P2 | No overflow/broken layout | ⬜ |
| UX-005 | Keyboard navigation & focus order | A11Y | P2 | Fully operable via keyboard | ⬜ |
| UX-006 | Screen reader labels on controls | A11Y | P2 | Meaningful labels (axe-core clean) | ⬜ |
| UX-007 | Color contrast WCAG AA | A11Y | P3 | Passes contrast | ⬜ |
| UX-008 | Browser back/forward preserves state | UI | P2 | List/filter/cursor state sane | ⬜ |
| UX-009 | Session timeout UX | UI | P2 | Graceful redirect + message | ⬜ |
| UX-010 | Double-submit prevention on forms | UI | P1 | Button disabled during submit | ⬜ |

### 4.21 API Contract & Error Handling (API)

| ID | Title | Type | Priority | Expected | Status |
|---|---|---|---|---|---|
| API-001 | Correct HTTP status codes per outcome | INT | P1 | 200/201/400/401/403/404/409/422/429/500 as appropriate | ⬜ |
| API-002 | Consistent error response shape | INT | P1 | Uniform `{error/message}` schema | ⬜ |
| API-003 | 404 for unknown resource id | NEG | P1 | 404 not 500 | ⬜ |
| API-004 | Validation errors list all fields | NEG | P1 | Full field error map | ⬜ |
| API-005 | 500 handler hides stack traces in prod | SEC | P0 | No internal leakage | ⬜ |
| API-006 | Idempotency of safe methods | INT | P2 | GET has no side effects | ⬜ |
| API-007 | Content-Type enforcement | NEG | P2 | Non-JSON body rejected | ⬜ |
| API-008 | Pagination meta contract stable | INT | P1 | `hasNext/hasPrev/cursor` consistent | ⬜ |

### 4.22 Data Integrity & Migrations (DATA)

| ID | Title | Type | Priority | Expected | Status |
|---|---|---|---|---|---|
| DATA-001 | Prisma migration applies cleanly | DATA | P0 | Up migration succeeds (incl. keyset index) | ⬜ |
| DATA-002 | Migration rollback safe | DATA | P1 | Down migration reversible | ⬜ |
| DATA-003 | Foreign key constraints enforced | DATA | P0 | Orphan records prevented | ⬜ |
| DATA-004 | Unique constraints (trackingId) | DATA | P0 | No duplicates possible | ⬜ |
| DATA-005 | Cascade/soft-delete behavior | DATA | P1 | Per design; no dangling refs | ⬜ |
| DATA-006 | Transaction atomicity on multi-step ops | DATA | P0 | All-or-nothing | ⬜ |
| DATA-007 | Timezone/timestamp storage (UTC) | DATA | P1 | Stored UTC, displayed local/BS | ⬜ |
| DATA-008 | Audit trail immutability | DATA | P1 | History not editable | ⬜ |

### 4.23 Performance & Load (PERF)

| ID | Title | Type | Priority | Threshold (suggested) | Status |
|---|---|---|---|---|---|
| PERF-001 | Order list p95 latency | PERF | P1 | < 300ms at 10k rows (cached), < 800ms uncached | ⬜ |
| PERF-002 | Keyset pagination scales flat | PERF | P0 | Page N ≈ Page 1 latency (no offset degradation) | ⬜ |
| PERF-003 | Bulk create 10k throughput | PERF | P1 | Within agreed SLA | ⬜ |
| PERF-004 | Dashboard under concurrent users | PERF | P1 | Stable at target concurrency | ⬜ |
| PERF-005 | No N+1 queries on list endpoints | PERF | P1 | Verified via query logs | ⬜ |
| PERF-006 | Memory/connection pool stability | PERF | P2 | No leaks over sustained load | ⬜ |

### 4.24 End-to-End Journeys (E2E)

| ID | Journey | Priority | Steps (happy path) | Status |
|---|---|---|---|---|
| E2E-001 | Order full lifecycle | P0 | Vendor creates → rider assigned → picked_up → arrived → ready_to_deliver → sent_for_delivery → delivered → COD settled | ⬜ |
| E2E-002 | Failed delivery → RTO | P1 | ...→ sent_for_delivery → failed_delivery → follow_up → ready_to_return → sent_to_vendor → returned_to_vendor | ⬜ |
| E2E-003 | Failed pickup → re-attempt | P1 | rider_assigned → failed_pickup → pickup_ordered → ... → delivered | ⬜ |
| E2E-004 | Hub dispatch flow | P1 | arrived → oov → dispatched (hub) → arrived_at_branch → ready_to_deliver → delivered | ⬜ |
| E2E-005 | New vendor onboarding | P1 | Register → KYC submit → admin approve → create first order | ⬜ |
| E2E-006 | Bulk import → operate → settle | P1 | Bulk create → assign → deliver batch → reconcile COD | ⬜ |
| E2E-007 | Hold & loss/damage recovery | P2 | ready_to_deliver → hold → loss_and_damage → ready_to_deliver → delivered | ⬜ |

---

## 5. Regression Suite (per-release smoke)

Minimum set to run before every release (all P0 above):
AUTH-001/009/010/012 · RBAC-001/003/006/007 · SEC-001/005/006/010/014 · ORD-C-001 · ORD-B-001/007 · ORD-L-001/005 · PAG-001..004/006/009/013 · SM-001/003/006/007/011/013/015/016 + SM-N01/N02/N05/N06/N07 · SM-BULK-01/03/06 · CACHE-003/004 · DATA-001/004/006 · E2E-001.

---

## 6. Traceability Matrix (fill during planning)

| Requirement / Feature | Test Case IDs | Owner | Automated? |
|---|---|---|---|
| Keyset pagination | PAG-001..016, PERF-002 | | |
| Status state machine | SM-001..030, SM-N01..N12 | | |
| Auth & session | AUTH-*, SEC-014 | | |
| RBAC & tenancy isolation | RBAC-*, SM-BULK-06, CACHE-006 | | |
| Bulk operations | ORD-B-*, SM-BULK-*, RATE-002/003 | | |
| Finance/COD | FIN-*, VEN-003/010 | | |

---

## 7. Defect & Execution Tracking

| Run / Sprint | Date | Total | ✅ Pass | ❌ Fail | 🚫 Blocked | ⏭️ Skipped | Notes |
|---|---|---|---|---|---|---|---|
| | | | | | | | |

**Defect log**

| Bug ID | Test Case ID | Severity | Summary | Status | Fixed in |
|---|---|---|---|---|---|
| | | | | | |

---

## 8. Test Design Notes (industry-standard techniques applied)

- **Equivalence Partitioning:** valid/invalid classes for each input (COD, phone, email, pageSize).
- **Boundary Value Analysis:** min/max/zero/negative for amounts, pageSize, string lengths, date rollovers.
- **State Transition Testing:** full coverage of `STATUS_TRANSITIONS` (allowed + illegal + terminal).
- **Decision Tables:** role × action matrices for RBAC and status-transition permissions.
- **Negative Testing:** malformed cursors, injection, tampered tokens, missing required conditional fields.
- **Security Testing:** OWASP-aligned — authz/IDOR, injection, XSS, CSRF, sensitive-data exposure, rate limiting.
- **Non-functional:** performance thresholds, cache correctness, accessibility (WCAG AA), i18n correctness.

---

*Update the Status columns and Section 7 tables each test cycle. Add new cases under the appropriate module prefix and keep IDs stable for traceability.*
