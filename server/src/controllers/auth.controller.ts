import express, { Request, Response } from "express";
import {
  changePassword,
  loginUser,
  registerUserBySuperAdmin,
  updateAdminPermissions,
  updateManagedUserPassword,
  updateManagedUserProfile,
  getManagedUserDetail,
} from "../services/auth.service";
import { AppError } from "../utils/AppError";
import { sendSuccess } from "../utils/ApiResponse";
import jwt from "jsonwebtoken";
import prisma from "../lib/prisma";
import { revokeToken } from "../lib/tokenRevocation";
import { ACCESS_TOKEN_AUDIENCE, CSRF_TOKEN_AUDIENCE, JWT_ALGORITHM, JWT_ISSUER } from "../utils/jwtConfig";

const formatDate = (date?: Date | null) => date ? date.toISOString().slice(0, 10) : "";
const managedUserTypes = ["admin", "vendor", "rider"] as const;
type ManagedUserType = typeof managedUserTypes[number];

const isManagedUserType = (value: unknown): value is ManagedUserType =>
  typeof value === "string" && managedUserTypes.includes(value as ManagedUserType);

const locationLabel = (location?: { name: string; city: string | null; district: string | null } | null) => {
  if (!location) return "";
  return [location.name, location.city || location.district].filter(Boolean).join(", ");
};

const LIST_DEFAULT_PAGE_SIZE = 20;
const LIST_MAX_PAGE_SIZE = 100;

function paginationFromQuery(req: Request) {
  const page = Number.isFinite(Number(req.query.page)) ? Math.max(1, Number(req.query.page)) : 1;
  const pageSize = Number.isFinite(Number(req.query.pageSize))
    ? Math.min(LIST_MAX_PAGE_SIZE, Math.max(1, Number(req.query.pageSize)))
    : LIST_DEFAULT_PAGE_SIZE;
  return { page, pageSize, skip: (page - 1) * pageSize };
}

const RETURNED_STATUSES = ["failed_pickup", "failed_delivery", "cancelled"] as const;

export const registerUserController = async (req: Request, res: Response) => {
  try {
    const SuperAdminUserID = req.user?.id;

    if (!SuperAdminUserID) {
      throw new AppError(401, "Unauthorized");
    }

    // Multipart registration: merge uploaded document paths into the payload.
    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    const docPath = (f?: Express.Multer.File) =>
      f?.filename ? `uploads/registration/${f.filename}` : undefined;

    const result = await registerUserBySuperAdmin(SuperAdminUserID, {
      ...req.body,
      idDocumentPath: docPath(files?.idDocument?.[0]),
      citizenshipDocPath: docPath(files?.citizenshipDoc?.[0]),
      panDocPath: docPath(files?.panDoc?.[0]),
      panVatDocPath: docPath(files?.panVatDoc?.[0]),
      experienceLetterDocPath: docPath(files?.experienceLetterDoc?.[0]),
      licenceDocPath: docPath(files?.licenceDoc?.[0]),
      bluebookDocPath: docPath(files?.bluebookDoc?.[0]),
      businessCertDocPath: docPath(files?.businessCertDoc?.[0]),
    });

    return sendSuccess(res, 201, `${result.role} registered successfully`, {
      user: {
        id: result.user.id,
        fullName: result.user.full_name,
        email: result.user.email,
        phone: result.user.phone,
        status: result.user.status,
        createdAt: result.user.created_at,
      },
      profile: result.profile,
      role: result.role,
    });
  } catch (error: any) {
    console.error("[Register] error:", error.code, error.message);
    if (error.code === "P2002") {
      return res.status(409).json({
        success: false,
        message: "Email or phone number already exists",
        field: error.meta?.target,
      });
    }
    return res.status(error.statusCode || 400).json({
      success: false,
      message: error.message || "Failed to register user",
    });
  }
};

export const getManagedUserController = async (req: Request, res: Response) => {
  try {
    const actorUserId = req.user?.id;
    const { type, id } = req.params;

    if (!actorUserId) {
      throw new AppError(401, "Unauthorized");
    }

    if (!isManagedUserType(type) || typeof id !== "string") {
      throw new AppError(400, "Invalid user type");
    }
    const data = await getManagedUserDetail(actorUserId, type, id);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to load user",
    });
  }
};

