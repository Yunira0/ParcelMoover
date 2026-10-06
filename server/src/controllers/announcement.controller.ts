import { Request, Response } from "express";
import {
  listAnnouncements,
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
  getActiveAnnouncements,
} from "../services/announcement.service";

function fail(res: Response, error: any, fallback: string) {
  return res.status(error?.statusCode || 500).json({
    success: false,
    message: error?.message || fallback,
    ...(error?.code ? { code: error.code } : {}),
  });
}

// GET /api/announcements — every announcement, any status (admin list)
export async function listAnnouncementsController(_req: Request, res: Response) {
  try {
    const data = await listAnnouncements();
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return fail(res, error, "Failed to load announcements");
  }
}

// GET /api/announcements/active — every live announcement a vendor should see now
export async function getActiveAnnouncementsController(_req: Request, res: Response) {
  try {
    const data = await getActiveAnnouncements();
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return fail(res, error, "Failed to load announcements");
  }
}

// POST /api/announcements — create
export async function createAnnouncementController(req: Request, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Unauthorized" });

    const { title, body, isEnabled, startsAt, endsAt, sortOrder } = req.body;
    if (!title || typeof title !== "string" || !title.trim()) {
      return res.status(400).json({ success: false, message: "A title is required" });
    }
    if (!body || typeof body !== "string" || !body.trim()) {
      return res.status(400).json({ success: false, message: "A body is required" });
    }

    const data = await createAnnouncement(
      {
        title,
        body,
        ...(isEnabled !== undefined ? { isEnabled: Boolean(isEnabled) } : {}),
        startsAt: startsAt || null,
        endsAt: endsAt || null,
        ...(sortOrder !== undefined ? { sortOrder: Number(sortOrder) } : {}),
      },
      req.user.id,
    );
    return res.status(201).json({ success: true, data });
  } catch (error: any) {
    return fail(res, error, "Failed to create announcement");
  }
}

// PATCH /api/announcements/:id — update
export async function updateAnnouncementController(req: Request, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Unauthorized" });

    const { title, body, isEnabled, startsAt, endsAt, sortOrder } = req.body;
    const data = await updateAnnouncement(req.params.id as string, {
      ...(title !== undefined ? { title } : {}),
      ...(body !== undefined ? { body } : {}),
      ...(isEnabled !== undefined ? { isEnabled: Boolean(isEnabled) } : {}),
      ...(startsAt !== undefined ? { startsAt: startsAt || null } : {}),
      ...(endsAt !== undefined ? { endsAt: endsAt || null } : {}),
      ...(sortOrder !== undefined ? { sortOrder: Number(sortOrder) } : {}),
    });
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return fail(res, error, "Failed to update announcement");
  }
}

// DELETE /api/announcements/:id
export async function deleteAnnouncementController(req: Request, res: Response) {
  try {
    await deleteAnnouncement(req.params.id as string);
    return res.status(200).json({ success: true });
  } catch (error: any) {
    return fail(res, error, "Failed to delete announcement");
  }
}
