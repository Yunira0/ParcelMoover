import { describe, expect, it, vi } from "vitest";
vi.mock("../../lib/prisma", () => ({ default: { notifications: { count: vi.fn(), findMany: vi.fn() } } }));
vi.mock("../../lib/redis", () => ({ default: {} }));
vi.mock("../../lib/redisPubSub", () => ({ publishNotification: vi.fn() }));
import prisma from "../../lib/prisma";
import { listNotifications } from "../notification.service";

describe("notification feed ordering", () => {
  it("uses an ID tie-breaker, keeps user scope and preserves exact offset pagination", async () => {
    vi.mocked(prisma.notifications.count).mockResolvedValue(101);
    vi.mocked(prisma.notifications.findMany).mockResolvedValue([]);
    const result = await listNotifications("user-a", 2, 50);
    expect(prisma.notifications.findMany).toHaveBeenCalledWith({
      where: { user_id: "user-a" }, orderBy: [{ created_at: "desc" }, { id: "desc" }], skip: 50, take: 50,
    });
    expect(result.meta).toEqual({ page: 2, pageSize: 50, total: 101, totalPages: 3 });
  });
});