export const updateManagedUserController = async (req: Request, res: Response) => {
  try {
    const actorUserId = req.user?.id;
    const { type, id } = req.params;

    if (!actorUserId) {
      throw new AppError(401, "Unauthorized");
    }

    if (!isManagedUserType(type) || typeof id !== "string") {
      throw new AppError(400, "Invalid user type");
    }

    await updateManagedUserProfile(actorUserId, id, {
      ...req.body,
      type,
    });

    return sendSuccess(res, 200, "User updated successfully");
  } catch (error: any) {
    if (error.code === "P2002") {
      return res.status(409).json({
        success: false,
        message: "Email or phone number already exists",
        field: error.meta?.target,
      });
    }

    return res.status(error.statusCode || 400).json({
      success: false,
      message: error.message || "Failed to update user",
    });
  }
};

export const updateManagedUserPasswordController = async (req: Request, res: Response) => {
  try {
    const actorUserId = req.user?.id;
    const { type, id } = req.params;
    const { password } = req.body;

    if (!actorUserId) {
      throw new AppError(401, "Unauthorized");
    }

    if (!isManagedUserType(type) || typeof id !== "string") {
      throw new AppError(400, "Invalid user type");
    }

    await updateManagedUserPassword(
      actorUserId,
      type,
      id,
      password,
    );

    return sendSuccess(res, 200, "Password updated successfully");
  } catch (error: any) {
    return res.status(error.statusCode || 400).json({
      success: false,
      message: error.message || "Failed to update password",
    });
  }
};

export const updateAdminPermissionsController = async (req: Request, res: Response) => {
  try {
    const actorUserId = req.user?.id;
    const { id } = req.params;
    const { permissions } = req.body;

    if (!actorUserId) {
      throw new AppError(401, "Unauthorized");
    }

    if (typeof id !== "string") {
      throw new AppError(400, "Invalid admin id");
    }

    const updated = await updateAdminPermissions(actorUserId, id, permissions);

    return sendSuccess(res, 200, "Permissions updated successfully", updated);
  } catch (error: any) {
    return res.status(error.statusCode || 400).json({
      success: false,
      message: error.message || "Failed to update permissions",
    });
  }
};

