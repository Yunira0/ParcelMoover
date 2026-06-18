import express, { Request, Response } from "express";
import { loginUser, registerUserBySuperAdmin } from "../services/auth.service";
import { AppError } from "../utils/AppError";
import { sendSuccess } from "../utils/ApiResponse";
import jwt from "jsonwebtoken";

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
