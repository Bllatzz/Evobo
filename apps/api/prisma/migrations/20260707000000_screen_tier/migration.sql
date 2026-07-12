-- Adds a free/vip tier to role_screen_access so a screen can require an
-- active VipSubscription (to any group) on top of the role's base access.
-- Default 'free' preserves current behavior for every existing row/role.
CREATE TYPE "screen_tier" AS ENUM ('free', 'vip');

ALTER TABLE "role_screen_access"
  ADD COLUMN "tier" "screen_tier" NOT NULL DEFAULT 'free';