export const login = async (req: Request, res: Response) => {
  try {
    //fetch data from request body
    const { email, password } = req.body;

    // Request validation
    if (!email || !password) {
      throw new AppError(400, "Email and password are required");
    }

    const result = await loginUser({ email, password });
    // const csrfToken = crypto.randomBytes(32).toString("hex");
    const secret = process.env.CSRF_SECRET;

    if (!secret) {
      throw new Error("CSRF_SECRET is not set");
    }

    const csrfToken = jwt.sign({ sub: result.user.id }, secret, {
      expiresIn: "7d",
      algorithm: JWT_ALGORITHM,
      issuer: JWT_ISSUER,
      audience: CSRF_TOKEN_AUDIENCE,
    });

    res.cookie("accessToken", result.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      // "none" is required for the frontend/backend to sit on different
      // origins (e.g. two separate Railway services) - "lax" silently drops
      // the cookie on cross-site XHR/fetch. Browsers only allow "none" when
      // secure is also true, which holds in production (HTTPS).
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      path: "/",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    res.cookie("csrfToken", csrfToken, {
      httpOnly: false,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      path: "/",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return res.status(200).json({
      success: true,
      message: "Login successful",
      data: result.user,
      csrfToken,
    });
  } catch (error: any) {
    console.error("Error in login controller:", error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Internal Server Error",
      ...(error instanceof AppError && error.code ? { code: error.code } : {}),
    });
  }
};

// No page/pageSize params here (unlike getVendorsController/getRidersController) -
// the admin list UI (AdminManagement.tsx) renders the full list client-side with
// no pagination controls. This cap is just a defensive ceiling against unbounded
// growth, not real pagination; adding that would need a matching frontend change.
const ADMINS_LIST_CAP = 500;

export const getAdminsController = async (_req: Request, res: Response) => {
  try {
    const admins = await prisma.admins.findMany({
      where: {
        users: { is: { deleted_at: null } },
      },
      include: {
        users: true,
        locations: true,
      },
      orderBy: { created_at: "desc" },
      take: ADMINS_LIST_CAP,
    });

    return res.status(200).json({
      success: true,
      data: admins.map((admin, index) => ({
        id: admin.id,
        userId: admin.user_id,
        sn: index + 1,
        name: admin.users.full_name,
        email: admin.users.email || "",
        phone: admin.users.phone || "",
        location: locationLabel(admin.locations),
        locationId: admin.location_id,
        position: admin.position || "",
        department: admin.department || "",
        joined: formatDate(admin.joined_at),
        status: admin.users.status,
        permissions: admin.permissions,
      })),
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to load admins",
    });
  }
};

export const getVendorsController = async (req: Request, res: Response) => {
  try {
    // Sales accounts see only the vendors (clients) they own; a vendor/vendor_staff
    // actor sees only their own vendor record (needed by CreateOrderPage to look up
    // its own address/location); staff see all.
    const roles = req.user?.roles ?? [];
    const isStaff = roles.includes("super_admin") || roles.includes("admin");
    let scope: Record<string, unknown> = {};
    if (roles.includes("sales") && !isStaff) {
      scope = { sales_user_id: req.user!.id };
    } else if (roles.includes("vendor") && !isStaff) {
      scope = { user_id: req.user!.id };
    } else if (roles.includes("vendor_staff") && !isStaff) {
      const staffRecord = await prisma.vendor_staff.findFirst({
        where: { user_id: req.user!.id, deleted_at: null, enabled: true },
        select: { vendor_id: true },
      });
      scope = { id: staffRecord?.vendor_id ?? "__none__" };
    }
    const where = { deleted_at: null, ...scope };

    const { page, pageSize, skip } = paginationFromQuery(req);

    const [total, vendors] = await Promise.all([
      prisma.vendors.count({ where }),
      prisma.vendors.findMany({
        where,
        include: { locations: true },
        orderBy: { created_at: "desc" },
        skip,
        take: pageSize,
      }),
    ]);

    const vendorIds = vendors.map(v => v.id);

    // Aggregate order counts and pending COD per vendor in the DB instead of
    // pulling every parcel/cod_collection row for each vendor into memory.
    const [statusCounts, codSums] = vendorIds.length
      ? await Promise.all([
          prisma.parcels.groupBy({
            by: ["vendor_id", "status"],
            where: { vendor_id: { in: vendorIds }, deleted_at: null },
            _count: { _all: true },
          }),
          prisma.cod_collections.groupBy({
            by: ["vendor_id"],
            where: { vendor_id: { in: vendorIds }, payment_status: "pending" },
            _sum: { pending_amount: true },
          }),
        ])
      : [[], []];

    const ordersByVendor = new Map<string, { total: number; delivered: number; returned: number }>();
    for (const row of statusCounts) {
      const vendorId = row.vendor_id as string | null;
      if (!vendorId) continue;
      const entry = ordersByVendor.get(vendorId) ?? { total: 0, delivered: 0, returned: 0 };
      entry.total += row._count._all;
      if (row.status === "delivered") entry.delivered += row._count._all;
      if ((RETURNED_STATUSES as readonly string[]).includes(row.status)) entry.returned += row._count._all;
      ordersByVendor.set(vendorId, entry);
    }

    const codByVendor = new Map<string, number>();
    for (const row of codSums) {
      if (!row.vendor_id) continue;
      codByVendor.set(row.vendor_id, Number(row._sum.pending_amount || 0));
    }

    return res.status(200).json({
      success: true,
      data: vendors.map((vendor, index) => ({
        id: vendor.id,
        userId: vendor.user_id,
        sn: skip + index + 1,
        client: vendor.client_name,
        company: vendor.business_name || "",
        email: vendor.email || "",
        phone: vendor.phone,
        location: locationLabel(vendor.locations),
        locationId: vendor.location_id,
        // Prefer the vendor's pickup Location over the registered/billing
        // address - it's what actually gets used as the sender's address
        // when staff create an order on this vendor's behalf.
        address: vendor.pickup_landmark || vendor.address || "",
        sales: vendor.sales || "",
        salesUserId: vendor.sales_user_id,
        orders: ordersByVendor.get(vendor.id) ?? { total: 0, delivered: 0, returned: 0 },
        codDue: codByVendor.get(vendor.id) ?? 0,
        status: vendor.status,
        joined: formatDate(vendor.joined_at),
        lastOrderedDate: formatDate(vendor.last_ordered_at),
      })),
      meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to load vendors",
    });
  }
};

export const getRidersController = async (req: Request, res: Response) => {
  try {
    const where = { deleted_at: null };
    const { page, pageSize, skip } = paginationFromQuery(req);

    const [total, riders] = await Promise.all([
      prisma.riders.count({ where }),
      prisma.riders.findMany({
        where,
        include: { users: true, locations: true },
        orderBy: { created_at: "desc" },
        skip,
        take: pageSize,
      }),
    ]);

    const riderIds = riders.map(r => r.id);

    // A rider's order count = distinct parcels where they're the pickup OR delivery
    // rider. Aggregate pickup counts, delivery counts, and the overlap (same rider on
    // both legs of the same parcel) separately so the overlap can be subtracted once,
    // instead of pulling every parcel row into memory to dedupe in JS.
    const [pickupCounts, deliveryCounts, overlapCounts] = riderIds.length
      ? await Promise.all([
          prisma.parcels.groupBy({
            by: ["pickup_rider_id", "status"],
            where: { pickup_rider_id: { in: riderIds }, deleted_at: null },
            _count: { _all: true },
          }),
          prisma.parcels.groupBy({
            by: ["delivery_rider_id", "status"],
            where: { delivery_rider_id: { in: riderIds }, deleted_at: null },
            _count: { _all: true },
          }),
          prisma.parcels.groupBy({
            by: ["pickup_rider_id", "status"],
            where: {
              pickup_rider_id: { in: riderIds },
              deleted_at: null,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              delivery_rider_id: { in: riderIds } as any,
            },
            _count: { _all: true },
          }),
        ])
      : [[], [], []];

    type Bucket = { total: number; delivered: number; returned: number };
    const emptyBucket = (): Bucket => ({ total: 0, delivered: 0, returned: 0 });
    const applyRow = (map: Map<string, Bucket>, riderId: string | null, status: string, count: number, sign: 1 | -1) => {
      if (!riderId) return;
      const entry = map.get(riderId) ?? emptyBucket();
      entry.total += sign * count;
      if (status === "delivered") entry.delivered += sign * count;
      if ((RETURNED_STATUSES as readonly string[]).includes(status)) entry.returned += sign * count;
      map.set(riderId, entry);
    };

    const ordersByRider = new Map<string, Bucket>();
    for (const row of pickupCounts) applyRow(ordersByRider, row.pickup_rider_id, row.status, row._count._all, 1);
    for (const row of deliveryCounts) applyRow(ordersByRider, row.delivery_rider_id, row.status, row._count._all, 1);
    // overlapCounts rows are counted once by pickupCounts and once by deliveryCounts
    // above (pickup_rider_id === delivery_rider_id for these rows), so subtract once.
    for (const row of overlapCounts) applyRow(ordersByRider, row.pickup_rider_id, row.status, row._count._all, -1);

    return res.status(200).json({
      success: true,
      data: riders.map((rider, index) => ({
        id: rider.id,
        userId: rider.user_id,
        sn: skip + index + 1,
        name: rider.name,
        email: rider.users?.email || "",
        phone: rider.phone,
        location: locationLabel(rider.locations),
        orders: ordersByRider.get(rider.id) ?? emptyBucket(),
        payment: "COD",
        status: rider.status,
        joined: formatDate(rider.joined_at),
      })),
      meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to load riders",
    });
  }
};

export const logoutController = async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    const token = (authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null) ?? req.cookies.accessToken;

    if (token && process.env.JWT_SECRET) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET, {
          algorithms: ["HS256"],
          issuer: JWT_ISSUER,
          audience: ACCESS_TOKEN_AUDIENCE,
        }) as { jti?: string; exp?: number };
        if (decoded.jti && decoded.exp) {
          await revokeToken(decoded.jti, decoded.exp);
        }
      } catch {
        // Token was already invalid/expired - nothing to revoke, just clear cookies below.
      }
    }

    res.clearCookie("accessToken", { path: "/" });
    res.clearCookie("csrfToken", { path: "/" });

    return sendSuccess(res, 200, "Logged out successfully");
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to log out",
    });
  }
};

export const changePasswordController = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new AppError(401, "Unauthorized");

    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      throw new AppError(400, "currentPassword and newPassword are required");
    }

    const { token } = await changePassword(userId, currentPassword, newPassword);

    // Every other session (e.g. a stolen token) was just revoked - reissue a
    // fresh cookie so this session, which just proved it holds the correct
    // current password, keeps working.
    res.cookie("accessToken", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      path: "/",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return sendSuccess(res, 200, "Password changed successfully");
  } catch (error: any) {
    return res.status(error.statusCode || 400).json({
      success: false,
      message: error.message || "Failed to change password",
    });
  }
};

export const getLocationsController = async (_req: Request, res: Response) => {
  try {
    const locations = await prisma.locations.findMany({
      where: { is_active: true },
      orderBy: { name: "asc" },
    });

    return res.status(200).json({
      success: true,
      data: locations.map(location => ({
        id: location.id,
        name: locationLabel(location) || location.name,
        code: location.code,
        city: location.city,
        district: location.district,
        is_hub: location.is_hub,
      })),
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to load locations",
    });
  }
};
