import { Request, Response } from "express";
import { createApiKey, listApiKeys, revokeApiKey } from "../services/apiKey.service";

export async function createApiKeyController(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const result = await createApiKey(
      { id: req.user.id, roles: req.user.roles },
      req.body.name,
    );

    return res.status(201).json({
      success: true,
      message: "API key created. Copy it now — it will not be shown again.",
      data: result,
    });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to create API key",
    });
  }
}

export async function listApiKeysController(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const keys = await listApiKeys({ id: req.user.id, roles: req.user.roles });

    return res.status(200).json({ success: true, data: keys });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to load API keys",
    });
  }
}

export async function revokeApiKeyController(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    await revokeApiKey({ id: req.user.id, roles: req.user.roles }, req.params.id as string);

    return res.status(200).json({ success: true, message: "API key revoked" });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to revoke API key",
    });
  }
}
