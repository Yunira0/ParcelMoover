import { Request, Response } from "express";
import { getCurrentUserProfile, updateCurrentUserProfile } from "../services/auth.service";

export async function getCurrentUserController(req: Request, res: Response) {
  try {
    if (!req.user?.id) return res.status(401).json({ error: "Unauthorized" });
    const profile = await getCurrentUserProfile(req.user.id);
    return res.json(profile);
  } catch (error: any) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error("Error fetching user profile:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function updateCurrentUserController(req: Request, res: Response) {
  try {
    if (!req.user?.id) return res.status(401).json({ error: "Unauthorized" });
    const profile = await updateCurrentUserProfile(req.user.id, req.body);
    return res.json(profile);
  } catch (error: any) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error("Error updating user profile:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}
