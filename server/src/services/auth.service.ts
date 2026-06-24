import prisma from "../lib/prisma";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

import { AppError } from "../utils/AppError";

import { RegisterUserInput } from "../types/user-registration";

interface IuserLoginData {
  email: string;
  password: string;
}

type ManagedUserType = "admin" | "vendor" | "rider";

interface UpdateManagedUserInput {
  type: ManagedUserType;
  fullName?: string;
  phone?: string;
  position?: string;
  clientName?: string;
  businessName?: string;
  address?: string;
  joinedAt?: string;
}

async function assertCanManageUsers(userId: string) {
  const user = await prisma.users.findUnique({
    where: { id: userId },
    include: {
      user_roles: {
        include: {
          roles: true,
        },
      },
    },
  });

  if (!user) {
    throw new AppError(404, "Unauthorized");
  }

  const roles = user.user_roles.map((userRole) => userRole.roles.code);
  if (!roles.includes("super_admin") && !roles.includes("admin")) {
    throw new AppError(403, "Unauthorized");
  }
}

function parseJoinedAt(joinedAt?: string) {
  return joinedAt ? new Date(joinedAt) : undefined;
}

async function getManagedProfile(type: ManagedUserType, id: string) {
  if (type === "admin") {
    return prisma.admins.findUnique({ where: { id } });
  }

  if (type === "vendor") {
    return prisma.vendors.findUnique({ where: { id } });
  }

  return prisma.riders.findUnique({ where: { id } });
}

function getProfileUserId(profile: { user_id?: string | null } | null) {
  if (!profile?.user_id) {
    throw new AppError(404, "Linked user account not found");
  }

  return profile.user_id;
}

export async function updateManagedUserProfile(
  actorUserId: string,
  id: string,
  data: UpdateManagedUserInput,
) {
  await assertCanManageUsers(actorUserId);

  const profile = await getManagedProfile(data.type, id);
  const userId = getProfileUserId(profile);

  return prisma.$transaction(async (tx) => {
    const userUpdate: Record<string, string> = {};

    if (data.fullName?.trim()) userUpdate.full_name = data.fullName.trim();
    if (data.phone?.trim()) userUpdate.phone = data.phone.trim();

    if (Object.keys(userUpdate).length > 0) {
      await tx.users.update({
        where: { id: userId },
        data: userUpdate,
      });
    }

    if (data.type === "admin") {
      const adminUpdate: Record<string, string | Date> = { updated_at: new Date() };
      if (data.position !== undefined) adminUpdate.position = data.position;
      const joinedAt = parseJoinedAt(data.joinedAt);
      if (joinedAt) adminUpdate.joined_at = joinedAt;

      return tx.admins.update({
        where: { id },
        data: adminUpdate,
      });
    }

    if (data.type === "vendor") {
      const vendorUpdate: Record<string, string | Date> = { updated_at: new Date() };
      if (data.clientName !== undefined) vendorUpdate.client_name = data.clientName;
      if (data.businessName !== undefined) vendorUpdate.business_name = data.businessName;
      if (data.phone !== undefined) vendorUpdate.phone = data.phone;
      if (data.address !== undefined) vendorUpdate.address = data.address;
      const joinedAt = parseJoinedAt(data.joinedAt);
      if (joinedAt) vendorUpdate.joined_at = joinedAt;

      return tx.vendors.update({
        where: { id },
        data: vendorUpdate,
      });
    }

    const riderUpdate: Record<string, string | Date> = { updated_at: new Date() };
    if (data.fullName !== undefined) riderUpdate.name = data.fullName;
    if (data.phone !== undefined) riderUpdate.phone = data.phone;
    const joinedAt = parseJoinedAt(data.joinedAt);
    if (joinedAt) riderUpdate.joined_at = joinedAt;

    return tx.riders.update({
      where: { id },
      data: riderUpdate,
    });
  });
}

export async function updateManagedUserPassword(
  actorUserId: string,
  type: ManagedUserType,
  id: string,
  password: string,
) {
  await assertCanManageUsers(actorUserId);

  if (!password?.trim() || password.length < 6) {
    throw new AppError(400, "Password must be at least 6 characters long");
  }

  const profile = await getManagedProfile(type, id);
  const userId = getProfileUserId(profile);
  const passwordHash = await bcrypt.hash(password, 12);

  return prisma.users.update({
    where: { id: userId },
    data: {
      password_hash: passwordHash,
      updated_at: new Date(),
    },
  });
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
/** 
 * this is a cool function
 */
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
