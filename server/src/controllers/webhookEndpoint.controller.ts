import { Request, Response } from "express";
import {
  createWebhookEndpoint,
  deleteWebhookEndpoint,
  listWebhookDeliveries,
  listWebhookEndpoints,
  regenerateWebhookSecret,
  retryWebhookDelivery,
  sendTestWebhookEvent,
  updateWebhookEndpoint,
} from "../services/webhookEndpoint.service";
import { sendError } from "../utils/errorResponse";

function actorFrom(req: Request) {
  if (!req.user) return null;
  return { id: req.user.id, roles: req.user.roles };
}

export async function createWebhookEndpointController(req: Request, res: Response) {
  try {
    const actor = actorFrom(req);
    if (!actor) return res.status(401).json({ success: false, message: "Unauthorized" });

    const result = await createWebhookEndpoint(actor, req.body);
    return res.status(201).json({
      success: true,
      message: "Webhook endpoint created. Copy the secret now — it will not be shown again.",
      data: result,
    });
  } catch (error: any) {
    return sendError(res, error, "Failed to create webhook endpoint");
  }
}

export async function listWebhookEndpointsController(req: Request, res: Response) {
  try {
    const actor = actorFrom(req);
    if (!actor) return res.status(401).json({ success: false, message: "Unauthorized" });

    const endpoints = await listWebhookEndpoints(actor);
    return res.status(200).json({ success: true, data: endpoints });
  } catch (error: any) {
    return sendError(res, error, "Failed to load webhook endpoints");
  }
}

export async function updateWebhookEndpointController(req: Request, res: Response) {
  try {
    const actor = actorFrom(req);
    if (!actor) return res.status(401).json({ success: false, message: "Unauthorized" });

    const result = await updateWebhookEndpoint(actor, req.params.id as string, req.body);
    return res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    return sendError(res, error, "Failed to update webhook endpoint");
  }
}

export async function deleteWebhookEndpointController(req: Request, res: Response) {
  try {
    const actor = actorFrom(req);
    if (!actor) return res.status(401).json({ success: false, message: "Unauthorized" });

    await deleteWebhookEndpoint(actor, req.params.id as string);
    return res.status(200).json({ success: true, message: "Webhook endpoint deleted" });
  } catch (error: any) {
    return sendError(res, error, "Failed to delete webhook endpoint");
  }
}

export async function regenerateWebhookSecretController(req: Request, res: Response) {
  try {
    const actor = actorFrom(req);
    if (!actor) return res.status(401).json({ success: false, message: "Unauthorized" });

    const result = await regenerateWebhookSecret(actor, req.params.id as string);
    return res.status(200).json({
      success: true,
      message: "Secret regenerated. Copy it now — it will not be shown again.",
      data: result,
    });
  } catch (error: any) {
    return sendError(res, error, "Failed to regenerate secret");
  }
}

export async function sendTestWebhookEventController(req: Request, res: Response) {
  try {
    const actor = actorFrom(req);
    if (!actor) return res.status(401).json({ success: false, message: "Unauthorized" });

    await sendTestWebhookEvent(actor, req.params.id as string);
    return res.status(202).json({ success: true, message: "Test event queued for delivery" });
  } catch (error: any) {
    return sendError(res, error, "Failed to send test event");
  }
}

export async function listWebhookDeliveriesController(req: Request, res: Response) {
  try {
    const actor = actorFrom(req);
    if (!actor) return res.status(401).json({ success: false, message: "Unauthorized" });

    const { page, pageSize } = req.query as unknown as { page: number; pageSize: number };
    const result = await listWebhookDeliveries(actor, req.params.id as string, { page, pageSize });
    return res.status(200).json({ success: true, data: result.data, meta: result.meta });
  } catch (error: any) {
    return sendError(res, error, "Failed to load deliveries");
  }
}

export async function retryWebhookDeliveryController(req: Request, res: Response) {
  try {
    const actor = actorFrom(req);
    if (!actor) return res.status(401).json({ success: false, message: "Unauthorized" });

    await retryWebhookDelivery(actor, req.params.id as string, req.params.deliveryId as string);
    return res.status(200).json({ success: true, message: "Delivery re-queued" });
  } catch (error: any) {
    return sendError(res, error, "Failed to retry delivery");
  }
}
