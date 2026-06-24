import express, { Request, Response } from "express";
import {
  loginUser,
  registerUserBySuperAdmin,
  updateManagedUserPassword,
  updateManagedUserProfile,
} from "../services/auth.service";
import { AppError } from "../utils/AppError";
import { sendSuccess } from "../utils/ApiResponse";
import jwt from "jsonwebtoken";
import prisma from "../lib/prisma";

const formatDate = (date?: Date | null) => date ? date.toISOString().slice(0, 10) : "";
const managedUserTypes = ["admin", "vendor", "rider"] as const;
type ManagedUserType = typeof managedUserTypes[number];

const isManagedUserType = (value: unknown): value is ManagedUserType =>
  typeof value === "string" && managedUserTypes.includes(value as ManagedUserType);

const locationLabel = (location?: { name: string; city: string | null; district: string | null } | null) => {
  if (!location) return "";
  return [location.name, location.city || location.district].filter(Boolean).join(", ");
};

export const registerUserController = async (req: Request, res: Response) => {
  try {
    const SuperAdminUserID = req.user?.id;

    if (!SuperAdminUserID) {
      throw new AppError(401, "Unauthorized");
    }

    const result = await registerUserBySuperAdmin(SuperAdminUserID, req.body);

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
    if (error.code === "P2002") {
      return res.status(409).json({
        success: false,
        message: "Email or phone number already exists",
        field: error.meta?.target,
      });
    }
    return res.status(400).json({
      success: false,
      message: error.message || "Failed to register user",
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
    });

    res.cookie("accessToken", result.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    res.cookie("csrfToken", csrfToken, {
      httpOnly: false,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
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
    console.log("Error in login controller:", error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Internal Server Error",
    });
  }
};

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
        position: admin.position || "",
        joined: formatDate(admin.joined_at),
        status: admin.users.status,
      })),
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to load admins",
    });
  }
};

export const getVendorsController = async (_req: Request, res: Response) => {
  try {
    const vendors = await prisma.vendors.findMany({
      where: { deleted_at: null },
      include: {
        locations: true,
        parcels: {
          select: { status: true },
          where: { deleted_at: null },
        },
        cod_collections: {
          select: { pending_amount: true },
          where: { payment_status: "pending" },
        },
      },
      orderBy: { created_at: "desc" },
    });

    return res.status(200).json({
      success: true,
      data: vendors.map((vendor, index) => ({
        id: vendor.id,
        userId: vendor.user_id,
        sn: index + 1,
        client: vendor.client_name,
        company: vendor.business_name || "",
        email: vendor.email || "",
        phone: vendor.phone,
        location: locationLabel(vendor.locations),
        address: vendor.address || "",
        orders: {
          total: vendor.parcels.length,
          delivered: vendor.parcels.filter(parcel => parcel.status === "delivered").length,
          returned: vendor.parcels.filter(parcel =>
            ["failed_pickup", "failed_delivery", "cancelled"].includes(parcel.status),
          ).length,
        },
        codDue: vendor.cod_collections.reduce(
          (sum, collection) => sum + Number(collection.pending_amount || 0),
          0,
        ),
        status: vendor.status,
        joined: formatDate(vendor.joined_at),
        lastOrderedDate: formatDate(vendor.last_ordered_at),
      })),
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to load vendors",
    });
  }
};

export const getRidersController = async (_req: Request, res: Response) => {
  try {
    const riders = await prisma.riders.findMany({
      where: { deleted_at: null },
      include: {
        users: true,
        locations: true,
        parcels_parcels_pickup_rider_idToriders: {
          select: { id: true, status: true },
          where: { deleted_at: null },
        },
        parcels_parcels_delivery_rider_idToriders: {
          select: { id: true, status: true },
          where: { deleted_at: null },
        },
      },
      orderBy: { created_at: "desc" },
    });

    return res.status(200).json({
      success: true,
      data: riders.map((rider, index) => ({
        id: rider.id,
        userId: rider.user_id,
        sn: index + 1,
        name: rider.name,
        email: rider.users?.email || "",
        phone: rider.phone,
        location: locationLabel(rider.locations),
        orders: (() => {
          const parcels = [
            ...rider.parcels_parcels_pickup_rider_idToriders,
            ...rider.parcels_parcels_delivery_rider_idToriders,
          ];
          const uniqueParcels = Array.from(
            new Map(parcels.map(parcel => [parcel.id, parcel])).values(),
          );
          return {
            total: uniqueParcels.length,
            delivered: uniqueParcels.filter(parcel => parcel.status === "delivered").length,
            returned: uniqueParcels.filter(parcel =>
              ["failed_pickup", "failed_delivery", "cancelled"].includes(parcel.status),
            ).length,
          };
        })(),
        payment: "COD",
        status: rider.status,
        joined: formatDate(rider.joined_at),
      })),
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to load riders",
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
      })),
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to load locations",
    });
  }
};
