import prisma from "../lib/prisma";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

import { AppError } from "../utils/AppError";

import { RegisterUserInput } from "../types/user-registration";

interface IuserLoginData {
  email: string;
  password: string;
}

function validateRegisterInput(input: RegisterUserInput) {
  if (!input.type) {
    throw new AppError(400, "User type is required");
  }

  if (!["admin", "vendor", "rider"].includes(input.type)) {
    throw new AppError(400, "Invalid user type");
  }

  if (!input.fullName?.trim()) {
    throw new AppError(400, "Full name is required");
  }

  if (!input.email?.trim()) {
    throw new AppError(400, "Email is required");
  }

  if (!input.password.trim() || input.password.length < 6) {
    throw new AppError(
      400,
      "Password is required and must be at least 6 characters long",
    );
  }

  if (input.type === "vendor") {
    if (!input.clientName?.trim()) {
      throw new AppError(400, "Client name is required for vendor");
    }

    if (!input.businessName?.trim()) {
      throw new AppError(400, "Business name is required for vendor");
    }

    if (!input.phone?.trim()) {
      throw new AppError(400, "Phone number is required for vendor");
    }
  }

  if (input.type === "rider") {
    if (!input.phone?.trim()) {
      throw new AppError(400, "Phone number is required for rider");
    }
  }

  if (input.type === "admin") {
    if (!input.position?.trim()) {
      throw new AppError(400, "Position is required for admin");
    }
  }
}

export async function registerUserBySuperAdmin(
  superAdminUserID: string,
  data: RegisterUserInput,
) {

  
  const superAdmin = await prisma.users.findUnique({
    where: { id: superAdminUserID },
    include: {
      user_roles: {
        include: {
          roles: true,
        },
      },
    },
  });
  if (!superAdmin) {
    throw new AppError(404, "Unauthorized");
  }

  const creatorRoles = superAdmin?.user_roles.map((userRole) => userRole.roles.code);
  
  const isSuperAdmin = creatorRoles.includes("super_admin");
  const isAdmin = creatorRoles.includes("admin");

  if (!isSuperAdmin && !isAdmin) {
    throw new AppError(403, "Unauthorized");
  }

  if (!isSuperAdmin && isAdmin && !["rider", "vendor"].includes(data.type)) {
    throw new AppError(403, "Admins can only create vendor or rider accounts");
  }

  validateRegisterInput(data);

  const role = await prisma.roles.findUnique({
    where: { code: data.type },
  });

  if (!role) {
    throw new AppError(
      400,
      `Role '${data.type}' does not exist in the system")`,
    );
  }

  const passwordHash = await bcrypt.hash(data.password, 12);

  return prisma.$transaction(async (tx) => {
    const user = await tx.users.create({
      data: {
        full_name: data.fullName,
        email: data.email,
        phone: data.phone,
        password_hash: passwordHash,
        status: "active",
      },
    });

    await tx.user_roles.create({
      data: {
        user_id: user.id,
        role_id: role.id,
      },
    });

    if (data.type === "admin") {
      const admin = await tx.admins.create({
        data: {
          user_id: user.id,
          location_id: data.locationId ?? null,
          position: data.position ?? null,
          joined_at: data.joinedAt ? new Date(data.joinedAt) : null,
        },
      });

      return {
        user,
        profile: admin,
        role: data.type,
      };
    }

    if (data.type === "vendor") {
      const vendor = await tx.vendors.create({
        data: {
          user_id: user.id,
          client_name: data.clientName!,
          business_name: data.businessName!,
          phone: data.phone!,
          email: data.email!,
          location_id: data.locationId ?? null,
          address: data.address ?? null,
          status: "active",
          joined_at: data.joinedAt ? new Date(data.joinedAt) : null,
        },
      });

      
      return {
        user,
        profile: vendor,
        role: data.type,
      };
    }

      const raider = await tx.riders.create({
        data: {
          user_id: user.id,
          name: data.fullName,
          phone: data.phone!,
          location_id: data.locationId ?? null,
          status: "active",
          joined_at: data.joinedAt ? new Date(data.joinedAt) : null,
        },
      });
      
      return {
        user,
        profile: raider,
        role: data.type,
      };
  });
}

export async function loginUser(data: IuserLoginData) {
  try {
    const user = await prisma.users.findUnique({
      where: { email: data.email },
      include: { user_roles: { include: { roles: true } } },
    });

    if (!user || !user.password_hash) {
      throw new AppError(401, "Invalid email or password");
    }

    if (user.status !== "active" || user.deleted_at) {
      throw new AppError(403, "User account is inactive or deleted");
    }

    const isValid = await bcrypt.compare(data.password, user.password_hash);
    if (!isValid) {
      throw new AppError(401, "Invalid email or password");
    }

    if (!process.env.JWT_SECRET) {
      throw new AppError(500, "JWT secret not configured");
    }

    const roles = user.user_roles.map((url) => url.roles.code);

    const token = jwt.sign(
      {
        id: user.id,
        roles
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" },
    );

    await prisma.users.update({
      where: { id: user.id },
      data: { last_login_at: new Date() },
    });


    return {
      token,
      user: {
        id: user.id,
        fullName: user.full_name,
        email: user.email,
        phone: user.phone,
        status: user.status,
        roles,
      }
    }

  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    console.error("Login service error:", error);
    throw new AppError(500, "Error occurred while logging in");
  }
}
