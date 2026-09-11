import type { ScreenKey, ScreenTier } from "@evobo/shared-types";
import { apiFetch } from "./api";

export type AdminOverview = { tipstersCount: number; usersCount: number };

export const fetchAdminOverview = (): Promise<AdminOverview> => apiFetch("/admin/overview");

export type RoleSummary = {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  userCount: number;
};

export type RoleDetail = {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  screens: ScreenKey[];
  screensByTier: { free: ScreenKey[]; vip: ScreenKey[] };
};

export const fetchRoles = (): Promise<RoleSummary[]> => apiFetch("/roles");

export const fetchRole = (id: string): Promise<RoleDetail> =>
  apiFetch(`/roles/${encodeURIComponent(id)}`);

export const createRole = (input: { name: string; description?: string }) =>
  apiFetch("/roles", { method: "POST", body: JSON.stringify(input) });

export const updateRole = (id: string, input: { description?: string }) =>
  apiFetch(`/roles/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) });

export const deleteRole = (id: string) =>
  apiFetch(`/roles/${encodeURIComponent(id)}`, { method: "DELETE" });

export const updateRoleScreenAccess = (
  id: string,
  screens: ScreenKey[],
  tier: ScreenTier = "free",
) =>
  apiFetch(`/roles/${encodeURIComponent(id)}/screen-access?tier=${encodeURIComponent(tier)}`, {
    method: "PUT",
    body: JSON.stringify({ screens }),
  });

export type UserSearchResult = {
  id: string;
  username: string;
  displayName: string;
  role: { id: string; name: string };
};

export const searchUsersForRole = (q: string): Promise<UserSearchResult[]> =>
  apiFetch(`/roles/users/search?q=${encodeURIComponent(q)}`);

export const assignRole = (userId: string, roleId: string) =>
  apiFetch("/roles/assign", { method: "POST", body: JSON.stringify({ userId, roleId }) });

export type AdminUser = {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  role: { id: string; name: string };
  isActive: boolean;
  verifiedAt: string | null;
  createdAt: string;
  lastLoginAt: string | null;
};

export type AdminUsersPage = { data: AdminUser[]; total: number; page: number; limit: number; totalPages: number };

export const fetchAdminUsers = (filter: { page?: number; limit?: number; q?: string } = {}): Promise<AdminUsersPage> => {
  const params = new URLSearchParams();
  if (filter.page) params.set("page", String(filter.page));
  if (filter.limit) params.set("limit", String(filter.limit));
  if (filter.q) params.set("q", filter.q);
  const qs = params.toString();
  return apiFetch(`/admin/users${qs ? `?${qs}` : ""}`);
};

export const setUserActive = (userId: string, isActive: boolean) =>
  apiFetch(`/admin/users/${encodeURIComponent(userId)}`, { method: "PATCH", body: JSON.stringify({ isActive }) });

/** "Histórico do Robô" — per-market "odd indicada" (see RobotMarketOdd in schema.prisma). */
export type RobotMarketOddEntry = { groupKey: string; market: string; indicatedOdd: number | null };

export const fetchRobotMarketOdds = (): Promise<RobotMarketOddEntry[]> =>
  apiFetch("/admin/robot-market-odds");

export const updateRobotMarketOdd = (
  groupKey: string,
  indicatedOdd: number | null,
): Promise<{ groupKey: string; indicatedOdd: number | null }> =>
  apiFetch(`/admin/robot-market-odds/${encodeURIComponent(groupKey)}`, {
    method: "PATCH",
    body: JSON.stringify({ indicatedOdd }),
  });
